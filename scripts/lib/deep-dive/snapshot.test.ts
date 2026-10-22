import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffJson, roundDeep } from './snapshot.ts';

test('diffJson accepts float noise and finds real changes', () => {
  assert.deepEqual(diffJson({ a: 1, b: [1, 2] }, { a: 1 + 1e-12, b: [1, 2] }), []);
  assert.deepEqual(diffJson({ a: 0 }, { a: 1e-12 }), []);
  assert.deepEqual(diffJson({ a: 1 }, { a: 1.01 }), ['$.a: 1 != 1.01']);
  assert.deepEqual(diffJson({ a: [1] }, { a: [1, 2] }), ['$.a: array length 1 != 2']);
  assert.deepEqual(diffJson({ a: 'x' }, { a: 'y' }), ['$.a: "x" != "y"']);
  assert.deepEqual(diffJson({ a: null }, { a: 0 }), ['$.a: null != 0']);
  assert.deepEqual(diffJson({}, { b: 1 }), ['$.b: missing in the committed file']);
});

test('diffJson ignores the given keys', () => {
  assert.deepEqual(diffJson({ dataVersion: 1, x: 2 }, { dataVersion: 9, x: 2 }, undefined, new Set(['dataVersion'])), []);
});

test('roundDeep rounds numbers on all levels and makes NaN null', () => {
  assert.deepEqual(roundDeep({ a: 1.23456789, b: [2.00000000001, NaN], c: 'x' }, 4), { a: 1.235, b: [2, null], c: 'x' });
});
