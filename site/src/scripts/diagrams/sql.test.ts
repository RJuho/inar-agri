// Unit tests of the aggregation helpers in sql.ts. Run: npm run test:unit
// DuckDB (Node) runs the SQL expressions on small tables, so the test checks the real values.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DuckDBInstance } from '@duckdb/node-api';
import { meanExpr, stepExpr } from './sql.ts';
import type { Variable } from '../state.ts';

/** Run `expr` on one column `name` with the given values and return the result as a number (NaN = NULL). */
async function evalAgg(name: Variable, values: Array<number | null>, expr: string): Promise<number> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const rows = values.map((v) => `(${v === null ? 'NULL' : v}::DOUBLE)`).join(', ');
    const reader = await conn.runAndReadAll(`SELECT (${expr})::DOUBLE AS r FROM (VALUES ${rows}) t(${name})`);
    const r = reader.getRowObjects()[0]?.r;
    return r === null || r === undefined ? Number.NaN : Number(r);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} is not ${b}`);

test('stepExpr gives the sum for precipitation and the mean for other variables', async () => {
  assert.equal(stepExpr('precip'), 'sum(precip)');
  assert.equal(stepExpr('ta'), 'avg(ta)');
  near(await evalAgg('precip', [0.2, 0, 1.4, null], stepExpr('precip')), 1.6);
  near(await evalAgg('ta', [1, 2, 6, null], stepExpr('ta')), 3);
});

test('meanExpr gives the mean also for precipitation', async () => {
  assert.equal(meanExpr('precip'), 'avg(precip)');
  near(await evalAgg('precip', [0.2, 0, 1.4, null], meanExpr('precip')), 1.6 / 3);
});

test('wind direction gets the circular mean in degrees 0 to 360', async () => {
  assert.equal(stepExpr('wd'), meanExpr('wd'));
  // 350° and 10° give north (0°), not 180°. The result can be 360 - 1e-12; compare on the circle.
  const north = await evalAgg('wd', [350, 10], stepExpr('wd'));
  near(Math.min(north, 360 - north), 0, 1e-6);
  near(await evalAgg('wd', [80, 100, null], stepExpr('wd')), 90, 1e-6);
  near(await evalAgg('wd', [180, 270], stepExpr('wd')), 225, 1e-6);
  near(await evalAgg('wd', [300, 320, 340], stepExpr('wd')), 320, 1e-6);
  // Only NULL values give NULL.
  assert.ok(Number.isNaN(await evalAgg('wd', [null, null], stepExpr('wd'))));
});

test('the helpers accept only whitelisted variable names', () => {
  assert.throws(() => stepExpr('x; DROP TABLE obs' as Variable), /Unknown variable/);
});
