// Year panels: small multiples, one panel per year side by side, one row of panels per variable.
// Each panel shows one year from 1 January, one line per site. All panels of a variable
// have the same y range, so that the years compare directly.
// On a narrow screen the panels of a variable wrap to more rows.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Meta } from '../db';
import type { BuildContext, DiagramDef } from './registry';
import {
  axisName,
  baseOption,
  dayOfYearAxisName,
  displayUnit,
  eventMarkers,
  dayOfYearAxis,
  extent,
  FIXED_GRID,
  gridLeftFor,
  hasValues,
  nameLines,
  panelTitle,
  statText,
  stepStatNote,
  tickLabelWidth,
  X_NAME_TITLE_ID,
  YEAR_STEP_TEXT,
  niceRange,
  siteColors,
  siteLegend,
  siteNames,
  valueAxis,
  yAxisName,
  zeroLineSeries,
} from './common';
import {
  prepareYears,
  refYearPx,
  siteYearTooltip,
  yearEventMarks,
  yearsQuery,
  type SeriesInfo,
  type YearsData,
} from './years';

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
  /** Space for the x axis name below the last panel row of each variable. */
  xName: 18,
  /** Smallest left margin. `yLayout()` makes it larger for the y axis names. */
  left: 48,
  right: 12,
  gapX: 14,
  minPanelW: 150,
  minPanelWNarrow: 100,
  bottom: 4,
};

const ROW_H = L.yearHead + L.panel + L.xLabels;

/** Panels per row. On a narrow screen the panels are smaller. The rows are balanced: 8 years give 4 + 4, not 7 + 1. */
function perRow(width: number, nYears: number, left = L.left): number {
  const minW = width < 600 ? L.minPanelWNarrow : L.minPanelW;
  const usable = Math.max(width, 200) - left - L.right + L.gapX;
  const max = Math.max(1, Math.min(nYears, Math.floor(usable / (minW + L.gapX))));
  return Math.ceil(nYears / Math.ceil(nYears / max));
}

function totalHeight(nVars: number, nYears: number, width: number): number {
  if (nVars === 0 || nYears === 0) return 160;
  const rows = Math.ceil(nYears / perRow(width, nYears));
  return L.legend + nVars * blockHeight(rows) + L.bottom;
}

/** Height of the block of one variable: title, panel rows and the x axis name. */
const blockHeight = (rows: number) => L.head + rows * ROW_H + L.xName;

/**
 * Y ranges, y axis names, tick label widths and the shared left margin. The panels of a
 * variable have the same y axis, so only the first column shows the labels and the name.
 */
function yLayout(data: YearsData, meta: Meta) {
  const ranges = data.variables.map((v) => niceRange(extent(data.groups, v)));
  const names = data.variables.map((v) => axisName(meta, v, L.panel));
  const widths = ranges.map((r) => tickLabelWidth([r.min, r.max]));
  const left = Math.max(L.left, ...names.map((n, i) => gridLeftFor(widths[i] as number, nameLines(n))));
  return { ranges, names, widths, left };
}

function build(data: YearsData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta, ctx.params);
  const years = data.years;
  const yl = yLayout(data, meta);
  // Use the default left margin for the panel count, so that the chart height (from `height()`) fits.
  const cols = perRow(ctx.width, years.length);
  const rows = Math.ceil(years.length / cols);
  const panelW = (Math.max(ctx.width, 200) - yl.left - L.right - L.gapX * (cols - 1)) / cols;
  const rowW = cols * panelW + (cols - 1) * L.gapX;
  const xName = dayOfYearAxisName(meta, ctx.params);

  const grid: unknown[] = [];
  const title: unknown[] = [];
  const xAxis: unknown[] = [];
  const yAxis: unknown[] = [];
  const series: unknown[] = [];
  const info: SeriesInfo[] = [];
  // Label rows per year: the groups of one year share the x axis of a panel.
  const marks = yearEventMarks(ctx, data.groups, refYearPx(panelW), (g) => g.year);

  const zeroLines: unknown[] = [];
  data.variables.forEach((v, vi) => {
    const blockTop = L.legend + vi * blockHeight(rows);
    const y = yl.ranges[vi] as ReturnType<typeof niceRange>;
    const unit = displayUnit(meta, v);
    // Variable label and statistic. The unit is in the y axis name.
    title.push({
      top: blockTop + 2,
      left: yl.left - 8,
      text: panelTitle(v, statText(v, data.step)),
      textStyle: { fontSize: 13, fontWeight: 600, color: tokens.text },
    });
    // X axis name: one time, at the centre below the last panel row of the variable.
    // The id tells the alt text (`axesText()`) that this title is an x axis name.
    title.push({
      id: `${X_NAME_TITLE_ID}-${vi}`,
      top: blockTop + L.head + rows * ROW_H,
      left: yl.left + rowW / 2,
      textAlign: 'center',
      text: xName,
      textStyle: { fontSize: 11, fontWeight: 400, color: tokens.textMuted },
    });
    years.forEach((year, yi) => {
      const r = Math.floor(yi / cols);
      const c = yi % cols;
      const top = blockTop + L.head + r * ROW_H + L.yearHead;
      const left = yl.left + c * (panelW + L.gapX);
      const gi = grid.length;
      grid.push({ top, left, width: panelW, height: L.panel, ...FIXED_GRID });
      title.push({
        top: top - L.yearHead,
        left: left - 2,
        text: String(year),
        textStyle: { fontSize: 12, fontWeight: 600, color: tokens.textMuted },
      });
      xAxis.push(dayOfYearAxis(tokens, gi, true, 3, false));
      yAxis.push(
        valueAxis(tokens, gi, {
          scale: false,
          ...y,
          axisLabel: { show: c === 0, color: tokens.textMuted },
          axisTick: { show: c === 0, inside: false, lineStyle: { color: tokens.axis } },
          // Shared y axis: the name on the first column only.
          ...(c === 0 ? yAxisName(tokens, yl.names[vi] as string, yl.widths[vi] as number) : {}),
        }, v),
      );
      const zero = zeroLineSeries(meta, tokens, v, gi, [y.min, y.max]);
      if (zero) zeroLines.push(zero);
      data.groups.forEach((g, di) => {
        if (g.year !== year || !hasValues(g, v)) return;
        info.push({ siteId: g.siteId, site: names.get(g.siteId) ?? String(g.siteId), year, unit });
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
          ...eventMarkers(marks.byGroup.get(g) ?? [], colors.get(g.siteId) ?? tokens.text, tokens, vi === 0),
        });
      });
    });
  });

  // The zero lines come after all data series, so that the tooltip index `info` stays correct.
  series.push(...zeroLines);
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, ctx.params, tokens, new Set(data.groups.map((g) => g.siteId)), yl.left, L.right),
    title,
    grid,
    xAxis,
    yAxis,
    tooltip: siteYearTooltip(ctx, data.step, info, marks.all),
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
  prepare: prepareYears,
  build,
  showsEvents: true,
  widthDependent: true,
  height: (params, data, width) => totalHeight(params.variables.length, data?.years.length ?? 1, width),
  describe: (data) =>
    `Small multiples: one panel per year (${data.years[0] ?? ''} to ${data.years[data.years.length - 1] ?? ''}), side by side, ` +
    `one row of panels per variable. Each panel starts on 1 January and has one line per site, ` +
    `${YEAR_STEP_TEXT[data.step]}. All panels of a variable have the same y axis.` +
    (data.step === 'week' ? ' A week over 1 January is split: each part is in its own year.' : '') +
    stepStatNote(data.variables, data.step),
};
