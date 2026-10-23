// Copy the DuckDB-WASM files to site/public/duckdb/, so that the page loads
// them from its own origin. The page makes no requests to other hosts.
//
// Run: node scripts/sync-site-duckdb.ts (npm run site:sync runs it)
//
// Output (not in git):
//   site/public/duckdb/<npm version>/duckdb-browser-{eh,mvp}.worker.js
//   site/public/duckdb/<npm version>/duckdb-{eh,mvp}.wasm.gz
//   site/public/duckdb/extensions/<DuckDB version>/wasm_{eh,mvp}/{parquet,excel}.duckdb_extension.wasm
//
// Cloudflare Workers static assets accept files up to 25 MiB. The DuckDB WASM
// files are 34 to 40 MB. Thus we compress them with gzip (level 9). The page
// decompresses them with DecompressionStream.
//
// The extensions (parquet, excel) are not in the npm package. DuckDB-WASM downloads
// them from <repository>/<DuckDB version>/<platform>/<name>.duckdb_extension.wasm.
// We download the official signed files one time into a cache in
// node_modules/.cache/ and copy them to the output. The DuckDB version comes
// from the WASM build in the npm package (SELECT version()), so it changes
// together with the npm version.
//
// The script does no work for a file when the output is newer than the input.

import { createRequire } from 'node:module';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
// The package exports no ./package.json, so we go up from dist/duckdb-browser.mjs.
const PKG_DIR = dirname(dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-browser.mjs')));
const DIST = join(PKG_DIR, 'dist');
const OUT_DIR = 'site/public/duckdb';
const CACHE_DIR = 'node_modules/.cache/inar-duckdb-ext';
const EXT_HOST = 'https://extensions.duckdb.org';
/**
 * Extensions that our queries load: parquet (the page reads and writes Parquet) and
 * excel (the data export writes XLSX). CSV is built in.
 */
const EXTENSIONS = ['parquet', 'excel'];
/** DuckDB-WASM bundles. selectBundle() in the page picks one of them. */
const BUNDLES = [
  { platform: 'wasm_eh', worker: 'duckdb-browser-eh.worker.js', wasm: 'duckdb-eh.wasm' },
  { platform: 'wasm_mvp', worker: 'duckdb-browser-mvp.worker.js', wasm: 'duckdb-mvp.wasm' },
] as const;
const MAX_BYTES = 25 * 1024 * 1024;

const gzip = promisify(zlib.gzip);

async function mtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** True when `out` exists and is newer than `input`. */
async function fresh(input: string, out: string): Promise<boolean> {
  const [a, b] = await Promise.all([mtime(input), mtime(out)]);
  return a !== null && b !== null && b >= a;
}

/** Remove all entries in `dir` except `keep`. */
async function prune(dir: string, keep: string[]): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!keep.includes(name)) await rm(join(dir, name), { recursive: true, force: true });
  }
}

const pkg = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8')) as { version: string };

/**
 * Get the DuckDB version of the WASM build (for example "v1.4.3").
 * We start the Node build of the npm package one time and keep the result in the cache.
 */
async function duckdbVersion(): Promise<string> {
  const file = join(CACHE_DIR, `version-${pkg.version}.json`);
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as { duckdb?: unknown };
    if (typeof cached.duckdb === 'string') return cached.duckdb;
  } catch {
    // No cache yet.
  }
  interface BlockingDB {
    instantiate(): Promise<unknown>;
    getVersion(): string;
  }
  const blocking = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as {
    createDuckDB(bundles: object, logger: object, runtime: object): Promise<BlockingDB>;
    VoidLogger: new () => object;
    NODE_RUNTIME: object;
  };
  const db = await blocking.createDuckDB(
    {
      mvp: { mainModule: join(DIST, 'duckdb-mvp.wasm'), mainWorker: join(DIST, 'duckdb-node-mvp.worker.cjs') },
      eh: { mainModule: join(DIST, 'duckdb-eh.wasm'), mainWorker: join(DIST, 'duckdb-node-eh.worker.cjs') },
    },
    new blocking.VoidLogger(),
    blocking.NODE_RUNTIME,
  );
  await db.instantiate();
  const version = db.getVersion();
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error(`Unexpected DuckDB version "${version}".`);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ npm: pkg.version, duckdb: version }) + '\n');
  return version;
}

/** Download one extension file into the cache, if it is not there. Return the cache path. */
async function cachedExtension(version: string, platform: string, name: string): Promise<string> {
  const rel = `${version}/${platform}/${name}.duckdb_extension.wasm`;
  const path = join(CACHE_DIR, rel);
  if ((await mtime(path)) !== null) return path;
  const url = `${EXT_HOST}/${rel}`;
  let bytes: Uint8Array;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error(
      `Cannot download ${url}: ${err instanceof Error ? err.message : String(err)}.\n` +
        `The build needs internet access one time to put the DuckDB ${name} extension into ${CACHE_DIR}/.`,
    );
    process.exit(1);
  }
  // A WASM file starts with "\0asm".
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    console.error(`${url} is not a WASM file.`);
    process.exit(1);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, bytes);
  await rename(`${path}.tmp`, path);
  console.log(`Downloaded ${url} (${bytes.length} bytes) to the cache.`);
  return path;
}

async function report(path: string, action: string): Promise<void> {
  const { size } = await stat(path);
  if (size >= MAX_BYTES) {
    console.error(`${path} is ${size} bytes. Cloudflare accepts files up to 25 MiB only.`);
    process.exit(1);
  }
  console.log(`${action} ${path} (${size} bytes)`);
}

const version = await duckdbVersion();
const binDir = join(OUT_DIR, pkg.version);
const extDir = join(OUT_DIR, 'extensions');
await prune(OUT_DIR, [pkg.version, 'extensions']);
await prune(extDir, [version]);
await mkdir(binDir, { recursive: true });

for (const b of BUNDLES) {
  const workerIn = join(DIST, b.worker);
  const workerOut = join(binDir, b.worker);
  if (await fresh(workerIn, workerOut)) {
    await report(workerOut, 'Up to date:');
  } else {
    await copyFile(workerIn, workerOut);
    await report(workerOut, 'Copied');
  }

  const wasmIn = join(DIST, b.wasm);
  const wasmOut = join(binDir, `${b.wasm}.gz`);
  if (await fresh(wasmIn, wasmOut)) {
    await report(wasmOut, 'Up to date:');
  } else {
    await writeFile(wasmOut, await gzip(await readFile(wasmIn), { level: 9 }));
    await report(wasmOut, 'Compressed');
  }

  for (const name of EXTENSIONS) {
    const extIn = await cachedExtension(version, b.platform, name);
    const extOut = join(extDir, version, b.platform, `${name}.duckdb_extension.wasm`);
    if (await fresh(extIn, extOut)) {
      await report(extOut, 'Up to date:');
    } else {
      await mkdir(dirname(extOut), { recursive: true });
      await copyFile(extIn, extOut);
      await report(extOut, 'Copied');
    }
  }
}
