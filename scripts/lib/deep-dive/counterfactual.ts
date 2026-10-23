// Pure helpers of the Deep Dive "NEE without harvest and drought"
// (scripts/deep-dives/nee-without-harvest-drought.ts). No I/O, no DuckDB.
// Unit test: counterfactual.test.ts.
//
// Types at a glance (the dive script makes them from the Parquet files):
//
//   HalfHour   One 30-minute row of data/calculated/fluxes_30min.parquet with its local day.
//              Flux values in µmol CO2 m-2 s-1, light in µmol m-2 s-1 (PPFD) or W m-2 (sw_in),
//              temperature in °C, E0 in K.
//   EpisodeModel  The weather-driven model of one harvest episode, fitted on the PRE days:
//              GPP = rectangular hyperbola of light (fitLight, sign +1, no gamma),
//              Reco = Lloyd-Taylor with E0 fixed (fitRref), NEE = Reco − GPP.
//   DailyDeficit  Daily mean of (observed − model) NEE in g C m-2 d-1. Positive = uptake lost.
//   DeficitSummary  Sums and the recovery day of one AFTER window.
//   MonthRow   One site-month for the drought anomaly (NEE_adj = NEE_obs − harvest deficit).
//   SeasonInput / SeasonRow  One site-month in, one site × year × season out.
//
// Sign rules: NEE < 0 = uptake. deficit = NEE_obs − NEE_cf, thus positive = less uptake
// than the model expects. deficit = gppPart + recoPart exactly when nee = reco − gpp row by row.

import { fitLight, lightModel } from '../../../site/src/scripts/diagrams/fit.ts';
import { fitRref, ltModel } from '../calc/lloyd-taylor.ts';
import { CONST } from '../calc/constants.ts';
import { isoDay } from './harvest.ts';
import { finite, mean, median, ols, quantile, rng, sd } from './stats.ts';

/** g C m-2 for 1 µmol CO2 m-2 s-1 over one 30-minute period (1800 × 12.011e-6). */
export const HH_TO_GC = CONST.hhToGc;
/** Half hours per day. */
export const HH_PER_DAY = 48;
/** Daytime rows for the light fit: light above this value. */
export const LIGHT_MIN = 20;

/** One 30-minute row. */
export interface HalfHour {
  /** dayNumber() of the local day. */
  day: number;
  /** Light driver: ppfd or sw_in. Null when missing. */
  light: number | null;
  /** Air temperature of the partitioning (temp_f, °C). */
  temp: number | null;
  /** Gap-filled NEE (nee_f). */
  nee: number | null;
  /** True when the NEE of this row is measured (not gap-filled). */
  neeMeasured: boolean;
  gpp: number | null;
  reco: number | null;
  /** E0 of the partitioning for this row (K). */
  e0: number | null;
}

const isNum = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** Light bin: mean light, mean GPP and count of the rows in the bin. */
export interface LightBin {
  light: number;
  gpp: number;
  n: number;
}

/**
 * Put the daytime rows (light > LIGHT_MIN, finite gpp) into bins of width `binWidth` of the light
 * (bin k = floor(light / binWidth)). Returns the bins sorted by light.
 */
export function binByLight(rows: readonly HalfHour[], binWidth: number): LightBin[] {
  if (!(binWidth > 0)) throw new Error(`binByLight: bad bin width ${binWidth}`);
  const acc = new Map<number, { sl: number; sg: number; n: number }>();
  for (const r of rows) {
    if (!isNum(r.light) || r.light <= LIGHT_MIN || !isNum(r.gpp)) continue;
    const k = Math.floor(r.light / binWidth);
    const a = acc.get(k) ?? { sl: 0, sg: 0, n: 0 };
    a.sl += r.light;
    a.sg += r.gpp;
    a.n += 1;
    acc.set(k, a);
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, a]) => ({ light: a.sl / a.n, gpp: a.sg / a.n, n: a.n }));
}

/** Model of one episode, fitted on the PRE days. */
export interface EpisodeModel {
  /** Light response of GPP: GPP = alpha Q beta / (alpha Q + beta). */
  alpha: number;
  beta: number;
  /** True when beta is at its upper bound (no light saturation in the PRE data). */
  betaBound: boolean;
  /** Weighted R² of the light fit on the bin means. */
  r2: number;
  nBins: number;
  /** Lloyd-Taylor Reco at 15 °C, with E0 fixed to `e0`. */
  rref: number;
  /** Median E0 of the PRE rows (K). */
  e0: number;
  /** PRE days with at least one row that has temp, gpp and reco. */
  nPreDays: number;
  /** In-sample mean and RMSE of (nee − model NEE) over the PRE rows with light, temp and nee (µmol m-2 s-1). */
  biasNee: number;
  rmseNee: number;
  nNee: number;
}

export type NoFitReason = 'too-few-days' | 'too-few-bins' | 'light-fit-failed' | 'no-e0' | 'reco-fit-failed';

export interface NoFit {
  excluded: 'no-fit';
  reason: NoFitReason;
}

export interface FitOptions {
  /** Light bin width: 50 for PPFD, 25 for sw_in. */
  binWidth: number;
  /** Minimum PRE days with data (plan: 10). */
  minPreDays: number;
  /** Minimum light bins (plan: 8). */
  minBins: number;
}

export function isNoFit(m: EpisodeModel | NoFit): m is NoFit {
  return 'excluded' in m;
}

/** Model values of one row. Null fields when light or temp is missing. */
export interface CfRow {
  neeCf: number | null;
  gppCf: number | null;
  recoCf: number | null;
}

/**
 * Model value of one row. Negative light (sensor offset at night) counts as 0. The model has no
 * night cut: at light near 0 the GPP of the model is near 0.
 */
function cfOf(m: Pick<EpisodeModel, 'alpha' | 'beta' | 'rref' | 'e0'>, r: HalfHour): CfRow {
  const gppCf = isNum(r.light) ? lightModel(Math.max(0, r.light), 1, m.alpha, m.beta, 0) : null;
  const recoCf = isNum(r.temp) ? ltModel(r.temp, m.rref, m.e0) : null;
  return { gppCf, recoCf, neeCf: gppCf !== null && recoCf !== null ? recoCf - gppCf : null };
}

/**
 * Fit the model of one episode on the PRE rows.
 * GPP: fitLight on the light bins (sign +1), must converge. Reco: fitRref on all rows with finite
 * temp, reco and e0, with one E0 = the median E0 of these rows.
 * Returns `{ excluded: 'no-fit', reason }` when a step fails.
 */
export function fitEpisodeModel(preRows: readonly HalfHour[], opts: FitOptions): EpisodeModel | NoFit {
  const days = new Set<number>();
  for (const r of preRows) if (isNum(r.temp) && isNum(r.gpp) && isNum(r.reco)) days.add(r.day);
  if (days.size < opts.minPreDays) return { excluded: 'no-fit', reason: 'too-few-days' };

  const bins = binByLight(preRows, opts.binWidth);
  if (bins.length < opts.minBins) return { excluded: 'no-fit', reason: 'too-few-bins' };
  const fit = fitLight(
    bins.map((b) => b.light),
    bins.map((b) => b.gpp),
    bins.map((b) => b.n),
    1,
  );
  if (!fit || !fit.converged || !Number.isFinite(fit.alpha) || !Number.isFinite(fit.beta)) {
    return { excluded: 'no-fit', reason: 'light-fit-failed' };
  }

  const rr = preRows.filter((r) => isNum(r.temp) && isNum(r.reco) && isNum(r.e0));
  const e0 = median(rr.map((r) => r.e0!));
  if (e0 === null) return { excluded: 'no-fit', reason: 'no-e0' };
  const lt = fitRref(
    rr.map((r) => r.temp!),
    rr.map((r) => r.reco!),
    e0,
  );
  if (!Number.isFinite(lt.rref)) return { excluded: 'no-fit', reason: 'reco-fit-failed' };

  const base = { alpha: fit.alpha, beta: fit.beta, rref: lt.rref, e0 };
  const res: number[] = [];
  for (const r of preRows) {
    if (!isNum(r.nee)) continue;
    const cf = cfOf(base, r);
    if (cf.neeCf !== null) res.push(r.nee - cf.neeCf);
  }
  const bias = mean(res);
  const rmse = res.length ? Math.sqrt(res.reduce((s, x) => s + x * x, 0) / res.length) : null;
  return {
    ...base,
    betaBound: fit.betaBound,
    r2: fit.r2,
    nBins: fit.n,
    nPreDays: days.size,
    biasNee: bias ?? Number.NaN,
    rmseNee: rmse ?? Number.NaN,
    nNee: res.length,
  };
}

/** Model values of each row, in the order of `rows`. */
export function applyModel(model: Pick<EpisodeModel, 'alpha' | 'beta' | 'rref' | 'e0'>, rows: readonly HalfHour[]): CfRow[] {
  return rows.map((r) => cfOf(model, r));
}

/** Deficit of one AFTER day (g C m-2 d-1). */
export interface DailyDeficit {
  day: number;
  /** Rows used: finite nee and a model value (with measuredOnly: measured rows only). */
  n: number;
  /** mean(nee − neeCf) × 48 × HH_TO_GC. Positive = uptake lost. */
  deficit: number;
  /** mean(gppCf − gpp) × 48 × HH_TO_GC over the rows that also have gpp and reco. Null when none. */
  gppPart: number | null;
  /** mean(reco − recoCf) × 48 × HH_TO_GC over the same rows. Null when none. */
  recoPart: number | null;
  /** Rows used for gppPart and recoPart. */
  nParts: number;
  /** n ≥ minHalfHours. */
  valid: boolean;
}

export interface DeficitOptions {
  /** A day is valid with at least this many rows (plan: 40). */
  minHalfHours: number;
  /** Use only the rows with measured NEE (sensitivity test). */
  measuredOnly?: boolean;
}

/**
 * Daily deficit of the AFTER rows, sorted by day. Days without a usable row are not in the result.
 * When nee = reco − gpp in each row and all rows have gpp and reco, deficit = gppPart + recoPart.
 */
export function dailyDeficit(model: Pick<EpisodeModel, 'alpha' | 'beta' | 'rref' | 'e0'>, afterRows: readonly HalfHour[], opts: DeficitOptions): DailyDeficit[] {
  const k = HH_PER_DAY * HH_TO_GC;
  const acc = new Map<number, { n: number; s: number; np: number; sg: number; sr: number }>();
  for (const r of afterRows) {
    if (!isNum(r.nee)) continue;
    if (opts.measuredOnly && !r.neeMeasured) continue;
    const cf = cfOf(model, r);
    if (cf.neeCf === null) continue;
    const a = acc.get(r.day) ?? { n: 0, s: 0, np: 0, sg: 0, sr: 0 };
    a.n += 1;
    a.s += r.nee - cf.neeCf;
    if (isNum(r.gpp) && isNum(r.reco)) {
      a.np += 1;
      a.sg += cf.gppCf! - r.gpp;
      a.sr += r.reco - cf.recoCf!;
    }
    acc.set(r.day, a);
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, a]) => ({
      day,
      n: a.n,
      deficit: (a.s / a.n) * k,
      gppPart: a.np ? (a.sg / a.np) * k : null,
      recoPart: a.np ? (a.sr / a.np) * k : null,
      nParts: a.np,
      valid: a.n >= opts.minHalfHours,
    }));
}

export interface SummaryOptions {
  /** Window length (plan: 28). `daysUsed` is never larger. */
  afterDays: number;
  /** Early part (plan: 14). */
  earlyDays: number;
  /** Window valid when validDays ≥ this share of daysUsed (plan: 0.8). */
  minValidShare: number;
  /** Recovery rule (plan: fromDay 7, span 5, share 0.25). */
  recovery: { fromDay: number; span: number; share: number };
}

/** Plan defaults of deficitSummary(). */
export const SUMMARY_DEFAULTS: SummaryOptions = {
  afterDays: 28,
  earlyDays: 14,
  minValidShare: 0.8,
  recovery: { fromDay: 7, span: 5, share: 0.25 },
};

/** Sums of one AFTER window (g C m-2). Numbers are null when the window is excluded. */
export interface DeficitSummary {
  /** Days in the window: min(afterDays, the `days` argument). */
  daysUsed: number;
  validDays: number;
  excluded: null | 'too-few-days';
  /** Sum of the daily deficits of days 1..min(earlyDays, daysUsed). */
  d14: number | null;
  /** Sum of the daily deficits of days 1..daysUsed. */
  d28: number | null;
  /** Sum of gppPart and of recoPart over days 1..daysUsed. */
  gpp28: number | null;
  reco28: number | null;
  /** d14 / d28. Null when d28 is 0. */
  share14: number | null;
  /** Day (1-based) of recovery, or null (no recovery in the window, or early mean ≤ 0). */
  recoveryDay: number | null;
  /** Cumulative deficit at the end of each day 1..daysUsed. Empty when excluded. */
  cum: number[];
}

/**
 * Summary of the daily deficits of one AFTER window. Day 1 is `first` (day number), the window has
 * `days` days (the caller truncates it at the next episode). A day that is missing or not valid
 * gets the mean of the valid days (for deficit, gppPart and recoPart separately).
 * Recovery day = first d ≥ fromDay with mean(deficit of days d..d+span−1) ≤ share × mean(deficit of
 * days 1..fromDay). Only full spans inside the window count.
 */
export function deficitSummary(daily: readonly DailyDeficit[], first: number, days: number, opts: SummaryOptions = SUMMARY_DEFAULTS): DeficitSummary {
  const daysUsed = Math.max(0, Math.min(opts.afterDays, days));
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const inWin: (DailyDeficit | null)[] = [];
  for (let i = 0; i < daysUsed; i++) {
    const d = byDay.get(first + i);
    inWin.push(d && d.valid ? d : null);
  }
  const valid = inWin.filter((d): d is DailyDeficit => d !== null);
  const validDays = valid.length;
  const empty = { d14: null, d28: null, gpp28: null, reco28: null, share14: null, recoveryDay: null, cum: [] };
  if (daysUsed === 0 || validDays < opts.minValidShare * daysUsed) {
    return { daysUsed, validDays, excluded: 'too-few-days', ...empty };
  }
  const fill = (pick: (d: DailyDeficit) => number | null): number[] | null => {
    const m = mean(finite(valid.map(pick)));
    if (m === null) return null;
    return inWin.map((d) => (d && isNum(pick(d)) ? pick(d)! : m));
  };
  const def = fill((d) => d.deficit)!;
  const gp = fill((d) => d.gppPart);
  const rp = fill((d) => d.recoPart);
  const sum = (xs: readonly number[], n = xs.length) => xs.slice(0, n).reduce((a, b) => a + b, 0);
  const d14 = sum(def, Math.min(opts.earlyDays, daysUsed));
  const d28 = sum(def);
  const cum: number[] = [];
  let c = 0;
  for (const x of def) cum.push((c += x));

  const { fromDay, span, share } = opts.recovery;
  let recoveryDay: number | null = null;
  const early = mean(def.slice(0, fromDay));
  if (early !== null && early > 0) {
    for (let d = fromDay; d + span - 1 <= daysUsed; d++) {
      const m = mean(def.slice(d - 1, d - 1 + span))!;
      if (m <= share * early) {
        recoveryDay = d;
        break;
      }
    }
  }
  return {
    daysUsed,
    validDays,
    excluded: null,
    d14,
    d28,
    gpp28: gp ? sum(gp) : null,
    reco28: rp ? sum(rp) : null,
    share14: d28 !== 0 ? d14 / d28 : null,
    recoveryDay,
    cum,
  };
}

/** Month `yyyy-mm` of a day number. */
export function ymOfDay(day: number): string {
  return isoDay(day).slice(0, 7);
}

/** Sum of the deficits of the valid days per month (g C m-2). Missing or invalid days add nothing. */
export function allocateByMonth(daily: readonly DailyDeficit[], dayToYm: (day: number) => string = ymOfDay): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of daily) {
    if (!d.valid) continue;
    const ym = dayToYm(d.day);
    out[ym] = (out[ym] ?? 0) + d.deficit;
  }
  return out;
}

export type CropClass = 'grass' | 'cereal' | 'other';

/**
 * Crop class per site and year (management files). A string = all years.
 * Viikki 2023 = barley with grass and red clover (cereal), 2025 = faba bean (other).
 * Haltiala 2023 = failed grass (other), 2024 = sunflower (other).
 */
export const CROP_CLASS: Readonly<Record<string, CropClass | Readonly<Record<number, CropClass>>>> = {
  qvidja: 'grass',
  viikki: { 2022: 'grass', 2023: 'cereal', 2024: 'grass', 2025: 'other' },
  haltiala: { 2021: 'cereal', 2022: 'cereal', 2023: 'other', 2024: 'other', 2025: 'cereal' },
};

/** Crop class of a site and year. Throws for a site or year that is not in CROP_CLASS. */
export function cropClass(site: string, year: number): CropClass {
  const e = CROP_CLASS[site.toLowerCase()];
  if (e === undefined) throw new Error(`cropClass: unknown site ${site}`);
  if (typeof e === 'string') return e;
  const c = e[year];
  if (c === undefined) throw new Error(`cropClass: no crop class for ${site} ${year}`);
  return c;
}

/** One site-month for the drought anomaly. */
export interface MonthRow {
  site: string;
  year: number;
  /** 1..12. */
  month: number;
  /** NEE_obs − harvest deficit of the month (g C m-2 month-1). */
  neeAdj: number | null;
  /** SPI-1 ≤ −1. */
  dry: boolean;
  crop: CropClass;
  /** True: never in a reference set (for example Qvidja 2025, harvest unknown). */
  excludeFromRef?: boolean;
}

export interface MonthRef {
  n: number;
  mean: number;
  sd: number | null;
  years: number[];
}

export interface MonthAnomaly {
  refKind: 'crop' | 'all' | null;
  ref: MonthRef | null;
  /** target.neeAdj − ref.mean. Null without a reference or without target.neeAdj. */
  anomaly: number | null;
}

/**
 * Anomaly of one month against the same calendar month of the other years of the site that are not
 * dry and not excluded. Reference = the years with the same crop class when there are at least
 * `minRefYears`, else all such years when there are at least `minRefYears`, else none.
 */
export function monthAnomaly(target: MonthRow, candidates: readonly MonthRow[], opts: { minRefYears: number } = { minRefYears: 2 }): MonthAnomaly {
  const pool = candidates.filter(
    (c) => c.site === target.site && c.month === target.month && c.year !== target.year && !c.dry && !c.excludeFromRef && isNum(c.neeAdj),
  );
  const crop = pool.filter((c) => c.crop === target.crop);
  const pick = crop.length >= opts.minRefYears ? { kind: 'crop' as const, rows: crop } : pool.length >= opts.minRefYears ? { kind: 'all' as const, rows: pool } : null;
  if (!pick) return { refKind: null, ref: null, anomaly: null };
  const rows = [...pick.rows].sort((a, b) => a.year - b.year);
  const xs = rows.map((r) => r.neeAdj!);
  const ref = { n: xs.length, mean: mean(xs)!, sd: sd(xs), years: rows.map((r) => r.year) };
  return { refKind: pick.kind, ref, anomaly: isNum(target.neeAdj) ? target.neeAdj - ref.mean : null };
}

export type Season = 'MAM' | 'JJA' | 'SON';

/** Season of a month (1..12): MAM, JJA, SON. Null for the winter months 12, 1, 2. */
export function seasonOf(month: number): Season | null {
  if (month >= 3 && month <= 5) return 'MAM';
  if (month >= 6 && month <= 8) return 'JJA';
  if (month >= 9 && month <= 11) return 'SON';
  return null;
}

/** One site-month for the season table. */
export interface SeasonInput {
  site: string;
  year: number;
  month: number;
  /** Observed NEE of the month (g C m-2). Null when the month has too few days. */
  nee: number | null;
  /** Days with data in the month. */
  nDays: number;
  /** True when the month passes the day rule (plan: ≥ 25 days). */
  complete: boolean;
  dry: boolean;
  /** Harvest episodes that start in the month. */
  nHarvests: number;
  /** Harvest deficit allocated to the month (allocateByMonth). */
  harvestDeficit: number;
  /** Drought anomaly of the month (monthAnomaly). Used only when `dry`; null = no reference. */
  droughtAnomaly: number | null;
}

export interface SeasonRow {
  site: string;
  year: number;
  season: Season;
  /** Sum of the monthly NEE that is not null. */
  nee: number;
  nDays: number;
  /** All three months are present and complete. */
  complete: boolean;
  /** Months `yyyy-mm` that are dry. */
  dryMonths: string[];
  nDry: number;
  /** Dry months without a reference (their anomaly counts as 0). */
  nDryNoRef: number;
  nHarvests: number;
  harvestDeficit: number;
  /** Sum of the anomalies of the dry months. 0 when there is none. */
  droughtAnomaly: number;
  /** nee − harvestDeficit − droughtAnomaly. */
  neeWithout: number;
}

const SEASON_ORDER: Record<Season, number> = { MAM: 0, JJA: 1, SON: 2 };

/** Group the site-months into site × year × season rows (winter months are ignored). Sorted by site, year, season. */
export function seasonTable(months: readonly SeasonInput[]): SeasonRow[] {
  const groups = new Map<string, { site: string; year: number; season: Season; rows: SeasonInput[] }>();
  for (const m of months) {
    const season = seasonOf(m.month);
    if (!season) continue;
    const key = `${m.site}|${m.year}|${season}`;
    const g = groups.get(key) ?? { site: m.site, year: m.year, season, rows: [] };
    g.rows.push(m);
    groups.set(key, g);
  }
  const out: SeasonRow[] = [];
  for (const g of groups.values()) {
    const rows = [...g.rows].sort((a, b) => a.month - b.month);
    const months = new Set(rows.map((r) => r.month));
    const nee = rows.reduce((s, r) => s + (isNum(r.nee) ? r.nee : 0), 0);
    const dry = rows.filter((r) => r.dry);
    const harvestDeficit = rows.reduce((s, r) => s + r.harvestDeficit, 0);
    const droughtAnomaly = dry.reduce((s, r) => s + (isNum(r.droughtAnomaly) ? r.droughtAnomaly : 0), 0);
    out.push({
      site: g.site,
      year: g.year,
      season: g.season,
      nee,
      nDays: rows.reduce((s, r) => s + r.nDays, 0),
      complete: months.size === 3 && rows.every((r) => r.complete && isNum(r.nee)),
      dryMonths: dry.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`),
      nDry: dry.length,
      nDryNoRef: dry.filter((r) => !isNum(r.droughtAnomaly)).length,
      nHarvests: rows.reduce((s, r) => s + r.nHarvests, 0),
      harvestDeficit,
      droughtAnomaly,
      neeWithout: nee - harvestDeficit - droughtAnomaly,
    });
  }
  return out.sort((a, b) => a.site.localeCompare(b.site) || a.year - b.year || SEASON_ORDER[a.season] - SEASON_ORDER[b.season]);
}

export interface OlsCi {
  slope: number;
  intercept: number;
  /** Percentile bootstrap interval of the slope. */
  ciLo: number;
  ciHi: number;
  n: number;
  /** Resamples with a defined slope (a resample with all x equal has none). */
  resamples: number;
}

/**
 * OLS line of y on x with a percentile bootstrap CI of the slope (pairs resampled with rng(seed)).
 * Null for fewer than four pairs or when all x are equal.
 */
export function bootstrapOlsCi(xs: readonly number[], ys: readonly number[], level = 0.95, resamples = 2000, seed = 1): OlsCi | null {
  if (xs.length !== ys.length) throw new Error('bootstrapOlsCi: lists have different lengths');
  const n = xs.length;
  if (n < 4) return null;
  const fit = ols(xs, ys);
  if (!fit) return null;
  const next = rng(seed);
  const slopes: number[] = [];
  const bx = new Array<number>(n);
  const by = new Array<number>(n);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(next() * n);
      bx[i] = xs[j]!;
      by[i] = ys[j]!;
    }
    const f = ols(bx, by);
    if (f) slopes.push(f.slope);
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  const a = (1 - level) / 2;
  return { slope: fit.slope, intercept: fit.intercept, ciLo: quantile(slopes, a), ciHi: quantile(slopes, 1 - a), n, resamples: slopes.length };
}
