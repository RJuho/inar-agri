// Pure helpers of the Deep Dive "Management disturbances in detail"
// (scripts/deep-dives/disturbance-detail.ts): control windows without management near the day of
// year of a fertilisation, the change after − before in these windows, and the controls with nearly
// the same weather change. No I/O. Unit test: control-windows.test.ts.

import { changes, windowMeans, type VarRow } from './disturbance.ts';
import { dayNumber, type Window } from './harvest.ts';

/**
 * Anchor days of the control windows: in each year of `years`, the days from `doy − halfWidth` to
 * `doy + halfWidth` (day of year 1 = 1 January). Sorted, no duplicates.
 */
export function controlAnchors(years: readonly number[], doy: number, halfWidth = 21): number[] {
  const out = new Set<number>();
  for (const y of years) {
    const jan1 = dayNumber(`${y}-01-01`);
    for (let k = -halfWidth; k <= halfWidth; k++) out.add(jan1 + doy - 1 + k);
  }
  return [...out].sort((a, b) => a - b);
}

/** Day of year (1 = 1 January) of a day number. */
export function dayOfYear(day: number): number {
  const y = new Date(day * 86_400_000).getUTCFullYear();
  return day - dayNumber(`${y}-01-01`) + 1;
}

export interface ControlPair {
  /** Anchor day (day number): the before window ends the day before, the after window starts the day after. */
  anchor: number;
  before: Record<string, number | null>;
  after: Record<string, number | null>;
  /** After − before per variable (null when a side has fewer than minDays values; only for extra variables). */
  delta: Record<string, number | null>;
}

/**
 * Control pairs: for each anchor, the mean of each variable in the before and the after window and
 * the change after − before. A pair is dropped when a day from `anchor + before.from` to
 * `anchor + after.to` is in `blocked` (a management event is near), or when a variable of `vars`
 * has fewer than `minDays` values on a side. Variables of `extraVars` can be null in a pair.
 */
export function controlPairs(
  byDay: ReadonlyMap<number, VarRow>,
  blocked: ReadonlySet<number>,
  anchors: readonly number[],
  before: Window,
  after: Window,
  vars: readonly string[],
  minDays = 12,
  extraVars: readonly string[] = [],
): ControlPair[] {
  const all = [...vars, ...extraVars];
  const out: ControlPair[] = [];
  for (const a of anchors) {
    let free = true;
    for (let d = a + before.from; d <= a + after.to; d++) {
      if (blocked.has(d)) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    const b = windowMeans(byDay, a, before, all);
    const f = windowMeans(byDay, a, after, all);
    const delta = changes(f, b, all, minDays);
    if (vars.some((v) => delta[v] === null)) continue;
    out.push({ anchor: a, before: b.mean, after: f.mean, delta });
  }
  return out;
}

/** Controls whose weather change is near the target: |Δta − target.ta| ≤ tolTa and |Δlight % − target.lightPct| ≤ tolLightPct. */
export function nearestControls<T extends { dTa: number; dLightPct: number }>(
  pairs: readonly T[],
  target: { ta: number; lightPct: number },
  tolTa = 1,
  tolLightPct = 10,
): T[] {
  return pairs.filter((p) => Math.abs(p.dTa - target.ta) <= tolTa && Math.abs(p.dLightPct - target.lightPct) <= tolLightPct);
}

/**
 * Rank of a value that is not in the reference list: percent of the reference values below `x`
 * (0 to 100). percentileRank() of natural-events.ts is for a member of the list and can give more
 * than 100 for an outside value.
 */
export function rankAmong(sorted: readonly number[], x: number): number {
  if (sorted.length === 0) throw new Error('rank in an empty list');
  let below = 0;
  for (const v of sorted) if (v < x) below++;
  return (100 * below) / sorted.length;
}
