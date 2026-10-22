// Build-time SVG charts of the Deep Dives (ECharts server-side rendering, as budgetFigure.ts).
// The page needs no client script for a figure. deep-dive.css replaces the text colour and the
// sentinel colour INK with the page tokens, so a figure reads in light and in dark mode.
import * as echarts from 'echarts';

/** Okabe-Ito colours of the website (EXPORT_SERIES in site/src/scripts/theme.ts, light values). */
export const SERIES = ['#0072b2', '#e69f00', '#56b4e9', '#cc79a7', '#000000', '#d55e00', '#009e73', '#6b5a00'] as const;
/**
 * Sentinel colour for "text colour" marks (lines, symbols, bands). deep-dive.css maps it to
 * --text-primary. The black series colour (slot 4) also uses it, because black does not read on the
 * dark background.
 */
export const INK = '#7a7974';
export const AXIS = '#8a8984';
/** Sentinel colour for a box background (for example a statistics box). deep-dive.css maps it to --surface-raised. */
export const SURFACE = '#fcfcfb';
export const FONT = 'system-ui, sans-serif';

/** Colours of the carbon fluxes, as in the budget diagram: NEE text colour, GPP blue, Reco orange. */
export const FLUX_COLOR = { nee: INK, gpp: SERIES[0], reco: SERIES[1] } as const;
/** Line dash of the fluxes, so that colour is not the only cue. */
export const FLUX_DASH: Record<'nee' | 'gpp' | 'reco', 'solid' | number[]> = { nee: 'solid', gpp: [8, 4], reco: [2, 3] };
/** Symbol of the fluxes in point charts. */
export const FLUX_SYMBOL = { nee: 'circle', gpp: 'rect', reco: 'triangle' } as const;

/** Site symbols in the order of sites.parquet (the same list as SITE_SYMBOLS in diagrams/common.ts). */
const SITE_SYMBOLS = ['circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin'] as const;

/** Site colour of slot `i` (position in sites.parquet), as siteColors() of the data page. */
export function siteColor(slot: number): string {
  const c = SERIES[slot % SERIES.length]!;
  return c === '#000000' ? INK : c;
}

export function siteSymbol(slot: number): string {
  return SITE_SYMBOLS[slot % SITE_SYMBOLS.length]!;
}

/** Text with a true minus sign. */
export const minus = (s: string | number): string => String(s).replace(/-/g, '−');

/** Render an ECharts option to a responsive, accessible SVG string. */
export function renderSvg(option: echarts.EChartsOption, width: number, height: number, label: string): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  let svg: string;
  try {
    chart.setOption({ animation: false, textStyle: { fontFamily: FONT }, ...option });
    svg = chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
  const escaped = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return svg.replace(/ ecmeta_[a-z_]+="[^"]*"/g, '').replace(/^<svg\b[^>]*>/, (tag) =>
    tag
      .replace(/\s(width|height|viewBox|role|aria-label|class)="[^"]*"/g, '')
      .replace(/<svg\b/, `<svg width="100%" viewBox="0 0 ${width} ${height}"`)
      .replace(/>$/, ` role="img" aria-label="${escaped}" class="dd-chart">`),
  );
}

/** Equal value range for panels: includes zero, rounded out to a nice tick interval (about `ticks` ticks). */
export function niceRange(values: readonly number[], ticks = 6): { min: number; max: number; interval: number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const raw = (hi - lo) / ticks || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const interval = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  return { min: Math.floor(lo / interval) * interval, max: Math.ceil(hi / interval) * interval, interval };
}

export interface PanelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Panel boxes in a grid of `cols` columns, filled row by row. */
export function panelGrid(count: number, cols: number, width: number, margin: { left: number; right: number; top: number; bottom: number }, gap: { x: number; y: number }, panelHeight: number): PanelBox[] {
  const w = (width - margin.left - margin.right - gap.x * (cols - 1)) / cols;
  return Array.from({ length: count }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return { left: margin.left + c * (w + gap.x), top: margin.top + r * (panelHeight + gap.y), width: w, height: panelHeight };
  });
}

/** Total height of a `panelGrid` figure. */
export function gridHeight(count: number, cols: number, margin: { top: number; bottom: number }, gapY: number, panelHeight: number): number {
  const rows = Math.ceil(count / cols);
  return margin.top + rows * panelHeight + (rows - 1) * gapY + margin.bottom;
}
