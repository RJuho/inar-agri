// Export of the carbon balance figures for delivery. It writes the folder data/carbon-balances/
// with three subfolders (NEE, NBE, CO2-uptake). Each subfolder gets:
//   1. a PDF of the Deep Dive page with only the parts that belong to the figures of the folder,
//   2. copies of the SVG figures (bytes unchanged),
//   3. PNG images of the SVG figures with a transparent background (images/, 600 dpi).
// The script also writes data/carbon-balances/README.md.
//
// Run: npm run export:carbon-balances -- [options]   (or: node scripts/export-carbon-balances.ts [options])
// Help: npm run export:carbon-balances -- --help
//
// The PDFs come from the built site. Start the server first, for example:
//   npm run site:build && npm run site:preview -- --ignore-lock

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { crc32 } from 'node:zlib';
import { chromium, type Browser, type Page } from '@playwright/test';

const DEFAULT_URL = 'http://localhost:4321/';
const OUT_DIR = 'data/carbon-balances';
const DEFAULT_DPI = 600;
const FALLBACK_DPI = 400;
/** Largest PNG side in device pixels. Chromium can fail above its maximum texture size (16384). */
const MAX_SIDE_PX = 16000;

const HELP = `Export the carbon balance figures (Deep Dives carbon-space and net-biome-exchange)
to ${OUT_DIR}/: PDF extracts of the Deep Dive pages, SVG copies and transparent PNG images.

Usage: npm run export:carbon-balances -- [options]
       node scripts/export-carbon-balances.ts [options]

Options:
  --url <url>        Address of the built site. Default: ${DEFAULT_URL}
  --dpi <n>          PNG resolution, 72 to 1200. Default: ${DEFAULT_DPI}.
  --skip-missing     Skip a missing SVG source with a warning. Default: stop with an error.
  --help             Print this text.

The script removes all old files in ${OUT_DIR}/ before it writes the new files.

Exit codes: 0 = done, 1 = error, 2 = bad option or no server.`;

interface FigureSource {
  /** Figure number in the Deep Dive. */
  n: number;
  /** Source SVG, relative to the repository root. */
  src: string;
  /** Output base name, without extension. */
  name: string;
  /** True for the main figure of the page; false for a variant (not on the page). */
  main: boolean;
}

interface Bundle {
  folder: string;
  title: string;
  slug: string;
  pdf: string;
  /** Blocks of the page to keep in the PDF: figure ids ("figure-1") and "groups". */
  blocks: string[];
  figures: FigureSource[];
  about: string;
}

const CS = 'analysis/carbon-space/figures';
const NB = 'analysis/net-biome-exchange/figures';

function fig(n: number, dir: string, base: string, variant = ''): FigureSource {
  const file = variant === '' ? `${dir}/${n}-${base}.svg` : `${dir}/variants/${n}-${base}-${variant}.svg`;
  return { n, src: file, name: `figure-${n}-${base}${variant === '' ? '' : `-${variant}`}`, main: variant === '' };
}

const BUNDLES: Bundle[] = [
  {
    folder: 'NEE',
    title: 'Annual GPP, Reco and NEE per site-year (carbon space)',
    slug: 'carbon-space',
    pdf: 'carbon-space-NEE.pdf',
    blocks: ['figure-1', 'groups', 'figure-4'],
    figures: [
      fig(1, CS, 'carbon-space'),
      fig(1, CS, 'carbon-space', 'no-labels'),
      fig(4, CS, 'carbon-space-forest'),
      fig(4, CS, 'carbon-space-forest', 'no-labels'),
    ],
    about:
      'Annual Reco against annual GPP per site-year. NEE = Reco − GPP. Figure 1: the six agricultural sites. ' +
      'Figure 4: the same with the Hyytiälä forest as a reference.',
  },
  {
    folder: 'NBE',
    title: 'Net biome exchange (NBE) per site-year',
    slug: 'net-biome-exchange',
    pdf: 'net-biome-exchange-NBE.pdf',
    blocks: ['figure-1'],
    figures: [
      fig(1, NB, 'nbe-carbon-space'),
      fig(1, NB, 'nbe-carbon-space', 'no-labels'),
      fig(1, NB, 'nbe-carbon-space', 'wide'),
      fig(1, NB, 'nbe-carbon-space', 'wide-no-labels'),
      fig(1, NB, 'nbe-carbon-space', 'wide-no-nee'),
      fig(1, NB, 'nbe-carbon-space', 'wide-no-nee-no-labels'),
    ],
    about: 'NBE = NEE + C_out − C_in (harvest carbon out, organic inputs in) per site-year, with NEE for comparison.',
  },
  {
    folder: 'CO2-uptake',
    title: 'Share of CO₂ uptake days per site-year',
    slug: 'carbon-space',
    pdf: 'carbon-space-CO2-uptake.pdf',
    blocks: ['figure-2', 'figure-3', 'groups', 'figure-5'],
    figures: [
      fig(2, CS, 'uptake-days'),
      fig(3, CS, 'uptake-days-peak'),
      fig(5, CS, 'uptake-days-peak-forest'),
    ],
    about:
      'Share of the days with daily NEE < 0 (net CO₂ uptake). Figure 2: whole year and June to August. ' +
      'Figure 3: the peak window of GPP. Figure 5: the peak window with the Hyytiälä forest as a reference.',
  },
];

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

/** Same check as scripts/screenshot.ts: "astro preview" can listen on ::1 only. */
async function reachable(url: string): Promise<boolean> {
  const u = new URL(url);
  const urls = [u.toString()];
  if (u.hostname === 'localhost') {
    for (const host of ['[::1]', '127.0.0.1']) {
      const v = new URL(url);
      v.hostname = host;
      urls.push(v.toString());
    }
  }
  for (const candidate of urls) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(10000) });
      if (res.status < 500) return true;
    } catch {
      // Try the next address.
    }
  }
  return false;
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Width and height of the SVG root in pt (matplotlib writes width="...pt"). */
function svgSizePt(svg: string): [number, number] {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const num = (attr: string): number => {
    const m = new RegExp(`\\b${attr}="([0-9.]+)(pt|px)?"`).exec(root);
    if (!m?.[1]) throw new Error(`The SVG root has no ${attr}.`);
    const v = Number(m[1]);
    return m[2] === 'px' ? (v * 72) / 96 : v;
  };
  return [num('width'), num('height')];
}

/** Add a pHYs chunk (resolution in pixels per metre) after the IHDR chunk of a PNG. */
function withDpi(png: Buffer, dpi: number): Buffer {
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data.writeUInt8(1, 8); // unit: metre
  const type = Buffer.from('pHYs', 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

function pngSize(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

// Code that runs in the browser. The tsconfig of scripts/ has no DOM types, thus the code is a
// JavaScript string. It gets one JSON argument.

/**
 * Rebuild <main> of a Deep Dive page for the PDF. Keeps: kicker, h1, AI notice, facts box without
 * the Status row, the Question section, the blocks in `keep` and the References section.
 * A block starts at a figure (with a heading directly before it) or at the "Groups." paragraph and
 * ends before the next figure or heading. Returns the ids of the kept figures and the desc text of
 * each figure.
 */
const EXTRACT_JS = String.raw`(arg) => {
  const keep = arg.keep;
  const main = document.querySelector('main.deep-dive');
  if (!main) throw new Error('No main.deep-dive element on the page.');
  const header = main.querySelector(':scope > header');
  const out = document.createElement('main');
  out.className = main.className;
  if (header) {
    const h = header.cloneNode(true);
    const status = h.querySelector('dl.dd-facts .dd-status');
    if (status) status.closest('dl.dd-facts > div').remove();
    out.append(h);
  }
  const kids = [...main.children].filter((e) => e !== header);
  let owner = null;
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i];
    const tag = el.tagName;
    if (tag === 'H2' || tag === 'H3') {
      const next = kids[i + 1];
      if (next && next.matches('figure.dd-figure')) owner = next.id;
      else if (tag === 'H2' && el.id === 'question') owner = 'question';
      else if (tag === 'H2' && el.id === 'references') owner = 'references';
      else owner = null;
    } else if (el.matches('figure.dd-figure')) {
      owner = el.id;
    } else if (tag === 'P' && el.firstElementChild && el.firstElementChild.tagName === 'STRONG' &&
               el.firstChild === el.firstElementChild && el.firstElementChild.textContent.trim() === 'Groups.') {
      owner = 'groups';
    }
    if (owner === 'question' || owner === 'references' || (owner && keep.includes(owner))) out.append(el.cloneNode(true));
  }
  // Links-only UI and links.
  out.querySelectorAll('.dd-figure-link, script, style:not(svg style)').forEach((e) => e.remove());
  out.querySelectorAll('details').forEach((d) => { d.open = true; d.setAttribute('open', ''); });
  out.querySelectorAll('a').forEach((a) => {
    const s = document.createElement('span');
    s.className = a.className;
    while (a.firstChild) s.append(a.firstChild);
    a.replaceWith(s);
  });
  const css = document.createElement('style');
  css.textContent = arg.css;
  document.head.append(css);
  document.body.replaceChildren(out);
  const figures = [...out.querySelectorAll('figure.dd-figure')].map((f) => ({
    id: f.id,
    desc: (f.querySelector('svg desc') || {}).textContent || '',
  }));
  return { figures, links: out.querySelectorAll('a').length, text: out.textContent };
}`;

const PRINT_CSS = `
html, body { background: #fff !important; color: #000; }
body { margin: 0 !important; padding: 0 !important; }
main.deep-dive { max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; }
.dd-figure-wrap, .figure-mpl { overflow: visible !important; max-width: 100% !important; width: auto !important; }
.figure-mpl svg { width: 100% !important; max-width: 100% !important; height: auto !important; }
.dd-figure-wrap { break-inside: avoid; }
h1, h2, h3 { break-after: avoid; }
main.deep-dive ol { padding-left: 2.6em !important; }
main.deep-dive ul { padding-left: 1.6em !important; }
details.dd-alt > summary { list-style: none; font-weight: 600; }
details.dd-alt > summary::-webkit-details-marker { display: none; }
`;

/** Desc text of an SVG file, read through the browser (decodes the XML entities). */
const SVG_DESC_JS = String.raw`(svg) => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const d = doc.querySelector('desc');
  return d ? d.textContent : '';
}`;

/** Make the full-canvas background patch of a matplotlib SVG transparent. Returns an error text or ''. */
const TRANSPARENT_JS = String.raw`() => {
  const svg = document.querySelector('svg');
  const path = document.querySelector('g[id$="patch_1"] > path');
  if (!svg || !path) return 'no patch_1 path';
  const vb = svg.viewBox.baseVal;
  const b = path.getBBox();
  if (Math.abs(b.x - vb.x) > 0.5 || Math.abs(b.y - vb.y) > 0.5 || Math.abs(b.width - vb.width) > 0.5 || Math.abs(b.height - vb.height) > 0.5)
    return 'the first patch_1 path is not the full canvas (' + [b.x, b.y, b.width, b.height].join(', ') + ')';
  path.style.fill = 'none';
  path.setAttribute('fill', 'none');
  return '';
}`;

async function renderPng(browser: Browser, svg: string, dpi: number): Promise<{ png: Buffer; dpi: number }> {
  const [wPt, hPt] = svgSizePt(svg);
  let used = dpi;
  const side = (Math.max(wPt, hPt) / 72) * used;
  if (side > MAX_SIDE_PX) {
    used = Math.min(FALLBACK_DPI, Math.floor((MAX_SIDE_PX * 72) / Math.max(wPt, hPt)));
    console.warn(`  Warning: ${Math.round(side)} px is too large for Chromium; PNG at ${used} dpi.`);
  }
  const cssW = Math.ceil((wPt * 96) / 72);
  const cssH = Math.ceil((hPt * 96) / 72);
  const context = await browser.newContext({
    viewport: { width: cssW + 16, height: cssH + 16 },
    deviceScaleFactor: used / 96,
    colorScheme: 'light',
  });
  try {
    const page = await context.newPage();
    const inline = svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '').replace(/^\s*<!DOCTYPE[^>]*>\s*/, '');
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>${inline}</body></html>`,
    );
    await page.evaluate('document.fonts.ready');
    const err = (await page.evaluate(`(${TRANSPARENT_JS})()`)) as string;
    if (err) throw new Error(`Cannot make the background transparent: ${err}.`);
    const png = await page.locator('svg').first().screenshot({ omitBackground: true, type: 'png' });
    return { png: withDpi(png, used), dpi: used };
  } finally {
    await context.close();
  }
}

async function makePdf(page: Page, url: string, bundle: Bundle, outFile: string, sources: Map<string, string>): Promise<void> {
  await page.goto(url, { waitUntil: 'load' });
  await page.emulateMedia({ colorScheme: 'light', media: 'print' });
  const missing = [];
  for (const id of bundle.blocks.filter((b) => b.startsWith('figure-'))) {
    if ((await page.locator(`figure.dd-figure#${id}`).count()) === 0) missing.push(id);
  }
  if (missing.length > 0) throw new Error(`${url}: no ${missing.join(', ')} on the page.`);
  const result = (await page.evaluate(`(${EXTRACT_JS})(${JSON.stringify({ keep: bundle.blocks, css: PRINT_CSS })})`)) as {
    figures: Array<{ id: string; desc: string }>;
    links: number;
    text: string;
  };
  if (result.links !== 0) throw new Error(`${bundle.pdf}: ${result.links} links remain.`);
  // The page shows the SVG of the last site build. Warn when the SVG file is newer than the build.
  for (const f of result.figures) {
    const n = Number(f.id.replace('figure-', ''));
    const src = bundle.figures.find((s) => s.n === n && s.main);
    const text = src ? sources.get(src.src) : undefined;
    if (text === undefined) continue;
    const desc = (await page.evaluate(`(${SVG_DESC_JS})(${JSON.stringify(text)})`)) as string;
    if (desc.trim() !== f.desc.trim()) {
      console.warn(`  Warning: ${f.id} on the page is not the same as ${src?.src}. Run "npm run site:build" and restart the server.`);
    }
  }
  await page.evaluate('document.fonts.ready');
  await page.pdf({
    path: outFile,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
  });
}

function readme(made: Map<string, string[]>, base: string, dpiUsed: Set<number>, commit: string, dirty: boolean): string {
  const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const lines = [
    '# Carbon balance figures',
    '',
    'This folder holds the carbon balance figures of two Deep Dives of the INAR agri project, for use in',
    'reports and presentations. `scripts/export-carbon-balances.ts` writes all files in this folder',
    '(`npm run export:carbon-balances`). Do not edit the files by hand: the next run removes them.',
    '',
    `- Date: ${date}`,
    `- Git commit: \`${commit || 'unknown'}\`${dirty ? ' (with uncommitted changes)' : ''}`,
    `- PNG resolution: ${[...dpiUsed].sort((a, b) => b - a).join(', ')} dpi, transparent background`,
    `- Site address used for the PDFs: ${base}`,
    '',
    'Each subfolder has three types of files:',
    '',
    '- **PDF**: a part of the Deep Dive page (A4). It has the title, the facts box, the question, the figures of',
    '  the folder with their captions and text descriptions, the result text of the figures and the references.',
    '  It has no links.',
    '- **SVG**: the figure files of the analysis scripts, not changed. The text in the SVG is text (you can select',
    '  and search it). Each SVG has its caption in `<title>` and its text description in `<desc>`.',
    '- **PNG** (`images/`): the same figures as images. The background of the figure is transparent; label boxes',
    '  and legend frames stay white.',
    '',
    'File names: `figure-<n>-<name>[-<variant>]`. `<n>` is the figure number in the Deep Dive. A variant is not on',
    'the Deep Dive page: `no-labels` has no site-year labels, `wide` has a wide layout, `no-nee` has no NEE points.',
    '',
  ];
  for (const b of BUNDLES) {
    const files = made.get(b.folder) ?? [];
    lines.push(`## ${b.folder}/`, '', `${b.title}.`, '', b.about, '');
    lines.push(`Source: Deep Dive page \`/deep-dive/${b.slug}/\` (figures ${[...new Set(b.figures.map((f) => f.n))].join(', ')}),`);
    lines.push(`SVG sources in \`${b.figures[0]?.src.replace(/\/[^/]*$/, '/')}\`.`, '');
    for (const f of files) lines.push(`- \`${f}\``);
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  let opts;
  try {
    opts = parseArgs({
      options: {
        url: { type: 'string' },
        dpi: { type: 'string', default: String(DEFAULT_DPI) },
        'skip-missing': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\nRun with --help for the options.`, 2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const dpi = Number(opts.dpi);
  if (!(Number.isInteger(dpi) && dpi >= 72 && dpi <= 1200)) fail('--dpi must be an integer from 72 to 1200.', 2);
  const skipMissing = opts['skip-missing'];

  // Check the sources before the work starts.
  const sources = new Map<string, string>();
  const absent: string[] = [];
  for (const b of BUNDLES) {
    for (const f of b.figures) {
      if (!existsSync(f.src)) absent.push(f.src);
      else sources.set(f.src, await readFile(f.src, 'utf8'));
    }
  }
  if (absent.length > 0) {
    const list = absent.map((p) => `  ${p}`).join('\n');
    if (!skipMissing) fail(`These SVG sources are missing:\n${list}\nMake them first, or run with --skip-missing.`, 1);
    console.warn(`Warning: these SVG sources are missing and are skipped:\n${list}`);
  }

  const base = new URL(opts.url ?? DEFAULT_URL);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  if (!(await reachable(base.toString()))) {
    const hint =
      opts.url === undefined
        ? '\nStart the site first, in a second shell or in the background:\n' +
          '  npm run site:build && npm run site:preview -- --ignore-lock\n' +
          '(Astro 7.4 sends "astro preview" to the background for AI agents. That mode fails with --root site.\n' +
          '--ignore-lock keeps the server in the foreground.) Or give the site address with --url.'
        : '';
    fail(`No server answers at ${base.toString()}.${hint}`, 2);
  }

  // Remove the old files of this folder only.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const made = new Map<string, string[]>();
  const dpiUsed = new Set<number>();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, colorScheme: 'light' });
    const page = await context.newPage();
    for (const b of BUNDLES) {
      const dir = join(OUT_DIR, b.folder);
      await mkdir(join(dir, 'images'), { recursive: true });
      const files: string[] = [];
      console.log(`${b.folder}/`);

      const pdfPath = join(dir, b.pdf);
      await makePdf(page, new URL(`deep-dive/${b.slug}/`, base).toString(), b, pdfPath, sources);
      files.push(b.pdf);
      console.log(`  ${b.pdf} (${((await stat(pdfPath)).size / 1024).toFixed(0)} KiB)`);

      for (const f of b.figures) {
        const svg = sources.get(f.src);
        if (svg === undefined) continue;
        await copyFile(f.src, join(dir, `${f.name}.svg`));
        files.push(`${f.name}.svg`);
        const { png, dpi: used } = await renderPng(browser, svg, dpi);
        dpiUsed.add(used);
        const pngRel = `images/${f.name}.png`;
        await writeFile(join(dir, pngRel), png);
        files.push(pngRel);
        const [w, h] = pngSize(png);
        console.log(`  ${f.name}.svg, ${pngRel} (${w} x ${h} px, ${used} dpi, ${(png.length / 1024).toFixed(0)} KiB)`);
      }
      made.set(b.folder, files);
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const commit = git(['rev-parse', '--short', 'HEAD']);
  const dirty = git(['status', '--porcelain']) !== '';
  const readmePath = join(OUT_DIR, 'README.md');
  await writeFile(readmePath, readme(made, base.toString(), dpiUsed, commit, dirty), 'utf8');
  console.log(`Done: ${relative('.', readmePath)}`);
  if (absent.length > 0) console.warn(`${absent.length} missing sources were skipped.`);
}

main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err), 1));
