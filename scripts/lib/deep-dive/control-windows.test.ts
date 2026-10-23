import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlAnchors, controlPairs, dayOfYear, nearestControls, rankAmong } from './control-windows.ts';
import type { VarRow } from './disturbance.ts';
import { dayNumber } from './harvest.ts';

test('controlAnchors gives the days around the day of year in each year', () => {
  const a = controlAnchors([2022, 2023], 130, 2);
  assert.equal(a.length, 10);
  assert.equal(a[0], dayNumber('2022-05-08'));
  assert.equal(a[2], dayNumber('2022-05-10'));
  assert.equal(a[7], dayNumber('2023-05-10'));
  assert.equal(dayOfYear(dayNumber('2022-05-10')), 130);
  assert.equal(dayOfYear(dayNumber('2024-12-31')), 366);
});

test('controlPairs drops blocked and short windows', () => {
  // Days 0..59: g = day number, t = 10 (constant), x only on days 0..19.
  const byDay = new Map<number, VarRow>();
  for (let d = 0; d < 60; d++) byDay.set(d, { g: d, t: 10, x: d < 20 ? 1 : null });
  const blocked = new Set([40]);
  const pairs = controlPairs(byDay, blocked, [10, 20, 30, 45], { from: -14, to: -1 }, { from: 1, to: 14 }, ['g', 't'], 12, ['x']);
  // 10: before window starts on day -4 (only 10 values): dropped. 30: day 40 blocked. 45: after window ends on day 59 (14 values), but day 40 is blocked.
  assert.deepEqual(pairs.map((p) => p.anchor), [20]);
  const p = pairs[0]!;
  assert.equal(p.delta.g, 15); // mean 27.5 − mean 12.5
  assert.equal(p.delta.t, 0);
  assert.equal(p.delta.x, null);
  assert.equal(p.before.g, 12.5);
});

test('nearestControls keeps the pairs within the tolerances', () => {
  const pairs = [
    { dTa: 2, dLightPct: 5, id: 'a' },
    { dTa: 3.5, dLightPct: 5, id: 'b' },
    { dTa: 2.9, dLightPct: -4, id: 'c' },
  ];
  assert.deepEqual(nearestControls(pairs, { ta: 3, lightPct: 4 }).map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(nearestControls(pairs, { ta: 3, lightPct: 10 }).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(nearestControls(pairs, { ta: 1, lightPct: 5 }, 1, 10).map((p) => p.id), ['a']);
});

test('rankAmong gives the percent of reference values below x', () => {
  assert.equal(rankAmong([1, 2, 3, 4], 10), 100);
  assert.equal(rankAmong([1, 2, 3, 4], 0), 0);
  assert.equal(rankAmong([1, 2, 3, 4], 2.5), 50);
  assert.throws(() => rankAmong([], 1));
});
