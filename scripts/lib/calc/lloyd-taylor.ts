// Lloyd and Taylor 1994 respiration model and its least-squares fits.
//
//   R(T) = Rref * exp(E0 * (1 / (Tref - T0) - 1 / (T - T0)))
//
// T in °C. Tref = 15 °C, T0 = -46.02 °C (Reichstein et al. 2005).
// fitRref: Rref with E0 fixed, closed form.
// fitLloydTaylor: Rref and E0 together, Levenberg-Marquardt with an
// analytic Jacobian. Fallback: golden-section search on E0.

import { CONST } from './constants.ts';
import { percentile } from './series.ts';

const { tref, t0 } = CONST.lloydTaylor;

/** g(T) = 1/(Tref - T0) - 1/(T - T0). */
export function ltG(t: number): number {
  return 1 / (tref - t0) - 1 / (t - t0);
}

export function ltModel(t: number, rref: number, e0: number): number {
  return rref * Math.exp(e0 * ltG(t));
}

export type RrefFit = { rref: number; se: number; n: number; ssr: number };

/** Rref for a fixed E0: least squares of R on f = exp(E0 g(T)). Rref = sum(R f) / sum(f^2). */
export function fitRref(t: ArrayLike<number>, r: ArrayLike<number>, e0: number): RrefFit {
  let sf2 = 0;
  let srf = 0;
  const n = t.length;
  for (let i = 0; i < n; i++) {
    const f = Math.exp(e0 * ltG(t[i]!));
    sf2 += f * f;
    srf += r[i]! * f;
  }
  const rref = sf2 > 0 ? srf / sf2 : NaN;
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const d = r[i]! - rref * Math.exp(e0 * ltG(t[i]!));
    ssr += d * d;
  }
  const s2 = n > 1 ? ssr / (n - 1) : NaN;
  return { rref, se: sf2 > 0 ? Math.sqrt(s2 / sf2) : NaN, n, ssr };
}

export type LtFit = {
  rref: number;
  e0: number;
  seRref: number;
  seE0: number;
  n: number;
  ssr: number;
  iterations: number;
  converged: boolean;
  method: 'lm' | 'golden';
};

function sumSquares(t: ArrayLike<number>, r: ArrayLike<number>, rref: number, e0: number): number {
  let s = 0;
  for (let i = 0; i < t.length; i++) {
    const d = r[i]! - ltModel(t[i]!, rref, e0);
    s += d * d;
  }
  return s;
}

/** Standard errors from the Jacobian at the solution: cov = s^2 (J'J)^-1. */
function standardErrors(t: ArrayLike<number>, r: ArrayLike<number>, rref: number, e0: number): { seRref: number; seE0: number; ssr: number } {
  let a = 0; // sum f^2
  let b = 0; // sum f * (rref g f)
  let c = 0; // sum (rref g f)^2
  let ssr = 0;
  for (let i = 0; i < t.length; i++) {
    const g = ltG(t[i]!);
    const f = Math.exp(e0 * g);
    const j2 = rref * g * f;
    a += f * f;
    b += f * j2;
    c += j2 * j2;
    const d = r[i]! - rref * f;
    ssr += d * d;
  }
  const n = t.length;
  const det = a * c - b * b;
  if (n <= 2 || det <= 0) return { seRref: NaN, seE0: NaN, ssr };
  const s2 = ssr / (n - 2);
  return { seRref: Math.sqrt((s2 * c) / det), seE0: Math.sqrt((s2 * a) / det), ssr };
}

/** Golden-section search of E0 in [lo, hi] with the closed-form Rref (variable projection). */
function goldenE0(t: ArrayLike<number>, r: ArrayLike<number>, lo: number, hi: number): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  const f = (e0: number) => fitRref(t, r, e0).ssr;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let k = 0; k < 200 && b - a > 1e-6; k++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * Joint fit of Rref and E0. Levenberg-Marquardt on the residuals
 * r_i - Rref exp(E0 g_i). Start: E0 = init.e0 (default 100), Rref closed form.
 */
export function fitLloydTaylor(t: ArrayLike<number>, r: ArrayLike<number>, init: { e0?: number } = {}): LtFit {
  const n = t.length;
  let e0 = init.e0 ?? 100;
  let rref = fitRref(t, r, e0).rref;
  let ssr = sumSquares(t, r, rref, e0);
  let lambda = 1e-3;
  let converged = false;
  let iterations = 0;
  for (; iterations < 100; iterations++) {
    // Normal equations with J = d(residual)/d(p): [-f, -rref g f]
    let a = 0;
    let b = 0;
    let c = 0;
    let g1 = 0;
    let g2 = 0;
    for (let i = 0; i < n; i++) {
      const g = ltG(t[i]!);
      const f = Math.exp(e0 * g);
      const j1 = -f;
      const j2 = -rref * g * f;
      const res = r[i]! - rref * f;
      a += j1 * j1;
      b += j1 * j2;
      c += j2 * j2;
      g1 += j1 * res;
      g2 += j2 * res;
    }
    let accepted = false;
    for (let k = 0; k < 20; k++) {
      const aa = a * (1 + lambda);
      const cc = c * (1 + lambda);
      const det = aa * cc - b * b;
      if (!(det > 0)) {
        lambda *= 10;
        continue;
      }
      // Solve (J'J + lambda diag) delta = -J'res
      const d1 = (-g1 * cc + g2 * b) / det;
      const d2 = (-g2 * aa + g1 * b) / det;
      const rrefNew = rref + d1;
      const e0New = Math.min(1000, Math.max(-100, e0 + d2));
      const ssrNew = sumSquares(t, r, rrefNew, e0New);
      if (ssrNew < ssr) {
        const step = Math.hypot(d1, d2) / Math.max(1e-12, Math.hypot(rref, e0));
        const drop = ssr - ssrNew;
        rref = rrefNew;
        e0 = e0New;
        ssr = ssrNew;
        lambda = Math.max(1e-12, lambda / 10);
        accepted = true;
        if (step < 1e-8 || drop < 1e-12 * Math.max(1, ssr)) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!accepted) {
      // No damping gives a lower SSR: the current point is a numerical minimum.
      converged = iterations > 0;
      break;
    }
    if (converged) break;
  }
  if (!converged || !Number.isFinite(e0) || !Number.isFinite(rref)) {
    e0 = goldenE0(t, r, 0, 600);
    rref = fitRref(t, r, e0).rref;
    const se = standardErrors(t, r, rref, e0);
    return { rref, e0, seRref: se.seRref, seE0: se.seE0, n, ssr: se.ssr, iterations, converged: true, method: 'golden' };
  }
  const se = standardErrors(t, r, rref, e0);
  return { rref, e0, seRref: se.seRref, seE0: se.seE0, n, ssr: se.ssr, iterations, converged, method: 'lm' };
}

/**
 * REddyProc style trimmed fit: fit, drop the residuals outside the
 * [p, 100 - p] percentile band, fit again. Returns the second fit and the
 * number of values it used.
 */
export function fitLloydTaylorTrimmed(t: ArrayLike<number>, r: ArrayLike<number>, trimPercent: number): LtFit {
  const first = fitLloydTaylor(t, r);
  const res: number[] = [];
  for (let i = 0; i < t.length; i++) res.push(r[i]! - ltModel(t[i]!, first.rref, first.e0));
  const lo = percentile(res, trimPercent);
  const hi = percentile(res, 100 - trimPercent);
  const tk: number[] = [];
  const rk: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (res[i]! >= lo && res[i]! <= hi) {
      tk.push(t[i]!);
      rk.push(r[i]!);
    }
  }
  if (tk.length < 3) return first;
  return fitLloydTaylor(tk, rk, { e0: first.e0 });
}
