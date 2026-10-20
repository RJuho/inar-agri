// DuckDB-WASM access for the website.
// The page fetches the Parquet files from public/data/, registers them in an
// in-browser DuckDB and reads them with SQL. The files are small (about 8 MB),
// so we register full buffers. This works on all static hosts and does not
// need HTTP range requests.
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import type { Table, Vector } from 'apache-arrow';

/** Variables that the first page shows, in panel order. */
export const PLOT_VARIABLES = ['nee', 'nee_f', 'ta', 'tsoil', 'swc'] as const;
export type PlotVariable = (typeof PLOT_VARIABLES)[number];

/** Length of one averaging period in milliseconds (30 min). */
const STEP_MS = 30 * 60 * 1000;

const PARQUET_FILES = ['observations.parquet', 'sites.parquet', 'variables.parquet'] as const;

export interface Site {
  siteId: number;
  code: string;
  name: string;
  country: string;
  utcOffsetMin: number;
}

export interface Variable {
  name: string;
  unit: string;
  description: string;
}

/**
 * Column data for one site. All arrays have the same length.
 * `t` is UTC epoch milliseconds. NaN marks a missing value or a gap.
 */
export interface SiteSeries {
  siteId: number;
  t: Float64Array;
  values: Record<PlotVariable, Float64Array>;
}

export interface Dataset {
  sites: Site[];
  variables: Map<string, Variable>;
  series: SiteSeries[];
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

/** Start DuckDB-WASM. selectBundle picks the EH build when the browser supports WASM exceptions. */
async function startDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  if (!bundle.mainWorker) throw new Error('No DuckDB worker bundle found.');
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}

/** Copy an Arrow number column into a Float64Array. NULL becomes NaN. */
function toFloat64(vec: Vector | null, length: number): Float64Array {
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

/**
 * Split the sorted rows into one block per site.
 * Where the time step between two rows is longer than 30 min, add one NaN row.
 * ECharts then draws a gap there and does not join the two ends.
 */
function splitBySite(siteIds: Float64Array, t: Float64Array, cols: Record<PlotVariable, Float64Array>): SiteSeries[] {
  const result: SiteSeries[] = [];
  const n = siteIds.length;
  let start = 0;
  while (start < n) {
    const id = siteIds[start];
    let end = start;
    let gaps = 0;
    while (end < n && siteIds[end] === id) {
      if (end > start && t[end] - t[end - 1] > STEP_MS) gaps++;
      end++;
    }
    const len = end - start + gaps;
    const st = new Float64Array(len);
    const sv = Object.fromEntries(PLOT_VARIABLES.map((k) => [k, new Float64Array(len)])) as Record<PlotVariable, Float64Array>;
    let k = 0;
    for (let i = start; i < end; i++) {
      if (i > start && t[i] - t[i - 1] > STEP_MS) {
        st[k] = t[i - 1] + STEP_MS;
        for (const v of PLOT_VARIABLES) sv[v][k] = Number.NaN;
        k++;
      }
      st[k] = t[i];
      for (const v of PLOT_VARIABLES) sv[v][k] = cols[v][i];
      k++;
    }
    result.push({ siteId: id, t: st, values: sv });
    start = end;
  }
  return result;
}

/** Load all data of the harmonised database for the first page. */
export async function loadDataset(): Promise<Dataset> {
  const [db, buffers] = await Promise.all([startDuckDB(), Promise.all(PARQUET_FILES.map(fetchBuffer))]);
  await Promise.all(PARQUET_FILES.map((f, i) => db.registerFileBuffer(f, buffers[i])));
  const conn = await db.connect();
  try {
    const sitesTable = await conn.query(
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

    const varTable = await conn.query(`SELECT column_name, unit, description FROM 'variables.parquet'`);
    const variables = new Map<string, Variable>();
    for (let i = 0; i < varTable.numRows; i++) {
      const name = stringAt(varTable, 'column_name', i);
      variables.set(name, { name, unit: stringAt(varTable, 'unit', i), description: stringAt(varTable, 'description', i) });
    }

    // Cast to DOUBLE: Arrow gives BigInt for BIGINT, and ECharts needs numbers.
    const obs = await conn.query(
      `SELECT site_id::DOUBLE AS site_id, epoch_ms(ts_start)::DOUBLE AS t, ${PLOT_VARIABLES.join(', ')}
       FROM 'observations.parquet' ORDER BY site_id, ts_start`,
    );
    const n = obs.numRows;
    const cols = Object.fromEntries(PLOT_VARIABLES.map((v) => [v, toFloat64(obs.getChild(v), n)])) as Record<PlotVariable, Float64Array>;
    const series = splitBySite(toFloat64(obs.getChild('site_id'), n), toFloat64(obs.getChild('t'), n), cols);
    return { sites, variables, series, rowCount: n };
  } finally {
    await conn.close();
    await db.terminate();
  }
}
