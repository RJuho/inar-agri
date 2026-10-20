// DuckDB-WASM access for the website.
// The page fetches the Parquet files from public/data/, registers them in an
// in-browser DuckDB and reads them with SQL. The files are small (about 8 MB),
// so we register full buffers. This works on all static hosts and does not
// need HTTP range requests.
//
// The WASM and worker files come from jsDelivr, not from our own host.
// Cloudflare Workers static assets accept files up to 25 MiB only, and the
// DuckDB WASM files are 34 to 40 MB.
//
// DuckDB-WASM loads the parquet extension from extensions.duckdb.org.
// A later option is to host the extension and set `custom_extension_repository`.
import * as duckdb from '@duckdb/duckdb-wasm';
import type { Table, Vector } from 'apache-arrow';

const PARQUET_FILES = ['observations.parquet', 'sites.parquet', 'variables.parquet'] as const;

export interface Site {
  siteId: number;
  code: string;
  name: string;
  country: string;
  utcOffsetMin: number;
}

export interface VariableInfo {
  name: string;
  unit: string;
  description: string;
}

/** Facts about the data that the UI needs: sites, variable units, year range. */
export interface Meta {
  sites: Site[];
  variables: Map<string, VariableInfo>;
  /** First and last year in site local time. */
  yearMin: number;
  yearMax: number;
  /** Number of rows in observations.parquet. */
  rowCount: number;
}

/** Make the URL of a file in public/data/. It follows the Astro base path. */
function dataUrl(file: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return new URL(`${base}data/${file}`, window.location.href).toString();
}

async function fetchBuffer(file: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) {
    throw new Error(`Cannot load ${file}: HTTP ${res.status}. Run "npm run build:db" and then the site build.`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Start DuckDB-WASM with the jsDelivr bundles.
 * selectBundle picks the EH build when the browser supports WASM exceptions.
 * A worker script must come from the page origin, so we start it through a
 * small blob script that calls importScripts() on the jsDelivr URL.
 */
async function startDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  if (!bundle.mainWorker) throw new Error('No DuckDB worker bundle found.');
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }),
  );
  try {
    const worker = new Worker(workerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  } finally {
    URL.revokeObjectURL(workerUrl);
  }
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

/**
 * Start DuckDB one time and load the data.
 * Table `obs` has all columns of observations.parquet plus `tl`:
 * the start of the period in site local time (ts_start + utc_offset_min).
 * The database stays open for later queries.
 */
function getDB(): Promise<duckdb.AsyncDuckDB> {
  dbPromise ??= (async () => {
    const [db, buffers] = await Promise.all([startDuckDB(), Promise.all(PARQUET_FILES.map(fetchBuffer))]);
    await Promise.all(PARQUET_FILES.map((f, i) => db.registerFileBuffer(f, buffers[i])));
    const conn = await db.connect();
    try {
      await conn.query(
        `CREATE TABLE obs AS
         SELECT o.*, o.ts_start + to_minutes(s.utc_offset_min::INT) AS tl
         FROM 'observations.parquet' o JOIN 'sites.parquet' s USING (site_id)`,
      );
    } finally {
      await conn.close();
    }
    return db;
  })();
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Run one SQL query on the open database and return an Arrow table. */
export async function query(sql: string): Promise<Table> {
  const db = await getDB();
  const conn = await db.connect();
  try {
    return await conn.query(sql);
  } finally {
    await conn.close();
  }
}

/** Copy an Arrow number column into a Float64Array. NULL becomes NaN. */
export function toFloat64(vec: Vector | null, length: number): Float64Array {
  const out = new Float64Array(length);
  if (!vec) {
    out.fill(Number.NaN);
    return out;
  }
  let offset = 0;
  for (const chunk of vec.data) {
    const values = chunk.values as ArrayLike<number>;
    const bitmap = chunk.nullBitmap;
    const hasNulls = chunk.nullCount > 0 && bitmap && bitmap.length > 0;
    const start = chunk.offset;
    for (let i = 0; i < chunk.length; i++) {
      const j = start + i;
      const valid = !hasNulls || (bitmap[j >> 3] & (1 << (j & 7))) !== 0;
      out[offset + i] = valid ? Number(values[j]) : Number.NaN;
    }
    offset += chunk.length;
  }
  return out;
}

/** Read a string column as plain strings. NULL becomes an empty string. */
function stringAt(table: Table, column: string, row: number): string {
  const v = table.getChild(column)?.get(row);
  return v == null ? '' : String(v);
}

/** Load the sites, the variable units and the year range. */
export async function loadMeta(): Promise<Meta> {
  const sitesTable = await query(
    `SELECT site_id::INTEGER AS site_id, code, name, country, utc_offset_min::INTEGER AS utc_offset_min
     FROM 'sites.parquet' ORDER BY site_id`,
  );
  const sites: Site[] = [];
  for (let i = 0; i < sitesTable.numRows; i++) {
    sites.push({
      siteId: Number(sitesTable.getChild('site_id')?.get(i)),
      code: stringAt(sitesTable, 'code', i),
      name: stringAt(sitesTable, 'name', i),
      country: stringAt(sitesTable, 'country', i),
      utcOffsetMin: Number(sitesTable.getChild('utc_offset_min')?.get(i)),
    });
  }

  const varTable = await query(`SELECT column_name, unit, description FROM 'variables.parquet'`);
  const variables = new Map<string, VariableInfo>();
  for (let i = 0; i < varTable.numRows; i++) {
    const name = stringAt(varTable, 'column_name', i);
    variables.set(name, { name, unit: stringAt(varTable, 'unit', i), description: stringAt(varTable, 'description', i) });
  }

  const range = await query(
    `SELECT year(min(tl))::INTEGER AS y0, year(max(tl))::INTEGER AS y1, count(*)::INTEGER AS n FROM obs`,
  );
  return {
    sites,
    variables,
    yearMin: Number(range.getChild('y0')?.get(0)),
    yearMax: Number(range.getChild('y1')?.get(0)),
    rowCount: Number(range.getChild('n')?.get(0)),
  };
}
