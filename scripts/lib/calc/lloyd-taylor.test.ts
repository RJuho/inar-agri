import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitLloydTaylor, fitLloydTaylorTrimmed, fitRref, ltG, ltModel } from './lloyd-taylor.ts';

/** Deterministic pseudo-random numbers (LCG), uniform in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function synthetic(n: number, rref: number, e0: number, noise: number, seed = 1): { t: number[]; r: number[] } {
  const rnd = lcg(seed);
  const t: number[] = [];
  const r: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = 2 + 18 * (i / (n - 1));
    const base = ltModel(ti, rref, e0);
    t.push(ti);
    r.push(base * (1 + noise * (2 * rnd() - 1)));
  }
  return { t, r };
}

test('ltG is zero at the reference temperature', () => {
  assert.ok(Math.abs(ltG(15)) < 1e-15);
  assert.ok(ltG(25) > 0 && ltG(5) < 0);
});

test('fitLloydTaylor recovers Rref and E0 from noisy data', () => {
  const { t, r } = synthetic(60, 2, 150, 0.05);
  const fit = fitLloydTaylor(t, r);
  assert.ok(fit.converged, 'converged');
  assert.ok(Math.abs(fit.rref - 2) / 2 < 0.02, `rref ${fit.rref}`);
  assert.ok(Math.abs(fit.e0 - 150) / 150 < 0.02, `e0 ${fit.e0}`);
  assert.ok(fit.seE0 > 0 && fit.seE0 < 15, `seE0 ${fit.seE0}`);
});

test('fitLloydTaylor is exact without noise', () => {
  const { t, r } = synthetic(30, 3.5, 220, 0);
  const fit = fitLloydTaylor(t, r);
  assert.ok(Math.abs(fit.rref - 3.5) < 1e-6);
  assert.ok(Math.abs(fit.e0 - 220) < 1e-3);
});

test('fitRref equals the joint fit when E0 is fixed at the joint estimate', () => {
  const { t, r } = synthetic(40, 1.2, 90, 0.1, 7);
  const joint = fitLloydTaylor(t, r);
  const fixed = fitRref(t, r, joint.e0);
  assert.ok(Math.abs(fixed.rref - joint.rref) < 1e-6);
  assert.ok(fixed.se > 0);
});

test('standard error falls with more data', () => {
  const a = fitLloydTaylor(...Object.values(synthetic(20, 2, 150, 0.1, 3)) as [number[], number[]]);
  const b = fitLloydTaylor(...Object.values(synthetic(200, 2, 150, 0.1, 3)) as [number[], number[]]);
  assert.ok(b.seE0 < a.seE0, `${b.seE0} < ${a.seE0}`);
});

test('the trimmed fit removes outliers', () => {
  const { t, r } = synthetic(60, 2, 150, 0.02);
  r[10] = 60; // one wild value
  r[40] = -30;
  const plain = fitLloydTaylor(t, r);
  const trimmed = fitLloydTaylorTrimmed(t, r, 5);
  assert.ok(Math.abs(trimmed.e0 - 150) < Math.abs(plain.e0 - 150));
  assert.ok(Math.abs(trimmed.e0 - 150) / 150 < 0.02, `e0 ${trimmed.e0}`);
});
