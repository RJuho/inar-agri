// Shared parts of the diagram types: site colours, legend, axes, tooltip style,
// row grouping and the reference year for day-of-year axes.
import * as echarts from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import { AGGREGATION_LABELS, VARIABLE_LABELS, type Aggregation, type Variable, type ViewParams } from '../state';
import type { Tokens } from '../theme';

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;
/**
 * Longest normal step between two daily points on a reference-year axis. In a year
 * that is not a leap year, 28 February is followed by 1 March: a step of 2 days.
 */
export const DAY_STEP = 2 * DAY;

/**
 * Reference year for day-of-year axes. It is a leap year, so 29 February has a place.
 * SQL maps each date to the same month and day in this year.
 */
export const REF_YEAR = 2000;
export const REF_START = Date.UTC(REF_YEAR, 0, 1);
export const REF_END = Date.UTC(REF_YEAR + 1, 0, 1);

/** SQL: epoch ms of the same month and day in the reference year. `expr` is a timestamp or a date. */
export function refDateSql(expr: string, day = `day(${expr})`): string {
  return `epoch_ms(make_date(${REF_YEAR}, month(${expr}), ${day})::TIMESTAMP)::DOUBLE`;
}

/** Day-of-year step for the years diagrams. Raw data is shown as daily means. */
export function yearStep(a: Aggregation): 'day' | 'month' {
  return a === 'month' ? 'month' : 'day';
}

/** Site colour: the slot is the position of the site in sites.parquet. It is the same in all diagrams. */
export function siteColors(meta: Meta, tokens: Tokens): Map<number, string> {
  return new Map(meta.sites.map((s, i) => [s.siteId, tokens.series[i % tokens.series.length] as string]));
}

export function siteNames(meta: Meta): Map<number, string> {
  return new Map(meta.sites.map((s) => [s.siteId, s.name]));
}

export function unitOf(meta: Meta, v: Variable): string {
  return meta.variables.get(v)?.unit ?? '';
}

export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  return v.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3);
}

/** Group digits with a space, for example 20 000. */
export const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const esc = (s: string) => echarts.format.encodeHTML(s);

/** Panel title text: label, then the unit in muted text. Use with `titleStyle()`. */
export function titleText(label: string, unit: string): string {
  return unit ? `${label}  {u|${unit}}` : label;
}

export function titleStyle(tokens: Tokens, size = 13) {
  return {
    fontSize: size,
    fontWeight: 600,
    color: tokens.text,
    rich: { u: { fontSize: size - 1, fontWeight: 400, color: tokens.textMuted } },
  };
}

/** Scroll legend at the top. It lists the shown sites in the order of sites.parquet. */
export function siteLegend(meta: Meta, tokens: Tokens, shown: Set<number>, left: number, right: number) {
  return {
    type: 'scroll',
    top: 0,
    left: left - 8,
    right,
    pageIconColor: tokens.textMuted,
    pageIconInactiveColor: tokens.grid,
    pageTextStyle: { color: tokens.textMuted },
    icon: 'roundRect',
    // Opaque legend marks, also when the series marks are transparent.
    itemStyle: { opacity: 1 },
    itemWidth: 14,
    itemHeight: 4,
    textStyle: { color: tokens.text },
    inactiveColor: tokens.grid,
    data: meta.sites.filter((s) => shown.has(s.siteId)).map((s) => s.name),
  };
}

/** Option parts that all diagram types use. */
export function baseOption(tokens: Tokens) {
  return {
    animation: false,
    useUTC: true,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'system-ui, sans-serif', color: tokens.text },
    color: tokens.series,
  };
}

export function tooltipBase(tokens: Tokens, trigger: 'axis' | 'item') {
  return {
    trigger,
    confine: true,
    backgroundColor: tokens.surface,
    borderColor: tokens.grid,
    textStyle: { color: tokens.text, fontSize: 12 },
  };
}

export function valueAxis(tokens: Tokens, gridIndex: number, extra: Record<string, unknown> = {}) {
  return {
    type: 'value',
    gridIndex,
    scale: true,
    splitNumber: 3,
    axisLine: { show: false },
    axisLabel: { color: tokens.textMuted, hideOverlap: true },
    splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
    ...extra,
  };
}

/** Time axis over the reference year. The labels show the month only. */
export function dayOfYearAxis(tokens: Tokens, gridIndex: number, showLabels: boolean, splitNumber = 6, showMaxLabel = true) {
  return {
    type: 'time',
    gridIndex,
    min: REF_START,
    max: REF_END,
    splitNumber,
    axisLine: { lineStyle: { color: tokens.axis } },
    axisTick: { show: showLabels },
    axisLabel: {
      show: showLabels,
      color: tokens.textMuted,
      hideOverlap: true,
      showMaxLabel,
      formatter: { year: '{MMM}', month: '{MMM}', day: '{d} {MMM}' },
    },
    splitLine: { show: true, lineStyle: { color: tokens.grid, width: 1 } },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

/** Label of a reference-year time: "14 Mar", or "Mar" for monthly data. */
export function dayLabel(ms: number, step: 'day' | 'month'): string {
  const d = new Date(ms);
  const m = MONTHS[d.getUTCMonth()] as string;
  return step === 'month' ? m : `${d.getUTCDate()} ${m}`;
}

/** Text for the step setting, for example "daily means". */
export function stepText(a: Aggregation): string {
  return AGGREGATION_LABELS[a].toLowerCase();
}

export function varLabel(v: Variable): string {
  return VARIABLE_LABELS[v];
}

/** Note for parameters that give no query. */
export function emptyNote(params: ViewParams): string {
  return params.sites.length === 0 ? 'Select one or more sites.' : 'Select one or more variables.';
}

/**
 * One group of rows: one site, or one site and year.
 * `x` and the value arrays have the same length. NaN marks a missing value or a gap.
 */
export interface Group {
  siteId: number;
  year: number;
  x: Float64Array;
  values: Partial<Record<Variable, Float64Array>>;
}

/**
 * Read a sorted query result into groups. The rows must be sorted by site_id, then yr
 * (when `byYear`), then x. Where the x step is longer than `maxStep`, add one NaN row,
 * so that ECharts draws a gap there.
 */
export function readGroups(table: Table, vars: Variable[], byYear: boolean, maxStep = Infinity): Group[] {
  const n = table.numRows;
  const site = toFloat64(table.getChild('site_id'), n);
  const yr = byYear ? toFloat64(table.getChild('yr'), n) : new Float64Array(n);
  const x = toFloat64(table.getChild('x'), n);
  const cols = new Map(vars.map((v) => [v, toFloat64(table.getChild(v), n)]));
  const groups: Group[] = [];
  let start = 0;
  while (start < n) {
    let end = start;
    let gaps = 0;
    while (end < n && site[end] === site[start] && yr[end] === yr[start]) {
      if (end > start && (x[end] as number) - (x[end - 1] as number) > maxStep) gaps++;
      end++;
    }
    const len = end - start + gaps;
    const gx = new Float64Array(len);
    const gv: Partial<Record<Variable, Float64Array>> = {};
    for (const v of vars) gv[v] = new Float64Array(len);
    let k = 0;
    for (let i = start; i < end; i++) {
      if (i > start && (x[i] as number) - (x[i - 1] as number) > maxStep) {
        gx[k] = (x[i - 1] as number) + 1;
        for (const v of vars) (gv[v] as Float64Array)[k] = Number.NaN;
        k++;
      }
      gx[k] = x[i] as number;
      for (const v of vars) (gv[v] as Float64Array)[k] = (cols.get(v) as Float64Array)[i] as number;
      k++;
    }
    groups.push({ siteId: site[start] as number, year: yr[start] as number, x: gx, values: gv });
    start = end;
  }
  return groups;
}

/** True when the group has one or more finite values of `v`. */
export function hasValues(g: Group, v: Variable): boolean {
  const a = g.values[v];
  if (!a) return false;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) return true;
  return false;
}

/** Min and max of the finite values of `v` in all groups. */
export function extent(groups: Group[], v: Variable): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of groups) {
    const a = g.values[v];
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const y = a[i] as number;
      if (Number.isFinite(y)) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** Axis range rounded outwards to a nice step (1, 2 or 5 times a power of 10), about 4 steps. */
export function niceRange([lo, hi]: [number, number]): { min: number; max: number; interval: number } {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  // Round to remove float noise such as 0.30000000000000004.
  const round = (v: number) => Number(v.toPrecision(12));
  return { min: round(Math.floor(lo / step) * step), max: round(Math.ceil(hi / step) * step), interval: round(step) };
}

/** Years text, for example "2018 to 2025" or "all years". */
export function yearsText(params: ViewParams): string {
  const { yearFrom: a, yearTo: b } = params;
  if (a === null && b === null) return 'all years';
  if (a !== null && b !== null) return a === b ? `year ${a}` : `${a} to ${b}`;
  return a !== null ? `${a} and later` : `up to ${b}`;
}

/** Layout in px for diagrams with stacked panels (one panel per variable). */
export const STACK = { top: 24, bottom: 36, gap: 34, left: 56, right: 16 };

/** Grid and title positions for `n` stacked panels in a chart of the given height. */
export function stackLayout(n: number, height: number, layout = STACK) {
  const k = Math.max(n, 1);
  const panelH = Math.max(40, (height - layout.top - layout.bottom - layout.gap * k) / k);
  const tops = Array.from({ length: n }, (_, i) => layout.top + layout.gap * (i + 1) + panelH * i);
  return {
    grid: tops.map((top) => ({ top, height: panelH, left: layout.left, right: layout.right })),
    title: tops.map((top) => ({ top: top - 24, left: layout.left - 8 })),
  };
}

/** Chart height for `n` stacked panels of `panelH` px. */
export function stackHeight(n: number, panelH: number, layout = STACK): number {
  return n === 0 ? 160 : layout.top + layout.bottom + n * (panelH + layout.gap);
}

/** Opacity of the line of year number `i` of `n` (sorted, oldest first). The newest year is opaque. */
export function yearOpacity(i: number, n: number): number {
  return n <= 1 ? 1 : 0.3 + (0.7 * i) / (n - 1);
}
