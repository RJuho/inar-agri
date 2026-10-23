// Pure helpers of the Deep Dive "Management disturbances in detail"
// (scripts/deep-dives/disturbance-detail.ts): the day of the largest drop of a daily flux near a
// harvest (change point), the drop before the recorded day, and the days until the flux recovers.
// No I/O. Unit test: change-point.test.ts.

import type { VarRow } from './disturbance.ts';

const valueOf = (byDay: ReadonlyMap<number, VarRow>, d: number, v: string): number | null => {
  const x = byDay.get(d)?.[v];
  return x === null || x === undefined || !Number.isFinite(x) ? null : x;
};

/** Mean and count of the values of `v` on the days lo to hi (both included). */
export function rangeMean(byDay: ReadonlyMap<number, VarRow>, v: string, lo: number, hi: number): { mean: number | null; n: number } {
  let s = 0;
  let n = 0;
  for (let d = lo; d <= hi; d++) {
    const x = valueOf(byDay, d, v);
    if (x !== null) {
      s += x;
      n++;
    }
  }
  return { mean: n ? s / n : null, n };
}

export interface DropOptions {
  /** Days on each side of a candidate day. */
  sideDays?: number;
  /** Minimum days with a value on each side. */
  minSideDays?: number;
  /** Minimum mean before the drop for a clear drop (unit of the variable). */
  minBefore?: number;
  /** Minimum drop in percent of the mean before for a clear drop. */
  minDropPct?: number;
  /** Day number of the offset 0 (default: `from`). */
  anchor?: number;
}

export type DropReason = 'too-few-days' | 'flux-too-small' | 'drop-too-small' | null;

export interface Drop {
  /** Day number of the largest drop (the first day of the lower level), or null. */
  detected: number | null;
  /** detected − anchor (days), or null. */
  offset: number | null;
  /** Mean of the side before − mean of the side after (unit of the variable). */
  drop: number | null;
  /** Drop in percent of the mean before. */
  dropPct: number | null;
  /** Mean of the side before the detected day. */
  before: number | null;
  /** True when the mean before and the drop are large enough. */
  clear: boolean;
  /** Why the drop is not clear (null when it is clear). */
  reason: DropReason;
}

/**
 * Change point of a drop: for each candidate day d from `from` to `to`, drop(d) = mean of
 * v[d − side .. d − 1] − mean of v[d .. d + side − 1], with at least `minSideDays` values on each
 * side. The detected day is the day with the largest drop (the first one on a tie). The drop is
 * clear when the mean before ≥ `minBefore` and the drop ≥ `minDropPct` % of the mean before.
 */
export function detectDrop(byDay: ReadonlyMap<number, VarRow>, v: string, from: number, to: number, opts: DropOptions = {}): Drop {
  const side = opts.sideDays ?? 5;
  const minSide = opts.minSideDays ?? 4;
  const minBefore = opts.minBefore ?? 1;
  const minDropPct = opts.minDropPct ?? 25;
  const anchor = opts.anchor ?? from;
  let best: { d: number; drop: number; before: number } | null = null;
  for (let d = from; d <= to; d++) {
    const b = rangeMean(byDay, v, d - side, d - 1);
    const a = rangeMean(byDay, v, d, d + side - 1);
    if (b.n < minSide || a.n < minSide || b.mean === null || a.mean === null) continue;
    const drop = b.mean - a.mean;
    if (!best || drop > best.drop) best = { d, drop, before: b.mean };
  }
  if (!best) return { detected: null, offset: null, drop: null, dropPct: null, before: null, clear: false, reason: 'too-few-days' };
  const dropPct = best.before > 0 ? (100 * best.drop) / best.before : null;
  const reason: DropReason = best.before < minBefore ? 'flux-too-small' : dropPct === null || dropPct < minDropPct ? 'drop-too-small' : null;
  return { detected: best.d, offset: best.d - anchor, drop: best.drop, dropPct, before: best.before, clear: reason === null, reason };
}

export interface PreDropOptions {
  /** Minimum values in the near and the far window. */
  minNear?: number;
  minFar?: number;
  /** Minimum mean of the far window (unit of the variable). */
  minFarMean?: number;
}

/**
 * Change just before the recorded day: pct = (mean of the near window − mean of the far window) /
 * mean of the far window × 100. Windows are offsets from `start` (default near −3..−1, far −10..−4).
 * A negative pct means that the flux went down before the recorded day.
 */
export function preDrop(
  byDay: ReadonlyMap<number, VarRow>,
  v: string,
  start: number,
  near = { from: -3, to: -1 },
  far = { from: -10, to: -4 },
  opts: PreDropOptions = {},
): { near: number | null; far: number | null; pct: number | null } {
  const n = rangeMean(byDay, v, start + near.from, start + near.to);
  const f = rangeMean(byDay, v, start + far.from, start + far.to);
  const ok = n.n >= (opts.minNear ?? 2) && f.n >= (opts.minFar ?? 5) && f.mean !== null && n.mean !== null && f.mean >= (opts.minFarMean ?? 1);
  return { near: n.mean, far: f.mean, pct: ok ? (100 * (n.mean! - f.mean!)) / f.mean! : null };
}

export interface RecoverOptions {
  /** Share of the reference that counts as recovered (percent). */
  sharePct?: number;
  /** Last day of the search (days after `end`). */
  maxDays?: number;
  /** Length of the centred running mean (odd number of days). */
  runDays?: number;
  /** Minimum values in the running mean. */
  minRun?: number;
  /** Days after `end` when the next disturbance starts, or null. The search stops before its running mean reaches that day. */
  blockedFrom?: number | null;
}

export type RecoverReason = 'recovered' | 'no-reference' | 'blocked' | 'data-end' | 'max-days';

/**
 * Days from the last day of the episode until the flux recovers: the first day d ≥ 1 where the
 * centred running mean (runDays, ≥ minRun values) reaches sharePct % of `ref` (the mean before).
 * Censored (days = null) when the next disturbance starts first, the data end, or day maxDays
 * comes first. Not censored and null when there is no positive reference.
 */
export function daysToRecover(
  byDay: ReadonlyMap<number, VarRow>,
  v: string,
  end: number,
  ref: number | null,
  opts: RecoverOptions = {},
): { days: number | null; censored: boolean; reason: RecoverReason } {
  if (ref === null || !(ref > 0)) return { days: null, censored: false, reason: 'no-reference' };
  const share = (opts.sharePct ?? 80) / 100;
  const maxDays = opts.maxDays ?? 60;
  const half = Math.floor((opts.runDays ?? 5) / 2);
  const minRun = opts.minRun ?? 3;
  const blocked = opts.blockedFrom ?? null;
  for (let d = 1; d <= maxDays; d++) {
    if (blocked !== null && d + half >= blocked) return { days: null, censored: true, reason: 'blocked' };
    const r = rangeMean(byDay, v, end + d - half, end + d + half);
    if (r.n >= minRun && r.mean !== null && r.mean >= share * ref) return { days: d, censored: false, reason: 'recovered' };
    if (rangeMean(byDay, v, end + d, end + maxDays + half).n === 0) return { days: null, censored: true, reason: 'data-end' };
  }
  return { days: null, censored: true, reason: 'max-days' };
}
