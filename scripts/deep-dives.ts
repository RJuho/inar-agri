// Run the Deep Dive scripts (scripts/deep-dives/*.ts) and write their results to
// site/src/deep-dives/<slug>.json. The JSON files are in git: each article is a fixed snapshot.
// Python dives (analysis/<slug>/<slug>.py) write their own analysis/<slug>/results.json. This script
// runs them with `uv run` for --check (all Python dives) and for a given slug.
//
//   npm run deep-dives                     run all dives, write the JSON files
//   npm run deep-dives -- harvest-carbon   run one dive
//   npm run deep-dives -- --check          run all dives, compare with the committed JSON, write nothing;
//                                          exit code 1 when a result is different (float tolerance)
//
// Each dive module exports `slug`, `title`, `inputs` (files it reads) and `run(conn)`.
// A dive reads only db/*.parquet, data/calculated/* and data/SPI/*.csv. See CLAUDE.md, section "Deep Dive".

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { fail, log } from './lib/duck.ts';
import { dataVersion, DEFAULT_TOLERANCE, diffJson, roundDeep } from './lib/deep-dive/snapshot.ts';

interface DiveModule {
  slug: string;
  title: string;
  inputs: readonly string[];
  run(conn: DuckDBConnection): Promise<Record<string, unknown>>;
}

const DIVE_DIR = 'scripts/deep-dives';
const OUT_DIR = 'site/src/deep-dives';
/** Significant digits of the numbers in the JSON files. */
const DIGITS = 10;
/** Input folders that a dive can read. */
const ALLOWED_INPUT = /^(db\/[^/]+\.parquet|data\/calculated\/[^/]+|data\/SPI\/[^/]+\.csv)$/;

const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.filter((a) => !a.startsWith('--'));
const unknown = args.filter((a) => a.startsWith('--') && a !== '--check');
if (unknown.length) fail(`unknown option ${unknown.join(' ')}. Use: npm run deep-dives [-- --check] [slug ...]`);

const files = readdirSync(DIVE_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort();
/** Python dives: analysis/<slug>/<slug>.py. */
const ANALYSIS_DIR = 'analysis';
const pySlugs = existsSync(ANALYSIS_DIR)
  ? readdirSync(ANALYSIS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`${ANALYSIS_DIR}/${d.name}/${d.name}.py`))
      .map((d) => d.name)
      .sort()
  : [];
const selected = only.length ? files.filter((f) => only.includes(basename(f, '.ts'))) : files;
const selectedPy = only.length ? pySlugs.filter((s) => only.includes(s)) : check ? pySlugs : [];
if (only.length && selected.length + selectedPy.length !== only.length) {
  fail(`unknown dive: ${only.join(', ')}. Dives: ${[...files.map((f) => basename(f, '.ts')), ...pySlugs].join(', ')}`);
}

const db = await DuckDBInstance.create(':memory:', { threads: '1' });
const problems: string[] = [];
await mkdir(OUT_DIR, { recursive: true });

for (const file of selected) {
  const script = `${DIVE_DIR}/${file}`;
  const mod = (await import(pathToFileURL(join(process.cwd(), script)).href)) as DiveModule;
  if (mod.slug !== basename(file, '.ts')) fail(`${script}: slug '${mod.slug}' is not the file name`);
  for (const p of mod.inputs) if (!ALLOWED_INPUT.test(p)) fail(`${script}: input ${p} is not in db/*.parquet, data/calculated/ or data/SPI/*.csv`);
  const t0 = Date.now();
  const conn = await db.connect();
  let result: Record<string, unknown>;
  try {
    result = await mod.run(conn);
  } finally {
    conn.closeSync();
  }
  const out = {
    slug: mod.slug,
    title: mod.title,
    script,
    dataVersion: await dataVersion(mod.inputs),
    ...(roundDeep(result, DIGITS) as Record<string, unknown>),
  };
  const path = `${OUT_DIR}/${mod.slug}.json`;
  if (check) {
    if (!existsSync(path)) {
      problems.push(`${path}: file is missing. Run npm run deep-dives.`);
      continue;
    }
    const committed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const diffs = diffJson(committed, JSON.parse(JSON.stringify(out)), DEFAULT_TOLERANCE, new Set(['dataVersion']));
    if (diffs.length) {
      problems.push(`${path}: ${diffs.length} differences`, ...diffs.slice(0, 20).map((d) => `  ${d}`));
    } else {
      log(`${mod.slug}: same as ${path} (${Date.now() - t0} ms)`);
    }
  } else {
    await writeFile(path, `${JSON.stringify(out, null, 2)}\n`);
    log(`${mod.slug}: wrote ${path} (${Date.now() - t0} ms)`);
  }
}
db.closeSync();

// Python dives. --check: the script compares its fresh numbers with results.json and gives a
// non-zero exit code on a difference. Without --check (slug given): the script writes its files.
for (const slug of selectedPy) {
  const script = `${ANALYSIS_DIR}/${slug}/${slug}.py`;
  // --calculated only for a dive that reads data/calculated/ (CLAUDE.md: "only when the dive uses it").
  const usesCalculated = readFileSync(script, 'utf8').includes('"--calculated"');
  const pyArgs = ['run', script, ...(check ? ['--check'] : []), '--db', 'db', ...(usesCalculated ? ['--calculated', 'data/calculated'] : [])];
  log(`${slug}: uv ${pyArgs.join(' ')}`);
  const r = spawnSync('uv', pyArgs, { stdio: 'inherit' });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    problems.push(code === 'ENOENT' ? `${script}: uv is not installed (https://docs.astral.sh/uv/)` : `${script}: ${r.error.message}`);
  } else if (r.status !== 0) {
    problems.push(`${script}: exit code ${r.status ?? `signal ${r.signal}`}${check ? ' (results are different from analysis/' + slug + '/results.json, or the run failed)' : ''}`);
  }
}

if (problems.length) {
  fail(`the fresh results are different from the committed results, or a dive did not run:\n${problems.join('\n')}\nRun npm run deep-dives (Python dive: uv run analysis/<slug>/<slug>.py), then check the article text.`);
}
