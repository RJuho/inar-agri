// Alt text of the diagrams. A stats query gives values per site and variable.
// Each diagram type gives one sentence that tells how it shows the data (describe()).
// The alt text is: that sentence, then the sites, years and statistics.
// The cards show it in a figcaption and set it as aria-label of the chart element.
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from './db';
import { VARIABLE_LABELS, type Variable, type ViewParams } from './state';
import { col, whereClause } from './diagrams/sql';
import { formatValue, unitOf, yearsText } from './diagrams/common';

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
    return `SELECT '${c}' AS variable, b.site_id::DOUBLE AS site_id, b.n, b.mean, b.vmin, b.vmax, b.tmin, b.tmax,
        coalesce(t.trend, 'NaN'::DOUBLE) AS trend, coalesce(t.years, 0)::DOUBLE AS years
      FROM (
        SELECT site_id, count(${c})::DOUBLE AS n, avg(${c}) AS mean, min(${c}) AS vmin, max(${c}) AS vmax,
          epoch_ms(arg_min(tl, ${c}))::DOUBLE AS tmin, epoch_ms(arg_max(tl, ${c}))::DOUBLE AS tmax
        FROM obs WHERE ${where} AND ${c} IS NOT NULL GROUP BY site_id
      ) b
      LEFT JOIN (
        SELECT site_id, CASE WHEN count(*) >= 3 THEN regr_slope(m, yr) END AS trend, count(*) AS years
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
  const names = meta.sites.filter((s) => params.sites.includes(s.siteId)).map((s) => s.name);
  return names.length === 0 ? 'no sites' : `${names.length === 1 ? 'site' : 'sites'} ${listText(names)}`;
}

const date = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : 'unknown date');

function signed(v: number): string {
  const s = formatValue(v);
  return v > 0 ? `+${s}` : s;
}

/** One sentence per variable with the statistics of each site. */
export function statsText(stats: SiteStats[], variables: Variable[], meta: Meta): string {
  const name = new Map(meta.sites.map((s) => [s.siteId, s.name]));
  const order = new Map(meta.sites.map((s, i) => [s.siteId, i]));
  const sentences: string[] = [];
  for (const v of variables) {
    const unit = unitOf(meta, v);
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

/** Alt text: type sentence, sites and years, then statistics. */
export function composeAlt(
  label: string,
  describe: string,
  params: ViewParams,
  meta: Meta,
  stats: SiteStats[],
  variables: Variable[],
): string {
  const head = `${label}: ${listText(variables.map((v) => VARIABLE_LABELS[v]))} at ${siteListText(params, meta)}, ${yearsText(params)}.`;
  const body = stats.length > 0 ? ` ${statsText(stats, variables, meta)}` : '';
  return `${head} ${describe}${body}`.trim();
}
