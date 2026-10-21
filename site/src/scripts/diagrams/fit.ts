// Fitted curves of the response diagram. Pure functions, no DOM, no ECharts.
//
// Light response (Falge et al. 2001), a rectangular hyperbola:
//   y = s * (alpha * Q * beta) / (alpha * Q + beta) + gamma
//   s = -1 for NEE (uptake is negative), s = +1 for GPP (gamma = 0).
//   alpha = apparent quantum yield, beta = GPP at saturating light, gamma = daytime respiration.
//   Fitted with Levenberg-Marquardt on the binned means, weighted by the count of each bin.
// Temperature response, an exponential Q10 model:
//   Reco = R10 * Q10 ^ ((T - 10) / 10)
//   Fitted by weighted linear regression of ln(y) on T over the bins with mean y > 0.

/** A fit needs at least this many bins. */
export const MIN_BINS = 8;
/**
 * Upper bound of beta: this factor times the largest |bin mean|. When the response is near
 * linear in the data range (no light saturation), beta goes to infinity without a bound.
 */
export const BETA_MAX_FACTOR = 10;

export interface LightFit {
  kind: 'light';
  /** -1 for NEE, +1 for GPP. */
  sign: 1 | -1;
  alpha: number;
  beta: number;
  /** Daytime respiration. 0 when the model has no gamma (GPP). */
  gamma: number;
  withGamma: boolean;
  /** True when beta is at its upper bound: the data show no light saturation. */
  betaBound: boolean;
  /** Weighted R² of the fit on the bin means. */
  r2: number;
  /** Number of bins in the fit. */
  n: number;
  converged: boolean;
}

export interface Q10Fit {
  kind: 'q10';
  q10: number;
  r10: number;
  /** Weighted R² of the linear fit of ln(y) on T. */
  r2: number;
  n: number;
}

export type Fit = LightFit | Q10Fit;

/** Value of the light response model. */
export function lightModel(q: number, sign: 1 | -1, alpha: number, beta: number, gamma: number): number {
  const d = alpha * q + beta;
  return d !== 0 ? (sign * (alpha * q * beta)) / d + gamma : gamma;
}

/** Value of the Q10 model. */
export function q10Model(t: number, q10: number, r10: number): number {
  return r10 * Math.pow(q10, (t - 10) / 10);
}

/** Value of a fit at `x`. */
export function evalFit(fit: Fit, x: number): number {
  return fit.kind === 'light' ? lightModel(x, fit.sign, fit.alpha, fit.beta, fit.gamma) : q10Model(x, fit.q10, fit.r10);
}

/** Finite points only. */
function finitePoints(x: ArrayLike<number>, y: ArrayLike<number>, w: ArrayLike<number>) {
  const px: number[] = [];
  const py: number[] = [];
  const pw: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i] as number;
    const b = y[i] as number;
    const c = w[i] as number;
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && c > 0) {
      px.push(a);
      py.push(b);
      pw.push(c);
    }
  }
  return { px, py, pw };
}

/** Weighted R²: 1 - SSR / total weighted sum of squares. */
function weightedR2(y: number[], w: number[], ssr: number): number {
  let sw = 0;
  let swy = 0;
  for (let i = 0; i < y.length; i++) {
    sw += w[i] as number;
    swy += (w[i] as number) * (y[i] as number);
  }
  const mean = swy / sw;
  let tss = 0;
  for (let i = 0; i < y.length; i++) tss += (w[i] as number) * ((y[i] as number) - mean) ** 2;
  return tss > 0 ? 1 - ssr / tss : Number.NaN;
}

/** Solve A x = b for a small square matrix with Gaussian elimination and partial pivoting. null when singular. */
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[p] as number[])[c] as number)) p = r;
    const pivot = (m[p] as number[])[c] as number;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-300) return null;
    if (p !== c) [m[p], m[c]] = [m[c] as number[], m[p] as number[]];
    const rowC = m[c] as number[];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const row = m[r] as number[];
      const f = (row[c] as number) / pivot;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) row[k] = (row[k] as number) - f * (rowC[k] as number);
    }
  }
  return m.map((row, i) => (row[n] as number) / (row[i] as number));
}

/** Weighted sum of squared residuals of the light model. */
function lightSsr(px: number[], py: number[], pw: number[], sign: 1 | -1, p: number[]): number {
  let s = 0;
  for (let i = 0; i < px.length; i++) {
    const d = (py[i] as number) - lightModel(px[i] as number, sign, p[0] as number, p[1] as number, p[2] ?? 0);
    s += (pw[i] as number) * d * d;
  }
  return s;
}

/**
 * Fit the light response to binned means. `q` = light per bin, `y` = mean per bin, `w` = count per bin.
 * `sign` = -1 for NEE (with gamma), +1 for GPP (without gamma). null when fewer than MIN_BINS finite bins
 * or when the fit fails.
 */
export function fitLight(q: ArrayLike<number>, y: ArrayLike<number>, w: ArrayLike<number>, sign: 1 | -1): LightFit | null {
  const withGamma = sign === -1;
  const { px, py, pw } = finitePoints(q, y, w);
  const n = px.length;
  if (n < MIN_BINS) return null;
  // Start values: alpha 0.02, beta = max |y|, gamma = y at the smallest Q.
  let iMin = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    if ((px[i] as number) < (px[iMin] as number)) iMin = i;
    maxAbs = Math.max(maxAbs, Math.abs(py[i] as number));
  }
  const k = withGamma ? 3 : 2;
  const betaMax = BETA_MAX_FACTOR * (maxAbs > 0 ? maxAbs : 1);
  let p = [0.02, maxAbs > 0 ? maxAbs : 1, ...(withGamma ? [py[iMin] as number] : [])];
  let ssr = lightSsr(px, py, pw, sign, p);
  let lambda = 1e-3;
  let converged = ssr === 0;
  for (let iter = 0; !converged && iter < 200 && lambda < 1e12; iter++) {
    // Normal equations: A = J' W J, g = J' W r.
    const a = Array.from({ length: k }, () => Array<number>(k).fill(0));
    const g = Array<number>(k).fill(0);
    const [alpha, beta] = p as [number, number];
    for (let i = 0; i < n; i++) {
      const qi = px[i] as number;
      const d = alpha * qi + beta;
      const d2 = d * d;
      const j = [(sign * qi * beta * beta) / d2, (sign * alpha * alpha * qi * qi) / d2, 1];
      const r = (py[i] as number) - lightModel(qi, sign, alpha, beta, p[2] ?? 0);
      const wi = pw[i] as number;
      for (let u = 0; u < k; u++) {
        g[u] = (g[u] as number) + wi * (j[u] as number) * r;
        const row = a[u] as number[];
        for (let v = 0; v < k; v++) row[v] = (row[v] as number) + wi * (j[u] as number) * (j[v] as number);
      }
    }
    const damped = a.map((row, u) => row.map((v, c) => (u === c ? v * (1 + lambda) : v)));
    const delta = solveLinear(damped, g);
    if (delta === null) break;
    const next = p.map((v, i) => v + (delta[i] as number));
    // Beta stays at or below its bound (projected step).
    next[1] = Math.min(next[1] as number, betaMax);
    if (!((next[0] as number) > 0 && (next[1] as number) > 0) || next.some((v) => !Number.isFinite(v))) {
      lambda *= 4;
      continue;
    }
    const nextSsr = lightSsr(px, py, pw, sign, next);
    if (nextSsr < ssr) {
      const rel = (ssr - nextSsr) / (ssr || 1);
      p = next;
      ssr = nextSsr;
      lambda = Math.max(lambda / 3, 1e-12);
      if (rel < 1e-9) {
        converged = true;
        break;
      }
    } else {
      // A rejected step that is very small: the fit is at the minimum.
      if (delta.every((d, i) => Math.abs(d) <= 1e-9 * Math.max(Math.abs(p[i] as number), 1e-300))) {
        converged = true;
        break;
      }
      lambda *= 4;
    }
  }
  const [alpha, beta] = p as [number, number];
  if (!Number.isFinite(alpha) || !Number.isFinite(beta)) return null;
  const betaBound = beta >= 0.999 * betaMax;
  return { kind: 'light', sign, alpha, beta, gamma: p[2] ?? 0, withGamma, betaBound, r2: weightedR2(py, pw, ssr), n, converged };
}

/**
 * Fit the Q10 model to binned means: weighted linear regression of ln(y) on T over the bins with
 * mean y > 0. null when fewer than MIN_BINS such bins.
 */
export function fitQ10(t: ArrayLike<number>, y: ArrayLike<number>, w: ArrayLike<number>): Q10Fit | null {
  const { px, py, pw } = finitePoints(t, y, w);
  const tt: number[] = [];
  const ly: number[] = [];
  const ww: number[] = [];
  for (let i = 0; i < px.length; i++) {
    if ((py[i] as number) > 0) {
      tt.push(px[i] as number);
      ly.push(Math.log(py[i] as number));
      ww.push(pw[i] as number);
    }
  }
  const n = tt.length;
  if (n < MIN_BINS) return null;
  let sw = 0;
  let st = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sw += ww[i] as number;
    st += (ww[i] as number) * (tt[i] as number);
    sy += (ww[i] as number) * (ly[i] as number);
  }
  const mt = st / sw;
  const my = sy / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dt = (tt[i] as number) - mt;
    sxx += (ww[i] as number) * dt * dt;
    sxy += (ww[i] as number) * dt * ((ly[i] as number) - my);
  }
  if (sxx <= 0) return null;
  const b = sxy / sxx;
  const a = my - b * mt;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ww[i] as number) * ((ly[i] as number) - a - b * (tt[i] as number)) ** 2;
  return { kind: 'q10', q10: Math.exp(10 * b), r10: Math.exp(a + 10 * b), r2: weightedR2(ly, ww, ssr), n };
}

/** Number with 3 significant digits, for example 0.0312, 28.4, 3.12, 1 250. */
export function sig(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '–';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-4) return v.toExponential(digits - 1);
  return String(Number(v.toPrecision(digits)));
}

/**
 * Fit parameters as text. `unit` is the display unit of y (for beta, gamma and R10).
 * Short form: "α 0.031, β 28.4, γ 3.1". Long form: "α = 0.031, β = 28.4 µmol…, γ = 3.1 µmol… (R² = 0.98)".
 * When beta is at its bound: "β ≥ 183 (no saturation)".
 */
export function fitText(fit: Fit, unit: string, long: boolean): string {
  const eq = long ? ' = ' : ' ';
  const u = long && unit ? ` ${unit}` : '';
  const r2 = long ? ` (R² = ${Number.isFinite(fit.r2) ? fit.r2.toFixed(2) : '–'})` : '';
  if (fit.kind === 'light') {
    const beta = fit.betaBound
      ? `β ≥ ${sig(fit.beta)}${u} (no ${long ? 'light saturation in the data range' : 'saturation'})`
      : `β${eq}${sig(fit.beta)}${u}`;
    const parts = [`α${eq}${sig(fit.alpha)}`, beta];
    if (fit.withGamma) parts.push(`γ${eq}${sig(fit.gamma)}${u}`);
    return `${parts.join(', ')}${r2}`;
  }
  return `Q₁₀${eq}${sig(fit.q10)}, R₁₀${eq}${sig(fit.r10)}${u}${r2}`;
}
