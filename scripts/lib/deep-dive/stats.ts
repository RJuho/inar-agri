// Small statistics helpers for the Deep Dive scripts (scripts/deep-dives/*.ts).
// Pure functions: no I/O, no DuckDB. Unit test: stats.test.ts.

/** Values that are finite numbers. */
export function finite(xs: readonly (number | null | undefined)[]): number[] {
  return xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
}

/** Arithmetic mean. Null for an empty list. */
export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n − 1). Null for fewer than two values. */
export function sd(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Median. Null for an empty list. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Quantile with linear interpolation (type 7, as R and DuckDB quantile_cont). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('quantile of an empty list');
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Seeded pseudo-random numbers in [0, 1) (mulberry32). The same seed gives the same
 * sequence, so a bootstrap gives the same result in each run.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapCi {
  lo: number;
  hi: number;
  resamples: number;
}

/**
 * Percentile bootstrap confidence interval of the mean.
 * Null for fewer than three values: the interval is then not useful.
 */
export function bootstrapMeanCi(xs: readonly number[], level = 0.95, resamples = 10_000, seed = 1): BootstrapCi | null {
  if (xs.length < 3) return null;
  const next = rng(seed);
  const means = new Float64Array(resamples);
  const n = xs.length;
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(next() * n)]!;
    means[r] = s / n;
  }
  means.sort();
  const a = (1 - level) / 2;
  return { lo: quantile(means as unknown as number[], a), hi: quantile(means as unknown as number[], 1 - a), resamples };
}

/** Pearson correlation. Null for fewer than three pairs or zero variance. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) throw new Error('pearson: lists have different lengths');
  if (xs.length < 3) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** ln Γ(x) (Lanczos approximation, x > 0). */
function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued fraction of the incomplete beta function (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of Student's t with `df` degrees of freedom. */
export function tTestP(t: number, df: number): number {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/**
 * Two-sided p-value of a Pearson correlation r from n pairs (t = r √((n − 2) / (1 − r²)), df = n − 2).
 * The OLS slope of the same pairs has the same p-value. Null for fewer than three pairs.
 */
export function pearsonP(r: number | null, n: number): number | null {
  if (r === null || n < 3) return null;
  if (Math.abs(r) >= 1) return 0;
  return tTestP(r * Math.sqrt((n - 2) / (1 - r * r)), n - 2);
}

/** Ordinary least squares line y = intercept + slope · x. Null for fewer than three pairs. */
export function ols(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number } | null {
  if (xs.length !== ys.length) throw new Error('ols: lists have different lengths');
  if (xs.length < 3) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Summary of a list of values: n, mean, SD, min, max and the bootstrap 95 % CI of the mean. */
export interface Summary {
  n: number;
  mean: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  ciLo: number | null;
  ciHi: number | null;
  /** Number of values above zero. */
  nPositive: number;
}

export function summarise(values: readonly (number | null | undefined)[], seed = 1): Summary {
  const xs = finite(values);
  const ci = bootstrapMeanCi(xs, 0.95, 10_000, seed);
  return {
    n: xs.length,
    mean: mean(xs),
    sd: sd(xs),
    min: xs.length ? Math.min(...xs) : null,
    max: xs.length ? Math.max(...xs) : null,
    ciLo: ci?.lo ?? null,
    ciHi: ci?.hi ?? null,
    nPositive: xs.filter((x) => x > 0).length,
  };
}

/** Result of a multiple linear regression. `coef[0]` is the intercept, `coef[j]` the slope of predictor j. */
export interface OlsMultiFit {
  coef: number[];
  residuals: number[];
  /** Residual standard deviation, √(SSE / (n − k − 1)). */
  residSd: number;
  r2: number;
  n: number;
}

/**
 * Ordinary least squares with k predictors: y = b0 + b1·x1 + … + bk·xk. The function adds the
 * intercept. It solves the normal equations with Gaussian elimination and partial pivoting.
 * Null when n ≤ k + 2 (too few rows for a useful residual SD) or when the system is singular.
 */
export function olsMulti(X: readonly (readonly number[])[], y: readonly number[]): OlsMultiFit | null {
  if (X.length !== y.length) throw new Error('olsMulti: X and y have different lengths');
  const n = y.length;
  if (n === 0) return null;
  const k = X[0]!.length;
  if (X.some((row) => row.length !== k)) throw new Error('olsMulti: rows of X have different lengths');
  if (n <= k + 2) return null;
  const p = k + 1;
  // Normal equations A b = c with A = Z'Z, c = Z'y, Z = [1, X].
  const a: number[][] = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
  for (let i = 0; i < n; i++) {
    const z = [1, ...X[i]!];
    for (let r = 0; r < p; r++) {
      for (let c = 0; c < p; c++) a[r]![c]! += z[r]! * z[c]!;
      a[r]![p]! += z[r]! * y[i]!;
    }
  }
  // Scale for the singularity test.
  let scale = 0;
  for (let r = 0; r < p; r++) scale = Math.max(scale, Math.abs(a[r]![r]!));
  const eps = 1e-12 * (scale || 1);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (Math.abs(a[piv]![col]!) <= eps) return null;
    [a[col], a[piv]] = [a[piv]!, a[col]!];
    for (let r = col + 1; r < p; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c <= p; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  const coef = new Array<number>(p).fill(0);
  for (let r = p - 1; r >= 0; r--) {
    let s = a[r]![p]!;
    for (let c = r + 1; c < p; c++) s -= a[r]![c]! * coef[c]!;
    coef[r] = s / a[r]![r]!;
  }
  if (!coef.every(Number.isFinite)) return null;
  const residuals = y.map((yi, i) => yi - predictMulti(coef, X[i]!));
  const my = mean(y)!;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sse += residuals[i]! ** 2;
    sst += (y[i]! - my) ** 2;
  }
  return { coef, residuals, residSd: Math.sqrt(sse / (n - p)), r2: sst === 0 ? 0 : 1 - sse / sst, n };
}

/** Value of a fit of olsMulti at the predictors x (without the intercept term). */
export function predictMulti(coef: readonly number[], x: readonly number[]): number {
  if (x.length !== coef.length - 1) throw new Error('predictMulti: wrong number of predictors');
  let s = coef[0]!;
  for (let j = 0; j < x.length; j++) s += coef[j + 1]! * x[j]!;
  return s;
}
