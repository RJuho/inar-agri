// Static figure "Annual carbon balance per site and year" for the Calculated page.
// ECharts renders the SVG at build time in Node (server-side rendering). The page then
// needs no client script for the figure. The style follows Hu et al. 2024 Fig. 2 to 3 and
// Heimsch et al. 2021: one group of bars per site and year.
//
// Sign convention of the figure: a value above zero is carbon that leaves the field
// (to the atmosphere or in the harvest). A value below zero is carbon that enters the field.
// Thus GPP and C_exo are drawn negative, Reco and C_harvest positive, and the NECB diamond
// is drawn at −NECB (necb.csv gives NECB positive = gain).
import * as echarts from 'echarts';
import type { Row } from './csv';

/** One site and year of the figure. Null = no value. */
export interface BudgetRow {
  site: string;
  siteCode: string;
  year: number;
  /** False = the annual NEE sum is not reliable (low measured fraction or long gap). */
  reliable: boolean;
  gpp: number | null;
  reco: number | null;
  nee: number | null;
  cHarvest: number | null;
  cExo: number | null;
  /** NECB, positive = the field gains carbon (as in necb.csv). */
  necb: number | null;
  necbComplete: boolean;
}

export interface BudgetFigure {
  /** The SVG element, responsive (`width="100%"` with `viewBox`). */
  svg: string;
  /** One sentence for the figcaption and the aria-label. */
  summary: string;
  rows: BudgetRow[];
}

// Colours of the carbon terms. They are the categorical slots of global.css (light values).
// A mid-tone reads on the light and the dark background. The text colour is not fixed here:
// calculated.css overrides the `fill` of all text elements with the page tokens.
const COLOR = {
  gpp: '#1baf7a',
  reco: '#eb6834',
  nee: '#2a78d6',
  harvest: '#eda100',
  exo: '#6250d6',
  // Sentinel colour of the NECB marker. calculated.css maps it to the text colour.
  necb: '#7a7974',
  axis: '#8a8984',
  grid: '#8a8984',
  text: '#555555',
};
const FONT = 'system-ui, sans-serif';
/** Opacity of the bars of a year that is not reliable. */
const UNRELIABLE_OPACITY = 0.45;

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * Join annual.csv and necb.csv into the rows of the figure.
 * Keeps full calendar years that have an annual NEE sum. Sorts by site order, then year.
 */
export function budgetRows(annual: Row[], necb: Row[], siteNames: Record<string, string>): BudgetRow[] {
  const order = Object.keys(siteNames);
  const necbByKey = new Map(necb.map((r) => [`${r.site_code}|${r.year}`, r]));
  const rows: BudgetRow[] = [];
  for (const a of annual) {
    const code = a.site_code ?? '';
    const year = Number(a.year);
    const nee = num(a.nee_f_gc);
    if (a.full_year !== 'true' || nee === null || !order.includes(code)) continue;
    const n = necbByKey.get(`${code}|${a.year}`);
    rows.push({
      site: siteNames[code] ?? code,
      siteCode: code,
      year,
      reliable: a.reliable === 'true',
      gpp: num(a.gpp_gc),
      reco: num(a.reco_gc),
      nee,
      cHarvest: num(n?.c_harvest),
      cExo: num(n?.c_exo),
      necb: num(n?.necb),
      necbComplete: n?.necb_complete === 'true',
    });
  }
  return rows.sort((a, b) => order.indexOf(a.siteCode) - order.indexOf(b.siteCode) || a.year - b.year);
}

/** Category list: the years of each site, with one empty category between the sites. */
function categories(rows: BudgetRow[]): { labels: string[]; index: Map<BudgetRow, number>; groups: { site: string; from: number; to: number }[] } {
  const labels: string[] = [];
  const index = new Map<BudgetRow, number>();
  const groups: { site: string; from: number; to: number }[] = [];
  let lastSite: string | null = null;
  for (const r of rows) {
    if (lastSite !== null && r.site !== lastSite) labels.push('');
    if (r.site !== lastSite) groups.push({ site: r.site, from: labels.length, to: labels.length });
    index.set(r, labels.length);
    labels.push(r.reliable ? String(r.year) : `${r.year}*`);
    groups[groups.length - 1]!.to = labels.length - 1;
    lastSite = r.site;
  }
  return { labels, index, groups };
}

const SIGN_TEXT = 'Above zero: carbon leaves the field. Below zero: carbon enters the field.';

/**
 * Render the figure. Returns the SVG string (responsive), a summary sentence and the rows.
 * `width` and `height` are the design size in CSS pixels; the SVG scales with its container.
 */
export function budgetFigure(rows: BudgetRow[], width = 1200, height = 520): BudgetFigure {
  const { labels, index, groups } = categories(rows);
  const n = labels.length;
  const grid = { left: 76, right: 20, top: 64, bottom: 72 };
  const gridW = width - grid.left - grid.right;
  const bandPx = gridW / Math.max(n, 1);
  const barW = Math.max(4, Math.round(0.32 * bandPx));
  // Two bar stacks per group, barGap 20 % of the bar width. The marker x positions (on a hidden
  // value axis in band units) are the centres of the two stacks.
  const dx = (0.6 * barW) / bandPx;

  type Pt = { value: [number, number]; itemStyle?: Record<string, unknown> };
  const bar = (key: 'gpp' | 'reco' | 'cHarvest' | 'cExo', sign: 1 | -1) =>
    rows.map((r): Pt | null => {
      const v = r[key];
      if (v === null) return null;
      const pt: Pt = { value: [index.get(r)!, sign * v] };
      if (!r.reliable) pt.itemStyle = { opacity: UNRELIABLE_OPACITY };
      return pt;
    }).filter((p): p is Pt => p !== null);
  const marker = (get: (r: BudgetRow) => number | null, offset: number, keep: (r: BudgetRow) => boolean) =>
    rows.flatMap((r): Pt[] => {
      const v = get(r);
      if (v === null || !keep(r)) return [];
      const pt: Pt = { value: [index.get(r)! + offset, v] };
      if (!r.reliable) pt.itemStyle = { opacity: UNRELIABLE_OPACITY + 0.2 };
      return [pt];
    });

  const barBase = {
    type: 'bar' as const,
    barWidth: barW,
    barGap: '20%',
    xAxisIndex: 0,
    yAxisIndex: 0,
    emphasis: { disabled: true },
  };
  const markerBase = {
    type: 'scatter' as const,
    xAxisIndex: 1,
    yAxisIndex: 0,
    symbolSize: 9,
    itemStyle: { opacity: 1 },
    z: 5,
    emphasis: { disabled: true },
  };

  const option: echarts.EChartsOption = {
    animation: false,
    textStyle: { fontFamily: FONT, color: COLOR.text },
    grid: { ...grid, containLabel: false },
    legend: {
      top: 8,
      left: grid.left,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 18,
      textStyle: { fontSize: 12, color: COLOR.text },
      data: [
        { name: 'GPP (drawn negative)', icon: 'rect' },
        { name: 'Reco', icon: 'rect' },
        { name: 'NEE', icon: 'circle' },
        { name: 'C harvest', icon: 'rect' },
        { name: 'C exo (drawn negative)', icon: 'rect' },
        { name: '−NECB, complete', icon: 'diamond' },
        { name: '−NECB, lower bound or partial', icon: 'diamond' },
      ],
    },
    xAxis: [
      {
        type: 'category',
        data: labels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: COLOR.axis } },
        axisLabel: { interval: 0, fontSize: 11, color: COLOR.text, margin: 8 },
      },
      {
        // Hidden value axis in band units of the category axis, for the markers.
        type: 'value',
        min: -0.5,
        max: n - 0.5,
        show: false,
      },
    ],
    yAxis: {
      type: 'value',
      name: 'g C m⁻² yr⁻¹',
      nameLocation: 'middle',
      nameGap: 52,
      nameTextStyle: { fontSize: 12, color: COLOR.text },
      axisLabel: { fontSize: 11, color: COLOR.text, formatter: (v: number) => String(v).replace('-', '−') },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: COLOR.grid, opacity: 0.3 } },
    },
    series: [
      { ...barBase, name: 'Reco', stack: 'flux', color: COLOR.reco, data: bar('reco', 1) },
      { ...barBase, name: 'GPP (drawn negative)', stack: 'flux', color: COLOR.gpp, data: bar('gpp', -1) },
      { ...barBase, name: 'C harvest', stack: 'mgmt', color: COLOR.harvest, data: bar('cHarvest', 1) },
      { ...barBase, name: 'C exo (drawn negative)', stack: 'mgmt', color: COLOR.exo, data: bar('cExo', -1) },
      // Zero line, on top of the bars.
      {
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 0,
        data: [
          [-0.5, 0],
          [n - 0.5, 0],
        ],
        symbol: 'none',
        lineStyle: { color: COLOR.axis, width: 1 },
        silent: true,
        z: 4,
      },
      {
        ...markerBase,
        name: 'NEE',
        symbol: 'circle',
        color: COLOR.nee,
        data: marker((r) => r.nee, -dx, () => true),
      },
      {
        ...markerBase,
        name: '−NECB, complete',
        symbol: 'diamond',
        symbolSize: 11,
        color: COLOR.necb,
        data: marker((r) => (r.necb === null ? null : -r.necb), dx, (r) => r.necbComplete),
      },
      {
        ...markerBase,
        name: '−NECB, lower bound or partial',
        symbol: 'diamond',
        symbolSize: 11,
        color: COLOR.necb,
        itemStyle: { color: 'none', borderColor: COLOR.necb, borderWidth: 1.5, opacity: 1 },
        data: marker((r) => (r.necb === null ? null : -r.necb), dx, (r) => !r.necbComplete),
      },
    ],
    // Site names, centred below the years of each site.
    // `x` is the anchor of the text, and align: center puts the text around it.
    graphic: groups.map((g) => ({
      type: 'text',
      x: grid.left + ((g.from + g.to) / 2 + 0.5) * bandPx,
      y: height - grid.bottom + 30,
      style: {
        text: g.site,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: FONT,
        fill: COLOR.text,
        align: 'center',
        verticalAlign: 'top',
      },
      silent: true,
    })),
  };

  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  let svg: string;
  try {
    chart.setOption(option);
    svg = chart.renderToSVGString();
  } finally {
    chart.dispose();
  }

  const sites = new Set(rows.map((r) => r.site)).size;
  const summary = `${rows.length} site-years at ${sites} sites. ${SIGN_TEXT}`;
  return { svg: responsive(svg, width, height, summary), summary, rows };
}

/**
 * Make the SVG responsive and accessible: `width="100%"`, no fixed height, a `viewBox`,
 * `role="img"`, an `aria-label` and the class `budget-figure` for the CSS of the page.
 * Also removes the `ecmeta_*` attributes of the ECharts SSR mode (for client hydration, not used).
 */
function responsive(svg: string, width: number, height: number, label: string): string {
  const escaped = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return svg.replace(/ ecmeta_[a-z_]+="[^"]*"/g, '').replace(/^<svg\b[^>]*>/, (tag) => {
    let out = tag
      .replace(/\s(width|height|viewBox|role|aria-label|class)="[^"]*"/g, '')
      .replace(/<svg\b/, `<svg width="100%" viewBox="0 0 ${width} ${height}"`);
    out = out.replace(/>$/, ` role="img" aria-label="${escaped}" class="budget-figure">`);
    return out;
  });
}
