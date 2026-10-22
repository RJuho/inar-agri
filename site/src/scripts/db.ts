// DuckDB-WASM access for the website.
// The page fetches the Parquet files from public/data/, registers them in an
// in-browser DuckDB and reads them with SQL. The files are about 25 MB together,
// so we register full buffers. This works on all static hosts and does not
// need HTTP range requests.
//
// All DuckDB files come from our own origin. The page makes no requests to
// other hosts. scripts/sync-site-duckdb.ts copies them from the npm package
// to public/duckdb/:
// - <npm version>/duckdb-browser-{eh,mvp}.worker.js
// - <npm version>/duckdb-{eh,mvp}.wasm.gz: Cloudflare Workers static assets
//   accept files up to 25 MiB only, and the WASM files are 34 to 40 MB.
//   Thus the files are gzip-compressed. The page decompresses them.
// - extensions/<DuckDB version>/<platform>/parquet.duckdb_extension.wasm:
//   the official signed parquet extension. DuckDB-WASM loads it from
//   `custom_extension_repository`.
import * as duckdb from '@duckdb/duckdb-wasm';
import type { Table, Vector } from 'apache-arrow';

const PARQUET_FILES = [
  'observations.parquet',
  'sites.parquet',
  'variables.parquet',
  'fluxes.parquet',
  'events.parquet',
] as const;

/** Units of the columns that come from fluxes.parquet (scripts/calc.ts), not from variables.parquet. */
const CALC_VARIABLES: VariableInfo[] = [
  { name: 'gpp', unit: 'µmol CO2 m-2 s-1', description: 'Gross primary production, night-time partitioning (scripts/calc.ts). GPP >= 0 = uptake.' },
  { name: 'reco', unit: 'µmol CO2 m-2 s-1', description: 'Ecosystem respiration, night-time partitioning (scripts/calc.ts).' },
];

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

/** One field management event from events.parquet. Dates are site local calendar days. */
export interface SiteEvent {
  siteId: number;
  /** First day, yyyy-mm-dd. */
  date: string;
  /** Last day of a multi-day event, yyyy-mm-dd. null = one day. */
  dateEnd: string | null;
  /** harvest, cut, grazing, fertilisation, sowing, tillage, spraying or other. */
  type: string;
  detail: string;
  /** Crop, product or animal. null = not given. */
  crop: string | null;
  /** Amount of the source, in `amountUnit` (kg/ha, kg/ha fresh, m3/ha, L/ha, animals). */
  amount: number | null;
  amountUnit: string | null;
  /** Dry matter fraction of the amount (0 to 1). */
  dmFraction: number | null;
  /** Harvest yield, kg DW/ha. */
  dryMass: number | null;
  /** Carbon of the event, g C m-2. */
  cGm2: number | null;
  /** N input, kg N/ha. */
  nKgHa: number | null;
  /** Area of the field parcel, ha. */
  areaHa: number | null;
}

/** Facts about the data that the UI needs: sites, variable units, year range, events. */
export interface Meta {
  sites: Site[];
  variables: Map<string, VariableInfo>;
  /** First and last year in site local time. */
  yearMin: number;
  yearMax: number;
  /** Number of rows in observations.parquet. */
  rowCount: number;
  /** Management events, sorted by site and date. */
  events: SiteEvent[];
}

/** Make an absolute URL of a path below the Astro base path. */
function siteUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return new URL(`${base}${path}`, window.location.href).toString();
}

/**
 * Load progress: 0 to 1, or null when the size is not known.
 * The downloads give 0 to 0.9. The table build gives the last part.
 */
export type LoadProgress = (fraction: number | null) => void;

let progressCb: LoadProgress | null = null;
/** Bytes received and expected per download. Expected 0 = not known yet (no headers or no Content-Length). */
const downloads = new Map<string, { loaded: number; total: number }>();

/** Set the function that gets the load progress of the first data load. */
export function setLoadProgress(cb: LoadProgress | null): void {
  progressCb = cb;
}

function reportDownloads(): void {
  if (!progressCb) return;
  let loaded = 0;
  let total = 0;
  for (const d of downloads.values()) {
    if (d.total <= 0) return progressCb(null);
    loaded += d.loaded;
    total += d.total;
  }
  progressCb(total > 0 ? (0.9 * Math.min(loaded, total)) / total : null);
}

/** Read the body of a response and count the bytes for the progress bar. */
async function readBody(res: Response, key: string): Promise<Uint8Array<ArrayBuffer>> {
  // A Content-Length with a Content-Encoding counts compressed bytes, but the body gives decoded bytes.
  const total = res.headers.get('Content-Encoding') ? 0 : Number(res.headers.get('Content-Length')) || 0;
  const entry = { loaded: 0, total };
  downloads.set(key, entry);
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    entry.loaded = bytes.length;
    reportDownloads();
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    entry.loaded += value.length;
    reportDownloads();
  }
  const out = new Uint8Array(entry.loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Progress key of the DuckDB WASM download. */
const WASM_KEY = 'duckdb.wasm';

async function fetchBuffer(file: string): Promise<Uint8Array> {
  // The build time in the URL: after a deploy, the browser does not use the cached files of the old build.
  const res = await fetch(siteUrl(`data/${file}?v=${__BUILD_TIME__}`));
  if (!res.ok) {
    throw new Error(`Cannot load ${file}: HTTP ${res.status}. Run "npm run build:db" and then the site build.`);
  }
  return readBody(res, file);
}

/** The bundles in public/duckdb/. The package version in the path makes a long cache safe. */
function localBundles(): duckdb.DuckDBBundles {
  const dir = `duckdb/${duckdb.PACKAGE_VERSION}`;
  return {
    mvp: { mainModule: siteUrl(`${dir}/duckdb-mvp.wasm.gz`), mainWorker: siteUrl(`${dir}/duckdb-browser-mvp.worker.js`) },
    eh: { mainModule: siteUrl(`${dir}/duckdb-eh.wasm.gz`), mainWorker: siteUrl(`${dir}/duckdb-browser-eh.worker.js`) },
  };
}

/**
 * Fetch the gzip-compressed WASM file and return a blob URL of the WASM module.
 * If the host already decoded the file (no gzip magic bytes 1f 8b), we use the bytes as they are.
 */
async function wasmBlobUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cannot load ${url}: HTTP ${res.status}. Run "npm run site:sync".`);
  const bytes = await readBody(res, WASM_KEY);
  let wasm: Blob = new Blob([bytes]);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    wasm = await new Response(wasm.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
  }
  return URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
}

/**
 * Start DuckDB-WASM with the bundles from our own origin.
 * selectBundle picks the EH build when the browser supports WASM exceptions.
 */
async function startDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(localBundles());
  if (!bundle.mainWorker) throw new Error('No DuckDB worker bundle found.');
  const wasmUrl = await wasmBlobUrl(bundle.mainModule);
  try {
    const worker = new Worker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(wasmUrl, bundle.pthreadWorker);
    const conn = await db.connect();
    try {
      // Load the extensions from our own origin, not from extensions.duckdb.org.
      // DuckDB adds /<DuckDB version>/<platform>/<name>.duckdb_extension.wasm to this URL.
      const repo = siteUrl('duckdb/extensions').replaceAll("'", "''");
      await conn.query(`SET custom_extension_repository = '${repo}'`);
      await conn.query(`LOAD parquet`);
    } finally {
      await conn.close();
    }
    return db;
  } finally {
    URL.revokeObjectURL(wasmUrl);
  }
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

/**
 * Start DuckDB one time and load the data.
 * Table `obs` has all columns of observations.parquet, `gpp` and `reco` from
 * fluxes.parquet (Maktau `nee_f` too), plus `tl`:
 * the start of the period in site local time (ts_start + utc_offset_min).
 * The database stays open for later queries.
 */
function getDB(): Promise<duckdb.AsyncDuckDB> {
  dbPromise ??= (async () => {
    // Register all downloads first. Else the small files end before the large files start, and the bar jumps.
    for (const key of [WASM_KEY, ...PARQUET_FILES]) downloads.set(key, { loaded: 0, total: 0 });
    const [db, buffers] = await Promise.all([startDuckDB(), Promise.all(PARQUET_FILES.map(fetchBuffer))]);
    await Promise.all(PARQUET_FILES.map((f, i) => db.registerFileBuffer(f, buffers[i])));
    const conn = await db.connect();
    try {
      await conn.query(
        `CREATE TABLE obs AS
         SELECT o.* REPLACE (coalesce(o.nee_f, f.nee_f_calc::DOUBLE) AS nee_f),
                f.gpp::DOUBLE AS gpp, f.reco::DOUBLE AS reco,
                o.ts_start + to_minutes(s.utc_offset_min::INT) AS tl
         FROM 'observations.parquet' o JOIN 'sites.parquet' s USING (site_id)
         LEFT JOIN 'fluxes.parquet' f USING (site_id, ts_start)`,
      );
    } finally {
      await conn.close();
    }
    progressCb?.(1);
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

function numberOrNull(table: Table, column: string, row: number): number | null {
  const v = table.getChild(column)?.get(row);
  return v == null ? null : Number(v);
}

function stringOrNull(table: Table, column: string, row: number): string | null {
  const v = table.getChild(column)?.get(row);
  return v == null ? null : String(v);
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
  for (const v of CALC_VARIABLES) variables.set(v.name, v);
  const neeF = variables.get('nee_f');
  if (neeF) variables.set('nee_f', { ...neeF, description: `${neeF.description} Maktau: MDS gap filling of scripts/calc.ts.` });

  const evTable = await query(
    `SELECT site_id::INTEGER AS site_id, strftime(date, '%Y-%m-%d') AS d, strftime(date_end, '%Y-%m-%d') AS d_end, type, detail,
            crop, amount, amount_unit, dm_fraction, dry_mass_kg_ha, c_g_m2, n_kg_ha, area_ha
     FROM 'events.parquet' ORDER BY site_id, date, type`,
  );
  const events: SiteEvent[] = [];
  for (let i = 0; i < evTable.numRows; i++) {
    const dEnd = stringAt(evTable, 'd_end', i);
    events.push({
      siteId: Number(evTable.getChild('site_id')?.get(i)),
      date: stringAt(evTable, 'd', i),
      dateEnd: dEnd === '' ? null : dEnd,
      type: stringAt(evTable, 'type', i),
      detail: stringAt(evTable, 'detail', i),
      crop: stringOrNull(evTable, 'crop', i),
      amount: numberOrNull(evTable, 'amount', i),
      amountUnit: stringOrNull(evTable, 'amount_unit', i),
      dmFraction: numberOrNull(evTable, 'dm_fraction', i),
      dryMass: numberOrNull(evTable, 'dry_mass_kg_ha', i),
      cGm2: numberOrNull(evTable, 'c_g_m2', i),
      nKgHa: numberOrNull(evTable, 'n_kg_ha', i),
      areaHa: numberOrNull(evTable, 'area_ha', i),
    });
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
    events,
  };
}

let copySeq = 0;

/**
 * Run `COPY (<selectSql>) TO '<file>' (<options>)` in the virtual file system of
 * DuckDB-WASM and return the bytes of the file. The file is dropped after the read.
 * The work stays in the browser: no file goes to a server.
 */
export async function copyToBuffer(selectSql: string, options: string, ext: string): Promise<Uint8Array<ArrayBuffer>> {
  const db = await getDB();
  const file = `export-${++copySeq}.${ext}`;
  const conn = await db.connect();
  try {
    await conn.query(`COPY (${selectSql}) TO '${file}' (${options})`);
    return (await db.copyFileToBuffer(file)) as Uint8Array<ArrayBuffer>;
  } finally {
    await conn.close();
    await db.dropFile(file).catch(() => null);
  }
}
