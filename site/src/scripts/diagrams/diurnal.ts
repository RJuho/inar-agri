// Diurnal cycle: mean by half hour of the day in site local time, with the interquartile
// range (25th to 75th percentile) as a band. One panel per variable, one line per site.
// The values are all 30-minute values of the selected years. The step setting does not apply.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import type { Variable, ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';
import {
  STACK,
  X_NAME_SPACE,
  axisName,
  baseOption,
  displayUnit,
  emptyNote,
  esc,
  formatValue,
  gridLeftFor,
  joinSubtitle,
  nameLines,
  panelTitle,
  signNote,
  siteColors,
  siteLegend,
  siteNames,
  stackHeight,
  stackLayout,
  tickLabelWidth,
  timeAxisName,
  titleStyle,
  tooltipBase,
  valueAxis,
  varLabel,
  xAxisName,
  yAxisName,
  zeroLineSeries,
} from './common';

echarts.use([LineChart]);

const SLOTS = 48;
const slotLabel = (i: number) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
const SLOT_LABELS = Array.from({ length: SLOTS }, (_, i) => slotLabel(i));
/**
 * Categories of the x axis: the 48 half hours and one more category "24:00" at the right end.
 * It has no data. It lets the axis show the full day, with labels 00, 03 … 24.
 */
const AXIS_LABELS = [...SLOT_LABELS, '24:00'];
/** Category step of a tick and a label: 6 half hours = 3 h. ECharts `interval` = categories to skip. */
const TICK_EVERY = 6;

/** Panel statistic in the title. The step setting does not apply. */
const STAT = 'mean per half hour';
/** Stack layout with space below the bottom panel for the hour labels and the x axis name. */
const LAYOUT = { ...STACK, bottom: X_NAME_SPACE + 4 };
/** Panel height in px. */
const PANEL_H = 170;

interface Curve {
  mean: number[];
  q1: number[];
  q3: number[];
}

interface DiurnalData extends Prepared {
  variables: Variable[];
  sites: Array<{ siteId: number; curves: Partial<Record<Variable, Curve>> }>;
}

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0) return null;
  const parts = params.variables
    .map(col)
    .map((v) => `avg(${v}) AS ${v}, quantile_cont(${v}, 0.25) AS ${v}__q1, quantile_cont(${v}, 0.75) AS ${v}__q3`);
  return `SELECT site_id::DOUBLE AS site_id, (hour(tl) * 2 + minute(tl) // 30)::DOUBLE AS slot, ${parts.join(', ')}
    FROM obs WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`;
}

const nanArray = () => Array<number>(SLOTS).fill(Number.NaN);

function prepare(table: Table | null, params: ViewParams, _meta: Meta): DiurnalData {
  const base = { variables: params.variables, sites: [] as DiurnalData['sites'] };
  if (table === null) return { ...base, rowCount: 0, seriesCount: 0, note: emptyNote(params) };
  const n = table.numRows;
  const site = toFloat64(table.getChild('site_id'), n);
  const slot = toFloat64(table.getChild('slot'), n);
  const read = (name: string) => toFloat64(table.getChild(name), n);
  const cols = params.variables.map((v) => ({ v, mean: read(v), q1: read(`${v}__q1`), q3: read(`${v}__q3`) }));
  const bySite = new Map<number, DiurnalData['sites'][number]>();
  for (let i = 0; i < n; i++) {
    const id = site[i] as number;
    let entry = bySite.get(id);
    if (!entry) {
      entry = { siteId: id, curves: {} };
      for (const v of params.variables) entry.curves[v] = { mean: nanArray(), q1: nanArray(), q3: nanArray() };
      bySite.set(id, entry);
    }
    const k = slot[i] as number;
    for (const c of cols) {
      const curve = entry.curves[c.v] as Curve;
      curve.mean[k] = c.mean[i] as number;
      curve.q1[k] = c.q1[i] as number;
      curve.q3[k] = c.q3[i] as number;
    }
  }
  const sites = [...bySite.values()];
  let seriesCount = 0;
  for (const v of params.variables) for (const s of sites) if (s.curves[v]?.mean.some(Number.isFinite)) seriesCount++;
  const data: DiurnalData = {
    ...base,
    sites,
    rowCount: n,
    seriesCount,
    subtitle: joinSubtitle(
      signNote(params.variables),
      'Mean (line) and 25th to 75th percentile (band) per half hour, site local time, all values in the selected years.',
    ),
  };
  if (n === 0) data.note = 'No data for these sites and years.';
  return data;
}

/** Min and max of the band and the mean of `v` in all sites. [0, 1] when there are none. */
function valueExtent(data: DiurnalData, v: Variable): [number, number] {
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
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** Panel height in px, the same formula as `stackLayout()`. */
function panelHeight(n: number, height: number): number {
  const k = Math.max(n, 1);
  return Math.max(40, (height - LAYOUT.top - LAYOUT.bottom - LAYOUT.gap * k) / k);
}

/** Y axis names, tick label widths and the shared left margin of all panels. */
function yLayout(data: DiurnalData, meta: Meta, height: number) {
  const panelH = panelHeight(data.variables.length, height);
  const extents = data.variables.map((v) => valueExtent(data, v));
  const names = data.variables.map((v) => axisName(meta, v, panelH));
  const widths = extents.map((e) => tickLabelWidth(e));
  const left = Math.max(LAYOUT.left, ...names.map((n, i) => gridLeftFor(widths[i] as number, nameLines(n))));
  return { extents, names, widths, left };
}

function build(data: DiurnalData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const vars = data.variables;
  const y = yLayout(data, meta, ctx.height);
  const layout = stackLayout(vars.length, ctx.height, LAYOUT, y.left);
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta);
  const last = vars.length - 1;
  const series: unknown[] = [];
  /** For each series index: the curve of a mean line, or null for a band part. */
  const lines: Array<{ curve: Curve; unit: string } | null> = [];
  vars.forEach((v, panel) => {
    for (const s of data.sites) {
      const curve = s.curves[v];
      if (!curve || !curve.mean.some(Number.isFinite)) continue;
      const name = names.get(s.siteId) ?? String(s.siteId);
      const color = colors.get(s.siteId);
      const stack = `iqr-${panel}-${s.siteId}`;
      const common = { name, xAxisIndex: panel, yAxisIndex: panel, color, showSymbol: false, symbol: 'none', emphasis: { disabled: true }, silent: true };
      // Band: an invisible line at q1, then q3 - q1 stacked on it with a fill. `stackStrategy: 'all'`
      // stacks also when q1 is negative (the default stacks values of the same sign only).
      series.push({ ...common, type: 'line', data: curve.q1, stack, stackStrategy: 'all', lineStyle: { opacity: 0 } });
      series.push({
        ...common,
        type: 'line',
        data: curve.q3.map((q3, i) => q3 - (curve.q1[i] as number)),
        stack,
        stackStrategy: 'all',
        lineStyle: { opacity: 0 },
        areaStyle: { color, opacity: 0.14 },
      });
      series.push({ ...common, silent: false, type: 'line', data: curve.mean, lineStyle: { width: 2 }, z: 3 });
      lines.push(null, null, { curve, unit: displayUnit(meta, v) });
    }
  });
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, tokens, new Set(data.sites.map((s) => s.siteId)), y.left, LAYOUT.right),
    // Panel label and statistic. The unit is in the y axis name.
    title: vars.map((v, i) => ({ ...layout.title[i], text: panelTitle(v, STAT), textStyle: titleStyle(tokens) })),
    grid: layout.grid,
    xAxis: vars.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: AXIS_LABELS,
      boundaryGap: false,
      // The axis stays at the bottom of the panel. The zero line series marks y = 0.
      axisLine: { onZero: false, lineStyle: { color: tokens.axis } },
      axisTick: { show: i === last, interval: TICK_EVERY - 1 },
      // Label = hour only: 00, 03 … 24.
      axisLabel: { show: i === last, color: tokens.textMuted, interval: TICK_EVERY - 1, formatter: (s: string) => s.slice(0, 2) },
      splitLine: { show: true, interval: TICK_EVERY - 1, lineStyle: { color: tokens.grid, width: 1 } },
      // Time base on the bottom panel only.
      ...(i === last ? xAxisName(tokens, timeAxisName(meta, ctx.params, 'Hour of day')) : {}),
    })),
    yAxis: vars.map((_, i) => valueAxis(tokens, i, yAxisName(tokens, y.names[i] as string, y.widths[i] as number))),
    tooltip: {
      ...tooltipBase(tokens, 'axis'),
      axisPointer: { type: 'line', lineStyle: { color: tokens.axis } },
      formatter: (raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ seriesIndex: number; marker: string; seriesName: string; dataIndex: number; name: string }>;
        const first = list[0];
        if (!first) return '';
        const rows: string[] = [];
        for (const p of list) {
          const line = lines[p.seriesIndex];
          if (p.dataIndex >= SLOTS) continue;
          if (!line) continue;
          const m = line.curve.mean[p.dataIndex] as number;
          if (!Number.isFinite(m)) continue;
          rows.push(
            `${p.marker}${esc(p.seriesName)}&nbsp;&nbsp;<b>${formatValue(m)}</b> ` +
              `(${formatValue(line.curve.q1[p.dataIndex] as number)} to ${formatValue(line.curve.q3[p.dataIndex] as number)}) ${esc(line.unit)}`,
          );
        }
        return `<b>${esc(first.name)} local time</b><br/>${rows.join('<br/>') || 'No data'}`;
      },
    },
    // The zero lines come after all data series, so they do not change the series index.
    series: [...series, ...vars.flatMap((v, i) => zeroLineSeries(meta, tokens, v, i, y.extents[i] as [number, number]) ?? [])],
  };
}

/** Hour (local time) of the highest and lowest mean, for the alt text. */
function peakText(data: DiurnalData, meta: Meta): string {
  const names = siteNames(meta);
  const v = data.variables[0];
  if (!v) return '';
  const parts: string[] = [];
  for (const s of data.sites) {
    const mean = s.curves[v]?.mean ?? [];
    let hi = -1;
    let lo = -1;
    mean.forEach((m, i) => {
      if (!Number.isFinite(m)) return;
      if (hi < 0 || m > (mean[hi] as number)) hi = i;
      if (lo < 0 || m < (mean[lo] as number)) lo = i;
    });
    if (hi >= 0) parts.push(`${names.get(s.siteId) ?? s.siteId} highest at ${SLOT_LABELS[hi]}, lowest at ${SLOT_LABELS[lo]}`);
  }
  return parts.length ? ` ${varLabel(v)} mean: ${parts.join('; ')}.` : '';
}

export const diurnal: DiagramDef<DiurnalData> = {
  type: 'diurnal',
  label: 'Diurnal cycle',
  query,
  prepare,
  build,
  relayout: (data, ctx) => stackLayout(data.variables.length, ctx.height, LAYOUT, yLayout(data, ctx.meta, ctx.height).left),
  height: (params) => stackHeight(params.variables.length, PANEL_H, LAYOUT),
  describe: (data, ctx) =>
    `One panel per variable, the hour of the day (site local time) on the x axis, one line per site for the mean ` +
    `and a band for the 25th to 75th percentile.${peakText(data, ctx.meta)}`,
};
