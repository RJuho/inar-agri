// Data export: the data that the active view shows, as Parquet, CSV or Excel (XLSX).
// DuckDB-WASM writes the files in its virtual file system (COPY TO), and the page
// saves them through a Blob link. All work is in the browser; there are no server calls.
//
// The rows are the same as in the time series diagram: same sites, variables, years
// (site local time) and step. Step "day", "week" and "month" give the mean per local
// day, local ISO week (start Monday 00:00) or local month, as in the diagram.
// Exceptions: precipitation (precip) gives the sum, wind direction (wd) the circular mean.
//
// Columns, in this order:
//   site_code     text   Site code from sites.parquet, for example "qvidja".
//   site_name     text   Site name, for example "Qvidja".
//   ts_start_utc  time   Start of the period in UTC. CSV: ISO 8601 with "Z".
//                        XLSX: Excel date and time (no time zone in the cell).
//   ts_local      time   Start of the period in site local time (UTC+2 in Finland,
//                        UTC+3 in Maktau). CSV: ISO 8601 without offset. XLSX: as above.
//   <variables>   number The selected variables, in the order of the form.
//   nee_qc        number Only for step "raw" when "nee" is selected: 0 = measured,
//                        1 = gap-filled.
// Units are in variables.parquet. The Parquet file also has them as key/value
// metadata (keys "unit:<column>"). The CSV file has a header row only, no units row.
// The XLSX file has one sheet "data" with a header row, no units row; an empty cell is
// NULL. DuckDB's excel extension writes it (loaded on the first XLSX export). One sheet
// holds max. 1 048 575 data rows; a larger export stops with an error.
import { copyToBuffer, loadExtension, query, type Meta } from './db';
import { CIRCULAR_VARS, SUM_VARS, col, stepExpr, whereClause } from './diagrams/sql';
import { AGGREGATION_LABELS, VARIABLE_LABELS, type Aggregation, type Variable, type View, type ViewParams } from './state';
import { yearsText } from './diagrams/common';
import { slug, sourceFiles } from './export';
import { zipStore } from './zip';

export type DataScope = 'one' | 'sites';
export type DataFormat = 'parquet' | 'csv' | 'xlsx';

export interface DataFile {
  fileName: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** Number of data rows (all files together). */
  rows: number;
  /** Number of files: 1, or the number of sites in the ZIP file. */
  files: number;
}

/** Name of the format in the status line. */
export const FORMAT_LABELS: Record<DataFormat, string> = { parquet: 'Parquet', csv: 'CSV', xlsx: 'Excel (XLSX)' };

const MIME: Record<DataFormat | 'zip', string> = {
  parquet: 'application/vnd.apache.parquet',
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

/** Description text of the period of each step. */
/** Max. number of data rows in one XLSX sheet (Excel: 1 048 576 rows with the header row). */
export const XLSX_MAX_ROWS = 1_048_575;

const PERIOD_TEXT: Record<Exclude<Aggregation, 'raw'>, string> = {
  day: 'local day',
  week: 'local ISO week (start Monday 00:00 local time)',
  month: 'local month',
};

/** Description text of the step value of column `c`: "Mean per local day.", "Sum per local day." or a circular mean. */
export function stepText(c: string, a: Exclude<Aggregation, 'raw'>): string {
  const v = c as Variable;
  const stat = SUM_VARS.has(v) ? 'Sum' : CIRCULAR_VARS.has(v) ? 'Circular mean' : 'Mean';
  return `${stat} per ${PERIOD_TEXT[a]}.`;
}

/** SQL string literal. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The columns with values. nee_qc is added for raw data when nee is selected. */
export function valueColumns(params: ViewParams): string[] {
  const vars: string[] = params.variables.map(col);
  if (params.aggregation === 'raw' && vars.includes('nee')) vars.push('nee_qc');
  return vars;
}

/** SELECT for the rows of the view, optionally for one site only. Returns null when no site or variable is selected. */
export function exportSql(params: ViewParams, siteId?: number): string | null {
  const sites = siteId === undefined ? params.sites : params.sites.filter((s) => s === siteId);
  const where = whereClause({ ...params, sites });
  if (where === null || params.variables.length === 0) return null;
  const vars = valueColumns(params);
  const siteCols = `s.code AS site_code, s.name AS site_name`;
  const sitesTable = `(SELECT site_id, code, name, utc_offset_min FROM 'sites.parquet')`;
  if (params.aggregation === 'raw') {
    return `SELECT ${siteCols}, o.ts_start AS ts_start_utc, o.tl AS ts_local, ${vars.map((v) => `o.${v}`).join(', ')}
      FROM obs o JOIN ${sitesTable} s USING (site_id)
      WHERE ${where.replace(/\b(site_id|tl)\b/g, 'o.$1')} ORDER BY o.site_id, o.tl`;
  }
  // Step 'week' = ISO week, start Monday 00:00 site local time.
  const unit = params.aggregation;
  return `SELECT ${siteCols}, a.t - to_minutes(s.utc_offset_min::INT) AS ts_start_utc, a.t AS ts_local, ${vars.map((v) => `a.${v}`).join(', ')}
    FROM (SELECT site_id, date_trunc('${unit}', tl)::TIMESTAMP AS t, ${params.variables.map((v) => `${stepExpr(v)} AS ${v}`).join(', ')}
          FROM obs WHERE ${where} GROUP BY ALL) a
    JOIN ${sitesTable} s USING (site_id)
    ORDER BY a.site_id, a.t`;
}

/** CSV form of the rows: ISO 8601 text for the two time columns. */
function csvSql(select: string): string {
  return `SELECT * REPLACE (
      strftime(ts_start_utc, '%Y-%m-%dT%H:%M:%SZ') AS ts_start_utc,
      strftime(ts_local, '%Y-%m-%dT%H:%M:%S') AS ts_local)
    FROM (${select})`;
}

/** Key/value metadata for the Parquet file: units, description and the view parameters. */
function kvMetadata(view: View, meta: Meta): string {
  const p = view.params;
  const unit = (c: string) => meta.variables.get(c)?.unit ?? '';
  const kv: Record<string, string> = {
    source: `INAR agri harmonised database (${sourceFiles(p)})`,
    view: view.name,
    params: JSON.stringify(p),
    step: AGGREGATION_LABELS[p.aggregation],
    years: yearsText(p),
    'unit:ts_start_utc': 'UTC',
    'unit:ts_local': 'site local time (UTC+2 Finland, UTC+3 Maktau)',
  };
  for (const c of valueColumns(p)) {
    kv[`unit:${c}`] = unit(c);
    const label = (VARIABLE_LABELS as Record<string, string>)[c];
    kv[`description:${c}`] = (label ? `${label}. ` : '') + (meta.variables.get(c)?.description ?? '') + (p.aggregation === 'raw' ? '' : ` ${stepText(c, p.aggregation)}`);
  }
  return `{${Object.entries(kv)
    .map(([k, v]) => `${lit(k)}: ${lit(v)}`)
    .join(', ')}}`;
}

function copyOptions(format: DataFormat, view: View, meta: Meta): string {
  if (format === 'csv') return `FORMAT csv, HEADER true, DELIMITER ','`;
  if (format === 'xlsx') return `FORMAT xlsx, HEADER true, SHEET 'data'`;
  return `FORMAT parquet, COMPRESSION zstd, KV_METADATA ${kvMetadata(view, meta)}`;
}

/**
 * File name without extension: inar-agri_<view>_<from>-<to>_<step>. A month limit adds
 * the month to its year, for example 2022-03-2023-10.
 */
export function baseName(view: View, meta: Meta): string {
  const p = view.params;
  const month = (m: number | null) => (m === null ? '' : `-${String(m).padStart(2, '0')}`);
  const from = `${p.yearFrom ?? meta.yearMin}${month(p.monthFrom)}`;
  const to = `${p.yearTo ?? meta.yearMax}${month(p.monthTo)}`;
  return `inar-agri_${slug(view.name)}_${from}-${to}_${p.aggregation}`;
}

async function rowCount(select: string): Promise<number> {
  const t = await query(`SELECT count(*)::INTEGER AS n FROM (${select})`);
  return Number(t.getChild('n')?.get(0) ?? 0);
}

/** Make the export file of the view: one file with all sites, or one ZIP with one file per site. */
export async function exportData(view: View, meta: Meta, scope: DataScope, format: DataFormat): Promise<DataFile> {
  const p = view.params;
  const base = baseName(view, meta);
  const options = copyOptions(format, view, meta);
  if (format === 'xlsx') await loadExtension('excel');
  const toFile = (select: string) => copyToBuffer(format === 'csv' ? csvSql(select) : select, options, format);
  /** Count the rows first. An XLSX sheet has a row limit. */
  const countAndCopy = async (select: string, what: string): Promise<[Uint8Array<ArrayBuffer>, number]> => {
    const n = await rowCount(select);
    if (format === 'xlsx' && n > XLSX_MAX_ROWS) {
      throw new Error(`${what} has ${n.toLocaleString('en')} rows, but one Excel sheet holds max. ${XLSX_MAX_ROWS.toLocaleString('en')}. Use a longer step, a shorter period or one file per site.`);
    }
    return [await toFile(select), n];
  };

  if (scope === 'one') {
    const select = exportSql(p);
    if (select === null) throw new Error('Select one or more sites and variables.');
    const [bytes, rows] = await countAndCopy(select, 'The file');
    return { fileName: `${base}.${format}`, mime: MIME[format], bytes, rows, files: 1 };
  }

  const sites = meta.sites.filter((s) => p.sites.includes(s.siteId));
  if (sites.length === 0 || p.variables.length === 0) throw new Error('Select one or more sites and variables.');
  const entries = [];
  let rows = 0;
  for (const s of sites) {
    const select = exportSql(p, s.siteId) as string;
    const [data, n] = await countAndCopy(select, `The file of ${s.name}`);
    entries.push({ name: `${base}_${s.code}.${format}`, data });
    rows += n;
  }
  return { fileName: `${base}_${format}.zip`, mime: MIME.zip, bytes: zipStore(entries), rows, files: entries.length };
}

/** File size as text, for example "12.3 MB" (SI units). */
export function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}
