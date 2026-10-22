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
