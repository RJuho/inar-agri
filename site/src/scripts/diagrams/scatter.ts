// Scatter: the x variable of the view against each other selected variable.
// One panel per y variable, one colour per site. The query takes a repeatable
// reservoir sample of 20 000 rows, so that the chart stays fast.
import * as echarts from 'echarts/core';
import { ScatterChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import type { Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';
import {
  baseOption,
  emptyNote,
  esc,
  formatValue,
  groupDigits,
  siteColors,
  siteLegend,
  siteNames,
  titleStyle,
  titleText,
  tooltipBase,
  unitOf,
  valueAxis,
  varLabel,
} from './common';

echarts.use([ScatterChart]);

const SAMPLE_ROWS = 20_000;
const L = { legend: 30, head: 30, panel: 260, xLabels: 40, left: 56, right: 16, gapX: 40 };

interface ScatterData extends Prepared {
  x: Variable;
  ys: Variable[];
  sites: Array<{ siteId: number; x: Float64Array; values: Partial<Record<Variable, Float64Array>> }>;
}

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
      : `SELECT site_id, avg(${x}) AS x, ${ys.map((v) => `avg(${v}) AS ${v}`).join(', ')} FROM obs
         WHERE ${where} GROUP BY site_id, date_trunc('${params.aggregation}', tl)
         HAVING avg(${x}) IS NOT NULL`;
  return `SELECT site_id::DOUBLE AS site_id, x, ${ys.join(', ')}
    FROM (SELECT * FROM (${inner}) USING SAMPLE reservoir(${SAMPLE_ROWS} ROWS) REPEATABLE (1))
    ORDER BY site_id`;
}

function prepare(table: Table | null, params: ViewParams, _meta: Meta): ScatterData {
  const ys = yVars(params);
  const base = { x: params.xVariable, ys, sites: [] as ScatterData['sites'] };
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
  const step = params.aggregation === 'raw' ? '30-minute values' : params.aggregation === 'day' ? 'daily means' : 'monthly means';
  const data: ScatterData = {
    ...base,
    sites,
    rowCount: n,
    seriesCount,
    subtitle: `x = ${varLabel(params.xVariable)}. ${n >= SAMPLE_ROWS ? `Random sample of ${groupDigits(SAMPLE_ROWS)} ${step}.` : `All ${step}.`}`,
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

function build(data: ScatterData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta);
  const cols = columns(ctx.width, data.ys.length);
  const panelW = (Math.max(ctx.width, 200) - L.left - L.right - (cols - 1) * (L.gapX + L.left)) / cols;
  const xUnit = unitOf(meta, data.x);
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
    const left = L.left + c * (panelW + L.gapX + L.left);
    grid.push({ top, left, width: panelW, height: L.panel });
    title.push({ top: top - 24, left: left - 8, text: titleText(varLabel(v), unitOf(meta, v)), textStyle: titleStyle(tokens) });
    xAxis.push(
      valueAxis(tokens, i, {
        name: titleText(varLabel(data.x), xUnit),
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: tokens.textMuted, rich: { u: { color: tokens.textMuted } } },
        axisLine: { show: true, lineStyle: { color: tokens.axis } },
        splitNumber: 4,
      }),
    );
    yAxis.push(valueAxis(tokens, i, { splitNumber: 4 }));
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
    legend: siteLegend(meta, tokens, new Set(data.sites.map((s) => s.siteId)), L.left, L.right),
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
          `${esc(varLabel(v))}: ${formatValue(p.value[p.encode.y[0] as number] as number)} ${esc(unitOf(meta, v))}`
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

function describe(data: ScatterData, meta: Meta): string {
  const names = siteNames(meta);
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
  describe: (data, ctx) => describe(data, ctx.meta),
};
