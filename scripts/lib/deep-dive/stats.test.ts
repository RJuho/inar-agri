import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapMeanCi, incompleteBeta, pearsonP, tTestP, finite, mean, median, ols, pearson, quantile, rng, sd, summarise } from './stats.ts';

test('mean, sd and median of a small list', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(mean([]), null);
  assert.ok(Math.abs(sd([2, 4, 4, 4, 5, 5, 7, 9])! - 2.138089935) < 1e-9);
  assert.equal(sd([1]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.deepEqual(finite([1, null, NaN, undefined, 2, Infinity]), [1, 2]);
});

test('quantile interpolates as DuckDB quantile_cont', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
});

test('rng gives the same sequence for the same seed', () => {
  const a = rng(7);
  const b = rng(7);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('bootstrap CI contains the mean, is repeatable and needs three values', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  const ci = bootstrapMeanCi(xs, 0.95, 2000, 3)!;
  assert.ok(ci.lo < 4.5 && ci.hi > 4.5);
  assert.ok(ci.lo >= 1 && ci.hi <= 8);
  assert.deepEqual(bootstrapMeanCi(xs, 0.95, 2000, 3), ci);
  assert.equal(bootstrapMeanCi([1, 2]), null);
});

test('pearson and ols on a straight line', () => {
  const xs = [1, 2, 3, 4];
  const ys = xs.map((x) => 2 * x + 1);
  assert.ok(Math.abs(pearson(xs, ys)! - 1) < 1e-12);
  assert.ok(Math.abs(pearson(xs, ys.map((y) => -y))! + 1) < 1e-12);
  assert.deepEqual(ols(xs, ys), { slope: 2, intercept: 1 });
  assert.equal(pearson([1, 2], [1, 2]), null);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
});

test('summarise counts positive values and ignores missing values', () => {
  const s = summarise([1, -2, null, 3, 4]);
  assert.equal(s.n, 4);
  assert.equal(s.mean, 1.5);
  assert.equal(s.min, -2);
  assert.equal(s.max, 4);
  assert.equal(s.nPositive, 3);
  assert.ok(s.ciLo !== null && s.ciHi !== null && s.ciLo <= s.ciHi);
});

test('p-values of t and of a Pearson r match reference values', () => {
  // R: 2 * pt(-2.228139, 10) = 0.05; cor.test with r = 0.5, n = 10 gives p = 0.1411.
  assert.ok(Math.abs(tTestP(2.228139, 10) - 0.05) < 1e-5);
  assert.ok(Math.abs(pearsonP(0.5, 10)! - 0.141) < 1e-3);
  assert.ok(Math.abs(incompleteBeta(0.5, 2, 2) - 0.5) < 1e-12);
  assert.equal(pearsonP(null, 10), null);
  assert.equal(pearsonP(0.9, 2), null);
});
