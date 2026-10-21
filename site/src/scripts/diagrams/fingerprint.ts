// Fingerprint plot, as in REddyProc (sPlotFingerprintY): a heatmap with the date on the x axis
// and the time of day (48 half hours, site local time) on the y axis. The colour is the value.
// It shows the diurnal pattern, the seasonal pattern and the gaps in one image.
// One panel per selected variable and site: one block per variable, in each block one row per site.
// The diagram always uses the 30-minute values. The step setting does not apply.
// A long period is binned on the x axis: one column per day up to MAX_COLUMNS days, else
// ceil(days / MAX_COLUMNS) days per column (mean of the values in the bin, per half hour).
import * as echarts from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import { VisualMapComponent } from 'echarts/components';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import { VARIABLE_LABELS, type Variable, type ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, meanExpr, periodBounds, whereClause } from './sql';
import {
  FIXED_GRID,
  FLUX_VARS,
  MONTH_NAMES,
  X_NAME_SPACE,
  axisName,
  axisNameText,
  baseOption,
  displayUnit,
  esc,
  formatValue,
  gridLeftFor,
  joinSubtitle,
  nameLines,
  panelTitle,
  signNote,
  siteColors,
  siteNames,
  textWidth,
  timeAxisName,
  titleStyle,
  tooltipBase,
  valueWithUnit,
  xAxisName,
  yAxisName,
} from './common';

echarts.use([HeatmapChart, VisualMapComponent]);

const SLOTS = 48;
const slotLabel = (i: number) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
const SLOT_LABELS = Array.from({ length: SLOTS }, (_, i) => slotLabel(i));
/** Y tick and label every 6 hours = 12 half hours. ECharts `interval` = categories to skip. */
const Y_TICK_EVERY = 12;
/** Largest number of columns on the x axis. More days are binned. */
const MAX_COLUMNS = 400;
/** Largest number of panels (variables × sites). More panels give a note. */
const MAX_PANELS = 24;
/** Quantiles of the colour range. */
const Q_LO = 0.02;
const Q_HI = 0.98;

/** Panel statistic in the title. The step setting does not apply. */
const STAT = '30-min values';

/**
 * Layout in px. Each variable block has a header with the block title and the colour scale.
 * Each site panel has a gap above it for the site name. The bottom holds the date labels and the x axis name.
 */
const LAYOUT = { top: 8, bottom: X_NAME_SPACE + 4, header: 54, siteGap: 24, left: 56, right: 16 };
/** Panel height in px. */
const PANEL_H = 140;
/** Colour bar: thickness and length in px. */
const BAR = { thickness: 10, length: 150 };

/**
 * Colour ramps. They are the only hard-coded colours: the scale must be the same in light and dark mode.
 * Diverging (flux variables, centred on 0): cool-warm after Moreland, blue – light grey – red.
 * The grey middle is visible on a light and a dark background, so a value near 0 is not a gap.
 * Sequential (other variables): viridis stops.
 */
const DIVERGING = ['#3b4cc0', '#7c9ff9', '#dddddd', '#f59c7d', '#b40426'];
const SEQUENTIAL = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];

/** One heatmap panel: one variable at one site. */
interface Panel {
  variable: Variable;
  siteId: number;
  /** [column index, half hour index, value] per cell with data. */
  cells: Array<[number, number, number]>;
}

/** Colour scale of one variable block. */
interface Scale {
  variable: Variable;
  min: number;
  max: number;
  diverging: boolean;
}

interface FingerprintData extends Prepared {
  variables: Variable[];
  /** Epoch ms (local wall time read as UTC) of the first day of the period with data. */
  day0: number;
  /** Days per column. */
  bin: number;
  /** Number of columns. */
  columns: number;
  panels: Panel[];
  scales: Scale[];
}

const panelCount = (params: ViewParams) => params.variables.length * params.sites.length;

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  if (where === null || params.variables.length === 0 || panelCount(params) > MAX_PANELS) return null;
  const vars = params.variables.map(col);
  // r: first and last day with a value of one of the variables. b: days per column.
  // c: mean per site, column and half hour. q: quantiles of the cell values per variable, for the
  // colour range. The last SELECT adds d0, bin and the quantiles to each row.
  // A period limit sets the first or last day, also when there is no data near it.
  const hasValue = vars.map((v) => `${v} IS NOT NULL`).join(' OR ');
  const { from, to } = periodBounds(params);
  // min() and max() also around the constants: r must have one row, also when both limits are set.
  const d0 = from ? `min(make_date(${from[0]}, ${from[1]}, 1))` : 'min(tl::DATE)';
  const d1 = to ? `max((make_date(${to[0]}, ${to[1]}, 1) - INTERVAL 1 DAY)::DATE)` : 'max(tl::DATE)';
  return `WITH r AS (
      SELECT ${d0} AS d0, ${d1} AS d1 FROM obs WHERE ${where} AND (${hasValue})
    ), b AS (
      SELECT d0, d1, greatest(1, ceil((date_diff('day', d0, d1) + 1) / ${MAX_COLUMNS}.0))::INTEGER AS bin FROM r
    ), c AS (
      SELECT site_id, date_diff('day', b.d0, tl::DATE) // b.bin AS x, hour(tl) * 2 + minute(tl) // 30 AS slot,
        ${vars.map((v) => `${meanExpr(v)} AS ${v}`).join(', ')}
      FROM obs, b WHERE ${where} GROUP BY ALL
      HAVING ${vars.map((v) => `count(${v})`).join(' + ')} > 0
    ), q AS (
      SELECT ${vars.map((v) => `quantile_cont(${v}, ${Q_LO}) AS ${v}__lo, quantile_cont(${v}, ${Q_HI}) AS ${v}__hi`).join(', ')} FROM c
    )
    SELECT c.site_id::DOUBLE AS site_id, c.x::DOUBLE AS x, c.slot::DOUBLE AS slot, ${vars.map((v) => `c.${v}`).join(', ')},
      epoch_ms(b.d0::TIMESTAMP)::DOUBLE AS d0, epoch_ms(b.d1::TIMESTAMP)::DOUBLE AS d1, b.bin::DOUBLE AS bin, q.*
    FROM c, b, q ORDER BY 1, 2, 3`;
}

/** Colour range of a variable from the quantiles of the cell values. Fluxes get a symmetric range around 0. */
function makeScale(v: Variable, lo: number, hi: number): Scale {
  const diverging = FLUX_VARS.has(v);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { variable: v, min: diverging ? -1 : 0, max: 1, diverging };
  if (diverging) {
    const r = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    return { variable: v, min: -r, max: r, diverging };
  }
  return { variable: v, min: lo, max: hi > lo ? hi : lo + 1, diverging };
}

function prepare(table: Table | null, params: ViewParams, meta: Meta): FingerprintData {
  const base = { variables: params.variables, day0: 0, bin: 1, columns: 0, panels: [] as Panel[], scales: [] as Scale[] };
  if (table === null) {
    let note = params.sites.length === 0 ? 'Select one or more sites.' : 'Select one or more variables.';
    if (params.sites.length > 0 && params.variables.length > 0) {
      note = `Too many panels: ${panelCount(params)} (${params.variables.length} variables × ${params.sites.length} sites). ` +
        `The fingerprint shows at most ${MAX_PANELS} panels. Select fewer variables or sites.`;
    }
    return { ...base, rowCount: 0, seriesCount: 0, note };
  }
  const n = table.numRows;
  if (n === 0) return { ...base, rowCount: 0, seriesCount: 0, note: 'No data for these sites and years.' };
  const site = toFloat64(table.getChild('site_id'), n);
  const x = toFloat64(table.getChild('x'), n);
  const slot = toFloat64(table.getChild('slot'), n);
  const read = (name: string) => toFloat64(table.getChild(name), n);
  const day0 = read('d0')[0] as number;
  const bin = read('bin')[0] as number;
  // Columns from the first to the last day, also the empty columns at the ends.
  const day1 = read('d1')[0] as number;
  let columns = Math.floor(Math.round((day1 - day0) / (24 * 3600 * 1000)) / bin) + 1;
  for (let i = 0; i < n; i++) if ((x[i] as number) + 1 > columns) columns = (x[i] as number) + 1;
  // Panel order: variable blocks, in each block the sites in the order of sites.parquet.
  const order = new Map(meta.sites.map((s, i) => [s.siteId, i]));
  const siteIds = [...new Set(Array.from(site))].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const panels: Panel[] = [];
  const scales: Scale[] = [];
  for (const v of params.variables) {
    const values = read(v);
    const bySite = new Map<number, Panel>(siteIds.map((id) => [id, { variable: v, siteId: id, cells: [] }]));
    for (let i = 0; i < n; i++) {
      const y = values[i] as number;
      if (Number.isFinite(y)) bySite.get(site[i] as number)?.cells.push([x[i] as number, slot[i] as number, y]);
    }
    for (const id of siteIds) {
      const p = bySite.get(id) as Panel;
      if (p.cells.length > 0) panels.push(p);
    }
    scales.push(makeScale(v, read(`${v}__lo`)[0] as number, read(`${v}__hi`)[0] as number));
  }
  const binText = bin === 1 ? 'Each column is one day' : `Each column is the mean of ${bin} days`;
  const subtitle = joinSubtitle(
    signNote(params.variables),
    `30-minute values in site local time, one row per half hour; the step setting does not apply. ${binText}. ` +
      `Empty cells = no data. The colour range is the 2nd to 98th percentile of the cell values; values outside it get the end colour.`,
  );
  const data: FingerprintData = { ...base, day0, bin, columns, panels, scales, rowCount: n, seriesCount: panels.length, subtitle };
  if (panels.length === 0) data.note = 'No values for these variables, sites and years.';
  return data;
}

/** Date (yyyy-mm-dd) of the first day of column `i`. */
function columnDate(data: FingerprintData, i: number): string {
  return new Date(data.day0 + i * data.bin * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Date text of column `i` for the tooltip: one day, or the first and last day of the bin. */
function columnText(data: FingerprintData, i: number): string {
  const first = columnDate(data, i);
  if (data.bin === 1) return first;
  const last = new Date(data.day0 + ((i + 1) * data.bin - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return `${first} to ${last}`;
}

/**
 * Plan of the x labels: which columns get a tick and a label, and the label text.
 * Short periods label the 1st and 15th of each month ("1 Mar", "15 Mar"). Longer periods label
 * the first column of every n-th month ("Mar 2022"), long periods only January ("2022").
 */
function xLabelPlan(dates: string[], bin: number) {
  const days = dates.length * bin;
  const months = days / 30.4;
  const every = months <= 24 ? 1 : months <= 60 ? 3 : months <= 120 ? 6 : 12;
  const show = new Set<number>();
  const text = new Map<number, string>();
  let lastMonth = '';
  dates.forEach((d, i) => {
    const month = d.slice(0, 7);
    const mon = MONTH_NAMES[Number(d.slice(5, 7)) - 1] as string;
    if (days <= 120) {
      // Daily columns: the 1st and the 15th.
      const day = Number(d.slice(8, 10));
      if (day === 1 || day === 15 || i === 0) {
        show.add(i);
        text.set(i, `${day} ${mon}`);
      }
      return;
    }
    if (month === lastMonth) return;
    lastMonth = month;
    const m = Number(d.slice(5, 7));
    if ((m - 1) % every !== 0) return;
    show.add(i);
    text.set(i, every === 12 ? d.slice(0, 4) : `${mon} ${d.slice(0, 4)}`);
  });
  return { show, text };
}

/** Row of the panels: variable block and position in the block. */
function panelRows(data: FingerprintData) {
  const rows: Array<{ panel: Panel; block: number }> = [];
  data.variables.forEach((v, block) => {
    for (const p of data.panels) if (p.variable === v) rows.push({ panel: p, block });
  });
  return rows;
}

/** Blocks with one or more panels, in the order of the variables. */
const blocksShown = (data: FingerprintData) => data.variables.filter((v) => data.panels.some((p) => p.variable === v));

/**
 * Positions in px: grid of each panel, title of each block and each panel, colour bar of each block.
 * The panel height follows the chart height, with the same formula as `height()`.
 */
function layout(data: FingerprintData, height: number, left: number) {
  const blocks = blocksShown(data);
  const rows = panelRows(data);
  const k = Math.max(rows.length, 1);
  const fixed = LAYOUT.top + LAYOUT.bottom + blocks.length * LAYOUT.header + k * LAYOUT.siteGap;
  const panelH = Math.max(40, (height - fixed) / k);
  const grid: Array<Record<string, unknown>> = [];
  const panelTitles: Array<{ top: number; left: number }> = [];
  const blockTops: number[] = [];
  let y = LAYOUT.top;
  let lastBlock = -1;
  for (const { block } of rows) {
    if (block !== lastBlock) {
      blockTops.push(y);
      y += LAYOUT.header;
      lastBlock = block;
    }
    y += LAYOUT.siteGap;
    grid.push({ top: y, height: panelH, left, right: LAYOUT.right, ...FIXED_GRID });
    panelTitles.push({ top: y - 22, left: left - 8 });
    y += panelH;
  }
  return { grid, panelTitles, blockTops, panelH };
}

/** Width of the widest y tick label ("00:00"). */
const Y_LABEL_WIDTH = () => Math.ceil(textWidth('00:00'));

/** Y axis name and the left margin of all panels. */
function yLayout(panelH: number) {
  const name = axisNameText('Time of day', 'local time', panelH);
  const width = Y_LABEL_WIDTH();
  return { name, width, left: Math.max(LAYOUT.left, gridLeftFor(width, nameLines(name))) };
}

/** Full layout from the chart height: the left margin needs the panel height (for the y axis name lines). */
function fullLayout(data: FingerprintData, height: number) {
  const first = layout(data, height, LAYOUT.left);
  const y = yLayout(first.panelH);
  return { ...layout(data, height, y.left), y };
}

/** Text of a colour range end for the colour bar. */
const scaleText = (v: number) => (v > 0 ? `+${formatValue(v)}` : formatValue(v));

/** Option parts of the colour bars (one visualMap per variable block) and the block titles. */
function blockParts(data: FingerprintData, ctx: BuildContext, lay: ReturnType<typeof fullLayout>) {
  const { tokens, meta } = ctx;
  const rows = panelRows(data);
  const blocks = blocksShown(data);
  const titles: unknown[] = [];
  const visualMap: unknown[] = [];
  blocks.forEach((v, bi) => {
    const top = lay.blockTops[bi] as number;
    const scale = data.scales.find((s) => s.variable === v) as Scale;
    const seriesIndex = rows.map((r, i) => (r.panel.variable === v ? i : -1)).filter((i) => i >= 0);
    titles.push({
      top,
      left: lay.y.left - 8,
      text: panelTitle(v, STAT),
      textStyle: titleStyle(tokens),
    });
    // Colour bar below the block title: the low value at the left, the high value and the unit at the right.
    const label = `Colour: ${axisName(meta, v)}`;
    titles.push({
      top: top + 27,
      left: lay.y.left - 8,
      text: label,
      textStyle: { fontSize: 11, fontWeight: 400, color: tokens.textMuted },
    });
    const colors = scale.diverging ? DIVERGING : SEQUENTIAL;
    visualMap.push({
      type: 'continuous',
      calculable: false,
      orient: 'horizontal',
      left: lay.y.left + Math.ceil(textWidth(label, '11px system-ui, sans-serif')) + 8,
      top: top + 22,
      itemWidth: BAR.thickness,
      itemHeight: BAR.length,
      min: scale.min,
      max: scale.max,
      precision: 2,
      inRange: { color: colors },
      // Values outside the range get the end colour of that side.
      outOfRange: { color: [colors[0], colors[colors.length - 1]] },
      text: [scaleText(scale.max), scaleText(scale.min)],
      textGap: 6,
      textStyle: { color: tokens.textMuted, fontSize: 11 },
      formatter: (v: number) => formatValue(v),
      seriesIndex,
      hoverLink: false,
      z: 4,
    });
  });
  return { titles, visualMap };
}

function build(data: FingerprintData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const lay = fullLayout(data, ctx.height);
  const rows = panelRows(data);
  const last = rows.length - 1;
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta, ctx.params);
  const dates = Array.from({ length: data.columns }, (_, i) => columnDate(data, i));
  const plan = xLabelPlan(dates, data.bin);
  const blocks = blockParts(data, ctx, lay);
  const unit = (v: Variable) => displayUnit(meta, v);
  return {
    ...baseOption(tokens),
    title: [
      ...blocks.titles,
      // Site name above each panel, in the site colour.
      ...rows.map(({ panel }, i) => ({
        ...(lay.panelTitles[i] as { top: number; left: number }),
        text: names.get(panel.siteId) ?? String(panel.siteId),
        textStyle: { fontSize: 12, fontWeight: 600, color: colors.get(panel.siteId) ?? tokens.text },
      })),
    ],
    grid: lay.grid,
    xAxis: rows.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: dates,
      axisLine: { lineStyle: { color: tokens.axis } },
      axisTick: { show: i === last, alignWithLabel: true, interval: (idx: number) => plan.show.has(idx) },
      axisLabel: {
        show: i === last,
        color: tokens.textMuted,
        hideOverlap: true,
        interval: (idx: number) => plan.show.has(idx),
        formatter: (_: string, idx: number) => plan.text.get(idx) ?? '',
      },
      splitLine: { show: false },
      ...(i === last ? xAxisName(tokens, timeAxisName(meta, ctx.params)) : {}),
    })),
    yAxis: rows.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: SLOT_LABELS,
      axisLine: { show: true, lineStyle: { color: tokens.axis } },
      axisTick: { show: true, alignWithLabel: true, interval: Y_TICK_EVERY - 1, lineStyle: { color: tokens.axis } },
      axisLabel: { color: tokens.textMuted, interval: Y_TICK_EVERY - 1 },
      splitLine: { show: false },
      ...yAxisName(tokens, lay.y.name, lay.y.width),
    })),
    visualMap: blocks.visualMap,
    tooltip: {
      ...tooltipBase(tokens, 'item'),
      formatter: (raw: unknown) => {
        const p = raw as { seriesIndex: number; data: [number, number, number] };
        const row = rows[p.seriesIndex];
        if (!row) return '';
        const [xi, slot, value] = p.data;
        const site = names.get(row.panel.siteId) ?? String(row.panel.siteId);
        const end = slot + 1 < SLOTS ? SLOT_LABELS[slot + 1] : '24:00';
        return (
          `<b>${esc(columnText(data, xi))}</b> · ${SLOT_LABELS[slot]} to ${end} local time<br/>` +
          `${esc(site)} · ${esc(VARIABLE_LABELS[row.panel.variable])}: ${valueWithUnit(value, unit(row.panel.variable))}`
        );
      },
    },
    series: rows.map(({ panel }, i) => ({
      type: 'heatmap',
      name: names.get(panel.siteId) ?? String(panel.siteId),
      xAxisIndex: i,
      yAxisIndex: i,
      data: panel.cells,
      // Draw all cells in one frame, so that the PNG export has the full image.
      progressive: 0,
      emphasis: { disabled: true },
      itemStyle: { borderWidth: 0 },
    })),
  };
}

/** Text of the colour ranges for the alt text. */
function scalesText(data: FingerprintData, meta: Meta): string {
  return data.scales
    .filter((s) => data.panels.some((p) => p.variable === s.variable))
    .map((s) => `${VARIABLE_LABELS[s.variable]} ${scaleText(s.min)} to ${scaleText(s.max)} ${displayUnit(meta, s.variable)}`)
    .join('; ');
}

export const fingerprint: DiagramDef<FingerprintData> = {
  type: 'fingerprint',
  label: 'Fingerprint (date × time of day)',
  query,
  prepare,
  build,
  showsEvents: false,
  relayout: (data, ctx) => {
    const lay = fullLayout(data, ctx.height);
    const blocks = blockParts(data, ctx, lay);
    return {
      grid: lay.grid,
      visualMap: blocks.visualMap,
      title: [...blocks.titles, ...lay.panelTitles],
    };
  },
  height: (params, data) => {
    const panels = data ? data.panels.length : Math.min(MAX_PANELS, panelCount(params));
    const blocks = data ? blocksShown(data).length : params.variables.length;
    if (panels === 0) return 160;
    return LAYOUT.top + LAYOUT.bottom + blocks * LAYOUT.header + panels * (LAYOUT.siteGap + PANEL_H);
  },
  describe: (data, ctx) => {
    const n = data.panels.length;
    const cols = data.bin === 1 ? 'Each column is one day' : `Each column is the mean of ${data.bin} days`;
    return (
      `Fingerprint heatmap: the date on the x axis, the time of day (site local time) on the y axis, ` +
      `one panel per site and variable (${n} ${n === 1 ? 'panel' : 'panels'}); the colour gives the value, empty cells are gaps. ` +
      `${cols}. Colour range (2nd to 98th percentile): ${scalesText(data, ctx.meta)}.`
    );
  },
};
