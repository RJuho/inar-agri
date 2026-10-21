import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROWS_PER_DAY } from './constants.ts';
import { fillMds, mdsCascade } from './mds.ts';

test('the cascade has the Reichstein order', () => {
  const c = mdsCascade();
  assert.deepEqual(c.slice(0, 3).map((s) => `${s.kind}${s.days}`), ['lut3_7', 'lut3_14', 'lut1_7'].map((x) => x.replace('_', '')));
  assert.equal(c[c.length - 1]!.kind, 'mdc');
  assert.equal(c[c.length - 1]!.days, 210);
});

test('a gap with flat drivers takes the mean of the window with qc 1', () => {
  const n = ROWS_PER_DAY * 30;
  const target = new Float64Array(n).fill(2);
  const swIn = new Float64Array(n).fill(100);
  const ta = new Float64Array(n).fill(10);
  const vpd = new Float64Array(n).fill(5);
  target[n / 2] = NaN;
  target[n / 2 + 5] = 4; // inside the window
  const r = fillMds(target, { swIn, ta, vpd }, 0, n);
  assert.equal(r.qc[n / 2], 1);
  assert.equal(r.step[n / 2], 1);
  // window = ±7 days = 672 other rows: 671 of value 2 and one of value 4
  assert.ok(Math.abs(r.values[n / 2]! - (2 * (14 * ROWS_PER_DAY - 1) + 4) / (14 * ROWS_PER_DAY)) < 1e-9);
  assert.equal(r.counts.qc1, 1);
});

test('a row without VPD uses the one-driver lookup', () => {
  const n = ROWS_PER_DAY * 30;
  const target = new Float64Array(n).fill(3);
  const swIn = new Float64Array(n).fill(100);
  const ta = new Float64Array(n).fill(10);
  const vpd = new Float64Array(n).fill(5);
  target[100] = NaN;
  vpd[100] = NaN;
  const r = fillMds(target, { swIn, ta, vpd }, 0, n);
  assert.equal(r.step[100], 3);
  assert.equal(r.values[100], 3);
});

test('a long gap reaches qc 3 and a gap without any data stays unfilled', () => {
  const n = ROWS_PER_DAY * 400;
  const target = new Float64Array(n).fill(NaN);
  const swIn = new Float64Array(n).fill(100);
  const ta = new Float64Array(n).fill(10);
  const vpd = new Float64Array(n).fill(5);
  for (let i = 0; i < ROWS_PER_DAY * 10; i++) target[i] = 1; // data in the first 10 days only
  const r = fillMds(target, { swIn, ta, vpd }, 0, n);
  const i60 = ROWS_PER_DAY * 60;
  assert.equal(r.qc[i60], 3);
  assert.equal(r.values[i60], 1);
  const i300 = ROWS_PER_DAY * 300;
  assert.equal(r.qc[i300], 0);
  assert.ok(Number.isNaN(r.values[i300]!));
  assert.ok(r.counts.unfilled > 0);
});
