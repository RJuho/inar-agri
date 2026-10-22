// Shared parts of the diagram types: site colours, legend, axes, tooltip style,
// row grouping and the reference year for day-of-year axes.
import * as echarts from 'echarts/core';
import type { Table } from 'apache-arrow';
import { MarkAreaComponent, MarkLineComponent } from 'echarts/components';
import { toFloat64, type Meta, type Site, type SiteEvent } from '../db';
import { AGGREGATION_LABELS, VARIABLE_LABELS, type Aggregation, type Variable, type ViewParams } from '../state';
import type { Tokens } from '../theme';
import { siteEmoji } from '../sites';
import { CIRCULAR_VARS, SUM_VARS, periodBounds } from './sql';
import { niceStep } from './nice.ts';
import type { NiceRange } from '../axisRanges';

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

/**
 * Site name for the charts and the alt text. When the view option "Site emojis" is on,
 * the site emoji and a space come before the name, for example "🐂🐝 Qvidja".
 * The data export and the file names do not use this: they keep the plain name.
 */
export function siteLabel(site: Site, params: ViewParams): string {
  const emoji = params.emojis ? siteEmoji(site.code) : '';
  return emoji ? `${emoji} ${site.name}` : site.name;
}

/** Site labels (`siteLabel()`) by site key. */
export function siteNames(meta: Meta, params: ViewParams): Map<number, string> {
  return new Map(meta.sites.map((s) => [s.siteId, siteLabel(s, params)]));
}

/** Site labels (`siteLabel()`) of the selected sites, in the order of sites.parquet. */
export function selectedSiteLabels(meta: Meta, params: ViewParams): string[] {
  return meta.sites.filter((s) => params.sites.includes(s.siteId)).map((s) => siteLabel(s, params));
}

/** Raw unit string from variables.parquet, for example `µmol CO2 m-2 s-1`. The data export uses it. */
export function unitOf(meta: Meta, v: Variable): string {
  return meta.variables.get(v)?.unit ?? '';
}

/** Super- and subscript digits. Index = digit. */
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const sup = (c: string) => (c === '-' ? '⁻' : (SUP_DIGITS[Number(c)] ?? c));
const sub = (c: string) => SUB_DIGITS[Number(c)] ?? c;
/** Chemical formulas in units and symbols. Their digits are subscripts. */
const FORMULA = /\b(CO2|CH4|N2O|H2O)\b/g;

/** Chemical formula with subscript digits: CO2 → CO₂, CH4 → CH₄. */
export function formulaText(s: string): string {
  return s.replace(FORMULA, (f) => f.replace(/\d/g, sub));
}

/**
 * Display form of a unit, with Unicode super- and subscripts: `µmol CO2 m-2 s-1` → `µmol CO₂ m⁻² s⁻¹`,
 * `m3 m-3` → `m³ m⁻³`, `g CH4-C m-2` → `g CH₄-C m⁻²`. Only for display: the data export keeps the raw unit.
 */
export function unitText(unit: string): string {
  return unit
    .split(' ')
    .map((tok) => {
      if (/^(CO2|CH4|N2O|H2O)/.test(tok)) return formulaText(tok);
      if (tok === 'degrees') return '°';
      const m = /^([A-Za-zµ]+)(-?\d+)$/.exec(tok);
      return m ? `${m[1]}${[...(m[2] as string)].map(sup).join('')}` : tok;
    })
    .join(' ');
}

/** Display unit of a variable, for axis names and tooltips. */
export function displayUnit(meta: Meta, v: Variable): string {
  return unitText(unitOf(meta, v));
}

/** Short symbol of each variable for the axis names. Plain text that all fonts have. */
export const VARIABLE_SYMBOLS: Record<Variable, string> = {
  nee: 'NEE',
  nee_f: 'NEE',
  gpp: 'GPP',
  reco: 'Reco',
  gpp_src: 'GPP',
  reco_src: 'Reco',
  ch4: 'F CH₄',
  ta: 'Tair',
  tsoil: 'Tsoil',
  swc: 'SWC',
  sw_in: 'SWin',
  ppfd: 'PPFD',
  rh: 'RH',
  vpd: 'VPD',
  ustar: 'u*',
  n2o: 'F N₂O',
  le: 'LE',
  precip: 'P',
  pa: 'PA',
  ws: 'WS',
  wd: 'WD',
  netrad: 'Rn',
  sw_out: 'SWout',
  g: 'G',
};

/**
 * Variables with a sign convention: gas fluxes and energy fluxes. They have a zero line, and the
 * fingerprint gives them a diverging colour scale around 0. The carbon sums (cumulative, budget)
 * do not use this set: they have their own list of carbon and CH4 fluxes.
 */
export const FLUX_VARS: ReadonlySet<Variable> = new Set<Variable>([
  'nee', 'nee_f', 'gpp', 'reco', 'gpp_src', 'reco_src', 'ch4', 'n2o', 'le', 'netrad', 'g',
]);

/** Font of the axis names and of the tick labels (ECharts default size 12). */
const NAME_SIZE = 11;
const NAME_FONT = `${NAME_SIZE}px system-ui, sans-serif`;
const LABEL_FONT = '12px system-ui, sans-serif';
/** Line height of a two-line axis name. */
const NAME_LINE = 13;

/** Width in px of a text, measured with the ECharts text measurer. */
export function textWidth(text: string, font = LABEL_FONT): number {
  return echarts.format.getTextRect(text, font).width;
}

/**
 * Axis name text "<symbol> (<unit>)", for example `NEE (µmol CO₂ m⁻² s⁻¹)`. When the text is longer
 * than `room` px (the panel height for a y axis), the unit goes on a second line.
 */
export function axisNameText(symbol: string, unit: string, room = Infinity): string {
  if (!unit) return symbol;
  const one = `${symbol} (${unit})`;
  return textWidth(one, NAME_FONT) + 8 <= room ? one : `${symbol}\n(${unit})`;
}

/** Y axis name of a variable, for example `NEE (µmol CO₂ m⁻² s⁻¹)`. `room` = panel height in px. */
export function axisName(meta: Meta, v: Variable, room = Infinity): string {
  return axisNameText(VARIABLE_SYMBOLS[v], displayUnit(meta, v), room);
}

/** Number of lines of an axis name. */
export const nameLines = (name: string) => name.split('\n').length;

/**
 * Width in px of the widest y tick label for values in `[lo, hi]`. It is an estimate:
 * ECharts selects the ticks itself, so this function measures nice values with
 * about `splitNumber` steps and adds the thousands separators of ECharts.
 */
export function tickLabelWidth([lo, hi]: [number, number], splitNumber = 3): number {
  const span = hi - lo || Math.abs(hi) || 1;
  const step = niceStep(span / splitNumber);
  // ECharts can select a step down to about half of this step (for example 0.05 in place of 0.1).
  // Count the decimals of that smaller step, so that the estimate is not too small.
  const decimals = Math.max(0, -Math.floor(Math.log10(niceStep(span / (2 * splitNumber))) + 1e-9));
  const label = (v: number) => {
    const [i, f] = Math.abs(v).toFixed(decimals).split('.') as [string, string | undefined];
    return `${v < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`;
  };
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  return Math.ceil(Math.max(textWidth(label(a)), textWidth(label(b)), textWidth(label(a + step))));
}

/** Distance in px from the axis line to a y axis name, so that the name clears the tick labels. */
export function yNameGap(labelWidth: number): number {
  // 8 px label margin of ECharts, then 6 px space.
  return Math.ceil(labelWidth) + 14;
}

/**
 * Grid `left` in px for y axes with names: space for the tick labels, the name (one or two lines)
 * and 4 px at the chart edge. Use the largest value of all panels, so that the panels line up.
 */
export function gridLeftFor(labelWidth: number, lines = 1): number {
  return yNameGap(labelWidth) + lines * NAME_LINE + 4;
}

/**
 * Grid option part that turns off the automatic outer bounds of ECharts 6. Without it, ECharts makes a
 * grid smaller when its tick labels or axis name go outside the chart, and the panels do not line up.
 * Use it with a `left` margin from `gridLeftFor()`.
 */
export const FIXED_GRID = { outerBoundsMode: 'none' } as const;

/**
 * Option part of a y axis name: name at the middle of the axis, turned 90°, in muted text.
 * Give it to `valueAxis()` in `extra`. `labelWidth` is the widest tick label (`tickLabelWidth()`).
 */
export function yAxisName(tokens: Tokens, name: string, labelWidth: number) {
  return {
    name,
    nameLocation: 'middle',
    nameRotate: 90,
    nameGap: yNameGap(labelWidth),
    nameTextStyle: { color: tokens.textMuted, fontSize: NAME_SIZE, lineHeight: NAME_LINE, align: 'center' },
  };
}

/**
 * Option part of an x axis name: name at the middle below the axis, in muted text.
 * `gap` is the distance in px from the axis line (the tick labels take about 22 px).
 */
export function xAxisName(tokens: Tokens, name: string, gap = 28) {
  return {
    name,
    nameLocation: 'middle',
    nameGap: gap,
    nameTextStyle: { color: tokens.textMuted, fontSize: NAME_SIZE, lineHeight: NAME_LINE },
  };
}

/** Space in px below the x axis line for the tick labels and the x axis name of `xAxisName()`. */
export const X_NAME_SPACE = 44;

/**
 * Id prefix of a title element that is an x axis name. Use it when one name is for many small
 * panels (`yearPanels`). `axesText()` in alttext.ts reads these titles as x axis names.
 */
export const X_NAME_TITLE_ID = 'x-axis-name';

/**
 * X axis name of a time axis in site local time. One UTC offset for all selected sites gives
 * "Date (local time, UTC+2)". Different offsets give "Date (site local time: UTC+2 Finland, UTC+3 Maktau)".
 */
export function timeAxisName(meta: Meta, params: ViewParams, what = 'Date'): string {
  return `${what} (${localTimeText(meta, params)})`;
}

/**
 * X axis name of a day-of-year axis (reference year, month labels), for example
 * "Day of year (month labels; local time, UTC+2)". Mixed UTC offsets give the site local time text.
 */
export function dayOfYearAxisName(meta: Meta, params: ViewParams): string {
  return `Day of year (month labels; ${localTimeText(meta, params)})`;
}

const COUNTRY_NAMES: Record<string, string> ={ FI: 'Finland', KE: 'Kenya' };

/** "local time, UTC+2" or "site local time: UTC+2 Finland, UTC+3 Maktau" for the selected sites. */
export function localTimeText(meta: Meta, params: ViewParams): string {
  const selected = new Set(params.sites);
  const byOffset = new Map<number, Site[]>();
  for (const s of meta.sites) {
    if (!selected.has(s.siteId)) continue;
    const list = byOffset.get(s.utcOffsetMin) ?? [];
    list.push(s);
    byOffset.set(s.utcOffsetMin, list);
  }
  const offsets = [...byOffset.keys()].sort((a, b) => a - b);
  if (offsets.length === 0) return 'local time';
  if (offsets.length === 1) return `local time, ${utcText(offsets[0] as number)}`;
  const parts = offsets.map((o) => {
    const sites = byOffset.get(o) as Site[];
    const country = sites[0]?.country ?? '';
    const where =
      sites.length > 1 && sites.every((s) => s.country === country)
        ? (COUNTRY_NAMES[country] ?? country)
        : sites.map((s) => s.name).join(', ');
    return `${utcText(o)} ${where}`;
  });
  return `site local time: ${parts.join(', ')}`;
}

/** "UTC+2", "UTC+5:30" or "UTC" for an offset in minutes. */
export function utcText(min: number): string {
  if (min === 0) return 'UTC';
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return `UTC${min < 0 ? '−' : '+'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/**
 * Sign convention for the subtitle, when one or more flux variables are shown, else undefined.
 * Add it with `joinSubtitle()`.
 */
export function signNote(vars: readonly Variable[]): string | undefined {
  const parts: string[] = [];
  if (vars.some((v) => v === 'nee' || v === 'nee_f')) parts.push('NEE < 0 = net CO₂ uptake by the ecosystem');
  if (vars.some((v) => v === 'gpp' || v === 'gpp_src' || v === 'reco' || v === 'reco_src')) parts.push('GPP and Reco ≥ 0');
  if (vars.includes('ch4')) parts.push('F CH₄ > 0 = emission to the atmosphere');
  if (vars.includes('n2o')) parts.push('F N₂O > 0 = emission to the atmosphere');
  if (vars.includes('le')) parts.push('LE > 0 = upward (evapotranspiration)');
  if (vars.includes('netrad')) parts.push('Rn > 0 = energy into the surface');
  if (vars.includes('g')) parts.push('G > 0 = heat into the soil');
  return parts.length ? `Sign convention: ${parts.join('; ')}.` : undefined;
}

/** True when the panel of `v` gets a zero line: flux variables and temperatures (°C). */
export function hasZeroLine(meta: Meta, v: Variable): boolean {
  return FLUX_VARS.has(v) || unitOf(meta, v) === '°C';
}

/**
 * Series that draws a thin solid line at y = 0 in one panel. It has no data, so it does not
 * change the axis range, the tooltip or `data-series`. Put it after all data series, so that
 * the series index of the data series does not change. Returns null when the panel has no zero
 * line (`hasZeroLine()`) or when 0 is not in `[lo, hi]` of the data (the line would be outside the grid).
 * It is always a line series, also in bar charts: an empty bar series takes one bar position
 * in each category group and moves the bars.
 */
export function zeroLineSeries(
  meta: Meta,
  tokens: Tokens,
  v: Variable,
  axisIndex: number,
  [lo, hi]: [number, number],
) {
  if (!hasZeroLine(meta, v) || !(lo <= 0 && hi >= 0)) return null;
  return {
    type: 'line',
    id: `zero-${axisIndex}`,
    name: '',
    xAxisIndex: axisIndex,
    yAxisIndex: axisIndex,
    data: [],
    silent: true,
    tooltip: { show: false },
    markLine: {
      silent: true,
      animation: false,
      symbol: ['none', 'none'],
      label: { show: false },
      lineStyle: { color: tokens.axis, type: 'solid', width: 1, opacity: 0.8 },
      emphasis: { disabled: true },
      data: [{ yAxis: 0 }],
    },
  };
}

/** Statistic of a step for panel titles: "30-min values", "daily mean", "weekly mean" or "monthly mean". */
export const STAT_TEXT: Record<Aggregation, string> = {
  raw: '30-min values',
  day: 'daily mean',
  week: 'weekly mean',
  month: 'monthly mean',
};

/**
 * Statistic of a step for one variable: `STAT_TEXT`, but "sum" for precipitation ("daily sum")
 * and "circular mean" for wind direction. Raw data stays "30-min values".
 */
export function statText(v: Variable, a: Aggregation): string {
  if (a === 'raw') return STAT_TEXT[a];
  if (SUM_VARS.has(v)) return STAT_TEXT[a].replace('mean', 'sum');
  if (CIRCULAR_VARS.has(v)) return STAT_TEXT[a].replace('mean', 'circular mean');
  return STAT_TEXT[a];
}

/**
 * Sentence for the alt text when a time step does not give the mean of a variable:
 * precipitation gives the sum, wind direction the circular mean. Empty for raw data.
 */
export function stepStatNote(vars: readonly Variable[], a: Aggregation): string {
  if (a === 'raw') return '';
  const parts: string[] = [];
  if (vars.some((v) => SUM_VARS.has(v))) parts.push('Precipitation is the sum per step, not the mean');
  if (vars.some((v) => CIRCULAR_VARS.has(v))) parts.push('wind direction is the circular mean');
  return parts.length ? ` ${parts.join('; ')}.` : '';
}

/** Panel title: full label and the statistic, without the unit (the unit is in the y axis name). */
export function panelTitle(v: Variable, stat: string): string {
  return `${VARIABLE_LABELS[v]} — ${stat}`;
}

/** Tooltip value with the display unit, for example "2.31 µmol CO₂ m⁻² s⁻¹" (HTML). */
export function valueWithUnit(value: number, unit: string): string {
  return `<b>${formatValue(value)}</b>${unit ? `&nbsp;${esc(unit)}` : ''}`;
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
export function siteLegend(meta: Meta, params: ViewParams, tokens: Tokens, shown: Set<number>, left: number, right: number) {
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
    data: meta.sites.filter((s) => shown.has(s.siteId)).map((s) => siteLabel(s, params)),
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

/**
 * Fixed value axis settings per variable. They replace the data range (`scale`, `min`, `max`).
 * Wind direction is a circle: the axis shows 0 to 360° with a tick at each 90° (N, E, S, W).
 */
export const VARIABLE_AXIS: Partial<Record<Variable, Record<string, unknown>>> = {
  wd: { scale: false, min: 0, max: 360, interval: 90 },
};

/**
 * Value axis with an axis line and outside ticks. Give the axis name in `extra`,
 * for example `yAxisName(tokens, axisName(meta, v, panelH), labelWidth)`.
 * Give `variable` when the axis shows one variable. Then the fixed settings of
 * `VARIABLE_AXIS` (for example 0 to 360° for `wd`) replace the range in `extra`.
 */
export function valueAxis(
  tokens: Tokens,
  gridIndex: number,
  extra: Record<string, unknown> = {},
  variable?: Variable,
  range?: NiceRange | null,
) {
  // VARIABLE_AXIS comes first: wd stays 0 to 360°. Then the fixed range of all data (axisRanges.ts).
  const fixed = (variable ? VARIABLE_AXIS[variable] : undefined) ?? (range ? fixedAxis(range) : undefined);
  if (fixed) {
    // A fixed interval needs no `splitNumber`.
    const { splitNumber: _unused, ...rest } = extra;
    return valueAxisBase(tokens, gridIndex, { ...rest, ...fixed });
  }
  return valueAxisBase(tokens, gridIndex, extra);
}

/** Axis settings for a fixed range from fixedRange() or blockRange(). */
export function fixedAxis(r: NiceRange): Record<string, unknown> {
  return { scale: false, min: r.min, max: r.max, interval: r.interval };
}

/**
 * Value extent for tickLabelWidth() and the left margin: the fixed range when there is one
 * (also wd: 0 to 360), else `auto`.
 */
export function axisExtent(variable: Variable | undefined, range: NiceRange | null | undefined, auto: [number, number]): [number, number] {
  const fixed = variable ? VARIABLE_AXIS[variable] : undefined;
  if (fixed && typeof fixed.min === 'number' && typeof fixed.max === 'number') return [fixed.min, fixed.max];
  return range ? [range.min, range.max] : auto;
}

function valueAxisBase(tokens: Tokens, gridIndex: number, extra: Record<string, unknown>) {
  return {
    type: 'value',
    gridIndex,
    scale: true,
    splitNumber: 3,
    axisLine: { show: true, lineStyle: { color: tokens.axis } },
    axisTick: { show: true, inside: false, lineStyle: { color: tokens.axis } },
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

// niceStep() and niceRange() are in nice.ts (no DOM and no chart code: axisRanges.ts and its unit test use them).
export { niceRange, niceStep } from './nice.ts';

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

/**
 * Grid and title positions for `n` stacked panels in a chart of the given height.
 * `left` overrides `layout.left`, for example the value from `gridLeftFor()`.
 */
export function stackLayout(n: number, height: number, layout = STACK, left = layout.left) {
  const k = Math.max(n, 1);
  const panelH = Math.max(40, (height - layout.top - layout.bottom - layout.gap * k) / k);
  const tops = Array.from({ length: n }, (_, i) => layout.top + layout.gap * (i + 1) + panelH * i);
  return {
    grid: tops.map((top) => ({ top, height: panelH, left, right: layout.right, ...FIXED_GRID })),
    title: tops.map((top) => ({ top: top - 24, left: left - 8 })),
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
