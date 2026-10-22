// Alt text of the diagrams. A stats query gives values per site and variable.
// Each diagram type gives one sentence that tells how it shows the data (describe()).
// The alt text is: that sentence, then the sites, years and statistics.
// The cards show it in a figcaption and set it as aria-label of the chart element.
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from './db';
import { VARIABLE_LABELS, type Variable, type ViewParams } from './state';
import { FIXED_Y_SENTENCE } from './axisRanges';
import { CIRCULAR_VARS, col, meanExpr, whereClause } from './diagrams/sql';
import {
  displayUnit,
  eventDateText,
  eventLabel,
  eventsInRange,
  eventSymbol,
  formatValue,
  selectedSiteLabels,
  shortDetail,
  siteLabel,
  siteNames,
  X_NAME_TITLE_ID,
  yearsText,
} from './diagrams/common';
import { eventFacts, yieldKeyText } from './events';

/** Statistics of one variable at one site, from all 30-minute values in the view range. */
export interface SiteStats {
  siteId: number;
  variable: Variable;
  count: number;
  mean: number;
  min: number;
  max: number;
  /** Local time (epoch ms) of the min and max value. */
  tMin: number;
  tMax: number;
  /** Change of the annual mean per year. NaN when fewer than 3 near-full years exist. */
  trend: number;
  /** Number of near-full years (300 days or more) in the trend. */
  trendYears: number;
}

/** A year counts for the trend when it has data on this many days. */
const FULL_YEAR_DAYS = 300;

/**
 * SQL for the statistics per site and variable. One UNION ALL part per variable.
 * Returns null when no site or no variable is selected.
 */
export function statsQuery(params: ViewParams, variables: Variable[]): string | null {
  const where = whereClause(params);
  if (where === null || variables.length === 0) return null;
  const parts = variables.map((v) => {
    const c = col(v);
    // A linear trend of a direction has no meaning: wd gets no trend.
    const trendOk = CIRCULAR_VARS.has(v) ? 'false' : 'true';
    return `SELECT '${c}' AS variable, b.site_id::DOUBLE AS site_id, b.n, b.mean, b.vmin, b.vmax, b.tmin, b.tmax,
        coalesce(t.trend, 'NaN'::DOUBLE) AS trend, coalesce(t.years, 0)::DOUBLE AS years
      FROM (
        SELECT site_id, count(${c})::DOUBLE AS n, ${meanExpr(v)} AS mean, min(${c}) AS vmin, max(${c}) AS vmax,
          epoch_ms(arg_min(tl, ${c}))::DOUBLE AS tmin, epoch_ms(arg_max(tl, ${c}))::DOUBLE AS tmax
        FROM obs WHERE ${where} AND ${c} IS NOT NULL GROUP BY site_id
      ) b
      LEFT JOIN (
        SELECT site_id, CASE WHEN count(*) >= 3 AND ${trendOk} THEN regr_slope(m, yr) END AS trend, count(*) AS years
        FROM (
          SELECT site_id, year(tl) AS yr, avg(${c}) AS m
          FROM obs WHERE ${where} AND ${c} IS NOT NULL
          GROUP BY ALL HAVING count(DISTINCT date_trunc('day', tl)) >= ${FULL_YEAR_DAYS}
        ) GROUP BY site_id
      ) t USING (site_id)`;
  });
  return `${parts.join('\nUNION ALL\n')}\nORDER BY variable, site_id`;
}

export function parseStats(table: Table): SiteStats[] {
  const n = table.numRows;
  const num = (name: string) => toFloat64(table.getChild(name), n);
  const [site, cnt, mean, vmin, vmax, tmin, tmax, trend, years] = [
    'site_id',
    'n',
    'mean',
    'vmin',
    'vmax',
    'tmin',
    'tmax',
    'trend',
    'years',
  ].map(num) as Float64Array[];
  const varCol = table.getChild('variable');
  const out: SiteStats[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      siteId: site![i] as number,
      variable: String(varCol?.get(i)) as Variable,
      count: cnt![i] as number,
      mean: mean![i] as number,
      min: vmin![i] as number,
      max: vmax![i] as number,
      tMin: tmin![i] as number,
      tMax: tmax![i] as number,
      trend: trend![i] as number,
      trendYears: years![i] as number,
    });
  }
  return out;
}

/** Join names: "A", "A and B", "A, B and C". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Names of the selected sites, in the order of sites.parquet. */
export function siteListText(params: ViewParams, meta: Meta): string {
  const names = selectedSiteLabels(meta, params);
  return names.length === 0 ? 'no sites' : `${names.length === 1 ? 'site' : 'sites'} ${listText(names)}`;
}

const date = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : 'unknown date');

function signed(v: number): string {
  const s = formatValue(v);
  return v > 0 ? `+${s}` : s;
}

/** One sentence per variable with the statistics of each site. */
export function statsText(stats: SiteStats[], variables: Variable[], meta: Meta, params: ViewParams): string {
  const name = siteNames(meta, params);
  const order = new Map(meta.sites.map((s, i) => [s.siteId, i]));
  const sentences: string[] = [];
  for (const v of variables) {
    const unit = displayUnit(meta, v);
    const rows = stats
      .filter((s) => s.variable === v && s.count > 0)
      .sort((a, b) => (order.get(a.siteId) ?? 0) - (order.get(b.siteId) ?? 0));
    if (rows.length === 0) {
      sentences.push(`${VARIABLE_LABELS[v]}: no data.`);
      continue;
    }
    const parts = rows.map((s) => {
      let t = `${name.get(s.siteId) ?? s.siteId} mean ${formatValue(s.mean)}, min ${formatValue(s.min)} on ${date(s.tMin)}, max ${formatValue(s.max)} on ${date(s.tMax)}`;
      if (Number.isFinite(s.trend)) t += `, annual mean change ${signed(s.trend)} per year over ${s.trendYears} years`;
      return t;
    });
    sentences.push(`${VARIABLE_LABELS[v]} (${unit}): ${parts.join('; ')}.`);
  }
  return sentences.join(' ');
}

const asList = (part: unknown): unknown[] => (Array.isArray(part) ? part : part ? [part] : []);

/** Names of the axes in an option part (`xAxis` or `yAxis`): unique, in order, on one line. */
function axisNames(axes: unknown[], key: 'name' | 'text' = 'name'): string[] {
  const names = axes
    .map((a) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[key] : undefined))
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    .map((n) => n.replace(/\s*\n\s*/g, ' ').trim());
  return [...new Set(names)];
}

/**
 * Sentence that names the axes of a chart, from its ECharts option, for example
 * "X axis: Date (local time, UTC+2); y axis: NEE (µmol CO₂ m⁻² s⁻¹)."
 * It reads the same names that the chart shows: `xAxis[].name`, `yAxis[].name` and the titles
 * with an id that starts with `X_NAME_TITLE_ID` (x axis name for many panels). Empty when the axes have no names.
 */
export function axesText(option: unknown): string {
  const o = (option ?? {}) as { xAxis?: unknown; yAxis?: unknown; title?: unknown };
  const xTitles = asList(o.title).filter(
    (t) => t && typeof t === 'object' && String((t as { id?: unknown }).id ?? '').startsWith(X_NAME_TITLE_ID),
  );
  const xNames = [...new Set([...axisNames(asList(o.xAxis)), ...axisNames(xTitles, 'text')])];
  const part = (axis: 'x' | 'y', names: string[]) =>
    names.length === 0 ? '' : `${axis} ${names.length === 1 ? 'axis' : 'axes'}: ${names.join(', ')}`;
  const text = [part('x', xNames), part('y', axisNames(asList(o.yAxis)))].filter(Boolean).join('; ');
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : '';
}

/**
 * Sentences about the management events of the selected sites in the period, one per site.
 * `markers` = the diagram draws the events as marker lines.
 */
export function eventsText(params: ViewParams, meta: Meta, markers: boolean): string {
  const events = eventsInRange(meta, params);
  if (events.length === 0) return 'No management events for the selected sites in this period.';
  const out: string[] = [];
  if (markers) {
    const types = [...new Set(events.map((e) => e.type))];
    out.push(
      `Dashed vertical lines in the site colour mark the management events, labelled ${listText(types.map((t) => `${eventSymbol(t)} (${eventLabel(t).toLowerCase()})`))}.${yieldKeyText(events)}`,
    );
  }
  for (const site of meta.sites) {
    const list = events.filter((e) => e.siteId === site.siteId);
    if (list.length === 0) continue;
    const parts = list.map((e) => `${eventLabel(e.type).toLowerCase()} ${eventDateText(e)} (${[shortDetail(e.detail), ...eventFacts(e)].join(', ')})`);
    out.push(`Management events at ${siteLabel(site, params)} (${list.length}): ${parts.join('; ')}.`);
  }
  const without = meta.sites.filter((s) => params.sites.includes(s.siteId) && !events.some((e) => e.siteId === s.siteId));
  if (without.length > 0) out.push(`No management events for ${listText(without.map((s) => siteLabel(s, params)))} in this period.`);
  return out.join(' ');
}

/**
 * Alt text: type sentence, sites and years, axis names (`axesText()`), the fixed range sentence
 * when `fixedRange` is true, then statistics, then the events when `params.events` is on.
 */
export function composeAlt(
  label: string,
  describe: string,
  params: ViewParams,
  meta: Meta,
  stats: SiteStats[],
  variables: Variable[],
  markers = false,
  axes = '',
  fixedRange = false,
): string {
  const head = `${label}: ${listText(variables.map((v) => VARIABLE_LABELS[v]))} at ${siteListText(params, meta)}, ${yearsText(params)}.`;
  const axesPart = `${axes ? ` ${axes}` : ''}${fixedRange ? ` ${FIXED_Y_SENTENCE}` : ''}`;
  const body = stats.length > 0 ? ` ${statsText(stats, variables, meta, params)}` : '';
  const events = params.events ? ` ${eventsText(params, meta, markers)}` : '';
  return `${head} ${describe}${axesPart}${body}${events}`.trim();
}
