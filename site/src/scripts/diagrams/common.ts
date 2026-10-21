// Shared parts of the diagram types: site colours, legend, axes, tooltip style,
// row grouping and the reference year for day-of-year axes.
import * as echarts from 'echarts/core';
import type { Table } from 'apache-arrow';
import { MarkAreaComponent, MarkLineComponent } from 'echarts/components';
import { toFloat64, type Meta, type SiteEvent } from '../db';
import { AGGREGATION_LABELS, VARIABLE_LABELS, type Aggregation, type Variable, type ViewParams } from '../state';
import type { Tokens } from '../theme';
import { periodBounds } from './sql';

// Event markers are drawn with markLine (start day) and markArea (multi-day events).
echarts.use([MarkLineComponent, MarkAreaComponent]);

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

/** Step of the day-of-year diagrams. */
export type YearStep = 'day' | 'week' | 'month';

/** Day-of-year step for the years diagrams. Raw data is shown as daily means. */
export function yearStep(a: Aggregation): YearStep {
  return a === 'raw' ? 'day' : a;
}

/**
 * Longest normal step between two weekly points on a reference-year axis. A week is 7 days.
 * In a year that is not a leap year, a week over the end of February is 8 days on the
 * reference-year axis.
 */
export const WEEK_STEP = 8 * DAY;

/** Longest normal step between two points on a reference-year axis. */
export const YEAR_MAX_STEP: Record<YearStep, number> = { day: DAY_STEP, week: WEEK_STEP, month: 32 * DAY };

/** Text for a year step, for example "weekly means". */
export const YEAR_STEP_TEXT: Record<YearStep, string> = { day: 'daily means', week: 'weekly means', month: 'monthly means' };

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

/** Label of a reference-year time: "14 Mar", "Week of 14 Mar", or "Mar" for monthly data. */
export function dayLabel(ms: number, step: YearStep): string {
  const d = new Date(ms);
  const m = MONTHS[d.getUTCMonth()] as string;
  if (step === 'month') return m;
  return step === 'week' ? `Week of ${d.getUTCDate()} ${m}` : `${d.getUTCDate()} ${m}`;
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

/**
 * Period text, for example "2018 to 2025", "all years", "Mar 2022 to Oct 2023" or
 * "Apr to Jun 2022". A month without a year refers to the first or last data year.
 */
export function yearsText(params: ViewParams): string {
  const { yearFrom: a, yearTo: b, monthFrom: ma, monthTo: mb } = params;
  if (ma === null && mb === null) {
    if (a === null && b === null) return 'all years';
    if (a !== null && b !== null) return a === b ? `year ${a}` : `${a} to ${b}`;
    return a !== null ? `${a} and later` : `up to ${b}`;
  }
  const month = (m: number) => MONTHS[m - 1] ?? String(m);
  if (a !== null && a === b) return `${month(ma ?? 1)} to ${month(mb ?? 12)} ${a}`;
  const from = a !== null ? (ma !== null ? `${month(ma)} ${a}` : String(a)) : ma !== null ? `${month(ma)} of the first year` : null;
  const to = b !== null ? (mb !== null ? `${month(mb)} ${b}` : String(b)) : mb !== null ? `${month(mb)} of the last year` : null;
  if (from !== null && to !== null) return `${from} to ${to}`;
  return from !== null ? `${from} and later` : `up to ${to}`;
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

// ---- Management events (events.parquet, Meta.events)

/** Label of each event type. */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  harvest: 'Harvest',
  cut: 'Cut',
  grazing: 'Grazing',
  fertilisation: 'Fertilisation',
  sowing: 'Sowing',
  tillage: 'Tillage',
  spraying: 'Spraying',
  other: 'Other',
};

/** Short marker label of each event type. It is shown at the top of the marker line. */
export const EVENT_SYMBOLS: Record<string, string> = {
  harvest: 'H',
  cut: 'C',
  grazing: 'G',
  fertilisation: 'F',
  sowing: 'Sw',
  tillage: 'T',
  spraying: 'Sp',
  other: 'O',
};

export const eventLabel = (type: string) => EVENT_TYPE_LABELS[type] ?? type;
export const eventSymbol = (type: string) => EVENT_SYMBOLS[type] ?? '?';

/** Date text of an event: "2022-06-01" or "2022-06-01 to 2022-06-15". */
export function eventDateText(e: SiteEvent): string {
  return e.dateEnd && e.dateEnd !== e.date ? `${e.date} to ${e.dateEnd}` : e.date;
}

/** Epoch ms of 00:00 of a yyyy-mm-dd date, read as UTC. The time axes hold local wall time as UTC. */
export function dateMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Same month and day in the reference year (epoch ms). */
export function refDateMs(date: string): number {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(REF_YEAR, m - 1, d);
}

const ym = ([y, m]: [number, number]) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;

/**
 * Events of the selected sites that overlap the period of the view, sorted by site and date.
 * Event dates are site local calendar days. The period is in site local time too.
 */
export function eventsInRange(meta: Meta, params: ViewParams): SiteEvent[] {
  const sites = new Set(params.sites);
  const { from, to } = periodBounds(params);
  const lo = from ? ym(from) : null;
  const hi = to ? ym(to) : null;
  return meta.events.filter(
    (e) => sites.has(e.siteId) && (lo === null || (e.dateEnd ?? e.date) >= lo) && (hi === null || e.date < hi),
  );
}

/** One event marker on an x axis. `xEnd` is the end of the last day (exclusive) of a multi-day event, else null. */
export interface EventMark {
  event: SiteEvent;
  x: number;
  xEnd: number | null;
  /** Row of the top label: 0 = first row. More rows prevent overlapping labels. */
  row: number;
}

/** Marks on a real time axis (epoch ms of local wall time). */
export function timeMarks(events: SiteEvent[]): EventMark[] {
  return events.map((e) => ({
    event: e,
    x: dateMs(e.date),
    xEnd: e.dateEnd && e.dateEnd !== e.date ? dateMs(e.dateEnd) + DAY : null,
    row: 0,
  }));
}

/**
 * Marks of one site and year on a reference-year axis. A multi-day event that goes
 * over 31 December ends at the end of the reference year.
 */
export function refYearMarks(events: SiteEvent[], siteId: number, year: number): EventMark[] {
  return events
    .filter((e) => e.siteId === siteId && Number(e.date.slice(0, 4)) === year)
    .map((e) => {
      const multi = e.dateEnd !== null && e.dateEnd !== e.date;
      const end = multi && Number((e.dateEnd as string).slice(0, 4)) === year ? refDateMs(e.dateEnd as string) + DAY : REF_END;
      return { event: e, x: refDateMs(e.date), xEnd: multi ? end : null, row: 0 };
    });
}

/** Number of label rows. A fourth label in a crowded place goes back to row 0. */
const LABEL_ROWS = 3;
/** Smallest distance in px between two labels in the same row. */
const LABEL_GAP = 13;

/**
 * Set the label row of each mark, so that labels closer than LABEL_GAP px go to the next row.
 * `px` is the number of px per ms of the x axis at full zoom.
 */
export function setLabelRows(marks: EventMark[], px: number): void {
  const lastX = Array.from({ length: LABEL_ROWS }, () => -Infinity);
  for (const m of [...marks].sort((a, b) => a.x - b.x)) {
    let row = lastX.findIndex((x) => (m.x - x) * px >= LABEL_GAP);
    if (row < 0) row = 0;
    m.row = row;
    lastX[row] = m.x;
  }
}

/**
 * Series options for the event marks of one site: a dashed vertical line at the first day
 * in the site colour, a light band for a multi-day event and, when `label` is true, a small
 * label with the type symbol at the top of the panel. On hover the label shows the type and date.
 * Markers do not change the axis ranges or the series data.
 */
export function eventMarkers(marks: EventMark[], color: string, tokens: Tokens, label: boolean) {
  if (marks.length === 0) return {};
  const spans = marks.filter((m) => m.xEnd !== null);
  return {
    markLine: {
      silent: false,
      animation: false,
      symbol: ['none', 'none'],
      lineStyle: { color, type: 'dashed', width: 1, opacity: 0.9 },
      label: {
        show: label,
        position: 'end',
        fontSize: 9,
        fontWeight: 600,
        color,
        backgroundColor: tokens.surface,
        borderColor: color,
        borderWidth: 0.5,
        borderRadius: 2,
        padding: [1, 2],
      },
      emphasis: { lineStyle: { width: 2, opacity: 1 }, label: { show: true, fontSize: 10 } },
      data: marks.map((m) => ({
        xAxis: m.x,
        name: `${eventLabel(m.event.type)} ${eventDateText(m.event)}`,
        // Below the top of the panel, one row per 13 px.
        label: { formatter: eventSymbol(m.event.type), offset: [0, 13 + m.row * 13] },
        emphasis: { label: { formatter: `${eventLabel(m.event.type)} ${eventDateText(m.event)}` } },
      })),
    },
    ...(spans.length > 0
      ? {
          markArea: {
            silent: true,
            animation: false,
            itemStyle: { color, opacity: 0.1 },
            data: spans.map((m) => [{ xAxis: m.x }, { xAxis: m.xEnd }]),
          },
        }
      : {}),
  };
}

/** Short form of an event detail, for the tooltip and the alt text: about `max` characters, cut at a comma. */
export function shortDetail(detail: string, max = 60): string {
  if (detail.length <= max) return detail;
  const parts = detail.split(', ');
  let out = parts[0] as string;
  for (const p of parts.slice(1)) {
    if (out.length + 2 + p.length > max) break;
    out += `, ${p}`;
  }
  return out.length > max + 20 ? `${out.slice(0, max).trimEnd()}…` : `${out}…`;
}

/** Tooltip lines (HTML) of the events that overlap [from, to). `marks` belong to the sites in `names`. */
export function eventTooltipLines(
  marks: Array<{ siteId: number; mark: EventMark }>,
  from: number,
  to: number,
  names: Map<number, string>,
  colors: Map<number, string>,
): string {
  const rows = marks
    .filter(({ mark }) => mark.x < to && (mark.xEnd ?? mark.x + DAY) > from)
    .map(({ siteId, mark }) => {
      const e = mark.event;
      const color = colors.get(siteId) ?? 'currentColor';
      return (
        `<span style="color:${color}">&#9646;</span> ${esc(names.get(siteId) ?? String(siteId))} · ${esc(eventDateText(e))} · ` +
        `<b>${esc(eventLabel(e.type))}</b> · ${esc(shortDetail(e.detail))}`
      );
    });
  return rows.length ? `<br/>${rows.join('<br/>')}` : '';
}

/** Key of the marker labels for the subtitle, for example "Event markers: H harvest, C cut. A band shows a multi-day event." */
export function eventsKeyText(meta: Meta, params: ViewParams): string {
  const events = eventsInRange(meta, params);
  if (events.length === 0) return 'No management events for the selected sites in this period.';
  const types = Object.keys(EVENT_TYPE_LABELS).filter((t) => events.some((e) => e.type === t));
  const multi = events.some((e) => e.dateEnd !== null && e.dateEnd !== e.date);
  return (
    `Event markers (dashed lines): ${types.map((t) => `${eventSymbol(t)} ${eventLabel(t).toLowerCase()}`).join(', ')}.` +
    (multi ? ' A light band shows a multi-day event.' : '')
  );
}

/** Join the subtitle parts that are not empty. */
export function joinSubtitle(...parts: Array<string | undefined>): string | undefined {
  const text = parts.filter(Boolean).join(' ');
  return text || undefined;
}
