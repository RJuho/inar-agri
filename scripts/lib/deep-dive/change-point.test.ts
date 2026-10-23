import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysToRecover, detectDrop, preDrop, rangeMean } from './change-point.ts';
import type { VarRow } from './disturbance.ts';

/** Map day → {g: value} from a list that starts on day 0. */
const series = (xs: (number | null)[], v = 'g'): Map<number, VarRow> => new Map(xs.map((x, i) => [i, { [v]: x }]));

test('rangeMean skips missing values', () => {
  const m = series([1, null, 3]);
  assert.deepEqual(rangeMean(m, 'g', 0, 5), { mean: 2, n: 2 });
});

test('detectDrop finds the first day of the lower level', () => {
  // Level 6 on days 0..14, level 2 from day 15.
  const m = series([...Array(15).fill(6), ...Array(15).fill(2)]);
  const r = detectDrop(m, 'g', 8, 22, { anchor: 18 });
  assert.equal(r.detected, 15);
  assert.equal(r.offset, -3);
  assert.equal(r.drop, 4);
  assert.ok(Math.abs(r.dropPct! - 66.6666666667) < 1e-6);
  assert.equal(r.clear, true);
  assert.equal(r.reason, null);
});

test('detectDrop gives the reasons of an unclear drop', () => {
  assert.equal(detectDrop(series([1, 1]), 'g', 0, 1).reason, 'too-few-days');
  const small = series([...Array(15).fill(0.6), ...Array(15).fill(0.1)]);
  assert.equal(detectDrop(small, 'g', 8, 22).reason, 'flux-too-small');
  const flat = series([...Array(15).fill(6), ...Array(15).fill(5.5)]);
  const r = detectDrop(flat, 'g', 8, 22);
  assert.equal(r.reason, 'drop-too-small');
  assert.equal(r.clear, false);
  // Missing values: 4 of 5 on each side are enough.
  const gaps = series([...Array(15).fill(6), null, ...Array(14).fill(2)]);
  assert.equal(detectDrop(gaps, 'g', 8, 22).clear, true);
});

test('preDrop compares the near and the far window before the start', () => {
  // Days 0..9 = offsets -10..-1 from start 10.
  const m = series([5, 5, 5, 5, 5, 5, 5, 4, 3, 2, 1]);
  const r = preDrop(m, 'g', 10);
  assert.equal(r.far, 5);
  assert.equal(r.near, 3);
  assert.equal(r.pct, -40);
  assert.equal(preDrop(series([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), 'g', 10).pct, null);
});

test('daysToRecover finds the first day of the 80 % level and censors', () => {
  // end = day 0. GPP 2 on days 1..5, then 5 (ref 5, 80 % = 4).
  const xs = [0, 2, 2, 2, 2, 2, ...Array(30).fill(5)];
  const m = series(xs);
  // Running mean on day d: days d-2..d+2. Day 6: 2,2,5,5,5 = 3.8; day 7: 2,5,5,5,5 = 4.4.
  assert.deepEqual(daysToRecover(m, 'g', 0, 5), { days: 7, censored: false, reason: 'recovered' });
  assert.deepEqual(daysToRecover(m, 'g', 0, 5, { blockedFrom: 6 }), { days: null, censored: true, reason: 'blocked' });
  assert.deepEqual(daysToRecover(m, 'g', 0, null), { days: null, censored: false, reason: 'no-reference' });
  assert.equal(daysToRecover(series([0, 1, 1, 1]), 'g', 0, 5).reason, 'data-end');
  assert.equal(daysToRecover(series(Array(80).fill(1)), 'g', 0, 5).reason, 'max-days');
});
