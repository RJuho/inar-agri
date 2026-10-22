// Unit tests of the fixed y ranges (axisRanges.ts). Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockRange, fixedColorRange, fixedRange, setAxisRanges } from './axisRanges.ts';
import { defaultParams } from './state.ts';

const empty = { nee: [-1, 1] };
const DATA = {
  version: 1,
  created: '2026-10-21T00:00:00.000Z',
  step: { raw: { nee: [-49.48, 25.57], ta: [-39.2, 37.4] }, day: { nee: [-16.47, 8.81] }, week: empty, month: empty },
  diurnal: { nee: [-12.3, 4.1] },
  monthly: {},
  cumulative: { nee: [-488.9, 86.1], gpp: [-23.3, 1484.3] },
  budget: { nee: [-457.9, 0], gpp: [-1478.7, 0], reco: [0, 1200.2] },
  fingerprint: { nee: [-9.87, 3.21] },
};

const on = { ...defaultParams([1]), aggregation: 'raw' as const };
const off = { ...on, fixedY: false };

test('fixedRange rounds the range outwards with niceRange', () => {
  setAxisRanges(DATA);
  assert.deepEqual(fixedRange(on, 'step', 'nee'), { min: -60, max: 40, interval: 20 });
  assert.deepEqual(fixedRange(on, 'step', 'nee', 'day'), { min: -20, max: 10, interval: 10 });
  assert.deepEqual(fixedRange(on, 'diurnal', 'nee'), { min: -15, max: 5, interval: 5 });
});

test('fixedRange is null when the option is off or there is no entry', () => {
  setAxisRanges(DATA);
  assert.equal(fixedRange(off, 'step', 'nee'), null);
  assert.equal(fixedRange(on, 'step', 'ta', 'day'), null);
  assert.equal(fixedRange(on, 'monthly', 'nee'), null);
  assert.equal(fixedColorRange(off, 'nee'), null);
  assert.deepEqual(fixedColorRange(on, 'nee'), [-9.87, 3.21]);
});

test('blockRange gives the union of the variables and skips missing entries', () => {
  setAxisRanges(DATA);
  assert.deepEqual(blockRange(on, 'budget', ['nee', 'gpp', 'reco', 'ch4']), { min: -2000, max: 2000, interval: 1000 });
  assert.deepEqual(blockRange(on, 'cumulative', ['nee']), { min: -600, max: 200, interval: 200 });
  assert.equal(blockRange(on, 'budget', ['ch4']), null);
  assert.equal(blockRange(off, 'budget', ['nee']), null);
});

test('bad data gives no fixed ranges', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    setAxisRanges({ ...DATA, step: { ...DATA.step, raw: { nee: [2, 1] } } });
    assert.equal(fixedRange(on, 'step', 'nee'), null);
    setAxisRanges({ ...DATA, diurnal: { unknown: [0, 1] } });
    assert.equal(fixedRange(on, 'diurnal', 'nee'), null);
  } finally {
    console.warn = warn;
  }
});
