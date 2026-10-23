// Pure helpers of the Deep Dive "Size of management disturbances" (scripts/deep-dives/disturbance-size.ts):
// event classes, episodes of mixed classes, generic window statistics, seasonal baseline and the
// integrated excess after an event. No I/O. Unit test: disturbance.test.ts.
// `dayNumber`, `isoDay`, `Window` and `windowFree` come from harvest.ts (the first dive).

import { dayNumber, isoDay, type Window } from './harvest.ts';

/** Management classes that the dive analyses. Sowing, spraying and other are co-events only. */
export const CLASSES = ['harvest-cut', 'grazing', 'fertilisation', 'tillage'] as const;
export type EventClass = (typeof CLASSES)[number];
export type FertKind = 'mineral' | 'organic';

/** Class of an event type of db/events.parquet, or null when the type is not analysed. */
export function classify(type: string): EventClass | null {
  switch (type) {
    case 'harvest':
    case 'cut':
      return 'harvest-cut';
    case 'grazing':
    case 'fertilisation':
    case 'tillage':
      return type;
    default:
      return null;
  }
}

/**
 * Mineral or organic fertiliser, from the detail text of the event. Mineral products: the text
 * says "mineral" or "synthetic", or names a mineral product (saltpetre, AXAN, Typpi, CAN, NPK with a grade).
 * All other products (manure, compost, molasses, by-products, own mixes) are organic.
 */
export function fertiliserKind(detail: string): FertKind {
  return /\bmineral\b|\bsynthetic\b|saltpetre|salpietari|\bAXAN\b|\bTyppi\b|\bCAN\b/i.test(detail) ? 'mineral' : 'organic';
}

/** One event of db/events.parquet with its class. */
export interface ClassEvent {
  site: string;
  date: string;
  dateEnd: string | null;
  type: string;
  cls: EventClass | null;
  /** Fertiliser kind; null for other classes. */
  fert: FertKind | null;
  crop: string | null;
  detail: string;
  dryMassKgHa: number | null;
  nKgHa: number | null;
}

export function toClassEvent(e: Omit<ClassEvent, 'cls' | 'fert'>): ClassEvent {
  const cls = classify(e.type);
  return { ...e, cls, fert: cls === 'fertilisation' ? fertiliserKind(e.detail) : null };
}

/**
 * Fixed groups of the results. An episode gets the first kind whose classes equal its own class set.
 * `other` collects the rest (listed in the table, no summary).
 */
export const KINDS = [
  { id: 'harvestCut', classes: ['harvest-cut'], label: 'Harvest or cut' },
  { id: 'harvestCutFert', classes: ['harvest-cut', 'fertilisation'], label: 'Harvest or cut + fertilisation' },
  { id: 'grazing', classes: ['grazing'], label: 'Grazing' },
  { id: 'fertilisation', classes: ['fertilisation'], label: 'Fertilisation' },
  { id: 'tillage', classes: ['tillage'], label: 'Tillage' },
  { id: 'tillageFert', classes: ['tillage', 'fertilisation'], label: 'Tillage + fertilisation' },
  { id: 'other', classes: [], label: 'Other combination' },
] as const;
export type KindId = (typeof KINDS)[number]['id'];

/** Kind of a set of classes. */
export function kindOf(classes: readonly EventClass[]): KindId {
  const set = [...new Set(classes)].sort();
  const hit = KINDS.find((k) => k.classes.length === set.length && [...k.classes].sort().every((c, i) => c === set[i]));
  return hit?.id ?? 'other';
}

/** Events of the analysed classes at one site that are close in time. */
export interface ClassEpisode {
  site: string;
  start: number;
  end: number;
  events: ClassEvent[];
  classes: EventClass[];
  kind: KindId;
  /** Fertiliser kind of the episode: mineral, organic, mixed, or null without fertilisation. */
  fert: FertKind | 'mixed' | null;
}

export const MERGE_DAYS = 7;

/**
 * Merge the analysed events of each site into episodes: an event that starts not more than
 * `mergeDays` after the end of the current episode joins it, whatever its class. Events without a
 * class are skipped. Returns the episodes sorted by site and start day.
 */
export function mergeClassEpisodes(events: readonly ClassEvent[], mergeDays = MERGE_DAYS): ClassEpisode[] {
  const sorted = events.filter((e) => e.cls !== null).sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
  const out: ClassEpisode[] = [];
  for (const e of sorted) {
    const start = dayNumber(e.date);
    const end = e.dateEnd ? dayNumber(e.dateEnd) : start;
    const last = out[out.length - 1];
    if (last && last.site === e.site && start - last.end <= mergeDays) {
      last.end = Math.max(last.end, end);
      last.events.push(e);
    } else {
      out.push({ site: e.site, start, end, events: [e], classes: [], kind: 'other', fert: null });
    }
  }
  for (const ep of out) {
    ep.classes = [...new Set(ep.events.map((e) => e.cls!))].sort();
    ep.kind = kindOf(ep.classes);
    const ferts = new Set(ep.events.filter((e) => e.fert !== null).map((e) => e.fert!));
    ep.fert = ferts.size === 0 ? null : ferts.size === 1 ? [...ferts][0]! : 'mixed';
  }
  return out;
}

/** Day with values per variable (null = no value). */
export type VarRow = Record<string, number | null>;

export interface WindowMeans {
  days: number;
  /** Days with a value, per variable. */
  n: Record<string, number>;
  mean: Record<string, number | null>;
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Mean per variable of the days `anchor + w.from` to `anchor + w.to`. */
export function windowMeans(byDay: ReadonlyMap<number, VarRow>, anchor: number, w: Window, vars: readonly string[]): WindowMeans {
  const n: Record<string, number> = {};
  const mean: Record<string, number | null> = {};
  for (const v of vars) {
    const xs: number[] = [];
    for (let d = anchor + w.from; d <= anchor + w.to; d++) {
      const x = byDay.get(d)?.[v];
      if (x !== null && x !== undefined) xs.push(x);
    }
    n[v] = xs.length;
    mean[v] = avg(xs);
  }
  return { days: w.to - w.from + 1, n, mean };
}

/** Sum of a variable over the window and the number of days with a value. */
export function windowSum(byDay: ReadonlyMap<number, VarRow>, anchor: number, w: Window, v: string): { n: number; sum: number | null } {
  let n = 0;
  let sum = 0;
  for (let d = anchor + w.from; d <= anchor + w.to; d++) {
    const x = byDay.get(d)?.[v];
    if (x !== null && x !== undefined) {
      n++;
      sum += x;
    }
  }
  return { n, sum: n ? sum : null };
}

/** Change after − before of each variable, null when one side has fewer than `minDays` values. */
export function changes(after: WindowMeans, before: WindowMeans, vars: readonly string[], minDays: number): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const v of vars) {
    const a = after.mean[v];
    const b = before.mean[v];
    out[v] = a === null || a === undefined || b === null || b === undefined || after.n[v]! < minDays || before.n[v]! < minDays ? null : a - b;
  }
  return out;
}

/** The same calendar day in another year (29 February becomes 1 March). */
export function shiftYears(day: number, years: number): number {
  const d = new Date(day * 86_400_000);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return Math.round(d.getTime() / 86_400_000);
}

/** True when no episode of the list overlaps the days `lo` to `hi`. */
export function periodFree(episodes: readonly ClassEpisode[], site: string, lo: number, hi: number): boolean {
  return !episodes.some((o) => o.site === site && o.end >= lo && o.start <= hi);
}

export interface Baseline {
  /** Years used. */
  years: number[];
  /** Mean of the seasonal changes of the baseline years, per variable (null when fewer than `minYears`). */
  mean: Record<string, number | null>;
  /** Years with a value, per variable. */
  n: Record<string, number>;
}

/**
 * Seasonal baseline of an episode: the mean change (after − before) of the same calendar windows in
 * the other years of the site. A year is used when no episode of the site overlaps the shifted
 * period from the start of the before window to the end of the after window (`free` years), and the
 * shifted windows have `minDays` values of the variable.
 */
export function seasonalBaseline(
  byDay: ReadonlyMap<number, VarRow>,
  episodes: readonly ClassEpisode[],
  ep: ClassEpisode,
  years: readonly number[],
  vars: readonly string[],
  before: Window,
  after: Window,
  minDays: number,
  minYears: number,
): Baseline {
  const year0 = Number(isoDay(ep.start).slice(0, 4));
  const sums: Record<string, number[]> = Object.fromEntries(vars.map((v) => [v, []]));
  const used: number[] = [];
  for (const y of years) {
    if (y === year0) continue;
    const start = shiftYears(ep.start, y - year0);
    const end = shiftYears(ep.end, y - year0);
    if (!periodFree(episodes, ep.site, start + before.from, end + after.to)) continue;
    const b = windowMeans(byDay, start, before, vars);
    const a = windowMeans(byDay, end, after, vars);
    const ch = changes(a, b, vars, minDays);
    let any = false;
    for (const v of vars) {
      if (ch[v] !== null) {
        sums[v]!.push(ch[v]!);
        any = true;
      }
    }
    if (any) used.push(y);
  }
  const mean: Record<string, number | null> = {};
  const n: Record<string, number> = {};
  for (const v of vars) {
    n[v] = sums[v]!.length;
    mean[v] = sums[v]!.length >= minYears ? avg(sums[v]!) : null;
  }
  return { years: used, mean, n };
}

/**
 * Integrated excess of a variable after the episode: sum over the days `anchor + w.from` to
 * `anchor + w.to` of (daily value − `ref`), scaled to the full window when at least `minDays` days
 * have a value. Null otherwise. For a daily flux in g C m-2 d-1 the result is in g C m-2.
 */
export function excessSum(byDay: ReadonlyMap<number, VarRow>, anchor: number, w: Window, v: string, ref: number | null, minDays: number): number | null {
  if (ref === null) return null;
  const m = windowMeans(byDay, anchor, w, [v]);
  const x = m.mean[v];
  if (x === null || x === undefined || m.n[v]! < minDays) return null;
  return (x - ref) * m.days;
}
