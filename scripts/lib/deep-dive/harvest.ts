// Pure helpers of the Deep Dive "Harvest and cutting vs carbon balance"
// (scripts/deep-dives/harvest-carbon.ts): event episodes, time windows and window statistics.
// No I/O. Unit test: harvest.test.ts.

/** Days since 1970-01-01 for an ISO date `yyyy-mm-dd`. */
export function dayNumber(iso: string): number {
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`bad date: ${iso}`);
  return Math.round(ms / 86_400_000);
}

/** ISO date `yyyy-mm-dd` for a day number. */
export function isoDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** One harvest or cut event of db/events.parquet. */
export interface FieldEvent {
  site: string;
  date: string;
  /** Last day of a multi-day event, else null. */
  dateEnd: string | null;
  type: string;
  crop: string | null;
  /** Dry mass of the harvest (kg DW/ha), or null. */
  dryMassKgHa: number | null;
  detail: string;
}

/** Events at the same site within this number of days make one episode. */
export const MERGE_DAYS = 7;

/**
 * True when the dry mass of the event is the yield of this event. The Viikki management file gives
 * the yield of the year on the last cut of the year ("yield of the year"); that value is not the
 * yield of one cut.
 */
export function eventLevelYield(e: FieldEvent): boolean {
  return e.dryMassKgHa !== null && !/yield of the year/i.test(e.detail);
}

/** Events at one site that are close in time (one harvest period). */
export interface Episode {
  site: string;
  /** First day (day number) and last day of the episode. */
  start: number;
  end: number;
  events: FieldEvent[];
  /**
   * Sum of the event-level yields (kg DW/ha). When no event has one: the yield of the year if the site has
   * no other episode in that year. Else null.
   */
  yieldKgHa: number | null;
  /** Dry mass on an event that is the yield of the year (Viikki), else null. */
  yearYieldKgHa: number | null;
}

/**
 * Merge the events of each site into episodes: an event that starts not more than `mergeDays`
 * after the end of the current episode joins it. Events must be harvest or cut events.
 * Returns the episodes sorted by site and start day.
 */
export function mergeEpisodes(events: readonly FieldEvent[], mergeDays = MERGE_DAYS): Episode[] {
  const sorted = [...events].sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
  const out: Episode[] = [];
  for (const e of sorted) {
    const start = dayNumber(e.date);
    const end = e.dateEnd ? dayNumber(e.dateEnd) : start;
    const last = out[out.length - 1];
    if (last && last.site === e.site && start - last.end <= mergeDays) {
      last.end = Math.max(last.end, end);
      last.events.push(e);
    } else {
      out.push({ site: e.site, start, end, events: [e], yieldKgHa: null, yearYieldKgHa: null });
    }
  }
  for (const ep of out) {
    const own = ep.events.filter(eventLevelYield).map((e) => e.dryMassKgHa!);
    ep.yieldKgHa = own.length ? own.reduce((a, b) => a + b, 0) : null;
    const year = ep.events.filter((e) => e.dryMassKgHa !== null && !eventLevelYield(e)).map((e) => e.dryMassKgHa!);
    ep.yearYieldKgHa = year.length ? year.reduce((a, b) => a + b, 0) : null;
  }
  // A yield of the year is the yield of the episode when the site has no other episode in that year.
  const year = (ep: Episode) => isoDay(ep.start).slice(0, 4);
  for (const ep of out) {
    if (ep.yieldKgHa !== null || ep.yearYieldKgHa === null) continue;
    if (out.filter((o) => o.site === ep.site && year(o) === year(ep)).length === 1) ep.yieldKgHa = ep.yearYieldKgHa;
  }
  return out;
}

/** One local day of data/calculated/daily.csv (sums in g C m-2 d-1). */
export interface DayRow {
  day: number;
  nee: number | null;
  gpp: number | null;
  reco: number | null;
  /** Measured fraction of NEE (0 to 1). */
  frac: number | null;
  /** Daily mean air temperature (°C). */
  ta: number | null;
}

/** A window of days, relative to an anchor day. `from` and `to` are included. */
export interface Window {
  from: number;
  to: number;
}

export interface WindowStats {
  /** Days in the window. */
  days: number;
  /** Days with a value of all three fluxes. */
  nDays: number;
  nee: number | null;
  gpp: number | null;
  reco: number | null;
  /** Mean measured fraction of the days with all three fluxes. */
  frac: number | null;
  /** Mean of the daily mean air temperature of all days of the window. */
  ta: number | null;
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Statistics of the days `anchor + w.from` to `anchor + w.to`. `byDay` maps day number to row. */
export function windowStats(byDay: ReadonlyMap<number, DayRow>, anchor: number, w: Window): WindowStats {
  const rows: DayRow[] = [];
  for (let d = anchor + w.from; d <= anchor + w.to; d++) {
    const r = byDay.get(d);
    if (r) rows.push(r);
  }
  const full = rows.filter((r) => r.nee !== null && r.gpp !== null && r.reco !== null);
  const pick = (k: 'nee' | 'gpp' | 'reco' | 'frac' | 'ta', from: DayRow[]) =>
    avg(from.map((r) => r[k]).filter((x): x is number => x !== null));
  return {
    days: w.to - w.from + 1,
    nDays: full.length,
    nee: pick('nee', full),
    gpp: pick('gpp', full),
    reco: pick('reco', full),
    frac: pick('frac', full),
    ta: pick('ta', rows),
  };
}

/** Difference after − before, or null when one side is null. */
export function delta(after: number | null, before: number | null): number | null {
  return after === null || before === null ? null : after - before;
}

/** Rules that decide if an episode goes into the main result. */
export interface Rules {
  /** Window before the first day of the episode. */
  before: Window;
  /** Main window after the last day of the episode. */
  after: Window;
  /** Minimum days with all three fluxes in the before and the after window. */
  minDays: number;
  /** Minimum mean measured fraction of NEE in the before and the after window. */
  minFrac: number;
}

export type Exclusion = 'overlap' | 'too-few-days' | 'low-measured-fraction' | null;

/**
 * Reason to leave an episode out of the main result, or null when it is used.
 * `others` are the other episodes of the same site. An episode is left out when another episode
 * starts in the days from `start + before.from` to `end + after.to` (the windows would mix two events).
 */
export function exclusion(ep: Episode, others: readonly Episode[], before: WindowStats, after: WindowStats, rules: Rules): Exclusion {
  const lo = ep.start + rules.before.from;
  const hi = ep.end + rules.after.to;
  if (others.some((o) => o !== ep && o.site === ep.site && o.start >= lo && o.start <= hi)) return 'overlap';
  if (before.nDays < rules.minDays || after.nDays < rules.minDays) return 'too-few-days';
  if ((before.frac ?? 0) < rules.minFrac || (after.frac ?? 0) < rules.minFrac) return 'low-measured-fraction';
  return null;
}

/** True when no other episode of the site starts in the days `end + w.from` to `end + w.to`. */
export function windowFree(ep: Episode, others: readonly Episode[], w: Window): boolean {
  return !others.some((o) => o !== ep && o.site === ep.site && o.start >= ep.end + w.from && o.start <= ep.end + w.to);
}
