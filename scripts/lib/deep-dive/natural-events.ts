// Pure helpers of the Deep Dive "Natural events and disturbances" (scripts/deep-dives/natural-events.ts):
// the day mask around management events, runs of flagged days, calendar periods, percentile rank,
// detection of the event classes per site and the pooled period-year summary. No I/O.
// Unit test: natural-events.test.ts.
// `dayNumber` and `isoDay` come from harvest.ts (the first dive), `mean`, `sd`, `median` and `quantile` from stats.ts.

import { dayNumber, isoDay } from './harvest.ts';
import { finite, mean, median, quantile, sd } from './stats.ts';

/** Event classes of the dive. */
export const CLASSES = ['frost', 'heat', 'coldSpell', 'heavyRain', 'drySpell', 'failedRains', 'soilDrought', 'soilWet', 'zeroCurtain'] as const;
export type ClassId = (typeof CLASSES)[number];

/** Bit of each class in the point bitmask. Dry spell (Finland) and failed rains (Maktau) share one bit. */
export const CLASS_BITS: Record<ClassId, number> = {
  frost: 1,
  heat: 2,
  coldSpell: 4,
  heavyRain: 8,
  drySpell: 16,
  failedRains: 16,
  soilDrought: 32,
  soilWet: 64,
  zeroCurtain: 128,
};

/** Bitmask of a set of classes. */
export function classMask(classes: Iterable<ClassId>): number {
  let m = 0;
  for (const c of classes) m |= CLASS_BITS[c];
  return m;
}

// ---------- Human mask ----------

/** One dated management event (db/events.parquet). */
export interface DatedEvent {
  site: string;
  date: string;
  /** Last day of a multi-day event, else null. */
  dateEnd: string | null;
}

/**
 * Day numbers per site from `before` days before the first day to `after` days after the last day
 * of each event. Both ends are included.
 */
export function eventDayMask(events: readonly DatedEvent[], before = 2, after = 14): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const e of events) {
    const lo = dayNumber(e.date) - before;
    const hi = dayNumber(e.dateEnd ?? e.date) + after;
    let set = out.get(e.site);
    if (!set) out.set(e.site, (set = new Set()));
    for (let d = lo; d <= hi; d++) set.add(d);
  }
  return out;
}

// ---------- Runs ----------

/** First and last index of a run (both included). */
export interface Run {
  start: number;
  end: number;
}

/** Runs of true values with at least `minLen` elements. A false, null or undefined value breaks a run. */
export function runs(flags: readonly (boolean | null | undefined)[], minLen: number): Run[] {
  const out: Run[] = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i] === true) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLen) out.push({ start, end: i - 1 });
      start = -1;
    }
  }
  return out;
}

/** Episode of consecutive event days (ISO dates, both ends included). */
export interface DayEpisode {
  start: string;
  end: string;
  days: number;
}

/**
 * Episodes of consecutive flagged days. `days` are day numbers in ascending order; a missing day
 * (a gap in `days`) breaks a run as a false flag does.
 */
export function episodesFromFlags(days: readonly number[], flags: readonly (boolean | null | undefined)[], minLen: number): DayEpisode[] {
  if (days.length !== flags.length) throw new Error('days and flags have different lengths');
  // Put the flags on a continuous day axis: missing days become false.
  if (days.length === 0) return [];
  const first = days[0]!;
  const axis: boolean[] = new Array(days[days.length - 1]! - first + 1).fill(false);
  days.forEach((d, i) => {
    if (i > 0 && d <= days[i - 1]!) throw new Error('days are not in ascending order');
    axis[d - first] = flags[i] === true;
  });
  return runs(axis, minLen).map((r) => ({ start: isoDay(first + r.start), end: isoDay(first + r.end), days: r.end - r.start + 1 }));
}

// ---------- Periods ----------

export const PERIODS = [
  { id: 'MAM', name: 'spring', months: [3, 4, 5] },
  { id: 'JJA', name: 'summer', months: [6, 7, 8] },
  { id: 'SON', name: 'autumn', months: [9, 10, 11] },
  { id: 'DJF', name: 'winter', months: [12, 1, 2] },
] as const;
export type PeriodId = (typeof PERIODS)[number]['id'];

/** Period and period year of an ISO date. December goes to the winter of the next year (the January year). */
export function periodOf(iso: string): { period: PeriodId; year: number } {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!(month >= 1 && month <= 12)) throw new Error(`bad date: ${iso}`);
  const p = PERIODS.find((x) => (x.months as readonly number[]).includes(month))!;
  return { period: p.id, year: month === 12 ? year + 1 : year };
}

/** Label of a period year: "spring 2023", "winter 2022/23". */
export function periodLabel(period: PeriodId, year: number): string {
  const p = PERIODS.find((x) => x.id === period)!;
  return period === 'DJF' ? `${p.name} ${year - 1}/${String(year).slice(-2)}` : `${p.name} ${year}`;
}

/**
 * Key of the period year of an ISO date for the per-period figure: "2022-MAM". Unlike periodOf(), the
 * winter is keyed by the DECEMBER year: December 2022 and January and February 2023 give "2022-DJF".
 */
export function periodKey(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!(month >= 1 && month <= 12)) throw new Error(`bad date: ${iso}`);
  const p = PERIODS.find((x) => (x.months as readonly number[]).includes(month))!;
  return `${month <= 2 ? year - 1 : year}-${p.id}`;
}

/** Label of a period year with the winter keyed by the December year: "spring 2022", "winter 2022/23". */
export function periodLabelDec(period: PeriodId, year: number): string {
  return period === 'DJF' ? periodLabel('DJF', year + 1) : periodLabel(period, year);
}

// ---------- Percentile rank ----------

/**
 * Percentile rank (0 to 100) of `x` in a sorted list, as DuckDB percent_rank(): (rank − 1) / (n − 1),
 * rank = 1 + number of values below x. Gives 0 for a list of one value.
 */
export function percentileRank(sorted: readonly number[], x: number): number {
  const n = sorted.length;
  if (n === 0) throw new Error('percentile rank in an empty list');
  if (n === 1) return 0;
  let below = 0;
  for (const v of sorted) if (v < x) below++;
  return (100 * below) / (n - 1);
}

// ---------- Detection ----------

/** One local day of one site. Null = no valid value. */
export interface DayRow {
  day: number;
  iso: string;
  taMean: number | null;
  taMin: number | null;
  taMax: number | null;
  /** Daily rain sum (mm). */
  precip: number | null;
  /** Daily mean soil water content after the soil temperature rule (m3 m-3). */
  swc: number | null;
  /** Percentile rank of swc in the used days of the site (0 to 100); null on masked days. */
  swcPct: number | null;
  tsoil: number | null;
  /** Daily NEE (g C m-2 d-1). */
  nee: number | null;
  /** False when the day is in the human mask. */
  used: boolean;
}

export interface DetectOptions {
  /** Finland: frost, cold spell, dry spell and zero curtain. Kenya: failed rains. */
  country: 'FI' | 'KE';
  heatC: number;
  heatWaveDays: number;
  frostC: number;
  /** First and last month of the frost and dry spell season (Finland). */
  seasonFrom: number;
  seasonTo: number;
  heavyRainMm: number;
  drySpellDays: number;
  drySpellMm: number;
  coldSpellC: number;
  /** Soil drought below p10, soil wet above p90 (m3 m-3), from the used days. Null = no swc. */
  swcP10: number | null;
  swcP90: number | null;
  zeroCurtainBandC: number;
  zeroCurtainDays: number;
  /** Failed rains (Kenya): seasons, minimum days with data per season, quantile of the season mean swc. */
  failedRainSeasons: readonly { id: string; months: readonly number[] }[];
  minSeasonDays: number;
  swcQuantile: number;
}

/** Test of one rain season (Kenya). `failed` is null when the season has too few days with rain data. */
export interface RainSeason {
  season: string;
  year: number;
  start: string;
  end: string;
  precipDays: number;
  precipMm: number | null;
  swcDays: number;
  swcMean: number | null;
  /** Median of the season rain sums of the site (mm). */
  medianMm: number | null;
  /** Quantile `swcQuantile` of the season mean swc of the site (m3 m-3). */
  swcRef: number | null;
  failed: boolean | null;
}

/** Episode of one class at one site. */
export interface ClassEpisode {
  class: ClassId;
  start: string;
  end: string;
  days: number;
  /** Event days that are not in the human mask. */
  usedDays: number;
  peak: number | null;
  peakUnit: string;
  heatWave?: boolean;
  nee: { n: number; mean: number | null; sd: number | null };
}

export interface Detection {
  /** Classes per day number (only days with at least one class). */
  flags: Map<number, Set<ClassId>>;
  episodes: ClassEpisode[];
  seasons: RainSeason[];
}

const inMonths = (iso: string, from: number, to: number): boolean => {
  const m = Number(iso.slice(5, 7));
  return m >= from && m <= to;
};

/**
 * Rain seasons (Kenya). A season is failed when its rain sum is below the median of the season sums
 * of the site AND its mean swc is below the quantile `swcQuantile` of the season means of the site.
 * A season needs `minSeasonDays` days with rain data (else `failed` is null) and as many days with
 * swc for a season mean.
 */
export function rainSeasons(rows: readonly DayRow[], seasons: DetectOptions['failedRainSeasons'], minSeasonDays: number, swcQuantile: number): RainSeason[] {
  const out: RainSeason[] = [];
  for (const s of seasons) {
    const byYear = new Map<number, DayRow[]>();
    for (const r of rows) {
      if (!s.months.includes(Number(r.iso.slice(5, 7)))) continue;
      const y = Number(r.iso.slice(0, 4));
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(r);
    }
    const tests = [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, list]) => {
        const p = finite(list.map((r) => r.precip));
        const w = finite(list.map((r) => r.swc));
        return {
          season: s.id,
          year,
          start: list[0]!.iso,
          end: list[list.length - 1]!.iso,
          precipDays: p.length,
          precipMm: p.length >= minSeasonDays ? p.reduce((a, b) => a + b, 0) : null,
          swcDays: w.length,
          swcMean: w.length >= minSeasonDays ? mean(w) : null,
        };
      });
    const med = median(finite(tests.map((t) => t.precipMm)));
    const means = finite(tests.map((t) => t.swcMean)).sort((a, b) => a - b);
    const ref = means.length ? quantile(means, swcQuantile) : null;
    for (const t of tests) {
      const failed = t.precipMm === null ? null : med !== null && ref !== null && t.swcMean !== null && t.precipMm < med && t.swcMean < ref;
      out.push({ ...t, medianMm: med, swcRef: ref, failed });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Event classes of the days of one site. `rows` = all local days of the site in ascending order.
 * Weather classes use all days (the weather does not depend on the management); the soil classes use
 * the used days only (their percentiles come from them). The NEE of an episode uses its used days.
 */
export function detectClasses(rows: readonly DayRow[], o: DetectOptions): Detection {
  const days = rows.map((r) => r.day);
  const fi = o.country === 'FI';
  const season = (r: DayRow) => inMonths(r.iso, o.seasonFrom, o.seasonTo);
  const dayFlags: Record<ClassId, (boolean | null)[]> = {
    frost: rows.map((r) => fi && season(r) && r.taMin !== null && r.taMin < o.frostC),
    heat: rows.map((r) => r.taMax !== null && r.taMax > o.heatC),
    coldSpell: rows.map((r) => fi && r.taMean !== null && r.taMean < o.coldSpellC),
    heavyRain: rows.map((r) => r.precip !== null && r.precip > o.heavyRainMm),
    drySpell: rows.map((r) => fi && season(r) && r.precip !== null && r.precip < o.drySpellMm),
    failedRains: rows.map(() => false),
    soilDrought: rows.map((r) => r.used && r.swc !== null && o.swcP10 !== null && r.swc < o.swcP10),
    soilWet: rows.map((r) => r.used && r.swc !== null && o.swcP90 !== null && r.swc > o.swcP90),
    zeroCurtain: rows.map((r) => fi && r.tsoil !== null && Math.abs(r.tsoil) <= o.zeroCurtainBandC),
  };
  const minLen: Record<ClassId, number> = {
    frost: 1,
    heat: 1,
    coldSpell: 1,
    heavyRain: 1,
    drySpell: o.drySpellDays,
    failedRains: 1,
    soilDrought: 1,
    soilWet: 1,
    zeroCurtain: o.zeroCurtainDays,
  };
  const seasons = fi ? [] : rainSeasons(rows, o.failedRainSeasons, o.minSeasonDays, o.swcQuantile);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const flags = new Map<number, Set<ClassId>>();
  const episodes: ClassEpisode[] = [];

  const addEpisode = (cls: ClassId, start: number, end: number, peak: number | null, peakUnit: string, extra: Partial<ClassEpisode> = {}) => {
    const list: DayRow[] = [];
    for (let d = start; d <= end; d++) {
      const r = byDay.get(d);
      if (!r) continue;
      list.push(r);
      if (!flags.has(d)) flags.set(d, new Set());
      flags.get(d)!.add(cls);
    }
    const used = list.filter((r) => r.used);
    const nee = finite(used.map((r) => r.nee));
    episodes.push({
      class: cls,
      start: isoDay(start),
      end: isoDay(end),
      days: list.length,
      usedDays: used.length,
      peak,
      peakUnit,
      ...extra,
      nee: { n: nee.length, mean: mean(nee), sd: sd(nee) },
    });
  };
  const ext = (list: DayRow[], f: (r: DayRow) => number | null, pick: 'min' | 'max'): number | null => {
    const xs = finite(list.map(f));
    return xs.length ? (pick === 'min' ? Math.min(...xs) : Math.max(...xs)) : null;
  };

  for (const cls of CLASSES) {
    if (cls === 'failedRains') continue;
    for (const ep of episodesFromFlags(days, dayFlags[cls], minLen[cls])) {
      const s = dayNumber(ep.start);
      const e = dayNumber(ep.end);
      const list = rows.filter((r) => r.day >= s && r.day <= e);
      switch (cls) {
        case 'frost':
          addEpisode(cls, s, e, ext(list, (r) => r.taMin, 'min'), '°C');
          break;
        case 'coldSpell':
          addEpisode(cls, s, e, ext(list, (r) => r.taMean, 'min'), '°C');
          break;
        case 'heat':
          addEpisode(cls, s, e, ext(list, (r) => r.taMax, 'max'), '°C', { heatWave: ep.days >= o.heatWaveDays });
          break;
        case 'heavyRain':
          addEpisode(cls, s, e, ext(list, (r) => r.precip, 'max'), 'mm');
          break;
        case 'drySpell':
          addEpisode(cls, s, e, ep.days, 'd');
          break;
        case 'soilDrought':
          addEpisode(cls, s, e, ext(list, (r) => r.swcPct, 'min'), '%');
          break;
        case 'soilWet':
          addEpisode(cls, s, e, ext(list, (r) => r.swcPct, 'max'), '%');
          break;
        case 'zeroCurtain':
          addEpisode(cls, s, e, mean(finite(list.map((r) => r.tsoil))), '°C');
          break;
      }
    }
  }
  for (const s of seasons) if (s.failed) addEpisode('failedRains', dayNumber(s.start), dayNumber(s.end), s.precipMm, 'mm');
  episodes.sort((a, b) => a.start.localeCompare(b.start) || CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class));
  return { flags, episodes, seasons };
}

// ---------- Pooled period years ----------

/** One used day of one site for the period summary. */
export interface PoolRow {
  site: string;
  iso: string;
  nee: number | null;
  classes: ReadonlySet<ClassId> | readonly ClassId[];
}

export interface NeeStats {
  mean: number | null;
  sd: number | null;
  n: number;
}

export interface PeriodYear {
  period: PeriodId;
  year: number;
  label: string;
  /** Sites with at least one day with NEE. */
  sitesWithData: number;
  /** Days with NEE (all sites). */
  n: number;
  nee: NeeStats;
  eventDays: Record<ClassId, number>;
  bySite: Record<string, { n: number; nee: NeeStats; eventDays: Record<ClassId, number> }>;
}

const zeroCounts = (): Record<ClassId, number> => Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<ClassId, number>;
const neeStats = (xs: number[]): NeeStats => ({ mean: mean(xs), sd: sd(xs), n: xs.length });

/**
 * Pool the used days of all sites per period year. Event days count per class (days with and
 * without NEE). Sorted by year, then by the period order MAM, JJA, SON, DJF.
 */
export function poolByPeriod(rows: readonly PoolRow[]): PeriodYear[] {
  const groups = new Map<string, { period: PeriodId; year: number; rows: PoolRow[] }>();
  for (const r of rows) {
    const p = periodOf(r.iso);
    const key = `${p.year}|${p.period}`;
    if (!groups.has(key)) groups.set(key, { ...p, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const order = PERIODS.map((p) => p.id) as PeriodId[];
  return [...groups.values()]
    .sort((a, b) => a.year - b.year || order.indexOf(a.period) - order.indexOf(b.period))
    .map((g) => {
      const eventDays = zeroCounts();
      const sites = new Map<string, PoolRow[]>();
      for (const r of g.rows) {
        if (!sites.has(r.site)) sites.set(r.site, []);
        sites.get(r.site)!.push(r);
        for (const c of r.classes) eventDays[c]++;
      }
      const bySite: PeriodYear['bySite'] = {};
      for (const [site, list] of [...sites.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const ev = zeroCounts();
        for (const r of list) for (const c of r.classes) ev[c]++;
        const xs = finite(list.map((r) => r.nee));
        bySite[site] = { n: xs.length, nee: neeStats(xs), eventDays: ev };
      }
      const all = finite(g.rows.map((r) => r.nee));
      return {
        period: g.period,
        year: g.year,
        label: periodLabel(g.period, g.year),
        sitesWithData: Object.values(bySite).filter((s) => s.n > 0).length,
        n: all.length,
        nee: neeStats(all),
        eventDays,
        bySite,
      };
    });
}
