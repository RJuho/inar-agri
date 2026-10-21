// Helpers for 30-minute series stored as Float64Array. NaN = missing value.

import { ROWS_PER_DAY } from './constants.ts';

export const isNA = (x: number): boolean => Number.isNaN(x);

export function count(x: Float64Array, from = 0, to = x.length): number {
  let n = 0;
  for (let i = from; i < to; i++) if (!isNA(x[i]!)) n++;
  return n;
}

export function mean(x: Float64Array): number {
  let s = 0;
  let n = 0;
  for (const v of x) {
    if (isNA(v)) continue;
    s += v;
    n++;
  }
  return n ? s / n : NaN;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Percentile with linear interpolation (R type 7). p in 0..100. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const h = ((s.length - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo]! + (h - lo) * (s[hi]! - s[lo]!);
}

/** Pearson correlation of two arrays of equal length. NaN pairs are skipped. */
export function correlation(x: Float64Array | number[], y: Float64Array | number[]): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < x.length; i++) {
    if (isNA(x[i]!) || isNA(y[i]!)) continue;
    sx += x[i]!;
    sy += y[i]!;
    n++;
  }
  if (n < 3) return NaN;
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    if (isNA(x[i]!) || isNA(y[i]!)) continue;
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/**
 * Linear interpolation of NaN runs. A run longer than maxRun rows stays NaN
 * (maxRun = Infinity fills every interior run). Leading and trailing runs
 * take the nearest value when holdEnds is true. Returns a copy and the
 * number of filled rows.
 */
export function interpolateLinear(x: Float64Array, maxRun = Infinity, holdEnds = false): { values: Float64Array; filled: Uint8Array } {
  const out = Float64Array.from(x);
  const filled = new Uint8Array(x.length);
  const n = x.length;
  let i = 0;
  while (i < n) {
    if (!isNA(out[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && isNA(out[j]!)) j++;
    // run i..j-1
    const left = i - 1;
    const right = j;
    const run = j - i;
    if (left >= 0 && right < n) {
      if (run <= maxRun) {
        const a = out[left]!;
        const b = out[right]!;
        for (let k = i; k < j; k++) {
          out[k] = a + ((b - a) * (k - left)) / (right - left);
          filled[k] = 1;
        }
      }
    } else if (holdEnds) {
      const v = left >= 0 ? out[left]! : right < n ? out[right]! : NaN;
      if (!isNA(v)) {
        for (let k = i; k < j; k++) {
          out[k] = v;
          filled[k] = 1;
        }
      }
    }
    i = j;
  }
  return { values: out, filled };
}

/**
 * Mean diurnal course fill: for a NaN at row i, the mean of the values at
 * the same time of day (± hourTolRows rows) on the days i ± 1 .. ± days.
 * Returns the mean and the count; count 0 = nothing found.
 */
export function mdcValue(x: Float64Array, i: number, days: number, hourTolRows: number): { value: number; n: number } {
  let s = 0;
  let n = 0;
  for (let d = -days; d <= days; d++) {
    const base = i + d * ROWS_PER_DAY;
    for (let h = -hourTolRows; h <= hourTolRows; h++) {
      const k = base + h;
      if (k === i || k < 0 || k >= x.length) continue;
      const v = x[k]!;
      if (isNA(v)) continue;
      s += v;
      n++;
    }
  }
  return { value: n ? s / n : NaN, n };
}

/** Fill NaN rows with the mean diurnal course, trying the day windows in order. qc = 1 + index of the window that filled the row. */
export function mdcFill(x: Float64Array, dayWindows: readonly number[], hourTolRows: number): { values: Float64Array; qc: Uint8Array } {
  const out = Float64Array.from(x);
  const qc = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) {
    if (!isNA(x[i]!)) continue;
    for (let w = 0; w < dayWindows.length; w++) {
      const r = mdcValue(x, i, dayWindows[w]!, hourTolRows);
      if (r.n > 0) {
        out[i] = r.value;
        qc[i] = w + 1;
        break;
      }
    }
  }
  return { values: out, qc };
}

/** Prefix sum of valid values, for fast "any value in [a, b)" checks. */
export function prefixCount(x: Float64Array): Int32Array {
  const p = new Int32Array(x.length + 1);
  for (let i = 0; i < x.length; i++) p[i + 1] = p[i]! + (isNA(x[i]!) ? 0 : 1);
  return p;
}

/** Longest run of NaN in rows. */
export function longestGap(x: Float64Array, from = 0, to = x.length): number {
  let best = 0;
  let run = 0;
  for (let i = from; i < to; i++) {
    if (isNA(x[i]!)) {
      run++;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}
