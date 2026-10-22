// PNG export of the diagrams. The charts are drawn again offscreen at a fixed width
// (EXPORT_WIDTH CSS px) with light, high-contrast colours (EXPORT_TOKENS), so that the
// image is the same on all devices and in both colour schemes.
// One diagram: a header (diagram title with the step, view name, parameters, source) and the chart.
// All diagrams: one composite image with the same header and, for each diagram, the title
// with the step, the chart and the alt text, so that the image tells what it shows.
// Both images get iTXt chunks (keywords Title, Description and Step).
import type { Meta } from './db';
import { addTextChunks, bytesToDataUrl, dataUrlToBytes } from './png';
import { AGGREGATION_LABELS, VARIABLE_LABELS, type View, type ViewParams } from './state';
import { displayUnit, selectedSiteLabels, yearsText } from './diagrams/common';
import { listText } from './alttext';
import { EXPORT_TOKENS } from './theme';

/** One diagram card, as the export sees it. */
export interface ExportItem {
  id: string;
  type: string;
  /** Title with the position, for example "1. Time series". */
  title: string;
  subtitle: string;
  /** Note when the card shows no chart (for example "Select a site"), else empty. */
  note: string;
  alt: string;
  ready: boolean;
  /** Step that the diagram shows, for example "Daily mean". */
  step: string;
  /** Chart size in the export, in CSS px (width = EXPORT_WIDTH). 0 when the card shows no chart. */
  width: number;
  height: number;
  /** Empty band in CSS px at the bottom of the chart image (place of the zoom slider). The export removes it. */
  cropBottom: number;
  /** PNG data URL of the export chart at `scale` pixels per CSS px, or null when no chart. */
  image(scale: number): string | null;
}

export interface PngResult {
  dataUrl: string;
  alt: string;
}

/** Default pixels per CSS px. */
export const DEFAULT_SCALE = 3;
const MAX_SCALE = 6;
// Chromium canvas limits: 32 767 px per side, about 268 million px in total. Keep a margin.
const MAX_SIDE = 32_000;
const MAX_AREA = 200_000_000;

/** Width in CSS px of each chart in the export, on all devices. */
export const EXPORT_WIDTH = 1200;
/** Margin in CSS px around the content of a composite image. It is EXPORT_WIDTH + 2 × PAD wide; a single-diagram image is EXPORT_WIDTH wide. */
export const PAD = 24;
/** Left and right text inset in CSS px of a single-diagram image (it has no side margin). */
const TEXT_INSET = 12;
const FONT = 'system-ui, sans-serif';

interface Colors {
  background: string;
  text: string;
  muted: string;
  rule: string;
}

/** Colours of the exported image: always EXPORT_TOKENS (light), not the page theme. */
function readColors(): Colors {
  return { background: EXPORT_TOKENS.surface, text: EXPORT_TOKENS.text, muted: EXPORT_TOKENS.textMuted, rule: EXPORT_TOKENS.grid };
}

function cleanScale(scale: unknown): number {
  const s = typeof scale === 'number' && Number.isFinite(scale) ? scale : DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(1, s));
}

/** Parameters of the view in one line: sites, variables with units, years and step. */
export function paramsLine(view: View, meta: Meta, types: string[]): string {
  const p = view.params;
  const sites = selectedSiteLabels(meta, p);
  const vars = p.variables.map((v) => `${VARIABLE_LABELS[v]} (${displayUnit(meta, v)})`);
  const parts = [
    `Sites: ${sites.length ? listText(sites) : 'none'}`,
    `Variables: ${vars.length ? vars.join(', ') : 'none'}`,
    `Years: ${yearsText(p)}`,
    `Step: ${AGGREGATION_LABELS[p.aggregation]}`,
  ];
  if (types.includes('scatter')) parts.push(`X variable: ${VARIABLE_LABELS[p.xVariable]}`);
  parts.push(p.fixedY ? 'Y range: fixed (all data)' : 'Y range: auto');
  if (p.events) parts.push('Events: shown');
  return `${parts.join('. ')}.`;
}

/**
 * Data files of the view. GPP and Reco (calculated) come from fluxes.parquet,
 * the other variables from observations.parquet.
 */
export function sourceFiles(params: ViewParams): string {
  const calc = params.variables.some((v) => v === 'gpp' || v === 'reco');
  return calc ? 'observations.parquet and fluxes.parquet' : 'observations.parquet';
}

/** Source line: data set, page address and the time of the export (UTC). */
export function sourceLine(params: ViewParams): string {
  const url = window.location.origin + window.location.pathname;
  const time = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `Source: INAR agri harmonised database (${sourceFiles(params)}), ${url}. Time axes show site local time. Made ${time} UTC.`;
}

/** File name part from the view name: lower case, a to z, 0 to 9 and "-". */
export function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'view';
}

function withText(dataUrl: string, title: string, alt: string, step: string): string {
  const bytes = addTextChunks(dataUrlToBytes(dataUrl), [
    { keyword: 'Title', text: title },
    { keyword: 'Description', text: alt },
    { keyword: 'Step', text: step },
  ]);
  return bytesToDataUrl(bytes);
}

/** Chart height in the export: without the empty band at the bottom. */
const shownHeight = (item: ExportItem) => Math.max(0, item.height - item.cropBottom);

// ---------- Canvas drawing ----------

interface TextBlock {
  lines: string[];
  font: string;
  color: string;
  lineHeight: number;
}

/** Break `text` into lines that are not wider than `width`. Very long words are broken too. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      // A word that is wider than the line: break it into parts.
      let rest = word;
      while (ctx.measureText(rest).width > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && ctx.measureText(rest.slice(0, n)).width > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

function block(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  size: number,
  color: string,
  weight = 400,
): TextBlock {
  const font = `${weight} ${size}px ${FONT}`;
  ctx.font = font;
  return { lines: text ? wrap(ctx, text, width) : [], font, color, lineHeight: Math.round(size * 1.45) };
}

const blockHeight = (b: TextBlock) => b.lines.length * b.lineHeight;

type Part = { kind: 'text'; block: TextBlock; gap: number } | { kind: 'image'; item: ExportItem; gap: number } | { kind: 'rule'; gap: number };

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

/** Adds the step in brackets, for example "1. Time series (Step: Daily mean)". */
const withStep = (text: string, step: string) => (step ? `${text} (Step: ${step})` : text);

/** Diagram title with the step, for example "1. Time series (Step: Daily mean)". */
const stepTitle = (item: ExportItem) => withStep(item.title, item.step);

/** Header parts: title, parameters line and source line. */
function headerParts(ctx: CanvasRenderingContext2D, title: string, params: string, source: string, contentW: number, colors: Colors): Part[] {
  return [
    { kind: 'text', block: block(ctx, title, contentW, 22, colors.text, 650), gap: 4 },
    { kind: 'text', block: block(ctx, params, contentW, 14, colors.text), gap: 4 },
    { kind: 'text', block: block(ctx, source, contentW, 13, colors.muted), gap: 16 },
  ];
}

/**
 * Draw the parts on one canvas, EXPORT_WIDTH + 2 × `side` CSS px wide, and return the PNG data URL.
 * With `side` = 0 (single diagram) the chart fills the width and the text has an inset of TEXT_INSET px.
 * The chart images are made at the final scale. The empty band at the bottom of a chart
 * (`cropBottom`, place of the zoom slider) is not drawn.
 */
async function drawParts(parts: Part[], scale: number, colors: Colors, side = PAD): Promise<string> {
  const contentW = EXPORT_WIDTH;
  const width = contentW + 2 * side;
  const textX = side > 0 ? side : TEXT_INSET;
  const partHeight = (p: Part) => (p.kind === 'text' ? blockHeight(p.block) : p.kind === 'image' ? shownHeight(p.item) : 1);
  const height = Math.ceil(PAD + parts.reduce((h, p) => h + partHeight(p) + p.gap, 0) + PAD);

  // Make the scale smaller when the canvas would be too large for the browser.
  let s = cleanScale(scale);
  s = Math.min(s, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));
  s = Math.max(0.5, Math.floor(s * 100) / 100);

  const images = new Map<ExportItem, HTMLImageElement>();
  for (const p of parts) {
    if (p.kind !== 'image') continue;
    const url = p.item.image(s);
    if (url) images.set(p.item, await loadImage(url));
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * s);
  canvas.height = Math.round(height * s);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('The browser cannot make a 2D canvas.');
  g.fillStyle = colors.background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.scale(s, s);
  g.textBaseline = 'top';

  let y = PAD;
  for (const p of parts) {
    if (p.kind === 'rule') {
      g.fillStyle = colors.rule;
      g.fillRect(side, y, contentW, 1);
    } else if (p.kind === 'image') {
      const img = images.get(p.item);
      // Draw the chart without the empty band at the bottom.
      const h = shownHeight(p.item);
      if (img) g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight * (h / p.item.height), side, y, p.item.width, h);
    } else {
      const b = p.block;
      g.font = b.font;
      g.fillStyle = b.color;
      // Put the glyphs in the middle of the line box.
      const offset = (b.lineHeight - Number.parseFloat(b.font.split(' ')[1] ?? '13')) / 2;
      b.lines.forEach((line, i) => g.fillText(line, textX, y + offset + i * b.lineHeight));
    }
    y += partHeight(p) + p.gap;
  }
  return canvas.toDataURL('image/png');
}

function canvas2d(): CanvasRenderingContext2D {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('The browser cannot make a 2D canvas.');
  return ctx;
}

/**
 * PNG of one diagram: a header band (diagram title with the step and the view name,
 * parameters line, source line) above the chart. The title chunk has the diagram title and the view name.
 */
export async function diagramPng(item: ExportItem, view: View, meta: Meta, scale: number): Promise<PngResult> {
  if (!item.ready) throw new Error(`Diagram ${item.id} is not ready.`);
  if (item.width <= 0 || item.height <= 0) throw new Error(`Diagram ${item.id} has no chart: ${item.note || 'no data'}`);
  const colors = readColors();
  const ctx = canvas2d();
  // For example "1. Time series — All data (Step: Daily mean)".
  const viewTitle = `${item.title} — ${view.name}`;
  const title = withStep(viewTitle, item.step);
  const params = paramsLine(view, meta, [item.type]);
  const source = sourceLine(view.params);
  // The chart fills the width (EXPORT_WIDTH): the text has an inset on the two sides.
  const textW = EXPORT_WIDTH - 2 * TEXT_INSET;
  const parts: Part[] = headerParts(ctx, title, params, source, textW, colors);
  if (item.subtitle) parts.push({ kind: 'text', block: block(ctx, item.subtitle, textW, 13, colors.muted), gap: 8 });
  parts.push({ kind: 'image', item, gap: 0 });
  const url = await drawParts(parts, scale, colors, 0);
  return { dataUrl: withText(url, viewTitle, item.alt, item.step), alt: item.alt };
}

/**
 * Composite PNG of all diagrams of the view. The alt text of the image is the header
 * text and the alt text of each diagram, in the order of the cards.
 */
export async function compositePng(view: View, meta: Meta, items: ExportItem[], scale: number): Promise<PngResult> {
  const waiting = items.filter((i) => !i.ready);
  if (waiting.length > 0) throw new Error(`Diagrams are not ready: ${waiting.map((i) => i.id).join(', ')}.`);
  const colors = readColors();
  const contentW = EXPORT_WIDTH;
  const ctx = canvas2d();

  const params = paramsLine(
    view,
    meta,
    items.map((i) => i.type),
  );
  const source = sourceLine(view.params);
  const parts: Part[] = headerParts(ctx, view.name, params, source, contentW, colors);
  const altParts = [`${view.name}. ${params} ${source}`];
  if (items.length === 0) parts.push({ kind: 'text', block: block(ctx, 'This view has no diagrams.', contentW, 14, colors.muted), gap: 0 });
  for (const item of items) {
    const title = stepTitle(item);
    parts.push({ kind: 'rule', gap: 16 });
    parts.push({ kind: 'text', block: block(ctx, title, contentW, 17, colors.text, 600), gap: item.subtitle ? 2 : 8 });
    if (item.subtitle) parts.push({ kind: 'text', block: block(ctx, item.subtitle, contentW, 13, colors.muted), gap: 8 });
    if (item.width > 0 && item.height > 0) parts.push({ kind: 'image', item, gap: 10 });
    if (item.note) parts.push({ kind: 'text', block: block(ctx, item.note, contentW, 14, colors.muted), gap: 8 });
    if (item.alt) {
      parts.push({ kind: 'text', block: block(ctx, 'Alt text', contentW, 13, colors.text, 600), gap: 2 });
      parts.push({ kind: 'text', block: block(ctx, item.alt, contentW, 13, colors.muted), gap: 16 });
    }
    altParts.push(`${title}. ${item.alt || item.note}`);
  }

  const alt = altParts.join('\n\n');
  const url = await drawParts(parts, scale, colors);
  return { dataUrl: withText(url, view.name, alt, AGGREGATION_LABELS[view.params.aggregation]), alt };
}

/** Save a data URL as a file through a temporary link. */
export function download(dataUrl: string, fileName: string): void {
  downloadBlob(new Blob([dataUrlToBytes(dataUrl) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), fileName);
}

/** Save a Blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
