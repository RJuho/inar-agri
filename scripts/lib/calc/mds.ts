// Marginal distribution sampling (MDS) gap filling after Reichstein et
// al. 2005, Fig. A1, as in REddyProc sMDSGapFill.
//
// The cascade for a missing value:
//   1. LUT3 ±7 d           qc 1   (sw_in, ta and vpd within tolerance)
//   2. LUT3 ±14 d          qc 1
//   3. LUT1 ±7 d           qc 1   (sw_in within tolerance)
//   4. MDC ±1 h, ±0..1 d   qc 1   (same time of day)
//   5. MDC ±2 d            qc 2
//   6. LUT3 ±21 … ±70 d    qc 2 up to ±28 d, else 3
//   7. LUT1 ±14 … ±70 d    qc 2 up to ±28 d, else 3
//   8. MDC ±7 … ±210 d     qc 3
// A row without ta or vpd skips the LUT3 steps. A lookup needs at least
// minCount values.

import { CONST, ROWS_PER_DAY } from './constants.ts';
import { isNA, mdcValue, prefixCount } from './series.ts';

export type MdsStep = { kind: 'lut3' | 'lut1' | 'mdc'; days: number; qc: 1 | 2 | 3 };

export function mdsCascade(): MdsStep[] {
  const steps: MdsStep[] = [
    { kind: 'lut3', days: 7, qc: 1 },
    { kind: 'lut3', days: 14, qc: 1 },
    { kind: 'lut1', days: 7, qc: 1 },
    { kind: 'mdc', days: 0, qc: 1 },
    { kind: 'mdc', days: 1, qc: 1 },
    { kind: 'mdc', days: 2, qc: 2 },
  ];
  for (let d = 21; d <= 70; d += 7) steps.push({ kind: 'lut3', days: d, qc: d <= 28 ? 2 : 3 });
  for (let d = 14; d <= 70; d += 7) steps.push({ kind: 'lut1', days: d, qc: d <= 28 ? 2 : 3 });
  for (let d = 7; d <= 210; d += 7) steps.push({ kind: 'mdc', days: d, qc: 3 });
  return steps;
}

export type MdsDrivers = { swIn: Float64Array; ta: Float64Array; vpd: Float64Array };
export type MdsResult = { values: Float64Array; qc: Uint8Array; step: Uint8Array; counts: { measured: number; qc1: number; qc2: number; qc3: number; unfilled: number } };

/**
 * Fill the NaN rows of target inside [from, to). Rows outside the range
 * stay as they are but serve as lookup candidates.
 */
export function fillMds(target: Float64Array, drivers: MdsDrivers, from: number, to: number): MdsResult {
  const n = target.length;
  const out = Float64Array.from(target);
  const qc = new Uint8Array(n);
  const step = new Uint8Array(n);
  const steps = mdsCascade();
  const prefix = prefixCount(target);
  const { tolSwIn, tolTa, tolVpd, minCount } = CONST.mds;
  const counts = { measured: 0, qc1: 0, qc2: 0, qc3: 0, unfilled: 0 };

  const lut = (i: number, days: number, three: boolean): number => {
    const w = days * ROWS_PER_DAY;
    const a = Math.max(0, i - w);
    const b = Math.min(n, i + w + 1);
    if (prefix[b]! - prefix[a]! === 0) return NaN;
    const r0 = drivers.swIn[i]!;
    const t0 = drivers.ta[i]!;
    const v0 = drivers.vpd[i]!;
    let s = 0;
    let c = 0;
    for (let k = a; k < b; k++) {
      const y = target[k]!;
      if (isNA(y)) continue;
      const r = drivers.swIn[k]!;
      if (isNA(r) || Math.abs(r - r0) > tolSwIn) continue;
      if (three) {
        const t = drivers.ta[k]!;
        const v = drivers.vpd[k]!;
        if (isNA(t) || isNA(v) || Math.abs(t - t0) > tolTa || Math.abs(v - v0) > tolVpd) continue;
      }
      s += y;
      c++;
    }
    return c >= minCount ? s / c : NaN;
  };

  for (let i = from; i < to; i++) {
    if (!isNA(target[i]!)) {
      counts.measured++;
      continue;
    }
    const hasR = !isNA(drivers.swIn[i]!);
    const has3 = hasR && !isNA(drivers.ta[i]!) && !isNA(drivers.vpd[i]!);
    let done = false;
    for (let sIdx = 0; sIdx < steps.length; sIdx++) {
      const st = steps[sIdx]!;
      let value = NaN;
      if (st.kind === 'lut3') {
        if (!has3) continue;
        value = lut(i, st.days, true);
      } else if (st.kind === 'lut1') {
        if (!hasR) continue;
        value = lut(i, st.days, false);
      } else {
        const r = mdcValue(target, i, st.days, CONST.taFill.hourTolRows);
        value = r.n >= minCount ? r.value : NaN;
      }
      if (!isNA(value)) {
        out[i] = value;
        qc[i] = st.qc;
        step[i] = sIdx + 1;
        if (st.qc === 1) counts.qc1++;
        else if (st.qc === 2) counts.qc2++;
        else counts.qc3++;
        done = true;
        break;
      }
    }
    if (!done) counts.unfilled++;
  }
  return { values: out, qc, step, counts };
}
