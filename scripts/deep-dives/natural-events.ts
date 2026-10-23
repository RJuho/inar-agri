// Deep Dive "Natural events and disturbances" (site/src/pages/deep-dive/natural-events.mdx).
// Question: which natural events (frost, heat, cold spells, heavy rain, dry spells, failed rains,
// soil drought, wet soil, frozen soil) occur at the six sites, and how is the daily NEE on these days
// different from the NEE on other days of the same months?
//
// Inputs (read only): db/sites.parquet, db/observations.parquet, db/events.parquet and
// data/calculated/daily.parquet. Output: the result object; scripts/deep-dives.ts writes it to
// site/src/deep-dives/natural-events.json. Run: npm run deep-dives.
//
// Method:
// 1. Local day = ts_start + utc_offset_min. A daily value of a variable needs 40 or more of the
//    48 half hours. Half hours with ta below -35 °C are removed first (finding SAR-03).
// 2. Daily NEE (g C m-2 d-1) = nee_f_gc of data/calculated/daily.parquet (provider gap filling at five
//    sites, MDS at Maktau). Maktau: only the local years 2019 to 2024.
// 3. Human mask: the days from 2 days before to 14 days after each dated management event of
//    db/events.parquet are not used for NEE and soil water. Only the events of Haltiala, Qvidja and
//    Viikki (HUMAN_SITES): the dive was computed before the article events of Anttila, Särkisuo and
//    Maktau were added (2026-10-23), and the mask keeps these three sites so that the committed
//    JSON stays valid.
// 4. Soil water: at Qvidja, Viikki and Haltiala only on days with a daily mean tsoil above 0.5 °C.
//    Site percentiles (p10, p90, percent rank) over the used days.
// 5. Classes (detectClasses() in scripts/lib/deep-dive/natural-events.ts). Weather classes use all
//    days of the site; the soil classes use the used days.
// 6. Per class and site: NEE of the used event days against the NEE of the other used days of the
//    same calendar months. Pooled period years (MAM, JJA, SON, DJF). Anscombe statistics of daily
//    NEE against daily mean ta and against the swc percentile rank.
// 7. Anscombe statistics of daily NEE against daily mean ta per period year, all sites together
//    (taPeriods). Here the winter is keyed by the December year (periodKey()).

import type { DuckDBConnection } from '@duckdb/node-api';
import { num, numOrNull, rows, str } from '../lib/duck.ts';
import { dayNumber } from '../lib/deep-dive/harvest.ts';
import {
  CLASSES,
  classMask,
  detectClasses,
  eventDayMask,
  PERIODS,
  periodKey,
  periodLabelDec,
  poolByPeriod,
  type PeriodId,
  type ClassEpisode,
  type ClassId,
  type DayRow,
  type DetectOptions,
  type PoolRow,
  type RainSeason,
} from '../lib/deep-dive/natural-events.ts';
import { summarise, type Summary } from '../lib/deep-dive/stats.ts';

export const slug = 'natural-events';
export const title = 'Natural events and disturbances';

export const inputs = ['db/sites.parquet', 'db/observations.parquet', 'db/events.parquet', 'data/calculated/daily.parquet'] as const;

/** Sites whose events make the human mask (see the method comment). */
const HUMAN_SITES = ['haltiala', 'qvidja', 'viikki'] as const;
const humanSiteList = HUMAN_SITES.map((s) => `'${s}'`).join(', ');

/** Minimum half hours with a value for a daily value. */
const MIN_HALF_HOURS = 40;
/** Half hours with ta below this value are removed (finding SAR-03). */
const TA_SPIKE_LIMIT = -35;
const HUMAN_WINDOW = { before: 2, after: 14 };
const FROST = { belowC: 0 };
const HEAT = { finlandC: 25, maktauC: 33, waveDays: 3 };
const HEAVY_RAIN_MM = 20;
const DRY_SPELL = { days: 10, mmPerDay: 1, from: '05-01', to: '09-30' };
const FROST_SEASON = { from: '05-01', to: '09-30' };
const FAILED_RAINS = {
  seasons: [
    { id: 'MAM', months: [3, 4, 5] },
    { id: 'SON', months: [9, 10, 11] },
  ],
  minSeasonDays: 70,
  /** The season mean swc must be below this quantile of the season means of the site (the median). */
  swcQuantile: 0.5,
};
const COLD_SPELL_C = -10;
const SOIL = { p10: 0.1, p90: 0.9, tsoilMinC: 0.5, tsoilSites: ['haltiala', 'qvidja', 'viikki'] };
const ZERO_CURTAIN = { bandC: 0.3, days: 5 };
const MAKTAU_FLUX_YEARS = { from: 2019, to: 2024 };
/** Minimum event days with NEE for a class summary of one site. */
const MIN_DAYS = 5;
const POINTS_PER_SITE = 1200;

type Pair = 'ta' | 'swc';

interface PairStats {
  n: number;
  meanX: number | null;
  meanY: number | null;
  varX: number | null;
  varY: number | null;
  r: number | null;
  slope: number | null;
  intercept: number | null;
  r2: number | null;
}

export async function run(conn: DuckDBConnection): Promise<Record<string, unknown>> {
  // ---------- Sites ----------
  const siteRows = await rows(
    conn,
    `SELECT site_id, code, name, utc_offset_min, country, row_number() OVER (ORDER BY site_id) - 1 AS slot FROM 'db/sites.parquet' ORDER BY site_id`,
  );
  const SITES = siteRows.map((r) => str(r.code));
  const tsoilSites = SOIL.tsoilSites.map((s) => `'${s}'`).join(', ');

  // ---------- Daily values per local day ----------
  await conn.run(`
    CREATE OR REPLACE TEMP TABLE ne_day AS
    WITH obs AS (
      SELECT s.code AS site_code, CAST(o.ts_start + to_minutes(s.utc_offset_min) AS DATE) AS d,
             CASE WHEN o.ta >= ${TA_SPIKE_LIMIT} THEN o.ta END AS ta, o.precip, o.swc, o.tsoil
      FROM 'db/observations.parquet' o JOIN 'db/sites.parquet' s USING (site_id)
    ),
    daily AS (
      SELECT site_code, d,
             avg(ta) AS ta_mean, min(ta) AS ta_min, max(ta) AS ta_max, count(ta) AS n_ta,
             sum(precip) AS precip, count(precip) AS n_precip,
             avg(swc) AS swc, count(swc) AS n_swc, avg(tsoil) AS tsoil, count(tsoil) AS n_tsoil
      FROM obs GROUP BY ALL
    ),
    valid AS (
      SELECT site_code, d,
             CASE WHEN n_ta >= ${MIN_HALF_HOURS} THEN ta_mean END AS ta_mean,
             CASE WHEN n_ta >= ${MIN_HALF_HOURS} THEN ta_min END AS ta_min,
             CASE WHEN n_ta >= ${MIN_HALF_HOURS} THEN ta_max END AS ta_max,
             CASE WHEN n_precip >= ${MIN_HALF_HOURS} THEN precip END AS precip,
             CASE WHEN n_swc >= ${MIN_HALF_HOURS} THEN swc END AS swc,
             CASE WHEN n_tsoil >= ${MIN_HALF_HOURS} THEN tsoil END AS tsoil
      FROM daily
    ),
    flux AS (
      SELECT site_code, date_local AS d, CASE WHEN n_nee_f >= ${MIN_HALF_HOURS} THEN nee_f_gc END AS nee
      FROM 'data/calculated/daily.parquet'
    ),
    human AS (
      SELECT DISTINCT site_code,
             CAST(unnest(generate_series(date - INTERVAL ${HUMAN_WINDOW.before} DAY, coalesce(date_end, date) + INTERVAL ${HUMAN_WINDOW.after} DAY, INTERVAL 1 DAY)) AS DATE) AS d
      FROM 'db/events.parquet' WHERE site_code IN (${humanSiteList})
    )
    SELECT v.*, f.nee, h.d IS NOT NULL AS human,
           CASE WHEN v.site_code IN (${tsoilSites}) AND (v.tsoil IS NULL OR v.tsoil <= ${SOIL.tsoilMinC}) THEN NULL ELSE v.swc END AS swc_ok
    FROM valid v LEFT JOIN flux f USING (site_code, d) LEFT JOIN human h USING (site_code, d)
    WHERE NOT (v.site_code = 'maktau' AND year(v.d) NOT BETWEEN ${MAKTAU_FLUX_YEARS.from} AND ${MAKTAU_FLUX_YEARS.to})
  `);
  // Percent rank and p10 / p90 of swc over the used days of each site.
  await conn.run(`
    CREATE OR REPLACE TEMP TABLE ne_used AS
    SELECT n.*, p.swc_pct
    FROM ne_day n LEFT JOIN (
      SELECT site_code, d, percent_rank() OVER (PARTITION BY site_code ORDER BY swc_ok) * 100 AS swc_pct
      FROM ne_day WHERE NOT human AND swc_ok IS NOT NULL
    ) p USING (site_code, d)
  `);
  const qRows = await rows(
    conn,
    `SELECT site_code, quantile_cont(swc_ok, ${SOIL.p10}) AS p10, quantile_cont(swc_ok, ${SOIL.p90}) AS p90
     FROM ne_day WHERE NOT human AND swc_ok IS NOT NULL GROUP BY site_code`,
  );
  const swcQ = new Map(qRows.map((r) => [str(r.site_code), { p10: num(r.p10), p90: num(r.p90) }]));
  const dRows = await rows(
    conn,
    `SELECT site_code, CAST(d AS VARCHAR) AS d, ta_mean, ta_min, ta_max, precip, swc_ok, swc_pct, tsoil, nee, human
     FROM ne_used ORDER BY site_code, d`,
  );

  // Check of the SQL mask with the TS helper.
  const evRows = await rows(
    conn,
    `SELECT site_code, CAST(date AS VARCHAR) AS date, CAST(date_end AS VARCHAR) AS date_end FROM 'db/events.parquet' WHERE site_code IN (${humanSiteList})`,
  );
  const mask = eventDayMask(
    evRows.map((r) => ({ site: str(r.site_code), date: str(r.date), dateEnd: r.date_end === null ? null : str(r.date_end) })),
    HUMAN_WINDOW.before,
    HUMAN_WINDOW.after,
  );
  const nEvents = new Map<string, number>();
  for (const r of evRows) nEvents.set(str(r.site_code), (nEvents.get(str(r.site_code)) ?? 0) + 1);

  const bySite = new Map<string, DayRow[]>(SITES.map((s) => [s, []]));
  for (const r of dRows) {
    const site = str(r.site_code);
    const iso = str(r.d);
    const day = dayNumber(iso);
    const human = r.human === true;
    if (human !== (mask.get(site)?.has(day) ?? false)) throw new Error(`human mask: SQL and TS do not agree at ${site} ${iso}`);
    bySite.get(site)!.push({
      day,
      iso,
      taMean: numOrNull(r.ta_mean),
      taMin: numOrNull(r.ta_min),
      taMax: numOrNull(r.ta_max),
      precip: numOrNull(r.precip),
      swc: human ? null : numOrNull(r.swc_ok),
      swcPct: human ? null : numOrNull(r.swc_pct),
      tsoil: numOrNull(r.tsoil),
      nee: numOrNull(r.nee),
      used: !human,
    });
  }

  // ---------- Detection per site ----------
  const month = (md: string) => Number(md.slice(0, 2));
  const sitesOut: Record<string, unknown> = {};
  const counts: Record<string, Record<string, { days: number; allDays: number; episodes: number }>> = {};
  const eventsOut: Record<string, ClassEpisode[]> = {};
  const flagsBySite = new Map<string, Map<number, Set<ClassId>>>();
  const seasonsOut: Record<string, RainSeason[]> = {};
  for (const r of siteRows) {
    const site = str(r.code);
    const list = bySite.get(site)!;
    const ke = str(r.country) === 'KE';
    const q = swcQ.get(site) ?? null;
    const opts: DetectOptions = {
      country: ke ? 'KE' : 'FI',
      heatC: ke ? HEAT.maktauC : HEAT.finlandC,
      heatWaveDays: HEAT.waveDays,
      frostC: FROST.belowC,
      seasonFrom: month(FROST_SEASON.from),
      seasonTo: month(FROST_SEASON.to),
      heavyRainMm: HEAVY_RAIN_MM,
      drySpellDays: DRY_SPELL.days,
      drySpellMm: DRY_SPELL.mmPerDay,
      coldSpellC: COLD_SPELL_C,
      swcP10: q?.p10 ?? null,
      swcP90: q?.p90 ?? null,
      zeroCurtainBandC: ZERO_CURTAIN.bandC,
      zeroCurtainDays: ZERO_CURTAIN.days,
      failedRainSeasons: FAILED_RAINS.seasons,
      minSeasonDays: FAILED_RAINS.minSeasonDays,
      swcQuantile: FAILED_RAINS.swcQuantile,
    };
    const det = detectClasses(list, opts);
    flagsBySite.set(site, det.flags);
    eventsOut[site] = det.episodes;
    if (ke) seasonsOut[site] = det.seasons;
    const used = list.filter((d) => d.used);
    counts[site] = Object.fromEntries(
      CLASSES.map((c) => {
        const all = list.filter((d) => det.flags.get(d.day)?.has(c));
        return [c, { days: all.filter((d) => d.used).length, allDays: all.length, episodes: det.episodes.filter((e) => e.class === c).length }];
      }),
    );
    const years = [...new Set(list.map((d) => Number(d.iso.slice(0, 4))))].sort();
    sitesOut[site] = {
      name: str(r.name),
      siteId: num(r.site_id),
      slot: num(r.slot),
      utcOffsetMin: num(r.utc_offset_min),
      years,
      hasPrecip: list.some((d) => d.precip !== null),
      hasEvents: (nEvents.get(site) ?? 0) > 0,
      nEvents: nEvents.get(site) ?? 0,
      heatLimitC: opts.heatC,
      swcP10: q?.p10 ?? null,
      swcP90: q?.p90 ?? null,
      days: {
        total: list.length,
        human: list.length - used.length,
        used: used.length,
        ta: used.filter((d) => d.taMean !== null).length,
        swc: used.filter((d) => d.swc !== null).length,
        precip: used.filter((d) => d.precip !== null).length,
        nee: used.filter((d) => d.nee !== null).length,
      },
    };
  }
  const classesOf = (site: string, day: number): Set<ClassId> => flagsBySite.get(site)!.get(day) ?? new Set();

  // ---------- Event days against reference days of the same months ----------
  const classesOut: Record<string, Record<string, { event: Summary; reference: Summary; diff: number | null }>> = {};
  CLASSES.forEach((c, ci) => {
    const perSite: Record<string, { event: Summary; reference: Summary; diff: number | null }> = {};
    SITES.forEach((site, si) => {
      const used = bySite.get(site)!.filter((d) => d.used && d.nee !== null);
      const ev = used.filter((d) => classesOf(site, d.day).has(c));
      if (ev.length < MIN_DAYS) return;
      const months = new Set(ev.map((d) => d.iso.slice(5, 7)));
      const ref = used.filter((d) => !classesOf(site, d.day).has(c) && months.has(d.iso.slice(5, 7)));
      const seed = 1000 + 100 * ci + 10 * si;
      const event = summarise(ev.map((d) => d.nee), seed);
      const reference = summarise(ref.map((d) => d.nee), seed + 1);
      perSite[site] = { event, reference, diff: event.mean === null || reference.mean === null ? null : event.mean - reference.mean };
    });
    if (Object.keys(perSite).length) classesOut[c] = perSite;
  });

  // ---------- Pooled period years ----------
  const pool: PoolRow[] = [];
  for (const site of SITES)
    for (const d of bySite.get(site)!) if (d.used) pool.push({ site, iso: d.iso, nee: d.nee, classes: classesOf(site, d.day) });
  const periodYears = poolByPeriod(pool);

  // ---------- Anscombe statistics and points ----------
  await conn.run(`CREATE OR REPLACE TEMP TABLE ne_pairs AS SELECT site_code, d, ta_mean, swc_pct, nee FROM ne_used WHERE NOT human AND nee IS NOT NULL`);
  const pairStats = async (x: string): Promise<Record<string, PairStats>> => {
    const r = await rows(
      conn,
      `SELECT site_code,
              count(nee) FILTER (WHERE ${x} IS NOT NULL)::DOUBLE AS n,
              (avg(${x}) FILTER (WHERE nee IS NOT NULL))::DOUBLE AS mx,
              (avg(nee) FILTER (WHERE ${x} IS NOT NULL))::DOUBLE AS my,
              (var_samp(${x}) FILTER (WHERE nee IS NOT NULL))::DOUBLE AS vx,
              (var_samp(nee) FILTER (WHERE ${x} IS NOT NULL))::DOUBLE AS vy,
              corr(nee, ${x})::DOUBLE AS r, regr_slope(nee, ${x})::DOUBLE AS b,
              regr_intercept(nee, ${x})::DOUBLE AS a, regr_r2(nee, ${x})::DOUBLE AS r2
       FROM ne_pairs GROUP BY site_code ORDER BY site_code`,
    );
    const out: Record<string, PairStats> = {};
    for (const site of SITES) {
      const s = r.find((x) => str(x.site_code) === site);
      if (!s || num(s.n) === 0) continue;
      out[site] = {
        n: num(s.n),
        meanX: numOrNull(s.mx),
        meanY: numOrNull(s.my),
        varX: numOrNull(s.vx),
        varY: numOrNull(s.vy),
        r: numOrNull(s.r),
        slope: numOrNull(s.b),
        intercept: numOrNull(s.a),
        r2: numOrNull(s.r2),
      };
    }
    return out;
  };
  const anscombe: Record<Pair, Record<string, PairStats>> = { ta: await pairStats('ta_mean'), swc: await pairStats('swc_pct') };
  // Per period year, all sites together. The winter is keyed by the December year (periodKey()).
  const keyExpr = `(CASE WHEN month(d) <= 2 THEN year(d) - 1 ELSE year(d) END)::VARCHAR || '-' ||
    CASE WHEN month(d) IN (3, 4, 5) THEN 'MAM' WHEN month(d) IN (6, 7, 8) THEN 'JJA' WHEN month(d) IN (9, 10, 11) THEN 'SON' ELSE 'DJF' END`;
  const tpRows = await rows(
    conn,
    `SELECT ${keyExpr} AS k,
            count(*)::DOUBLE AS n, count(DISTINCT site_code)::DOUBLE AS ns,
            avg(ta_mean)::DOUBLE AS mx, avg(nee)::DOUBLE AS my,
            var_samp(ta_mean)::DOUBLE AS vx, var_samp(nee)::DOUBLE AS vy,
            corr(nee, ta_mean)::DOUBLE AS r, regr_slope(nee, ta_mean)::DOUBLE AS b,
            regr_intercept(nee, ta_mean)::DOUBLE AS a, regr_r2(nee, ta_mean)::DOUBLE AS r2
     FROM ne_pairs WHERE ta_mean IS NOT NULL GROUP BY k`,
  );
  const tpByKey = new Map(tpRows.map((r) => [str(r.k), r]));
  const keyYears = tpRows.map((r) => Number(str(r.k).slice(0, 4)));
  const periodOrder = PERIODS.map((p) => p.id) as PeriodId[];
  const taPeriods: { key: string; period: PeriodId; year: number; label: string; n: number; sitesWithData: number; stats: PairStats }[] = [];
  for (let yr = Math.min(...keyYears); yr <= Math.max(...keyYears); yr++)
    for (const period of periodOrder) {
      const key = `${yr}-${period}`;
      const r = tpByKey.get(key);
      const n = r ? num(r.n) : 0;
      taPeriods.push({
        key,
        period,
        year: yr,
        label: periodLabelDec(period, yr),
        n,
        sitesWithData: r ? num(r.ns) : 0,
        stats: {
          n,
          meanX: r ? numOrNull(r.mx) : null,
          meanY: r ? numOrNull(r.my) : null,
          varX: r ? numOrNull(r.vx) : null,
          varY: r ? numOrNull(r.vy) : null,
          r: r ? numOrNull(r.r) : null,
          slope: r ? numOrNull(r.b) : null,
          intercept: r ? numOrNull(r.a) : null,
          r2: r ? numOrNull(r.r2) : null,
        },
      });
    }
  const periodKeys = taPeriods.map((t) => t.key);
  const points: Record<string, { n: number; x: (number | null)[]; s: (number | null)[]; y: number[]; f: number[]; p: number[] }> = {};
  for (const site of SITES) {
    const nAll = num((await rows(conn, `SELECT count(*) AS n FROM ne_pairs WHERE site_code = '${site}'`))[0]!.n);
    if (nAll === 0) continue;
    const p = await rows(
      conn,
      `SELECT CAST(d AS VARCHAR) AS d, round(ta_mean, 2) AS x, round(swc_pct, 1) AS s, round(nee, 3) AS y
       FROM (SELECT * FROM ne_pairs WHERE site_code = '${site}') USING SAMPLE reservoir(${POINTS_PER_SITE} ROWS) REPEATABLE (1)
       ORDER BY d`,
    );
    points[site] = {
      n: nAll,
      x: p.map((r) => numOrNull(r.x)),
      s: p.map((r) => numOrNull(r.s)),
      y: p.map((r) => num(r.y)),
      f: p.map((r) => classMask(classesOf(site, dayNumber(str(r.d))))),
      p: p.map((r) => {
        const i = periodKeys.indexOf(periodKey(str(r.d)));
        if (i < 0) throw new Error(`no period key for ${site} ${str(r.d)}`);
        return i;
      }),
    };
  }

  return {
    question:
      'Which natural events occur at the six sites, and how is the daily NEE on these days different from the NEE on other days of the same months?',
    method: {
      minHalfHours: MIN_HALF_HOURS,
      halfHoursPerDay: 48,
      taSpikeLimit: TA_SPIKE_LIMIT,
      humanWindow: HUMAN_WINDOW,
      frost: { belowC: FROST.belowC, from: FROST_SEASON.from, to: FROST_SEASON.to },
      heat: HEAT,
      heavyRainMm: HEAVY_RAIN_MM,
      drySpell: DRY_SPELL,
      failedRains: FAILED_RAINS,
      coldSpellC: COLD_SPELL_C,
      soil: SOIL,
      zeroCurtain: ZERO_CURTAIN,
      maktauFluxYears: MAKTAU_FLUX_YEARS,
      periods: PERIODS.map((p) => ({ id: p.id, name: p.name, months: [...p.months] })),
      classes: [...CLASSES],
      minDays: MIN_DAYS,
      pointsPerSite: POINTS_PER_SITE,
      periodKey: 'The per-period figure (anscombe.taPeriods) keys the winter (DJF) by the December year.',
      utcShiftHours: 2,
      utcShiftHalfHours: 4,
      units: { nee: 'g C m-2 d-1', ta: '°C', precip: 'mm d-1', swc: 'm3 m-3', swcPct: '%', tsoil: '°C' },
    },
    sites: sitesOut,
    counts,
    events: eventsOut,
    rainSeasons: seasonsOut,
    classes: classesOut,
    periods: { years: periodYears },
    anscombe: { ...anscombe, points, periodKeys, taPeriods },
    literature: {},
    totals: {
      usedDays: SITES.reduce((a, s) => a + bySite.get(s)!.filter((d) => d.used).length, 0),
      usedNeeDays: SITES.reduce((a, s) => a + bySite.get(s)!.filter((d) => d.used && d.nee !== null).length, 0),
      eventDaysNee: SITES.reduce((a, s) => a + bySite.get(s)!.filter((d) => d.used && d.nee !== null && classesOf(s, d.day).size > 0).length, 0),
      episodes: Object.values(eventsOut).reduce((a, l) => a + l.length, 0),
    },
  };
}
