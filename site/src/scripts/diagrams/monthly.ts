// Monthly means: grouped bars, one panel per variable, one bar per site in each calendar month.
// The mean uses all 30-minute values of the selected years. The step setting does not apply.
// Precipitation: the mean of the monthly sums. Wind direction: the circular mean.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import type { Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { CIRCULAR_VARS, SUM_VARS, col, whereClause } from './sql';
import {
  MONTH_NAMES,
  STACK,
  X_NAME_SPACE,
  axisName,
  baseOption,
  displayUnit,
  emptyNote,
  esc,
  gridLeftFor,
  joinSubtitle,
  nameLines,
  panelTitle,
  signNote,
  siteColors,
  siteLegend,
  siteNames,
  stackHeight,
  stackLayout,
  tickLabelWidth,
  titleStyle,
  tooltipBase,
  valueAxis,
  valueWithUnit,
  xAxisName,
  yAxisName,
  zeroLineSeries,
} from './common';

// LineChart: for the zero lines.
echarts.use([BarChart, LineChart]);

/** Panel statistic in the title. The step setting does not apply. */
const STAT = 'monthly mean of 30-min values';

/** Statistic in the panel title of `v`. */
function statOf(v: Variable): string {
  if (SUM_VARS.has(v)) return 'mean of the monthly sums';
  if (CIRCULAR_VARS.has(v)) return 'monthly circular mean of 30-min values';
  return STAT;
}
/** Stack layout with space below the bottom panel for the month labels and the x axis name. */
const LAYOUT = { ...STACK, bottom: X_NAME_SPACE + 4 };
/** Panel height in px. */
const PANEL_H = 170;

interface MonthlyData extends Prepared {
  variables: Variable[];
  /** Per site: 12 monthly means per variable. null = no data. */
  sites: Array<{ siteId: number; values: Partial<Record<Variable, Array<number | null>>> }>;
}

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0) return null;
  const vars = params.variables.map(col);
  // Two levels: first per site and month of a year (mo), then per calendar month. The parts
  // per month (sums and counts) give the same mean as avg() of all 30-min values.
  // Precipitation: mean of the monthly sums. Wind direction: circular mean of all values.
  const inner: string[] = [];
  const outer: string[] = [];
  for (const v of vars) {
    if (SUM_VARS.has(v)) {
      inner.push(`sum(${v}) AS ${v}__s`);
      outer.push(`avg(${v}__s) AS ${v}`);
    } else if (CIRCULAR_VARS.has(v)) {
      inner.push(`sum(sin(radians(${v}))) AS ${v}__s, sum(cos(radians(${v}))) AS ${v}__c`);
      outer.push(`((degrees(atan2(sum(${v}__s), sum(${v}__c))) + 360) % 360) AS ${v}`);
    } else {
      inner.push(`sum(${v}) AS ${v}__s, count(${v}) AS ${v}__n`);
      outer.push(`sum(${v}__s) / nullif(sum(${v}__n), 0) AS ${v}`);
    }
  }
  return `SELECT site_id::DOUBLE AS site_id, month(mo)::DOUBLE AS m, ${outer.join(', ')}
    FROM (SELECT site_id, date_trunc('month', tl) AS mo, ${inner.join(', ')} FROM obs WHERE ${where} GROUP BY 1, 2)
    GROUP BY 1, 2 ORDER BY 1, 2`;
}

function prepare(table: Table | null, params: ViewParams, _meta: Meta): MonthlyData {
  const base = { variables: params.variables, sites: [] as MonthlyData['sites'] };
  if (table === null) return { ...base, rowCount: 0, seriesCount: 0, note: emptyNote(params) };
  const n = table.numRows;
  const site = toFloat64(table.getChild('site_id'), n);
  const month = toFloat64(table.getChild('m'), n);
  const cols = new Map(params.variables.map((v) => [v, toFloat64(table.getChild(v), n)]));
  const bySite = new Map<number, MonthlyData['sites'][number]>();
  for (let i = 0; i < n; i++) {
    const id = site[i] as number;
    let entry = bySite.get(id);
    if (!entry) {
      entry = { siteId: id, values: {} };
      for (const v of params.variables) entry.values[v] = Array<number | null>(12).fill(null);
      bySite.set(id, entry);
    }
    for (const v of params.variables) {
      const y = (cols.get(v) as Float64Array)[i] as number;
      (entry.values[v] as Array<number | null>)[(month[i] as number) - 1] = Number.isFinite(y) ? y : null;
    }
  }
  const sites = [...bySite.values()];
  let seriesCount = 0;
  for (const v of params.variables) for (const s of sites) if (s.values[v]?.some((y) => y !== null)) seriesCount++;
  const data: MonthlyData = {
    ...base,
    sites,
    rowCount: n,
    seriesCount,
    subtitle: joinSubtitle(signNote(params.variables), 'Mean of all 30-minute values in the selected years, per calendar month.'),
  };
  if (n === 0) data.note = 'No data for these sites and years.';
  return data;
}

/** Min and max of the monthly means of `v` in all sites, with 0 (the bars start at 0). */
function valueExtent(data: MonthlyData, v: Variable): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const s of data.sites) {
    for (const y of s.values[v] ?? []) {
      if (y === null) continue;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return lo < hi ? [lo, hi] : [0, 1];
}

/** Panel height in px, the same formula as `stackLayout()`. */
function panelHeight(n: number, height: number): number {
  const k = Math.max(n, 1);
  return Math.max(40, (height - LAYOUT.top - LAYOUT.bottom - LAYOUT.gap * k) / k);
}

/** Y axis names, tick label widths and the shared left margin of all panels. */
function yLayout(data: MonthlyData, meta: Meta, height: number) {
  const panelH = panelHeight(data.variables.length, height);
  const extents = data.variables.map((v) => valueExtent(data, v));
  const names = data.variables.map((v) => axisName(meta, v, panelH));
  const widths = extents.map((e) => tickLabelWidth(e));
  const left = Math.max(LAYOUT.left, ...names.map((n, i) => gridLeftFor(widths[i] as number, nameLines(n))));
  return { extents, names, widths, left };
}

function build(data: MonthlyData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const vars = data.variables;
  const y = yLayout(data, meta, ctx.height);
  const layout = stackLayout(vars.length, ctx.height, LAYOUT, y.left);
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta, ctx.params);
  const last = vars.length - 1;
  const series: unknown[] = [];
  /** Display unit for each series index. */
  const units: string[] = [];
  vars.forEach((v, panel) => {
    for (const s of data.sites) {
      if (!s.values[v]?.some((y) => y !== null)) continue;
      units.push(displayUnit(meta, v));
      series.push({
        type: 'bar',
        name: names.get(s.siteId) ?? String(s.siteId),
        data: s.values[v],
        xAxisIndex: panel,
        yAxisIndex: panel,
        color: colors.get(s.siteId),
        barGap: '8%',
        barCategoryGap: '24%',
        itemStyle: { borderRadius: 2, borderColor: tokens.surface, borderWidth: 0.5 },
        emphasis: { disabled: true },
      });
    }
  });
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, ctx.params, tokens, new Set(data.sites.map((s) => s.siteId)), y.left, LAYOUT.right),
    // Panel label and statistic. The unit is in the y axis name.
    title: vars.map((v, i) => ({ ...layout.title[i], text: panelTitle(v, statOf(v)), textStyle: titleStyle(tokens) })),
    grid: layout.grid,
    xAxis: vars.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: MONTH_NAMES,
      // The axis stays at the bottom of the panel. The zero line series marks y = 0.
      axisLine: { onZero: false, lineStyle: { color: tokens.axis } },
      axisTick: { show: false },
      axisLabel: { show: i === last, color: tokens.textMuted, hideOverlap: true },
      ...(i === last ? xAxisName(tokens, 'Month') : {}),
    })),
    yAxis: vars.map((v, i) =>
      valueAxis(tokens, i, { scale: false, ...yAxisName(tokens, y.names[i] as string, y.widths[i] as number) }, v),
    ),
    tooltip: {
      ...tooltipBase(tokens, 'axis'),
      axisPointer: { type: 'shadow', shadowStyle: { color: tokens.grid, opacity: 0.4 } },
      formatter: (raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ marker: string; seriesName: string; value: number | null; name: string; axisIndex?: number; seriesIndex: number }>;
        const first = list[0];
        if (!first) return '';
        const rows = list
          .filter((p) => p.value !== null && Number.isFinite(p.value))
          .map((p) => `${p.marker}${esc(p.seriesName)}&nbsp;&nbsp;${valueWithUnit(p.value as number, units[p.seriesIndex] ?? '')}`);
        return `<b>${esc(first.name)}</b><br/>${rows.join('<br/>') || 'No data'}`;
      },
    },
    // The zero lines come after all data series, so they do not change the series index.
    // They are line series: an empty bar series takes one bar position in each month group.
    series: [...series, ...vars.flatMap((v, i) => zeroLineSeries(meta, tokens, v, i, y.extents[i] as [number, number]) ?? [])],
  };
}

export const monthly: DiagramDef<MonthlyData> = {
  type: 'monthly',
  label: 'Monthly means',
  query,
  prepare,
  build,
  relayout: (data, ctx) => stackLayout(data.variables.length, ctx.height, LAYOUT, yLayout(data, ctx.meta, ctx.height).left),
  height: (params) => stackHeight(params.variables.length, PANEL_H, LAYOUT),
  describe: (data) =>
    `Grouped bars: one panel per variable, twelve calendar months on the x axis, one bar per site (${data.sites.length} sites). ` +
    `Each bar is the mean of all values in that month over the selected years` +
      (data.variables.some((v) => SUM_VARS.has(v)) ? '; for precipitation it is the mean of the monthly sums.' : '.'),
};
