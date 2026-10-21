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
import { VARIABLE_LABELS, type Variable, type ViewParams } from '../state';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, whereClause } from './sql';
import {
  DAY_STEP,
  eventMarkers,
  eventsKeyText,
  joinSubtitle,
  STACK,
  baseOption,
  dayOfYearAxis,
  hasValues,
  readGroups,
  refDateSql,
  siteColors,
  siteLegend,
  siteNames,
  stackHeight,
  stackLayout,
  titleStyle,
  titleText,
  valueAxis,
  varLabel,
  yearOpacity,
  type Group,
} from './common';
import { refYearPx, siteYearTooltip, yearEventMarks, yearRanks, type SeriesInfo } from './years';

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

/** Unit of the running sum of `v`. */
const unitOfSum = (v: Variable) => FLUXES[v] ?? '';

/** Units of the variables as text, for example "g C m-2" or "g C m-2 and g CH4-C m-2". */
function unitsText(vars: Variable[]): string {
  const units = [...new Set(vars.map(unitOfSum))];
  return units.join(' and ');
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
  if (onlyNee) notes.push('Negative = net uptake.');
  else if (vars.some((v) => NEE_VARS.includes(v))) notes.push('Negative NEE = net uptake.');
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
  const layout = stackLayout(vars.length, ctx.height);
  const colors = siteColors(meta, tokens);
  const names = siteNames(meta);
  const ranks = yearRanks(data.groups);
  const last = vars.length - 1;
  const info: SeriesInfo[] = [];
  const series: unknown[] = [];
  const marks = yearEventMarks(ctx, data.groups, refYearPx(ctx.width - STACK.left - STACK.right));
  vars.forEach((v, panel) => {
    data.groups.forEach((g, gi) => {
      if (!hasValues(g, v)) return;
      const [rank, count] = ranks.get(g) ?? [0, 1];
      const name = names.get(g.siteId) ?? String(g.siteId);
      info.push({ siteId: g.siteId, site: name, year: g.year, unit: unitOfSum(v) });
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
  return {
    ...baseOption(tokens),
    legend: siteLegend(meta, tokens, new Set(data.groups.map((g) => g.siteId)), STACK.left, STACK.right),
    title: vars.map((v, i) => ({ ...layout.title[i], text: titleText(`Cumulative ${varLabel(v)}`, unitOfSum(v)), textStyle: titleStyle(tokens) })),
    grid: layout.grid,
    xAxis: vars.map((_, i) => dayOfYearAxis(tokens, i, i === last)),
    yAxis: vars.map((_, i) =>
      valueAxis(tokens, i, {
        scale: false,
        splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
      }),
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
function totalsText(data: CumulativeData, meta: Meta): string {
  const names = siteNames(meta);
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
      return parts.length ? `Cumulative ${varLabel(v)} at the last day with data, ${unitOfSum(v)}: ${parts.join('; ')}.` : '';
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
  relayout: (data, ctx) => stackLayout(data.variables.length, ctx.height),
  height: (params) => stackHeight(Math.max(1, sumVars(params).length), 260),
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
      `one line per site and year. ${other ? 'Only fluxes are summed: NEE, GPP, Reco, CH4. ' : ''}${sign}${totalsText(data, ctx.meta)}`
    );
  },
};
