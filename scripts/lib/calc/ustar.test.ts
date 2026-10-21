import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterNee, movingPointTest } from './ustar.ts';

test('filterNee applies flag, plausibility and u*', () => {
  const nee = Float64Array.from([1, 2, 3, 60, 5, 6, NaN]);
  const ssitc = Float64Array.from([0, 1, 2, 0, NaN, 0, 0]);
  const ustar = Float64Array.from([0.3, 0.05, 0.3, 0.3, 0.3, NaN, 0.3]);
  const r = filterNee(nee, ssitc, ustar, 0.1);
  assert.deepEqual(Array.from(r.values).map((x) => (Number.isNaN(x) ? null : x)), [1, null, null, null, null, null, null]);
  assert.equal(r.counts.total, 6);
  assert.equal(r.counts.badFlag, 1);
  assert.equal(r.counts.noFlag, 1);
  assert.equal(r.counts.implausible, 1);
  assert.equal(r.counts.lowUstar, 1);
  assert.equal(r.counts.noUstar, 1);
  assert.equal(r.counts.kept, 1);
  const noU = filterNee(nee, ssitc, ustar, NaN);
  assert.equal(noU.counts.kept, 3);
});

function syntheticNight(step: number, monotone: boolean): { nee: Float64Array; ustar: Float64Array; ta: Float64Array; night: Float64Array; month: Int32Array } {
  const n = 4 * 3000;
  const nee = new Float64Array(n);
  const ustar = new Float64Array(n);
  const ta = new Float64Array(n);
  const night = new Float64Array(n).fill(1);
  const month = new Int32Array(n);
  let seed = 11;
  const rnd = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < n; i++) {
    month[i] = 1 + Math.floor(i / 1000);
    ustar[i] = 0.6 * rnd();
    ta[i] = 20 * rnd();
    const u = ustar[i]!;
    const base = monotone ? 1 + 4 * u : u < step ? 2 * (u / step) : 2;
    nee[i] = base + 0.1 * (rnd() - 0.5);
  }
  return { nee, ustar, ta, night, month };
}

test('movingPointTest finds a step at 0.15', () => {
  const d = syntheticNight(0.15, false);
  const r = movingPointTest(d.nee, d.ustar, d.ta, d.night, d.month, 0, d.nee.length);
  assert.ok(r.threshold > 0.1 && r.threshold < 0.2, `threshold ${r.threshold}`);
});

test('movingPointTest on a monotone series gives a high or no threshold', () => {
  const d = syntheticNight(0.15, true);
  const r = movingPointTest(d.nee, d.ustar, d.ta, d.night, d.month, 0, d.nee.length);
  assert.ok(Number.isNaN(r.threshold) || r.threshold > 0.3, `threshold ${r.threshold}`);
});
