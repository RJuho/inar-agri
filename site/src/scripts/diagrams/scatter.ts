// Scatter: the x variable of the view against each other selected variable.
// One panel per y variable, one colour per site. The query takes a repeatable
// reservoir sample of 20 000 rows, so that the chart stays fast.
import * as echarts from 'echarts/core';
import { ScatterChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import type { Aggregation, Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, stepExpr, whereClause } from './sql';
import {
  FIXED_GRID,
  statText,
  X_NAME_SPACE,
  axisName,
  baseOption,
  displayUnit,
  emptyNote,
  esc,
  formatValue,
  gridLeftFor,
  groupDigits,
  joinSubtitle,
  nameLines,
  panelTitle,
  signNote,
  siteColors,
  siteLegend,
  siteNames,
  tickLabelWidth,
  titleStyle,
  tooltipBase,
  valueAxis,
  varLabel,
  xAxisName,
  yAxisName,
} from './common';

echarts.use([ScatterChart]);

const SAMPLE_ROWS = 20_000;
/**
 * Layout in px. `xLabels` is the space below each panel for the tick labels and the x axis name.
 * `left` is the smallest left margin of a panel; `yLayout()` makes it larger for the y axis names.
 */
const L = { legend: 30, head: 30, panel: 260, xLabels: X_NAME_SPACE + 4, left: 56, right: 16, gapX: 24 };

interface ScatterData extends Prepared {
  x: Variable;
  ys: Variable[];
  aggregation: Aggregation;
  sites: Array<{ siteId: number; x: Float64Array; values: Partial<Record<Variable, Float64Array>> }>;
}

/** Text for the points of each step. */
const STEP_TEXT: Record<Aggregation, string> = {
  raw: '30-minute values',
  day: 'daily means',
  week: 'weekly means',
  month: 'monthly means',
};

const yVars = (params: ViewParams) => params.variables.filter((v) => v !== params.xVariable);

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  const ys = yVars(params).map(col);
  if (where === null || ys.length === 0) return null;
  const x = col(params.xVariable);
  const anyY = ys.map((v) => `${v} IS NOT NULL`).join(' OR ');
  const inner =
    params.aggregation === 'raw'
      ? `SELECT site_id, ${x} AS x, ${ys.join(', ')} FROM obs WHERE ${where} AND ${x} IS NOT NULL AND (${anyY})`
      : `SELECT site_id, ${stepExpr(x)} AS x, ${ys.map((v) => `${stepExpr(v)} AS ${v}`).join(', ')} FROM obs
         WHERE ${where} GROUP BY site_id, date_trunc('${params.aggregation}', tl)
         HAVING ${stepExpr(x)} IS NOT NULL`;
  return `SELECT site_id::DOUBLE AS site_id, x, ${ys.join(', ')}
    FROM (SELECT * FROM (${inner}) USING SAMPLE reservoir(${SAMPLE_ROWS} ROWS) REPEATABLE (1))
    ORDER BY site_id`;
}

function prepare(table: Table | null, params: ViewParams, _meta: Meta): ScatterData {
  const ys = yVars(params);
  const base = { x: params.xVariable, ys, aggregation: params.aggregation, sites: [] as ScatterData['sites'] };
  if (table === null) {
    const note =
      params.sites.length > 0 && ys.length === 0
        ? `Scatter needs one more variable than the x variable (${varLabel(params.xVariable)}). Select an other variable.`
        : emptyNote(params);
    return { ...base, rowCount: 0, seriesCount: 0, note };
  }
  const n = table.numRows;
  const site = toFloat64(table.getChild('site_id'), n);
  const x = toFloat64(table.getChild('x'), n);
  const cols = new Map(ys.map((v) => [v, toFloat64(table.getChild(v), n)]));
  const sites: ScatterData['sites'] = [];
  let start = 0;
  while (start < n) {
    let end = start;
    while (end < n && site[end] === site[start]) end++;
    const values: Partial<Record<Variable, Float64Array>> = {};
    for (const v of ys) values[v] = (cols.get(v) as Float64Array).slice(start, end);
    sites.push({ siteId: site[start] as number, x: x.slice(start, end), values });
    start = end;
  }
  let seriesCount = 0;
  for (const v of ys) for (const s of sites) if (s.values[v]?.some(Number.isFinite)) seriesCount++;
  const step = STEP_TEXT[params.aggregation];
  const data: ScatterData = {
    ...base,
    sites,
    rowCount: n,
    seriesCount,
    subtitle: joinSubtitle(
      `x = ${varLabel(params.xVariable)}. ${n >= SAMPLE_ROWS ? `Random sample of ${groupDigits(SAMPLE_ROWS)} ${step}.` : `All ${step}.`}`,
      signNote([params.xVariable, ...ys]),
    ),
  };
  if (n === 0) data.note = 'No data for these sites and years.';
  return data;
}

function columns(width: number, n: number): number {
  return width >= 760 && n > 1 ? 2 : 1;
}

function totalHeight(nY: number, width: number): number {
  if (nY === 0) return 160;
  const rows = Math.ceil(nY / columns(width, nY));
  return L.legend + rows * (L.head + L.panel + L.xLabels);
}

/** Min and max of the finite values of `v` in all sites. [0, 1] when there are none. */
function valueExtent(data: ScatterData, v: Variable): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of data.sites) {
    const a = s.values[v];
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const y = a[i] as number;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/**
 * Y axis names, tick label widths and the left margin of the panels. All panels use the same
 * left margin, so that the columns have the same width and line up.
 */
function yLayout(data: ScatterData, meta: Meta) {
  const names = data.ys.map((v) => axisName(meta, v, L.panel));
  const widths = data.ys.map((v) => tickLabelWidth(valueExtent(data, v), 4));
  const left = Math.max(L.left, ...names.map((n, i) => gridLeftFor(widths[i] as number, nameLines(n))));
  return { names, widths, left };
}

function build(data: ScatterData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta, ctx.params);
  const cols = columns(ctx.width, data.ys.length);
  const y = yLayout(data, meta);
  const panelW = (Math.max(ctx.width, 200) - y.left - L.right - (cols - 1) * (L.gapX + y.left)) / cols;
  const xUnit = displayUnit(meta, data.x);
  const xName = axisName(meta, data.x, panelW);
  const grid: unknown[] = [];
  const title: unknown[] = [];
  const xAxis: unknown[] = [];
  const yAxis: unknown[] = [];
  const series: unknown[] = [];
  const panelOf: Variable[] = [];
  data.ys.forEach((v, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const top = L.legend + r * (L.head + L.panel + L.xLabels) + L.head;
    const left = y.left + c * (panelW + L.gapX + y.left);
    grid.push({ top, left, width: panelW, height: L.panel, ...FIXED_GRID });
    // Panel label and statistic. The unit is in the y axis name.
    title.push({ top: top - 24, left: left - 8, text: panelTitle(v, statText(v, data.aggregation)), textStyle: titleStyle(tokens) });
    // The axis lines stay at the bottom and the left edge of the panel, not at 0.
    const edge = { axisLine: { show: true, onZero: false, lineStyle: { color: tokens.axis } } };
    xAxis.push(valueAxis(tokens, i, { splitNumber: 4, ...edge, ...xAxisName(tokens, xName) }, data.x));
    yAxis.push(valueAxis(tokens, i, { splitNumber: 4, ...edge, ...yAxisName(tokens, y.names[i] as string, y.widths[i] as number) }, v));
    data.sites.forEach((s, di) => {
      if (!s.values[v]?.some(Number.isFinite)) return;
      panelOf.push(v);
      series.push({
        type: 'scatter',
        name: names.get(s.siteId) ?? String(s.siteId),
        datasetIndex: di,
        encode: { x: 'x', y: v },
        xAxisIndex: i,
        yAxisIndex: i,
        color: colors.get(s.siteId),
        symbolSize: 4,
        itemStyle: { opacity: 0.45 },
        emphasis: { itemStyle: { opacity: 1, borderColor: tokens.surface, borderWidth: 2 }, scale: 2 },
      });
    });
  });
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, ctx.params, tokens, new Set(data.sites.map((s) => s.siteId)), y.left, L.right),
    title,
    grid,
    xAxis,
    yAxis,
    tooltip: {
      ...tooltipBase(tokens, 'item'),
      formatter: (p: { seriesIndex: number; seriesName: string; marker: string; value: number[]; encode: { y: number[] } }) => {
        const v = panelOf[p.seriesIndex] as Variable;
        return (
          `${p.marker}<b>${esc(p.seriesName)}</b><br/>` +
          `${esc(varLabel(data.x))}: ${formatValue(p.value[0] as number)} ${esc(xUnit)}<br/>` +
          `${esc(varLabel(v))}: ${formatValue(p.value[p.encode.y[0] as number] as number)} ${esc(displayUnit(meta, v))}`
        );
      },
    },
    dataset: data.sites.map((s) => ({
      dimensions: [{ name: 'x', type: 'float' }, ...data.ys.map((v) => ({ name: v, type: 'float' }))],
      source: { x: s.x, ...s.values },
    })),
    series,
  };
}

/** Pearson correlation of the finite pairs. NaN when fewer than 3 pairs. */
function pearson(x: Float64Array, y: Float64Array): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] as number;
    const b = y[i] as number;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++;
    sx += a;
    sy += b;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  if (n < 3) return Number.NaN;
  const cov = sxy - (sx * sy) / n;
  const den = Math.sqrt((sxx - (sx * sx) / n) * (syy - (sy * sy) / n));
  return den > 0 ? cov / den : Number.NaN;
}

function describe(data: ScatterData, meta: Meta, params: ViewParams): string {
  const names = siteNames(meta, params);
  const parts = data.ys.map((v) => {
    const rs = data.sites
      .map((s) => ({ s, r: pearson(s.x, s.values[v] as Float64Array) }))
      .filter(({ r }) => Number.isFinite(r))
      .map(({ s, r }) => `${names.get(s.siteId) ?? s.siteId} r = ${r.toFixed(2)}`);
    return rs.length ? `${varLabel(v)}: ${rs.join(', ')}.` : '';
  });
  return (
    `Scatter of ${varLabel(data.x)} (x axis) against each other variable, one panel per variable, one colour per site, ` +
    `${groupDigits(data.rowCount)} points. Correlation per site: ${parts.filter(Boolean).join(' ') || 'not known.'}`
  );
}

export const scatter: DiagramDef<ScatterData> = {
  type: 'scatter',
  label: 'Scatter',
  query,
  prepare,
  build,
  widthDependent: true,
  height: (params, _data, width) => totalHeight(yVars(params).length, width),
  statsVariables: (params) => [params.xVariable, ...yVars(params)],
  describe: (data, ctx) => describe(data, ctx.meta, ctx.params),
};
