// Years overlay: one panel per variable, x = day of the year, one line per site and year.
// The colour follows the site. Earlier years have lighter lines.
// With one or two selected sites, each year has its own colour. The second site has dashed lines.
// Raw data is shown as daily means, so that the chart stays fast.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import type { Meta } from '../db';
import type { Variable, ViewParams } from '../state';
import type { Tokens } from '../theme';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, stepExpr, whereClause } from './sql';
import { fixedRange } from '../axisRanges';
import {
  DAY,
  REF_END,
  REF_START,
  YEAR_MAX_STEP,
  YEAR_STEP_TEXT,
  yearExportStep,
  baseOption,
  dayLabel,
  dayOfYearAxis,
  emptyNote,
  esc,
  eventMarkers,
  eventsInRange,
  eventsKeyText,
  eventTooltipLines,
  axisName,
  dayOfYearAxisName,
  displayUnit,
  gridLeftFor,
  joinSubtitle,
  nameLines,
  panelTitle,
  signNote,
  statText,
  stepStatNote,
  tickLabelWidth,
  valueWithUnit,
  X_NAME_SPACE,
  xAxisName,
  yAxisName,
  zeroLineSeries,
  extent,
  refYearMarks,
  setLabelRows,
  type EventMark,
  hasValues,
  readGroups,
  refDateSql,
  siteColors,
  siteDash,
  siteLegend,
  siteSlots,
  siteSymbol,
  siteSymbolOptions,
  lineLegendIcon,
  LINE_ICON_SIZE,
  type LineDash,
  siteNames,
  stackHeight,
  stackLayout,
  textWidth,
  STACK,
  tooltipBase,
  valueAxis,
  axisExtent,
  yearOpacity,
  yearStep,
  type Group,
  type YearStep,
} from './common';

echarts.use([LineChart]);

export interface YearsData extends Prepared {
  variables: Variable[];
  step: YearStep;
  groups: Group[];
  /** Years in the data, sorted. */
  years: number[];
  /** `year`: one colour per year (one or two selected sites). `site`: one colour per site. */
  colorBy: 'year' | 'site';
  /** Labels of the sites with solid and dashed lines (year mode with two sites). */
  lineSites?: [string, string];
  /** Site with dashed lines (year mode with two sites). */
  dashedSite?: number;
  /** Legend entries in order. Each entry is the name of its series. */
  legend: string[];
}

/** Legend row height in px. */
const LEGEND_ROW_H = 22;
/** Largest left margin of the panels that the legend row count expects. */
const LEGEND_LEFT_MAX = 96;
/** Font of the legend text (the ECharts default). */
const LEGEND_FONT = '12px sans-serif';

/** Width in px of the legend marks: a line with the site symbol (`lineLegendIcon()`). */
const legendItemWidth = (_data: YearsData) => LINE_ICON_SIZE.itemWidth;

/**
 * Number of legend rows at the given chart width. The legend wraps, so that all entries show
 * (also in the PNG export).
 */
export function legendRows(data: YearsData, width: number): number {
  const room = width - LEGEND_LEFT_MAX + 8 - STACK.right;
  let rows = 1;
  let x = 0;
  for (const name of data.legend) {
    const w = legendItemWidth(data) + 5 + textWidth(name, LEGEND_FONT) + 2;
    if (x > 0 && x + w > room) {
      rows++;
      x = 0;
    }
    x += w + 10;
  }
  return rows;
}

/** Panel layout with space for all legend rows. */
const yearsStack = (data: YearsData, width: number) => ({ ...YEAR_STACK, top: YEAR_STACK.top + (legendRows(data, width) - 1) * LEGEND_ROW_H });

/** Largest number of selected sites that gives one colour per year. */
export const YEAR_COLOR_MAX_SITES = 2;

/** Viridis stops, equally spaced from 0 to 1. */
const VIRIDIS = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'];

/** Colour at `t` (0 to 1) on the viridis ramp, linear between the stops. */
export function viridisAt(t: number): string {
  const x = Math.min(Math.max(t, 0), 1) * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(x), VIRIDIS.length - 2);
  const f = x - i;
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const a = rgb(VIRIDIS[i] as string);
  const b = rgb(VIRIDIS[i + 1] as string);
  return `#${a.map((c, k) => Math.round(c + ((b[k] as number) - c) * f).toString(16).padStart(2, '0')).join('')}`;
}

/** True when the hex colour is dark (relative luminance below 0.2). */
function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((k) => parseInt((m[1] as string).slice(k, k + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2;
}

/**
 * Colour of each year: the theme series colours for up to 8 years. For more years, a sequential
 * viridis ramp from the first to the last year (the years are in order, so a ramp is correct).
 * The ramp leaves out the end that is too near the surface: light surface 0 to 0.85, dark surface 0.2 to 1.
 */
export function yearColors(years: number[], tokens: Tokens): Map<number, string> {
  const n = years.length;
  if (n <= tokens.series.length) return new Map(years.map((y, i) => [y, tokens.series[i] as string]));
  const [lo, hi] = isDark(tokens.surface) ? [0.2, 1] : [0, 0.85];
  return new Map(years.map((y, i) => [y, viridisAt(lo + ((hi - lo) * i) / Math.max(n - 1, 1))]));
}

/**
 * SQL for the year diagrams: one row per site, year and day (or week, or month).
 * x = the same day in the reference year, in epoch ms.
 * Week: the ISO week (start Monday 00:00 local). A week over 1 January is split in two
 * parts, one per year. The part in the new year starts on 1 January.
 */
export function yearsQuery(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0) return null;
  const vars = params.variables.map(col);
  const step = yearStep(params.aggregation);
  const x =
    step === 'month'
      ? refDateSql('tl', '15')
      : step === 'week'
        ? refDateSql(`greatest(date_trunc('week', tl), date_trunc('year', tl))`)
        : refDateSql('tl');
  return `SELECT site_id::DOUBLE AS site_id, year(tl)::DOUBLE AS yr, ${x} AS x,
      ${vars.map((v) => `${stepExpr(v)} AS ${v}`).join(', ')}
    FROM obs WHERE ${where} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
}

export function prepareYears(table: Table | null, params: ViewParams, meta: Meta): YearsData {
  const step = yearStep(params.aggregation);
  const colorBy: YearsData['colorBy'] = params.sites.length <= YEAR_COLOR_MAX_SITES ? 'year' : 'site';
  const base = { variables: params.variables, step, groups: [] as Group[], years: [] as number[], colorBy, legend: [] as string[] };
  if (table === null) return { ...base, rowCount: 0, seriesCount: 0, note: emptyNote(params) };
  const groups = readGroups(table, params.variables, true, YEAR_MAX_STEP[step]);
  const years = [...new Set(groups.map((g) => g.year))].sort((a, b) => a - b);
  let seriesCount = 0;
  for (const v of params.variables) for (const g of groups) if (hasValues(g, v)) seriesCount++;
  const data: YearsData = { ...base, groups, years, rowCount: table.numRows, seriesCount };
  const names = siteNames(meta, params);
  const shownSites = meta.sites.filter((s) => groups.some((g) => g.siteId === s.siteId));
  const shown = shownSites.map((s) => names.get(s.siteId) ?? s.name);
  if (colorBy === 'year' && shown.length === 2) {
    data.lineSites = [shown[0] as string, shown[1] as string];
    data.dashedSite = shownSites[1]?.siteId;
  }
  data.legend = colorBy === 'site' ? shown : [...new Set(groups.map((g) => seriesNameOf(data, names, g)))];
  if (table.numRows === 0) data.note = 'No data for these sites and years.';
  if (params.aggregation === 'raw') data.subtitle = 'Raw data is shown as daily means.';
  if (step === 'week') data.subtitle = WEEK_SPLIT_TEXT;
  if (colorBy === 'year') {
    const key = data.lineSites ? ` Solid line: ${data.lineSites[0]}; dashed line: ${data.lineSites[1]}.` : '';
    data.subtitle = joinSubtitle(data.subtitle, `Colour = year.${key}`);
  }
  data.subtitle = joinSubtitle(data.subtitle, signNote(params.variables), params.events ? eventsKeyText(meta, params) : undefined);
  return data;
}

/** Series name: the site, the year, or with two sites in year mode the site and the year. */
function seriesNameOf(data: YearsData, names: Map<number, string>, g: Group): string {
  const site = names.get(g.siteId) ?? String(g.siteId);
  if (data.colorBy === 'site') return site;
  return data.dashedSite !== undefined ? `${site} ${g.year}` : String(g.year);
}

/** Subtitle for weekly means on a day-of-year axis. */
export const WEEK_SPLIT_TEXT = 'Weekly means (ISO weeks, start Monday). A week over 1 January is split: each part is in its own year.';

/** Year rank of each group within its site, for the line opacity. */
export function yearRanks(groups: Group[]): Map<Group, [number, number]> {
  const bySite = new Map<number, Group[]>();
  for (const g of groups) bySite.set(g.siteId, [...(bySite.get(g.siteId) ?? []), g]);
  const out = new Map<Group, [number, number]>();
  for (const list of bySite.values()) list.forEach((g, i) => out.set(g, [i, list.length]));
  return out;
}

/** Site and year of one series, for the tooltip. Index = series index. */
export interface SeriesInfo {
  siteId: number;
  site: string;
  year: number;
  /** Display unit of the value, for example `µmol CO₂ m⁻² s⁻¹`. */
  unit: string;
}

/** Event marks of one site and year on the reference-year axis. */
export interface YearMark {
  siteId: number;
  year: number;
  mark: EventMark;
}

/**
 * Event marks per site-year group, when `params.events` is on. `px` = px per ms of one
 * x axis. `rowsBy` gives the key of the groups that share an x axis (for the label rows).
 */
export function yearEventMarks(ctx: BuildContext, groups: Group[], px: number, rowsBy: (g: Group) => number = () => 0) {
  const byGroup = new Map<Group, EventMark[]>();
  const all: YearMark[] = [];
  if (!ctx.params.events) return { byGroup, all };
  const events = eventsInRange(ctx.meta, ctx.params);
  const shared = new Map<number, EventMark[]>();
  for (const g of groups) {
    const marks = refYearMarks(events, g.siteId, g.year);
    byGroup.set(g, marks);
    for (const mark of marks) all.push({ siteId: g.siteId, year: g.year, mark });
    const key = rowsBy(g);
    shared.set(key, [...(shared.get(key) ?? []), ...marks]);
  }
  for (const list of shared.values()) setLabelRows(list, px);
  return { byGroup, all };
}

/** px per ms of a reference-year axis of the given width. */
export const refYearPx = (width: number) => Math.max(width, 1) / (REF_END - REF_START);

/** Start and end (exclusive) of the period of a point on the reference-year axis. */
function refPeriod(ms: number, step: YearStep): [number, number] {
  if (step === 'month') {
    const d = new Date(ms);
    return [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)];
  }
  if (step === 'week') return [ms, ms + 7 * DAY];
  return [ms, ms + DAY];
}

/** Tooltip for site-year lines. `info` of each series index gives the site and year. */
export function siteYearTooltip(ctx: BuildContext, step: YearStep, info: SeriesInfo[], marks: YearMark[] = []) {
  const colors = siteColors(ctx.meta, ctx.tokens);
  const names = siteNames(ctx.meta, ctx.params);
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
          return `${p.marker}${esc(s?.site ?? '')} ${s?.year ?? ''}&nbsp;&nbsp;${valueWithUnit(y, s?.unit ?? '')}`;
        });
      // Events of the site-years in this tooltip.
      const shown = new Set(list.map((p) => info[p.seriesIndex]).map((s) => (s ? `${s.siteId}|${s.year}` : '')));
      const [from, to] = refPeriod(first.axisValue, step);
      const events = eventTooltipLines(
        marks.filter((m) => shown.has(`${m.siteId}|${m.year}`)),
        from,
        to,
        names,
        colors,
      );
      return `<b>${dayLabel(first.axisValue, step)}</b><br/>${rows.join('<br/>') || 'No data'}${events}`;
    },
  };
}

/**
 * Layout in px for stacked day-of-year panels. The bottom space holds the month labels
 * and the x axis name. `left` is the smallest left margin; `stackYLayout()` makes it larger for the y axis names.
 */
export const YEAR_STACK = { ...STACK, bottom: X_NAME_SPACE + 6 };

/**
 * Y axis names, tick label widths, the shared left margin and the panel layout for stacked panels.
 * `nameOf(i, panelH)` gives the y axis name of panel `i`. All panels use the same left margin,
 * so that the x axes line up.
 */
export function stackYLayout(
  height: number,
  extents: Array<[number, number]>,
  nameOf: (i: number, panelH: number) => string,
  stack = YEAR_STACK,
) {
  const n = extents.length;
  const panelH = stackLayout(n, height, stack).grid[0]?.height ?? 40;
  const names = extents.map((_, i) => nameOf(i, panelH));
  const widths = extents.map((e) => tickLabelWidth(e));
  const left = Math.max(stack.left, ...names.map((nm, i) => gridLeftFor(widths[i] as number, nameLines(nm))));
  return { layout: stackLayout(n, height, stack, left), names, widths, left };
}

/** Y layout of the years overlay: one panel per variable, name `axisName()`. */
function yLayout(data: YearsData, ctx: BuildContext) {
  // Fixed range of all data (view option), else the range of the loaded rows.
  const ranges = data.variables.map((v) => fixedRange(ctx.params, 'step', v, data.step));
  const extents = data.variables.map((v, i) => axisExtent(v, ranges[i], extent(data.groups, v)));
  const stack = yearsStack(data, ctx.width);
  const name = (i: number, panelH: number) => axisName(ctx.meta, data.variables[i] as Variable, panelH);
  return { ranges, extents, ...stackYLayout(ctx.height, extents, name, stack) };
}

/** Day-of-year x axes of stacked panels. Labels and the axis name on the bottom panel only. */
export function stackDayAxes(tokens: Tokens, n: number, name: string) {
  return Array.from({ length: n }, (_, i) => ({
    ...dayOfYearAxis(tokens, i, i === n - 1),
    ...(i === n - 1 ? xAxisName(tokens, name) : {}),
  }));
}

function build(data: YearsData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const vars = data.variables;
  const y = yLayout(data, ctx);
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta, ctx.params);
  const ranks = yearRanks(data.groups);
  const byYear = data.colorBy === 'year';
  const yColors = yearColors(data.years, tokens);
  const slots = siteSlots(meta);
  // Dash: one colour per year (one or two sites): solid, and dashed for the second site.
  // One colour per site: the dash of the site slot. The symbol is always the symbol of the site.
  const dashOf = (g: Group): LineDash => (byYear ? (g.siteId === data.dashedSite ? 'dashed' : 'solid') : siteDash(slots.get(g.siteId) ?? 0));
  const symbolOf = (g: Group) => siteSymbol(slots.get(g.siteId) ?? 0);
  const plotW = ctx.width - y.left - STACK.right;
  const info: SeriesInfo[] = [];
  const series: unknown[] = [];
  const marks = yearEventMarks(ctx, data.groups, refYearPx(ctx.width - y.left - STACK.right));
  vars.forEach((v, panel) => {
    data.groups.forEach((g, gi) => {
      if (!hasValues(g, v)) return;
      const [rank, count] = ranks.get(g) ?? [0, 1];
      const color = (byYear ? yColors.get(g.year) : colors.get(g.siteId)) ?? tokens.text;
      info.push({ siteId: g.siteId, site: names.get(g.siteId) ?? String(g.siteId), year: g.year, unit: displayUnit(meta, v) });
      series.push({
        type: 'line',
        name: seriesNameOf(data, names, g),
        datasetIndex: gi,
        encode: { x: 'x', y: v },
        xAxisIndex: panel,
        yAxisIndex: panel,
        color,
        ...siteSymbolOptions(slots.get(g.siteId) ?? 0, g.x.length, plotW),
        connectNulls: false,
        lineStyle: {
          width: 1.5,
          opacity: byYear ? 1 : yearOpacity(rank, count),
          type: dashOf(g),
        },
        emphasis: { focus: 'series', lineStyle: { width: 2.5, opacity: 1 } },
        ...eventMarkers(marks.byGroup.get(g) ?? [], color, tokens, panel === 0),
      });
    });
  });
  // The zero lines come after all data series, so that the tooltip index `info` stays correct.
  series.push(...vars.flatMap((v, i) => zeroLineSeries(meta, tokens, v, i, y.extents[i] as [number, number]) ?? []));
  // First group of each legend entry, for the legend icon.
  const legendGroup = new Map<string, Group>();
  for (const g of data.groups) {
    const name = seriesNameOf(data, names, g);
    if (!legendGroup.has(name)) legendGroup.set(name, g);
  }
  return {
    ...baseOption(tokens),
    legend: {
      ...siteLegend(meta, ctx.params, tokens, new Set(), y.left, STACK.right, 'line'),
      // A plain legend wraps to more rows. `yearsStack()` gives the space for the rows.
      type: 'plain',
      itemGap: 10,
      // The legend marks are lines with the dash and the symbol of the site.
      data: data.legend.map((name) => {
        const g = legendGroup.get(name);
        return g ? { name, icon: lineLegendIcon(dashOf(g), symbolOf(g)) } : name;
      }),
    },
    // Panel label and statistic. The unit is in the y axis name.
    title: vars.map((v, i) => ({
      ...y.layout.title[i],
      text: panelTitle(v, statText(v, data.step)),
      textStyle: { fontSize: 13, fontWeight: 600, color: tokens.text },
    })),
    grid: y.layout.grid,
    xAxis: stackDayAxes(tokens, vars.length, dayOfYearAxisName(meta, ctx.params)),
    yAxis: vars.map((v, i) => valueAxis(tokens, i, yAxisName(tokens, y.names[i] as string, y.widths[i] as number), v, y.ranges[i])),
    tooltip: siteYearTooltip(ctx, data.step, info, marks.all),
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
  prepare: prepareYears,
  build,
  showsEvents: true,
  exportStep: yearExportStep,
  widthDependent: true,
  relayout: (data, ctx) => yLayout(data, ctx).layout,
  height: (params, data, width) =>
    stackHeight(params.variables.length, 190, data && !data.note ? yearsStack(data, width) : YEAR_STACK),
  describe: (data) =>
    `One panel per variable. The x axis is the day of the year, ${YEAR_STEP_TEXT[data.step]}. ` +
    `Each line is one site and year: ${data.years.length} years (${data.years[0] ?? ''} to ${data.years[data.years.length - 1] ?? ''}). ` +
    (data.colorBy === 'year'
      ? `The colour shows the year.` + (data.lineSites ? ` Solid lines are ${data.lineSites[0]}, dashed lines are ${data.lineSites[1]}.` : '')
      : `The colour shows the site, and lighter lines are earlier years.`) +
    (data.step === 'week' ? ' A week over 1 January is split: each part is in its own year.' : '') +
    stepStatNote(data.variables, data.step),
};
