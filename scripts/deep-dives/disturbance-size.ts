// Deep Dive "Size of management disturbances" (site/src/pages/deep-dive/disturbance-size.mdx).
// Question: how large is the change of NEE, GPP, Reco and soil water content in the days and weeks
// after a harvest or cut, grazing, fertilisation or tillage?
//
// Inputs (read only): db/events.parquet, db/sites.parquet, db/observations.parquet,
// data/calculated/daily.parquet and data/calculated/fluxes_30min.parquet. Output: the result object;
// scripts/deep-dives.ts writes it to site/src/deep-dives/disturbance-size.json. Run: npm run deep-dives.
//
// Method:
// 1. Events of the classes harvest-cut, grazing, fertilisation and tillage (db/events.parquet).
//    Events of one site that are not more than MERGE_DAYS apart make one episode, whatever their
//    class. The class set of the episode gives its kind (for example "harvest or cut + fertilisation").
// 2. Daily values: gap-filled NEE, GPP and Reco (g C m-2 d-1) from data/calculated/daily.parquet;
//    daily mean soil water content (swc, m3 m-3), soil temperature and the daily rain sum from
//    db/observations.parquet, per local day. Haltiala has no rain: the Viikki rain of the same day is
//    the proxy. Soil water of frozen days (daily mean tsoil <= 0 °C) and of Haltiala 2021 (finding
//    HAL-03) is not used.
// 3. Windows before the first day and after the last day of the episode (as the first dive).
//    Change = mean after − mean before. Seasonal baseline: the same change in the other years of
//    the site without an episode in the shifted period; adjusted change = change − baseline.
//    Excess = sum over the 28 days after the episode of (daily flux − mean before), in g C m-2.
//    Relative change in percent for after windows of 7, 14 and 21 days: GPP and Reco as percent of
//    their own mean before, NEE as percent of the mean GPP of the 30 days before the first day.
// 4. Rules: no other episode starts in the windows; enough days with a value; for the fluxes a
//    minimum measured fraction of NEE. The soil water result has its own day rule and a rain check.
// 5. Per kind (and per kind and site): n, mean, SD, bootstrap 95 % CI.

import type { DuckDBConnection } from '@duckdb/node-api';
import { CONST } from '../lib/calc/constants.ts';
import { num, numOrNull, rows, str } from '../lib/duck.ts';
import {
  changes,
  excessSum,
  KINDS,
  MERGE_DAYS,
  mergeClassEpisodes,
  seasonalBaseline,
  toClassEvent,
  windowMeans,
  windowSum,
  type ClassEpisode,
  type ClassEvent,
  type KindId,
  type VarRow,
  type WindowMeans,
} from '../lib/deep-dive/disturbance.ts';
import { isoDay, type Window } from '../lib/deep-dive/harvest.ts';
import { finite, mean, ols, pearson, pearsonP, sd, summarise, type Summary } from '../lib/deep-dive/stats.ts';

export const slug = 'disturbance-size';
export const title = 'Size of management disturbances';

export const inputs = [
  'db/events.parquet',
  'db/sites.parquet',
  'db/observations.parquet',
  'data/calculated/daily.parquet',
  'data/calculated/fluxes_30min.parquet',
] as const;

/** Sites with dated management events. */
const SITES = ['haltiala', 'qvidja', 'viikki'] as const;
type SiteCode = (typeof SITES)[number];

const BEFORE: Window = { from: -14, to: -1 };
const AFTER: Window = { from: 1, to: 14 };
const LATE: Window = { from: 15, to: 28 };
/** Window of the integrated excess after the last day of the episode. */
const EXCESS: Window = { from: 1, to: 28 };
/** Short windows of the sensitivity run. */
const BEFORE7: Window = { from: -7, to: -1 };
const AFTER7: Window = { from: 1, to: 7 };
/** Days of the composite curves, relative to the first day of the episode. */
const COMPOSITE: Window = { from: -14, to: 28 };

/** Minimum days with a value in the before and the after window (14 days each). */
const MIN_DAYS = 12;
const MIN_DAYS_7 = 6;
/** Minimum days with a value in the 28-day excess window. */
const MIN_EXCESS_DAYS = 25;
/** Minimum mean measured fraction of NEE in both windows (flux result). */
const MIN_FRAC = 0.1;
/** Minimum half hours with a value for a daily mean of swc and tsoil, and for a daily rain sum. */
const MIN_SWC_ROWS = 36;
const MIN_RAIN_ROWS = 44;
/** Rain-balanced episode: the rain sums of the two windows differ by not more than this (mm). */
const RAIN_BALANCE_MM = 20;
/** Minimum other years for a seasonal baseline. */
const MIN_BASELINE_YEARS = 2;
/** Minimum GPP before the episode for a relative change of GPP (g C m-2 d-1). */
const MIN_GPP_BEFORE = 0.5;
/** After windows of the relative change (days 1 to n after the last day of the episode). */
const RELATIVE_AFTER_DAYS = [7, 14, 21] as const;
/** Reference of the relative change of NEE: mean GPP of the 30 days before the first day of the episode. */
const GPP_REF: Window = { from: -30, to: -1 };
const MIN_GPP_REF_DAYS = 24;
/** Minimum reference flux of a relative change (g C m-2 d-1). */
const MIN_REF_FLUX = MIN_GPP_BEFORE;
/** Minimum days with a value in an after window of `n` days: the same share as MIN_DAYS of the 14-day window. */
const minRelativeDays = (n: number): number => Math.ceil((n * MIN_DAYS) / (AFTER.to - AFTER.from + 1));
const relativeKey = (n: number): string => `d${n}`;
/** Minimum measured half hours in each window for the check without gap filling (day-time). */
const MIN_MEASURED_DAY = 20;
const BOOTSTRAP_RESAMPLES = 10_000;
/** Episodes that the article discusses one by one (by id = site and first day). */
const HIGHLIGHT_IDS = ['qvidja-2018-06-12', 'haltiala-2023-08-01', 'viikki-2023-04-27', 'qvidja-2025-07-30'] as const;
/**
 * Heimsch et al. 2021, Table C1 (PDF p. 7 and appendix): the June 2018 harvest at Qvidja changed the
 * 5-day mean NEE from -0.28 to +0.03 mg CO2 m-2 s-1. Converted to g C m-2 d-1 for the comparison.
 */
const HEIMSCH_2021 = { windowDays: 5, june2018: { beforeMgCo2: -0.28, afterMgCo2: 0.03 } };
const MG_CO2_S_TO_G_C_D = (1e-3 * 12.011 * 86_400) / 44.009;
/** Haltiala soil water of this year is 0.06 to 0.10 too high (finding HAL-03): not used. */
const HALTIALA_SWC_SKIP_YEAR = 2021;

type Flux = 'nee' | 'gpp' | 'reco';
const FLUXES: readonly Flux[] = ['nee', 'gpp', 'reco'];
/** Variables of the window means. `rain` is a sum (windowSum). */
const MEAN_VARS = ['nee', 'gpp', 'reco', 'frac', 'ta', 'tsoil', 'swc'] as const;
type MeanVar = (typeof MEAN_VARS)[number];
const BASELINE_VARS = ['nee', 'gpp', 'reco', 'swc', 'ta'] as const;

const SUMMARY_KINDS = KINDS.filter((k) => k.id !== 'other').map((k) => k.id);

interface WindowJson {
  nDays: Record<string, number>;
  mean: Record<string, number | null>;
  rain: number | null;
  rainDays: number;
}

function windowJson(m: WindowMeans, rain: { n: number; sum: number | null }): WindowJson {
  return { nDays: m.n, mean: m.mean, rain: rain.sum, rainDays: rain.n };
}

type FluxExclusion = 'overlap' | 'too-few-days' | 'low-measured-fraction' | null;
type SwcExclusion = 'overlap' | 'too-few-days' | null;

interface EpisodeResult {
  id: string;
  site: SiteCode;
  kind: KindId;
  classes: string[];
  fert: string | null;
  start: string;
  end: string;
  lengthDays: number;
  /** Number of days of the episode, both ends included. */
  durationDays: number;
  events: { date: string; dateEnd: string | null; type: string; crop: string | null; detail: string; dryMassKgHa: number | null; nKgHa: number | null }[];
  crop: string | null;
  /** Sum of the N inputs of the fertilisation events (kg N/ha), or null. */
  nKgHa: number | null;
  /** Sum of the harvest dry masses (kg DW/ha), or null. */
  dryMassKgHa: number | null;
  before: WindowJson;
  after: WindowJson;
  late: WindowJson | null;
  /** Change after − before per variable (null when a window has too few days). */
  delta: Record<string, number | null>;
  deltaLate: Record<string, number | null> | null;
  /** Change with the 7-day windows. */
  delta7: Record<string, number | null>;
  /** Relative change of GPP (fraction of the mean before). */
  relGpp: number | null;
  /** Mean GPP of the GPP_REF window before the first day (reference of the relative change of NEE). */
  gppRef: { mean: number | null; nDays: number };
  /**
   * Relative change in percent per after window (key d7, d14, d21): GPP and Reco as percent of their
   * own mean before, NEE as percent of `gppRef`. Null when a rule fails (reference too small or with too
   * few days, too few days in the after window, or another episode starts in the after window).
   */
  relative: Record<string, Record<Flux, number | null>>;
  /** Seasonal baseline (other years of the site without an episode) and the adjusted change. */
  baseline: { years: number[]; n: Record<string, number>; mean: Record<string, number | null> };
  deltaAdj: Record<string, number | null>;
  /** Integrated excess of the fluxes over the 28 days after the episode (g C m-2). */
  excess: Record<Flux, number | null>;
  /** Rain in the windows: after − before (mm), and whether the episode is rain-balanced. */
  rainDiff: number | null;
  rainBalanced: boolean;
  rainSource: 'own' | 'viikki-proxy';
  fluxUsed: boolean;
  fluxExclusion: FluxExclusion;
  swcUsed: boolean;
  swcExclusion: SwcExclusion;
  /** Measured day-time NEE (µmol m-2 s-1): change after − before, or null. */
  measuredDay: { before: number | null; after: number | null; delta: number | null };
  /** Other management events (also sowing, spraying, other) from the start of the before window to the end of the late window. */
  otherEvents: { date: string; type: string; detail: string }[];
}

/** Bootstrap summaries of one group of episodes. */
function groupSummary(eps: readonly EpisodeResult[], seed: number) {
  const flux = eps.filter((e) => e.fluxUsed);
  const swc = eps.filter((e) => e.swcUsed);
  const swcBal = swc.filter((e) => e.rainBalanced);
  const pick = (list: readonly EpisodeResult[], f: (e: EpisodeResult) => number | null | undefined, s: number): Summary => summarise(list.map(f), s);
  const fluxVar = (v: Flux, s: number) => ({
    delta: pick(flux, (e) => e.delta[v], s),
    deltaAdj: pick(flux, (e) => e.deltaAdj[v], s + 1),
    deltaLate: pick(flux, (e) => e.deltaLate?.[v], s + 2),
    delta7: pick(flux, (e) => e.delta7[v], s + 3),
    excess: pick(flux, (e) => e.excess[v], s + 4),
    before: mean(finite(flux.map((e) => e.before.mean[v]))),
    after: mean(finite(flux.map((e) => e.after.mean[v]))),
  });
  // Soil water change against the rain difference: the intercept is the change at equal rain.
  const xs = swc.filter((e) => e.rainDiff !== null && e.delta.swc !== null);
  const fit = ols(xs.map((e) => e.rainDiff!), xs.map((e) => e.delta.swc!));
  const r = xs.length >= 3 ? pearson(xs.map((e) => e.rainDiff!), xs.map((e) => e.delta.swc!)) : null;
  return {
    n: eps.length,
    nFlux: flux.length,
    nSwc: swc.length,
    sites: Object.fromEntries(SITES.map((s) => [s, eps.filter((e) => e.site === s).length])),
    nee: fluxVar('nee', seed),
    gpp: fluxVar('gpp', seed + 10),
    reco: fluxVar('reco', seed + 20),
    relGppPct: summarise(flux.map((e) => (e.relGpp === null ? null : e.relGpp * 100)), seed + 30),
    relative: Object.fromEntries(
      RELATIVE_AFTER_DAYS.map((n, i) => [
        relativeKey(n),
        Object.fromEntries(FLUXES.map((f, j) => [f, pick(flux, (e) => e.relative[relativeKey(n)]?.[f], seed + 50 + 3 * i + j)])) as Record<Flux, Summary>,
      ]),
    ),
    ta: pick(flux, (e) => e.delta.ta, seed + 31),
    tsoil: pick(flux, (e) => e.delta.tsoil, seed + 32),
    measuredDay: pick(flux, (e) => e.measuredDay.delta, seed + 33),
    nBaseline: flux.filter((e) => e.deltaAdj.nee !== null).length,
    swc: {
      delta: pick(swc, (e) => e.delta.swc, seed + 40),
      deltaAdj: pick(swc, (e) => e.deltaAdj.swc, seed + 41),
      deltaLate: pick(swc, (e) => e.deltaLate?.swc, seed + 42),
      nRainBalanced: swcBal.length,
      deltaRainBalanced: pick(swcBal, (e) => e.delta.swc, seed + 43),
      rainDiff: pick(swc, (e) => e.rainDiff, seed + 44),
      rainFit: { n: xs.length, slope: fit?.slope ?? null, intercept: fit?.intercept ?? null, r, p: r === null ? null : pearsonP(r, xs.length) },
      before: mean(finite(swc.map((e) => e.before.mean.swc))),
      after: mean(finite(swc.map((e) => e.after.mean.swc))),
    },
  };
}

const dayOf = (iso: string): number => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** True when no other episode of the site starts in the days `end + w.from` to `end + w.to`. */
const startsFree = (ep: ClassEpisode, all: readonly ClassEpisode[], w: Window): boolean =>
  !all.some((o) => o !== ep && o.site === ep.site && o.start >= ep.end + w.from && o.start <= ep.end + w.to);

export async function run(conn: DuckDBConnection): Promise<Record<string, unknown>> {
  const siteList = SITES.map((s) => `'${s}'`).join(', ');

  // ---------- Sites ----------
  const siteRows = await rows(
    conn,
    `SELECT * FROM (SELECT site_id, code, name, utc_offset_min, row_number() OVER (ORDER BY site_id) - 1 AS slot FROM 'db/sites.parquet')
     WHERE code IN (${siteList}) ORDER BY site_id`,
  );
  if (siteRows.length !== SITES.length) throw new Error(`expected ${SITES.length} sites in db/sites.parquet, got ${siteRows.length}`);
  const siteSlot = new Map(siteRows.map((r) => [str(r.code), num(r.slot)]));
  const siteName = new Map(siteRows.map((r) => [str(r.code), str(r.name)]));
  const siteId = new Map(siteRows.map((r) => [str(r.code), num(r.site_id)]));

  // ---------- Events ----------
  const evRows = await rows(
    conn,
    `SELECT site_code, CAST(date AS VARCHAR) AS date, CAST(date_end AS VARCHAR) AS date_end, type, crop, detail, dry_mass_kg_ha, n_kg_ha
     FROM 'db/events.parquet' WHERE site_code IN (${siteList}) ORDER BY site_code, date, type`,
  );
  const allEvents: ClassEvent[] = evRows.map((r) =>
    toClassEvent({
      site: str(r.site_code),
      date: str(r.date),
      dateEnd: r.date_end === null ? null : str(r.date_end),
      type: str(r.type),
      crop: r.crop === null ? null : str(r.crop),
      detail: str(r.detail ?? ''),
      dryMassKgHa: numOrNull(r.dry_mass_kg_ha),
      nKgHa: numOrNull(r.n_kg_ha),
    }),
  );
  const classEvents = allEvents.filter((e) => e.cls !== null);
  const episodes = mergeClassEpisodes(classEvents);

  // ---------- Daily fluxes ----------
  const daily = new Map<string, Map<number, VarRow>>(SITES.map((s) => [s, new Map()]));
  const years = new Map<string, Set<number>>(SITES.map((s) => [s, new Set()]));
  const dRows = await rows(
    conn,
    `SELECT site_code, CAST(date_local AS VARCHAR) AS d, nee_f_gc, gpp_gc, reco_gc, frac_measured, ta_mean
     FROM 'data/calculated/daily.parquet' WHERE site_code IN (${siteList})`,
  );
  for (const r of dRows) {
    const site = str(r.site_code);
    const day = dayOf(str(r.d));
    years.get(site)!.add(Number(str(r.d).slice(0, 4)));
    daily.get(site)!.set(day, {
      nee: numOrNull(r.nee_f_gc),
      gpp: numOrNull(r.gpp_gc),
      reco: numOrNull(r.reco_gc),
      frac: numOrNull(r.frac_measured),
      ta: numOrNull(r.ta_mean),
      tsoil: null,
      swc: null,
      rain: null,
    });
  }

  // ---------- Daily soil water, soil temperature and rain (local day of the site) ----------
  const oRows = await rows(
    conn,
    `SELECT s.code AS site_code, CAST(CAST(o.ts_start + to_minutes(s.utc_offset_min) AS DATE) AS VARCHAR) AS d,
            avg(o.swc) AS swc, count(o.swc) AS n_swc, avg(o.tsoil) AS tsoil, count(o.tsoil) AS n_tsoil,
            sum(o.precip) AS rain, count(o.precip) AS n_rain
     FROM 'db/observations.parquet' o JOIN 'db/sites.parquet' s USING (site_id)
     WHERE s.code IN (${siteList}) GROUP BY ALL`,
  );
  const rainByDay = new Map<string, Map<number, number>>(SITES.map((s) => [s, new Map()]));
  let frozenDays = 0;
  let swcDaysTotal = 0;
  for (const r of oRows) {
    const site = str(r.site_code);
    const day = dayOf(str(r.d));
    const row = daily.get(site)!.get(day) ?? { nee: null, gpp: null, reco: null, frac: null, ta: null, tsoil: null, swc: null, rain: null };
    const tsoil = num(r.n_tsoil) >= MIN_SWC_ROWS ? numOrNull(r.tsoil) : null;
    let swc = num(r.n_swc) >= MIN_SWC_ROWS ? numOrNull(r.swc) : null;
    if (swc !== null) swcDaysTotal++;
    // Frozen soil: the sensors do not give the liquid water content (finding QVI-16).
    if (swc !== null && tsoil !== null && tsoil <= 0) {
      swc = null;
      frozenDays++;
    }
    if (site === 'haltiala' && str(r.d).startsWith(String(HALTIALA_SWC_SKIP_YEAR))) swc = null;
    const rain = num(r.n_rain) >= MIN_RAIN_ROWS ? numOrNull(r.rain) : null;
    if (rain !== null) rainByDay.get(site)!.set(day, rain);
    daily.get(site)!.set(day, { ...row, tsoil, swc, rain });
  }
  // Haltiala has no rain: the Viikki rain of the same local day is the proxy (about 5 km apart).
  const rainSource: Record<SiteCode, 'own' | 'viikki-proxy'> = { haltiala: 'viikki-proxy', qvidja: 'own', viikki: 'own' };
  const viikkiRain = rainByDay.get('viikki')!;
  for (const [day, row] of daily.get('haltiala')!) daily.get('haltiala')!.set(day, { ...row, rain: viikkiRain.get(day) ?? null });

  // ---------- Measured day-time NEE per local day (check without gap filling) ----------
  const mRows = await rows(
    conn,
    `SELECT site_code, CAST(CAST(tl AS DATE) AS VARCHAR) AS d, sum(nee) AS s, count(nee) AS n
     FROM 'data/calculated/fluxes_30min.parquet'
     WHERE site_code IN (${siteList}) AND nee_fill = 'measured' AND nee IS NOT NULL AND night = false
     GROUP BY ALL`,
  );
  const measured = new Map<string, { s: number; n: number }>();
  for (const r of mRows) measured.set(`${str(r.site_code)}|${dayOf(str(r.d))}`, { s: num(r.s), n: num(r.n) });
  const measuredWindow = (site: string, anchor: number, w: Window): number | null => {
    let s = 0;
    let n = 0;
    for (let d = anchor + w.from; d <= anchor + w.to; d++) {
      const m = measured.get(`${site}|${d}`);
      if (m) {
        s += m.s;
        n += m.n;
      }
    }
    return n >= MIN_MEASURED_DAY ? s / n : null;
  };

  // ---------- Episodes ----------
  const results: EpisodeResult[] = [];
  for (const ep of episodes) {
    const site = ep.site as SiteCode;
    const byDay = daily.get(site)!;
    const before = windowMeans(byDay, ep.start, BEFORE, MEAN_VARS);
    const after = windowMeans(byDay, ep.end, AFTER, MEAN_VARS);
    const rainB = windowSum(byDay, ep.start, BEFORE, 'rain');
    const rainA = windowSum(byDay, ep.end, AFTER, 'rain');
    const lateFree = startsFree(ep, episodes, LATE);
    const late = lateFree ? windowMeans(byDay, ep.end, LATE, MEAN_VARS) : null;
    const rainL = lateFree ? windowSum(byDay, ep.end, LATE, 'rain') : { n: 0, sum: null };
    const delta = changes(after, before, MEAN_VARS, MIN_DAYS);
    const deltaLate = late ? changes(late, before, MEAN_VARS, MIN_DAYS) : null;
    const delta7 = changes(windowMeans(byDay, ep.end, AFTER7, MEAN_VARS), windowMeans(byDay, ep.start, BEFORE7, MEAN_VARS), MEAN_VARS, MIN_DAYS_7);
    const gppBefore = before.mean.gpp ?? null;
    const gppDelta = delta.gpp ?? null;
    const relGpp = gppDelta !== null && gppBefore !== null && gppBefore >= MIN_GPP_BEFORE ? gppDelta / gppBefore : null;
    // Relative change per after window. GPP and Reco: percent of the own mean before. NEE: percent of
    // the mean GPP of the 30 days before the first day (the NEE before can be near zero or negative).
    const gppRefMeans = windowMeans(byDay, ep.start, GPP_REF, ['gpp']);
    const gppRef = { mean: gppRefMeans.mean.gpp ?? null, nDays: gppRefMeans.n.gpp! };
    const relative: Record<string, Record<Flux, number | null>> = {};
    for (const n of RELATIVE_AFTER_DAYS) {
      const w: Window = { from: 1, to: n };
      const free = startsFree(ep, episodes, w);
      const aft = windowMeans(byDay, ep.end, w, FLUXES);
      const minN = minRelativeDays(n);
      const rel = (f: Flux, ref: number | null, refOk: boolean): number | null => {
        const a = aft.mean[f] ?? null;
        const b = before.mean[f] ?? null;
        if (!free || a === null || b === null || ref === null || !refOk || ref < MIN_REF_FLUX) return null;
        if (aft.n[f]! < minN || before.n[f]! < MIN_DAYS) return null;
        return ((a - b) / ref) * 100;
      };
      relative[relativeKey(n)] = {
        nee: rel('nee', gppRef.mean, gppRef.nDays >= MIN_GPP_REF_DAYS),
        gpp: rel('gpp', before.mean.gpp ?? null, true),
        reco: rel('reco', before.mean.reco ?? null, true),
      };
    }
    const base = seasonalBaseline(byDay, episodes, ep, [...years.get(site)!].sort(), BASELINE_VARS, BEFORE, AFTER, MIN_DAYS, MIN_BASELINE_YEARS);
    const deltaAdj: Record<string, number | null> = {};
    for (const v of BASELINE_VARS) deltaAdj[v] = delta[v] === null || base.mean[v] === null ? null : delta[v]! - base.mean[v]!;
    const excessFree = startsFree(ep, episodes, EXCESS);
    const excess = Object.fromEntries(FLUXES.map((f) => [f, excessFree && delta[f] !== null ? excessSum(byDay, ep.end, EXCESS, f, before.mean[f] ?? null, MIN_EXCESS_DAYS) : null])) as Record<Flux, number | null>;

    // Rules.
    const lo = ep.start + BEFORE.from;
    const hi = ep.end + AFTER.to;
    const overlap = episodes.some((o) => o !== ep && o.site === site && o.start >= lo && o.start <= hi);
    const fluxDays = FLUXES.every((f) => before.n[f]! >= MIN_DAYS && after.n[f]! >= MIN_DAYS);
    const fracOk = (before.mean.frac ?? 0) >= MIN_FRAC && (after.mean.frac ?? 0) >= MIN_FRAC;
    const fluxExclusion: FluxExclusion = overlap ? 'overlap' : !fluxDays ? 'too-few-days' : !fracOk ? 'low-measured-fraction' : null;
    const swcDays = before.n.swc! >= MIN_DAYS && after.n.swc! >= MIN_DAYS;
    const swcExclusion: SwcExclusion = overlap ? 'overlap' : !swcDays ? 'too-few-days' : null;
    const rainDiff = rainA.n >= MIN_DAYS && rainB.n >= MIN_DAYS && rainA.sum !== null && rainB.sum !== null ? rainA.sum - rainB.sum : null;

    const mb = measuredWindow(site, ep.start, BEFORE);
    const ma = measuredWindow(site, ep.end, AFTER);
    const own = new Set(ep.events);
    const others = allEvents
      .filter((e) => e.site === site && !own.has(e))
      .filter((e) => {
        const d = dayOf(e.date);
        return d >= lo && d <= ep.end + LATE.to;
      })
      .map((e) => ({ date: e.date, type: e.type, detail: e.detail }));
    const crops = [...new Set(ep.events.map((e) => e.crop).filter((c): c is string => c !== null))];
    const nIn = finite(ep.events.filter((e) => e.cls === 'fertilisation').map((e) => e.nKgHa));
    const dm = finite(ep.events.filter((e) => e.cls === 'harvest-cut').map((e) => e.dryMassKgHa));
    results.push({
      id: `${site}-${isoDay(ep.start)}`,
      site,
      kind: ep.kind,
      classes: ep.classes,
      fert: ep.fert,
      start: isoDay(ep.start),
      end: isoDay(ep.end),
      lengthDays: ep.end - ep.start,
      durationDays: ep.end - ep.start + 1,
      events: ep.events.map((e) => ({ date: e.date, dateEnd: e.dateEnd, type: e.type, crop: e.crop, detail: e.detail, dryMassKgHa: e.dryMassKgHa, nKgHa: e.nKgHa })),
      crop: crops.length ? crops.join(', ') : null,
      nKgHa: nIn.length ? nIn.reduce((a, b) => a + b, 0) : null,
      dryMassKgHa: dm.length ? dm.reduce((a, b) => a + b, 0) : null,
      before: windowJson(before, rainB),
      after: windowJson(after, rainA),
      late: late ? windowJson(late, rainL) : null,
      delta,
      deltaLate,
      delta7,
      relGpp,
      gppRef,
      relative,
      baseline: base,
      deltaAdj,
      excess,
      rainDiff,
      rainBalanced: rainDiff !== null && Math.abs(rainDiff) <= RAIN_BALANCE_MM,
      rainSource: rainSource[site],
      fluxUsed: fluxExclusion === null,
      fluxExclusion,
      swcUsed: swcExclusion === null,
      swcExclusion,
      measuredDay: { before: mb, after: ma, delta: ma === null || mb === null ? null : ma - mb },
      otherEvents: others,
    });
  }

  const fluxUsed = results.filter((e) => e.fluxUsed);
  const swcUsed = results.filter((e) => e.swcUsed);

  // ---------- Summaries per kind, per kind and site, and per fertiliser kind ----------
  const kinds: Record<string, unknown> = {};
  SUMMARY_KINDS.forEach((k, i) => {
    const eps = results.filter((e) => e.kind === k);
    const bySite: Record<string, unknown> = {};
    SITES.forEach((s, j) => {
      const se = eps.filter((e) => e.site === s);
      if (se.length) bySite[s] = groupSummary(se, 1000 + 100 * i + 10 * j);
    });
    kinds[k] = { label: KINDS.find((x) => x.id === k)!.label, ...groupSummary(eps, 100 + 100 * i), bySite };
  });
  const fert = results.filter((e) => e.kind === 'fertilisation');
  const fertKinds = {
    mineral: groupSummary(fert.filter((e) => e.fert === 'mineral'), 3000),
    organic: groupSummary(fert.filter((e) => e.fert === 'organic'), 3100),
    mixed: fert.filter((e) => e.fert === 'mixed').length,
  };
  // Fertilisation of any kind (pure, with a harvest, with tillage) by fertiliser kind: Reco change.
  const anyFert = results.filter((e) => e.classes.includes('fertilisation'));
  const anyFertKinds = {
    mineral: groupSummary(anyFert.filter((e) => e.fert === 'mineral'), 3200),
    organic: groupSummary(anyFert.filter((e) => e.fert === 'organic'), 3300),
  };
  // Sensitivity: the flux result with the low-measured-fraction episodes.
  const noOverlap = results.filter((e) => e.fluxExclusion === null || e.fluxExclusion === 'low-measured-fraction');
  const sensitivity: Record<string, unknown> = {};
  SUMMARY_KINDS.forEach((k, i) => {
    const eps = noOverlap.filter((e) => e.kind === k);
    sensitivity[k] = { n: eps.length, nee: summarise(eps.map((e) => e.delta.nee), 4000 + i), gpp: summarise(eps.map((e) => e.delta.gpp), 4100 + i), reco: summarise(eps.map((e) => e.delta.reco), 4200 + i) };
  });

  // ---------- Composite curves per kind (all sites), relative to the first day of the episode ----------
  const offsets: number[] = [];
  for (let k = COMPOSITE.from; k <= COMPOSITE.to; k++) offsets.push(k);
  const composite: Record<string, unknown> = {};
  for (const k of SUMMARY_KINDS) {
    const fluxEps = episodes.filter((ep) => fluxUsed.some((u) => u.id === `${ep.site}-${isoDay(ep.start)}`) && ep.kind === k);
    const swcEps = episodes.filter((ep) => swcUsed.some((u) => u.id === `${ep.site}-${isoDay(ep.start)}`) && ep.kind === k);
    const curve = (eps: ClassEpisode[], v: string, anomaly: boolean) => {
      const m: (number | null)[] = [];
      const d: (number | null)[] = [];
      const n: number[] = [];
      const ref = new Map(eps.map((ep) => [ep, anomaly ? windowMeans(daily.get(ep.site)!, ep.start, BEFORE, [v]).mean[v] ?? null : 0]));
      for (const off of offsets) {
        const xs = finite(
          eps.map((ep) => {
            const x = daily.get(ep.site)!.get(ep.start + off)?.[v] ?? null;
            const r = ref.get(ep) ?? null;
            return x === null || r === null ? null : x - r;
          }),
        );
        m.push(mean(xs));
        d.push(sd(xs));
        n.push(xs.length);
      }
      return { mean: m, sd: d, n };
    };
    composite[k] = {
      fluxEpisodes: fluxEps.length,
      swcEpisodes: swcEps.length,
      nee: curve(fluxEps, 'nee', false),
      gpp: curve(fluxEps, 'gpp', false),
      reco: curve(fluxEps, 'reco', false),
      /** Soil water as the difference to the mean of the before window of each episode (m3 m-3). */
      swcAnomaly: curve(swcEps, 'swc', true),
      /** Mean daily rain of the swc episodes (mm d-1). */
      rain: curve(swcEps, 'rain', false),
    };
  }

  // ---------- Counts ----------
  const fluxExclusions = { overlap: 0, 'too-few-days': 0, 'low-measured-fraction': 0 } as Record<string, number>;
  const swcExclusions = { overlap: 0, 'too-few-days': 0 } as Record<string, number>;
  for (const e of results) {
    if (e.fluxExclusion) fluxExclusions[e.fluxExclusion] = (fluxExclusions[e.fluxExclusion] ?? 0) + 1;
    if (e.swcExclusion) swcExclusions[e.swcExclusion] = (swcExclusions[e.swcExclusion] ?? 0) + 1;
  }
  const perType = (list: readonly ClassEvent[]) => Object.fromEntries(['harvest', 'cut', 'grazing', 'fertilisation', 'tillage', 'sowing', 'spraying', 'other'].map((t) => [t, list.filter((e) => e.type === t).length]));
  const usedFrac = finite(fluxUsed.flatMap((e) => [e.before.mean.frac, e.after.mean.frac]));
  const kindCounts = Object.fromEntries(KINDS.map((k) => [k.id, results.filter((e) => e.kind === k.id).length]));

  return {
    question: 'How large is the change of NEE, GPP, Reco and soil water content in the days and weeks after a harvest or cut, grazing, fertilisation or tillage?',
    method: {
      sites: [...SITES],
      classes: ['harvest-cut', 'grazing', 'fertilisation', 'tillage'],
      kinds: KINDS.map((k) => ({ id: k.id, label: k.label, classes: [...k.classes] })),
      mergeDays: MERGE_DAYS,
      beforeDays: BEFORE.to - BEFORE.from + 1,
      afterDays: AFTER.to - AFTER.from + 1,
      lateFrom: LATE.from,
      lateTo: LATE.to,
      excessDays: EXCESS.to - EXCESS.from + 1,
      shortDays: AFTER7.to - AFTER7.from + 1,
      compositeFrom: COMPOSITE.from,
      compositeTo: COMPOSITE.to,
      minDays: MIN_DAYS,
      minDays7: MIN_DAYS_7,
      minExcessDays: MIN_EXCESS_DAYS,
      minFracPct: MIN_FRAC * 100,
      minSwcRows: MIN_SWC_ROWS,
      minRainRows: MIN_RAIN_ROWS,
      rainBalanceMm: RAIN_BALANCE_MM,
      minBaselineYears: MIN_BASELINE_YEARS,
      minGppBefore: MIN_GPP_BEFORE,
      relativeAfterDays: [...RELATIVE_AFTER_DAYS],
      gppRefDays: GPP_REF.to - GPP_REF.from + 1,
      minGppRefDays: MIN_GPP_REF_DAYS,
      minRefFlux: MIN_REF_FLUX,
      minMeasuredDay: MIN_MEASURED_DAY,
      bootstrapResamples: BOOTSTRAP_RESAMPLES,
      ciLevelPct: 95,
      alpha: 0.05,
      haltialaSwcSkipYear: HALTIALA_SWC_SKIP_YEAR,
      halfHoursPerDay: 48,
      utcShiftHours: 2,
      utcShiftHalfHours: 4,
      sensorDepthCm: { haltiala: 10, qvidja: 10, viikki: 14 },
      haltialaSwcResolution: 0.01,
      rrefWindowDays: 2 * CONST.rref.winDays + 1,
      rrefStepDays: CONST.rref.stepDays,
      units: { daily: 'g C m-2 d-1', excess: 'g C m-2', swc: 'm3 m-3', rain: 'mm', measured: 'µmol CO2 m-2 s-1' },
    },
    counts: {
      events: allEvents.length,
      classEvents: classEvents.length,
      perType: perType(allEvents),
      episodes: results.length,
      kinds: kindCounts,
      fluxUsed: fluxUsed.length,
      fluxExcluded: results.length - fluxUsed.length,
      fluxExclusions,
      swcUsed: swcUsed.length,
      swcExcluded: results.length - swcUsed.length,
      swcExclusions,
      swcRainBalanced: swcUsed.filter((e) => e.rainBalanced).length,
      swcRainKnown: swcUsed.filter((e) => e.rainDiff !== null).length,
      withBaseline: fluxUsed.filter((e) => e.deltaAdj.nee !== null).length,
      withSwcBaseline: swcUsed.filter((e) => e.deltaAdj.swc !== null).length,
      withExcess: fluxUsed.filter((e) => e.excess.nee !== null).length,
      withLate: fluxUsed.filter((e) => e.deltaLate?.nee !== null && e.deltaLate?.nee !== undefined).length,
      withOtherEvents: fluxUsed.filter((e) => e.otherEvents.length > 0).length,
      sensitivity: noOverlap.length,
      frozenSwcDays: frozenDays,
      swcDaysTotal,
      frozenSwcPct: swcDaysTotal ? (100 * frozenDays) / swcDaysTotal : null,
      fracMeasuredMeanPct: usedFrac.length ? mean(usedFrac)! * 100 : null,
      fracMeasuredMinPct: usedFrac.length ? Math.min(...usedFrac) * 100 : null,
    },
    sites: Object.fromEntries(
      SITES.map((s) => [
        s,
        {
          name: siteName.get(s),
          siteId: siteId.get(s),
          slot: siteSlot.get(s),
          events: allEvents.filter((e) => e.site === s).length,
          episodes: results.filter((e) => e.site === s).length,
          fluxUsed: fluxUsed.filter((e) => e.site === s).length,
          swcUsed: swcUsed.filter((e) => e.site === s).length,
          rainSource: rainSource[s],
          years: [...years.get(s)!].sort(),
        },
      ]),
    ),
    kinds,
    fertKinds,
    anyFertKinds,
    sensitivity,
    composite: { offsets, kinds: composite },
    highlights: Object.fromEntries(
      HIGHLIGHT_IDS.map((id) => {
        const e = results.find((r) => r.id === id);
        if (!e) throw new Error(`highlight episode ${id} not found`);
        return [id, e];
      }),
    ),
    literature: {
      heimsch2021: {
        windowDays: HEIMSCH_2021.windowDays,
        june2018: {
          beforeMgCo2: HEIMSCH_2021.june2018.beforeMgCo2,
          afterMgCo2: HEIMSCH_2021.june2018.afterMgCo2,
          changeMgCo2: HEIMSCH_2021.june2018.afterMgCo2 - HEIMSCH_2021.june2018.beforeMgCo2,
          changeGcDay: (HEIMSCH_2021.june2018.afterMgCo2 - HEIMSCH_2021.june2018.beforeMgCo2) * MG_CO2_S_TO_G_C_D,
        },
      },
    },
    episodes: results,
  };
}
