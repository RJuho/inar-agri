// Quality filter and u* threshold for measured NEE (Maktau).
//
// Fixed threshold: Hu et al. 2024 (0.10 m s-1).
// Moving point test: Papale et al. 2006. Per year and season (3 months),
// 6 temperature classes, 20 u* classes. The threshold of a temperature
// class is the u* of the first class whose mean NEE is at least 99 % of
// the mean of the next 10 classes. A class counts only when |corr(T, u*)|
// is below 0.4. Season = median of the classes, year = max of the seasons.

import { CONST } from './constants.ts';
import { correlation, isNA, median } from './series.ts';

export type QualityCounts = { total: number; keptFlag: number; noFlag: number; badFlag: number; implausible: number; lowUstar: number; noUstar: number; kept: number };

/**
 * Measured NEE after the quality filter: flag, plausibility, u*. Rejected rows become NaN.
 * ustarThreshold NaN = no u* filter.
 */
export function filterNee(nee: Float64Array, ssitc: Float64Array, ustar: Float64Array, ustarThreshold: number): { values: Float64Array; counts: QualityCounts } {
  const out = new Float64Array(nee.length).fill(NaN);
  const c: QualityCounts = { total: 0, keptFlag: 0, noFlag: 0, badFlag: 0, implausible: 0, lowUstar: 0, noUstar: 0, kept: 0 };
  const m = CONST.maktau;
  for (let i = 0; i < nee.length; i++) {
    const x = nee[i]!;
    if (isNA(x)) continue;
    c.total++;
    const flag = ssitc[i]!;
    if (isNA(flag)) {
      c.noFlag++;
      if (!m.keepUnflagged) continue;
    } else if (flag > m.ssitcMax) {
      c.badFlag++;
      continue;
    } else c.keptFlag++;
    if (Math.abs(x) >= m.plausibility) {
      c.implausible++;
      continue;
    }
    if (!isNA(ustarThreshold)) {
      const u = ustar[i]!;
      if (isNA(u)) {
        c.noUstar++;
        continue;
      }
      if (u < ustarThreshold) {
        c.lowUstar++;
        continue;
      }
    }
    out[i] = x;
    c.kept++;
  }
  return { values: out, counts: c };
}

export type MptSeason = { season: number; nNight: number; classThresholds: number[]; threshold: number };
export type MptResult = { seasons: MptSeason[]; threshold: number; bounded: number };

function quantileClasses(values: number[], k: number): number[][] {
  // Returns k arrays of indices (into values) sorted by value, as equal in size as possible.
  const order = values.map((v, i) => i).sort((a, b) => values[a]! - values[b]!);
  const out: number[][] = [];
  for (let c = 0; c < k; c++) {
    const a = Math.floor((c * order.length) / k);
    const b = Math.floor(((c + 1) * order.length) / k);
    out.push(order.slice(a, b));
  }
  return out;
}

/**
 * Papale 2006 moving point test on the rows [from, to) of one site-year.
 * nee = measured NEE after the flag and plausibility filter (NaN = rejected).
 */
export function movingPointTest(nee: Float64Array, ustar: Float64Array, ta: Float64Array, night: Float64Array, month: Int32Array, from: number, to: number): MptResult {
  const p = CONST.maktau.mpt;
  const seasons: MptSeason[] = [];
  for (let season = 0; season < 4; season++) {
    const rows: number[] = [];
    for (let i = from; i < to; i++) {
      if (night[i] !== 1 || isNA(nee[i]!) || isNA(ustar[i]!) || isNA(ta[i]!)) continue;
      if (Math.floor((month[i]! - 1) / 3) !== season) continue;
      rows.push(i);
    }
    const classThresholds: number[] = [];
    if (rows.length >= p.tempClasses * p.ustarClasses) {
      const tVals = rows.map((i) => ta[i]!);
      for (const tc of quantileClasses(tVals, p.tempClasses)) {
        const tcRows = tc.map((j) => rows[j]!);
        const u = tcRows.map((i) => ustar[i]!);
        const t = tcRows.map((i) => ta[i]!);
        if (Math.abs(correlation(t, u)) >= p.maxCorr) continue;
        const uc = quantileClasses(u, p.ustarClasses);
        const meanNee = uc.map((cls) => cls.reduce((a, j) => a + nee[tcRows[j]!]!, 0) / cls.length);
        const meanU = uc.map((cls) => cls.reduce((a, j) => a + u[j]!, 0) / cls.length);
        for (let j = 0; j < uc.length - 1; j++) {
          const next = meanNee.slice(j + 1, j + 1 + p.lookAhead);
          const ref = next.reduce((a, x) => a + x, 0) / next.length;
          if (meanNee[j]! >= p.plateauFraction * ref) {
            classThresholds.push(meanU[j]!);
            break;
          }
        }
      }
    }
    seasons.push({ season: season + 1, nNight: rows.length, classThresholds, threshold: median(classThresholds) });
  }
  const valid = seasons.map((s) => s.threshold).filter((x) => !isNA(x));
  const threshold = valid.length ? Math.max(...valid) : NaN;
  const bounded = isNA(threshold) ? NaN : Math.min(p.max, Math.max(p.min, threshold));
  return { seasons, threshold, bounded };
}
