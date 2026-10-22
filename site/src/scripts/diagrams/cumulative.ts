// Cumulative fluxes: running sum per site and year, x = day of the year.
// CO2 fluxes (NEE, GPP, Reco) in g C m-2, CH4 flux in g CH4-C m-2.
// Daily sum: sum(flux) * 1800 s * 12.011e-6 g C per µmol (one C atom per CO2 or CH4).
// The running sum starts at 0 on the first day with data of each year.
// Only the flux variables in FLUXES are summed. The step setting does not apply.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import type { Meta } from '../db';
import { blockRange } from '../axisRanges';
import { VARIABLE_LABELS, type Variable, type ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';
import {
  DAY_STEP,
  axisNameText,
  dayOfYearAxisName,
  eventMarkers,
  eventsKeyText,
  extent,
  joinSubtitle,
  STACK,
  baseOption,
  hasValues,
  readGroups,
  refDateSql,
  siteColors,
  siteLegend,
  siteNames,
  stackHeight,
  unitText,
  valueAxis,
  axisExtent,
  VARIABLE_SYMBOLS,
  varLabel,
  yAxisName,
  yearOpacity,
  zeroLineSeries,
  type Group,
} from './common';
import {
  refYearPx,
  siteYearTooltip,
  stackDayAxes,
  stackYLayout,
  yearEventMarks,
  yearRanks,
  YEAR_STACK,
  type SeriesInfo,
} from './years';

echarts.use([LineChart]);

/** Flux variables that can be summed, with the unit of the sum. Order = order of the form. */
const FLUXES: Partial<Record<Variable, string>> = {
  nee: 'g C m-2',
  nee_f: 'g C m-2',
  gpp: 'g C m-2',
  reco: 'g C m-2',
  gpp_src: 'g C m-2',
  reco_src: 'g C m-2',
  ch4: 'g CH4-C m-2',
};
const FLUX_VARS = Object.keys(FLUXES) as Variable[];
const NEE_VARS: Variable[] = ['nee', 'nee_f'];

/** Unit of the running sum of `v`, raw form. Use `unitText()` for display. */
const unitOfSum = (v: Variable) => FLUXES[v] ?? '';

/** Display units of the variables as text, for example "g C m⁻²" or "g C m⁻² and g CH₄-C m⁻²". */
function unitsText(vars: Variable[]): string {
  const units = [...new Set(vars.map((v) => unitText(unitOfSum(v))))];
  return units.join(' and ');
}

/** Panel title: "Cumulative NEE, gap-filled — running sum per year". The unit is in the y axis name. */
const sumTitle = (v: Variable) => `Cumulative ${varLabel(v)} — running sum per year`;

/** Y axis name, for example `Cumulative NEE (g C m⁻²)`. `room` = panel height in px. */
const sumAxisName = (v: Variable, room: number) => axisNameText(`Cumulative ${VARIABLE_SYMBOLS[v]}`, unitText(unitOfSum(v)), room);

/** Sign convention of the running sums, for the subtitle. */
function sumSignNote(vars: Variable[]): string | undefined {
  const parts: string[] = [];
  if (vars.some((v) => NEE_VARS.includes(v))) parts.push('cumulative NEE < 0 = net carbon uptake by the ecosystem');
  if (vars.some((v) => v === 'gpp' || v === 'gpp_src' || v === 'reco' || v === 'reco_src')) parts.push('GPP and Reco ≥ 0');
  if (vars.includes('ch4')) parts.push('cumulative F CH₄ > 0 = net emission to the atmosphere');
  return parts.length ? `Sign convention: ${parts.join('; ')}.` : undefined;
}

/** Y range of a sum panel: the data range with 0, because the axis starts at 0 (`scale: false`). */
function sumExtent(groups: Group[], v: Variable): [number, number] {
  const [lo, hi] = extent(groups, v);
  return [Math.min(lo, 0), Math.max(hi, 0)];
}

/** Y layout: one panel per summed variable. */
function yLayout(data: CumulativeData, params: ViewParams, height: number) {
  // Fixed range of all data (view option): the running sums of all sites and years, with 0.
  const ranges = data.variables.map((v) => blockRange(params, 'cumulative', [v]));
  const extents = data.variables.map((v, i) => axisExtent(undefined, ranges[i], sumExtent(data.groups, v)));
  return { ranges, extents, ...stackYLayout(height, extents, (i, panelH) => sumAxisName(data.variables[i] as Variable, panelH)) };
}

interface CumulativeData extends Prepared {
  variables: Variable[];
  groups: Group[];
}

const sumVars = (params: ViewParams) => params.variables.filter((v) => FLUX_VARS.includes(v));

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  const vars = sumVars(params).map(col);
  if (where === null || vars.length === 0) return null;
  // A day without values gives NULL, so the line has a gap there and does not stay flat.
  return `WITH d AS (
      SELECT site_id, year(tl) AS yr, date_trunc('day', tl) AS day,
        ${vars.map((v) => `sum(${v}) * 1800 * 12.011e-6 AS ${v}`).join(', ')}
      FROM obs WHERE ${where} GROUP BY 1, 2, 3)
    SELECT site_id::DOUBLE AS site_id, yr::DOUBLE AS yr, ${refDateSql('day')} AS x,
      ${vars.map((v) => `CASE WHEN ${v} IS NULL THEN NULL ELSE sum(${v}) OVER (PARTITION BY site_id, yr ORDER BY day) END AS ${v}`).join(', ')}
    FROM d ORDER BY 1, 2, 3`;
}

function prepare(table: Table | null, params: ViewParams, meta: Meta): CumulativeData {
  const vars = sumVars(params);
  const base = { variables: vars, groups: [] as Group[] };
  if (table === null) {
    let note = 'Select one or more sites.';
    if (params.sites.length > 0) {
      const names = FLUX_VARS.map((v) => `"${VARIABLE_LABELS[v]}"`).join(', ');
      note = `Cumulative fluxes need one or more flux variables: ${names}. Select one of them.`;
    }
    return { ...base, rowCount: 0, seriesCount: 0, note };
  }
  const groups = readGroups(table, vars, true, DAY_STEP);
  let seriesCount = 0;
  for (const v of vars) for (const g of groups) if (hasValues(g, v)) seriesCount++;
  const onlyNee = vars.every((v) => NEE_VARS.includes(v));
  const notes = [`Running sum per site and year in ${unitsText(vars)}, from the first day with data.`];
  const sign = sumSignNote(vars);
  if (sign) notes.push(sign);
  if (vars.includes('nee')) notes.push('Measured NEE has gaps, so its sum is not an annual balance.');
  if (params.variables.length > vars.length) notes.push('Only fluxes are summed: NEE, GPP, Reco, CH4. The other variables are not shown.');
  const subtitle = joinSubtitle(notes.join(' '), params.events ? eventsKeyText(meta, params) : undefined);
  const data: CumulativeData = { ...base, groups, rowCount: table.numRows, seriesCount, subtitle };
  if (table.numRows === 0) data.note = 'No data for these sites and years.';
  else if (seriesCount === 0) data.note = `No ${onlyNee ? 'NEE' : 'flux'} values for these sites and years.`;
  return data;
}

function build(data: CumulativeData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const vars = data.variables;
  const y = yLayout(data, ctx.params, ctx.height);
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta, ctx.params);
  const ranks = yearRanks(data.groups);
  const info: SeriesInfo[] = [];
  const series: unknown[] = [];
  const marks = yearEventMarks(ctx, data.groups, refYearPx(ctx.width - y.left - STACK.right));
  vars.forEach((v, panel) => {
    data.groups.forEach((g, gi) => {
      if (!hasValues(g, v)) return;
      const [rank, count] = ranks.get(g) ?? [0, 1];
      const name = names.get(g.siteId) ?? String(g.siteId);
      info.push({ siteId: g.siteId, site: name, year: g.year, unit: unitText(unitOfSum(v)) });
      series.push({
        type: 'line',
        name,
        datasetIndex: gi,
        encode: { x: 'x', y: v },
        xAxisIndex: panel,
        yAxisIndex: panel,
        color: colors.get(g.siteId),
        showSymbol: false,
        symbol: 'none',
        connectNulls: false,
        lineStyle: { width: 1.75, opacity: yearOpacity(rank, count) },
        emphasis: { focus: 'series', lineStyle: { width: 2.5, opacity: 1 } },
        ...eventMarkers(marks.byGroup.get(g) ?? [], colors.get(g.siteId) ?? tokens.text, tokens, panel === 0),
      });
    });
  });
  // The zero lines come after all data series, so that the tooltip index `info` stays correct.
  series.push(...vars.flatMap((v, i) => zeroLineSeries(meta, tokens, v, i, y.extents[i] as [number, number]) ?? []));
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, ctx.params, tokens, new Set(data.groups.map((g) => g.siteId)), y.left, STACK.right),
    title: vars.map((v, i) => ({
      ...y.layout.title[i],
      text: sumTitle(v),
      textStyle: { fontSize: 13, fontWeight: 600, color: tokens.text },
    })),
    grid: y.layout.grid,
    xAxis: stackDayAxes(tokens, vars.length, dayOfYearAxisName(meta, ctx.params)),
    yAxis: vars.map((_, i) =>
      valueAxis(
        tokens,
        i,
        {
          scale: false,
          ...yAxisName(tokens, y.names[i] as string, y.widths[i] as number),
        },
        undefined,
        y.ranges[i],
      ),
    ),
    tooltip: siteYearTooltip(ctx, 'day', info, marks.all),
    dataset: data.groups.map((g) => ({
      dimensions: [{ name: 'x', type: 'time' }, ...vars.map((v) => ({ name: v, type: 'float' }))],
      source: { x: g.x, ...g.values },
    })),
    series,
  };
}

/** Last value of each site-year line, for the alt text. */
function totalsText(data: CumulativeData, meta: Meta, params: ViewParams): string {
  const names = siteNames(meta, params);
  return data.variables
    .map((v) => {
      const parts: string[] = [];
      for (const g of data.groups) {
        const a = g.values[v];
        if (!a) continue;
        let lastValue = Number.NaN;
        let lastX = 0;
        for (let i = a.length - 1; i >= 0; i--) {
          if (Number.isFinite(a[i])) {
            lastValue = a[i] as number;
            lastX = g.x[i] as number;
            break;
          }
        }
        if (!Number.isFinite(lastValue)) continue;
        const end = new Date(lastX).toISOString().slice(5, 10);
        parts.push(`${names.get(g.siteId) ?? g.siteId} ${g.year} ${Math.round(lastValue)} (to ${end})`);
      }
      return parts.length ? `Cumulative ${varLabel(v)} at the last day with data, ${unitText(unitOfSum(v))}: ${parts.join('; ')}.` : '';
    })
    .filter(Boolean)
    .join(' ');
}

export const cumulative: DiagramDef<CumulativeData> = {
  type: 'cumulative',
  label: 'Cumulative fluxes',
  query,
  prepare,
  build,
  showsEvents: true,
  relayout: (data, ctx) => yLayout(data, ctx.params, ctx.height).layout,
  height: (params) => stackHeight(Math.max(1, sumVars(params).length), 260, YEAR_STACK),
  statsVariables: sumVars,
  describe: (data, ctx) => {
    const onlyNee = data.variables.every((v) => NEE_VARS.includes(v));
    const other = ctx.params.variables.length > data.variables.length;
    const what = onlyNee ? 'NEE' : data.variables.map(varLabel).join(', ');
    const sign = onlyNee
      ? 'Negative values are net uptake of carbon. '
      : data.variables.some((v) => NEE_VARS.includes(v))
        ? 'Negative NEE is net uptake of carbon. '
        : '';
    return (
      `Running sum of ${what} per site and year in ${unitsText(data.variables)}, the day of the year on the x axis, ` +
      `one line per site and year. ${other ? 'Only fluxes are summed: NEE, GPP, Reco, CH4. ' : ''}${sign}${totalsText(data, ctx.meta, ctx.params)}`
    );
  },
};
