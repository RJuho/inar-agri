// Scatter as an Anscombe quartet: the x variable of the view against each other selected
// variable, as small multiples. One block of panels per y variable, one panel per site, 2 columns
// (as the 2 × 2 figure of Anscombe 1973). Each panel has the points, the ordinary least squares
// (OLS) line and a box with the statistics. All panels of a block use the same x and y range, so
// that the panels compare directly. The statistics come from SQL over all rows of the site; the
// points are a repeatable reservoir sample of 20 000 rows, as in scatter.
import * as echarts from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GraphicComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import { fixedRange, type NiceRange } from '../axisRanges';
import type { Aggregation, Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, stepExpr, whereClause } from './sql';
import {
  FIXED_GRID,
  X_NAME_SPACE,
  axisExtent,
  axisName,
  baseOption,
  displayUnit,
  emptyNote,
  esc,
  gridLeftFor,
  groupDigits,
  joinSubtitle,
  nameLines,
  niceRange,
  panelTitle,
  signNote,
  siteColors,
  siteLegend,
  siteNames,
  siteSlots,
  siteSymbol,
  statText,
  tickLabelWidth,
  titleStyle,
  tooltipBase,
  valueAxis,
  valueWithUnit,
  varLabel,
  xAxisName,
  yAxisName,
  zeroLineSeries,
} from './common';

echarts.use([ScatterChart, LineChart, GraphicComponent]);

const SAMPLE_ROWS = 20_000;
/** At most this number of panels (y variables × sites). */
export const MAX_PANELS = 36;
/** x variables with a daytime filter: rows with x > 0 only (as in the response curve). */
const DAYTIME_X: ReadonlySet<Variable> = new Set<Variable>(['ppfd', 'sw_in']);
/**
 * Layout in px. `block` is the head of a block (variable title), `head` the site title of a panel,
 * `xLabels` the space below each panel for the tick labels and the x axis name.
 */
const L = { legend: 30, block: 30, head: 22, panel: 200, xLabels: X_NAME_SPACE + 4, left: 56, right: 16, gapX: 24 };
/** Font and line height of the statistics box. */
const STATS_FONT_SIZE = 11;
const STATS_LINE = 14;

/** Statistics of one site and one y variable, over all rows (not the sample). */
export interface PairStats {
  /** Number of pairs with x and y. */
  n: number;
  meanX: number;
  meanY: number;
  varX: number;
  varY: number;
  /** Pearson correlation. */
  r: number;
  /** OLS line y = intercept + slope x. */
  slope: number;
  intercept: number;
  r2: number;
}

/** Statistic keys and their SQL column suffix. */
const STAT_COLS: ReadonlyArray<[keyof PairStats, string]> = [
  ['n', 'n'],
  ['meanX', 'mx'],
  ['meanY', 'my'],
  ['varX', 'vx'],
  ['varY', 'vy'],
  ['r', 'r'],
  ['slope', 'b'],
  ['intercept', 'a'],
  ['r2', 'r2'],
];

interface SiteData {
  siteId: number;
  /** Sampled points per y variable: [x, y] pairs with finite values. */
  points: Partial<Record<Variable, Array<[number, number]>>>;
  stats: Partial<Record<Variable, PairStats>>;
}

interface AnscombeData extends Prepared {
  x: Variable;
  ys: Variable[];
  aggregation: Aggregation;
  daytime: boolean;
  /** Sites with rows, in the order of sites.parquet. */
  sites: SiteData[];
}

/** Text for the rows of each step. */
const STEP_TEXT: Record<Aggregation, string> = {
  raw: '30-minute values',
  day: 'daily means',
  week: 'weekly means',
  month: 'monthly means',
};

const yVars = (params: ViewParams) => params.variables.filter((v) => v !== params.xVariable);

/** SQL: the sample rows (kind 0) and one row of statistics per site (kind 1). */
function query(params: ViewParams): string | null {
  const where = whereClause(params);
  const ys = yVars(params).map(col);
  if (where === null || ys.length === 0 || ys.length * params.sites.length > MAX_PANELS) return null;
  const x = col(params.xVariable);
  const day = DAYTIME_X.has(params.xVariable) ? ` AND ${x} > 0` : '';
  const anyY = ys.map((v) => `${v} IS NOT NULL`).join(' OR ');
  // The same source rows as scatter: 30-minute rows, or means per local day, ISO week or month.
  const src =
    params.aggregation === 'raw'
      ? `SELECT site_id, ${x} AS x, ${ys.join(', ')} FROM obs WHERE ${where} AND ${x} IS NOT NULL${day} AND (${anyY})`
      : `SELECT site_id, ${stepExpr(x)} AS x, ${ys.map((v) => `${stepExpr(v)} AS ${v}`).join(', ')} FROM obs
         WHERE ${where}${day} GROUP BY site_id, date_trunc('${params.aggregation}', tl)
         HAVING ${stepExpr(x)} IS NOT NULL`;
  // Statistics of the pairs where x and y have a value. corr() and regr_*() skip the other rows.
  const stats = ys.map((v) =>
    [
      `count(${v})::DOUBLE AS ${v}__n`,
      `(avg(x) FILTER (WHERE ${v} IS NOT NULL))::DOUBLE AS ${v}__mx`,
      `avg(${v})::DOUBLE AS ${v}__my`,
      `(var_samp(x) FILTER (WHERE ${v} IS NOT NULL))::DOUBLE AS ${v}__vx`,
      `var_samp(${v})::DOUBLE AS ${v}__vy`,
      `corr(${v}, x)::DOUBLE AS ${v}__r`,
      `regr_slope(${v}, x)::DOUBLE AS ${v}__b`,
      `regr_intercept(${v}, x)::DOUBLE AS ${v}__a`,
      `regr_r2(${v}, x)::DOUBLE AS ${v}__r2`,
    ].join(', '),
  );
  return `WITH src AS (${src}),
    pts AS (SELECT * FROM (SELECT * FROM src) USING SAMPLE reservoir(${SAMPLE_ROWS} ROWS) REPEATABLE (1)),
    st AS (SELECT site_id, ${stats.join(', ')} FROM src GROUP BY site_id)
    SELECT * FROM (
      SELECT 0::DOUBLE AS kind, site_id::DOUBLE AS site_id, x::DOUBLE AS x, ${ys.map((v) => `${v}::DOUBLE AS ${v}`).join(', ')} FROM pts
      UNION ALL BY NAME
      SELECT 1::DOUBLE AS kind, site_id::DOUBLE AS site_id, ${ys.map((v) => STAT_COLS.map(([, s]) => `${v}__${s}`).join(', ')).join(', ')} FROM st
    ) ORDER BY kind, site_id`;
}

function prepare(table: Table | null, params: ViewParams, meta: Meta): AnscombeData {
  const ys = yVars(params);
  const daytime = DAYTIME_X.has(params.xVariable);
  const base = { x: params.xVariable, ys, aggregation: params.aggregation, daytime, sites: [] as SiteData[] };
  if (table === null) {
    let note = emptyNote(params);
    if (params.sites.length > 0 && ys.length === 0) {
      note = `The Anscombe quartet needs one more variable than the x variable (${varLabel(params.xVariable)}). Select an other variable.`;
    } else if (ys.length * params.sites.length > MAX_PANELS) {
      note = `The Anscombe quartet shows at most ${MAX_PANELS} panels (variables × sites). Select fewer variables or sites.`;
    }
    return { ...base, rowCount: 0, seriesCount: 0, note };
  }
  const n = table.numRows;
  const read = (name: string) => toFloat64(table.getChild(name), n);
  const kind = read('kind');
  const site = read('site_id');
  const xs = read('x');
  const bySite = new Map<number, SiteData>();
  const entry = (id: number) => {
    let e = bySite.get(id);
    if (!e) {
      e = { siteId: id, points: {}, stats: {} };
      bySite.set(id, e);
    }
    return e;
  };
  let points = 0;
  for (const v of ys) {
    const vals = read(v);
    const cols = STAT_COLS.map(([key, s]) => [key, read(`${v}__${s}`)] as const);
    for (let i = 0; i < n; i++) {
      const e = entry(site[i] as number);
      if (kind[i] === 0) {
        const a = xs[i] as number;
        const b = vals[i] as number;
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        (e.points[v] ??= []).push([a, b]);
        points++;
      } else {
        const st = {} as PairStats;
        for (const [key, c] of cols) st[key] = c[i] as number;
        if (st.n > 0) e.stats[v] = st;
      }
    }
  }
  // Panels in the order of sites.parquet.
  const order = new Map(meta.sites.map((s, i) => [s.siteId, i]));
  const sites = [...bySite.values()].sort((a, b) => (order.get(a.siteId) ?? 0) - (order.get(b.siteId) ?? 0));
  let seriesCount = 0;
  let enough = false;
  for (const s of sites) {
    for (const v of ys) {
      if (s.points[v]?.length) seriesCount++;
      if ((s.stats[v]?.n ?? 0) >= 2) enough = true;
    }
  }
  const sampleRows = kind.filter((k) => k === 0).length;
  const step = STEP_TEXT[params.aggregation];
  const data: AnscombeData = {
    ...base,
    sites,
    rowCount: sampleRows,
    seriesCount,
    subtitle: joinSubtitle(
      `x = ${varLabel(params.xVariable)}. Points: ${sampleRows >= SAMPLE_ROWS ? `random sample of ${groupDigits(SAMPLE_ROWS)} ${step}` : `all ${step}`}. ` +
        `Statistics and dashed OLS line (over the x range of the points): all ${step} of the site. Same x and y range in all panels of a variable.`,
      daytime ? `Daytime rows only (${varLabel(params.xVariable)} > 0).` : undefined,
      signNote([params.xVariable, ...ys]),
    ),
  };
  if (points === 0) data.note = 'No data for these sites and years.';
  else if (!enough) data.note = 'Each panel has fewer than 2 points. Select more years, a shorter step or other sites.';
  return data;
}

function columns(width: number, n: number): number {
  return width >= 640 && n > 1 ? 2 : 1;
}

function blockHeight(nSites: number, width: number): number {
  return L.block + Math.ceil(nSites / columns(width, nSites)) * (L.head + L.panel + L.xLabels);
}

function totalHeight(nY: number, nSites: number, width: number): number {
  if (nY === 0 || nSites === 0) return 160;
  return L.legend + nY * blockHeight(nSites, width);
}

/** Min and max of a list of values. null when there are none. */
function extentOf(values: Iterable<number>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

function* pointValues(data: AnscombeData, v: Variable, axis: 0 | 1): Generator<number> {
  for (const s of data.sites) for (const p of s.points[v] ?? []) yield p[axis];
}

/**
 * Shared ranges: the fixed range of all data when the view option is on, else the nice range of
 * the points of all panels. The x range is the same in all blocks.
 */
function ranges(data: AnscombeData, params: ViewParams) {
  const auto = (e: [number, number] | null): NiceRange => niceRange(e ?? [0, 1]);
  const xAll = extentOf(data.ys.flatMap((v) => [...pointValues(data, v, 0)]));
  const x = fixedRange(params, 'step', data.x, data.aggregation) ?? auto(xAll);
  const y = data.ys.map((v) => fixedRange(params, 'step', v, data.aggregation) ?? auto(extentOf(pointValues(data, v, 1))));
  return { x, y };
}

/** Number text with 3 significant digits, for example 0.0123, 4.21, 1 230 or −0.5. */
export function statValue(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const s = Number(v.toPrecision(3));
  const t = Math.abs(s) >= 1e4 || (s !== 0 && Math.abs(s) < 1e-3) ? s.toExponential(2) : String(s);
  return t.replace('-', '−');
}

/** Lines of the statistics box. */
export function statsLines(st: PairStats): string[] {
  const sign = st.intercept < 0 ? '−' : '+';
  return [
    `n = ${groupDigits(st.n)}`,
    `mean x = ${statValue(st.meanX)}, mean y = ${statValue(st.meanY)}`,
    `var x = ${statValue(st.varX)}, var y = ${statValue(st.varY)}`,
    `r = ${statValue(st.r)}, R² = ${statValue(st.r2)}`,
    `y = ${statValue(st.slope)} x ${sign} ${statValue(Math.abs(st.intercept))}`,
  ];
}

function layout(data: AnscombeData, ctx: BuildContext) {
  const r = ranges(data, ctx.params);
  const names = data.ys.map((v) => axisName(ctx.meta, v, L.panel));
  const widths = data.ys.map((v, i) => tickLabelWidth(axisExtent(v, r.y[i], [0, 1]), 4));
  const left = Math.max(L.left, ...names.map((n, i) => gridLeftFor(widths[i] as number, nameLines(n))));
  const cols = columns(ctx.width, data.sites.length);
  const panelW = (Math.max(ctx.width, 200) - left - L.right - (cols - 1) * (L.gapX + left)) / cols;
  return { ...r, names, widths, left, cols, panelW };
}

function build(data: AnscombeData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta, params } = ctx;
  const colors = siteColors(meta, tokens);
  const slots = siteSlots(meta);
  const names = siteNames(meta, params);
  const lay = layout(data, ctx);
  const xUnit = displayUnit(meta, data.x);
  const xName = axisName(meta, data.x, lay.panelW);
  const [x0, x1] = axisExtent(data.x, lay.x, [0, 1]);
  const grid: unknown[] = [];
  const title: unknown[] = [];
  const xAxis: unknown[] = [];
  const yAxis: unknown[] = [];
  const series: unknown[] = [];
  const zero: unknown[] = [];
  const graphic: unknown[] = [];
  /** For each series index: the y variable of a point series, or null for an OLS line. */
  const pointsOf: Array<Variable | null> = [];
  const blockH = blockHeight(data.sites.length, ctx.width);
  const edge = { axisLine: { show: true, onZero: false, lineStyle: { color: tokens.axis } } };
  data.ys.forEach((v, bi) => {
    const blockTop = L.legend + bi * blockH;
    title.push({ top: blockTop + 4, left: lay.left - 8, text: panelTitle(v, statText(v, data.aggregation)), textStyle: titleStyle(tokens) });
    const yExtent = axisExtent(v, lay.y[bi], [0, 1]);
    data.sites.forEach((s, si) => {
      const gi = bi * data.sites.length + si;
      const r = Math.floor(si / lay.cols);
      const c = si % lay.cols;
      const top = blockTop + L.block + r * (L.head + L.panel + L.xLabels) + L.head;
      const left = lay.left + c * (lay.panelW + L.gapX + lay.left);
      const name = names.get(s.siteId) ?? String(s.siteId);
      const color = colors.get(s.siteId) ?? tokens.text;
      grid.push({ top, left, width: lay.panelW, height: L.panel, ...FIXED_GRID });
      title.push({ top: top - 18, left: left - 8, text: name, textStyle: titleStyle(tokens, 12) });
      xAxis.push(valueAxis(tokens, gi, { splitNumber: 4, ...edge, ...xAxisName(tokens, xName) }, data.x, lay.x));
      yAxis.push(valueAxis(tokens, gi, { splitNumber: 4, ...edge, ...yAxisName(tokens, lay.names[bi] as string, lay.widths[bi] as number) }, v, lay.y[bi]));
      const pts = s.points[v] ?? [];
      if (pts.length) {
        pointsOf.push(v);
        series.push({
          type: 'scatter',
          name,
          xAxisIndex: gi,
          yAxisIndex: gi,
          color,
          // Symbol per site, so that the sites differ also without colour.
          symbol: siteSymbol(slots.get(s.siteId) ?? si),
          symbolSize: 5,
          itemStyle: { opacity: 0.5 },
          emphasis: { itemStyle: { opacity: 1, borderColor: tokens.surface, borderWidth: 2 }, scale: 2 },
          data: pts,
        });
      }
      const st = s.stats[v];
      if (st && st.n >= 2 && Number.isFinite(st.slope) && Number.isFinite(st.intercept)) {
        // OLS line over the x range of the points of the site (no extrapolation). The grid clips it at the y range.
        const [a, b] = extentOf(pts.map((p) => p[0])) ?? [x0, x1];
        pointsOf.push(null);
        series.push({
          type: 'line',
          name,
          xAxisIndex: gi,
          yAxisIndex: gi,
          data: [
            [a, st.intercept + st.slope * a],
            [b, st.intercept + st.slope * b],
          ],
          symbol: 'none',
          silent: true,
          tooltip: { show: false },
          lineStyle: { color: tokens.text, width: 1.5, type: 'dashed' },
          z: 4,
        });
      }
      graphic.push({
        type: 'text',
        id: `anscombe-stats-${bi}-${s.siteId}`,
        silent: true,
        z: 100,
        left: left + 6,
        top: top + 6,
        style: {
          text: st && st.n >= 2 ? statsLines(st).join('\n') : 'Fewer than 2 points',
          fontSize: STATS_FONT_SIZE,
          lineHeight: STATS_LINE,
          fontFamily: 'system-ui, sans-serif',
          fill: tokens.text,
          backgroundColor: tokens.surface,
          borderColor: tokens.grid,
          borderWidth: 1,
          padding: [3, 5],
          borderRadius: 2,
          opacity: 0.92,
        },
      });
      const z = zeroLineSeries(meta, tokens, v, gi, yExtent);
      if (z) zero.push(z);
    });
  });
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, params, tokens, new Set(data.sites.map((s) => s.siteId)), lay.left, L.right, 'symbol'),
    title,
    grid,
    xAxis,
    yAxis,
    graphic,
    tooltip: {
      ...tooltipBase(tokens, 'item'),
      formatter: (p: { seriesIndex: number; seriesName: string; marker: string; value: number[] }) => {
        const v = pointsOf[p.seriesIndex];
        if (!v) return '';
        return (
          `${p.marker}<b>${esc(p.seriesName)}</b><br/>` +
          `${esc(varLabel(data.x))}: ${valueWithUnit(p.value[0] as number, xUnit)}<br/>` +
          `${esc(varLabel(v))}: ${valueWithUnit(p.value[1] as number, displayUnit(meta, v))}`
        );
      },
    },
    // The zero lines come after all data series, so they do not change the series index.
    series: [...series, ...zero],
  };
}

function describe(data: AnscombeData, meta: Meta, params: ViewParams): string {
  const names = siteNames(meta, params);
  const parts = data.ys.map((v) => {
    const per = data.sites
      .filter((s) => (s.stats[v]?.n ?? 0) >= 2)
      .map((s) => `${names.get(s.siteId) ?? s.siteId}: ${statsLines(s.stats[v] as PairStats).join(', ')}`);
    return per.length ? `${varLabel(v)}: ${per.join('; ')}.` : '';
  });
  return (
    `Anscombe quartet of ${varLabel(data.x)} (x axis) against each other variable: one block of panels per variable, ` +
    `one panel per site, with the points (${groupDigits(data.rowCount)} in the sample), the dashed ordinary least squares line ` +
    `and the statistics of all ${STEP_TEXT[data.aggregation]}${data.daytime ? ' (daytime rows only)' : ''}. ` +
    `${parts.filter(Boolean).join(' ') || 'No statistics.'} ` +
    'Equal statistics can hide different patterns: compare the points of the panels, not only the numbers.'
  );
}

export const anscombe: DiagramDef<AnscombeData> = {
  type: 'anscombe',
  label: 'Scatter — Anscombe quartet',
  query,
  prepare,
  build,
  widthDependent: true,
  showsEvents: false,
  height: (params, data, width) => totalHeight(yVars(params).length, data && !data.note ? data.sites.length : params.sites.length, width),
  statsVariables: (params) => [params.xVariable, ...yVars(params)],
  describe: (data, ctx) => describe(data, ctx.meta, ctx.params),
};
