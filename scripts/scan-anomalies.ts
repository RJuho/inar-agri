// Scan the harmonised database for anomalies.
//
// Run: node scripts/scan-anomalies.ts [--sites a,b] [--checks A,B] [--top 20] [--out data/anomaly-scan]
// Input: db/observations.parquet and db/sites.parquet (npm run build:db).
// Output: data/anomaly-scan/ (not in git): summary.md, flags.csv, flags-<site>.md,
//         stats-monthly.csv, annual.csv, fill-values.md, time-axis.md, checks.json.
//
// Each check is one or a few SQL statements over the table obs (all columns of
// observations.parquet plus the site code and the local time) or over the long
// table lv (one row per site, variable, period and value). Window functions find
// runs, steps and gaps. The script makes no loop over data rows in JS.
// All thresholds are in CHECKS. Valibot checks CHECKS and the CLI options.

import { mkdir, writeFile } from 'node:fs/promises';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import * as v from 'valibot';
import { fail, fmt, lit, log, num, one, rows, str, table } from './lib/duck.ts';

const OBS_FILE = 'db/observations.parquet';
const SITES_FILE = 'db/sites.parquet';

const SITE_CODES = ['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki', 'maktau'] as const;
const FI_SITES = ['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki'];
/** Coordinates for the sites without coordinates in sites.parquet. */
const DEFAULT_LAT = 60.2;
const DEFAULT_LON = 25.0;

const VARS = [
  'nee', 'nee_f', 'ta', 'tsoil', 'swc', 'sw_in', 'ppfd', 'rh', 'vpd', 'ustar', 'gpp_src', 'reco_src',
  'ch4', 'precip', 'pa', 'ws', 'wd', 'netrad', 'sw_out', 'le', 'g', 'n2o',
] as const;
type Var = (typeof VARS)[number];
const CHECK_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'P', 'Q'] as const;
type CheckId = (typeof CHECK_IDS)[number];

const CHECK_NAMES: Record<CheckId, string> = {
  A: 'range', B: 'stuck value', C: 'step', D: 'level shift', E: 'fill values and constants', F: 'cross-variable',
  G: 'time axis', H: 'longest gap', I: 'copied column', J: 'repeated day', K: 'flat fill', L: 'annual sums',
  M: 'radiometer snow or dirt', N: 'drift', P: 'coverage pattern', Q: 'correlation drop',
};

// ---------- thresholds ----------

const pair = v.tuple([v.number(), v.number()]);
/** A bound is one pair, or a pair per site group (FI, MK), site code or 'default'. */
const BoundSchema = v.union([pair, v.record(v.string(), pair)]);
const varList = v.array(v.picklist(VARS));
const numByVar = v.record(v.picklist(VARS), v.number());

const ChecksSchema = v.object({
  A: v.object({ bounds: v.pipe(v.record(v.picklist(VARS), BoundSchema), v.check((r) => VARS.every((k) => k in r), 'A needs a bound for all variables')) }),
  B: v.object({ minRun: v.number(), minRunShort: v.number(), shortVars: varList, skip: varList, zeroOk: varList }),
  C: v.object({ step: numByVar, swcTsoilMin: v.number(), swcDryPeriods: v.number() }),
  D: v.object({
    minCoverage: v.number(), minValues: v.number(), minOtherYears: v.number(), kScale: v.number(),
    resolution: numByVar, minDiffAbs: numByVar, minDiffRel: numByVar, skip: varList,
    dayRad: v.object({ sw_in: v.number(), ppfd: v.number() }),
    ratioNumerators: varList, ratioTolerance: v.number(), ratioMinDays: v.number(), ratioMinPairs: v.number(),
  }),
  E: v.object({
    topValues: v.number(), maxShare: v.number(), minDistinctPerYear: v.number(), minValuesForDistinct: v.number(),
    zeroVars: varList, negativeVars: varList, radMin: v.number(),
  }),
  F: v.object({
    f1: v.object({ swInMin: v.number(), taMin: v.number(), minCount: v.number() }),
    f2: v.object({ lo: v.number(), hi: v.number(), minDays: v.number() }),
    f3: v.object({ rhMax: v.number(), minCount: v.number() }),
    f4: v.object({ maxDiff: v.number(), minCount: v.number() }),
    f5: v.object({ maxDiff: v.number(), minCount: v.number() }),
    f6: v.object({ maxDiff: v.number(), maxShare: v.number() }),
    f7: v.object({ neeFMax: v.number(), gppMin: v.number(), maxShare: v.number(), minNight: v.number() }),
    f8: v.object({ hours: pair, swInMin: v.number(), lo: v.number(), hi: v.number(), minCount: v.number() }),
    f9: v.object({ minCorr: v.number(), minCoverage: v.number(), months: pair }),
  }),
  G: v.object({ minPeak: v.record(v.string(), v.number()), riseRad: v.number(), maxHourDiff: v.number(), minValuesPerDay: v.number(), minDays: v.number() }),
  H: v.object({}),
  I: v.object({ maxShare: v.number(), minPairs: v.number() }),
  J: v.object({ tolerance: v.number(), vars: varList }),
  K: v.object({ maxSd: v.number(), months: pair, minFilled: v.number() }),
  L: v.object({ hhToGc: v.number(), hhToGn: v.number() }),
  M: v.object({ ratio: v.number(), minDays: v.number(), darkMax: v.number(), darkRunDays: v.number(), minValuesPerDay: v.number() }),
  N: v.object({ nightHours: pair, radAbs: v.number(), netradMax: v.number(), minValues: v.number(), rhMax: v.number(), precipMin: v.number() }),
  P: v.object({ dayHours: pair, nightHours: pair, ratio: v.number(), minDayShare: v.number() }),
  Q: v.object({ pairs: v.array(v.tuple([v.picklist(VARS), v.picklist(VARS)])), minPairs: v.number(), drop: v.number(), minOtherYears: v.number() }),
});
type Checks = v.InferOutput<typeof ChecksSchema>;

const CHECKS_INPUT = {
  A: {
    bounds: {
      nee: [-50, 50], nee_f: [-50, 50], gpp_src: [-1, 60], reco_src: [-5, 40],
      ta: { FI: [-40, 35], MK: [5, 45] }, tsoil: { FI: [-15, 35], MK: [10, 50] },
      swc: { default: [0.02, 0.8], sarkisuo: [0.02, 0.95] },
      sw_in: { FI: [-10, 1000], MK: [-10, 1300] }, ppfd: [-10, 2300], sw_out: [-10, 600], netrad: [-200, 850],
      rh: [5, 103], vpd: { FI: [0, 45], MK: [0, 60] }, pa: { FI: [93, 106], MK: [86, 92] },
      ws: [0, 25], ustar: [0, 2], wd: [0, 360], precip: [0, 30], le: [-100, 700], g: [-150, 250],
      ch4: [-0.5, 1], n2o: [-20, 150],
    },
  },
  B: { minRun: 48, minRunShort: 12, shortVars: ['ta', 'rh', 'ws', 'nee'], skip: ['precip', 'wd'], zeroOk: ['sw_in', 'ppfd', 'sw_out', 'netrad', 'g', 'le'] },
  C: { step: { ta: 6, tsoil: 2, swc: 0.05, rh: 30, vpd: 10, pa: 0.5, ws: 10, le: 300, g: 50 }, swcTsoilMin: 1, swcDryPeriods: 6 },
  D: {
    minCoverage: 0.6, minValues: 100, minOtherYears: 3, kScale: 5,
    resolution: {
      ta: 0.1, tsoil: 0.1, swc: 0.005, rh: 1, pa: 0.1, ws: 0.1, sw_in: 5, ppfd: 5, sw_out: 5, netrad: 5,
      nee: 0.5, nee_f: 0.5, gpp_src: 0.5, reco_src: 0.5, le: 5, g: 5, vpd: 0.5, ustar: 0.01, ch4: 0.001, n2o: 0.1,
    },
    minDiffAbs: { ta: 2, tsoil: 2, swc: 0.05, rh: 10, pa: 1, ws: 1 },
    minDiffRel: { sw_in: 0.3, ppfd: 0.3, sw_out: 0.3, netrad: 0.3, nee: 0.3, nee_f: 0.3, gpp_src: 0.3, reco_src: 0.3, ch4: 0.3, n2o: 0.3 },
    skip: ['precip', 'wd'],
    dayRad: { sw_in: 20, ppfd: 40 },
    ratioNumerators: ['ppfd', 'netrad', 'sw_out'], ratioTolerance: 0.3, ratioMinDays: 10, ratioMinPairs: 10,
  },
  E: {
    topValues: 3, maxShare: 0.05, minDistinctPerYear: 200, minValuesForDistinct: 1000,
    zeroVars: ['ta', 'rh', 'pa', 'swc', 'tsoil', 'ws'], negativeVars: ['swc', 'rh', 'precip', 'ustar', 'sw_out', 'ws'], radMin: -10,
  },
  F: {
    f1: { swInMin: 50, taMin: 2, minCount: 10 },
    f2: { lo: 1.6, hi: 2.4, minDays: 5 },
    f3: { rhMax: 103, minCount: 1 },
    f4: { maxDiff: 1, minCount: 10 },
    f5: { maxDiff: 0.01, minCount: 1 },
    f6: { maxDiff: 0.5, maxShare: 0.01 },
    f7: { neeFMax: -1, gppMin: 0.5, maxShare: 0.1, minNight: 50 },
    f8: { hours: [11, 14], swInMin: 200, lo: 0.45, hi: 0.85, minCount: 20 },
    f9: { minCorr: 0.5, minCoverage: 0.6, months: [5, 9] },
  },
  G: { minPeak: { default: 200, maktau: 400 }, riseRad: 10, maxHourDiff: 0.75, minValuesPerDay: 40, minDays: 10 },
  H: {},
  I: { maxShare: 0.01, minPairs: 100 },
  J: { tolerance: 0.001, vars: ['nee_f', 'le'] },
  K: { maxSd: 0.2, months: [5, 9], minFilled: 40 },
  L: { hhToGc: 1800 * 12.011e-6, hhToGn: 1800 * 28.013e-9 },
  M: { ratio: 0.2, minDays: 3, darkMax: 30, darkRunDays: 5, minValuesPerDay: 40 },
  N: { nightHours: [0, 2], radAbs: 5, netradMax: 0, minValues: 20, rhMax: 95, precipMin: 20 },
  P: { dayHours: [9, 15], nightHours: [0, 3], ratio: 0.5, minDayShare: 0.3 },
  Q: { pairs: [['sw_in', 'ppfd'], ['ta', 'tsoil'], ['sw_in', 'netrad'], ['nee_f', 'ppfd']], minPairs: 1000, drop: 0.2, minOtherYears: 2 },
} satisfies v.InferInput<typeof ChecksSchema>;

const CHECKS: Checks = v.parse(ChecksSchema, CHECKS_INPUT);

/** Bounds of check A for one site and variable. */
function boundsFor(variable: Var, site: string): [number, number] {
  const b = CHECKS.A.bounds[variable]!;
  if (Array.isArray(b)) return b;
  const group = FI_SITES.includes(site) ? 'FI' : 'MK';
  const p = b[site] ?? b[group] ?? b['default'];
  if (!p) fail(`check A: no bound for ${variable} at ${site}`);
  return p;
}

/** One line per check for Table 4 of the summary. */
function thresholdText(id: CheckId): string {
  const c = CHECKS;
  const bounds = VARS.map((k) => {
    const b = c.A.bounds[k]!;
    return Array.isArray(b) ? `${k} ${b[0]}..${b[1]}` : `${k} ${Object.entries(b).map(([g, p]) => `${g} ${p[0]}..${p[1]}`).join(' / ')}`;
  }).join('; ');
  switch (id) {
    case 'A': return `Value outside the bounds. Episode = consecutive periods outside. Score = distance to the bound / width of the bounds. Bounds: ${bounds}.`;
    case 'B': return `Run of the same value (exact equality) in consecutive periods with length >= ${c.B.minRun} periods, or >= ${c.B.minRunShort} for ${c.B.shortVars.join(', ')}. A NULL period ends the run. Not for ${c.B.skip.join(', ')}. A run of 0 in ${c.B.zeroOk.join(', ')} is not a flag. Score = length / threshold.`;
    case 'C': return `One period that differs from both neighbours in the same direction by more than: ${Object.entries(c.C.step).map(([k, x]) => `${k} ${x}`).join(', ')}. swc only when tsoil > ${c.C.swcTsoilMin} and the precipitation of the ${c.C.swcDryPeriods} periods before is 0 or NULL. Score = smaller jump / threshold.`;
    case 'D': return `Monthly median (day: sw_in > ${c.D.dayRad.sw_in} or ppfd > ${c.D.dayRad.ppfd}; night) against the median of the other years of the same calendar month (coverage >= ${c.D.minCoverage * 100} %, >= ${c.D.minOtherYears} other years). Scale = MAD with a floor of 2 x resolution (${Object.entries(c.D.resolution).map(([k, x]) => `${k} ${x}`).join(', ')}). Flag when |median - reference| > ${c.D.kScale} x scale and > the minimum difference (${Object.entries(c.D.minDiffAbs).map(([k, x]) => `${k} ${x}`).join(', ')}; ${Object.entries(c.D.minDiffRel).map(([k, x]) => `${k} ${x * 100} % of |reference|`).join(', ')}). Score = |median - reference| / (${c.D.kScale} x scale). Ratios ${c.D.ratioNumerators.map((n) => `${n}/sw_in`).join(', ')} (monthly median of the daily ratio of the daily day-time sums) against the median of the other sites in the same month: flag when the ratio differs more than ${c.D.ratioTolerance * 100} %.`;
    case 'E': return `Frequent value (one of the ${c.E.topValues} most frequent non-zero values) with a share > ${c.E.maxShare * 100} % (score = share / ${c.E.maxShare}); fewer than ${c.E.minDistinctPerYear} distinct values in a year with >= ${c.E.minValuesForDistinct} values (score = ${c.E.minDistinctPerYear} / distinct); exact 0 in ${c.E.zeroVars.join(', ')}; negative value in ${c.E.negativeVars.join(', ')}; sw_in or ppfd < ${c.E.radMin} (score = count).`;
    case 'F': return `F1 sw_out > sw_in with sw_in > ${c.F.f1.swInMin} and ta > ${c.F.f1.taMin}, >= ${c.F.f1.minCount} periods in a month. F2 daily ppfd / sw_in outside ${c.F.f2.lo}..${c.F.f2.hi} on >= ${c.F.f2.minDays} days in a month. F3 rh > ${c.F.f3.rhMax}, >= ${c.F.f3.minCount} periods. F4 |vpd - vpd_magnus| > ${c.F.f4.maxDiff} hPa, >= ${c.F.f4.minCount} periods. F5 |nee - nee_f| > ${c.F.f5.maxDiff}, >= ${c.F.f5.minCount} periods. F6 |nee_f - (reco_src - gpp_src)| > ${c.F.f6.maxDiff} in > ${c.F.f6.maxShare * 100} % of the periods of a year. F7 night share of nee_f < ${c.F.f7.neeFMax} or gpp_src > ${c.F.f7.gppMin} above ${c.F.f7.maxShare * 100} % in a month. F8 midday (${c.F.f8.hours[0]} to ${c.F.f8.hours[1]} h) monthly median of netrad / sw_in (sw_in > ${c.F.f8.swInMin}) outside ${c.F.f8.lo}..${c.F.f8.hi}. F9 monthly corr(tsoil, ta) < ${c.F.f9.minCorr}, and day-time corr(le, netrad) < ${c.F.f9.minCorr} in months ${c.F.f9.months[0]} to ${c.F.f9.months[1]}, both with coverage > ${c.F.f9.minCoverage * 100} %. Score = count or share / threshold, or distance / band width.`;
    case 'G': return `Monthly median of the local hour of the daily radiation peak (days with max > ${c.G.minPeak['default']} W m-2, Maktau > ${c.G.minPeak['maktau']}; ppfd / 2 where sw_in is missing) against 12 + UTC offset - lon / 15; and against the site median of all months (clock jump); monthly median of the first hour with radiation > ${c.G.riseRad} W m-2 against the astronomical sunrise. Flag |difference| >= ${c.G.maxHourDiff} h. Score = |difference| / ${c.G.maxHourDiff}.`;
    case 'H': return 'Longest run of NULL per site, variable and year (Table 3). No flags.';
    case 'I': return `Pair of columns with equal non-zero values in > ${c.I.maxShare * 100} % of the rows where both have a value (>= ${c.I.minPairs} such rows) in a year. Score = share / ${c.I.maxShare}.`;
    case 'J': return `Day whose 48 values of ${c.J.vars.join(' or ')} equal the day before within ${c.J.tolerance} (both days complete). Consecutive days form one episode. Score = number of days.`;
    case 'K': return `Day in months ${c.K.months[0]} to ${c.K.months[1]} with nee NULL in all 48 periods and SD(nee_f) < ${c.K.maxSd} (>= ${c.K.minFilled} nee_f values). Consecutive days form one episode. Score = number of days.`;
    case 'L': return 'Annual sums (annual.csv). No flags.';
    case 'M': return `Months with mean ta < 0: >= ${c.M.minDays} days with max(sw_in) < ${c.M.ratio} x max(ppfd) / 2 (score = days / ${c.M.minDays}). Runs of >= ${c.M.darkRunDays} days with max(sw_in) < ${c.M.darkMax} W m-2 (days with >= ${c.M.minValuesPerDay} values; score = days / ${c.M.darkRunDays}).`;
    case 'N': return `Night (local hour ${c.N.nightHours[0]} to ${c.N.nightHours[1]}) monthly median of sw_in or ppfd outside -${c.N.radAbs}..${c.N.radAbs} and of netrad > ${c.N.netradMax} (>= ${c.N.minValues} values; score = |median| / ${c.N.radAbs}); monthly max(rh) < ${c.N.rhMax} in a month with precipitation > ${c.N.precipMin} mm (score = (100 - max) / 5).`;
    case 'P': return `Share of valid values at local hours ${c.P.dayHours[0]} to ${c.P.dayHours[1]} (day) and ${c.P.nightHours[0]} to ${c.P.nightHours[1]} (night) per month. Flag when night share < ${c.P.ratio} x day share and day share > ${c.P.minDayShare}. Score = ${c.P.ratio} x day share / night share.`;
    case 'Q': return `Annual correlation of ${c.Q.pairs.map((p) => p.join('-')).join(', ')} (> ${c.Q.minPairs} pairs) more than ${c.Q.drop} below the median of the other years (>= ${c.Q.minOtherYears}). Score = drop / ${c.Q.drop}.`;
  }
}

// ---------- CLI ----------

const OptionsSchema = v.object({
  sites: v.nullable(v.pipe(v.array(v.picklist(SITE_CODES)), v.minLength(1))),
  checks: v.pipe(v.array(v.picklist(CHECK_IDS)), v.minLength(1)),
  top: v.pipe(v.number(), v.integer(), v.minValue(1)),
  out: v.pipe(v.string(), v.nonEmpty()),
});
type Options = v.InferOutput<typeof OptionsSchema>;

function parseArgs(argv: string[]): Options {
  const o: Record<string, unknown> = { sites: null, checks: [...CHECK_IDS], top: 20, out: 'data/anomaly-scan' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const x = argv[++i];
      if (x === undefined) fail(`option ${a} needs a value`);
      return x;
    };
    if (a === '--sites') o.sites = next().split(',').map((s) => s.trim().toLowerCase());
    else if (a === '--checks') o.checks = next().split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--top') o.top = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--help' || a === '-h') {
      process.stdout.write('node scripts/scan-anomalies.ts [--sites a,b] [--checks A,B,...] [--top 20] [--out data/anomaly-scan]\n');
      process.exit(0);
    } else fail(`unknown option ${a}`);
  }
  const r = v.safeParse(OptionsSchema, o);
  if (!r.success) fail(`bad options: ${r.issues.map((x) => x.message).join('; ')}`);
  return r.output;
}

// ---------- SQL helpers ----------

const VJOIN = `FROM ${lit(OBS_FILE)} o JOIN ${lit(SITES_FILE)} s USING (site_id)`;
const VTL = `o.ts_start + to_minutes(s.utc_offset_min::BIGINT)`;
/** Local hour with the minutes as a fraction, in a verify query. */
const VHR = `(hour(${VTL}) + minute(${VTL}) / 60.0)`;
const STEP = 'INTERVAL 30 MINUTE';
const sqlList = (xs: readonly string[]): string => xs.map(lit).join(', ');

/** Day condition (TRUE, FALSE or NULL without radiation). `p` is the column prefix, for example 'o.'. */
const daySql = (p = ''): string => `coalesce(${p}sw_in > ${CHECKS.D.dayRad.sw_in}, ${p}ppfd > ${CHECKS.D.dayRad.ppfd})`;
/** Night condition for check F7: radiation <= 5, or the local hour without radiation. */
const nightSql = (p: string, hr: string): string =>
  `CASE WHEN ${p}sw_in IS NOT NULL OR ${p}ppfd IS NOT NULL THEN coalesce(${p}sw_in, ${p}ppfd) <= 5 ELSE ${hr} < 3 OR ${hr} > 22 END`;
/** Vapour pressure deficit in hPa from the Magnus formula. */
const magnusSql = (p = ''): string => `6.1078 * exp(17.27 * ${p}ta / (${p}ta + 237.3)) * (1 - ${p}rh / 100)`;

/**
 * SQL expression that gives a one-line SQL text (the verify query).
 * Text parts become string literals. `{name}` becomes the SQL expression holes[name], cast to VARCHAR.
 */
function sqlTextExpr(template: string, holes: Record<string, string>): string {
  const text = template.replace(/\s+/g, ' ');
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    const before = text.slice(last, m.index);
    if (before) parts.push(lit(before));
    const expr = holes[m[1]!];
    if (expr === undefined) fail(`verify template: no hole ${m[1]}`);
    parts.push(`coalesce((${expr})::VARCHAR, 'NULL')`);
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  if (tail) parts.push(lit(tail));
  return parts.join(' || ');
}

/** Verify query that lists the rows of the episode. Holes site, ts_from, ts_to come from the flag row. */
function verifyRows(cols: string, where = '', extra: Record<string, string> = {}): string {
  return sqlTextExpr(
    `SELECT s.code, o.ts_start, ${VTL} AS tl, ${cols} ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}' AND '{to}'${where} ORDER BY o.ts_start`,
    { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR', ...extra },
  );
}

/** Verify query with an aggregate over the rows of the episode. */
function verifyAgg(aggs: string, where = '', extra: Record<string, string> = {}): string {
  return sqlTextExpr(
    `SELECT s.code, ${aggs} ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}' AND '{to}'${where} GROUP BY s.code`,
    { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR', ...extra },
  );
}

const FLAG_COLS = '(chk, site, variable, ts_from, ts_to, n_periods, value, expected, score, detail, verify_sql)';

type Ctx = { conn: DuckDBConnection; sql: Record<string, string[]>; opts: Options; sites: SiteInfo[] };
type SiteInfo = { site: string; name: string; utcOffsetMin: number; lat: number; lon: number };

async function run(ctx: Ctx, id: string, sql: string): Promise<void> {
  (ctx.sql[id] ??= []).push(sql.trim());
  await ctx.conn.run(sql);
}

/** INSERT the result of a SELECT into flags, for one check. */
const insertFlags = (ctx: Ctx, id: CheckId, select: string) => run(ctx, id, `INSERT INTO flags ${FLAG_COLS} ${select}`);

// ---------- base tables ----------

async function buildBase(ctx: Ctx): Promise<void> {
  const { conn, opts } = ctx;
  const siteFilter = opts.sites ? `WHERE code IN (${sqlList(opts.sites)})` : '';
  await run(ctx, 'base', `
    CREATE TABLE sites AS
    SELECT site_id, code AS site, name, utc_offset_min, coalesce(lat, ${DEFAULT_LAT}) AS lat, coalesce(lon, ${DEFAULT_LON}) AS lon
    FROM ${lit(SITES_FILE)} ${siteFilter} ORDER BY site_id`);
  const sites = await rows(conn, 'SELECT * FROM sites');
  ctx.sites = sites.map((s) => ({ site: str(s.site), name: str(s.name), utcOffsetMin: num(s.utc_offset_min), lat: num(s.lat), lon: num(s.lon) }));
  if (ctx.sites.length === 0) fail('no sites selected');

  // obs: all columns, site code, local time tl and its parts, day / night labels.
  await run(ctx, 'base', `
    CREATE TABLE obs AS
    SELECT o.*, s.site, s.utc_offset_min, s.lat, s.lon,
      o.ts_start + to_minutes(s.utc_offset_min::BIGINT) AS tl,
      year(tl) AS y, month(tl) AS m, date_trunc('day', tl) AS d, hour(tl) + minute(tl) / 60.0 AS hr,
      CASE ${daySql()} WHEN TRUE THEN 'day' WHEN FALSE THEN 'night' END AS part,
      ${nightSql('', 'hr')} AS night
    FROM ${lit(OBS_FILE)} o JOIN sites s USING (site_id)`);
  await run(ctx, 'base', `CREATE TABLE srange AS SELECT site, min(tl) AS t0, max(tl) + ${STEP} AS t1 FROM obs GROUP BY site`);
  await run(ctx, 'base', `CREATE TABLE norad AS SELECT site FROM obs GROUP BY site HAVING count(sw_in) + count(ppfd) = 0`);

  // lv: long table, one row per value. Site x variable pairs with fewer than 100 values are dropped.
  await run(ctx, 'base', `
    CREATE TABLE lv_all AS
    SELECT site, variable, ts_start, tl, y, m, d, hr, part, night, value
    FROM obs UNPIVOT (value FOR variable IN (${VARS.join(', ')}))`);
  await run(ctx, 'base', `CREATE TABLE sv AS SELECT site, variable, count(*) AS n FROM lv_all GROUP BY ALL HAVING count(*) >= 100`);
  await run(ctx, 'base', `CREATE TABLE lv AS SELECT l.* FROM lv_all l SEMI JOIN sv USING (site, variable)`);
  await run(ctx, 'base', `DROP TABLE lv_all`);

  // months: expected periods per site and month (clipped to the data range of the site).
  await run(ctx, 'base', `
    CREATE TABLE months AS
    SELECT o.site, o.y, o.m, count(*) AS n_rows,
      count(*) FILTER (WHERE part = 'day') AS n_day, count(*) FILTER (WHERE part = 'night') AS n_night,
      min(ts_start) AS ts_from, max(ts_start) AS ts_to,
      datediff('minute', greatest(make_timestamp(o.y, o.m, 1, 0, 0, 0), r.t0),
               least(make_timestamp(o.y, o.m, 1, 0, 0, 0) + INTERVAL 1 MONTH, r.t1)) // 30 AS n_exp
    FROM obs o JOIN srange r USING (site) GROUP BY o.site, o.y, o.m, r.t0, r.t1`);
  await run(ctx, 'base', `
    CREATE TABLE years AS
    SELECT site, y, min(ts_start) AS ts_from, max(ts_start) AS ts_to, count(*) AS n_rows,
      48 * datediff('day', make_date(y, 1, 1), make_date(y + 1, 1, 1)) AS n_exp
    FROM obs GROUP BY ALL`);

  // stats: monthly statistics per part (day, night) and for all periods.
  await run(ctx, 'base', `
    CREATE TABLE stats AS
    SELECT l.site, l.variable, l.y, l.m, l.part, count(*) AS n,
      count(*) / (CASE l.part WHEN 'day' THEN mo.n_day ELSE mo.n_night END)::DOUBLE AS cov,
      median(value) AS med, quantile_cont(value, 0.02) AS p2, quantile_cont(value, 0.98) AS p98, min(value) AS mn, max(value) AS mx,
      min(ts_start) AS ts_from, max(ts_start) AS ts_to
    FROM lv l JOIN months mo USING (site, y, m) WHERE l.part IS NOT NULL
    GROUP BY l.site, l.variable, l.y, l.m, l.part, mo.n_day, mo.n_night
    UNION ALL
    SELECT l.site, l.variable, l.y, l.m, 'all', count(*), count(*) / mo.n_exp::DOUBLE,
      median(value), quantile_cont(value, 0.02), quantile_cont(value, 0.98), min(value), max(value), min(ts_start), max(ts_start)
    FROM lv l JOIN months mo USING (site, y, m)
    GROUP BY l.site, l.variable, l.y, l.m, mo.n_exp`);

  await run(ctx, 'base', `
    CREATE TABLE flags (chk VARCHAR, site VARCHAR, variable VARCHAR, ts_from TIMESTAMP, ts_to TIMESTAMP,
      n_periods BIGINT, value DOUBLE, expected DOUBLE, score DOUBLE, detail VARCHAR, verify_sql VARCHAR)`);
}

// ---------- checks ----------

async function checkA(ctx: Ctx): Promise<void> {
  const values = ctx.sites.flatMap((s) => VARS.map((k) => {
    const [lo, hi] = boundsFor(k, s.site);
    return `(${lit(s.site)}, ${lit(k)}, ${lo}, ${hi})`;
  }));
  await run(ctx, 'A', `CREATE TABLE a_bounds (site VARCHAR, variable VARCHAR, lo DOUBLE, hi DOUBLE)`);
  await run(ctx, 'A', `INSERT INTO a_bounds VALUES ${values.join(', ')}`);
  await run(ctx, 'A', `
    CREATE TABLE a_counts AS
    SELECT l.site, l.variable, l.y, count(*) AS n_out, min(value) AS mn, max(value) AS mx
    FROM lv l JOIN a_bounds b USING (site, variable) WHERE value < lo OR value > hi GROUP BY ALL ORDER BY ALL`);
  await insertFlags(ctx, 'A', `
    WITH o AS (
      SELECT l.site, l.variable, l.ts_start, l.tl, l.value, b.lo, b.hi,
        if(value < lo, lo - value, value - hi) AS dist, if(value < lo, lo, hi) AS bound
      FROM lv l JOIN a_bounds b USING (site, variable) WHERE value < lo OR value > hi),
    g1 AS (SELECT *, if(tl - lag(tl) OVER (PARTITION BY site, variable ORDER BY tl) = ${STEP}, 0, 1) AS brk FROM o),
    g2 AS (SELECT *, sum(brk) OVER (PARTITION BY site, variable ORDER BY tl) AS grp FROM g1),
    e AS (
      SELECT site, variable, min(ts_start) AS ts_from, max(ts_start) AS ts_to, count(*) AS n_periods,
        arg_max(value, dist) AS value, arg_max(bound, dist) AS expected, max(dist) AS dist,
        any_value(lo) AS lo, any_value(hi) AS hi, arg_max(tl, dist) AS tl_ext
      FROM g2 GROUP BY site, variable, grp)
    SELECT 'A', site, variable, ts_from, ts_to, n_periods, value, expected, dist / (hi - lo),
      format('outside [{}, {}] by {} at {} local', lo, hi, round(dist, 4), tl_ext),
      ${verifyRows('o.{var}', ' AND (o.{var} < {lo} OR o.{var} > {hi})', { var: 'variable', lo: 'lo', hi: 'hi' })}
    FROM e`);
}

async function checkB(ctx: Ctx): Promise<void> {
  const c = CHECKS.B;
  await insertFlags(ctx, 'B', `
    WITH o AS (
      SELECT site, variable, ts_start, tl, value,
        CASE WHEN value = lag(value) OVER w AND tl - lag(tl) OVER w = ${STEP} THEN 0 ELSE 1 END AS brk
      FROM lv WHERE variable NOT IN (${sqlList(c.skip)})
      WINDOW w AS (PARTITION BY site, variable ORDER BY tl)),
    g AS (SELECT *, sum(brk) OVER (PARTITION BY site, variable ORDER BY tl) AS grp FROM o),
    r AS (SELECT site, variable, min(ts_start) AS ts_from, max(ts_start) AS ts_to, count(*) AS n, any_value(value) AS value FROM g GROUP BY site, variable, grp),
    t AS (SELECT r.*, if(variable IN (${sqlList(c.shortVars)}), ${c.minRunShort}, ${c.minRun}) AS thr FROM r)
    SELECT 'B', site, variable, ts_from, ts_to, n, value, NULL, n / thr,
      format('{} equal periods of {} (threshold {})', n, value, thr),
      ${verifyRows('o.{var}', '', { var: 'variable' })}
    FROM t WHERE n >= thr AND NOT (value = 0 AND variable IN (${sqlList(c.zeroOk)}))`);
}

async function checkC(ctx: Ctx): Promise<void> {
  const c = CHECKS.C;
  for (const [k, thr] of Object.entries(c.step)) {
    const swc = k === 'swc';
    const extraCols = swc ? `, tsoil, sum(precip) OVER (PARTITION BY site ORDER BY tl ROWS BETWEEN ${c.swcDryPeriods} PRECEDING AND 1 PRECEDING) AS p_before` : '';
    const extraWhere = swc ? ` AND tsoil > ${c.swcTsoilMin} AND coalesce(p_before, 0) = 0` : '';
    await insertFlags(ctx, 'C', `
      WITH o AS (
        SELECT site, ts_start, tl, ${k} AS val, lag(${k}) OVER w AS prev, lead(${k}) OVER w AS next,
          lag(tl) OVER w AS ptl, lead(tl) OVER w AS ntl${extraCols}
        FROM obs WHERE site IN (SELECT site FROM sv WHERE variable = ${lit(k)})
        WINDOW w AS (PARTITION BY site ORDER BY tl))
      SELECT 'C', site, ${lit(k)}, ts_start, ts_start, 1, val, (prev + next) / 2,
        least(abs(val - prev), abs(val - next)) / ${thr},
        format('before {} value {} after {} (threshold {})', prev, val, next, ${thr}),
        ${verifyRows(`o.${k}`, '', { from: `(ts_start - ${STEP})::VARCHAR`, to: `(ts_start + ${STEP})::VARCHAR` })}
      FROM o
      WHERE tl - ptl = ${STEP} AND ntl - tl = ${STEP}
        AND ((val - prev > ${thr} AND val - next > ${thr}) OR (prev - val > ${thr} AND next - val > ${thr}))${extraWhere}`);
  }
}

async function checkD(ctx: Ctx): Promise<void> {
  const c = CHECKS.D;
  const res = VARS.filter((k) => c.resolution[k] !== undefined).map((k) =>
    `(${lit(k)}, ${c.resolution[k]}, ${lit(c.minDiffAbs[k] ?? null)}, ${lit(c.minDiffRel[k] ?? null)})`);
  await run(ctx, 'D', `CREATE TABLE d_res (variable VARCHAR, res DOUBLE, min_abs DOUBLE, min_rel DOUBLE)`);
  await run(ctx, 'D', `INSERT INTO d_res VALUES ${res.join(', ')}`);
  await insertFlags(ctx, 'D', `
    WITH s AS (
      SELECT * FROM stats
      WHERE cov >= ${c.minCoverage} AND n >= ${c.minValues} AND variable NOT IN (${sqlList(c.skip)})
        AND (part IN ('day', 'night') OR (part = 'all' AND site IN (SELECT site FROM norad)))),
    j AS (
      SELECT a.site, a.variable, a.y, a.m, a.part, a.med, a.n, a.ts_from, a.ts_to,
        median(b.med) AS ref, mad(b.med) AS madv, count(*) AS n_other
      FROM s a JOIN s b ON a.site = b.site AND a.variable = b.variable AND a.m = b.m AND a.part = b.part AND a.y <> b.y
      GROUP BY ALL HAVING count(*) >= ${c.minOtherYears}),
    t AS (
      SELECT j.*, greatest(madv, 2 * r.res) AS scale, abs(med - ref) AS diff,
        CASE WHEN r.min_abs IS NOT NULL THEN r.min_abs WHEN r.min_rel IS NOT NULL THEN r.min_rel * abs(ref) ELSE 0 END AS mindiff
      FROM j JOIN d_res r USING (variable))
    SELECT 'D', site, variable, ts_from, ts_to, n, med, ref, diff / (${c.kScale} * scale),
      format('{} median of {}-{} is {}; other years {} (MAD {}, {} years); part {}', part, y, lpad(m::VARCHAR, 2, '0'), round(med, 4), round(ref, 4), round(madv, 4), n_other, part),
      ${verifyAgg(`median(o.{var}) FILTER (WHERE {daycond}) AS med`, '', { var: 'variable', daycond: `CASE part WHEN 'day' THEN ${lit(daySql('o.'))} WHEN 'night' THEN ${lit(`NOT ${daySql('o.')}`)} ELSE 'TRUE' END` })}
    FROM t WHERE diff > ${c.kScale} * scale AND diff > mindiff`);

  // Cross-site ratios of the daily day-time sums. The relative difference uses |ref|,
  // because the netrad ratio is negative in some winter months. A ref of 0 gives no flag.
  for (const numv of c.ratioNumerators) {
    await insertFlags(ctx, 'D', `
      WITH dd AS (
        SELECT site, y, m, d, sum(${numv}) FILTER (WHERE sw_in IS NOT NULL) AS num_sum, sum(sw_in) FILTER (WHERE ${numv} IS NOT NULL) AS den_sum,
          count(*) FILTER (WHERE ${numv} IS NOT NULL AND sw_in IS NOT NULL) AS n
        FROM obs WHERE part = 'day' GROUP BY ALL HAVING n >= ${c.ratioMinPairs} AND den_sum > 0),
      mm AS (SELECT site, y, m, median(num_sum / den_sum) AS ratio, count(*) AS nd FROM dd GROUP BY ALL HAVING count(*) >= ${c.ratioMinDays}),
      cmp AS (
        SELECT a.site, a.y, a.m, a.ratio, a.nd, median(b.ratio) AS ref, count(*) AS n_other
        FROM mm a JOIN mm b ON a.y = b.y AND a.m = b.m AND a.site <> b.site GROUP BY ALL),
      rel AS (SELECT *, abs(ratio - ref) / nullif(abs(ref), 0) AS rel FROM cmp)
      SELECT 'D', c.site, ${lit(`${numv}/sw_in`)}, mo.ts_from, mo.ts_to, c.nd, c.ratio, c.ref, c.rel / ${c.ratioTolerance},
        format('monthly median of the daily ratio {}; other sites {} ({} sites)', round(c.ratio, 4), round(c.ref, 4), n_other),
        ${sqlTextExpr(`SELECT code, median(num_sum / den_sum) AS ratio FROM (SELECT s.code, date_trunc('day', ${VTL}) AS d, sum(o.${numv}) FILTER (WHERE o.sw_in IS NOT NULL) AS num_sum, sum(o.sw_in) FILTER (WHERE o.${numv} IS NOT NULL) AS den_sum, count(*) FILTER (WHERE o.${numv} IS NOT NULL AND o.sw_in IS NOT NULL) AS n ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}' AND '{to}' AND ${daySql('o.')} GROUP BY s.code, d HAVING n >= ${c.ratioMinPairs} AND den_sum > 0) x GROUP BY code`, { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR' })}
      FROM rel c JOIN months mo USING (site, y, m) WHERE c.rel > ${c.ratioTolerance}`);
  }
}

async function checkE(ctx: Ctx): Promise<void> {
  const c = CHECKS.E;
  await run(ctx, 'E', `
    CREATE TABLE e_freq AS
    WITH f AS (
      SELECT site, variable, value, count(*) AS c FROM lv WHERE value <> 0 GROUP BY site, variable, value
      QUALIFY row_number() OVER (PARTITION BY site, variable ORDER BY c DESC, value) <= ${c.topValues})
    SELECT f.site, f.variable, f.value, f.c, f.c / sv.n AS share, min(l.ts_start) AS ts_from, max(l.ts_start) AS ts_to
    FROM f JOIN sv USING (site, variable) JOIN lv l ON l.site = f.site AND l.variable = f.variable AND l.value = f.value
    GROUP BY ALL ORDER BY site, variable, c DESC`);
  await run(ctx, 'E', `
    CREATE TABLE e_distinct AS
    SELECT site, variable, y, count(DISTINCT value) AS n_distinct, count(*) AS n, min(ts_start) AS ts_from, max(ts_start) AS ts_to
    FROM lv GROUP BY ALL ORDER BY ALL`);
  await run(ctx, 'E', `
    CREATE TABLE e_special AS
    SELECT site, variable, 'exact 0' AS kind, '= 0' AS cond, count(*) AS n, min(value) AS mn, min(ts_start) AS ts_from, max(ts_start) AS ts_to
    FROM lv WHERE variable IN (${sqlList(c.zeroVars)}) AND value = 0 GROUP BY ALL
    UNION ALL
    SELECT site, variable, 'negative', '< 0', count(*), min(value), min(ts_start), max(ts_start)
    FROM lv WHERE variable IN (${sqlList(c.negativeVars)}) AND value < 0 GROUP BY ALL
    UNION ALL
    SELECT site, variable, 'below ${c.radMin}', '< ${c.radMin}', count(*), min(value), min(ts_start), max(ts_start)
    FROM lv WHERE variable IN ('sw_in', 'ppfd') AND value < ${c.radMin} GROUP BY ALL
    ORDER BY ALL`);
  await insertFlags(ctx, 'E', `
    SELECT 'E', site, variable, ts_from, ts_to, c, value, NULL, share / ${c.maxShare},
      format('value {} in {} periods ({} % of the values)', value, c, round(100 * share, 2)),
      ${verifyAgg('count(*) AS n', ' AND o.{var} = {val}', { var: 'variable', val: 'value' })}
    FROM e_freq WHERE share > ${c.maxShare}`);
  await insertFlags(ctx, 'E', `
    SELECT 'E', site, variable, ts_from, ts_to, n, n_distinct, ${c.minDistinctPerYear}, ${c.minDistinctPerYear} / n_distinct,
      format('{} distinct values in {} ({} values)', n_distinct, y, n),
      ${verifyAgg('count(DISTINCT o.{var}) AS n_distinct', '', { var: 'variable' })}
    FROM e_distinct WHERE n >= ${c.minValuesForDistinct} AND n_distinct < ${c.minDistinctPerYear}`);
  await insertFlags(ctx, 'E', `
    SELECT 'E', site, variable, ts_from, ts_to, n, mn, NULL, n,
      format('{} periods with {} value (minimum {})', n, kind, mn),
      ${verifyRows('o.{var}', ' AND o.{var} {cond}', { var: 'variable', cond: 'cond' })}
    FROM e_special WHERE n > 0`);
}

async function checkF(ctx: Ctx): Promise<void> {
  const c = CHECKS.F;
  const month = (sel: string, from: string, where: string, having: string) =>
    `WITH x AS (SELECT site, y, m, ${sel} FROM ${from} ${where} GROUP BY site, y, m HAVING ${having}) SELECT x.*, mo.ts_from, mo.ts_to FROM x JOIN months mo USING (site, y, m)`;
  // F1 reflected more than incoming.
  await insertFlags(ctx, 'F', `
    WITH t AS (${month('count(*) AS n, max(sw_out - sw_in) AS mx', 'obs', `WHERE sw_out > sw_in AND sw_in > ${c.f1.swInMin} AND ta > ${c.f1.taMin}`, `count(*) >= ${c.f1.minCount}`)})
    SELECT 'F', site, 'sw_out', ts_from, ts_to, n, mx, NULL, n / ${c.f1.minCount},
      format('F1: {} periods with sw_out > sw_in (sw_in > ${c.f1.swInMin}, ta > ${c.f1.taMin}), max excess {} W m-2', n, round(mx, 1)),
      ${verifyRows('o.sw_in, o.sw_out, o.ta', ` AND o.sw_out > o.sw_in AND o.sw_in > ${c.f1.swInMin} AND o.ta > ${c.f1.taMin}`)}
    FROM t`);
  // F2 daily ppfd / sw_in.
  await insertFlags(ctx, 'F', `
    WITH dd AS (
      SELECT site, y, m, d, sum(ppfd) FILTER (WHERE sw_in IS NOT NULL) / sum(sw_in) FILTER (WHERE ppfd IS NOT NULL) AS ratio
      FROM obs GROUP BY ALL HAVING sum(sw_in) FILTER (WHERE ppfd IS NOT NULL) > 0 AND sum(ppfd) FILTER (WHERE sw_in IS NOT NULL) > 0),
    t AS (${month('count(*) AS n_days, count(*) FILTER (WHERE ratio < ' + c.f2.lo + ' OR ratio > ' + c.f2.hi + ') AS n_bad, median(ratio) AS med', 'dd', '', `count(*) FILTER (WHERE ratio < ${c.f2.lo} OR ratio > ${c.f2.hi}) >= ${c.f2.minDays}`)})
    SELECT 'F', site, 'ppfd/sw_in', ts_from, ts_to, n_bad, med, NULL, n_bad / ${c.f2.minDays},
      format('F2: {} of {} days with daily ppfd / sw_in outside ${c.f2.lo}..${c.f2.hi}; monthly median {}', n_bad, n_days, round(med, 3)),
      ${verifyAgg(`date_trunc('day', ${VTL}) AS d, sum(o.ppfd) FILTER (WHERE o.sw_in IS NOT NULL) / sum(o.sw_in) FILTER (WHERE o.ppfd IS NOT NULL) AS ratio`).replace('GROUP BY s.code', 'GROUP BY s.code, d ORDER BY d')}
    FROM t`);
  // F3 rh above the limit.
  await insertFlags(ctx, 'F', `
    WITH t AS (${month('count(*) AS n, max(rh) AS mx', 'obs', `WHERE rh > ${c.f3.rhMax}`, `count(*) >= ${c.f3.minCount}`)})
    SELECT 'F', site, 'rh', ts_from, ts_to, n, mx, ${c.f3.rhMax}, n / ${c.f3.minCount},
      format('F3: {} periods with rh > ${c.f3.rhMax}, max {}', n, mx),
      ${verifyRows('o.rh', ` AND o.rh > ${c.f3.rhMax}`)}
    FROM t`);
  // F4 vpd against Magnus.
  const magnus = magnusSql();
  await insertFlags(ctx, 'F', `
    WITH t AS (${month(`count(*) AS n, median(vpd - (${magnus})) AS med_diff, max(abs(vpd - (${magnus}))) AS mx`, 'obs', `WHERE abs(vpd - (${magnus})) > ${c.f4.maxDiff}`, `count(*) >= ${c.f4.minCount}`)})
    SELECT 'F', site, 'vpd', ts_from, ts_to, n, mx, ${c.f4.maxDiff}, n / ${c.f4.minCount},
      format('F4: {} periods with |vpd - Magnus| > ${c.f4.maxDiff} hPa; median difference {} hPa, max {}', n, round(med_diff, 2), round(mx, 2)),
      ${verifyRows(`o.vpd, ${magnusSql('o.')} AS vpd_magnus`, ` AND abs(o.vpd - (${magnusSql('o.')})) > ${c.f4.maxDiff}`)}
    FROM t`);
  // F5 measured and gap-filled NEE differ.
  await insertFlags(ctx, 'F', `
    WITH t AS (${month('count(*) AS n, max(abs(nee - nee_f)) AS mx', 'obs', `WHERE nee IS NOT NULL AND abs(nee - nee_f) > ${c.f5.maxDiff}`, `count(*) >= ${c.f5.minCount}`)})
    SELECT 'F', site, 'nee', ts_from, ts_to, n, mx, ${c.f5.maxDiff}, n / ${c.f5.minCount},
      format('F5: {} periods with |nee - nee_f| > ${c.f5.maxDiff} where nee is measured; max {}', n, round(mx, 3)),
      ${verifyRows('o.nee, o.nee_f, o.nee_qc', ` AND o.nee IS NOT NULL AND abs(o.nee - o.nee_f) > ${c.f5.maxDiff}`)}
    FROM t`);
  // F6 NEE against Reco - GPP, per year.
  await insertFlags(ctx, 'F', `
    WITH t AS (
      SELECT site, y, count(*) AS n, count(*) FILTER (WHERE abs(nee_f - (reco_src - gpp_src)) > ${c.f6.maxDiff}) AS n_bad,
        max(abs(nee_f - (reco_src - gpp_src))) AS mx
      FROM obs WHERE nee_f IS NOT NULL AND reco_src IS NOT NULL AND gpp_src IS NOT NULL GROUP BY ALL)
    SELECT 'F', site, 'nee_f', yr.ts_from, yr.ts_to, n_bad, mx, ${c.f6.maxDiff}, (n_bad / n) / ${c.f6.maxShare},
      format('F6: {} % of {} periods in {} with |nee_f - (reco_src - gpp_src)| > ${c.f6.maxDiff}; max {}', round(100 * n_bad / n, 2), n, y, round(mx, 3)),
      ${verifyAgg(`count(*) FILTER (WHERE abs(o.nee_f - (o.reco_src - o.gpp_src)) > ${c.f6.maxDiff}) / count(*) AS share`, ' AND o.nee_f IS NOT NULL AND o.reco_src IS NOT NULL AND o.gpp_src IS NOT NULL')}
    FROM t JOIN years yr USING (site, y) WHERE n_bad / n > ${c.f6.maxShare}`);
  // F7 night uptake.
  for (const [k, cond, thr] of [['nee_f', `nee_f < ${c.f7.neeFMax}`, c.f7.neeFMax], ['gpp_src', `gpp_src > ${c.f7.gppMin}`, c.f7.gppMin]] as const) {
    await insertFlags(ctx, 'F', `
      WITH t AS (${month(`count(*) AS n, count(*) FILTER (WHERE ${cond}) AS n_bad`, 'obs', `WHERE night AND ${k} IS NOT NULL`, `count(*) >= ${c.f7.minNight} AND count(*) FILTER (WHERE ${cond}) / count(*) > ${c.f7.maxShare}`)})
      SELECT 'F', site, ${lit(k)}, ts_from, ts_to, n_bad, n_bad / n, ${c.f7.maxShare}, (n_bad / n) / ${c.f7.maxShare},
        format('F7: {} % of {} night periods with ${cond} (threshold ${thr})', round(100 * n_bad / n, 1), n),
        ${verifyRows(`o.${k}, o.sw_in, o.ppfd`, ` AND o.${cond} AND ${nightSql('o.', VHR)}`)}
      FROM t`);
  }
  // F8 midday netrad / sw_in.
  await insertFlags(ctx, 'F', `
    WITH t AS (${month('count(*) AS n, median(netrad / sw_in) AS med', 'obs', `WHERE hr >= ${c.f8.hours[0]} AND hr < ${c.f8.hours[1]} AND sw_in > ${c.f8.swInMin} AND netrad IS NOT NULL`, `count(*) >= ${c.f8.minCount} AND (median(netrad / sw_in) < ${c.f8.lo} OR median(netrad / sw_in) > ${c.f8.hi})`)})
    SELECT 'F', site, 'netrad/sw_in', ts_from, ts_to, n, med, if(med < ${c.f8.lo}, ${c.f8.lo}, ${c.f8.hi}),
      if(med < ${c.f8.lo}, ${c.f8.lo} - med, med - ${c.f8.hi}) / ${c.f8.hi - c.f8.lo},
      format('F8: midday median netrad / sw_in = {} ({} periods), expected ${c.f8.lo}..${c.f8.hi}', round(med, 3), n),
      ${verifyAgg('median(o.netrad / o.sw_in) AS ratio', ` AND hour(${VTL}) >= ${c.f8.hours[0]} AND hour(${VTL}) < ${c.f8.hours[1]} AND o.sw_in > ${c.f8.swInMin}`)}
    FROM t`);
  // F9 correlations.
  await insertFlags(ctx, 'F', `
    WITH t AS (
      SELECT o.site, o.y, o.m, corr(tsoil, ta) AS r, count(*) FILTER (WHERE tsoil IS NOT NULL AND ta IS NOT NULL) AS n, mo.n_rows, mo.ts_from, mo.ts_to,
        count(tsoil) / mo.n_rows AS cov1, count(ta) / mo.n_rows AS cov2
      FROM obs o JOIN months mo USING (site, y, m) GROUP BY o.site, o.y, o.m, mo.n_rows, mo.ts_from, mo.ts_to)
    SELECT 'F', site, 'tsoil~ta', ts_from, ts_to, n, r, ${c.f9.minCorr}, (${c.f9.minCorr} - r) / ${c.f9.minCorr},
      format('F9: monthly corr(tsoil, ta) = {} ({} pairs)', round(r, 3), n),
      ${verifyAgg('corr(o.tsoil, o.ta) AS r')}
    FROM t WHERE cov1 > ${c.f9.minCoverage} AND cov2 > ${c.f9.minCoverage} AND r < ${c.f9.minCorr}`);
  await insertFlags(ctx, 'F', `
    WITH t AS (
      SELECT o.site, o.y, o.m, corr(le, netrad) FILTER (WHERE part = 'day') AS r, count(*) FILTER (WHERE part = 'day' AND le IS NOT NULL AND netrad IS NOT NULL) AS n,
        mo.ts_from, mo.ts_to, count(le) / mo.n_rows AS cov1, count(netrad) / mo.n_rows AS cov2
      FROM obs o JOIN months mo USING (site, y, m) WHERE o.m BETWEEN ${c.f9.months[0]} AND ${c.f9.months[1]}
      GROUP BY o.site, o.y, o.m, mo.n_rows, mo.ts_from, mo.ts_to)
    SELECT 'F', site, 'le~netrad', ts_from, ts_to, n, r, ${c.f9.minCorr}, (${c.f9.minCorr} - r) / ${c.f9.minCorr},
      format('F9: day-time corr(le, netrad) = {} ({} pairs)', round(r, 3), n),
      ${verifyAgg('corr(o.le, o.netrad) AS r', ` AND ${daySql('o.')}`)}
    FROM t WHERE cov1 > ${c.f9.minCoverage} AND cov2 > ${c.f9.minCoverage} AND r < ${c.f9.minCorr}`);
}

async function checkG(ctx: Ctx): Promise<void> {
  const c = CHECKS.G;
  const peakCase = `CASE site ${Object.entries(c.minPeak).filter(([k]) => k !== 'default').map(([k, x]) => `WHEN ${lit(k)} THEN ${x}`).join(' ')} ELSE ${c.minPeak['default']} END`;
  await run(ctx, 'G', `
    CREATE TABLE g_days AS
    SELECT site, y, m, d, arg_max(hr, rad) AS peak_hr, max(rad) AS rad_max, min(hr) FILTER (WHERE rad > ${c.riseRad}) AS rise_hr, count(*) AS n,
      bool_or(sw_in IS NOT NULL) AS has_sw
    FROM (SELECT *, coalesce(sw_in, ppfd / 2.0) AS rad FROM obs) WHERE rad IS NOT NULL
    GROUP BY ALL HAVING count(*) >= ${c.minValuesPerDay}`);
  await run(ctx, 'G', `
    CREATE TABLE g_months AS
    WITH mm AS (
      SELECT g.site, g.y, g.m, count(*) AS n_days, median(peak_hr) AS peak_hr, median(rise_hr) AS rise_hr,
        if(bool_or(has_sw), 'sw_in', 'ppfd') AS variable
      FROM g_days g WHERE rad_max > ${peakCase} GROUP BY ALL HAVING count(*) >= ${c.minDays}),
    e AS (
      SELECT mm.*, 12 + s.utc_offset_min / 60.0 - s.lon / 15.0 AS expected_peak,
        radians(23.44) * sin(2 * pi() * (dayofyear(make_date(mm.y, mm.m, 15)) - 81) / 365.0) AS decl,
        degrees(acos(greatest(-1.0, least(1.0, -tan(radians(s.lat)) * tan(decl))))) AS omega,
        12 - omega / 15.0 + s.utc_offset_min / 60.0 - s.lon / 15.0 AS expected_rise,
        median(peak_hr) OVER (PARTITION BY mm.site) AS site_peak
      FROM mm JOIN sites s USING (site))
    SELECT e.*, mo.ts_from, mo.ts_to FROM e JOIN months mo USING (site, y, m) ORDER BY site, y, m`);
  const verifyPeak = sqlTextExpr(
    `SELECT code, median(peak_hr) AS peak_hr FROM (SELECT s.code, date_trunc('day', ${VTL}) AS d, arg_max(${VHR}, coalesce(o.sw_in, o.ppfd / 2.0)) AS peak_hr, max(coalesce(o.sw_in, o.ppfd / 2.0)) AS rad_max ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}' AND '{to}' GROUP BY s.code, d) x WHERE rad_max > {thr} GROUP BY code`,
    { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR', thr: peakCase },
  );
  await insertFlags(ctx, 'G', `
    SELECT 'G', site, variable, ts_from, ts_to, n_days, peak_hr, expected_peak, abs(peak_hr - expected_peak) / ${c.maxHourDiff},
      format('peak hour {} in {}-{}, expected {} from the longitude ({} days)', peak_hr, y, lpad(m::VARCHAR, 2, '0'), round(expected_peak, 2), n_days), ${verifyPeak}
    FROM g_months WHERE abs(peak_hr - expected_peak) >= ${c.maxHourDiff}`);
  await insertFlags(ctx, 'G', `
    SELECT 'G', site, variable, ts_from, ts_to, n_days, peak_hr, site_peak, abs(peak_hr - site_peak) / ${c.maxHourDiff},
      format('clock jump: peak hour {} in {}-{}, site median {} ({} days)', peak_hr, y, lpad(m::VARCHAR, 2, '0'), site_peak, n_days), ${verifyPeak}
    FROM g_months WHERE abs(peak_hr - site_peak) >= ${c.maxHourDiff}`);
  await insertFlags(ctx, 'G', `
    SELECT 'G', site, variable, ts_from, ts_to, n_days, rise_hr, expected_rise, abs(rise_hr - expected_rise) / ${c.maxHourDiff},
      format('sunrise: first hour with radiation > ${c.riseRad} is {} in {}-{}, astronomical sunrise {} ({} days)', rise_hr, y, lpad(m::VARCHAR, 2, '0'), round(expected_rise, 2), n_days),
      ${sqlTextExpr(`SELECT code, median(rise_hr) AS rise_hr FROM (SELECT s.code, date_trunc('day', ${VTL}) AS d, min(${VHR}) FILTER (WHERE coalesce(o.sw_in, o.ppfd / 2.0) > ${c.riseRad}) AS rise_hr ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}' AND '{to}' GROUP BY s.code, d) x GROUP BY code`, { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR' })}
    FROM g_months WHERE rise_hr IS NOT NULL AND abs(rise_hr - expected_rise) >= ${c.maxHourDiff}`);
}

async function checkH(ctx: Ctx): Promise<void> {
  await run(ctx, 'H', `
    CREATE TABLE gaps AS
    WITH yrs AS (
      SELECT sv.site, sv.variable, yy.y,
        greatest(make_timestamp(yy.y, 1, 1, 0, 0, 0), r.t0) AS y0, least(make_timestamp(yy.y + 1, 1, 1, 0, 0, 0), r.t1) AS y1
      FROM sv JOIN (SELECT DISTINCT site, y FROM obs) yy USING (site) JOIN srange r USING (site)),
    pts AS (
      SELECT site, variable, y, tl FROM lv
      UNION ALL SELECT site, variable, y, y0 - ${STEP} FROM yrs
      UNION ALL SELECT site, variable, y, y1 FROM yrs),
    g AS (SELECT site, variable, y, tl, lag(tl) OVER (PARTITION BY site, variable, y ORDER BY tl) AS prev FROM pts)
    SELECT site, variable, y, max(datediff('minute', prev, tl)) // 30 - 1 AS n_gap,
      arg_max(prev, datediff('minute', prev, tl)) + ${STEP} AS gap_from
    FROM g WHERE prev IS NOT NULL GROUP BY ALL ORDER BY ALL`);
}

async function checkI(ctx: Ctx): Promise<void> {
  const c = CHECKS.I;
  const pairs: [Var, Var][] = [];
  for (let i = 0; i < VARS.length; i++) for (let j = i + 1; j < VARS.length; j++) pairs.push([VARS[i]!, VARS[j]!]);
  const aggs = pairs.flatMap(([a, b]) => [
    `count(*) FILTER (WHERE ${a} = ${b} AND ${a} <> 0) AS "eq_${a}_${b}"`,
    `count(*) FILTER (WHERE ${a} IS NOT NULL AND ${b} IS NOT NULL) AS "n_${a}_${b}"`,
  ]);
  await run(ctx, 'I', `CREATE TABLE i_wide AS SELECT site, y, ${aggs.join(', ')} FROM obs GROUP BY ALL`);
  const unions = pairs.map(([a, b]) => `SELECT site, y, ${lit(a)} AS a, ${lit(b)} AS b, "eq_${a}_${b}" AS n_eq, "n_${a}_${b}" AS n FROM i_wide`).join(' UNION ALL ');
  await run(ctx, 'I', `CREATE TABLE i_pairs AS SELECT * FROM (${unions}) WHERE n >= ${c.minPairs} AND n_eq > 0 ORDER BY site, y, a, b`);
  await insertFlags(ctx, 'I', `
    SELECT 'I', site, a || '=' || b, yr.ts_from, yr.ts_to, n_eq, n_eq / n, ${c.maxShare}, (n_eq / n) / ${c.maxShare},
      format('{} % of {} paired rows in {} have equal non-zero values{}', round(100 * n_eq / n, 2), n, y, if(a = 'nee' AND b = 'nee_f', ' (expected: the gap-filled series copies the measured value)', '')),
      ${verifyAgg('count(*) FILTER (WHERE o.{a} = o.{b} AND o.{a} <> 0) / count(*) FILTER (WHERE o.{a} IS NOT NULL AND o.{b} IS NOT NULL) AS share', '', { a: 'a', b: 'b' })}
    FROM i_pairs JOIN years yr USING (site, y) WHERE n_eq / n > ${c.maxShare}`);
}

/** Merge consecutive days into episodes. `days` has site, d, ts_from, ts_to, detail columns x. */
const dayRuns = (daysCte: string, extra: string) => `
  g1 AS (SELECT *, if(d - lag(d) OVER (PARTITION BY site ORDER BY d) = INTERVAL 1 DAY, 0, 1) AS brk FROM ${daysCte}),
  g2 AS (SELECT *, sum(brk) OVER (PARTITION BY site ORDER BY d) AS grp FROM g1),
  e AS (SELECT site, min(ts_from) AS ts_from, max(ts_to) AS ts_to, count(*) AS n_days, min(d) AS d0, max(d) AS d1${extra} FROM g2 GROUP BY site, grp)`;

async function checkJ(ctx: Ctx): Promise<void> {
  const c = CHECKS.J;
  for (const k of c.vars) {
    await insertFlags(ctx, 'J', `
      WITH days AS (
        SELECT a.site, a.d, min(a.ts_start) AS ts_from, max(a.ts_start) AS ts_to, max(abs(a.${k} - b.${k})) AS mx, avg(a.${k}) AS mean_v
        FROM obs a JOIN obs b ON a.site_id = b.site_id AND b.tl = a.tl - INTERVAL 1 DAY
        WHERE a.${k} IS NOT NULL AND b.${k} IS NOT NULL
        GROUP BY ALL HAVING count(*) = 48 AND bool_and(abs(a.${k} - b.${k}) <= ${c.tolerance})),
      ${dayRuns('days', ', max(mx) AS mx, avg(mean_v) AS mean_v')}
      SELECT 'J', site, ${lit(k)}, ts_from, ts_to, n_days * 48, mean_v, NULL, n_days,
        format('{} day(s) {} to {} repeat the day before within ${c.tolerance}; daily mean {}', n_days, d0::DATE, d1::DATE, round(mean_v, 3)),
        ${sqlTextExpr(`SELECT * FROM (SELECT s.code, o.ts_start, o.${k}, lag(o.${k}, 48) OVER (ORDER BY o.ts_start) AS day_before ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}'::TIMESTAMP - INTERVAL 1 DAY AND '{to}') x WHERE ts_start >= '{from}' ORDER BY ts_start`, { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR' })}
      FROM e`);
  }
}

async function checkK(ctx: Ctx): Promise<void> {
  const c = CHECKS.K;
  await run(ctx, 'K', `
    CREATE TABLE k_days AS
    SELECT site, y, m, d, min(ts_start) AS ts_from, max(ts_start) AS ts_to, stddev_samp(nee_f) AS sd, avg(nee_f) AS mean_v
    FROM obs WHERE m BETWEEN ${c.months[0]} AND ${c.months[1]}
    GROUP BY ALL HAVING count(*) = 48 AND count(nee) = 0 AND count(nee_f) >= ${c.minFilled} AND stddev_samp(nee_f) < ${c.maxSd}`);
  await insertFlags(ctx, 'K', `
    WITH ${dayRuns('k_days', ', max(sd) AS sd, avg(mean_v) AS mean_v').replace(/^\s+/, '')}
    SELECT 'K', site, 'nee_f', ts_from, ts_to, n_days * 48, mean_v, NULL, n_days,
      format('{} day(s) {} to {} without measured nee and SD(nee_f) < ${c.maxSd} (max SD {}, mean {})', n_days, d0::DATE, d1::DATE, round(sd, 3), round(mean_v, 3)),
      ${verifyAgg('count(o.nee) AS n_nee, stddev_samp(o.nee_f) AS sd_nee_f')}
    FROM e`);
}

async function checkL(ctx: Ctx): Promise<void> {
  const c = CHECKS.L;
  await run(ctx, 'L', `
    CREATE TABLE annual AS
    SELECT o.site, o.y AS year,
      sum(nee_f) * ${c.hhToGc} AS nee_f_gc_m2, count(nee_f) / yr.n_exp AS nee_f_share,
      sum(precip) AS precip_mm, count(precip) / yr.n_exp AS precip_share,
      sum(ch4) * ${c.hhToGc} AS ch4_gc_m2, count(ch4) / yr.n_exp AS ch4_share,
      sum(n2o) * ${c.hhToGn} AS n2o_gn_m2, count(n2o) / yr.n_exp AS n2o_share
    FROM obs o JOIN years yr USING (site, y) GROUP BY o.site, o.y, yr.n_exp ORDER BY 1, 2`);
}

async function checkM(ctx: Ctx): Promise<void> {
  const c = CHECKS.M;
  await run(ctx, 'M', `
    CREATE TABLE m_days AS
    SELECT site, y, m, d, min(ts_start) AS ts_from, max(ts_start) AS ts_to, max(sw_in) AS max_sw, max(ppfd) AS max_ppfd, count(sw_in) AS n_sw, count(ppfd) AS n_pp
    FROM obs GROUP BY ALL`);
  await insertFlags(ctx, 'M', `
    WITH cold AS (SELECT site, y, m FROM obs GROUP BY ALL HAVING avg(ta) < 0),
    t AS (
      SELECT d.site, d.y, d.m, count(*) AS n_days, min(max_sw / (max_ppfd / 2.0)) AS min_ratio
      FROM m_days d JOIN cold USING (site, y, m)
      WHERE n_sw >= ${c.minValuesPerDay} AND n_pp >= ${c.minValuesPerDay} AND max_sw < ${c.ratio} * max_ppfd / 2.0
      GROUP BY ALL HAVING count(*) >= ${c.minDays})
    SELECT 'M', site, 'sw_in', mo.ts_from, mo.ts_to, n_days, min_ratio, ${c.ratio}, n_days / ${c.minDays},
      format('{} days in {}-{} (mean ta < 0) with max(sw_in) < ${c.ratio} x max(ppfd) / 2; smallest ratio {}', n_days, y, lpad(m::VARCHAR, 2, '0'), round(min_ratio, 3)),
      ${sqlTextExpr(`SELECT d, max(o.sw_in) AS max_sw, max(o.ppfd) / 2.0 AS max_ppfd_w FROM (SELECT date_trunc('day', ${VTL}) AS d, o.sw_in, o.ppfd ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}' AND '{to}') o GROUP BY d HAVING max(o.sw_in) < ${c.ratio} * max(o.ppfd) / 2.0 ORDER BY d`, { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR' })}
    FROM t JOIN months mo USING (site, y, m)`);
  await insertFlags(ctx, 'M', `
    WITH dark AS (SELECT site, d, ts_from, ts_to, max_sw FROM m_days WHERE n_sw >= ${c.minValuesPerDay} AND max_sw < ${c.darkMax}),
    ${dayRuns('dark', ', max(max_sw) AS max_sw').replace(/^\s+/, '')}
    SELECT 'M', site, 'sw_in', ts_from, ts_to, n_days * 48, max_sw, ${c.darkMax}, n_days / ${c.darkRunDays},
      format('{} days {} to {} with max(sw_in) < ${c.darkMax} W m-2 (largest daily max {})', n_days, d0::DATE, d1::DATE, round(max_sw, 1)),
      ${sqlTextExpr(`SELECT date_trunc('day', ${VTL}) AS d, max(o.sw_in) AS max_sw, count(o.sw_in) AS n ${VJOIN} WHERE s.code = '{site}' AND o.ts_start BETWEEN '{from}' AND '{to}' GROUP BY d ORDER BY d`, { site: 'site', from: 'ts_from::VARCHAR', to: 'ts_to::VARCHAR' })}
    FROM e WHERE n_days >= ${c.darkRunDays}`);
}

async function checkN(ctx: Ctx): Promise<void> {
  const c = CHECKS.N;
  const hours = `hr >= ${c.nightHours[0]} AND hr < ${c.nightHours[1]}`;
  const vhours = `hour(${VTL}) >= ${c.nightHours[0]} AND hour(${VTL}) < ${c.nightHours[1]}`;
  for (const k of ['sw_in', 'ppfd', 'netrad'] as const) {
    const cond = k === 'netrad' ? `med > ${c.netradMax}` : `abs(med) > ${c.radAbs}`;
    const expected = k === 'netrad' ? c.netradMax : 0;
    await insertFlags(ctx, 'N', `
      WITH t AS (SELECT site, y, m, count(*) AS n, median(${k}) AS med FROM obs WHERE ${hours} AND ${k} IS NOT NULL GROUP BY ALL HAVING count(*) >= ${c.minValues})
      SELECT 'N', site, ${lit(k)}, mo.ts_from, mo.ts_to, n, med, ${expected}, abs(med) / ${c.radAbs},
        format('night (hour ${c.nightHours[0]} to ${c.nightHours[1]}) median of ${k} in {}-{} is {} ${k === 'ppfd' ? 'umol m-2 s-1' : 'W m-2'} ({} values)', y, lpad(m::VARCHAR, 2, '0'), round(med, 2), n),
        ${verifyAgg(`median(o.${k}) AS med`, ` AND ${vhours}`)}
      FROM t JOIN months mo USING (site, y, m) WHERE ${cond}`);
  }
  await insertFlags(ctx, 'N', `
    WITH t AS (SELECT site, y, m, max(rh) AS mx, sum(precip) AS p, count(rh) AS n FROM obs GROUP BY ALL HAVING sum(precip) > ${c.precipMin} AND max(rh) < ${c.rhMax})
    SELECT 'N', site, 'rh', mo.ts_from, mo.ts_to, n, mx, ${c.rhMax}, (100 - mx) / 5,
      format('max rh in {}-{} is {} % with {} mm precipitation', y, lpad(m::VARCHAR, 2, '0'), round(mx, 1), round(p, 1)),
      ${verifyAgg('max(o.rh) AS max_rh, sum(o.precip) AS precip_mm')}
    FROM t JOIN months mo USING (site, y, m)`);
}

async function checkP(ctx: Ctx): Promise<void> {
  const c = CHECKS.P;
  const day = `hr >= ${c.dayHours[0]} AND hr < ${c.dayHours[1]}`;
  const nightH = `hr >= ${c.nightHours[0]} AND hr < ${c.nightHours[1]}`;
  await insertFlags(ctx, 'P', `
    WITH den AS (SELECT site, y, m, count(*) FILTER (WHERE ${day}) AS nd, count(*) FILTER (WHERE ${nightH}) AS nn FROM obs GROUP BY ALL),
    numr AS (SELECT site, variable, y, m, count(*) FILTER (WHERE ${day}) AS vd, count(*) FILTER (WHERE ${nightH}) AS vn FROM lv GROUP BY ALL),
    t AS (SELECT numr.*, vd / nd AS day_share, vn / nn AS night_share FROM numr JOIN den USING (site, y, m) WHERE nd > 0 AND nn > 0)
    SELECT 'P', site, variable, mo.ts_from, mo.ts_to, vd + vn, night_share, ${c.ratio} * day_share, ${c.ratio} * day_share / greatest(night_share, 0.001),
      format('{}-{}: share of valid values {} by day (hours ${c.dayHours[0]} to ${c.dayHours[1]}), {} by night (hours ${c.nightHours[0]} to ${c.nightHours[1]})', y, lpad(m::VARCHAR, 2, '0'), round(day_share, 3), round(night_share, 3)),
      ${verifyAgg(`count(o.{var}) FILTER (WHERE hour(${VTL}) >= ${c.dayHours[0]} AND hour(${VTL}) < ${c.dayHours[1]}) / count(*) FILTER (WHERE hour(${VTL}) >= ${c.dayHours[0]} AND hour(${VTL}) < ${c.dayHours[1]}) AS day_share, count(o.{var}) FILTER (WHERE hour(${VTL}) >= ${c.nightHours[0]} AND hour(${VTL}) < ${c.nightHours[1]}) / count(*) FILTER (WHERE hour(${VTL}) >= ${c.nightHours[0]} AND hour(${VTL}) < ${c.nightHours[1]}) AS night_share`, '', { var: 'variable' })}
    FROM t JOIN months mo USING (site, y, m) WHERE day_share > ${c.minDayShare} AND night_share < ${c.ratio} * day_share`);
}

async function checkQ(ctx: Ctx): Promise<void> {
  const c = CHECKS.Q;
  const unions = c.pairs.map(([a, b]) =>
    `SELECT site, y, ${lit(`${a}-${b}`)} AS pair, ${lit(a)} AS a, ${lit(b)} AS b, corr(${a}, ${b}) AS r, count(*) FILTER (WHERE ${a} IS NOT NULL AND ${b} IS NOT NULL) AS n FROM obs GROUP BY ALL`).join(' UNION ALL ');
  await insertFlags(ctx, 'Q', `
    WITH cc AS (SELECT * FROM (${unions}) WHERE n > ${c.minPairs} AND NOT isnan(r)),
    cmp AS (
      SELECT x.site, x.y, x.pair, x.a, x.b, x.r, x.n, median(o.r) AS ref, count(*) AS n_other
      FROM cc x JOIN cc o ON x.site = o.site AND x.pair = o.pair AND x.y <> o.y GROUP BY ALL HAVING count(*) >= ${c.minOtherYears})
    SELECT 'Q', site, pair, yr.ts_from, yr.ts_to, n, r, ref, (ref - r) / ${c.drop},
      format('corr({}) = {} in {} ({} pairs); median of the other {} years {}', pair, round(r, 3), y, n, n_other, round(ref, 3)),
      ${verifyAgg('corr(o.{a}, o.{b}) AS r', '', { a: 'a', b: 'b' })}
    FROM cmp JOIN years yr USING (site, y) WHERE ref - r > ${c.drop}`);
}

const CHECK_FNS: Record<CheckId, (ctx: Ctx) => Promise<void>> = {
  A: checkA, B: checkB, C: checkC, D: checkD, E: checkE, F: checkF, G: checkG, H: checkH,
  I: checkI, J: checkJ, K: checkK, L: checkL, M: checkM, N: checkN, P: checkP, Q: checkQ,
};

// ---------- output ----------

const csvTs = (col: string) => `strftime(${col}, '%Y-%m-%dT%H:%M:%SZ') AS ${col}`;
const r4 = (x: unknown): string => (x === null || x === undefined ? '' : fmt(num(x)));

async function writeOutputs(ctx: Ctx, builtAt: string, startedAt: Date, seconds: number): Promise<string[]> {
  const { conn, opts } = ctx;
  const out = opts.out;
  const files: string[] = [];
  const has = (id: CheckId) => opts.checks.includes(id);

  // Top-N episodes per check, site and variable.
  await run(ctx, 'output', `
    CREATE TABLE flags_top AS
    SELECT * FROM flags QUALIFY row_number() OVER (PARTITION BY chk, site, variable ORDER BY score DESC NULLS LAST, ts_from) <= ${opts.top}`);
  const flagsPath = `${out}/flags.csv`;
  await run(ctx, 'output', `
    COPY (SELECT chk AS "check", site, variable, ${csvTs('ts_from')}, ${csvTs('ts_to')}, n_periods, value, expected, round(score, 4) AS score, detail, verify_sql
          FROM flags_top ORDER BY chk, site, variable, score DESC NULLS LAST, ts_from) TO ${lit(flagsPath)} (HEADER)`);
  files.push(flagsPath);

  const statsPath = `${out}/stats-monthly.csv`;
  await run(ctx, 'output', `
    COPY (SELECT site, variable, y AS year, m AS month, part, n, round(cov, 4) AS coverage, med AS median, p2, p98, mn AS min, mx AS max
          FROM stats ORDER BY site, variable, y, m, part) TO ${lit(statsPath)} (HEADER)`);
  files.push(statsPath);

  if (has('L')) {
    const p = `${out}/annual.csv`;
    await run(ctx, 'output', `COPY (SELECT * FROM annual) TO ${lit(p)} (HEADER)`);
    files.push(p);
  }

  // summary.md
  const lines: string[] = [];
  const siteCodes = ctx.sites.map((s) => s.site);
  lines.push('# Anomaly scan of the harmonised database', '');
  lines.push(`Database \`${OBS_FILE}\` built at ${builtAt}. Scan run at ${startedAt.toISOString()} in ${seconds.toFixed(1)} s.`);
  lines.push(`Options: sites ${opts.sites ? opts.sites.join(', ') : 'all'}; checks ${opts.checks.join(', ')}; top ${opts.top} per check, site and variable; out \`${opts.out}\`.`, '');
  lines.push('Files: `flags.csv` (top episodes with a verify query), `flags-<site>.md`, `stats-monthly.csv`, `annual.csv` (check L), `fill-values.md` (check E), `time-axis.md` (check G), `checks.json` (thresholds and SQL).', '');

  const countRows = await rows(conn, `SELECT site, chk, count(*) AS n FROM flags GROUP BY ALL`);
  const countMap = new Map(countRows.map((r) => [`${r.site}|${r.chk}`, num(r.n)]));
  const flagChecks = opts.checks.filter((id) => !['H', 'L'].includes(id));
  lines.push('## Table 1: episodes per site and check (all, before the top-N cap)', '');
  lines.push(table(['Site', ...flagChecks, 'Total'], siteCodes.map((s) => {
    const cells = flagChecks.map((id) => countMap.get(`${s}|${id}`) ?? 0);
    return [s, ...cells.map((x) => (x === 0 ? '' : x)), cells.reduce((a, b) => a + b, 0)];
  })), '');
  lines.push(`Checks: ${flagChecks.map((id) => `${id} = ${CHECK_NAMES[id]}`).join(', ')}.`, '');

  lines.push('## Table 2: episodes per variable and check, one table per site', '');
  const matrix = await rows(conn, `SELECT site, variable, chk, count(*) AS n FROM flags GROUP BY ALL ORDER BY site, variable, chk`);
  for (const s of ctx.sites) {
    const mine = matrix.filter((r) => r.site === s.site);
    if (mine.length === 0) continue;
    const varsHere = [...VARS.filter((k) => mine.some((r) => r.variable === k)), ...[...new Set(mine.map((r) => str(r.variable)))].filter((k) => !VARS.includes(k as Var)).sort()];
    lines.push(`### ${s.name} (${s.site})`, '');
    lines.push(table(['Variable', ...flagChecks], varsHere.map((k) => [k, ...flagChecks.map((id) => { const r = mine.find((x) => x.variable === k && x.chk === id); return r ? num(r.n) : ''; })])), '');
  }

  if (has('H')) {
    lines.push('## Table 3: longest gap per site, variable and year (check H), in days', '');
    const gapRows = await rows(conn, `SELECT site, variable, y, n_gap, gap_from FROM gaps ORDER BY site, variable, y`);
    const yearsAll = [...new Set(gapRows.map((r) => num(r.y)))].sort((a, b) => a - b);
    const body: (string | number | null)[][] = [];
    for (const s of siteCodes) for (const k of VARS) {
      const mine = gapRows.filter((r) => r.site === s && r.variable === k);
      if (mine.length === 0) continue;
      body.push([s, k, ...yearsAll.map((y) => { const r = mine.find((x) => num(x.y) === y); return r ? fmt(Math.round((num(r.n_gap) / 48) * 10) / 10) : ''; })]);
    }
    lines.push(table(['Site', 'Variable', ...yearsAll.map(String)], body), '');
    lines.push('A full year of NULL shows as 365 or 366. An empty cell = the site has no data in that year.', '');
  }

  lines.push('## Table 4: thresholds', '');
  lines.push(table(['Check', 'Name', 'Rule'], opts.checks.map((id) => [id, CHECK_NAMES[id], thresholdText(id)])), '');

  if (has('A')) {
    lines.push('## Table 5: values outside the bounds per site, variable and year (check A)', '');
    const a = await rows(conn, `SELECT * FROM a_counts ORDER BY site, variable, y`);
    lines.push(table(['Site', 'Variable', 'Year', 'n outside', 'Min', 'Max'], a.map((r) => [str(r.site), str(r.variable), num(r.y), num(r.n_out), r4(r.mn), r4(r.mx)])), '');
  }
  if (has('K')) {
    lines.push('## Table 6: flat fill days per site and year (check K)', '');
    const k = await rows(conn, `SELECT site, y, count(*) AS n FROM k_days GROUP BY ALL ORDER BY ALL`);
    lines.push(k.length ? table(['Site', 'Year', 'Days'], k.map((r) => [str(r.site), num(r.y), num(r.n)])) : 'No flat fill days.', '');
  }
  if (has('J')) {
    const j = await rows(conn, `SELECT site, variable, sum(n_periods) // 48 AS days, count(*) AS episodes FROM flags WHERE chk = 'J' GROUP BY ALL ORDER BY ALL`);
    lines.push('## Table 7: repeated days per site and variable (check J)', '');
    lines.push(j.length ? table(['Site', 'Variable', 'Days', 'Episodes'], j.map((r) => [str(r.site), str(r.variable), num(r.days), num(r.episodes)])) : 'No repeated days.', '');
  }
  const summaryPath = `${out}/summary.md`;
  await writeFile(summaryPath, lines.join('\n'));
  files.push(summaryPath);

  // flags-<site>.md
  const MAX_LINES = 250;
  for (const s of ctx.sites) {
    const fr = await rows(conn, `SELECT * FROM flags_top WHERE site = ${lit(s.site)} ORDER BY chk, score DESC NULLS LAST, ts_from`);
    const byCheck = new Map<string, Record<string, unknown>[]>();
    for (const r of fr) (byCheck.get(str(r.chk)) ?? byCheck.set(str(r.chk), []).get(str(r.chk))!).push(r);
    const total = (await one(conn, `SELECT count(*) AS n FROM flags WHERE site = ${lit(s.site)}`)).n;
    const md: string[] = [`# Anomaly flags: ${s.name} (${s.site})`, ''];
    md.push(`${num(total)} episodes in all checks; ${fr.length} after the top-${opts.top} cap per check and variable. Stamps are UTC. The full rows with the verify query are in \`flags.csv\`.`, '');
    const nChecks = byCheck.size;
    const perCheckOverhead = 13;
    const rowBudget = Math.max(3, Math.floor((MAX_LINES - md.length - 2 - perCheckOverhead * nChecks) / Math.max(1, nChecks)));
    let cut = 0;
    const sections: string[] = [];
    for (const [id, list] of byCheck) {
      const keep = list.slice(0, rowBudget);
      cut += list.length - keep.length;
      sections.push(`## ${id}: ${CHECK_NAMES[id as CheckId]}`, '', `Rule: ${thresholdText(id as CheckId)}`, '');
      sections.push(table(['Variable', 'From (UTC)', 'To (UTC)', 'n', 'Value', 'Expected', 'Score', 'Detail'],
        keep.map((r) => [str(r.variable), str(r.ts_from), str(r.ts_to), num(r.n_periods), r4(r.value), r4(r.expected), r4(r.score), str(r.detail)])), '');
      sections.push('Verify (pattern of the first row):', '', '```sql', str(keep[0]!.verify_sql), '```', '');
    }
    if (cut > 0) md.push(`${cut} episodes are cut from this file to keep it short. See \`flags.csv\`.`, '');
    md.push(...sections);
    const p = `${out}/flags-${s.site}.md`;
    await writeFile(p, md.join('\n'));
    files.push(p);
  }

  if (has('E')) {
    const md: string[] = ['# Fill values and constants (check E)', ''];
    md.push(`## Most frequent non-zero values per site and variable (top ${CHECKS.E.topValues})`, '');
    const f = await rows(conn, `SELECT * FROM e_freq ORDER BY site, variable, c DESC`);
    md.push(table(['Site', 'Variable', 'Value', 'Count', 'Share %', 'First', 'Last'], f.map((r) => [str(r.site), str(r.variable), r4(r.value), num(r.c), fmt(Math.round(num(r.share) * 10000) / 100), str(r.ts_from), str(r.ts_to)])), '');
    md.push('## Distinct values per site, variable and year', '');
    const d = await rows(conn, `SELECT * FROM e_distinct ORDER BY site, variable, y`);
    md.push(table(['Site', 'Variable', 'Year', 'Distinct', 'Values'], d.map((r) => [str(r.site), str(r.variable), num(r.y), num(r.n_distinct), num(r.n)])), '');
    md.push('## Exact zero and negative counts', '');
    const sp = await rows(conn, `SELECT * FROM e_special ORDER BY site, variable, kind`);
    md.push(sp.length ? table(['Site', 'Variable', 'Kind', 'Count', 'Min', 'First', 'Last'], sp.map((r) => [str(r.site), str(r.variable), str(r.kind), num(r.n), r4(r.mn), str(r.ts_from), str(r.ts_to)])) : 'None.', '');
    const p = `${out}/fill-values.md`;
    await writeFile(p, md.join('\n'));
    files.push(p);
  }

  if (has('G')) {
    const md: string[] = ['# Time axis (check G)', ''];
    md.push('Local hours. Peak = monthly median of the local hour of the daily radiation maximum. Expected peak = 12 + UTC offset - lon / 15 (no equation of time). Sunrise = monthly median of the first local hour with radiation > 10 W m-2. Expected sunrise = geometric sunrise for the 15th of the month (centre of the sun on the horizon, no refraction, no equation of time; about 0.2 h before the visible sunrise at 60 N). Site median = median peak of all months of the site.', '');
    const g = await rows(conn, `SELECT * FROM g_months ORDER BY site, y, m`);
    md.push(table(['Site', 'Year', 'Month', 'Days', 'Variable', 'Peak', 'Expected', 'Site median', 'Sunrise', 'Expected sunrise'],
      g.map((r) => [str(r.site), num(r.y), num(r.m), num(r.n_days), str(r.variable), r4(r.peak_hr), fmt(Math.round(num(r.expected_peak) * 100) / 100), r4(r.site_peak), r4(r.rise_hr), fmt(Math.round(num(r.expected_rise) * 100) / 100)])), '');
    const p = `${out}/time-axis.md`;
    await writeFile(p, md.join('\n'));
    files.push(p);
  }

  const checksPath = `${out}/checks.json`;
  await writeFile(checksPath, JSON.stringify({ checks: CHECKS, options: opts, sql: ctx.sql }, null, 2));
  files.push(checksPath);
  return files;
}

// ---------- main ----------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const started = new Date();
  const t0 = performance.now();
  await mkdir(opts.out, { recursive: true });
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  const ctx: Ctx = { conn, sql: {}, opts, sites: [] };

  const meta = await rows(conn, `SELECT key::VARCHAR AS k, value::VARCHAR AS v FROM parquet_kv_metadata(${lit(OBS_FILE)})`);
  const builtAt = str(meta.find((r) => r.k === 'built_at')?.v ?? 'unknown');

  let t = performance.now();
  await buildBase(ctx);
  log(`base tables: ${((performance.now() - t) / 1000).toFixed(1)} s`);
  for (const id of CHECK_IDS) {
    if (!opts.checks.includes(id)) continue;
    t = performance.now();
    await CHECK_FNS[id](ctx);
    const n = id === 'H' || id === 'L' ? '' : ` ${(await one(conn, `SELECT count(*) AS n FROM flags WHERE chk = ${lit(id)}`)).n} episodes,`;
    log(`check ${id} (${CHECK_NAMES[id]}):${n} ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }
  const seconds = (performance.now() - t0) / 1000;
  const files = await writeOutputs(ctx, builtAt, started, seconds);
  log(`wrote ${files.length} files to ${opts.out} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

await main();
