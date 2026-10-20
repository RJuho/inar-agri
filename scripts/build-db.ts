// Build the harmonised core database (Parquet) from the raw site files.
//
// Run: node scripts/build-db.ts
// Design: docs/harmonised-database.md
//
// DuckDB does all reading, cleaning, merging and writing in SQL.
// Valibot validates the registry, the file headers, every output row
// and the build report.

import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import * as v from 'valibot';
import { CORE_COLUMNS, REGISTRY, VARIABLES, type CoreColumn } from './lib/registry.ts';
import {
  OBSERVATION_COLUMNS,
  ObservationRowSchema,
  RegistrySchema,
  ReportSchema,
  headerSchema,
  isRangeIssue,
  type Report,
  type Site,
  type Source,
} from './lib/schemas.ts';

const OUT_DIR = 'db';
const OBS_FILE = `${OUT_DIR}/observations.parquet`;
const STEP = 'INTERVAL 30 MINUTE';

type ColumnMap = NonNullable<Source['columns'][CoreColumn]>;
type SourceReport = Report['sources'][number];

// ---------- small helpers ----------

function lit(x: string | number | boolean | null | undefined): string {
  if (x === null || x === undefined) return 'NULL';
  if (typeof x === 'number') return Number.isFinite(x) ? String(x) : 'NULL';
  if (typeof x === 'boolean') return x ? 'TRUE' : 'FALSE';
  return `'${x.replace(/'/g, "''")}'`;
}
const ident = (x: string): string => `"${x.replace(/"/g, '""')}"`;

function plain(value: DuckDBValue): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value !== null && typeof value === 'object') return String(value);
  return value;
}

async function rows(conn: DuckDBConnection, sql: string): Promise<Record<string, unknown>[]> {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects().map((o) => Object.fromEntries(Object.entries(o).map(([k, val]) => [k, plain(val)])));
}

async function one(conn: DuckDBConnection, sql: string): Promise<Record<string, unknown>> {
  const r = await rows(conn, sql);
  if (r.length !== 1) throw new Error(`expected one row, got ${r.length}: ${sql}`);
  return r[0]!;
}

const num = (x: unknown): number => (typeof x === 'number' ? x : Number(x));
const numOrNull = (x: unknown): number | null => (x === null || x === undefined ? null : num(x));
const str = (x: unknown): string => String(x);

function mappings(src: Source): [CoreColumn, ColumnMap][] {
  return CORE_COLUMNS.flatMap((c) => {
    const m = src.columns[c];
    return m ? [[c, m] as [CoreColumn, ColumnMap]] : [];
  });
}

/** Count the lines of a file. A last line without a newline counts as a line. */
async function countLines(path: string): Promise<number> {
  let lines = 0;
  let last = 10;
  for await (const chunk of createReadStream(path)) {
    const buf = chunk as Buffer;
    let i = buf.indexOf(10);
    while (i !== -1) {
      lines++;
      i = buf.indexOf(10, i + 1);
    }
    if (buf.length > 0) last = buf[buf.length - 1]!;
  }
  return lines + (last === 10 ? 0 : 1);
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`\nERROR: ${msg}\n`);
  process.exit(1);
}

// ---------- step 1: read one source file into stage_<id> ----------

async function ingestSource(conn: DuckDBConnection, src: Source): Promise<SourceReport> {
  const physicalLines = await countLines(src.path);
  const maps = mappings(src);

  // Header check. read_csv reads the names from line 1 and the unit row (if any) is skipped later.
  const head = await conn.runAndReadAll(
    `SELECT * FROM read_csv(${lit(src.path)}, delim=${lit(src.delim)}, header=true, all_varchar=true) LIMIT 0`,
  );
  const names = head.columnNames();
  const needed = [...new Set([src.timestampColumn, ...maps.flatMap(([, m]) => m.sourceColumns)])];
  const headerCheck = v.safeParse(headerSchema(needed), names);
  if (!headerCheck.success) fail(`${src.id} (${src.path}): ${headerCheck.issues.map((i) => i.message).join('; ')}`);

  const clean = (c: string): string =>
    src.decimalComma ? `nullif(trim(replace(${ident(c)}, ',', '.')), '')` : `nullif(trim(${ident(c)}), '')`;
  const dataCols = needed.filter((c) => c !== src.timestampColumn);
  const formats = `[${src.timestampFormats.map(lit).join(', ')}]`;
  const tsParsed = `try_strptime(${clean(src.timestampColumn)}, ${formats})`;
  const toStart = src.timestampIsEnd ? (src.aggregate ? ' - INTERVAL 1 MICROSECOND' : ` - INTERVAL ${src.stepMin} MINUTE`) : '';
  const tsLocal = src.aggregate
    ? `time_bucket(${STEP}, ts_parsed${toStart})`
    : `CASE WHEN ts_parsed${toStart} = time_bucket(${STEP}, ts_parsed${toStart}) THEN ts_parsed${toStart} END`;

  await conn.run(`
    CREATE TABLE ${ident(`raw_${src.id}`)} AS
    SELECT row_number() OVER () AS source_row, ts_parsed, ${tsLocal} AS ts_local, * EXCLUDE (ts_parsed)
    FROM (
      SELECT ${tsParsed} AS ts_parsed, ${dataCols.map((c) => `${clean(c)} AS ${ident(c)}`).join(', ')}
      FROM read_csv(${lit(src.path)}, delim=${lit(src.delim)}, header=false, skip=${src.headerLines},
                    names=[${names.map(lit).join(', ')}], all_varchar=true, store_rejects=true)
    )`);

  let linesSkippedByParser = 0;
  try {
    const r = await one(
      conn,
      `SELECT count(DISTINCT e.line) AS n FROM reject_errors e JOIN reject_scans s USING (scan_id, file_id)
       WHERE ends_with(s.file_path, ${lit(src.path)})`,
    );
    linesSkippedByParser = num(r.n);
  } catch {
    linesSkippedByParser = 0;
  }

  // Column expression with the zero rule applied.
  const colExpr = (m: ColumnMap): string => (m.zeroIsNull ? `nullif(${m.expr}, 0)` : m.expr);

  const statSql = maps.flatMap(([c, m]) => {
    const first = m.sourceColumns[0]!;
    return [
      `count(${colExpr(m)}) AS ${ident(`nv_${c}`)}`,
      `count(*) FILTER (WHERE ${ident(first)} IS NOT NULL AND num(${ident(first)}) IS NULL) AS ${ident(`ns_${c}`)}`,
      m.zeroIsNull ? `count(*) FILTER (WHERE ${m.expr} = 0) AS ${ident(`nz_${c}`)}` : `0 AS ${ident(`nz_${c}`)}`,
    ];
  });
  const s = await one(
    conn,
    `SELECT count(*) AS rows_read, count(ts_local) AS rows_ok,
            count(ts_parsed) FILTER (WHERE ts_local IS NOT NULL) - count(DISTINCT ts_parsed) FILTER (WHERE ts_local IS NOT NULL) AS dup_stamps,
            ${statSql.join(', ')}
     FROM ${ident(`raw_${src.id}`)}`,
  );

  // Stage: one row per period with the six core columns. Missing columns are NULL.
  const allCols = CORE_COLUMNS.map((c) => {
    const m = src.columns[c];
    return m ? `${colExpr(m)} AS ${ident(c)}` : `NULL::DOUBLE AS ${ident(c)}`;
  });
  let stageSql: string;
  if (src.aggregate) {
    const minCount = src.aggregate.minCount;
    stageSql = `
      WITH r AS (SELECT source_row, ts_parsed, ts_local, ${allCols.join(', ')} FROM ${ident(`raw_${src.id}`)} WHERE ts_local IS NOT NULL),
      d AS (SELECT ts_parsed, ts_local, min(source_row) AS source_row,
                   ${CORE_COLUMNS.map((c) => `any_value(${ident(c)} ORDER BY source_row) AS ${ident(c)}`).join(', ')}
            FROM r GROUP BY ts_parsed, ts_local)
      SELECT ts_local, min(source_row) AS source_row,
             ${CORE_COLUMNS.map((c) => `CASE WHEN count(${ident(c)}) >= ${minCount} THEN round(avg(${ident(c)}), 10) END AS ${ident(c)}`).join(', ')}
      FROM d GROUP BY ts_local`;
  } else {
    stageSql = `SELECT ts_local, source_row, ${allCols.join(', ')} FROM ${ident(`raw_${src.id}`)} WHERE ts_local IS NOT NULL`;
  }
  await conn.run(`CREATE TABLE ${ident(`stage_${src.id}`)} AS ${stageSql}`);
  const staged = await one(conn, `SELECT count(*) AS n FROM ${ident(`stage_${src.id}`)}`);
  await conn.run(`DROP TABLE ${ident(`raw_${src.id}`)}`);

  const columns: SourceReport['columns'] = {};
  for (const [c, m] of maps) {
    columns[c] = {
      n_valid: num(s[`nv_${c}`]),
      n_sentinel: num(s[`ns_${c}`]),
      n_zero_nulled: num(s[`nz_${c}`]),
      factor: m.factor ?? null,
    };
  }
  const report: SourceReport = {
    id: src.id,
    site: src.site,
    path: src.path,
    physicalLines,
    headerLines: src.headerLines,
    rowsRead: num(s.rows_read),
    rowsRejected: num(s.rows_read) - num(s.rows_ok),
    linesSkippedByParser,
    duplicateStamps: num(s.dup_stamps),
    rowsAfterAggregation: src.aggregate ? num(staged.n) : null,
    columns,
  };
  log(`  ${src.id}: ${report.physicalLines} lines, ${report.rowsRead} rows read, ${report.rowsRejected} rejected, ${report.duplicateStamps} duplicate stamps`);
  return report;
}

// ---------- step 2: merge the sources of one site ----------

async function mergeSite(conn: DuckDBConnection, site: Site, sources: Source[]): Promise<Record<CoreColumn, number>> {
  const union = sources
    .map((s) => `SELECT ${s.rank} AS rank, source_row, ts_local, ${CORE_COLUMNS.map(ident).join(', ')} FROM ${ident(`stage_${s.id}`)}`)
    .join('\n UNION ALL ');
  await conn.run(`
    CREATE TABLE ${ident(`merged_${site.code}`)} AS
    SELECT ${site.siteId} AS site_id, ts_local,
           ${CORE_COLUMNS.map((c) => `any_value(${ident(c)} ORDER BY rank, source_row) AS ${ident(c)}`).join(', ')},
           ${CORE_COLUMNS.map((c) => `count(DISTINCT ${ident(c)}) > 1 AS ${ident(`conflict_${c}`)}`).join(', ')}
    FROM (${union})
    GROUP BY ts_local`);
  const r = await one(
    conn,
    `SELECT ${CORE_COLUMNS.map((c) => `count(*) FILTER (WHERE ${ident(`conflict_${c}`)}) AS ${ident(c)}`).join(', ')} FROM ${ident(`merged_${site.code}`)}`,
  );
  return Object.fromEntries(CORE_COLUMNS.map((c) => [c, num(r[c])])) as Record<CoreColumn, number>;
}

// ---------- step 3: Valibot pass over every output row ----------

type Validation = { rowsChecked: number; errors: number; warnings: Map<number, Map<string, number>>; firstErrors: string[] };

async function validateRows(conn: DuckDBConnection): Promise<Validation> {
  const out: Validation = { rowsChecked: 0, errors: 0, warnings: new Map(), firstErrors: [] };
  const result = await conn.stream(`SELECT ${OBSERVATION_COLUMNS.map(ident).join(', ')} FROM obs ORDER BY site_id, ts_start`);
  for await (const chunk of result) {
    for (const row of chunk.getRows()) {
      out.rowsChecked++;
      const parsed = v.safeParse(ObservationRowSchema, row, { abortPipeEarly: true });
      if (parsed.success) continue;
      const siteId = typeof row[0] === 'number' ? row[0] : -1;
      for (const issue of parsed.issues) {
        const index = typeof issue.path?.[0]?.key === 'number' ? issue.path[0].key : -1;
        const column = OBSERVATION_COLUMNS[index] ?? 'row';
        if (isRangeIssue(issue)) {
          const bySite = out.warnings.get(siteId) ?? new Map<string, number>();
          bySite.set(column, (bySite.get(column) ?? 0) + 1);
          out.warnings.set(siteId, bySite);
        } else {
          out.errors++;
          if (out.firstErrors.length < 10) out.firstErrors.push(`site ${siteId}, ${String(row[1])}, ${column}: ${issue.message}`);
        }
      }
    }
  }
  return out;
}

// ---------- step 4: statistics ----------

type ColStat = { n_valid: number; min: number | null; max: number | null; mean: number | null };

function statSelect(): string {
  return CORE_COLUMNS.map(
    (c) => `count(${ident(c)}) AS ${ident(`nv_${c}`)}, min(${ident(c)}) AS ${ident(`min_${c}`)}, max(${ident(c)}) AS ${ident(`max_${c}`)}, avg(${ident(c)}) AS ${ident(`mean_${c}`)}`,
  ).join(', ');
}

function colStats(r: Record<string, unknown>): Record<string, ColStat> {
  const out: Record<string, ColStat> = {};
  for (const c of CORE_COLUMNS) {
    out[c] = { n_valid: num(r[`nv_${c}`]), min: numOrNull(r[`min_${c}`]), max: numOrNull(r[`max_${c}`]), mean: numOrNull(r[`mean_${c}`]) };
  }
  return out;
}

// ---------- report rendering ----------

function fmt(x: number | null | undefined): string {
  if (x === null || x === undefined) return '';
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(5)));
}

function table(headers: string[], body: (string | number | null)[][]): string {
  const line = (cells: (string | number | null)[]) => `| ${cells.map((c) => (c === null ? '' : String(c))).join(' | ')} |`;
  return [line(headers), `|${headers.map(() => '---').join('|')}|`, ...body.map(line)].join('\n');
}

function renderMarkdown(report: Report): string {
  const parts: string[] = [];
  parts.push('# Build report: harmonised core database');
  parts.push('');
  parts.push(`Built ${report.builtAt} with DuckDB ${report.duckdb} and Node ${report.node}. Generator: scripts/build-db.ts. Design: docs/harmonised-database.md.`);
  parts.push('');
  parts.push('## Output files');
  parts.push('');
  parts.push(table(['File', 'Rows', 'Bytes'], report.outputs.map((o) => [o.file, o.rows, o.bytes])));
  parts.push('');
  parts.push('## Sites');
  parts.push('');
  parts.push(
    table(
      ['Site', 'Rows', 'Grid rows inserted', 'First period (UTC)', 'Last period (UTC)'],
      report.sites.map((s) => [`${s.name} (${s.siteId})`, s.rows, s.gridRowsInserted, s.tsFirstUtc, s.tsLastUtc]),
    ),
  );
  for (const s of report.sites) {
    parts.push('');
    parts.push(`### ${s.name}`);
    parts.push('');
    parts.push('Valid values, min, max, mean, merge conflicts and physical range warnings per column.');
    parts.push('');
    parts.push(
      table(
        ['Column', 'Valid', 'Valid %', 'Min', 'Max', 'Mean', 'Conflicts', 'Range warnings'],
        CORE_COLUMNS.map((c) => {
          const cs = s.columns[c]!;
          return [c, cs.n_valid, fmt(s.rows ? Number(((100 * cs.n_valid) / s.rows).toFixed(1)) : 0), fmt(cs.min), fmt(cs.max), fmt(cs.mean), cs.conflicts, cs.rangeWarnings];
        }),
      ),
    );
    parts.push('');
    parts.push('Per year: valid count, min and max.');
    parts.push('');
    parts.push(
      table(
        ['Year', 'Rows', ...CORE_COLUMNS],
        s.years.map((y) => [
          y.year,
          y.rows,
          ...CORE_COLUMNS.map((c) => {
            const cs = y.columns[c]!;
            return cs.n_valid === 0 ? '0' : `${cs.n_valid} · ${fmt(cs.min)} … ${fmt(cs.max)}`;
          }),
        ]),
      ),
    );
  }
  parts.push('');
  parts.push('## Source files');
  parts.push('');
  parts.push('Physical lines = header lines + rows read + lines skipped by the parser. Rejected = rows without a valid 30-minute stamp.');
  parts.push('');
  parts.push(
    table(
      ['Source', 'File', 'Lines', 'Header', 'Rows read', 'Skipped', 'Rejected', 'Duplicate stamps', 'Rows after aggregation'],
      report.sources.map((s) => [s.id, s.path, s.physicalLines, s.headerLines, s.rowsRead, s.linesSkippedByParser, s.rowsRejected, s.duplicateStamps, s.rowsAfterAggregation]),
    ),
  );
  parts.push('');
  parts.push('Per source column: valid values, sentinel values set to NULL (-9999, NA, inf), exact zeros set to NULL, factor applied.');
  parts.push('');
  parts.push(
    table(
      ['Source', 'Column', 'Valid', 'Sentinels', 'Zeros nulled', 'Factor'],
      report.sources.flatMap((s) => Object.entries(s.columns).map(([c, cs]) => [s.id, c, cs.n_valid, cs.n_sentinel, cs.n_zero_nulled, cs.factor === null ? '' : String(cs.factor)])),
    ),
  );
  parts.push('');
  parts.push('## Validation (Valibot)');
  parts.push('');
  parts.push(`Rows checked: ${report.validation.rowsChecked}. Errors: ${report.validation.errors}.`);
  const warn = Object.entries(report.validation.warningsByColumn);
  parts.push(warn.length ? `Physical range warnings: ${warn.map(([k, n]) => `${k} = ${n}`).join(', ')}.` : 'Physical range warnings: none.');
  parts.push('');
  return parts.join('\n');
}

// ---------- main ----------

async function main(): Promise<void> {
  const started = Date.now();
  const reg = v.safeParse(RegistrySchema, REGISTRY);
  if (!reg.success) {
    const flat = v.flatten(reg.issues);
    fail(`registry is not valid:\n${JSON.stringify(flat, null, 2)}`);
  }
  const registry = reg.output;
  await mkdir(OUT_DIR, { recursive: true });

  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  const version = str((await one(conn, 'SELECT version() AS v')).v);
  log(`DuckDB ${version}, Node ${process.version}`);

  await conn.run(`
    CREATE MACRO num(x) AS
      CASE WHEN try_cast(x AS DOUBLE) = -9999 OR NOT isfinite(try_cast(x AS DOUBLE)) THEN NULL
           ELSE try_cast(x AS DOUBLE) END`);

  // 1. Sources
  log('Reading sources');
  const sourceReports: SourceReport[] = [];
  for (const src of registry.sources) sourceReports.push(await ingestSource(conn, src));

  // 2. Merge per site, then union, shift to UTC and complete the grid
  log('Merging sites');
  const conflicts = new Map<number, Record<CoreColumn, number>>();
  for (const site of registry.sites) {
    const sources = registry.sources.filter((s) => s.site === site.code);
    if (sources.length === 0) fail(`site ${site.code} has no sources`);
    conflicts.set(site.siteId, await mergeSite(conn, site, sources));
  }
  await conn.run(`
    CREATE TABLE merged AS
    ${registry.sites
      .map(
        (site) =>
          `SELECT site_id, ts_local - to_minutes(${site.utcOffsetMin}) AS ts_start, ${CORE_COLUMNS.map(ident).join(', ')} FROM ${ident(`merged_${site.code}`)}`,
      )
      .join('\n UNION ALL ')}`);
  await conn.run(`
    CREATE TABLE span AS SELECT site_id, min(ts_start) AS t0, max(ts_start) AS t1, count(*) AS n_merged FROM merged GROUP BY site_id`);
  await conn.run(`
    CREATE TABLE obs AS
    WITH grid AS (SELECT site_id, unnest(generate_series(t0, t1, ${STEP})) AS ts_start FROM span)
    SELECT g.site_id::UTINYINT AS site_id, g.ts_start::TIMESTAMP AS ts_start,
           m.nee::DOUBLE AS nee, m.nee_f::DOUBLE AS nee_f, m.nee_qc::UTINYINT AS nee_qc,
           m.ta::DOUBLE AS ta, m.tsoil::DOUBLE AS tsoil, m.swc::DOUBLE AS swc
    FROM grid g LEFT JOIN merged m USING (site_id, ts_start)
    ORDER BY g.site_id, g.ts_start`);

  // 3. Metadata tables
  await conn.run(`
    CREATE TABLE sites AS
    SELECT m.site_id::UTINYINT AS site_id, m.code, m.fluxnet_id, m.name, m.country,
           m.lat::DOUBLE AS lat, m.lon::DOUBLE AS lon, m.elevation_m::DOUBLE AS elevation_m,
           m.utc_offset_min::SMALLINT AS utc_offset_min, m.timestep_min::SMALLINT AS timestep_min,
           m.ecosystem, m.description, m.comment, s.t0 AS data_start, s.t1 AS data_end
    FROM (VALUES
      ${registry.sites
        .map(
          (s) =>
            `(${[s.siteId, s.code, s.fluxnetId, s.name, s.country, s.lat, s.lon, s.elevationM, s.utcOffsetMin, s.timestepMin, s.ecosystem, s.description, s.comment].map(lit).join(', ')})`,
        )
        .join(',\n')}
    ) m(site_id, code, fluxnet_id, name, country, lat, lon, elevation_m, utc_offset_min, timestep_min, ecosystem, description, comment)
    LEFT JOIN span s USING (site_id) ORDER BY site_id`);
  await conn.run(`
    CREATE TABLE variables AS SELECT * FROM (VALUES
      ${VARIABLES.map((x) => `(${[x.column, x.type, x.unit, x.description].map(lit).join(', ')})`).join(',\n')}
    ) t(column_name, data_type, unit, description)`);
  const siteVariableRows = registry.sources.flatMap((src) =>
    mappings(src).map(([c, m]) => {
      const site = registry.sites.find((s) => s.code === src.site)!;
      return `(${[
        site.siteId, site.code, c, src.id, src.path, m.sourceColumns.join(', '), m.expr, m.factor ?? null, m.zeroIsNull ?? false,
        m.depthCm ?? null, src.rank, src.aggregate ? `${src.aggregate.method} of ${src.stepMin}-min values, at least ${src.aggregate.minCount}` : null, m.note ?? null,
      ].map(lit).join(', ')})`;
    }),
  );
  await conn.run(`
    CREATE TABLE site_variables AS
    SELECT site_id::UTINYINT AS site_id, site_code, column_name, source_id, source_path, source_columns, expression,
           factor::DOUBLE AS factor, zero_is_null::BOOLEAN AS zero_is_null, depth_cm::DOUBLE AS depth_cm, rank::SMALLINT AS rank, aggregation, note
    FROM (VALUES ${siteVariableRows.join(',\n')})
    t(site_id, site_code, column_name, source_id, source_path, source_columns, expression, factor, zero_is_null, depth_cm, rank, aggregation, note)`);

  // 4. Validate every output row
  log('Validating rows');
  const validation = await validateRows(conn);
  if (validation.errors > 0) {
    fail(`${validation.errors} rows failed validation. First errors:\n${validation.firstErrors.join('\n')}`);
  }

  // 5. Write Parquet
  log('Writing Parquet');
  const builtAt = new Date().toISOString();
  const meta = `KV_METADATA {built_at: ${lit(builtAt)}, generator: 'scripts/build-db.ts', design: 'docs/harmonised-database.md'}`;
  await conn.run(`COPY (SELECT * FROM obs ORDER BY site_id, ts_start) TO ${lit(OBS_FILE)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000, ${meta})`);
  for (const t of ['sites', 'variables', 'site_variables']) {
    await conn.run(`COPY (SELECT * FROM ${t}) TO ${lit(`${OUT_DIR}/${t}.parquet`)} (FORMAT parquet, COMPRESSION zstd, ${meta})`);
  }

  // 6. Statistics
  log('Computing statistics');
  const outputs: Report['outputs'] = [];
  for (const t of ['observations', 'sites', 'variables', 'site_variables']) {
    const file = `${OUT_DIR}/${t}.parquet`;
    const n = await one(conn, `SELECT count(*) AS n FROM read_parquet(${lit(file)})`);
    outputs.push({ file, rows: num(n.n), bytes: (await stat(file)).size });
  }
  const siteStats = await rows(conn, `SELECT site_id, count(*) AS rows, min(ts_start)::VARCHAR AS t0, max(ts_start)::VARCHAR AS t1, ${statSelect()} FROM obs GROUP BY site_id ORDER BY site_id`);
  const yearStats = await rows(conn, `SELECT site_id, year(ts_start) AS year, count(*) AS rows, ${statSelect()} FROM obs GROUP BY site_id, year ORDER BY site_id, year`);
  const spans = await rows(conn, 'SELECT site_id, n_merged FROM span');
  const sites: Report['sites'] = registry.sites.map((site) => {
    const s = siteStats.find((r) => num(r.site_id) === site.siteId)!;
    const merged = num(spans.find((r) => num(r.site_id) === site.siteId)!.n_merged);
    const stats = colStats(s);
    const conflict = conflicts.get(site.siteId)!;
    const warnings = validation.warnings.get(site.siteId) ?? new Map<string, number>();
    const columns: Report['sites'][number]['columns'] = {};
    for (const c of CORE_COLUMNS) columns[c] = { ...stats[c]!, conflicts: conflict[c], rangeWarnings: warnings.get(c) ?? 0 };
    return {
      siteId: site.siteId,
      code: site.code,
      name: site.name,
      rows: num(s.rows),
      gridRowsInserted: num(s.rows) - merged,
      tsFirstUtc: str(s.t0),
      tsLastUtc: str(s.t1),
      columns,
      years: yearStats.filter((r) => num(r.site_id) === site.siteId).map((r) => ({ year: num(r.year), rows: num(r.rows), columns: colStats(r) })),
    };
  });
  const warningsByColumn: Record<string, number> = {};
  for (const bySite of validation.warnings.values()) {
    for (const [c, n] of bySite) warningsByColumn[c] = (warningsByColumn[c] ?? 0) + n;
  }
  const report: Report = v.parse(ReportSchema, {
    builtAt,
    duckdb: version,
    node: process.version,
    outputs,
    sites,
    sources: sourceReports,
    validation: { rowsChecked: validation.rowsChecked, errors: validation.errors, warningsByColumn },
  });

  const md = renderMarkdown(report);
  await writeFile(`${OUT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${OUT_DIR}/report.md`, `${md}\n`);
  conn.closeSync();
  process.stdout.write(`${md}\n`);
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((e: unknown) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
