// Unit tests of the fitted curves of the response diagram. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BETA_MAX_FACTOR, MIN_BINS, evalFit, fitLight, fitQ10, fitText, lightModel, q10Model, sig, solveLinear } from './fit.ts';

/** Deterministic pseudo-random numbers (LCG), uniform in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const near = (a: number, b: number, rel: number) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} is not near ${b}`);

test('solveLinear solves a 3 × 3 system and detects a singular matrix', () => {
  const x = solveLinear(
    [
      [2, 1, -1],
      [-3, -1, 2],
      [-2, 1, 2],
    ],
    [8, -11, -3],
  );
  assert.ok(x);
  near(x[0] as number, 2, 1e-9);
  near(x[1] as number, 3, 1e-9);
  near(x[2] as number, -1, 1e-9);
  assert.equal(
    solveLinear(
      [
        [1, 2],
        [2, 4],
      ],
      [1, 2],
    ),
    null,
  );
});

test('fitLight recovers alpha, beta and gamma of a NEE light response', () => {
  const rnd = lcg(7);
  const q: number[] = [];
  const y: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < 30; i++) {
    const qi = 20 + i * 60;
    q.push(qi);
    y.push(lightModel(qi, -1, 0.03, 28, 3) + (rnd() - 0.5) * 0.4);
    w.push(100 + Math.round(rnd() * 900));
  }
  const fit = fitLight(q, y, w, -1);
  assert.ok(fit);
  assert.equal(fit.kind, 'light');
  assert.ok(fit.converged);
  near(fit.alpha, 0.03, 0.1);
  near(fit.beta, 28, 0.05);
  near(fit.gamma, 3, 0.15);
  assert.ok(fit.r2 > 0.99);
  assert.equal(fit.n, 30);
  near(evalFit(fit, 1000), lightModel(1000, -1, fit.alpha, fit.beta, fit.gamma), 1e-12);
});

test('fitLight for GPP has no gamma and gives positive values', () => {
  const q = Array.from({ length: 20 }, (_, i) => 50 + i * 80);
  const y = q.map((qi) => lightModel(qi, 1, 0.02, 20, 0));
  const w = q.map(() => 50);
  const fit = fitLight(q, y, w, 1);
  assert.ok(fit);
  assert.equal(fit.withGamma, false);
  assert.equal(fit.gamma, 0);
  near(fit.alpha, 0.02, 1e-3);
  near(fit.beta, 20, 1e-3);
  assert.ok(evalFit(fit, 500) > 0);
});

test('fitLight bounds beta for a linear response and reports no saturation', () => {
  const q = Array.from({ length: 20 }, (_, i) => 50 + i * 75);
  const y = q.map((qi) => 0.01 * qi);
  const fit = fitLight(q, y, q.map(() => 1), 1);
  assert.ok(fit);
  assert.ok(fit.betaBound);
  near(fit.beta, BETA_MAX_FACTOR * 0.01 * 1475, 1e-3);
  assert.ok(fit.alpha > 0.0099 && fit.alpha < 0.012);
  assert.match(fitText(fit, '', false), /β ≥ \d.* \(no saturation\)/);
  assert.match(fitText(fit, 'u', true), /no light saturation in the data range/);
});

test('fitLight skips NaN bins and returns null with too few bins', () => {
  const q = [1, 2, 3, 4, 5, 6, 7];
  assert.equal(fitLight(q, q, q.map(() => 1), 1), null);
  const q2 = Array.from({ length: MIN_BINS + 2 }, (_, i) => 100 + 100 * i);
  const y2 = q2.map((qi) => lightModel(qi, 1, 0.02, 20, 0));
  y2[0] = Number.NaN;
  y2[1] = Number.NaN;
  y2[2] = Number.NaN;
  assert.equal(fitLight(q2, y2, q2.map(() => 1), 1), null);
  y2[2] = lightModel(q2[2] as number, 1, 0.02, 20, 0);
  const fit = fitLight(q2, y2, q2.map(() => 1), 1);
  assert.ok(fit);
  assert.equal(fit.n, MIN_BINS);
  assert.ok(fit.converged);
});

test('fitQ10 recovers Q10 and R10 and uses only bins with y > 0', () => {
  const t = Array.from({ length: 20 }, (_, i) => -5 + i * 1.5);
  const y = t.map((ti) => q10Model(ti, 2.2, 3));
  const w = t.map((_, i) => 10 + i);
  y[0] = -1; // not in the fit
  const fit = fitQ10(t, y, w);
  assert.ok(fit);
  assert.equal(fit.kind, 'q10');
  assert.equal(fit.n, 19);
  near(fit.q10, 2.2, 1e-6);
  near(fit.r10, 3, 1e-6);
  near(fit.r2, 1, 1e-9);
  assert.equal(fitQ10([1, 2, 3], [1, 2, 3], [1, 1, 1]), null);
});

test('sig and fitText format the parameters with 3 significant digits', () => {
  assert.equal(sig(0.031234), '0.0312');
  assert.equal(sig(28.44), '28.4');
  assert.equal(sig(3.1), '3.1');
  assert.equal(sig(1250), '1250');
  assert.equal(sig(0), '0');
  assert.equal(sig(Number.NaN), '–');
  const light = fitLight(
    Array.from({ length: 10 }, (_, i) => 100 + 150 * i),
    Array.from({ length: 10 }, (_, i) => lightModel(100 + 150 * i, -1, 0.03, 28, 3)),
    Array.from({ length: 10 }, () => 1),
    -1,
  );
  assert.ok(light);
  assert.equal(fitText(light, '', false), 'α 0.03, β 28, γ 3');
  assert.equal(fitText(light, 'µmol', true), 'α = 0.03, β = 28 µmol, γ = 3 µmol (R² = 1.00)');
  const q10: Parameters<typeof fitText>[0] = { kind: 'q10', q10: 2.123, r10: 3.456, r2: 0.9, n: 9 };
  assert.equal(fitText(q10, 'u', true), 'Q₁₀ = 2.12, R₁₀ = 3.46 u (R² = 0.90)');
});
