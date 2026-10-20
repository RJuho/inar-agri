// Year panels: small multiples, one panel per year side by side, one row of panels per variable.
// Each panel shows one year from 1 January, one line per site. All panels of a variable
// have the same y range, so that the years compare directly.
// On a narrow screen the panels of a variable wrap to more rows.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { BuildContext, DiagramDef } from './registry';
import {
  baseOption,
  dayOfYearAxis,
  extent,
  hasValues,
  niceRange,
  siteColors,
  siteLegend,
  siteNames,
  titleStyle,
  titleText,
  unitOf,
  valueAxis,
  varLabel,
} from './common';
import { prepareYears, siteYearTooltip, yearsQuery, type YearsData } from './years';

echarts.use([LineChart]);

/** Layout in px. */
const L = {
  legend: 30,
  /** Height of the variable title above each block. */
  head: 26,
  /** Height of the year label above each panel. */
  yearHead: 18,
  panel: 120,
  /** Space for the x labels below each panel. */
  xLabels: 22,
  left: 48,
  right: 12,
  gapX: 14,
  minPanelW: 150,
  minPanelWNarrow: 100,
  bottom: 4,
};

const ROW_H = L.yearHead + L.panel + L.xLabels;

/** Panels per row. On a narrow screen the panels are smaller. The rows are balanced: 8 years give 4 + 4, not 7 + 1. */
function perRow(width: number, nYears: number): number {
  const minW = width < 600 ? L.minPanelWNarrow : L.minPanelW;
  const usable = Math.max(width, 200) - L.left - L.right + L.gapX;
  const max = Math.max(1, Math.min(nYears, Math.floor(usable / (minW + L.gapX))));
  return Math.ceil(nYears / Math.ceil(nYears / max));
}

function totalHeight(nVars: number, nYears: number, width: number): number {
  if (nVars === 0 || nYears === 0) return 160;
  const rows = Math.ceil(nYears / perRow(width, nYears));
  return L.legend + nVars * (L.head + rows * ROW_H) + L.bottom;
}

function build(data: YearsData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta);
  const years = data.years;
  const cols = perRow(ctx.width, years.length);
  const rows = Math.ceil(years.length / cols);
  const panelW = (Math.max(ctx.width, 200) - L.left - L.right - L.gapX * (cols - 1)) / cols;

  const grid: unknown[] = [];
  const title: unknown[] = [];
  const xAxis: unknown[] = [];
  const yAxis: unknown[] = [];
  const series: unknown[] = [];
  const info: Array<{ site: string; year: number; unit: string }> = [];

  data.variables.forEach((v, vi) => {
    const blockTop = L.legend + vi * (L.head + rows * ROW_H);
    const y = niceRange(extent(data.groups, v));
    const unit = unitOf(meta, v);
    title.push({ top: blockTop + 2, left: L.left - 8, text: titleText(varLabel(v), unit), textStyle: titleStyle(tokens) });
    years.forEach((year, yi) => {
      const r = Math.floor(yi / cols);
      const c = yi % cols;
      const top = blockTop + L.head + r * ROW_H + L.yearHead;
      const left = L.left + c * (panelW + L.gapX);
      const gi = grid.length;
      grid.push({ top, left, width: panelW, height: L.panel });
      title.push({
        top: top - L.yearHead,
        left: left - 2,
        text: String(year),
        textStyle: { fontSize: 12, fontWeight: 600, color: tokens.textMuted },
      });
      xAxis.push(dayOfYearAxis(tokens, gi, true, 3, false));
      yAxis.push(valueAxis(tokens, gi, { scale: false, ...y, axisLabel: { show: c === 0, color: tokens.textMuted } }));
      data.groups.forEach((g, di) => {
        if (g.year !== year || !hasValues(g, v)) return;
        info.push({ site: names.get(g.siteId) ?? String(g.siteId), year, unit });
        series.push({
          type: 'line',
          name: names.get(g.siteId) ?? String(g.siteId),
          datasetIndex: di,
          encode: { x: 'x', y: v },
          xAxisIndex: gi,
          yAxisIndex: gi,
          color: colors.get(g.siteId),
          showSymbol: false,
          symbol: 'none',
          connectNulls: false,
          lineStyle: { width: 1.25 },
          emphasis: { disabled: true },
        });
      });
    });
  });

  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, tokens, new Set(data.groups.map((g) => g.siteId)), L.left, L.right),
    title,
    grid,
    xAxis,
    yAxis,
    tooltip: siteYearTooltip(ctx, data.step, info),
    dataset: data.groups.map((g) => ({
      dimensions: [{ name: 'x', type: 'time' }, ...data.variables.map((v) => ({ name: v, type: 'float' }))],
      source: { x: g.x, ...g.values },
    })),
    series,
  };
}

export const yearPanels: DiagramDef<YearsData> = {
  type: 'yearPanels',
  label: 'Years side by side',
  query: yearsQuery,
  prepare: (table, params) => prepareYears(table, params),
  build,
  widthDependent: true,
  height: (params, data, width) => totalHeight(params.variables.length, data?.years.length ?? 1, width),
  describe: (data) =>
    `Small multiples: one panel per year (${data.years[0] ?? ''} to ${data.years[data.years.length - 1] ?? ''}), side by side, ` +
    `one row of panels per variable. Each panel starts on 1 January and has one line per site, ` +
    `${data.step === 'month' ? 'monthly means' : 'daily means'}. All panels of a variable have the same y axis.`,
};
