// Response curve: the x variable of the view, put into bins, against each other selected
// variable. One panel per y variable, one line per site for the mean of y per bin, a band for
// the 25th to 75th percentile. A dashed line gives a fitted curve: the light response
// (rectangular hyperbola) for NEE and GPP against PPFD or SWin, the Q10 model for Reco against
// a temperature. The fitter is in fit.ts. The bins and the statistics are computed in SQL.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GraphicComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import type { Aggregation, Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';
import { evalFit, fitLight, fitQ10, fitText, MIN_BINS, type Fit } from './fit';
import {
  FIXED_GRID,
  X_NAME_SPACE,
  axisName,
  baseOption,
  displayUnit,
  emptyNote,
  esc,
  formatValue,
  gridLeftFor,
  groupDigits,
  joinSubtitle,
  nameLines,
  panelTitle,
  signNote,
  siteColors,
  siteLegend,
  siteNames,
  tickLabelWidth,
  titleStyle,
  tooltipBase,
  valueAxis,
  varLabel,
  xAxisName,
  yAxisName,
  zeroLineSeries,
} from './common';

echarts.use([LineChart, GraphicComponent]);

/** Number of bins of equal width between the 1st and 99th percentile of x. */
const BINS = 30;
/** A bin with fewer values is not shown. */
const MIN_N = 10;
/** Points of a fitted curve. */
const FIT_POINTS = 60;
/** x variables with a daytime filter: rows with x > 0 only. */
const DAYTIME_X: ReadonlySet<Variable> = new Set<Variable>(['ppfd', 'sw_in']);
/** y variables of the light response: NEE (sign -1, with gamma) and GPP (sign +1). */
const LIGHT_Y: ReadonlyMap<Variable, 1 | -1> = new Map<Variable, 1 | -1>([
  ['nee', -1],
  ['nee_f', -1],
  ['gpp', 1],
  ['gpp_src', 1],
]);
const TEMPERATURE_X: ReadonlySet<Variable> = new Set<Variable>(['ta', 'tsoil']);
const Q10_Y: ReadonlySet<Variable> = new Set<Variable>(['reco', 'reco_src']);
/**
 * Layout in px. `xLabels` is the space below each panel for the tick labels and the x axis name.
 * `left` is the smallest left margin of a panel; `yLayout()` makes it larger for the y axis names.
 */
const L = { legend: 30, head: 30, panel: 260, xLabels: X_NAME_SPACE + 4, left: 56, right: 16, gapX: 24 };
/** Font of the fit text in a panel. */
const FIT_FONT = '11px system-ui, sans-serif';
const FIT_LINE = 14;

/** Text for the values of each step. */
const STEP_TEXT: Record<Aggregation, string> = {
  raw: '30-minute values',
  day: 'daily means',
  week: 'weekly means',
  month: 'monthly means',
};
/** Statistic in the panel titles. */
const STAT_TEXT_BIN: Record<Aggregation, string> = {
  raw: 'mean per bin of 30-min values',
  day: 'mean per bin of daily means',
  week: 'mean per bin of weekly means',
  month: 'mean per bin of monthly means',
};

/** Binned statistics of one site and one y variable. Index = bin, NaN = no bin. */
interface Curve {
  mean: number[];
  q1: number[];
  q3: number[];
  n: number[];
  fit: Fit | null;
}

interface ResponseData extends Prepared {
  x: Variable;
  ys: Variable[];
  aggregation: Aggregation;
  /** 1st and 99th percentile of x: the range of the bins. */
  lo: number;
  hi: number;
  /** Bin centres. */
  centres: number[];
  daytime: boolean;
  sites: Array<{ siteId: number; curves: Partial<Record<Variable, Curve>> }>;
}

const yVars = (params: ViewParams) => params.variables.filter((v) => v !== params.xVariable);

/** Kind of fit for a pair of variables, or null. */
export function fitKind(x: Variable, y: Variable): 'light' | 'q10' | null {
  if (DAYTIME_X.has(x) && LIGHT_Y.has(y)) return 'light';
  if (TEMPERATURE_X.has(x) && Q10_Y.has(y)) return 'q10';
  return null;
}

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  const ys = yVars(params).map(col);
  if (where === null || ys.length === 0) return null;
  const x = col(params.xVariable);
  const day = DAYTIME_X.has(params.xVariable) ? ` AND ${x} > 0` : '';
  const anyY = ys.map((v) => `${v} IS NOT NULL`).join(' OR ');
  // The source rows: 30-minute rows, or means per local day, ISO week or month (as in scatter).
  const src =
    params.aggregation === 'raw'
      ? `SELECT site_id, ${x} AS x, ${ys.join(', ')} FROM obs WHERE ${where} AND ${x} IS NOT NULL${day} AND (${anyY})`
      : `SELECT site_id, avg(${x}) AS x, ${ys.map((v) => `avg(${v}) AS ${v}`).join(', ')} FROM obs
         WHERE ${where}${day} GROUP BY site_id, date_trunc('${params.aggregation}', tl)
         HAVING avg(${x}) IS NOT NULL`;
  const stats = ys.map(
    (v) =>
      `count(${v})::DOUBLE AS ${v}__n, avg(${v}) AS ${v}, quantile_cont(${v}, 0.25) AS ${v}__q1, quantile_cont(${v}, 0.75) AS ${v}__q3`,
  );
  return `WITH src AS (${src}),
    q AS (SELECT quantile_cont(x, 0.01) AS lo, quantile_cont(x, 0.99) AS hi FROM src),
    b AS (
      SELECT site_id, lo, hi,
        coalesce(least(greatest(floor((x - lo) / nullif(hi - lo, 0) * ${BINS}), 0), ${BINS - 1}), 0) AS bin,
        ${ys.join(', ')}
      FROM src, q
    )
    SELECT site_id::DOUBLE AS site_id, bin::DOUBLE AS bin, any_value(lo)::DOUBLE AS lo, any_value(hi)::DOUBLE AS hi, ${stats.join(', ')}
    FROM b GROUP BY site_id, bin
    HAVING greatest(${ys.map((v) => `count(${v})`).join(', ')}) >= ${MIN_N}
    ORDER BY site_id, bin`;
}

const nanArray = () => Array<number>(BINS).fill(Number.NaN);

/** Fit the curve of `y` when the pair of variables has a model. */
function fitCurve(x: Variable, y: Variable, centres: number[], c: Curve): Fit | null {
  const kind = fitKind(x, y);
  if (kind === 'light') return fitLight(centres, c.mean, c.n, LIGHT_Y.get(y) as 1 | -1);
  if (kind === 'q10') return fitQ10(centres, c.mean, c.n);
  return null;
}

function prepare(table: Table | null, params: ViewParams, _meta: Meta): ResponseData {
  const ys = yVars(params);
  const daytime = DAYTIME_X.has(params.xVariable);
  const base = { x: params.xVariable, ys, aggregation: params.aggregation, lo: 0, hi: 1, centres: [] as number[], daytime, sites: [] as ResponseData['sites'] };
  if (table === null) {
    const note =
      params.sites.length > 0 && ys.length === 0
        ? `A response curve needs one more variable than the x variable (${varLabel(params.xVariable)}). Select an other variable.`
        : emptyNote(params);
    return { ...base, rowCount: 0, seriesCount: 0, note };
  }
  const n = table.numRows;
  const read = (name: string) => toFloat64(table.getChild(name), n);
  const site = read('site_id');
  const bin = read('bin');
  const lo = n > 0 ? (read('lo')[0] as number) : 0;
  const hi = n > 0 ? (read('hi')[0] as number) : 1;
  const width = (hi - lo) / BINS;
  const centres = Array.from({ length: BINS }, (_, i) => lo + (i + 0.5) * width);
  const cols = ys.map((v) => ({ v, mean: read(v), q1: read(`${v}__q1`), q3: read(`${v}__q3`), n: read(`${v}__n`) }));
  const bySite = new Map<number, ResponseData['sites'][number]>();
  for (let i = 0; i < n; i++) {
    const id = site[i] as number;
    let entry = bySite.get(id);
    if (!entry) {
      entry = { siteId: id, curves: {} };
      for (const v of ys) entry.curves[v] = { mean: nanArray(), q1: nanArray(), q3: nanArray(), n: nanArray(), fit: null };
      bySite.set(id, entry);
    }
    const k = bin[i] as number;
    for (const c of cols) {
      const count = c.n[i] as number;
      // A bin with fewer than MIN_N values of this variable is not shown.
      if (!(count >= MIN_N)) continue;
      const curve = entry.curves[c.v] as Curve;
      curve.mean[k] = c.mean[i] as number;
      curve.q1[k] = c.q1[i] as number;
      curve.q3[k] = c.q3[i] as number;
      curve.n[k] = count;
    }
  }
  const sites = [...bySite.values()];
  let seriesCount = 0;
  let fits = 0;
  for (const v of ys) {
    for (const s of sites) {
      const c = s.curves[v] as Curve;
      if (!c.mean.some(Number.isFinite)) continue;
      seriesCount++;
      c.fit = fitCurve(params.xVariable, v, centres, c);
      if (c.fit) fits++;
    }
  }
  const kinds = new Set(ys.map((v) => fitKind(params.xVariable, v)).filter(Boolean));
  const fitNote = fits
    ? `Dashed line = fitted ${[...kinds]
        .map((k) => (k === 'light' ? 'light response (rectangular hyperbola)' : 'temperature response (Q₁₀ model)'))
        .join(' and ')}, weighted by the count per bin (${MIN_BINS} bins or more).`
    : undefined;
  const data: ResponseData = {
    ...base,
    lo,
    hi,
    centres,
    sites,
    rowCount: n,
    seriesCount,
    subtitle: joinSubtitle(
      `x = ${varLabel(params.xVariable)}: ${BINS} bins of equal width between the 1st and 99th percentile of x, from ${STEP_TEXT[params.aggregation]}. ` +
        `Line = mean per bin, band = 25th to 75th percentile. Bins with fewer than ${MIN_N} values are not shown.`,
      daytime ? `Daytime rows only (${varLabel(params.xVariable)} > 0).` : undefined,
      fitNote,
      signNote([params.xVariable, ...ys]),
    ),
  };
  if (n === 0) data.note = 'No data for these sites and years.';
  return data;
}

function columns(width: number, n: number): number {
  return width >= 760 && n > 1 ? 2 : 1;
}

function totalHeight(nY: number, width: number): number {
  if (nY === 0) return 160;
  const rows = Math.ceil(nY / columns(width, nY));
  return L.legend + rows * (L.head + L.panel + L.xLabels);
}

/** First and last bin index with data in a curve, or null. */
function dataRange(c: Curve): [number, number] | null {
  let a = -1;
  let b = -1;
  c.mean.forEach((m, i) => {
    if (!Number.isFinite(m)) return;
    if (a < 0) a = i;
    b = i;
  });
  return a >= 0 ? [a, b] : null;
}

/** Points of the fitted curve over the bins with data. */
function fitPoints(data: ResponseData, c: Curve): number[][] {
  const r = dataRange(c);
  if (!c.fit || !r) return [];
  const x0 = data.centres[r[0]] as number;
  const x1 = data.centres[r[1]] as number;
  const pts: number[][] = [];
  for (let i = 0; i <= FIT_POINTS; i++) {
    const x = x0 + ((x1 - x0) * i) / FIT_POINTS;
    const y = evalFit(c.fit, x);
    if (Number.isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

/** Min and max of the band, the mean and the fit of `v` in all sites. [0, 1] when there are none. */
function valueExtent(data: ResponseData, v: Variable): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of data.sites) {
    const c = s.curves[v];
    if (!c) continue;
    for (const a of [c.mean, c.q1, c.q3]) {
      for (const y of a) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    for (const [, y] of fitPoints(data, c) as Array<[number, number]>) {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/**
 * Y axis names, tick label widths and the left margin of the panels. All panels use the same
 * left margin, so that the columns have the same width and line up.
 */
function yLayout(data: ResponseData, meta: Meta) {
  const extents = data.ys.map((v) => valueExtent(data, v));
  const names = data.ys.map((v) => axisName(meta, v, L.panel));
  const widths = extents.map((e) => tickLabelWidth(e, 4));
  const left = Math.max(L.left, ...names.map((n, i) => gridLeftFor(widths[i] as number, nameLines(n))));
  return { extents, names, widths, left };
}

/** Bin range as text for the tooltip, for example "120 to 160". */
function binRangeText(data: ResponseData, k: number): string {
  const w = (data.hi - data.lo) / BINS;
  return `${formatValue(data.lo + k * w)} to ${formatValue(data.lo + (k + 1) * w)}`;
}

function build(data: ResponseData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta);
  const cols = columns(ctx.width, data.ys.length);
  const y = yLayout(data, meta);
  const panelW = (Math.max(ctx.width, 200) - y.left - L.right - (cols - 1) * (L.gapX + y.left)) / cols;
  const xUnit = displayUnit(meta, data.x);
  const xName = axisName(meta, data.x, panelW);
  const stat = STAT_TEXT_BIN[data.aggregation];
  const grid: unknown[] = [];
  const title: unknown[] = [];
  const xAxis: unknown[] = [];
  const yAxis: unknown[] = [];
  const series: unknown[] = [];
  const graphic: unknown[] = [];
  /** For each series index: the mean line of a curve, or null for a band part or a fit line. */
  const lines: Array<{ curve: Curve; unit: string } | null> = [];
  data.ys.forEach((v, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const top = L.legend + r * (L.head + L.panel + L.xLabels) + L.head;
    const left = y.left + c * (panelW + L.gapX + y.left);
    grid.push({ top, left, width: panelW, height: L.panel, ...FIXED_GRID });
    // Panel label and statistic. The unit is in the y axis name.
    title.push({ top: top - 24, left: left - 8, text: panelTitle(v, stat), textStyle: titleStyle(tokens) });
    // The axis lines stay at the bottom and the left edge of the panel, not at 0.
    const edge = { axisLine: { show: true, onZero: false, lineStyle: { color: tokens.axis } } };
    xAxis.push(valueAxis(tokens, i, { splitNumber: 4, ...edge, ...xAxisName(tokens, xName) }));
    yAxis.push(valueAxis(tokens, i, { splitNumber: 4, ...edge, ...yAxisName(tokens, y.names[i] as string, y.widths[i] as number) }));
    const unit = displayUnit(meta, v);
    // Fit text at the top of the panel: right for NEE (the curve goes to the bottom right),
    // left for GPP and Reco (the curve goes to the top right).
    const atRight = v === 'nee' || v === 'nee_f';
    let fitLines = 0;
    data.sites.forEach((s) => {
      const curve = s.curves[v];
      if (!curve || !curve.mean.some(Number.isFinite)) return;
      const name = names.get(s.siteId) ?? String(s.siteId);
      const color = colors.get(s.siteId);
      const stack = `iqr-${i}-${s.siteId}`;
      const common = { name, xAxisIndex: i, yAxisIndex: i, color, showSymbol: false, symbol: 'none', emphasis: { disabled: true }, silent: true };
      const pairs = (a: number[]) => a.map((val, k) => [data.centres[k] as number, val]);
      // Band: an invisible line at q1, then q3 - q1 stacked on it with a fill. `stackStrategy: 'all'`
      // stacks also when q1 is negative (the default stacks values of the same sign only).
      series.push({ ...common, type: 'line', data: pairs(curve.q1), stack, stackStrategy: 'all', lineStyle: { opacity: 0 }, tooltip: { show: false } });
      series.push({
        ...common,
        type: 'line',
        data: pairs(curve.q3.map((q3, k) => q3 - (curve.q1[k] as number))),
        stack,
        stackStrategy: 'all',
        lineStyle: { opacity: 0 },
        areaStyle: { color, opacity: 0.14 },
        tooltip: { show: false },
      });
      // Mean per bin. Small symbols, so that a single bin without neighbours is visible.
      series.push({ ...common, silent: false, showSymbol: true, symbol: 'circle', symbolSize: 4, type: 'line', data: pairs(curve.mean), lineStyle: { width: 2 }, z: 3 });
      lines.push(null, null, { curve, unit });
      if (curve.fit) {
        series.push({ ...common, type: 'line', data: fitPoints(data, curve), lineStyle: { width: 1.5, type: 'dashed' }, z: 4, tooltip: { show: false } });
        lines.push(null);
        graphic.push({
          type: 'text',
          silent: true,
          z: 100,
          left: atRight ? undefined : left + 8,
          right: atRight ? ctx.width - (left + panelW) + 8 : undefined,
          top: top + 6 + fitLines * FIT_LINE,
          style: {
            text: `${name}: ${fitText(curve.fit, '', false)}`,
            font: FIT_FONT,
            fill: color,
            backgroundColor: tokens.surface,
            padding: [1, 3],
            borderRadius: 2,
          },
        });
        fitLines++;
      }
    });
  });
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, tokens, new Set(data.sites.map((s) => s.siteId)), y.left, L.right),
    title,
    grid,
    xAxis,
    yAxis,
    graphic,
    tooltip: {
      ...tooltipBase(tokens, 'axis'),
      axisPointer: { type: 'line', lineStyle: { color: tokens.axis } },
      formatter: (raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ seriesIndex: number; marker: string; seriesName: string; dataIndex: number }>;
        const first = list.find((p) => lines[p.seriesIndex]);
        if (!first) return '';
        const k = first.dataIndex;
        const rows: string[] = [];
        for (const p of list) {
          const line = lines[p.seriesIndex];
          if (!line || p.dataIndex !== k) continue;
          const m = line.curve.mean[k] as number;
          if (!Number.isFinite(m)) continue;
          rows.push(
            `${p.marker}${esc(p.seriesName)}&nbsp;&nbsp;<b>${formatValue(m)}</b> ` +
              `(${formatValue(line.curve.q1[k] as number)} to ${formatValue(line.curve.q3[k] as number)}) ${esc(line.unit)}, n = ${groupDigits(line.curve.n[k] as number)}` +
              (line.curve.fit ? `<br/>&nbsp;&nbsp;&nbsp;&nbsp;fit ${formatValue(evalFit(line.curve.fit, data.centres[k] as number))}: ${esc(fitText(line.curve.fit, '', false))}` : ''),
          );
        }
        return `<b>${esc(varLabel(data.x))} ${binRangeText(data, k)} ${esc(xUnit)}</b><br/>${rows.join('<br/>') || 'No data'}`;
      },
    },
    // The zero lines come after all data series, so they do not change the series index.
    series: [...series, ...data.ys.flatMap((v, i) => zeroLineSeries(meta, tokens, v, i, y.extents[i] as [number, number]) ?? [])],
  };
}

/** Fit parameters per panel and site, for the alt text. */
function fitsText(data: ResponseData, meta: Meta): string {
  const names = siteNames(meta);
  const parts: string[] = [];
  for (const v of data.ys) {
    const unit = displayUnit(meta, v);
    const per = data.sites
      .filter((s) => s.curves[v]?.fit)
      .map((s) => `${names.get(s.siteId) ?? s.siteId}: ${fitText((s.curves[v] as Curve).fit as Fit, unit, true)}`);
    if (per.length) {
      const kind = fitKind(data.x, v) === 'light' ? 'light response' : 'Q₁₀ model';
      parts.push(`${varLabel(v)}, ${kind}: ${per.join('; ')}.`);
    }
  }
  return parts.length ? ` Fitted curves (dashed): ${parts.join(' ')}` : ' No fitted curve for these variables.';
}

function describe(data: ResponseData, meta: Meta): string {
  const xText = varLabel(data.x);
  const range = data.rowCount ? ` from ${formatValue(data.lo)} to ${formatValue(data.hi)} ${displayUnit(meta, data.x)}` : '';
  return (
    `Response curve of each other variable against ${xText} (x axis, ${BINS} bins${range}${data.daytime ? ', daytime rows only' : ''}), ` +
    `one panel per variable, one line per site for the mean per bin and a band for the 25th to 75th percentile, ` +
    `${groupDigits(data.rowCount)} bin rows.${fitsText(data, meta)}`
  );
}

export const response: DiagramDef<ResponseData> = {
  type: 'response',
  label: 'Response curve (x variable, binned)',
  query,
  prepare,
  build,
  widthDependent: true,
  showsEvents: false,
  height: (params, _data, width) => totalHeight(yVars(params).length, width),
  statsVariables: (params) => [params.xVariable, ...yVars(params)],
  describe: (data, ctx) => describe(data, ctx.meta),
};
