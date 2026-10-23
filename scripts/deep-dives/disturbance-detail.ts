// Deep Dive "Management disturbances in detail: cut, harvest, timing and weather"
// (site/src/pages/deep-dive/disturbance-detail.mdx). An iteration of the dive "Size of management
// disturbances" (disturbance-size.ts) with five Finnish sites and three new questions:
//
// A. Cut or harvest: how large is the change of NEE, GPP and Reco after a silage harvest (grass
//    removed), a cleaning cut (grass left on the field) and a grain or bean harvest, and how fast
//    does GPP recover?
// B. Timing: does the drop of GPP start before the recorded harvest day? A change-point search on
//    daily GPP, with a check on the measured day-time NEE.
// C. Fertilisation or weather: is the change of GPP after a fertilisation larger than the change in
//    control windows without management that have the same weather change (air temperature, light)?
//
// Inputs (read only): db/events.parquet, db/sites.parquet, db/observations.parquet,
// data/calculated/daily.parquet and data/calculated/fluxes_30min.parquet. Output: the result object;
// scripts/deep-dives.ts writes it to site/src/deep-dives/disturbance-detail.json.
// Run: npm run deep-dives -- disturbance-detail.
//
// Method decisions that the plan did not fix (also in `method.decisions` of the result):
// - Harvest episodes: an overlap is a grazing or tillage event, or another harvest or cut episode,
//   whose days touch the before or after window. Other events (sowing, spraying, ditch work) are
//   listed only.
// - Relative change of NEE: percent of the mean GPP of the 14-day before window (as GPP and Reco).
// - Timing: an episode is used when no grazing, tillage or other harvest episode touches the days of
//   the search (start − 10 − 5 to end + 5 + 4). Offsets are to the first recorded event date.
// - Change point on measured NEE: minimum mean −NEE before the drop = 1 µmol m-2 s-1.
// - Fertilisation episodes with a harvest or cut (kind harvestCutFert) are listed, but not in the
//   summaries: the harvest makes the GPP change.
// - Rain change in control and episode windows = (mean after − mean before) × 14 days (mm per 14 days).
// - The daily light sum is the mean of max(light, 0) over the half hours of the local day × 86 400 s:
//   PPFD in mol m-2 d-1, SW_IN in MJ m-2 d-1 (44 of 48 half hours needed).

import type { DuckDBConnection } from '@duckdb/node-api';
import { num, numOrNull, rows, str } from '../lib/duck.ts';
import { daysToRecover, detectDrop, preDrop, rangeMean, type Drop } from '../lib/deep-dive/change-point.ts';
import { controlAnchors, controlPairs, dayOfYear, nearestControls, rankAmong } from '../lib/deep-dive/control-windows.ts';
import { changes, mergeClassEpisodes, toClassEvent, windowMeans, type ClassEvent, type VarRow, type WindowMeans } from '../lib/deep-dive/disturbance.ts';
import { HARVEST_GROUP_LABELS, HARVEST_GROUPS, harvestGroup, mergeHarvestEpisodes, yieldPerEvent, type EpisodeOverride, type HarvestEpisode, type HarvestGroup } from '../lib/deep-dive/harvest-groups.ts';
import { dayNumber, isoDay, type Window } from '../lib/deep-dive/harvest.ts';
import { eventDayMask } from '../lib/deep-dive/natural-events.ts';
import { finite, mean, median, ols, olsMulti, pearson, pearsonP, predictMulti, sd, summarise, type OlsMultiFit, type Summary } from '../lib/deep-dive/stats.ts';

export const slug = 'disturbance-detail';
export const title = 'Management disturbances in detail: cut, harvest, timing and weather';

export const inputs = [
  'db/events.parquet',
  'db/sites.parquet',
  'db/observations.parquet',
  'data/calculated/daily.parquet',
  'data/calculated/fluxes_30min.parquet',
] as const;

/** The five Finnish sites (order of db/sites.parquet). */
const SITES = ['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki'] as const;
type SiteCode = (typeof SITES)[number];

/** Light variable per site: Haltiala has PPFD only, Qvidja SW_IN only; Särkisuo SW_IN is sparse. */
const LIGHT_VAR: Record<SiteCode, 'ppfd' | 'sw_in'> = { anttila: 'ppfd', sarkisuo: 'ppfd', haltiala: 'ppfd', qvidja: 'sw_in', viikki: 'ppfd' };
const LIGHT_UNIT = { ppfd: 'mol m-2 d-1', sw_in: 'MJ m-2 d-1' } as const;
/** Minimum daily light sum for a light-normalised GPP (PPFD mol m-2 d-1; SW_IN MJ m-2 d-1). */
const MIN_LIGHT_FOR_LUE = { ppfd: 1, sw_in: 0.5 } as const;
/** Haltiala has no rain gauge: the Viikki rain of the same day is the proxy (as dive #1). */
const RAIN_SOURCE: Record<SiteCode, 'own' | 'viikki-proxy'> = { anttila: 'own', sarkisuo: 'own', haltiala: 'viikki-proxy', qvidja: 'own', viikki: 'own' };

// ---------- Windows and rules of dive #1 ----------
const BEFORE: Window = { from: -14, to: -1 };
const AFTER: Window = { from: 1, to: 14 };
const LATE: Window = { from: 15, to: 28 };
const BEFORE7: Window = { from: -7, to: -1 };
const AFTER7: Window = { from: 1, to: 7 };
const MIN_DAYS = 12;
const MIN_DAYS_7 = 6;
const MIN_FRAC = 0.1;
const MIN_GPP_BEFORE = 0.5;
const MERGE_DAYS = 7;
const BOOTSTRAP_RESAMPLES = 10_000;
/** Minimum measured day-time half hours in a 14-day window (check without gap filling, as dive #1). */
const MIN_MEASURED_WINDOW = 20;
/** Minimum half hours per local day for daily means of swc and tsoil, and for a daily rain sum (dive #1). */
const MIN_SWC_ROWS = 36;
const MIN_RAIN_ROWS = 44;
const MIN_LIGHT_ROWS = 44;

// ---------- Recovery ----------
const RECOVERY: Window = { from: 15, to: 28 };
const RECOVERY_SHARE_PCT = 80;
const RECOVERY_MAX_DAYS = 60;
const RECOVERY_RUN_DAYS = 5;
const RECOVERY_MIN_RUN = 3;

// ---------- Change point (timing) ----------
/** Candidate days: from start − 10 to end + 5. */
const SEARCH_FROM = -10;
const SEARCH_TO = 5;
const SIDE_DAYS = 5;
const MIN_SIDE_GPP = 4;
const MIN_SIDE_NEE = 3;
/** Minimum mean before the drop: GPP g C m-2 d-1, −NEE µmol m-2 s-1. */
const MIN_BEFORE_GPP = 1;
const MIN_BEFORE_NEE = 1;
const MIN_DROP_PCT = 25;
/** Minimum measured day-time half hours for a daily mean of the measured NEE. */
const MIN_MEASURED_HH = 8;
/** GPP and NEE change points agree when they differ by not more than this number of days. */
const AGREE_DAYS = 1;
const PRE_NEAR: Window = { from: -3, to: -1 };
const PRE_FAR: Window = { from: -10, to: -4 };
const TIMING_COMPOSITE: Window = { from: -10, to: 10 };
const TIMING_REF: Window = { from: -10, to: -6 };
const MIN_TIMING_REF_DAYS = 3;

// ---------- Composite curves ----------
const COMPOSITE: Window = { from: -14, to: 42 };

// ---------- Fertilisation controls ----------
const CONTROL_HALF_WIDTH = 21;
const CONTROL_HALF_WIDTH_SENS = 10;
const MASK_BEFORE = 14;
const MASK_AFTER = 14;
const TOL_TA = 1;
const TOL_LIGHT_PCT = 10;
const MIN_MATCHED = 3;
const COLLINEAR_R = 0.7;
const MIN_CONTROL_YEARS = 3;
const RANK_HIGH = 90;
const RANK_LOW = 10;

/**
 * Manual corrections of harvest episodes (the plan, "Method decisions"). Each text goes to the
 * `override` list of the episode in the result.
 */
const OVERRIDES: EpisodeOverride[] = [
  {
    site: 'haltiala',
    date: '2021-09-10',
    start: '2021-09-08',
    end: '2021-09-15',
    text: 'Start 8 Sep 2021 from the file text ("harvest started 8 Sep and lasted at least 5 days"); the rows of 10 Sep and 15 Sep (threshing) are one episode.',
  },
  { site: 'haltiala', date: '2022-08-15', start: '2022-08-15', end: '2022-08-24', text: 'End 24 Aug 2022 from date_end ("end 23 or 24 Aug").' },
  {
    site: 'qvidja',
    date: '2023-06-19',
    text: 'Cleaning cut on 19 Jun and silage harvest on 20 Jun 2023 are one episode: start = cut day, group silage harvest, the cut is a co-event.',
  },
  {
    site: 'qvidja',
    date: '2023-08-21',
    text: 'Cleaning cut on 21 Aug and silage harvest on 22 Aug 2023 are one episode: start = cut day, group silage harvest, the cut is a co-event.',
  },
  { site: 'viikki', date: '2023-08-17', text: 'First cut on 17 Aug and second cut on 24 Aug 2023 (7 days apart) are one episode.' },
];

/**
 * Episodes that the article discusses one by one. The MDX cites them as
 * `highlights.<key>.episode...`, never by an array index, so that a rerun
 * cannot shift a cited value to another episode.
 * Key rule: the key is the episode `id`. When a fertilisation episode has the
 * same `id` as a harvest episode, its key is `<id>-fert` (see `highlightKey()`).
 */
const HIGHLIGHTS: readonly { id: string; source: 'harvest' | 'fertilisation' }[] = [
  { id: 'qvidja-2019-06-10', source: 'harvest' },
  { id: 'haltiala-2021-09-08', source: 'harvest' },
  { id: 'qvidja-2020-05-25', source: 'fertilisation' },
  { id: 'viikki-2022-05-10', source: 'fertilisation' },
  { id: 'qvidja-2018-06-12', source: 'harvest' },
  { id: 'qvidja-2018-08-21', source: 'harvest' },
  { id: 'haltiala-2022-08-15', source: 'harvest' },
  { id: 'haltiala-2025-10-03', source: 'harvest' },
  { id: 'viikki-2025-09-10', source: 'harvest' },
  { id: 'anttila-2022-05-23', source: 'fertilisation' },
  { id: 'haltiala-2023-08-01', source: 'fertilisation' },
  { id: 'qvidja-2019-05-08', source: 'fertilisation' },
  { id: 'qvidja-2020-07-27', source: 'fertilisation' },
  { id: 'qvidja-2021-05-12', source: 'fertilisation' },
];

/** Heimsch et al. 2021 (PDF p. 7–8): 5-day windows; after fertilisation 7 to 29 % lower PAR and rain within 5 days. */
const HEIMSCH_2021 = { windowDays: 5, parLowerPctFrom: 7, parLowerPctTo: 29, rainWithinDays: 5 };

type Flux = 'nee' | 'gpp' | 'reco';
const FLUXES: readonly Flux[] = ['nee', 'gpp', 'reco'];
const MEAN_VARS = ['nee', 'gpp', 'reco', 'frac', 'ta', 'swc', 'rain', 'light', 'lue'] as const;

const dayOf = (iso: string): number => dayNumber(iso.slice(0, 10));
const overlaps = (aLo: number, aHi: number, bLo: number, bHi: number): boolean => aLo <= bHi && bLo <= aHi;
const pct = (a: number | null | undefined, b: number | null | undefined, minRef = 0): number | null =>
  a === null || a === undefined || b === null || b === undefined || !(b > minRef) ? null : (100 * (a - b)) / b;

interface WindowJson {
  nDays: Record<string, number>;
  mean: Record<string, number | null>;
}
const windowJson = (m: WindowMeans): WindowJson => ({ nDays: m.n, mean: m.mean });

type FluxExclusion = 'overlap' | 'too-few-days' | 'low-measured-fraction' | null;

interface TimingJson {
  used: boolean;
  /** Why the episode is not in the timing result (null when used). */
  exclusion: string | null;
  recorded: string;
  gpp: Drop & { offsetStart: number | null; offsetEnd: number | null; detectedDate: string | null };
  nee: Drop & { offsetStart: number | null; offsetEnd: number | null; detectedDate: string | null };
  /** Both drops clear and not more than AGREE_DAYS apart (null when one is not clear). */
  agree: boolean | null;
  preDrop: { near: number | null; far: number | null; pct: number | null };
  /** Offsets from the recorded day (−10 to +10) with a measured fraction of NEE below 10 %. */
  lowFracDays: number[];
}

interface HarvestResult {
  id: string;
  site: SiteCode;
  group: HarvestGroup;
  start: string;
  end: string;
  recorded: string;
  durationDays: number;
  override: string[];
  events: { date: string; dateEnd: string | null; type: string; crop: string | null; detail: string; dryMassKgHa: number | null; group: HarvestGroup }[];
  coEvents: { date: string; type: string; detail: string }[];
  crop: string | null;
  /** Sum of the per-event yields (kg DW/ha), or null. */
  yieldKgHa: number | null;
  /** Yield of the year on this episode (Viikki, Anttila, Särkisuo), or null. */
  yearYieldKgHa: number | null;
  before: WindowJson;
  after: WindowJson;
  late: WindowJson | null;
  delta: Record<string, number | null>;
  delta7: Record<string, number | null>;
  deltaLate: Record<string, number | null> | null;
  /** Relative change after − before (days 1–14): GPP and Reco in % of their own mean before; NEE in % of the mean GPP before. */
  relPct: Record<Flux, number | null>;
  fluxUsed: boolean;
  fluxExclusion: FluxExclusion;
  /** Text for the article table: "used" or the reason of the exclusion. */
  fluxUse: string;
  fertInWindow: boolean;
  /** Other management events from the start of the before window to the end of the late window. */
  otherEvents: { date: string; dateEnd: string | null; type: string; detail: string }[];
  measuredDay: { before: number | null; after: number | null; delta: number | null };
  recovery: { sharePct: number | null; days: number | null; censored: boolean; reason: string; nextDisturbanceDays: number | null };
  timing: TimingJson;
}

interface FertResult {
  id: string;
  site: SiteCode;
  kind: string;
  classes: string[];
  fert: string | null;
  withTillage: boolean;
  withHarvest: boolean;
  /** In the summaries: flux used, no harvest or cut in the episode, and a control fit. */
  inSummary: boolean;
  nKgHa: number | null;
  start: string;
  end: string;
  doy: number;
  events: { date: string; type: string; detail: string }[];
  coEvents: { date: string; type: string; detail: string }[];
  fluxUsed: boolean;
  fluxExclusion: FluxExclusion;
  fluxUse: string;
  before: WindowJson;
  after: WindowJson;
  delta: { gpp: number | null; reco: number | null; nee: number | null; relGppPct: number | null };
  weather: { ta: number | null; lightPct: number | null; rain: number | null; swc: number | null };
  expectedGpp: number | null;
  residualGpp: number | null;
  residualRank: number | null;
  rawRank: number | null;
  nControls: number;
  check: { expectedSwc: number | null; residualSwc: number | null; residual10: number | null; residualRank10: number | null; pooledResidualPct: number | null };
  matched: { n: number; controlDelta: number | null; diff: number | null };
  lightNorm: { before: number | null; after: number | null; delta: number | null; pct: number | null };
}

interface PairJson {
  anchor: string;
  dGpp: number;
  dReco: number;
  dNee: number;
  dTa: number;
  dLightPct: number;
  dRain: number | null;
  dSwc: number | null;
  relGppPct: number | null;
}

const fitJson = (f: OlsMultiFit | null) => (f ? { coef: f.coef, residSd: f.residSd, r2: f.r2, n: f.n } : null);

function line(xs: number[], ys: number[]) {
  const f = ols(xs, ys);
  const r = xs.length >= 3 ? pearson(xs, ys) : null;
  return { n: xs.length, slope: f?.slope ?? null, intercept: f?.intercept ?? null, r, p: pearsonP(r, xs.length) };
}

/** Throw when the result has a number that is not finite (NaN or Infinity). */
function assertFinite(x: unknown, path = '$'): void {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new Error(`${slug}: ${path} is ${x}`);
  } else if (Array.isArray(x)) x.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) assertFinite(v, `${path}.${k}`);
}

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
  const harvestEvents = allEvents.filter((e) => e.type === 'harvest' || e.type === 'cut');
  const harvestEps = mergeHarvestEpisodes(harvestEvents, OVERRIDES, MERGE_DAYS);
  const classEvents = allEvents.filter((e) => e.cls !== null);
  const classEps = mergeClassEpisodes(classEvents, MERGE_DAYS);
  const evLo = (e: ClassEvent) => dayOf(e.date);
  const evHi = (e: ClassEvent) => dayOf(e.dateEnd ?? e.date);

  // ---------- Daily fluxes ----------
  const daily = new Map<string, Map<number, VarRow>>(SITES.map((s) => [s, new Map()]));
  const years = new Map<string, Set<number>>(SITES.map((s) => [s, new Set()]));
  const empty = (): VarRow => ({ nee: null, gpp: null, reco: null, frac: null, ta: null, tsoil: null, swc: null, rain: null, light: null, lue: null, mneg: null });
  const dRows = await rows(
    conn,
    `SELECT site_code, CAST(date_local AS VARCHAR) AS d, nee_f_gc, gpp_gc, reco_gc, frac_measured, ta_mean
     FROM 'data/calculated/daily.parquet' WHERE site_code IN (${siteList})`,
  );
  for (const r of dRows) {
    const site = str(r.site_code);
    years.get(site)!.add(Number(str(r.d).slice(0, 4)));
    daily.get(site)!.set(dayOf(str(r.d)), {
      ...empty(),
      nee: numOrNull(r.nee_f_gc),
      gpp: numOrNull(r.gpp_gc),
      reco: numOrNull(r.reco_gc),
      frac: numOrNull(r.frac_measured),
      ta: numOrNull(r.ta_mean),
    });
  }

  // ---------- Daily soil water, rain and light (local day of the site) ----------
  // Haltiala 2021 soil water is used: finding HAL-03 is resolved (provider confirmed 2026-10-23).
  const oRows = await rows(
    conn,
    `SELECT s.code AS site_code, CAST(CAST(o.ts_start + to_minutes(s.utc_offset_min) AS DATE) AS VARCHAR) AS d,
            avg(o.swc) AS swc, count(o.swc) AS n_swc, avg(o.tsoil) AS tsoil, count(o.tsoil) AS n_tsoil,
            sum(o.precip) AS rain, count(o.precip) AS n_rain,
            avg(greatest(o.ppfd, 0)) AS ppfd, count(o.ppfd) AS n_ppfd,
            avg(greatest(o.sw_in, 0)) AS sw_in, count(o.sw_in) AS n_sw_in
     FROM 'db/observations.parquet' o JOIN 'db/sites.parquet' s USING (site_id)
     WHERE s.code IN (${siteList}) GROUP BY ALL`,
  );
  const rainByDay = new Map<string, Map<number, number>>(SITES.map((s) => [s, new Map()]));
  let frozenDays = 0;
  for (const r of oRows) {
    const site = str(r.site_code) as SiteCode;
    const day = dayOf(str(r.d));
    const row = daily.get(site)!.get(day) ?? empty();
    const tsoil = num(r.n_tsoil) >= MIN_SWC_ROWS ? numOrNull(r.tsoil) : null;
    let swc = num(r.n_swc) >= MIN_SWC_ROWS ? numOrNull(r.swc) : null;
    // Frozen soil: the sensors do not give the liquid water content (finding QVI-16).
    if (swc !== null && tsoil !== null && tsoil <= 0) {
      swc = null;
      frozenDays++;
    }
    const rain = num(r.n_rain) >= MIN_RAIN_ROWS ? numOrNull(r.rain) : null;
    if (rain !== null) rainByDay.get(site)!.set(day, rain);
    const lv = LIGHT_VAR[site];
    const lightMean = num(r[`n_${lv}`]) >= MIN_LIGHT_ROWS ? numOrNull(r[lv]) : null;
    // µmol m-2 s-1 × 86 400 s / 1e6 = mol m-2 d-1; W m-2 × 86 400 s / 1e6 = MJ m-2 d-1.
    const light = lightMean === null ? null : (lightMean * 86_400) / 1e6;
    daily.get(site)!.set(day, { ...row, tsoil, swc, rain, light });
  }
  const viikkiRain = rainByDay.get('viikki')!;
  for (const [day, row] of daily.get('haltiala')!) daily.get('haltiala')!.set(day, { ...row, rain: viikkiRain.get(day) ?? null });
  // Light-normalised GPP (g C per mol photons, or per MJ).
  for (const site of SITES) {
    const minL = MIN_LIGHT_FOR_LUE[LIGHT_VAR[site]];
    for (const [day, row] of daily.get(site)!) {
      const g = row.gpp ?? null;
      const l = row.light ?? null;
      daily.get(site)!.set(day, { ...row, lue: g === null || l === null || l < minL ? null : g / l });
    }
  }

  // ---------- Measured day-time NEE per local day ----------
  const mRows = await rows(
    conn,
    `SELECT site_code, CAST(CAST(tl AS DATE) AS VARCHAR) AS d, sum(nee) AS s, count(nee) AS n
     FROM 'data/calculated/fluxes_30min.parquet'
     WHERE site_code IN (${siteList}) AND nee_fill = 'measured' AND nee IS NOT NULL AND night = false
     GROUP BY ALL`,
  );
  const measured = new Map<string, { s: number; n: number }>();
  for (const r of mRows) {
    const site = str(r.site_code);
    const day = dayOf(str(r.d));
    const s = num(r.s);
    const n = num(r.n);
    measured.set(`${site}|${day}`, { s, n });
    if (n >= MIN_MEASURED_HH) {
      const row = daily.get(site)!.get(day) ?? empty();
      daily.get(site)!.set(day, { ...row, mneg: -s / n });
    }
  }
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
    return n >= MIN_MEASURED_WINDOW ? s / n : null;
  };

  // ======================= A and B: harvest and cut episodes =======================
  /** Events that disturb a harvest episode: grazing and tillage. */
  const blocking = allEvents.filter((e) => e.type === 'grazing' || e.type === 'tillage');
  const otherHarvest = (ep: HarvestEpisode, lo: number, hi: number) => harvestEps.filter((o) => o !== ep && o.site === ep.site && overlaps(o.start, o.end, lo, hi));
  const blockingIn = (ep: HarvestEpisode, lo: number, hi: number) => blocking.filter((e) => e.site === ep.site && overlaps(evLo(e), evHi(e), lo, hi));
  /** Days after `end` when the next harvest, cut or grazing starts (for the recovery), or null. */
  const nextDisturbance = (ep: HarvestEpisode): number | null => {
    const starts = [
      ...harvestEps.filter((o) => o.site === ep.site && o.start > ep.end).map((o) => o.start),
      ...allEvents.filter((e) => e.site === ep.site && e.type === 'grazing' && evLo(e) > ep.end).map(evLo),
    ];
    return starts.length ? Math.min(...starts) - ep.end : null;
  };

  const harvests: HarvestResult[] = [];
  for (const ep of harvestEps) {
    const site = ep.site as SiteCode;
    const byDay = daily.get(site)!;
    const before = windowMeans(byDay, ep.start, BEFORE, MEAN_VARS);
    const after = windowMeans(byDay, ep.end, AFTER, MEAN_VARS);
    const delta = changes(after, before, MEAN_VARS, MIN_DAYS);
    const delta7 = changes(windowMeans(byDay, ep.end, AFTER7, MEAN_VARS), windowMeans(byDay, ep.start, BEFORE7, MEAN_VARS), MEAN_VARS, MIN_DAYS_7);
    const lateFree = otherHarvest(ep, ep.end + LATE.from, ep.end + LATE.to).length === 0 && blockingIn(ep, ep.end + LATE.from, ep.end + LATE.to).length === 0;
    const late = lateFree ? windowMeans(byDay, ep.end, LATE, MEAN_VARS) : null;
    const deltaLate = late ? changes(late, before, MEAN_VARS, MIN_DAYS) : null;
    const gppB = before.mean.gpp ?? null;
    const okB = gppB !== null && gppB >= MIN_GPP_BEFORE;
    const relPct: Record<Flux, number | null> = {
      gpp: okB && delta.gpp !== null ? (100 * delta.gpp!) / gppB! : null,
      reco: delta.reco !== null && (before.mean.reco ?? 0) >= MIN_GPP_BEFORE ? (100 * delta.reco!) / before.mean.reco! : null,
      nee: okB && delta.nee !== null ? (100 * delta.nee!) / gppB! : null,
    };

    // Rules.
    const lo = ep.start + BEFORE.from;
    const hi = ep.end + AFTER.to;
    const oh = otherHarvest(ep, lo, hi);
    const ob = blockingIn(ep, lo, hi);
    const fluxDays = FLUXES.every((f) => before.n[f]! >= MIN_DAYS && after.n[f]! >= MIN_DAYS);
    const fracOk = (before.mean.frac ?? 0) >= MIN_FRAC && (after.mean.frac ?? 0) >= MIN_FRAC;
    const fluxExclusion: FluxExclusion = oh.length || ob.length ? 'overlap' : !fluxDays ? 'too-few-days' : !fracOk ? 'low-measured-fraction' : null;
    const overlapText = [
      ...oh.map((o) => `harvest or cut ${isoDay(o.start)}`),
      ...ob.map((e) => `${e.type} ${e.date}${e.dateEnd ? ` to ${e.dateEnd}` : ''}`),
    ].join(', ');
    const fluxUse =
      fluxExclusion === null
        ? 'used'
        : fluxExclusion === 'overlap'
          ? `excluded: ${overlapText} in the windows`
          : fluxExclusion === 'too-few-days'
            ? `excluded: fewer than ${MIN_DAYS} days with flux data in a window (before ${before.n.gpp}, after ${after.n.gpp})`
            : `excluded: measured fraction of NEE below ${MIN_FRAC * 100} % in a window`;
    const fertInWindow = allEvents.some((e) => e.site === site && e.type === 'fertilisation' && overlaps(evLo(e), evHi(e), lo, hi));
    const own = new Set<object>(ep.events);
    const otherEvents = allEvents
      .filter((e) => e.site === site && !own.has(e) && overlaps(evLo(e), evHi(e), lo, ep.end + LATE.to))
      .map((e) => ({ date: e.date, dateEnd: e.dateEnd, type: e.type, detail: e.detail }));

    // Recovery.
    const next = nextDisturbance(ep);
    const recBlocked = next !== null && next <= RECOVERY.to;
    const rec = windowMeans(byDay, ep.end, RECOVERY, ['gpp']);
    const sharePct = !recBlocked && okB && rec.n.gpp! >= MIN_DAYS && rec.mean.gpp !== null ? (100 * rec.mean.gpp!) / gppB! : null;
    const dtr = daysToRecover(byDay, 'gpp', ep.end, okB ? gppB : null, {
      sharePct: RECOVERY_SHARE_PCT,
      maxDays: RECOVERY_MAX_DAYS,
      runDays: RECOVERY_RUN_DAYS,
      minRun: RECOVERY_MIN_RUN,
      blockedFrom: next,
    });

    // Timing (change point).
    const searchLo = ep.start + SEARCH_FROM;
    const searchHi = ep.end + SEARCH_TO;
    const spanLo = searchLo - SIDE_DAYS;
    const spanHi = searchHi + SIDE_DAYS - 1;
    const tOh = otherHarvest(ep, spanLo, spanHi);
    const tOb = blockingIn(ep, spanLo, spanHi);
    const timingExclusion = tOh.length || tOb.length ? `overlap: ${[...tOh.map((o) => `harvest or cut ${isoDay(o.start)}`), ...tOb.map((e) => `${e.type} ${e.date}`)].join(', ')}` : null;
    const withOffsets = (d: Drop) => ({
      ...d,
      offsetStart: d.detected === null ? null : d.detected - ep.start,
      offsetEnd: d.detected === null ? null : d.detected - ep.end,
      detectedDate: d.detected === null ? null : isoDay(d.detected),
    });
    const gDrop = withOffsets(detectDrop(byDay, 'gpp', searchLo, searchHi, { sideDays: SIDE_DAYS, minSideDays: MIN_SIDE_GPP, minBefore: MIN_BEFORE_GPP, minDropPct: MIN_DROP_PCT, anchor: ep.recorded }));
    const nDrop = withOffsets(detectDrop(byDay, 'mneg', searchLo, searchHi, { sideDays: SIDE_DAYS, minSideDays: MIN_SIDE_NEE, minBefore: MIN_BEFORE_NEE, minDropPct: MIN_DROP_PCT, anchor: ep.recorded }));
    // An episode without enough GPP days in the search span is not in the timing result.
    const timingExclusionAll = timingExclusion ?? (gDrop.reason === 'too-few-days' ? `fewer than ${MIN_SIDE_GPP} of ${SIDE_DAYS} days with GPP on each side of every candidate day` : null);
    const agree = gDrop.clear && nDrop.clear ? Math.abs(gDrop.detected! - nDrop.detected!) <= AGREE_DAYS : null;
    const lowFracDays: number[] = [];
    for (let k = TIMING_COMPOSITE.from; k <= TIMING_COMPOSITE.to; k++) {
      const f = byDay.get(ep.recorded + k)?.frac ?? null;
      if (f !== null && f < MIN_FRAC) lowFracDays.push(k);
    }

    const crops = [...new Set(ep.events.map((e) => e.crop).filter((c): c is string => c !== null))];
    const perEvent = finite(ep.events.filter((e) => e.dryMassKgHa !== null && yieldPerEvent(e.detail)).map((e) => e.dryMassKgHa));
    const yearYield = finite(ep.events.filter((e) => e.dryMassKgHa !== null && !yieldPerEvent(e.detail)).map((e) => e.dryMassKgHa));
    const mb = measuredWindow(site, ep.start, BEFORE);
    const ma = measuredWindow(site, ep.end, AFTER);
    harvests.push({
      id: `${site}-${isoDay(ep.start)}`,
      site,
      group: ep.group,
      start: isoDay(ep.start),
      end: isoDay(ep.end),
      recorded: isoDay(ep.recorded),
      durationDays: ep.end - ep.start + 1,
      override: ep.overrides,
      events: ep.events.map((e) => ({ date: e.date, dateEnd: e.dateEnd, type: e.type, crop: e.crop, detail: e.detail, dryMassKgHa: e.dryMassKgHa, group: harvestGroup(e.type, e.crop, e.detail) })),
      coEvents: ep.coEvents.map((e) => ({ date: e.date, type: e.type, detail: e.detail })),
      crop: crops.length ? crops.join(', ') : null,
      yieldKgHa: perEvent.length ? perEvent.reduce((a, b) => a + b, 0) : null,
      yearYieldKgHa: yearYield.length ? yearYield[0]! : null,
      before: windowJson(before),
      after: windowJson(after),
      late: late ? windowJson(late) : null,
      delta,
      delta7,
      deltaLate,
      relPct,
      fluxUsed: fluxExclusion === null,
      fluxExclusion,
      fluxUse,
      fertInWindow,
      otherEvents,
      measuredDay: { before: mb, after: ma, delta: ma === null || mb === null ? null : ma - mb },
      recovery: { sharePct, days: dtr.days, censored: dtr.censored, reason: dtr.reason, nextDisturbanceDays: next },
      timing: {
        used: timingExclusionAll === null,
        exclusion: timingExclusionAll,
        recorded: isoDay(ep.recorded),
        gpp: gDrop,
        nee: nDrop,
        agree,
        preDrop: preDrop(byDay, 'gpp', ep.recorded, PRE_NEAR, PRE_FAR, { minNear: 2, minFar: 5, minFarMean: MIN_BEFORE_GPP }),
        lowFracDays,
      },
    });
  }
  const harvestUsed = harvests.filter((e) => e.fluxUsed);

  // ---------- Group summaries ----------
  let seedBase = 100;
  function groupSummary(eps: readonly HarvestResult[]) {
    const seed = (seedBase += 100);
    const flux = eps.filter((e) => e.fluxUsed);
    const noFert = flux.filter((e) => !e.fertInWindow);
    const pick = (list: readonly HarvestResult[], f: (e: HarvestResult) => number | null | undefined, s: number): Summary => summarise(list.map(f), s);
    const fluxVar = (v: Flux, s: number) => ({
      delta: pick(flux, (e) => e.delta[v], s),
      delta7: pick(flux, (e) => e.delta7[v], s + 1),
      deltaLate: pick(flux, (e) => e.deltaLate?.[v], s + 2),
      relPct: pick(flux, (e) => e.relPct[v], s + 3),
      before: mean(finite(flux.map((e) => e.before.mean[v]))),
      after: mean(finite(flux.map((e) => e.after.mean[v]))),
    });
    return {
      n: eps.length,
      nFlux: flux.length,
      sites: Object.fromEntries(SITES.map((s) => [s, eps.filter((e) => e.site === s).length])),
      sitesFlux: Object.fromEntries(SITES.map((s) => [s, flux.filter((e) => e.site === s).length])),
      nee: fluxVar('nee', seed),
      gpp: fluxVar('gpp', seed + 10),
      reco: fluxVar('reco', seed + 20),
      ta: pick(flux, (e) => e.delta.ta, seed + 30),
      recoveryShare: pick(flux, (e) => e.recovery.sharePct, seed + 31),
      daysToRecover: pick(flux, (e) => e.recovery.days, seed + 32),
      nRecovered: flux.filter((e) => e.recovery.days !== null).length,
      nCensored: flux.filter((e) => e.recovery.censored).length,
      measuredDay: pick(flux, (e) => e.measuredDay.delta, seed + 33),
      fertInWindow: flux.filter((e) => e.fertInWindow).length,
      deltaNoFert: {
        n: noFert.length,
        nee: pick(noFert, (e) => e.delta.nee, seed + 40),
        gpp: pick(noFert, (e) => e.delta.gpp, seed + 41),
        reco: pick(noFert, (e) => e.delta.reco, seed + 42),
        gppRelPct: pick(noFert, (e) => e.relPct.gpp, seed + 43),
      },
    };
  }
  const groups: Record<string, unknown> = {};
  for (const g of HARVEST_GROUPS) {
    const eps = harvests.filter((e) => e.group === g);
    const bySite: Record<string, unknown> = {};
    for (const s of SITES) {
      const se = eps.filter((e) => e.site === s);
      if (se.length) bySite[s] = groupSummary(se);
    }
    groups[g] = { label: HARVEST_GROUP_LABELS[g], ...groupSummary(eps), bySite };
  }

  // ---------- Yield and canopy relations (silage harvests) ----------
  const silage = harvestUsed.filter((e) => e.group === 'silageHarvest');
  const fitPoints = (list: readonly HarvestResult[], fx: (e: HarvestResult) => number | null, fy: (e: HarvestResult) => number | null) => {
    const pts = list.map((e) => ({ id: e.id, site: e.site, x: fx(e), y: fy(e) })).filter((p): p is { id: string; site: SiteCode; x: number; y: number } => p.x !== null && p.y !== null);
    return { ...line(pts.map((p) => p.x), pts.map((p) => p.y)), points: pts };
  };
  const yieldFits = {
    /** ΔGPP (g C m-2 d-1) against the per-event yield (kg DW/ha). Only per-event yields (Qvidja). */
    vsYield: fitPoints(silage, (e) => e.yieldKgHa, (e) => e.delta.gpp ?? null),
    /** Relative ΔGPP (%) against the per-event yield. */
    relVsYield: fitPoints(silage, (e) => e.yieldKgHa, (e) => e.relPct.gpp),
    /** Relative ΔGPP (%) against the mean GPP before (g C m-2 d-1), all silage harvests of the five sites. */
    relVsGppBefore: fitPoints(silage, (e) => e.before.mean.gpp ?? null, (e) => e.relPct.gpp),
  };

  // ---------- Timing summaries ----------
  let timingSeed = 5000;
  function timingSummary(eps: readonly HarvestResult[]) {
    const s = (timingSeed += 10);
    const used = eps.filter((e) => e.timing.used);
    const clear = used.filter((e) => e.timing.gpp.clear);
    const offs = clear.map((e) => e.timing.gpp.offset!);
    const neeClear = used.filter((e) => e.timing.nee.clear);
    const both = used.filter((e) => e.timing.agree !== null);
    const nAgree = both.filter((e) => e.timing.agree).length;
    const nBefore = offs.filter((o) => o < 0).length;
    return {
      n: used.length,
      nClear: clear.length,
      nNotClear: used.length - clear.length,
      reasons: Object.fromEntries(['too-few-days', 'flux-too-small', 'drop-too-small'].map((r) => [r, used.filter((e) => e.timing.gpp.reason === r).length])),
      offsets: summarise(offs, s),
      offsetsEnd: summarise(clear.map((e) => e.timing.gpp.offsetEnd), s + 1),
      median: median(offs),
      nBefore,
      nOn: offs.filter((o) => o === 0).length,
      nAfter: offs.filter((o) => o > 0).length,
      shareBeforePct: offs.length ? (100 * nBefore) / offs.length : null,
      nNeeClear: neeClear.length,
      neeOffsets: summarise(neeClear.map((e) => e.timing.nee.offset), s + 2),
      neeMedian: median(neeClear.map((e) => e.timing.nee.offset!)),
      nBoth: both.length,
      nAgree,
      agreePct: both.length ? (100 * nAgree) / both.length : null,
      preDropPct: summarise(used.map((e) => e.timing.preDrop.pct), s + 3),
      nLowFrac: used.filter((e) => e.timing.lowFracDays.length > 0).length,
    };
  }
  const timingComposite: Record<string, unknown> = {};
  const timingOffsets: number[] = [];
  for (let k = TIMING_COMPOSITE.from; k <= TIMING_COMPOSITE.to; k++) timingOffsets.push(k);
  for (const g of HARVEST_GROUPS) {
    const linesOut: { id: string; site: SiteCode; values: (number | null)[]; detectedOffset: number | null; clear: boolean }[] = [];
    for (const e of harvests.filter((h) => h.group === g && h.timing.used)) {
      const byDay = daily.get(e.site)!;
      const rec = dayNumber(e.recorded);
      const ref = rangeMean(byDay, 'gpp', rec + TIMING_REF.from, rec + TIMING_REF.to);
      if (ref.n < MIN_TIMING_REF_DAYS || ref.mean === null || ref.mean < MIN_BEFORE_GPP) continue;
      const values = timingOffsets.map((k) => {
        const x = byDay.get(rec + k)?.gpp ?? null;
        return x === null ? null : (100 * x) / ref.mean!;
      });
      linesOut.push({ id: e.id, site: e.site, values, detectedOffset: e.timing.gpp.offset, clear: e.timing.gpp.clear });
    }
    const m: (number | null)[] = [];
    const d: (number | null)[] = [];
    const n: number[] = [];
    timingOffsets.forEach((_, i) => {
      const xs = finite(linesOut.map((l) => l.values[i]));
      m.push(mean(xs));
      d.push(sd(xs));
      n.push(xs.length);
    });
    timingComposite[g] = { lines: linesOut, mean: m, sd: d, n };
  }
  const timing = {
    groups: Object.fromEntries(HARVEST_GROUPS.map((g) => [g, timingSummary(harvests.filter((e) => e.group === g))])),
    sites: Object.fromEntries(SITES.map((s) => [s, timingSummary(harvests.filter((e) => e.site === s))])),
    all: timingSummary(harvests),
    composite: { offsets: timingOffsets, refFrom: TIMING_REF.from, refTo: TIMING_REF.to, groups: timingComposite },
  };

  // ---------- Composite curves (−14 to +42 days from the first day) ----------
  const compOffsets: number[] = [];
  for (let k = COMPOSITE.from; k <= COMPOSITE.to; k++) compOffsets.push(k);
  const composite: Record<string, unknown> = {};
  for (const g of HARVEST_GROUPS) {
    const eps = harvestUsed.filter((e) => e.group === g);
    const curve = (v: string, share: boolean) => {
      const m: (number | null)[] = [];
      const d: (number | null)[] = [];
      const n: number[] = [];
      for (const off of compOffsets) {
        const xs = finite(
          eps.map((e) => {
            const start = dayNumber(e.start);
            const end = dayNumber(e.end);
            // Stop the curve of an episode at the next harvest, cut or grazing.
            if (e.recovery.nextDisturbanceDays !== null && start + off >= end + e.recovery.nextDisturbanceDays) return null;
            const x = daily.get(e.site)!.get(start + off)?.[v] ?? null;
            if (x === null) return null;
            if (!share) return x;
            const ref = e.before.mean.gpp ?? null;
            return ref === null || ref < MIN_GPP_BEFORE ? null : (100 * x) / ref;
          }),
        );
        m.push(mean(xs));
        d.push(sd(xs));
        n.push(xs.length);
      }
      return { mean: m, sd: d, n };
    };
    composite[g] = { episodes: eps.length, nee: curve('nee', false), gpp: curve('gpp', false), reco: curve('reco', false), gppSharePct: curve('gpp', true) };
  }

  // ======================= C: fertilisation and weather =======================
  const sowing = allEvents.filter((e) => e.type === 'sowing');
  const fertEps = classEps.filter((ep) => ep.classes.includes('fertilisation') && (SITES as readonly string[]).includes(ep.site));
  const PAIR_VARS = ['gpp', 'reco', 'nee', 'ta', 'light', 'frac'];
  const EXTRA_VARS = ['rain', 'swc', 'lue'];

  interface Pair {
    anchor: number;
    dGpp: number;
    dReco: number;
    dNee: number;
    dTa: number;
    dLightPct: number;
    dRain: number | null;
    dSwc: number | null;
    relGppPct: number | null;
  }
  const buildPairs = (site: SiteCode, halfWidth: number): Pair[] => {
    const blocked = eventDayMask(allEvents.filter((e) => e.site === site), MASK_BEFORE, MASK_AFTER).get(site) ?? new Set<number>();
    const anchors = new Set<number>();
    for (const ep of fertEps.filter((x) => x.site === site)) for (const a of controlAnchors([...years.get(site)!], dayOfYear(ep.start), halfWidth)) anchors.add(a);
    const pairs = controlPairs(daily.get(site)!, blocked, [...anchors].sort((a, b) => a - b), BEFORE, AFTER, PAIR_VARS, MIN_DAYS, EXTRA_VARS);
    return pairs
      .filter((p) => (p.before.frac ?? 0) >= MIN_FRAC && (p.after.frac ?? 0) >= MIN_FRAC && (p.before.light ?? 0) > 0)
      .map((p) => ({
        anchor: p.anchor,
        dGpp: p.delta.gpp!,
        dReco: p.delta.reco!,
        dNee: p.delta.nee!,
        dTa: p.delta.ta!,
        dLightPct: pct(p.after.light, p.before.light)!,
        dRain: p.delta.rain === null || p.delta.rain === undefined ? null : p.delta.rain * (AFTER.to - AFTER.from + 1),
        dSwc: p.delta.swc ?? null,
        relGppPct: pct(p.after.gpp, p.before.gpp, MIN_GPP_BEFORE - 1e-12),
      }));
  };
  interface SiteFit {
    pairs: Pair[];
    fit: OlsMultiFit | null;
    fitSwc: OlsMultiFit | null;
    swcPairs: Pair[];
    sortedResid: number[];
    sortedGpp: number[];
    pairs10: Pair[];
    fit10: OlsMultiFit | null;
    sortedResid10: number[];
  }
  const siteFits = new Map<SiteCode, SiteFit>();
  const controlsJson: Record<string, unknown> = {};
  for (const site of SITES) {
    if (!fertEps.some((e) => e.site === site)) continue;
    const pairs = buildPairs(site, CONTROL_HALF_WIDTH);
    const fit = olsMulti(pairs.map((p) => [p.dTa, p.dLightPct]), pairs.map((p) => p.dGpp));
    const swcPairs = pairs.filter((p) => p.dSwc !== null);
    const fitSwc = olsMulti(swcPairs.map((p) => [p.dTa, p.dLightPct, p.dSwc!]), swcPairs.map((p) => p.dGpp));
    const pairs10 = buildPairs(site, CONTROL_HALF_WIDTH_SENS);
    const fit10 = olsMulti(pairs10.map((p) => [p.dTa, p.dLightPct]), pairs10.map((p) => p.dGpp));
    siteFits.set(site, {
      pairs,
      fit,
      fitSwc,
      swcPairs,
      sortedResid: fit ? [...fit.residuals].sort((a, b) => a - b) : [],
      sortedGpp: pairs.map((p) => p.dGpp).sort((a, b) => a - b),
      pairs10,
      fit10,
      sortedResid10: fit10 ? [...fit10.residuals].sort((a, b) => a - b) : [],
    });
    const yrs = [...new Set(pairs.map((p) => Number(isoDay(p.anchor).slice(0, 4))))].sort();
    const r = pearson(pairs.map((p) => p.dTa), pairs.map((p) => p.dLightPct));
    controlsJson[site] = {
      nPairs: pairs.length,
      nYears: yrs.length,
      years: yrs,
      fewYears: yrs.length < MIN_CONTROL_YEARS,
      rTaLight: r,
      collinear: r !== null && Math.abs(r) > COLLINEAR_R,
      /** ΔGPP = coef[0] + coef[1]·Δta + coef[2]·Δlight%. */
      fit: fitJson(fit),
      /** ΔGPP = coef[0] + coef[1]·Δta + coef[2]·Δlight% + coef[3]·Δswc. */
      fitSwc: fitJson(fitSwc),
      fitTa: line(pairs.map((p) => p.dTa), pairs.map((p) => p.dGpp)),
      fitLight: line(pairs.map((p) => p.dLightPct), pairs.map((p) => p.dGpp)),
      sensitivity10: { nPairs: pairs10.length, fit: fitJson(fit10) },
      dGpp: summarise(pairs.map((p) => p.dGpp), 6000 + siteSlot.get(site)!),
      dTa: summarise(pairs.map((p) => p.dTa), 6100 + siteSlot.get(site)!),
      dLightPct: summarise(pairs.map((p) => p.dLightPct), 6200 + siteSlot.get(site)!),
      pairs: pairs.map(
        (p): PairJson => ({ anchor: isoDay(p.anchor), dGpp: p.dGpp, dReco: p.dReco, dNee: p.dNee, dTa: p.dTa, dLightPct: p.dLightPct, dRain: p.dRain, dSwc: p.dSwc, relGppPct: p.relGppPct }),
      ),
    };
  }
  // Pooled fit of the relative GPP change over all sites (second check).
  const pooled = [...siteFits.values()].flatMap((f) => f.pairs).filter((p) => p.relGppPct !== null);
  const pooledFit = olsMulti(pooled.map((p) => [p.dTa, p.dLightPct]), pooled.map((p) => p.relGppPct!));

  const fertResults: FertResult[] = [];
  for (const ep of fertEps) {
    const site = ep.site as SiteCode;
    const byDay = daily.get(site)!;
    const before = windowMeans(byDay, ep.start, BEFORE, MEAN_VARS);
    const after = windowMeans(byDay, ep.end, AFTER, MEAN_VARS);
    const delta = changes(after, before, MEAN_VARS, MIN_DAYS);
    // Flux rules of dive #1: no other class episode starts in the windows, enough days, measured fraction.
    const lo = ep.start + BEFORE.from;
    const hi = ep.end + AFTER.to;
    const others = classEps.filter((o) => o !== ep && o.site === site && o.start >= lo && o.start <= hi);
    const fluxDays = FLUXES.every((f) => before.n[f]! >= MIN_DAYS && after.n[f]! >= MIN_DAYS);
    const fracOk = (before.mean.frac ?? 0) >= MIN_FRAC && (after.mean.frac ?? 0) >= MIN_FRAC;
    const fluxExclusion: FluxExclusion = others.length ? 'overlap' : !fluxDays ? 'too-few-days' : !fracOk ? 'low-measured-fraction' : null;
    const fluxUse =
      fluxExclusion === null
        ? 'used'
        : fluxExclusion === 'overlap'
          ? `excluded: ${others.map((o) => `${o.classes.join(' + ')} ${isoDay(o.start)}`).join(', ')} in the windows`
          : fluxExclusion === 'too-few-days'
            ? `excluded: fewer than ${MIN_DAYS} days with flux data in a window (before ${before.n.gpp}, after ${after.n.gpp})`
            : `excluded: measured fraction of NEE below ${MIN_FRAC * 100} % in a window`;
    const coSowing = sowing.filter((e) => e.site === site && overlaps(evLo(e), evHi(e), ep.start, ep.end));
    const withTillage = ep.classes.includes('tillage') || coSowing.length > 0;
    const withHarvest = ep.classes.includes('harvest-cut');
    const nIn = finite(ep.events.filter((e) => e.cls === 'fertilisation').map((e) => e.nKgHa));
    const weather = {
      ta: delta.ta ?? null,
      lightPct: before.n.light! >= MIN_DAYS && after.n.light! >= MIN_DAYS ? pct(after.mean.light, before.mean.light) : null,
      rain: delta.rain === null || delta.rain === undefined ? null : delta.rain * (AFTER.to - AFTER.from + 1),
      swc: delta.swc ?? null,
    };
    const sf = siteFits.get(site)!;
    const obs = delta.gpp ?? null;
    const canFit = obs !== null && weather.ta !== null && weather.lightPct !== null;
    const expectedGpp = canFit && sf.fit ? predictMulti(sf.fit.coef, [weather.ta!, weather.lightPct!]) : null;
    const residualGpp = expectedGpp === null ? null : obs! - expectedGpp;
    const expectedSwc = canFit && sf.fitSwc && weather.swc !== null ? predictMulti(sf.fitSwc.coef, [weather.ta!, weather.lightPct!, weather.swc]) : null;
    const expected10 = canFit && sf.fit10 ? predictMulti(sf.fit10.coef, [weather.ta!, weather.lightPct!]) : null;
    const relGppPct = obs !== null && (before.mean.gpp ?? 0) >= MIN_GPP_BEFORE ? (100 * obs) / before.mean.gpp! : null;
    const pooledPred = relGppPct !== null && canFit && pooledFit ? predictMulti(pooledFit.coef, [weather.ta!, weather.lightPct!]) : null;
    const matches = canFit ? nearestControls(sf.pairs, { ta: weather.ta!, lightPct: weather.lightPct! }, TOL_TA, TOL_LIGHT_PCT) : [];
    const controlDelta = matches.length >= MIN_MATCHED ? mean(matches.map((p) => p.dGpp)) : null;
    const lb = before.n.lue! >= MIN_DAYS ? (before.mean.lue ?? null) : null;
    const la = after.n.lue! >= MIN_DAYS ? (after.mean.lue ?? null) : null;
    const fluxUsed = fluxExclusion === null;
    fertResults.push({
      id: `${site}-${isoDay(ep.start)}`,
      site,
      kind: ep.kind,
      classes: ep.classes,
      fert: ep.fert,
      withTillage,
      withHarvest,
      inSummary: fluxUsed && !withHarvest && residualGpp !== null,
      nKgHa: nIn.length ? nIn.reduce((a, b) => a + b, 0) : null,
      start: isoDay(ep.start),
      end: isoDay(ep.end),
      doy: dayOfYear(ep.start),
      events: ep.events.map((e) => ({ date: e.date, type: e.type, detail: e.detail })),
      coEvents: coSowing.map((e) => ({ date: e.date, type: e.type, detail: e.detail })),
      fluxUsed,
      fluxExclusion,
      fluxUse,
      before: windowJson(before),
      after: windowJson(after),
      delta: { gpp: obs, reco: delta.reco ?? null, nee: delta.nee ?? null, relGppPct },
      weather,
      expectedGpp,
      residualGpp,
      residualRank: residualGpp === null || sf.sortedResid.length === 0 ? null : rankAmong(sf.sortedResid, residualGpp),
      rawRank: obs === null || sf.sortedGpp.length === 0 ? null : rankAmong(sf.sortedGpp, obs),
      nControls: sf.pairs.length,
      check: {
        expectedSwc,
        residualSwc: expectedSwc === null ? null : obs! - expectedSwc,
        residual10: expected10 === null ? null : obs! - expected10,
        residualRank10: expected10 === null || sf.sortedResid10.length === 0 ? null : rankAmong(sf.sortedResid10, obs! - expected10),
        pooledResidualPct: pooledPred === null ? null : relGppPct! - pooledPred,
      },
      matched: { n: matches.length, controlDelta, diff: controlDelta === null || obs === null ? null : obs - controlDelta },
      lightNorm: { before: lb, after: la, delta: lb === null || la === null ? null : la - lb, pct: pct(la, lb) },
    });
  }

  let fertSeed = 7000;
  function fertSummary(list: readonly FertResult[]) {
    const s = (fertSeed += 20);
    const ranks = list.map((e) => e.residualRank).filter((x): x is number => x !== null);
    const raw = list.map((e) => e.rawRank).filter((x): x is number => x !== null);
    return {
      n: list.length,
      sites: Object.fromEntries(SITES.map((x) => [x, list.filter((e) => e.site === x).length])),
      observed: summarise(list.map((e) => e.delta.gpp), s),
      expected: summarise(list.map((e) => e.expectedGpp), s + 1),
      residual: summarise(list.map((e) => e.residualGpp), s + 2),
      residualRank: summarise(ranks, s + 3),
      nResidualAbove90: ranks.filter((r) => r > RANK_HIGH).length,
      nResidualBelow10: ranks.filter((r) => r < RANK_LOW).length,
      nRawAbove90: raw.filter((r) => r > RANK_HIGH).length,
      relGppPct: summarise(list.map((e) => e.delta.relGppPct), s + 4),
      reco: summarise(list.map((e) => e.delta.reco), s + 5),
      nee: summarise(list.map((e) => e.delta.nee), s + 6),
      ta: summarise(list.map((e) => e.weather.ta), s + 7),
      lightPct: summarise(list.map((e) => e.weather.lightPct), s + 8),
      rain: summarise(list.map((e) => e.weather.rain), s + 9),
      swc: summarise(list.map((e) => e.weather.swc), s + 10),
      nMatched: list.filter((e) => e.matched.diff !== null).length,
      matchedDiff: summarise(list.map((e) => e.matched.diff), s + 11),
      lightNormPct: summarise(list.map((e) => e.lightNorm.pct), s + 12),
      residualSwc: summarise(list.map((e) => e.check.residualSwc), s + 13),
      residual10: summarise(list.map((e) => e.check.residual10), s + 14),
      pooledResidualPct: summarise(list.map((e) => e.check.pooledResidualPct), s + 15),
    };
  }
  const fs = fertResults.filter((e) => e.inSummary);
  const fertilisation = {
    controls: controlsJson,
    pooledRelative: { nPairs: pooled.length, fit: fitJson(pooledFit) },
    summary: {
      all: fertSummary(fs),
      fertOnly: fertSummary(fs.filter((e) => !e.withTillage)),
      withTillage: fertSummary(fs.filter((e) => e.withTillage)),
      mineral: fertSummary(fs.filter((e) => e.fert === 'mineral')),
      organic: fertSummary(fs.filter((e) => e.fert === 'organic')),
    },
    episodes: fertResults,
  };

  // ---------- Counts ----------
  const fluxExclusions: Record<string, number> = { overlap: 0, 'too-few-days': 0, 'low-measured-fraction': 0 };
  for (const e of harvests) if (e.fluxExclusion) fluxExclusions[e.fluxExclusion]! += 1;
  const fertExclusions: Record<string, number> = { overlap: 0, 'too-few-days': 0, 'low-measured-fraction': 0 };
  for (const e of fertResults) if (e.fluxExclusion) fertExclusions[e.fluxExclusion]! += 1;
  const timingUsed = harvests.filter((e) => e.timing.used);
  const counts = {
    events: allEvents.length,
    harvestCutEvents: harvestEvents.length,
    episodes: harvests.length,
    perGroup: Object.fromEntries(HARVEST_GROUPS.map((g) => [g, harvests.filter((e) => e.group === g).length])),
    perGroupFlux: Object.fromEntries(HARVEST_GROUPS.map((g) => [g, harvestUsed.filter((e) => e.group === g).length])),
    fluxUsed: harvestUsed.length,
    fluxExcluded: harvests.length - harvestUsed.length,
    fluxExclusions,
    overrides: OVERRIDES.length,
    timingUsed: timingUsed.length,
    timingClear: timingUsed.filter((e) => e.timing.gpp.clear).length,
    timingNoDrop: timingUsed.filter((e) => !e.timing.gpp.clear).length,
    timingNeeClear: timingUsed.filter((e) => e.timing.nee.clear).length,
    fertEpisodes: fertResults.length,
    fertFluxUsed: fertResults.filter((e) => e.fluxUsed).length,
    fertWithHarvest: fertResults.filter((e) => e.withHarvest).length,
    fertInSummary: fs.length,
    fertExclusions,
    controlPairs: [...siteFits.values()].reduce((a, f) => a + f.pairs.length, 0),
    frozenSwcDays: frozenDays,
  };

  const harvestIds = new Set(harvests.map((e) => e.id));
  const highlightKey = (id: string, source: 'harvest' | 'fertilisation') =>
    source === 'fertilisation' && harvestIds.has(id) ? `${id}-fert` : id;
  const highlights = Object.fromEntries(
    HIGHLIGHTS.map(({ id, source }) => {
      const episode = source === 'harvest' ? harvests.find((e) => e.id === id) : fertResults.find((e) => e.id === id);
      if (!episode) throw new Error(`highlight ${source} episode ${id} not found`);
      return [highlightKey(id, source), { source, episode }];
    }),
  );

  const result = {
    question:
      'How do cuts, silage harvests and grain harvests change NEE, GPP and Reco at five Finnish sites, does the GPP drop start before the recorded harvest day, and is the GPP change after a fertilisation larger than the change that the weather of the same days gives?',
    method: {
      sites: [...SITES],
      lightVar: LIGHT_VAR,
      lightUnit: LIGHT_UNIT,
      minLightForLue: MIN_LIGHT_FOR_LUE,
      groups: HARVEST_GROUPS.map((g) => ({ id: g, label: HARVEST_GROUP_LABELS[g] })),
      mergeDays: MERGE_DAYS,
      overrides: OVERRIDES,
      beforeDays: BEFORE.to - BEFORE.from + 1,
      afterDays: AFTER.to - AFTER.from + 1,
      lateFrom: LATE.from,
      lateTo: LATE.to,
      shortDays: AFTER7.to - AFTER7.from + 1,
      minDays: MIN_DAYS,
      minDays7: MIN_DAYS_7,
      minFracPct: MIN_FRAC * 100,
      minGppBefore: MIN_GPP_BEFORE,
      minMeasuredWindow: MIN_MEASURED_WINDOW,
      minSwcRows: MIN_SWC_ROWS,
      minRainRows: MIN_RAIN_ROWS,
      minLightRows: MIN_LIGHT_ROWS,
      bootstrapResamples: BOOTSTRAP_RESAMPLES,
      ciLevelPct: 95,
      alpha: 0.05,
      recoveryFrom: RECOVERY.from,
      recoveryTo: RECOVERY.to,
      recoverySharePct: RECOVERY_SHARE_PCT,
      recoveryMaxDays: RECOVERY_MAX_DAYS,
      recoveryRunDays: RECOVERY_RUN_DAYS,
      recoveryMinRun: RECOVERY_MIN_RUN,
      searchFrom: SEARCH_FROM,
      searchTo: SEARCH_TO,
      sideDays: SIDE_DAYS,
      minSideGpp: MIN_SIDE_GPP,
      minSideNee: MIN_SIDE_NEE,
      minBeforeGpp: MIN_BEFORE_GPP,
      minBeforeNee: MIN_BEFORE_NEE,
      minDropPct: MIN_DROP_PCT,
      minMeasuredHalfHours: MIN_MEASURED_HH,
      agreeDays: AGREE_DAYS,
      preNearFrom: PRE_NEAR.from,
      preNearTo: PRE_NEAR.to,
      preFarFrom: PRE_FAR.from,
      preFarTo: PRE_FAR.to,
      timingCompositeFrom: TIMING_COMPOSITE.from,
      timingCompositeTo: TIMING_COMPOSITE.to,
      timingRefFrom: TIMING_REF.from,
      timingRefTo: TIMING_REF.to,
      minTimingRefDays: MIN_TIMING_REF_DAYS,
      compositeFrom: COMPOSITE.from,
      compositeTo: COMPOSITE.to,
      controlHalfWidth: CONTROL_HALF_WIDTH,
      controlHalfWidthSens: CONTROL_HALF_WIDTH_SENS,
      maskBefore: MASK_BEFORE,
      maskAfter: MASK_AFTER,
      tolTa: TOL_TA,
      tolLightPct: TOL_LIGHT_PCT,
      minMatched: MIN_MATCHED,
      collinearR: COLLINEAR_R,
      minControlYears: MIN_CONTROL_YEARS,
      rankHigh: RANK_HIGH,
      rankLow: RANK_LOW,
      halfHoursPerDay: 48,
      utcShiftHours: 2,
      utcShiftHalfHours: 4,
      haltialaSwc2021Used: true,
      units: {
        daily: 'g C m-2 d-1',
        measured: 'µmol CO2 m-2 s-1',
        swc: 'm3 m-3',
        rain: 'mm per 14 days',
        ta: '°C',
        lightPct: '%',
        yield: 'kg DW/ha',
        lue: 'g C mol-1 (PPFD sites) or g C MJ-1 (Qvidja)',
        recoveryShare: '% of the mean GPP before',
        offsets: 'days',
      },
      decisions: [
        'Harvest episodes: harvest and cut events only, merged within 7 days; overrides as listed.',
        'Harvest episode overlap: a grazing or tillage event, or another harvest or cut episode, whose days touch the before or after window. A fertilisation in the windows only sets fertInWindow; deltaNoFert gives each group without these episodes.',
        'Relative change of NEE: percent of the mean GPP of the 14-day before window; GPP and Reco: percent of their own mean before (minimum 0.5 g C m-2 d-1).',
        'Late window and recovery share: null when another harvest, cut, grazing or tillage touches days 15 to 28 (late) or when a harvest, cut or grazing starts in days 1 to 28 (recovery).',
        'Days to recover: censored when the next harvest, cut or grazing starts before the running mean reaches it, when the data end, or after 60 days.',
        'Timing: used when no grazing, tillage or other harvest episode touches the search span (start − 15 to end + 9) and GPP has enough days for at least one candidate day. Offsets to the first recorded event date (before the overrides). Days with a measured fraction below 10 % are listed, not removed.',
        'Change point on measured day-time NEE: daily mean of measured day-time half hours (at least 8), search on −NEE, at least 3 of 5 days per side, minimum mean before 1 µmol m-2 s-1.',
        'Fertilisation episodes with a harvest or cut (kind harvestCutFert) are listed, but not in the summaries.',
        'Control pairs: anchors in all years with data within ±21 days of the day of year of each fertilisation episode of the site (union); a pair is dropped when a day of the windows is within 14 days of any management event of the site, when a flux, ta or light side has fewer than 12 days, when the measured fraction is below 10 %, or when the light before is 0.',
        'Rain change = (mean after − mean before) × 14 days. Δrain is descriptive only (Haltiala uses the Viikki rain; Qvidja 2022 has gaps).',
        'Daily light sum = mean of max(light, 0) over the half hours of the local day × 86 400 s / 1e6 (at least 44 half hours).',
        'Light-normalised GPP = daily GPP / daily light sum, days with a light sum of at least 1 mol m-2 d-1 (PPFD) or 0.5 MJ m-2 d-1 (SW_IN).',
        'Fertiliser kind: "Synthetic N" (Anttila, Särkisuo) is mineral.',
        'residualRank and rawRank = percent of the control values (residuals or ΔGPP) of the site below the value of the episode (rankAmong; 0 to 100).',
      ],
    },
    counts,
    sites: Object.fromEntries(
      SITES.map((s) => [
        s,
        {
          name: siteName.get(s),
          siteId: siteId.get(s),
          slot: siteSlot.get(s),
          lightVar: LIGHT_VAR[s],
          lightUnit: LIGHT_UNIT[LIGHT_VAR[s]],
          rainSource: RAIN_SOURCE[s],
          years: [...years.get(s)!].sort(),
          events: allEvents.filter((e) => e.site === s).length,
          episodes: harvests.filter((e) => e.site === s).length,
          fluxUsed: harvestUsed.filter((e) => e.site === s).length,
          fertEpisodes: fertResults.filter((e) => e.site === s).length,
          fertInSummary: fs.filter((e) => e.site === s).length,
        },
      ]),
    ),
    groups,
    harvestEpisodes: harvests,
    yield: yieldFits,
    timing,
    fertilisation,
    composite: { offsets: compOffsets, groups: composite },
    highlights,
    literature: { heimsch2021: HEIMSCH_2021 },
  };
  assertFinite(result);
  return result;
}
