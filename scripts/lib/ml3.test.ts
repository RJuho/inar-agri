// Unit tests of the ML3 ThetaProbe conversion. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DuckDBInstance } from '@duckdb/node-api';
import { ml3MineralTheta, ml3MineralThetaSql } from './ml3.ts';

// ML3 manual ML3-UM-2.1, p. 23, linearisation table, mineral soil: [V, θ in % vol].
const TABLE: Array<[number, number]> = [
  [0.096, 0], [0.156, 4], [0.232, 8], [0.326, 12], [0.427, 16], [0.514, 20], [0.591, 24], [0.659, 28],
  [0.724, 32], [0.783, 36], [0.838, 40], [0.886, 44], [0.924, 48], [0.956, 52], [0.982, 56], [1.004, 60],
];

test('the mineral polynomial gives back the linearisation table of the manual', () => {
  for (const [volts, pct] of TABLE) {
    const theta = ml3MineralTheta(volts);
    assert.ok(Math.abs(theta - pct / 100) < 0.005, `V = ${volts}: θ = ${theta}, table ${pct / 100}`);
  }
});

test('the SQL expression gives the same values as the TypeScript function', async () => {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const rows = TABLE.map(([volts]) => `(${volts}::DOUBLE)`).join(', ');
    const reader = await conn.runAndReadAll(`SELECT v, (${ml3MineralThetaSql('v')})::DOUBLE AS t FROM (VALUES ${rows}) x(v)`);
    for (const r of reader.getRowObjects()) {
      assert.ok(Math.abs(Number(r.t) - ml3MineralTheta(Number(r.v))) < 1e-12);
    }
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
});
