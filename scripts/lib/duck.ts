// Small helpers shared by scripts/build-db.ts and scripts/calc.ts:
// SQL literals, DuckDB row access, logging and Markdown tables.

import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';

/** SQL literal for a string, number, boolean or NULL. */
export function lit(x: string | number | boolean | null | undefined): string {
  if (x === null || x === undefined) return 'NULL';
  if (typeof x === 'number') return Number.isFinite(x) ? String(x) : 'NULL';
  if (typeof x === 'boolean') return x ? 'TRUE' : 'FALSE';
  return `'${x.replace(/'/g, "''")}'`;
}

/** Quoted SQL identifier. */
export const ident = (x: string): string => `"${x.replace(/"/g, '""')}"`;

/** DuckDB value to a plain JS value: bigint to number, objects (timestamps) to string. */
export function plain(value: DuckDBValue): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value !== null && typeof value === 'object') return String(value);
  return value;
}

export async function rows(conn: DuckDBConnection, sql: string): Promise<Record<string, unknown>[]> {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects().map((o) => Object.fromEntries(Object.entries(o).map(([k, val]) => [k, plain(val)])));
}

export async function one(conn: DuckDBConnection, sql: string): Promise<Record<string, unknown>> {
  const r = await rows(conn, sql);
  if (r.length !== 1) throw new Error(`expected one row, got ${r.length}: ${sql}`);
  return r[0]!;
}

export const num = (x: unknown): number => (typeof x === 'number' ? x : Number(x));
export const numOrNull = (x: unknown): number | null => (x === null || x === undefined ? null : num(x));
export const str = (x: unknown): string => String(x);

export function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export function fail(msg: string): never {
  process.stderr.write(`\nERROR: ${msg}\n`);
  process.exit(1);
}

/** Number for a report: integers as is, other values with 5 significant digits. */
export function fmt(x: number | null | undefined): string {
  if (x === null || x === undefined) return '';
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(5)));
}

/** Markdown table. */
export function table(headers: string[], body: (string | number | null)[][]): string {
  const line = (cells: (string | number | null)[]) => `| ${cells.map((c) => (c === null ? '' : String(c))).join(' | ')} |`;
  return [line(headers), `|${headers.map(() => '---').join('|')}|`, ...body.map(line)].join('\n');
}
