// Data coverage: a heatmap per variable with the calendar month (site local time) on the x axis and
// the site on the y axis. The cell colour and label give the share of half hours in the month that
// have a value. For measured NEE the share counts the measured values only (`nee_qc = 0`).
// The expected number of half hours is 48 × the days of the month. A month without rows gives an
// empty (transparent) cell. A month with missing rows gives less than 100 %.
// The diagram always counts the 30-minute rows. The step setting does not apply.
import * as echarts from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import { VisualMapComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import { AGGREGATION_LABELS, VARIABLE_LABELS, type Variable, type ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, periodBounds, whereClause } from './sql';
import {
  FIXED_GRID,
  X_NAME_SPACE,
  baseOption,
  emptyNote,
  esc,
  gridLeftFor,
  groupDigits,
  panelTitle,
  siteLabel,
  siteNames,
  textWidth,
  timeAxisName,
  titleStyle,
  tooltipBase,
  xAxisName,
  yAxisName,
} from './common';

echarts.use([HeatmapChart, VisualMapComponent]);

/** Half hours per day. */
const PER_DAY = 48;
/** Height in px of one site row. */
const ROW_H = 26;
/** Smallest cell width in px that gets a percentage label. */
const LABEL_MIN_W = 28;
/** More months than this: x labels at January only (and at the first month). */
const ALL_LABELS_MAX = 24;
/** Height in px of the colour bar area below the x axis name. */
const BAR_H = 36;
/** Layout in px. `gap` is the space above each panel for its title. */
const LAYOUT = { top: 4, bottom: X_NAME_SPACE + 4 + BAR_H, gap: 34, left: 56, right: 16 };

/**
 * Sequential colour ramp 0 to 100 % (viridis stops). It is the only hard-coded colour: the scale must
 * be the same in light and dark mode. Both ends differ from the surface colour of both themes, so an
 * empty cell (no rows, transparent) is not the same as 0 %.
 */
const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
/** Label colours on the dark and the light part of the ramp. */
const LABEL_DARK = '#111111';
const LABEL_LIGHT = '#f4f4f4';
/** Share from which the cell colour is light enough for a dark label. */
const LABEL_SWITCH = 60;

/** One cell: month index, site row index, counts. */
interface Cell {
  x: number;
  y: number;
  /** Half hours with a value. */
  n: number;
  /** Expected half hours: 48 × days of the month. */
  expected: number;
}

interface CoverageData extends Prepared {
  variables: Variable[];
  /** Months of the x axis, `yyyy-mm`. */
  months: string[];
  /** Site ids of the rows, in the order of sites.parquet. */
  siteIds: number[];
  /** Cells per variable, in the order of `variables`. */
  cells: Cell[][];
}

/**
 * Count expression of a variable: the non-NULL values. For measured NEE only the values with the quality
 * flag 0 (measured) or without a flag: Maktau has no flag (`nee_qc` NULL), and its `nee` is the measured flux.
 */
function countExpr(v: string): string {
  return v === 'nee' ? `count(nee) FILTER (WHERE nee_qc = 0 OR nee_qc IS NULL)` : `count(${v})`;
}

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0) return null;
  const vars = params.variables.map(col);
  // m: first instant of the month in local time, as epoch ms (the local wall time read as UTC).
  return `SELECT site_id::DOUBLE AS site_id, epoch_ms(date_trunc('month', tl))::DOUBLE AS m,
      ${vars.map((v) => `${countExpr(v)}::DOUBLE AS ${v}`).join(', ')}
    FROM obs WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`;
}

/** `yyyy-mm` of a month given as epoch ms. */
const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** Half hours in the month `yyyy-mm`. */
function expectedOf(key: string): number {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate() * PER_DAY;
}

/** List of the months from `first` to `last` (`yyyy-mm`, both included). */
function monthList(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  for (let i = 0; i < 2400; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Months of the x axis: the period limits where set, else the first and last month with rows. */
function monthRange(params: ViewParams, keys: string[]): string[] {
  const sorted = [...keys].sort();
  const { from, to } = periodBounds(params);
  const pad = ([y, m]: [number, number]) => `${y}-${String(m).padStart(2, '0')}`;
  const first = from ? pad(from) : (sorted[0] as string);
  // `to` is the first month after the period.
  let last = sorted[sorted.length - 1] as string;
  if (to) {
    const [y, m] = to;
    last = m === 1 ? pad([y - 1, 12]) : pad([y, m - 1]);
  }
  return first <= last ? monthList(first, last) : [];
}

function prepare(table: Table | null, params: ViewParams, meta: Meta): CoverageData {
  const siteIds = meta.sites.filter((s) => params.sites.includes(s.siteId)).map((s) => s.siteId);
  const base = { variables: params.variables, months: [] as string[], siteIds, cells: [] as Cell[][] };
  if (table === null) return { ...base, rowCount: 0, seriesCount: 0, note: emptyNote(params) };
  const n = table.numRows;
  if (n === 0) return { ...base, rowCount: 0, seriesCount: 0, note: 'No data for these sites and years.' };
  const site = toFloat64(table.getChild('site_id'), n);
  const m = toFloat64(table.getChild('m'), n);
  const keys = Array.from(m, (ms) => monthKey(ms as number));
  const months = monthRange(params, keys);
  const monthIndex = new Map(months.map((k, i) => [k, i]));
  const rowIndex = new Map(siteIds.map((id, i) => [id, i]));
  const cells: Cell[][] = params.variables.map((v) => {
    const counts = toFloat64(table.getChild(v), n);
    const list: Cell[] = [];
    for (let i = 0; i < n; i++) {
      const x = monthIndex.get(keys[i] as string);
      const y = rowIndex.get(site[i] as number);
      if (x === undefined || y === undefined) continue;
      list.push({ x, y, n: counts[i] as number, expected: expectedOf(keys[i] as string) });
    }
    return list;
  });
  const hasNee = params.variables.includes('nee');
  const subtitle =
    `Share of the half hours in each month with a value, from the 30-minute rows; the step setting does not apply. ` +
    `Expected: 48 half hours per day. Empty cells = no rows.` +
    (hasNee ? ' Measured NEE counts the measured values only (quality flag 0, or no flag).' : '');
  return { ...base, months, cells, rowCount: n, seriesCount: params.variables.length, subtitle };
}

/** Share in percent of a cell. */
const share = (c: Cell) => (c.expected > 0 ? (100 * c.n) / c.expected : 0);

/** Width of the widest site name (the y tick labels). */
function labelWidth(data: CoverageData, meta: Meta, params: ViewParams): number {
  const names = meta.sites.filter((s) => data.siteIds.includes(s.siteId)).map((s) => siteLabel(s, params));
  return Math.ceil(Math.max(0, ...names.map((t) => textWidth(t))));
}

/** Grid and title positions. The chart height gives no freedom: the rows have a fixed height. */
function layout(data: CoverageData, left: number) {
  const panelH = Math.max(ROW_H, data.siteIds.length * ROW_H);
  const grid: Array<Record<string, unknown>> = [];
  const title: Array<{ top: number; left: number }> = [];
  let y = LAYOUT.top;
  for (let i = 0; i < data.variables.length; i++) {
    y += LAYOUT.gap;
    grid.push({ top: y, height: panelH, left, right: LAYOUT.right, ...FIXED_GRID });
    title.push({ top: y - 24, left: left - 8 });
    y += panelH;
  }
  return { grid, title, panelH, bottom: y };
}

/** Left margin of all panels: the site names and the y axis name. */
function leftFor(data: CoverageData, meta: Meta, params: ViewParams): { width: number; left: number } {
  const width = labelWidth(data, meta, params);
  return { width, left: Math.max(LAYOUT.left, gridLeftFor(width, 1)) };
}

/** Which months get an x tick and a label. */
function xLabelShow(months: string[]): (idx: number) => boolean {
  if (months.length <= ALL_LABELS_MAX) return () => true;
  return (idx) => idx === 0 || (months[idx] ?? '').endsWith('-01');
}

/** Colour bar below the x axis name, shared by all panels. */
function visualMap(data: CoverageData, tokens: BuildContext['tokens'], lay: ReturnType<typeof layout>, left: number) {
  return {
    type: 'continuous',
    calculable: false,
    orient: 'horizontal',
    left: left + 2,
    top: lay.bottom + X_NAME_SPACE + 6,
    itemWidth: 10,
    itemHeight: 160,
    min: 0,
    max: 100,
    precision: 0,
    inRange: { color: RAMP },
    // Duplicate rows can give more than 100 %. Such a cell gets the end colour.
    outOfRange: { color: [RAMP[0], RAMP[RAMP.length - 1]] },
    text: ['100 %', '0 %'],
    textGap: 6,
    textStyle: { color: tokens.textMuted, fontSize: 11 },
    seriesIndex: data.variables.map((_, i) => i),
    hoverLink: false,
    z: 4,
  };
}

function build(data: CoverageData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const y = leftFor(data, meta, ctx.params);
  const lay = layout(data, y.left);
  const last = data.variables.length - 1;
  const names = siteNames(meta, ctx.params);
  const rowNames = data.siteIds.map((id) => names.get(id) ?? String(id));
  const show = xLabelShow(data.months);
  const cellW = (ctx.width - y.left - LAYOUT.right) / Math.max(1, data.months.length);
  const labels = ctx.width > 0 && cellW >= LABEL_MIN_W;
  return {
    ...baseOption(tokens),
    title: data.variables.map((v, i) => ({
      ...lay.title[i],
      text: panelTitle(v, v === 'nee' ? 'share measured' : 'coverage'),
      textStyle: titleStyle(tokens),
    })),
    grid: lay.grid,
    xAxis: data.variables.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: data.months,
      axisLine: { lineStyle: { color: tokens.axis } },
      axisTick: { show: i === last, alignWithLabel: true, interval: (idx: number) => show(idx) },
      axisLabel: { show: i === last, color: tokens.textMuted, hideOverlap: true, interval: (idx: number) => show(idx) },
      splitLine: { show: false },
      ...(i === last ? xAxisName(tokens, timeAxisName(meta, ctx.params, 'Month')) : {}),
    })),
    yAxis: data.variables.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: rowNames,
      // The first site at the top.
      inverse: true,
      axisLine: { show: true, lineStyle: { color: tokens.axis } },
      axisTick: { show: false },
      axisLabel: { color: tokens.text },
      splitLine: { show: false },
      ...yAxisName(tokens, 'Site', y.width),
    })),
    visualMap: visualMap(data, tokens, lay, y.left),
    tooltip: {
      ...tooltipBase(tokens, 'item'),
      formatter: (raw: unknown) => {
        const p = raw as { seriesIndex: number; data: { value: [number, number, number]; cell: Cell } };
        const v = data.variables[p.seriesIndex];
        const c = p.data?.cell;
        if (!v || !c) return '';
        const what = v === 'nee' ? 'measured' : 'with a value';
        return (
          `<b>${esc(rowNames[c.y] ?? '')}</b> · ${esc(data.months[c.x] ?? '')}<br/>` +
          `${esc(VARIABLE_LABELS[v])}: <b>${Math.round(share(c))} %</b> ` +
          `(${groupDigits(c.n)} of ${groupDigits(c.expected)} half hours ${what})`
        );
      },
    },
    series: data.variables.map((v, i) => ({
      type: 'heatmap',
      name: VARIABLE_LABELS[v],
      xAxisIndex: i,
      yAxisIndex: i,
      data: (data.cells[i] ?? []).map((c) => {
        const pct = share(c);
        return { value: [c.x, c.y, Math.min(100, pct)], cell: c, label: { color: pct >= LABEL_SWITCH ? LABEL_DARK : LABEL_LIGHT } };
      }),
      label: {
        show: labels,
        fontSize: 10,
        formatter: (p: unknown) => `${Math.round((p as { value: [number, number, number] }).value[2])}`,
      },
      // Draw all cells in one frame, so that the PNG export has the full image.
      progressive: 0,
      emphasis: { disabled: true },
      itemStyle: { borderColor: tokens.surface, borderWidth: 1 },
    })),
  };
}

/** Chart height in px: the rows have a fixed height, the chart grows with the sites and variables. */
function heightOf(variables: number, sites: number): number {
  if (variables === 0) return 160;
  const panelH = Math.max(ROW_H, sites * ROW_H);
  return LAYOUT.top + LAYOUT.bottom + variables * (LAYOUT.gap + panelH);
}

export const coverage: DiagramDef<CoverageData> = {
  type: 'coverage',
  label: 'Data coverage (site × month)',
  query,
  prepare,
  build,
  showsEvents: false,
  usesFixedRange: false,
  // Always the 30-min rows, at all steps.
  exportStep: () => AGGREGATION_LABELS.raw,
  widthDependent: true,
  relayout: (data, ctx) => {
    const y = leftFor(data, ctx.meta, ctx.params);
    const lay = layout(data, y.left);
    return { grid: lay.grid, title: lay.title, visualMap: visualMap(data, ctx.tokens, lay, y.left) };
  },
  height: (params, data) => heightOf(params.variables.length, data ? data.siteIds.length : params.sites.length),
  describe: (data) => {
    const n = data.variables.length;
    return (
      `Coverage heatmap: months on the x axis, sites on the y axis, one panel per variable (${n}); ` +
      `colour and label give the share of half hours with a value (for measured NEE: with a measured value); empty cells have no rows.`
    );
  },
};
