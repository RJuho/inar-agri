// Years overlay: one panel per variable, x = day of the year, one line per site and year.
// The colour follows the site. Earlier years have lighter lines.
// Raw data is shown as daily means, so that the chart stays fast.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import type { Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';
import {
  DAY,
  DAY_STEP,
  baseOption,
  dayLabel,
  dayOfYearAxis,
  emptyNote,
  esc,
  formatValue,
  hasValues,
  readGroups,
  refDateSql,
  siteColors,
  siteLegend,
  siteNames,
  stackHeight,
  stackLayout,
  STACK,
  titleStyle,
  titleText,
  tooltipBase,
  unitOf,
  valueAxis,
  varLabel,
  yearOpacity,
  yearStep,
  type Group,
} from './common';

echarts.use([LineChart]);

export interface YearsData extends Prepared {
  variables: Variable[];
  step: 'day' | 'month';
  groups: Group[];
  /** Years in the data, sorted. */
  years: number[];
}

/**
 * SQL for the year diagrams: one row per site, year and day (or month).
 * x = the same day in the reference year, in epoch ms.
 */
export function yearsQuery(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0) return null;
  const vars = params.variables.map(col);
  const x = yearStep(params.aggregation) === 'month' ? refDateSql('tl', '15') : refDateSql('tl');
  return `SELECT site_id::DOUBLE AS site_id, year(tl)::DOUBLE AS yr, ${x} AS x,
      ${vars.map((v) => `avg(${v}) AS ${v}`).join(', ')}
    FROM obs WHERE ${where} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
}

export function prepareYears(table: Table | null, params: ViewParams): YearsData {
  const step = yearStep(params.aggregation);
  const base = { variables: params.variables, step, groups: [] as Group[], years: [] as number[] };
  if (table === null) return { ...base, rowCount: 0, seriesCount: 0, note: emptyNote(params) };
  const groups = readGroups(table, params.variables, true, step === 'month' ? 32 * DAY : DAY_STEP);
  const years = [...new Set(groups.map((g) => g.year))].sort((a, b) => a - b);
  let seriesCount = 0;
  for (const v of params.variables) for (const g of groups) if (hasValues(g, v)) seriesCount++;
  const data: YearsData = { ...base, groups, years, rowCount: table.numRows, seriesCount };
  if (table.numRows === 0) data.note = 'No data for these sites and years.';
  if (params.aggregation === 'raw') data.subtitle = 'Raw data is shown as daily means.';
  return data;
}

/** Year rank of each group within its site, for the line opacity. */
export function yearRanks(groups: Group[]): Map<Group, [number, number]> {
  const bySite = new Map<number, Group[]>();
  for (const g of groups) bySite.set(g.siteId, [...(bySite.get(g.siteId) ?? []), g]);
  const out = new Map<Group, [number, number]>();
  for (const list of bySite.values()) list.forEach((g, i) => out.set(g, [i, list.length]));
  return out;
}

/** Tooltip for site-year lines. `meta` of each series index gives the site and year. */
export function siteYearTooltip(ctx: BuildContext, step: 'day' | 'month', info: Array<{ site: string; year: number; unit: string }>) {
  return {
    ...tooltipBase(ctx.tokens, 'axis'),
    axisPointer: { type: 'line', lineStyle: { color: ctx.tokens.axis } },
    formatter: (raw: unknown) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        seriesIndex: number;
        marker: string;
        value: number[];
        encode: { y: number[] };
        axisValue: number;
      }>;
      const first = list[0];
      if (!first) return '';
      const rows = list
        .map((p) => ({ p, y: p.value[p.encode.y[0] as number] as number }))
        .filter((r) => Number.isFinite(r.y))
        .map(({ p, y }) => {
          const s = info[p.seriesIndex];
          return `${p.marker}${esc(s?.site ?? '')} ${s?.year ?? ''}&nbsp;&nbsp;<b>${formatValue(y)}</b> ${esc(s?.unit ?? '')}`;
        });
      return `<b>${dayLabel(first.axisValue, step)}</b><br/>${rows.join('<br/>') || 'No data'}`;
    },
  };
}

function build(data: YearsData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const vars = data.variables;
  const layout = stackLayout(vars.length, ctx.height);
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta);
  const ranks = yearRanks(data.groups);
  const last = vars.length - 1;
  const info: Array<{ site: string; year: number; unit: string }> = [];
  const series: unknown[] = [];
  vars.forEach((v, panel) => {
    data.groups.forEach((g, gi) => {
      if (!hasValues(g, v)) return;
      const [rank, count] = ranks.get(g) ?? [0, 1];
      info.push({ site: names.get(g.siteId) ?? String(g.siteId), year: g.year, unit: unitOf(meta, v) });
      series.push({
        type: 'line',
        name: names.get(g.siteId) ?? String(g.siteId),
        datasetIndex: gi,
        encode: { x: 'x', y: v },
        xAxisIndex: panel,
        yAxisIndex: panel,
        color: colors.get(g.siteId),
        showSymbol: false,
        symbol: 'none',
        connectNulls: false,
        lineStyle: { width: 1.5, opacity: yearOpacity(rank, count) },
        emphasis: { focus: 'series', lineStyle: { width: 2.5, opacity: 1 } },
      });
    });
  });
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, tokens, new Set(data.groups.map((g) => g.siteId)), STACK.left, STACK.right),
    title: vars.map((v, i) => ({
      ...layout.title[i],
      text: titleText(varLabel(v), unitOf(meta, v)),
      textStyle: titleStyle(tokens),
    })),
    grid: layout.grid,
    xAxis: vars.map((_, i) => dayOfYearAxis(tokens, i, i === last)),
    yAxis: vars.map((_, i) => valueAxis(tokens, i)),
    tooltip: siteYearTooltip(ctx, data.step, info),
    dataset: data.groups.map((g) => ({
      dimensions: [{ name: 'x', type: 'time' }, ...vars.map((v) => ({ name: v, type: 'float' }))],
      source: { x: g.x, ...g.values },
    })),
    series,
  };
}

export const years: DiagramDef<YearsData> = {
  type: 'years',
  label: 'Years overlay',
  query: yearsQuery,
  prepare: (table, params) => prepareYears(table, params),
  build,
  relayout: (data, ctx) => stackLayout(data.variables.length, ctx.height),
  height: (params) => stackHeight(params.variables.length, 190),
  describe: (data) =>
    `One panel per variable. The x axis is the day of the year, ${data.step === 'month' ? 'monthly means' : 'daily means'}. ` +
    `Each line is one site and year: ${data.years.length} years (${data.years[0] ?? ''} to ${data.years[data.years.length - 1] ?? ''}). ` +
    `The colour shows the site, and lighter lines are earlier years.`,
};
