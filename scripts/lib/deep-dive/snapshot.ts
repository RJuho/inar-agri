// Snapshot helpers for the Deep Dive scripts: the data version of the inputs and the
// comparison of a fresh result with the committed JSON (npm run deep-dives -- --check).
// Unit test: snapshot.test.ts.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';

export interface InputFile {
  /** Path relative to the repository root. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface DataVersion {
  /** Time of the run (ISO). */
  generatedAt: string;
  /** Git commit of the code at run time, and true when the work tree had changes. */
  git: { commit: string; dirty: boolean };
  /** builtAt of db/report.json (npm run build:db). */
  dbBuiltAt: string | null;
  /** builtAt of data/calculated/report.json (npm run calc). */
  calcBuiltAt: string | null;
  inputs: InputFile[];
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function builtAt(path: string): string | null {
  if (!existsSync(path)) return null;
  const value = (JSON.parse(readFileSync(path, 'utf8')) as { builtAt?: unknown }).builtAt;
  return typeof value === 'string' ? value : null;
}

/** Build the data version of a run from its input files (paths relative to the repository root). */
export async function dataVersion(inputs: readonly string[]): Promise<DataVersion> {
  const files: InputFile[] = [];
  for (const path of inputs) {
    if (!existsSync(path)) throw new Error(`input file is missing: ${path}. Run npm run build:db && npm run calc.`);
    files.push({ path, bytes: statSync(path).size, sha256: await sha256(path) });
  }
  return {
    generatedAt: new Date().toISOString(),
    git: { commit: git(['rev-parse', '--short', 'HEAD']) || 'unknown', dirty: git(['status', '--porcelain']) !== '' },
    dbBuiltAt: builtAt('db/report.json'),
    calcBuiltAt: builtAt('data/calculated/report.json'),
    inputs: files,
  };
}

/** Round all numbers in a JSON value to `digits` significant digits. Keeps the committed files small and stable. */
export function roundDeep(value: unknown, digits = 10): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toPrecision(digits)) : null;
  if (Array.isArray(value)) return value.map((v) => roundDeep(v, digits));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v, digits)]));
  }
  return value;
}

export interface Tolerance {
  /** Relative tolerance. */
  rel: number;
  /** Absolute tolerance (for values near zero). */
  abs: number;
}

export const DEFAULT_TOLERANCE: Tolerance = { rel: 1e-6, abs: 1e-9 };

/**
 * Compare two JSON values. Numbers can differ by the tolerance (float noise of the sums).
 * Returns the paths and values of the differences; an empty list = equal.
 * Keys in `ignore` (on any level) are not compared, for example `dataVersion`.
 */
export function diffJson(
  a: unknown,
  b: unknown,
  tol: Tolerance = DEFAULT_TOLERANCE,
  ignore: ReadonlySet<string> = new Set(),
  path = '$',
): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    const d = Math.abs(a - b);
    return d <= tol.abs || d <= tol.rel * Math.max(Math.abs(a), Math.abs(b)) ? [] : [`${path}: ${a} != ${b}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: array length ${a.length} != ${b.length}`];
    return a.flatMap((x, i) => diffJson(x, b[i], tol, ignore, `${path}[${i}]`));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].filter((k) => !ignore.has(k));
    return keys.flatMap((k) => {
      if (!(k in ao)) return [`${path}.${k}: missing in the committed file`];
      if (!(k in bo)) return [`${path}.${k}: missing in the fresh result`];
      return diffJson(ao[k], bo[k], tol, ignore, `${path}.${k}`);
    });
  }
  return Object.is(a, b) ? [] : [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}
