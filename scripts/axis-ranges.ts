/// <reference lib="dom" />
// The DOM types are only for site/src/scripts/state.ts (Web storage code that this script does not run).
// Fixed y ranges of all data for the website (view option "Fixed y range (all data)").
//
// Run: part of npm run site:sync (scripts/sync-site-data.ts calls writeAxisRanges() at the end),
// or alone: node scripts/axis-ranges.ts
// Input: the files in site/public/data/ (the files that the page reads).
// Output: site/src/data/axis-ranges.json (not in git). Vite imports it at build time.
// The SQL makes the same `obs` table as site/src/scripts/db.ts and uses the same step
// expressions (stepExpr(), meanExpr()) as the diagrams. Ranges are the absolute min and max
// over all sites and years, except the fingerprint (2 % and 98 % quantiles).
// The schema of the file is AxisRangesSchema in site/src/scripts/axisRanges.ts.

import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import * as v from 'valibot';
import { one } from './lib/duck.ts';
import { AGGREGATIONS, VARIABLES, type Variable } from '../site/src/scripts/state.ts';
import { CIRCULAR_VARS, meanExpr, stepExpr } from '../site/src/scripts/diagrams/sql.ts';
import { AxisRangesSchema, type AxisRanges, type Range } from '../site/src/scripts/axisRanges.ts';

const DATA_DIR = 'site/public/data';
const OUT_FILE = 'site/src/data/axis-ranges.json';

/** Flux variables of the cumulative and budget diagrams (cumulative.ts, budget.ts `FLUXES`). */
const SUM_FLUXES: Variable[] = ['nee', 'nee_f', 'gpp', 'reco', 'gpp_src', 'reco_src', 'ch4'];
/** Drawn negative in the budget diagram (budget.ts `NEGATED`). */
const NEGATED = new Set<Variable>(['gpp', 'gpp_src']);
/** Quantiles of the fingerprint colour range (fingerprint.ts Q_LO, Q_HI). */
const Q_LO = 0.02;
const Q_HI = 0.98;
/** Carbon in g per µmol CO2 for 30 min (the formula of cumulative.ts and budget.ts). */
const TO_G = '1800 * 12.011e-6';
/** Directions: the axis is always 0 to 360 (VARIABLE_AXIS in common.ts). */
const FULL_CIRCLE: Range = [0, 360];

type Ranges = Partial<Record<Variable, Range>>;

/**
 * Run `SELECT min(x) AS v__lo, max(x) AS v__hi ...` and give the ranges.
 * `lo(v)` and `hi(v)` are the aggregate expressions; `from` is the FROM part.
 */
async function minMax(conn: DuckDBConnection, vars: readonly Variable[], from: string, lo: (v: Variable) => string, hi: (v: Variable) => string): Promise<Ranges> {
  const cols = vars.map((x) => `(${lo(x)})::DOUBLE AS ${x}__lo, (${hi(x)})::DOUBLE AS ${x}__hi`).join(', ');
  const row = await one(conn, `SELECT ${cols} FROM ${from}`);
  const out: Ranges = {};
  for (const x of vars) {
    const a = row[`${x}__lo`];
    const b = row[`${x}__hi`];
    if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) out[x] = [a, b];
  }
  return out;
}

const withZero = (r: Ranges): Ranges =>
  Object.fromEntries(Object.entries(r).map(([k, [a, b]]) => [k, [Math.min(a, 0), Math.max(b, 0)]]));

/** Set wd to 0 to 360 when it has data. */
const circle = (r: Ranges): Ranges => {
  for (const x of CIRCULAR_VARS) if (r[x]) r[x] = FULL_CIRCLE;
  return r;
};

/** Range of the value of one step (stepExpr) over groups of rows. */
async function stepRange(conn: DuckDBConnection, groupBy: string[]): Promise<Ranges> {
  const from = groupBy
    .map((g) => `SELECT ${VARIABLES.map((x) => `${stepExpr(x)} AS ${x}`).join(', ')} FROM obs GROUP BY ${g}`)
    .join(' UNION ALL ');
  return circle(await minMax(conn, VARIABLES, `(${from})`, (x) => `min(${x})`, (x) => `max(${x})`));
}

export async function computeAxisRanges(dataDir = DATA_DIR): Promise<AxisRanges> {
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  try {
    const file = (name: string) => `'${dataDir}/${name}.parquet'`;
    // The same table as db.ts getDB().
    await conn.run(`CREATE TABLE obs AS
      SELECT o.* REPLACE (coalesce(o.nee_f, f.nee_f_calc::DOUBLE) AS nee_f),
             f.gpp::DOUBLE AS gpp, f.reco::DOUBLE AS reco,
             o.ts_start + to_minutes(s.utc_offset_min::INT) AS tl
      FROM ${file('observations')} o JOIN ${file('sites')} s USING (site_id)
      LEFT JOIN ${file('fluxes')} f USING (site_id, ts_start)`);

    const step: Record<string, Ranges> = {};
    step.raw = circle(await minMax(conn, VARIABLES, 'obs', (x) => `min(${x})`, (x) => `max(${x})`));
    step.day = await stepRange(conn, [`site_id, date_trunc('day', tl)`]);
    // Weeks: full ISO weeks (timeseries) and the parts that a month limit cuts (the period starts and
    // ends at a month; the years diagram splits a week at 1 January). The parts can have other means.
    step.week = await stepRange(conn, [`site_id, date_trunc('week', tl)`, `site_id, date_trunc('week', tl), date_trunc('month', tl)`]);
    step.month = await stepRange(conn, [`site_id, date_trunc('month', tl)`]);

    // Diurnal: the shape of diurnal.ts (mean and 25 to 75 % band per half hour), per site and year.
    // A period of one or more full years is then inside the range.
    const diurnalFrom = `(SELECT ${VARIABLES.map(
      (x) => `${meanExpr(x)} AS ${x}, quantile_cont(${x}, 0.25) AS ${x}__q1, quantile_cont(${x}, 0.75) AS ${x}__q3`,
    ).join(', ')} FROM obs GROUP BY site_id, year(tl), hour(tl) * 2 + minute(tl) // 30)`;
    const diurnal = circle(
      await minMax(conn, VARIABLES, diurnalFrom, (x) => `min(least(${x}, ${x}__q1))`, (x) => `max(greatest(${x}, ${x}__q3))`),
    );

    // Cumulative: running sum of the daily sums per site and calendar year (cumulative.ts query).
    const cumFrom = `(SELECT ${SUM_FLUXES.map((x) => `sum(${x}) OVER (PARTITION BY site_id, yr ORDER BY day) AS ${x}`).join(', ')}
      FROM (SELECT site_id, year(tl) AS yr, date_trunc('day', tl) AS day,
              ${SUM_FLUXES.map((x) => `sum(${x}) * ${TO_G} AS ${x}`).join(', ')}
            FROM obs GROUP BY 1, 2, 3))`;
    const cumulative = withZero(await minMax(conn, SUM_FLUXES, cumFrom, (x) => `min(${x})`, (x) => `max(${x})`));

    // Budget: annual sum per site and year (budget.ts query), GPP negative.
    const budgetFrom = `(SELECT ${SUM_FLUXES.map((x) => `${NEGATED.has(x) ? '-' : ''}sum(${x}) * ${TO_G} AS ${x}`).join(', ')}
      FROM obs GROUP BY site_id, year(tl))`;
    const budget = withZero(await minMax(conn, SUM_FLUXES, budgetFrom, (x) => `min(${x})`, (x) => `max(${x})`));

    const fingerprint = await minMax(conn, VARIABLES, 'obs', (x) => `quantile_cont(${x}, ${Q_LO})`, (x) => `quantile_cont(${x}, ${Q_HI})`);

    const out = {
      version: 1 as const,
      created: new Date().toISOString(),
      step: Object.fromEntries(AGGREGATIONS.map((a) => [a, step[a] ?? {}])),
      diurnal,
      monthly: withZero(step.month),
      cumulative,
      budget,
      fingerprint,
    };
    return v.parse(AxisRangesSchema, out);
  } finally {
    conn.closeSync();
    db.closeSync();
  }
}

/** Compute the ranges and write OUT_FILE. */
export async function writeAxisRanges(dataDir = DATA_DIR, outFile = OUT_FILE): Promise<void> {
  const ranges = await computeAxisRanges(dataDir);
  await mkdir(outFile.slice(0, outFile.lastIndexOf('/')), { recursive: true });
  // One line per variable: "nee": [-49.47982, 25.569131].
  const text = JSON.stringify(ranges, (_k, x: unknown) => (typeof x === 'number' ? Number(x.toPrecision(10)) : x), 1)
    .replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, '[$1, $2]');
  await writeFile(outFile, `${text}\n`);
  const n = Object.keys(ranges.step.raw).length;
  console.log(`Wrote ${outFile} (${n} variables with data)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await writeAxisRanges();
