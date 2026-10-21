import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROWS_PER_DAY } from './constants.ts';
import { interpolateLinear, longestGap, mdcValue, median, percentile, prefixCount } from './series.ts';

test('interpolateLinear fills short runs and keeps long runs', () => {
  const x = Float64Array.from([1, NaN, NaN, 4, NaN, NaN, NaN, 8, NaN]);
  const r = interpolateLinear(x, 2);
  assert.deepEqual(Array.from(r.values.slice(0, 4)), [1, 2, 3, 4]);
  assert.ok(Number.isNaN(r.values[5]!), 'run of 3 stays NaN');
  assert.ok(Number.isNaN(r.values[8]!), 'trailing NaN stays without holdEnds');
  const h = interpolateLinear(x, Infinity, true);
  assert.deepEqual(Array.from(h.values), [1, 2, 3, 4, 5, 6, 7, 8, 8]);
});

test('mdcValue takes the same time of day on the neighbouring days', () => {
  const x = new Float64Array(ROWS_PER_DAY * 5).fill(NaN);
  const i = ROWS_PER_DAY * 2 + 10;
  x[i - ROWS_PER_DAY] = 2;
  x[i + ROWS_PER_DAY] = 4;
  x[i + 1] = 100; // same day, ignored when hourTol = 0
  const r = mdcValue(x, i, 1, 0);
  assert.equal(r.n, 2);
  assert.equal(r.value, 3);
});

test('percentile and median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 100), 5);
});

test('prefixCount and longestGap', () => {
  const x = Float64Array.from([NaN, 1, NaN, NaN, NaN, 2]);
  const p = prefixCount(x);
  assert.equal(p[6]! - p[0]!, 2);
  assert.equal(p[5]! - p[2]!, 0);
  assert.equal(longestGap(x), 3);
});
