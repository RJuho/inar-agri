// Time series diagram: one panel per variable, one line per site, shared time axis.
// The time axis shows site local time (column `tl`). Zoom is linked across the panels.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64 } from '../db';
import { AGGREGATION_LABELS, VARIABLE_LABELS, type Aggregation, type Variable, type ViewParams } from '../state';
import type { Tokens } from '../theme';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';

echarts.use([LineChart]);

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Longest normal step between two rows. A longer step is a gap. */
const MAX_STEP: Record<Aggregation, number> = { raw: 30 * MINUTE, day: DAY, month: 31 * DAY };

/** Layout in px. */
const LAYOUT = { top: 24, bottom: 64, gap: 34, left: 56, right: 16 };

/**
 * Downsampler for the line series. It keeps, per pixel frame, the value that is
 * farthest from the frame mean, so that peaks and the daily range stay visible.
 * A frame with only NaN values gives NaN, so gaps longer than one frame stay visible.
 *
 * We do not use the built-in 'lttb': in ECharts 6.1 it returns points in the wrong
 * order when the data has NaN values and dataZoom filters the data. Then false
 * lines cross the zoomed panels. The generic sampler keeps the order.
 */
function extremeSampler(frame: ArrayLike<number>): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    if (!Number.isNaN(v)) {
      sum += v;
      count++;
    }
  }
  if (count === 0) return Number.NaN;
  const mean = sum / count;
  let best = Number.NaN;
  let bestDist = -1;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    if (!Number.isNaN(v) && Math.abs(v - mean) > bestDist) {
      bestDist = Math.abs(v - mean);
      best = v;
    }
  }
  return best;
}

/** Grid and title positions for `n` panels in a chart of the given height. */
function panelLayout(n: number, height: number) {
  const k = Math.max(n, 1);
  const panelH = Math.max(40, (height - LAYOUT.top - LAYOUT.bottom - LAYOUT.gap * k) / k);
  const tops = Array.from({ length: n }, (_, i) => LAYOUT.top + LAYOUT.gap * (i + 1) + panelH * i);
  return {
    grid: tops.map((top) => ({ top, height: panelH, left: LAYOUT.left, right: LAYOUT.right })),
    title: tops.map((top) => ({ top: top - 24, left: LAYOUT.left - 8 })),
  };
}

/** Time label in site local time. The epoch values hold local wall time, so read them as UTC. */
function timeLabel(ms: number, aggregation: Aggregation): string {
  const iso = new Date(ms).toISOString();
  if (aggregation === 'month') return iso.slice(0, 7);
  if (aggregation === 'day') return iso.slice(0, 10);
  return `${iso.slice(0, 16).replace('T', ' ')} local time`;
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  return v.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3);
}

/**
 * Column data for one site. All arrays have the same length.
 * `t` is epoch ms of the local wall time. NaN marks a missing value or a gap.
 */
interface SiteSeries {
  siteId: number;
  t: Float64Array;
  values: Partial<Record<Variable, Float64Array>>;
}

interface TimeseriesData extends Prepared {
  variables: Variable[];
  aggregation: Aggregation;
  sites: SiteSeries[];
}

/**
 * Split the sorted rows into one block per site.
 * Where the step between two rows is longer than `maxStep`, add one NaN row.
 * ECharts then draws a gap there and does not join the two ends.
 */
function splitBySite(
  siteIds: Float64Array,
  t: Float64Array,
  cols: Map<Variable, Float64Array>,
  maxStep: number,
): SiteSeries[] {
  const result: SiteSeries[] = [];
  const vars = [...cols.keys()];
  const n = siteIds.length;
  let start = 0;
  while (start < n) {
    const id = siteIds[start] as number;
    let end = start;
    let gaps = 0;
    while (end < n && siteIds[end] === id) {
      if (end > start && (t[end] as number) - (t[end - 1] as number) > maxStep) gaps++;
      end++;
    }
    const len = end - start + gaps;
    const st = new Float64Array(len);
    const sv: Partial<Record<Variable, Float64Array>> = {};
    for (const v of vars) sv[v] = new Float64Array(len);
    let k = 0;
    for (let i = start; i < end; i++) {
      if (i > start && (t[i] as number) - (t[i - 1] as number) > maxStep) {
        st[k] = (t[i - 1] as number) + Math.min(maxStep, DAY);
        for (const v of vars) (sv[v] as Float64Array)[k] = Number.NaN;
        k++;
      }
      st[k] = t[i] as number;
      for (const v of vars) (sv[v] as Float64Array)[k] = (cols.get(v) as Float64Array)[i] as number;
      k++;
    }
    result.push({ siteId: id, t: st, values: sv });
    start = end;
  }
  return result;
}

function sqlFor(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0) return null;
  const vars = params.variables.map(col);
  // Cast to DOUBLE: Arrow gives BigInt for BIGINT, and ECharts needs numbers.
  if (params.aggregation === 'raw') {
    return `SELECT site_id::DOUBLE AS site_id, epoch_ms(tl)::DOUBLE AS t, ${vars.join(', ')}
      FROM obs WHERE ${where} ORDER BY site_id, tl`;
  }
  const unit = params.aggregation === 'day' ? 'day' : 'month';
  return `SELECT site_id::DOUBLE AS site_id, epoch_ms(date_trunc('${unit}', tl))::DOUBLE AS t,
      ${vars.map((v) => `avg(${v}) AS ${v}`).join(', ')}
    FROM obs WHERE ${where} GROUP BY ALL ORDER BY site_id, t`;
}

function prepare(table: Table | null, params: ViewParams): TimeseriesData {
  const base = { variables: params.variables, aggregation: params.aggregation, sites: [] as SiteSeries[] };
  if (table === null) {
    const note = params.sites.length === 0 ? 'Select one or more sites.' : 'Select one or more variables.';
    return { ...base, rowCount: 0, seriesCount: 0, note };
  }
  const n = table.numRows;
  const cols = new Map(params.variables.map((v) => [v, toFloat64(table.getChild(v), n)]));
  const sites = splitBySite(
    toFloat64(table.getChild('site_id'), n),
    toFloat64(table.getChild('t'), n),
    cols,
    MAX_STEP[params.aggregation],
  );
  const data: TimeseriesData = { ...base, sites, rowCount: n, seriesCount: sites.length * params.variables.length };
  if (n === 0) data.note = 'No data for these sites and years.';
  return data;
}

function panelTitle(v: Variable, aggregation: Aggregation): string {
  return aggregation === 'raw' ? VARIABLE_LABELS[v] : `${VARIABLE_LABELS[v]}, ${AGGREGATION_LABELS[aggregation].toLowerCase()}`;
}

function build(data: TimeseriesData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta, zoom } = ctx;
  const vars = data.variables;
  const layout = panelLayout(vars.length, ctx.height);
  const siteName = new Map(meta.sites.map((s) => [s.siteId, s.name]));
  // Colour follows the site: slot = position of the site in sites.parquet.
  const siteColor = new Map(meta.sites.map((s, i) => [s.siteId, tokens.series[i % tokens.series.length]]));
  const unit = (v: Variable) => meta.variables.get(v)?.unit ?? '';
  const shown = new Set(data.sites.map((s) => s.siteId));

  // One shared time range, so that all panels line up at full zoom.
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const s of data.sites) {
    if (s.t.length === 0) continue;
    tMin = Math.min(tMin, s.t[0] as number);
    tMax = Math.max(tMax, s.t[s.t.length - 1] as number);
  }

  const axisIdx = vars.map((_, i) => i);
  const last = vars.length - 1;
  const nSites = data.sites.length;

  return {
    animation: false,
    useUTC: true,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'system-ui, sans-serif', color: tokens.text },
    color: tokens.series,
    // Scroll legend: on a narrow screen it stays on one line and does not cover the first panel.
    legend: {
      type: 'scroll',
      top: 0,
      left: LAYOUT.left - 8,
      right: LAYOUT.right,
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.grid,
      pageTextStyle: { color: tokens.textMuted },
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 4,
      textStyle: { color: tokens.text },
      inactiveColor: tokens.grid,
      data: meta.sites.filter((s) => shown.has(s.siteId)).map((s) => s.name),
    },
    // Panel label, then the unit in muted text on the same line.
    title: vars.map((v, i) => ({
      ...layout.title[i],
      text: `${panelTitle(v, data.aggregation)}  {u|${unit(v)}}`,
      textStyle: {
        fontSize: 13,
        fontWeight: 600,
        color: tokens.text,
        rich: { u: { fontSize: 12, fontWeight: 400, color: tokens.textMuted } },
      },
    })),
    grid: layout.grid,
    xAxis: vars.map((_, i) => ({
      type: 'time',
      gridIndex: i,
      min: tMin,
      max: tMax,
      axisLine: { lineStyle: { color: tokens.axis } },
      axisTick: { show: i === last },
      axisLabel: { show: i === last, color: tokens.textMuted, hideOverlap: true },
      splitLine: { show: true, lineStyle: { color: tokens.grid, width: 1 } },
    })),
    yAxis: vars.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      scale: true,
      splitNumber: 3,
      axisLine: { show: false },
      axisLabel: { color: tokens.textMuted },
      splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
    })),
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: tokens.axis } },
    tooltip: tooltip(data, tokens, nSites, unit),
    dataZoom: [
      { type: 'inside', xAxisIndex: axisIdx, start: zoom.start, end: zoom.end, filterMode: 'filter' },
      {
        type: 'slider',
        xAxisIndex: axisIdx,
        start: zoom.start,
        end: zoom.end,
        bottom: 8,
        height: 22,
        left: LAYOUT.left,
        right: LAYOUT.right,
        showDataShadow: false,
        labelFormatter: (v: number) => new Date(v).toISOString().slice(0, 10),
        textStyle: { color: tokens.textMuted },
        borderColor: tokens.grid,
      },
    ],
    // One dataset per site. Series point to it with datasetIndex and encode.
    dataset: data.sites.map((s) => ({
      dimensions: [{ name: 't', type: 'time' }, ...vars.map((v) => ({ name: v, type: 'float' }))],
      source: { t: s.t, ...s.values },
    })),
    // Series order: variable-major, then site. Index = panel * nSites + site.
    series: vars.flatMap((v, panel) =>
      data.sites.map((s, di) => ({
        type: 'line',
        name: siteName.get(s.siteId) ?? String(s.siteId),
        datasetIndex: di,
        encode: { x: 't', y: v },
        xAxisIndex: panel,
        yAxisIndex: panel,
        color: siteColor.get(s.siteId),
        showSymbol: false,
        symbol: 'none',
        connectNulls: false,
        sampling: extremeSampler,
        lineStyle: { width: 1 },
        emphasis: { disabled: true },
      })),
    ),
  };
}

function tooltip(data: TimeseriesData, tokens: Tokens, nSites: number, unit: (v: Variable) => string) {
  return {
    trigger: 'axis',
    confine: true,
    backgroundColor: tokens.surface,
    borderColor: tokens.grid,
    textStyle: { color: tokens.text, fontSize: 12 },
    axisPointer: { type: 'line' },
    // The axis pointer is linked across panels, so the tooltip gets the series
    // of all panels. Group them by panel and skip missing values.
    formatter: (raw: unknown) => {
      const params = (Array.isArray(raw) ? raw : [raw]) as Array<{
        seriesIndex: number;
        seriesName: string;
        marker: string;
        value: number[];
        encode: { y: number[] };
        axisValue: number;
      }>;
      const first = params[0];
      if (!first) return '';
      const blocks: string[] = [];
      data.variables.forEach((v, panel) => {
        const rows = params
          .filter((p) => Math.floor(p.seriesIndex / nSites) === panel)
          .filter((p) => Number.isFinite(p.value[p.encode.y[0] as number]))
          .map(
            (p) =>
              `${p.marker}${echarts.format.encodeHTML(p.seriesName)}&nbsp;&nbsp;<b>${formatValue(p.value[p.encode.y[0] as number] as number)}</b>`,
          );
        if (rows.length === 0) return;
        const head = `<span style="color:${tokens.textMuted}">${panelTitle(v, data.aggregation)}, ${echarts.format.encodeHTML(unit(v))}</span>`;
        blocks.push(`${head}<br/>${rows.join('<br/>')}`);
      });
      return `<b>${timeLabel(first.axisValue, data.aggregation)}</b><br/>${blocks.join('<br/>') || 'No data'}`;
    },
  };
}

export const timeseries: DiagramDef<TimeseriesData> = {
  type: 'timeseries',
  label: 'Time series',
  query: sqlFor,
  prepare: (table, params) => prepare(table, params),
  build,
  relayout: (data, ctx) => panelLayout(data.variables.length, ctx.height),
  describe: (data) =>
    `One panel per variable, one line per site, ${AGGREGATION_LABELS[data.aggregation].toLowerCase()}, time axis in site local time.`,
  // Same panel height as the first version of the page: five panels in about 1100 px.
  height: (params) => (params.variables.length === 0 ? 160 : LAYOUT.top + LAYOUT.bottom + params.variables.length * 202),
};

