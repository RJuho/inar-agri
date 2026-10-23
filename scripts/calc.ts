// Derived flux products after Hu et al. 2024 and the methods it cites:
// night-time partitioning (Reichstein et al. 2005), MDS gap filling and
// u* filter for Maktau, daily / monthly / annual carbon sums, and the net
// ecosystem carbon balance with the management carbon table.
//
// Run: node scripts/calc.ts [--sites a,b] [--years 2022-2023] [--ustar fixed|mpt]
//      [--temp ta|tsoil] [--gpp-night keep|zero] [--out data/calculated]
// Input: db/*.parquet (npm run build:db) and a few raw columns (see RAW below).
// Output: data/calculated/ (not in git). Design: docs/calculated.md.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import * as v from 'valibot';
import { CONST, ROWS_PER_DAY } from './lib/calc/constants.ts';
import { MANAGEMENT_CARBON, cGm2, dryMass } from './lib/calc/management.ts';
import { fillMds } from './lib/calc/mds.ts';
import { fillTemperature, partitionYear, type E0Window, type PartitionResult, type RrefWindow, type SiteSeries } from './lib/calc/partition.ts';
import { renderMarkdown, type ReportTables } from './lib/calc/report.ts';
import { ManagementRowSchema, OptionsSchema, ReportSchema, type Options, type Report } from './lib/calc/schemas.ts';
import { isNA, longestGap } from './lib/calc/series.ts';
import { filterNee, movingPointTest } from './lib/calc/ustar.ts';
import { fail, ident, lit, log, num, numOrNull, one, rows, str } from './lib/duck.ts';

const DB_DIR = 'db';
const HH = CONST.hhToGc;

/** Raw columns that are not in the harmonised database. */
const RAW = {
  haltiala: 'data/Haltiala/haltiala.csv',
  flux: (dir: string, code: string, year: number) => `data/${dir}/EC_flux_L3_final_${code}_${year}.csv`,
};

// ---------- CLI ----------

function parseArgs(argv: string[]): Options {
  const o: Record<string, unknown> = { sites: null, yearFrom: null, yearTo: null, ustar: 'fixed', temp: 'ta', gppNight: CONST.gppNight, out: 'data/calculated' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const x = argv[++i];
      if (x === undefined) fail(`option ${a} needs a value`);
      return x;
    };
    if (a === '--sites') o.sites = next().split(',').map((s) => s.trim());
    else if (a === '--years') {
      const [f, t] = next().split('-');
      o.yearFrom = Number(f);
      o.yearTo = Number(t ?? f);
    } else if (a === '--ustar') o.ustar = next();
    else if (a === '--temp') o.temp = next();
    else if (a === '--gpp-night') o.gppNight = next();
    else if (a === '--out') o.out = next();
    else if (a === '--help' || a === '-h') {
      process.stdout.write('node scripts/calc.ts [--sites a,b] [--years 2022-2023] [--ustar fixed|mpt] [--temp ta|tsoil] [--gpp-night keep|zero] [--out dir]\n');
      process.exit(0);
    } else fail(`unknown option ${a}`);
  }
  const r = v.safeParse(OptionsSchema, o);
  if (!r.success) fail(`bad options: ${r.issues.map((x) => x.message).join('; ')}`);
  return r.output;
}

// ---------- series loading ----------

type SiteInfo = { siteId: number; code: string; name: string; utcOffsetMin: number };

const f64 = (n: number) => new Float64Array(n).fill(NaN);
const toNum = (x: unknown): number => (x === null || x === undefined ? NaN : typeof x === 'number' ? x : Number(x));

async function loadSeries(conn: DuckDBConnection, site: SiteInfo): Promise<SiteSeries> {
  const reader = await conn.runAndReadAll(
    `SELECT day, yr, mo, nee, nee_qc, nee_f, ta, tsoil, sw_in, ppfd, vpd_used, ustar, nee_ssitc, night
     FROM obs WHERE site_id = ${site.siteId} ORDER BY i`,
  );
  const data = reader.getRows();
  const n = data.length;
  const s: SiteSeries = {
    n, day: new Int32Array(n), year: new Int32Array(n), month: new Int32Array(n),
    nee: f64(n), neeQc: f64(n), neeF: f64(n), ta: f64(n), tsoil: f64(n), swIn: f64(n), ppfd: f64(n), vpd: f64(n), ustar: f64(n), ssitc: f64(n), night: f64(n),
  };
  for (let i = 0; i < n; i++) {
    const r = data[i]!;
    s.day[i] = Number(r[0]);
    s.year[i] = Number(r[1]);
    s.month[i] = Number(r[2]);
    s.nee[i] = toNum(r[3]);
    s.neeQc[i] = toNum(r[4]);
    s.neeF[i] = toNum(r[5]);
    s.ta[i] = toNum(r[6]);
    s.tsoil[i] = toNum(r[7]);
    s.swIn[i] = toNum(r[8]);
    s.ppfd[i] = toNum(r[9]);
    s.vpd[i] = toNum(r[10]);
    s.ustar[i] = toNum(r[11]);
    s.ssitc[i] = toNum(r[12]);
    const nt = r[13];
    s.night[i] = nt === null || nt === undefined ? NaN : nt ? 1 : 0;
  }
  return s;
}

// ---------- per-site processing ----------

/** nee_fill per row: how the gap-filled NEE of the row was made. */
const NEE_FILL = ['measured', 'source', 'mds'] as const;

type SiteOutput = {
  nee: Float64Array;
  neeF: Float64Array;
  neeFqc: Uint8Array;
  /** Index into NEE_FILL. */
  neeFill: Uint8Array;
  tempF: Float64Array;
  tempFqc: Uint8Array;
  reco: Float64Array;
  gpp: Float64Array;
  rref: Float64Array;
  e0: Float64Array;
  recoFqc: Uint8Array;
  partition: Report['partition'];
  e0Windows: (E0Window & { site: string; year: number })[];
  rrefWindows: (RrefWindow & { site: string; year: number })[];
  maktau: Report['maktau'];
};

function yearRanges(s: SiteSeries, yearFrom: number | null, yearTo: number | null): { year: number; from: number; to: number }[] {
  const out: { year: number; from: number; to: number }[] = [];
  let i = 0;
  while (i < s.n) {
    const y = s.year[i]!;
    let j = i;
    while (j < s.n && s.year[j] === y) j++;
    if ((yearFrom === null || y >= yearFrom) && (yearTo === null || y <= yearTo)) out.push({ year: y, from: i, to: j });
    i = j;
  }
  return out;
}

function processSite(site: SiteInfo, s: SiteSeries, opts: Options, warnings: string[]): SiteOutput {
  const n = s.n;
  const out: SiteOutput = {
    nee: Float64Array.from(s.nee), neeF: Float64Array.from(s.neeF), neeFqc: new Uint8Array(n), neeFill: new Uint8Array(n),
    tempF: f64(n), tempFqc: new Uint8Array(n), reco: f64(n), gpp: f64(n), rref: f64(n), e0: f64(n), recoFqc: new Uint8Array(n),
    partition: [], e0Windows: [], rrefWindows: [], maktau: null,
  };
  for (let i = 0; i < n; i++) {
    out.neeFqc[i] = s.neeQc[i] === 0 ? 0 : 1;
    out.neeFill[i] = s.neeQc[i] === 0 ? 0 : 1;
  }

  if (site.code !== 'maktau') {
    // Source gap-filled NEE. Rows that the source left empty (between the first and the last value) get MDS.
    let a = 0;
    while (a < n && isNA(s.neeF[a]!)) a++;
    let b = n;
    while (b > a && isNA(s.neeF[b - 1]!)) b--;
    const mds = fillMds(s.neeF, { swIn: s.swIn, ta: s.ta, vpd: s.vpd }, a, b);
    let filled = 0;
    for (let i = a; i < b; i++) {
      if (!isNA(s.neeF[i]!)) continue;
      out.neeF[i] = mds.values[i]!;
      out.neeFqc[i] = mds.qc[i]!;
      out.neeFill[i] = 2;
      if (mds.qc[i]) filled++;
    }
    if (filled) warnings.push(`${site.code}: ${filled} rows without a source gap-filled NEE were filled with MDS (${mds.counts.unfilled} stay empty).`);
  }

  // Maktau: quality filter, u*, MDS
  if (site.code === 'maktau') {
    const mpt: NonNullable<Report['maktau']>['mpt'] = [];
    const flagged = filterNee(s.nee, s.ssitc, s.ustar, NaN).values; // flag and plausibility only, for the MPT
    for (const y of yearRanges(s, null, null)) {
      const r = movingPointTest(flagged, s.ustar, s.ta, s.night, s.month, y.from, y.to);
      mpt.push({ year: y.year, threshold: numOrNaN(r.threshold), bounded: numOrNaN(r.bounded), seasons: r.seasons.map((x) => ({ season: x.season, nNight: x.nNight, threshold: numOrNaN(x.threshold) })) });
    }
    let threshold: number = CONST.maktau.ustarFixed;
    if (opts.ustar === 'mpt') {
      const vals = mpt.map((m) => m.bounded).filter((x): x is number => x !== null);
      if (vals.length) threshold = Math.max(...vals);
      else warnings.push('Maktau: the moving point test gave no threshold; the fixed threshold is used.');
    }
    const filtered = filterNee(s.nee, s.ssitc, s.ustar, threshold);
    out.nee = filtered.values;
    // fill range: first to last measured flux
    let a = 0;
    while (a < n && isNA(filtered.values[a]!)) a++;
    let b = n;
    while (b > a && isNA(filtered.values[b - 1]!)) b--;
    const mds = fillMds(filtered.values, { swIn: s.swIn, ta: s.ta, vpd: s.vpd }, a, b);
    out.neeF = mds.values;
    for (let i = 0; i < n; i++) {
      const measured = !isNA(filtered.values[i]!);
      out.neeFqc[i] = measured ? 0 : mds.qc[i] || 0;
      out.neeFill[i] = measured ? 0 : 2;
      s.neeQc[i] = measured ? 0 : 1;
      s.nee[i] = filtered.values[i]!;
    }
    out.maktau = {
      ustarThreshold: threshold,
      filter: { ...filtered.counts },
      mpt,
      mds: { ...mds.counts },
      fillRange: { from: String(a), to: String(b - 1) },
    };
    log(`  maktau: ${filtered.counts.kept} of ${filtered.counts.total} flux rows kept (u* >= ${threshold}), MDS filled ${mds.counts.qc1 + mds.counts.qc2 + mds.counts.qc3} rows, ${mds.counts.unfilled} unfilled`);
  }

  // Temperature
  const tf = fillTemperature(opts.temp === 'tsoil' ? s.tsoil : s.ta);
  out.tempF = tf.values;
  out.tempFqc = tf.qc;

  // Partition per local year. Night rows with u* below the fixed threshold are left out where u* exists.
  const years = yearRanges(s, opts.yearFrom, opts.yearTo);
  const results = new Map<number, PartitionResult>();
  const popts = { tempVar: opts.temp, gppNight: opts.gppNight, ustarMin: CONST.maktau.ustarFixed };
  for (const y of years) results.set(y.year, partitionYear(s, tf.values, out.neeF, y.from, y.to, popts));
  // Fallback: a year without E0 but with some nights takes the E0 of the nearest year that has one.
  for (const y of years) {
    const r = results.get(y.year)!;
    if (r.e0Method !== 'none' || r.nNight <= CONST.rref.minData) continue;
    const donors = years.filter((d) => Number.isFinite(results.get(d.year)!.e0) && results.get(d.year)!.e0Method !== 'neighbour').map((d) => d.year);
    if (donors.length === 0) continue;
    const donor = donors.reduce((best, d) => (Math.abs(d - y.year) < Math.abs(best - y.year) ? d : best));
    const forced = partitionYear(s, tf.values, out.neeF, y.from, y.to, { ...popts, forceE0: results.get(donor)!.e0 });
    forced.e0Se = results.get(donor)!.e0Se;
    results.set(y.year, forced);
    warnings.push(`${site.code} ${y.year}: E0 taken from ${donor} (${r.nNight} night values, ${r.nE0Valid} valid windows).`);
  }
  for (const y of years) {
    const r = results.get(y.year)!;
    out.reco.set(r.reco, y.from);
    out.gpp.set(r.gpp, y.from);
    out.rref.set(r.rref, y.from);
    out.recoFqc.set(r.recoFqc, y.from);
    let rowsReco = 0;
    let rowsFqc2 = 0;
    let tempFilled = 0;
    for (let i = y.from; i < y.to; i++) {
      if (!isNA(out.reco[i]!)) rowsReco++;
      if (out.recoFqc[i] === 2) rowsFqc2++;
      if (tf.qc[i]) tempFilled++;
      out.e0[i] = r.e0;
    }
    const used = r.rrefWindows.filter((w) => w.used);
    out.partition.push({
      site: site.code, year: y.year, nNight: r.nNight, e0: numOrNaN(r.e0), e0Se: numOrNaN(r.e0Se), e0Method: r.e0Method,
      e0WindowsTried: r.e0Windows.length, e0WindowsValid: r.nE0Valid, rrefWindowsUsed: used.length,
      rrefMin: used.length ? Math.min(...used.map((w) => w.rref)) : null, rrefMax: used.length ? Math.max(...used.map((w) => w.rref)) : null,
      rowsReco, rowsFqc2, tempFilled,
    });
    out.e0Windows.push(...r.e0Windows.map((w) => ({ ...w, site: site.code, year: y.year })));
    out.rrefWindows.push(...r.rrefWindows.map((w) => ({ ...w, site: site.code, year: y.year })));
    if (r.e0Method === 'none') warnings.push(`${site.code} ${y.year}: no E0 (night values: ${r.nNight}). No Reco and GPP for this year.`);
    else if (used.length === 0) {
      const negative = r.rrefWindows.filter((w) => w.n > CONST.rref.minData && w.rref < 0).length;
      warnings.push(`${site.code} ${y.year}: no usable Rref window (${negative} windows with a negative Rref: the night NEE is negative). No Reco and GPP for this year.`);
    }
    else if (r.e0Method !== 'windows' && r.e0Method !== 'neighbour') warnings.push(`${site.code} ${y.year}: E0 from ${r.e0Method} (${r.nE0Valid} valid windows).`);
    log(`  ${site.code} ${y.year}: night ${r.nNight}, E0 ${r.e0.toFixed(1)} ± ${r.e0Se.toFixed(1)} (${r.e0Method}, ${r.nE0Valid}/${r.e0Windows.length} windows), Rref windows ${used.length}, Reco rows ${rowsReco}`);
  }
  return out;
}

const numOrNaN = (x: number): number | null => (Number.isFinite(x) ? x : null);

// ---------- write results into DuckDB ----------

async function appendDerived(conn: DuckDBConnection, site: SiteInfo, o: SiteOutput): Promise<void> {
  const app = await conn.createAppender('derived');
  const dbl = (x: number) => (isNA(x) ? app.appendNull() : app.appendDouble(x));
  for (let i = 0; i < o.nee.length; i++) {
    app.appendUTinyInt(site.siteId);
    app.appendInteger(i);
    dbl(o.nee[i]!);
    dbl(o.neeF[i]!);
    app.appendUTinyInt(o.neeFqc[i]!);
    if (isNA(o.neeF[i]!)) app.appendNull();
    else app.appendVarchar(NEE_FILL[o.neeFill[i]!]!);
    dbl(o.tempF[i]!);
    app.appendUTinyInt(o.tempFqc[i]!);
    dbl(o.reco[i]!);
    dbl(o.gpp[i]!);
    dbl(o.rref[i]!);
    dbl(o.e0[i]!);
    app.appendUTinyInt(o.recoFqc[i]!);
    app.endRow();
  }
  app.flushSync();
  app.closeSync();
}

// ---------- main ----------

async function main(): Promise<void> {
  const started = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  const warnings: string[] = [];
  const outDir = opts.out;
  await mkdir(outDir, { recursive: true });

  // Management table check
  for (const r of MANAGEMENT_CARBON) {
    const p = v.safeParse(ManagementRowSchema, r);
    if (!p.success) fail(`management row ${r.site} ${r.date}: ${p.issues.map((x) => x.message).join('; ')}`);
  }

  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  const version = str((await one(conn, 'SELECT version() AS v')).v);
  log(`DuckDB ${version}, Node ${process.version}`);

  const siteRows = await rows(conn, `SELECT site_id, code, name, utc_offset_min FROM read_parquet(${lit(`${DB_DIR}/sites.parquet`)}) ORDER BY site_id`);
  const allSites: SiteInfo[] = siteRows.map((r) => ({ siteId: num(r.site_id), code: str(r.code), name: str(r.name), utcOffsetMin: num(r.utc_offset_min) }));
  const sites = allSites.filter((s) => opts.sites === null || opts.sites.includes(s.code as never));
  if (sites.length === 0) fail('no site selected');

  // 1. Observations with local time, night flag, VPD
  log('Loading observations');
  await conn.run(`
    CREATE TABLE obs AS
    SELECT o.site_id, s.code AS site_code, o.ts_start, o.ts_start + to_minutes(s.utc_offset_min) AS tl,
           row_number() OVER (PARTITION BY o.site_id ORDER BY o.ts_start) - 1 AS i,
           date_diff('day', DATE '2000-01-01', (o.ts_start + to_minutes(s.utc_offset_min))::DATE)::INTEGER AS day,
           year(o.ts_start + to_minutes(s.utc_offset_min))::INTEGER AS yr,
           month(o.ts_start + to_minutes(s.utc_offset_min))::INTEGER AS mo,
           o.nee, o.nee_f, o.nee_qc, o.ta, o.tsoil, o.swc, o.sw_in, o.ppfd, o.rh, o.vpd, o.ustar, o.nee_ssitc, o.gpp_src, o.reco_src, o.ch4,
           COALESCE(o.vpd, CASE WHEN o.ta IS NOT NULL AND o.rh IS NOT NULL
                                THEN greatest(0, 6.1078 * exp(17.27 * o.ta / (o.ta + 237.3)) * (1 - o.rh / 100)) END) AS vpd_used,
           o.vpd IS NULL AND o.ta IS NOT NULL AND o.rh IS NOT NULL AS vpd_magnus,
           CASE WHEN o.sw_in IS NOT NULL THEN o.sw_in < ${CONST.night.swIn}
                WHEN o.ppfd IS NOT NULL THEN o.ppfd < ${CONST.night.ppfd} END AS night
    FROM read_parquet(${lit(`${DB_DIR}/observations.parquet`)}) o
    JOIN read_parquet(${lit(`${DB_DIR}/sites.parquet`)}) s USING (site_id)
    WHERE o.site_id IN (${sites.map((s) => s.siteId).join(', ')})`);
  await conn.run(`
    CREATE TABLE derived (site_id UTINYINT, i INTEGER, nee DOUBLE, nee_f DOUBLE, nee_fqc UTINYINT, nee_fill VARCHAR,
                          temp_f DOUBLE, temp_fqc UTINYINT, reco DOUBLE, gpp DOUBLE, rref DOUBLE, e0 DOUBLE, reco_fqc UTINYINT)`);

  // 2. Per site: filter, fill, partition
  const report: Report = {
    builtAt: new Date().toISOString(), duckdb: version, node: process.version, options: opts, constants: CONST as unknown as Record<string, unknown>,
    outputs: [], partition: [], maktau: null, warnings,
  };
  const e0Windows: SiteOutput['e0Windows'] = [];
  const rrefWindows: SiteOutput['rrefWindows'] = [];
  for (const site of sites) {
    log(`Processing ${site.name}`);
    const s = await loadSeries(conn, site);
    const o = processSite(site, s, opts, warnings);
    await appendDerived(conn, site, o);
    report.partition.push(...o.partition);
    e0Windows.push(...o.e0Windows);
    rrefWindows.push(...o.rrefWindows);
    if (o.maktau) {
      const a = await one(conn, `SELECT min(ts_start)::VARCHAR AS a, max(ts_start)::VARCHAR AS b FROM obs WHERE site_id = ${site.siteId} AND i IN (${o.maktau.fillRange.from}, ${o.maktau.fillRange.to})`);
      report.maktau = { ...o.maktau, fillRange: { from: str(a.a), to: str(a.b) } };
    }
  }

  // 3. Flux table
  log('Aggregating');
  await conn.run(`
    CREATE TABLE fluxes AS
    SELECT o.site_id, o.site_code, o.ts_start, o.tl, o.yr, o.mo, o.night, o.nee_qc AS nee_qc_src, d.nee, d.nee_f, d.nee_fqc, d.nee_fill,
           o.ta, o.tsoil, o.sw_in, o.ppfd, o.vpd_used AS vpd, o.ustar, d.temp_f, d.temp_fqc, d.reco, d.gpp, d.rref, d.e0, d.reco_fqc,
           CASE WHEN d.gpp IS NULL THEN NULL ELSE greatest(d.reco_fqc, CASE WHEN d.nee_fqc > 0 THEN 1 ELSE 0 END) END::UTINYINT AS gpp_fqc,
           o.gpp_src, o.reco_src, o.ch4
    FROM obs o JOIN derived d USING (site_id, i)
    ORDER BY o.site_id, o.ts_start`);

  // 4. Aggregations (local time)
  const sums = `
    count(*) AS n_rows, count(nee) AS n_measured, (count(nee) / count(*)::DOUBLE) AS frac_measured,
    count(nee_f) AS n_nee_f, count(gpp) AS n_gpp,
    CASE WHEN count(nee_f) = count(*) THEN sum(nee_f) * ${HH} END AS nee_f_gc,
    CASE WHEN count(gpp) = count(*) THEN sum(gpp) * ${HH} END AS gpp_gc,
    CASE WHEN count(reco) = count(*) THEN sum(reco) * ${HH} END AS reco_gc,
    CASE WHEN count(gpp_src) = count(*) THEN sum(gpp_src) * ${HH} END AS gpp_src_gc,
    CASE WHEN count(reco_src) = count(*) THEN sum(reco_src) * ${HH} END AS reco_src_gc,
    CASE WHEN count(ch4) = count(*) THEN sum(ch4) * ${HH} END AS ch4_gc,
    count(*) FILTER (WHERE nee_fqc = 3) AS n_qc3, count(*) FILTER (WHERE reco_fqc = 2) AS n_reco_fqc2,
    avg(ta) AS ta_mean, avg(temp_f) AS temp_f_mean`;
  await conn.run(`CREATE TABLE daily AS SELECT site_id, site_code, tl::DATE AS date_local, ${sums} FROM fluxes GROUP BY ALL ORDER BY site_id, date_local`);
  await conn.run(`CREATE TABLE monthly AS SELECT site_id, site_code, yr AS year, mo AS month, ${sums} FROM fluxes GROUP BY ALL ORDER BY site_id, year, month`);
  // longest gap of measured NEE per year, in days
  await conn.run(`
    CREATE TABLE gaps AS
    WITH g AS (SELECT site_id, yr, i, nee IS NULL AS gap, i - row_number() OVER (PARTITION BY site_id, yr, nee IS NULL ORDER BY i) AS grp
               FROM (SELECT site_id, yr, nee, row_number() OVER (PARTITION BY site_id ORDER BY ts_start) AS i FROM fluxes))
    SELECT site_id, yr AS year, max(n) / ${ROWS_PER_DAY}.0 AS longest_gap_days
    FROM (SELECT site_id, yr, grp, count(*) AS n FROM g WHERE gap GROUP BY ALL) GROUP BY ALL`);
  // Haltiala uncertainty from the ten models
  await conn.run(`
    CREATE TABLE haltiala_unc AS
    WITH m AS (SELECT TIMESTAMP_START::TIMESTAMP AS tl, unnest([NEE_F1, NEE_F2, NEE_F3, NEE_F4, NEE_F5, NEE_F6, NEE_F7, NEE_F8, NEE_F9, NEE_F10]) AS x,
                      unnest(range(1, 11)) AS model
               FROM read_csv(${lit(RAW.haltiala)}, nullstr='NA')),
         s AS (SELECT year(tl) AS year, model, sum(x) * ${HH} AS gc, count(x) AS n, count(*) AS n_rows FROM m GROUP BY ALL)
    SELECT year, avg(gc) AS mean10, stddev_samp(gc) AS sd10, 1.96 * stddev_samp(gc) AS ci95, min(n) = min(n_rows) AS complete
    FROM s GROUP BY year ORDER BY year`);
  await conn.run(`
    CREATE TABLE annual AS
    SELECT a.site_id, a.site_code, a.year, a.n_rows, a.n_measured, a.frac_measured, a.n_nee_f, a.n_gpp,
           a.n_rows = 48 * (CASE WHEN a.year % 4 = 0 AND (a.year % 100 <> 0 OR a.year % 400 = 0) THEN 366 ELSE 365 END) AS full_year,
           COALESCE(g.longest_gap_days, 0) AS longest_gap_days,
           (a.frac_measured >= ${CONST.reliable.minFracMeasured} AND COALESCE(g.longest_gap_days, 0) <= ${CONST.reliable.maxGapDays}) AS reliable,
           a.nee_f_gc, a.gpp_gc, a.reco_gc, a.gpp_src_gc, a.reco_src_gc, a.ch4_gc, a.n_qc3, a.n_reco_fqc2, a.ta_mean,
           CASE WHEN a.site_code = 'haltiala' THEN h.sd10 END AS nee_f_sd10,
           CASE WHEN a.site_code = 'haltiala' THEN h.ci95 END AS nee_f_ci95
    FROM (SELECT site_id, site_code, yr AS year, ${sums} FROM fluxes GROUP BY ALL) a
    LEFT JOIN gaps g USING (site_id, year)
    LEFT JOIN haltiala_unc h USING (year)
    ORDER BY a.site_id, a.year`);

  // 5. Management and NECB
  const mgmtRows = MANAGEMENT_CARBON.map(
    (r) => `(${[r.site, r.date, year(r.date), r.action, r.product, r.fresh_kg_ha, r.dm_fraction, dryMass(r), r.c_fraction, r.c_fraction_source, cGm2(r), r.source, r.note].map(lit).join(', ')})`,
  );
  await conn.run(`
    CREATE TABLE management AS
    SELECT site, date::DATE AS date, year::INTEGER AS year, action, product, fresh_kg_ha::DOUBLE AS fresh_kg_ha, dm_fraction::DOUBLE AS dm_fraction,
           dry_mass_kg_ha::DOUBLE AS dry_mass_kg_ha, c_fraction::DOUBLE AS c_fraction, c_fraction_source, c_g_m2::DOUBLE AS c_g_m2, source, note
    FROM (VALUES ${mgmtRows.join(',\n')}) t(site, date, year, action, product, fresh_kg_ha, dm_fraction, dry_mass_kg_ha, c_fraction, c_fraction_source, c_g_m2, source, note)
    ORDER BY site, date`);
  await conn.run(`
    CREATE TABLE necb AS
    WITH m AS (
      SELECT site AS site_code, year,
             sum(c_g_m2) FILTER (WHERE action = 'harvest') AS c_harvest,
             sum(c_g_m2) FILTER (WHERE action = 'fertilisation') AS c_exo,
             count(*) FILTER (WHERE action = 'harvest') AS n_harvest,
             count(*) FILTER (WHERE action = 'harvest' AND c_g_m2 IS NULL) AS n_harvest_unknown,
             count(*) FILTER (WHERE action = 'fertilisation' AND c_g_m2 IS NULL) AS n_exo_unknown,
             count(*) FILTER (WHERE c_fraction_source = 'assumed') AS n_assumed,
             count(*) FILTER (WHERE action = 'grazing') AS n_grazing
      FROM management GROUP BY ALL)
    SELECT a.site_id, a.site_code, a.year, a.nee_f_gc, a.full_year, a.reliable,
           CASE WHEN k.known THEN COALESCE(m.c_harvest, 0) END AS c_harvest,
           CASE WHEN k.known THEN COALESCE(m.c_exo, 0) END AS c_exo,
           a.ch4_gc AS c_ch4,
           COALESCE(m.n_harvest, 0) AS n_harvest, COALESCE(m.n_harvest_unknown, 0) AS n_harvest_unknown, COALESCE(m.n_exo_unknown, 0) AS n_exo_unknown,
           COALESCE(m.n_assumed, 0) AS n_assumed, COALESCE(m.n_grazing, 0) AS n_grazing,
           CASE WHEN a.nee_f_gc IS NULL THEN NULL
                WHEN k.known THEN -a.nee_f_gc - COALESCE(m.c_harvest, 0) + COALESCE(m.c_exo, 0) - COALESCE(a.ch4_gc, 0)
                WHEN a.site_code IN ('anttila', 'sarkisuo') THEN -a.nee_f_gc - COALESCE(a.ch4_gc, 0)
                END AS necb,
           (a.nee_f_gc IS NOT NULL AND a.full_year AND k.known
            AND COALESCE(m.n_harvest_unknown, 0) = 0 AND COALESCE(m.n_exo_unknown, 0) = 0 AND COALESCE(m.n_assumed, 0) = 0 AND COALESCE(m.n_grazing, 0) = 0) AS necb_complete,
           CASE WHEN a.site_code = 'maktau' THEN 'No harvest data. NECB not computed.'
                WHEN NOT k.known THEN 'No harvest data for this year. NECB = -NEE - C_CH4 only.'
                WHEN a.nee_f_gc IS NULL THEN 'Incomplete year.'
                ELSE concat_ws(' ',
                  CASE WHEN NOT a.full_year THEN 'Partial year.' END,
                  CASE WHEN COALESCE(m.n_harvest_unknown, 0) > 0 THEN 'Harvest without amount.' END,
                  CASE WHEN COALESCE(m.n_exo_unknown, 0) > 0 THEN 'Organic input without carbon content: NECB is a lower bound.' END,
                  CASE WHEN COALESCE(m.n_assumed, 0) > 0 THEN 'Assumed carbon fraction or unit.' END,
                  CASE WHEN COALESCE(m.n_grazing, 0) > 0 THEN 'Grazing not quantified.' END,
                  CASE WHEN COALESCE(m.n_harvest, 0) = 0 THEN 'No harvest row.' END)
                END AS note
    FROM annual a LEFT JOIN m USING (site_code, year)
    -- known: the management of the site and year is known. Haltiala, Qvidja and Viikki have
    -- a management file for all years (a year without a harvest row is a year without a
    -- harvest). Anttila and Särkisuo have harvest data only for the years with a row
    -- (2022 and 2023, 2018-2025 events file). Maktau has none.
    LEFT JOIN (SELECT a.site_code, a.year,
                      a.site_code IN ('qvidja', 'haltiala', 'viikki') OR (a.site_code IN ('anttila', 'sarkisuo') AND COALESCE(m.n_harvest, 0) > 0) AS known
               FROM annual a LEFT JOIN m USING (site_code, year)) k USING (site_code, year)
    ORDER BY a.site_id, a.year`);

  // 6. Validation
  await conn.run(`
    CREATE TABLE src_e0 AS
    ${(['Anttila:FI-Ant:anttila', 'Särkisuo:FI-Sar:sarkisuo'] as const)
      .flatMap((x) => {
        const [dir, code, site] = x.split(':') as [string, string, string];
        return [2022, 2023].map(
          (yr) => `SELECT '${site}' AS site_code, ${yr} AS year, try_strptime("time", '%Y-%m-%d %H:%M:%S') AS ts_local,
                     CASE WHEN try_cast(E0_gf_ensemble_NT AS DOUBLE) <= -9999 THEN NULL ELSE try_cast(E0_gf_ensemble_NT AS DOUBLE) END AS e0_src,
                     CASE WHEN try_cast(Rref_gf_ensemble_NT AS DOUBLE) <= -9999 THEN NULL ELSE try_cast(Rref_gf_ensemble_NT AS DOUBLE) END AS rref_src
                   FROM read_csv(${lit(RAW.flux(dir, code, yr))}, header=true, all_varchar=true, nullstr='-9999')`,
        );
      })
      .join('\n UNION ALL ')}`);
  await conn.run(`
    CREATE TABLE validation_partition AS
    WITH f AS (SELECT f.*, e.e0_src, e.rref_src FROM fluxes f LEFT JOIN src_e0 e ON e.site_code = f.site_code AND e.ts_local = f.tl)
    SELECT site_code, yr AS year,
           CASE WHEN count(gpp) = count(*) THEN sum(gpp) * ${HH} END AS gpp_gc,
           CASE WHEN count(gpp_src) = count(*) THEN sum(gpp_src) * ${HH} END AS gpp_src_gc,
           100 * (sum(gpp) - sum(gpp_src)) / nullif(sum(gpp_src), 0) AS gpp_diff_pct,
           CASE WHEN count(reco) = count(*) THEN sum(reco) * ${HH} END AS reco_gc,
           CASE WHEN count(reco_src) = count(*) THEN sum(reco_src) * ${HH} END AS reco_src_gc,
           100 * (sum(reco) - sum(reco_src)) / nullif(sum(reco_src), 0) AS reco_diff_pct,
           sqrt(avg((reco - reco_src) ^ 2)) AS rmse_reco, avg(reco - reco_src) AS bias_reco,
           sqrt(avg((gpp - gpp_src) ^ 2)) AS rmse_gpp,
           any_value(e0) AS e0, any_value(e0_src) AS e0_src, corr(rref, rref_src) AS corr_rref, count(*) AS n_rows
    FROM f WHERE gpp_src IS NOT NULL GROUP BY ALL ORDER BY site_code, year`);
  const heimsch = CONST.heimsch2024
    .map((h) => `(${[h.from, h.to, h.nee, h.gpp, h.reco, h.input, h.output, h.necb].map(lit).join(', ')})`)
    .join(', ');
  await conn.run(`
    CREATE TABLE validation_qvidja AS
    WITH h AS (SELECT * FROM (VALUES ${heimsch}) t(d_from, d_to, nee_paper, gpp_paper, reco_paper, input_paper, output_paper, necb_paper_sign)),
         f AS (SELECT h.d_from, h.d_to, nee_paper, gpp_paper, reco_paper, input_paper, output_paper, necb_paper_sign,
                      count(*) AS n_rows, count(nee_f) AS n_nee_f,
                      sum(nee_f) * ${HH} AS nee_f_gc, sum(gpp) * ${HH} AS gpp_gc, sum(reco) * ${HH} AS reco_gc,
                      sum(gpp_src) * ${HH} AS gpp_src_gc, sum(reco_src) * ${HH} AS reco_src_gc
               FROM h LEFT JOIN fluxes x ON x.site_code = 'qvidja' AND x.tl >= h.d_from::TIMESTAMP AND x.tl < h.d_to::TIMESTAMP
               GROUP BY ALL),
         m AS (SELECT d_from, d_to,
                      sum(c_g_m2) FILTER (WHERE action = 'harvest') AS c_harvest,
                      sum(c_g_m2) FILTER (WHERE action = 'fertilisation') AS c_exo
               FROM h LEFT JOIN management mg ON mg.site = 'qvidja' AND mg.date >= h.d_from::DATE AND mg.date < h.d_to::DATE
               GROUP BY ALL)
    SELECT concat(f.d_from, ' to ', f.d_to) AS period, f.n_rows, f.n_nee_f, f.nee_f_gc, f.nee_paper, f.gpp_gc, f.gpp_src_gc, -f.gpp_paper AS gpp_paper,
           f.reco_gc, f.reco_src_gc, f.reco_paper,
           COALESCE(m.c_harvest, 0) AS c_harvest, output_paper, COALESCE(m.c_exo, 0) AS c_exo, input_paper,
           -f.nee_f_gc - COALESCE(m.c_harvest, 0) + COALESCE(m.c_exo, 0) AS necb, -necb_paper_sign AS necb_paper,
           CASE WHEN abs(f.nee_f_gc - f.nee_paper) <= 100 THEN 'consistent' ELSE 'check' END AS class
    FROM f LEFT JOIN m USING (d_from, d_to) ORDER BY f.d_from`);
  await conn.run(`
    CREATE TABLE validation_haltiala AS
    SELECT a.year, a.nee_f_gc, h.mean10, a.nee_f_gc - h.mean10 AS diff, h.sd10, h.ci95
    FROM annual a JOIN haltiala_unc h USING (year) WHERE a.site_code = 'haltiala' ORDER BY a.year`);
  const identity = await one(conn, `SELECT count(*) AS n FROM fluxes WHERE gpp IS NOT NULL AND abs(reco - gpp - nee_f) > 1e-9`);
  if (num(identity.n) > 0) warnings.push(`${identity.n} rows break the identity nee_f = reco - gpp.`);
  const negReco = await one(conn, `SELECT count(*) AS n FROM fluxes WHERE reco < 0`);
  if (num(negReco.n) > 0) warnings.push(`${negReco.n} rows have Reco below 0.`);
  const nightGpp = await rows(conn, `SELECT site_code, avg(abs(gpp)) AS g FROM fluxes WHERE night AND gpp IS NOT NULL GROUP BY ALL HAVING avg(abs(gpp)) > 1 ORDER BY 1`);
  for (const r of nightGpp) warnings.push(`${r.site_code}: mean |GPP| at night is ${fmtNum(r.g)} µmol m-2 s-1.`);
  const vpdMagnus = await rows(conn, `SELECT site_code, count(*) AS n FROM obs WHERE vpd_magnus GROUP BY ALL ORDER BY 1`);
  for (const r of vpdMagnus) warnings.push(`${r.site_code}: VPD computed from ta and rh (Magnus) in ${r.n} rows.`);

  // 7. Write files
  log('Writing files');
  const built = report.builtAt;
  const kv = (extra: string) => `KV_METADATA {built_at: ${lit(built)}, generator: 'scripts/calc.ts', design: 'docs/calculated.md', options: ${lit(JSON.stringify(opts))}, constants: ${lit(JSON.stringify(CONST))}${extra}}`;
  const csv = `(FORMAT csv, HEADER true, DELIMITER ',')`;
  const fluxUnits = `, unit_nee: 'µmol CO2 m-2 s-1', unit_nee_f: 'µmol CO2 m-2 s-1', unit_reco: 'µmol CO2 m-2 s-1', unit_gpp: 'µmol CO2 m-2 s-1', unit_rref: 'µmol CO2 m-2 s-1', unit_e0: 'K', unit_temp_f: '°C', unit_sw_in: 'W m-2', unit_ppfd: 'µmol m-2 s-1', unit_vpd: 'hPa', unit_ustar: 'm s-1', unit_ch4: 'µmol CH4 m-2 s-1', unit_ts_start: 'UTC', unit_tl: 'site local time'`;
  const files: { name: string; sql: string; format: 'parquet' | 'csv' }[] = [
    { name: 'fluxes_30min.parquet', format: 'parquet', sql: `SELECT * FROM fluxes ORDER BY site_id, ts_start` },
    { name: 'daily.parquet', format: 'parquet', sql: `SELECT * FROM daily` },
    { name: 'daily.csv', format: 'csv', sql: `SELECT * FROM daily` },
    { name: 'monthly.csv', format: 'csv', sql: `SELECT * FROM monthly` },
    { name: 'annual.csv', format: 'csv', sql: `SELECT * FROM annual` },
    { name: 'necb.csv', format: 'csv', sql: `SELECT * FROM necb` },
    { name: 'management_carbon.csv', format: 'csv', sql: `SELECT * FROM management` },
    { name: 'partition_params.csv', format: 'csv', sql: `SELECT * FROM (VALUES ${report.partition.map((r) => `(${[r.site, r.year, r.nNight, r.e0, r.e0Se, r.e0Method, r.e0WindowsTried, r.e0WindowsValid, r.rrefWindowsUsed, r.rrefMin, r.rrefMax, r.rowsReco, r.rowsFqc2, r.tempFilled].map(lit).join(', ')})`).join(', ')}) t(site_code, year, n_night, e0, e0_se, e0_method, e0_windows_tried, e0_windows_valid, rref_windows_used, rref_min, rref_max, rows_reco, rows_fqc2, temp_rows_filled)` },
    { name: 'e0_windows.csv', format: 'csv', sql: e0Windows.length ? `SELECT * FROM (VALUES ${e0Windows.map((w) => `(${[w.site, w.year, w.centreDay, w.n, w.tempRange, w.e0, w.seE0, w.rref, w.status].map((x) => lit(typeof x === 'number' && !Number.isFinite(x) ? null : x)).join(', ')})`).join(', ')}) t(site_code, year, centre_day, n, temp_range, e0, e0_se, rref, status)` : `SELECT NULL AS site_code WHERE false` },
    { name: 'rref_windows.csv', format: 'csv', sql: rrefWindows.length ? `SELECT * FROM (VALUES ${rrefWindows.map((w) => `(${[w.site, w.year, w.centreDay, w.n, w.rref, w.se, w.used].map((x) => lit(typeof x === 'number' && !Number.isFinite(x) ? null : x)).join(', ')})`).join(', ')}) t(site_code, year, centre_day, n, rref, rref_se, used)` : `SELECT NULL AS site_code WHERE false` },
    { name: 'validation_partition.csv', format: 'csv', sql: `SELECT * FROM validation_partition` },
    { name: 'validation_qvidja.csv', format: 'csv', sql: `SELECT * FROM validation_qvidja` },
    { name: 'validation_haltiala.csv', format: 'csv', sql: `SELECT * FROM validation_haltiala` },
  ];
  if (report.maktau) {
    files.push({
      name: 'ustar_thresholds.csv', format: 'csv',
      sql: `SELECT * FROM (VALUES ${report.maktau.mpt.flatMap((y) => y.seasons.map((s) => `(${[y.year, s.season, s.nNight, s.threshold, y.threshold, y.bounded, report.maktau!.ustarThreshold].map(lit).join(', ')})`)).join(', ')}) t(year, season, n_night, season_threshold, year_threshold, year_bounded, applied)`,
    });
  }
  for (const f of files) {
    const path = `${outDir}/${f.name}`;
    if (f.format === 'csv') {
      // The CSV files hold dates and years only; the 30-min timestamps are in the Parquet file.
      await conn.run(`COPY (${f.sql}) TO ${lit(path)} ${csv}`);
    } else {
      await conn.run(`COPY (${f.sql}) TO ${lit(path)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000, ${kv(f.name.startsWith('fluxes') ? fluxUnits : '')})`);
    }
    const n = await one(conn, f.format === 'parquet' ? `SELECT count(*) AS n FROM read_parquet(${lit(path)})` : `SELECT count(*) AS n FROM read_csv(${lit(path)}, all_varchar=true)`);
    report.outputs.push({ file: path, rows: num(n.n), bytes: (await stat(path)).size });
  }

  // 8. Report
  const tables: ReportTables = {
    annual: await rows(conn, `SELECT * FROM annual`),
    necb: await rows(conn, `SELECT * FROM necb`),
    validationPartition: await rows(conn, `SELECT * FROM validation_partition`),
    validationQvidja: await rows(conn, `SELECT * FROM validation_qvidja`),
    validationHaltiala: await rows(conn, `SELECT * FROM validation_haltiala`),
    management: await rows(conn, `SELECT * FROM management`),
  };
  const checked = v.parse(ReportSchema, report);
  const md = renderMarkdown(checked, tables);
  await writeFile(`${outDir}/report.json`, `${JSON.stringify(checked, null, 2)}\n`);
  await writeFile(`${outDir}/report.md`, `${md}\n`);
  report.outputs.push({ file: `${outDir}/report.md`, rows: 0, bytes: (await stat(`${outDir}/report.md`)).size });
  conn.closeSync();
  process.stdout.write(`${md}\n`);
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const year = (date: string): number => Number(date.slice(0, 4));
const fmtNum = (x: unknown): string => (typeof x === 'number' ? x.toFixed(2) : String(x));

main().catch((e: unknown) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
