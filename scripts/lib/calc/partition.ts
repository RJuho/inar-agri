// Night-time flux partitioning after Reichstein et al. 2005, with the
// REddyProc defaults (see constants.ts). One site-year at a time.
//
// 1. E0 from 15-day windows of night-time measured NEE against temperature.
// 2. Rref from 7-day windows with E0 fixed, interpolated to every row.
// 3. Reco = Rref exp(E0 g(T)) for every row, GPP = Reco - NEE_f.

import { CONST, ROWS_PER_DAY, type TempVariable } from './constants.ts';
import { fitLloydTaylorTrimmed, fitRref, ltG } from './lloyd-taylor.ts';
import { interpolateLinear, isNA, mdcFill } from './series.ts';

/** All series of one site on the complete 30-minute grid. NaN = NULL. */
export type SiteSeries = {
  n: number;
  /** Local calendar day number (days since 2000-01-01) per row. */
  day: Int32Array;
  /** Local calendar year per row. */
  year: Int32Array;
  /** Local month (1-12) per row. */
  month: Int32Array;
  nee: Float64Array;
  neeQc: Float64Array;
  neeF: Float64Array;
  ta: Float64Array;
  tsoil: Float64Array;
  swIn: Float64Array;
  ppfd: Float64Array;
  vpd: Float64Array;
  ustar: Float64Array;
  ssitc: Float64Array;
  /** 1 = night, 0 = day, NaN = no radiation value. */
  night: Float64Array;
};

export type E0Window = {
  centreDay: number;
  n: number;
  tempRange: number;
  e0: number;
  seE0: number;
  rref: number;
  status: 'ok' | 'few_data' | 'temp_range' | 'out_of_limits' | 'fit_failed';
};

export type RrefWindow = { centreDay: number; centreRow: number; n: number; rref: number; se: number; used: boolean };

export type PartitionResult = {
  e0: number;
  e0Se: number;
  e0Method: 'windows' | 'few_windows' | 'annual' | 'neighbour' | 'none';
  nE0Valid: number;
  nNight: number;
  e0Windows: E0Window[];
  rrefWindows: RrefWindow[];
  /** Per row of the year: reco, gpp, rref (NaN where not computed), reco_fqc 0/1/2. */
  reco: Float64Array;
  gpp: Float64Array;
  rref: Float64Array;
  recoFqc: Uint8Array;
};

/** Fill a temperature series: linear interpolation of short gaps, then the mean diurnal course. qc 0 = measured, 1 = interpolated, 2 = MDC. */
export function fillTemperature(t: Float64Array): { values: Float64Array; qc: Uint8Array } {
  const lin = interpolateLinear(t, CONST.taFill.maxLinearRows);
  const mdc = mdcFill(lin.values, CONST.taFill.mdcDays, CONST.taFill.hourTolRows);
  const qc = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) qc[i] = lin.filled[i] ? 1 : mdc.qc[i] ? 2 : 0;
  return { values: mdc.values, qc };
}

export type PartitionOptions = {
  tempVar: TempVariable;
  gppNight: 'keep' | 'zero';
  /** Night rows with u* below this are left out of the sample. NaN = no u* filter. Rows without a u* value stay. */
  ustarMin: number;
  /** E0 to use instead of the window estimate (fallback from a neighbouring year). NaN = estimate. */
  forceE0?: number;
};

/**
 * Partition the rows [from, to) of one site (one local calendar year).
 * tempF is the gap-filled temperature of the whole site, neeF the gap-filled NEE.
 */
export function partitionYear(s: SiteSeries, tempF: Float64Array, neeF: Float64Array, from: number, to: number, opts: PartitionOptions): PartitionResult {
  const n = to - from;
  const limits = CONST.e0.limits[opts.tempVar];

  // 1. Night sample
  const idx: number[] = [];
  for (let i = from; i < to; i++) {
    if (s.night[i] !== 1 || s.neeQc[i] !== 0 || isNA(s.nee[i]!) || isNA(tempF[i]!)) continue;
    if (!isNA(opts.ustarMin) && !isNA(s.ustar[i]!) && s.ustar[i]! < opts.ustarMin) continue;
    idx.push(i);
  }
  const nightT = Float64Array.from(idx, (i) => tempF[i]!);
  const nightR = Float64Array.from(idx, (i) => s.nee[i]!);
  const nightDay = Int32Array.from(idx, (i) => s.day[i]!);

  const dayFirst = s.day[from]!;
  const dayLast = s.day[to - 1]!;

  const subset = (centre: number, win: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < idx.length; k++) if (Math.abs(nightDay[k]! - centre) <= win) out.push(k);
    return out;
  };

  // 2. E0 windows
  const e0Windows: E0Window[] = [];
  for (let c = dayFirst + CONST.e0.winDays; c <= dayLast; c += CONST.e0.stepDays) {
    const k = subset(c, CONST.e0.winDays);
    const w: E0Window = { centreDay: c, n: k.length, tempRange: NaN, e0: NaN, seE0: NaN, rref: NaN, status: 'ok' };
    e0Windows.push(w);
    if (k.length <= CONST.e0.minData) {
      w.status = 'few_data';
      continue;
    }
    const t = k.map((j) => nightT[j]!);
    const r = k.map((j) => nightR[j]!);
    w.tempRange = Math.max(...t) - Math.min(...t);
    if (w.tempRange < CONST.e0.minTempRange) {
      w.status = 'temp_range';
      continue;
    }
    const fit = fitLloydTaylorTrimmed(t, r, CONST.e0.trimPercent);
    w.e0 = fit.e0;
    w.seE0 = fit.seE0;
    w.rref = fit.rref;
    if (!Number.isFinite(fit.e0) || !Number.isFinite(fit.seE0)) {
      w.status = 'fit_failed';
      continue;
    }
    if (!(fit.e0 - fit.seE0 > limits.min && fit.e0 + fit.seE0 < limits.max)) w.status = 'out_of_limits';
  }
  const valid = e0Windows.filter((w) => w.status === 'ok').sort((a, b) => a.seE0 - b.seE0);
  let e0 = NaN;
  let e0Se = NaN;
  let e0Method: PartitionResult['e0Method'] = 'none';
  if (opts.forceE0 !== undefined && Number.isFinite(opts.forceE0)) {
    e0 = opts.forceE0;
    e0Method = 'neighbour';
  } else if (valid.length >= CONST.e0.nBest) {
    const best = valid.slice(0, CONST.e0.nBest);
    e0 = best.reduce((a, w) => a + w.e0, 0) / best.length;
    e0Se = Math.sqrt(best.reduce((a, w) => a + w.seE0 * w.seE0, 0)) / best.length;
    e0Method = 'windows';
  } else if (valid.length > 0) {
    e0 = valid.reduce((a, w) => a + w.e0, 0) / valid.length;
    e0Se = Math.sqrt(valid.reduce((a, w) => a + w.seE0 * w.seE0, 0)) / valid.length;
    e0Method = 'few_windows';
  } else if (idx.length > CONST.e0.minData) {
    const fit = fitLloydTaylorTrimmed(nightT, nightR, CONST.e0.trimPercent);
    if (Number.isFinite(fit.e0) && fit.e0 > limits.min && fit.e0 < limits.max) {
      e0 = fit.e0;
      e0Se = fit.seE0;
      e0Method = 'annual';
    }
  }

  const reco = new Float64Array(n).fill(NaN);
  const gpp = new Float64Array(n).fill(NaN);
  const rrefRow = new Float64Array(n).fill(NaN);
  const recoFqc = new Uint8Array(n);
  const rrefWindows: RrefWindow[] = [];
  if (!Number.isFinite(e0)) {
    return { e0, e0Se, e0Method, nE0Valid: valid.length, nNight: idx.length, e0Windows, rrefWindows, reco, gpp, rref: rrefRow, recoFqc };
  }

  // 3. Rref windows
  const centreRows: number[] = [];
  for (let c = dayFirst + CONST.rref.winDays; c <= dayLast; c += CONST.rref.stepDays) {
    const k = subset(c, CONST.rref.winDays);
    if (k.length <= CONST.rref.minData) {
      rrefWindows.push({ centreDay: c, centreRow: -1, n: k.length, rref: NaN, se: NaN, used: false });
      continue;
    }
    const t = k.map((j) => nightT[j]!);
    const r = k.map((j) => nightR[j]!);
    const fit = fitRref(t, r, e0);
    const centreRow = Math.round(k.reduce((a, j) => a + idx[j]!, 0) / k.length) - from;
    const used = Number.isFinite(fit.rref) && fit.rref >= 0;
    rrefWindows.push({ centreDay: c, centreRow, n: k.length, rref: fit.rref, se: fit.se, used });
    if (used && isNA(rrefRow[centreRow]!)) {
      rrefRow[centreRow] = fit.rref;
      centreRows.push(centreRow);
    }
  }
  if (centreRows.length === 0) {
    return { e0, e0Se, e0Method, nE0Valid: valid.length, nNight: idx.length, e0Windows, rrefWindows, reco, gpp, rref: rrefRow, recoFqc };
  }
  const interp = interpolateLinear(rrefRow, Infinity, true).values;

  // 4. Reco and GPP per row
  const maxDist = CONST.rref.maxCentreDistanceDays * ROWS_PER_DAY;
  let p = 0; // pointer into centreRows (sorted ascending by construction)
  for (let i = 0; i < n; i++) {
    const rr = interp[i]!;
    const t = tempF[from + i]!;
    if (isNA(rr) || isNA(t)) continue;
    rrefRow[i] = rr;
    while (p + 1 < centreRows.length && Math.abs(centreRows[p + 1]! - i) <= Math.abs(centreRows[p]! - i)) p++;
    const dist = Math.abs(centreRows[p]! - i);
    let rc = rr * Math.exp(e0 * ltG(t));
    const nf = neeF[from + i]!;
    let gp = isNA(nf) ? NaN : rc - nf;
    if (opts.gppNight === 'zero' && s.night[from + i] === 1 && !isNA(nf)) {
      rc = nf;
      gp = 0;
    }
    reco[i] = rc;
    gpp[i] = gp;
    recoFqc[i] = dist > maxDist ? 2 : 0;
  }
  return { e0, e0Se, e0Method, nE0Valid: valid.length, nNight: idx.length, e0Windows, rrefWindows, reco, gpp, rref: rrefRow, recoFqc };
}
