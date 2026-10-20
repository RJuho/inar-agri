// Monthly means: grouped bars, one panel per variable, one bar per site in each calendar month.
// The mean uses all 30-minute values of the selected years. The step setting does not apply.
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import type { Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';
import {
  MONTH_NAMES,
  STACK,
  baseOption,
  emptyNote,
  esc,
  formatValue,
  siteColors,
  siteLegend,
  siteNames,
  stackHeight,
  stackLayout,
  titleStyle,
  titleText,
  tooltipBase,
  unitOf,
  valueAxis,
  varLabel,
} from './common';

echarts.use([BarChart]);

interface MonthlyData extends Prepared {
  variables: Variable[];
  /** Per site: 12 monthly means per variable. null = no data. */
  sites: Array<{ siteId: number; values: Partial<Record<Variable, Array<number | null>>> }>;
}

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0) return null;
  const vars = params.variables.map(col);
  return `SELECT site_id::DOUBLE AS site_id, month(tl)::DOUBLE AS m, ${vars.map((v) => `avg(${v}) AS ${v}`).join(', ')}
    FROM obs WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`;
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
    subtitle: 'Mean of all 30-minute values in the selected years, per calendar month.',
  };
  if (n === 0) data.note = 'No data for these sites and years.';
  return data;
}

function build(data: MonthlyData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const vars = data.variables;
  const layout = stackLayout(vars.length, ctx.height);
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta);
  const last = vars.length - 1;
  const series: unknown[] = [];
  vars.forEach((v, panel) => {
    for (const s of data.sites) {
      if (!s.values[v]?.some((y) => y !== null)) continue;
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
    legend: siteLegend(meta, tokens, new Set(data.sites.map((s) => s.siteId)), STACK.left, STACK.right),
    title: vars.map((v, i) => ({ ...layout.title[i], text: titleText(varLabel(v), unitOf(meta, v)), textStyle: titleStyle(tokens) })),
    grid: layout.grid,
    xAxis: vars.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: MONTH_NAMES,
      axisLine: { lineStyle: { color: tokens.axis } },
      axisTick: { show: false },
      axisLabel: { show: i === last, color: tokens.textMuted, hideOverlap: true },
    })),
    yAxis: vars.map((_, i) => valueAxis(tokens, i, { scale: false })),
    tooltip: {
      ...tooltipBase(tokens, 'axis'),
      axisPointer: { type: 'shadow', shadowStyle: { color: tokens.grid, opacity: 0.4 } },
      formatter: (raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ marker: string; seriesName: string; value: number | null; name: string; axisIndex?: number; seriesIndex: number }>;
        const first = list[0];
        if (!first) return '';
        const rows = list
          .filter((p) => p.value !== null && Number.isFinite(p.value))
          .map((p) => `${p.marker}${esc(p.seriesName)}&nbsp;&nbsp;<b>${formatValue(p.value as number)}</b>`);
        return `<b>${esc(first.name)}</b><br/>${rows.join('<br/>') || 'No data'}`;
      },
    },
    series,
  };
}

export const monthly: DiagramDef<MonthlyData> = {
  type: 'monthly',
  label: 'Monthly means',
  query,
  prepare,
  build,
  relayout: (data, ctx) => stackLayout(data.variables.length, ctx.height),
  height: (params) => stackHeight(params.variables.length, 170),
  describe: (data) =>
    `Grouped bars: one panel per variable, twelve calendar months on the x axis, one bar per site (${data.sites.length} sites). ` +
    `Each bar is the mean of all values in that month over the selected years.`,
};
