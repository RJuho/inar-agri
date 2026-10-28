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
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import * as v from 'valibot';
import { EVENTS, withCarbon } from './lib/events.ts';
import { MANAGEMENT_CARBON, cGm2 } from './lib/calc/management.ts';
import { ALL_COLUMNS, REGISTRY, VARIABLES, type CoreColumn } from './lib/registry.ts';
import { fail, fmt, ident, lit, log, num, numOrNull, one, rows, str, table } from './lib/duck.ts';
import {
  EventRowSchema,
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

/** Text for site_variables.aggregation: how the source rows become 30-min periods. */
function aggregationText(src: Source, c: CoreColumn): string | null {
  if (src.aggregate) return `${src.aggregate.method} of ${src.stepMin}-min values, at least ${src.aggregate.minCount}`;
  if (src.expand) {
    const n = src.expand.offsetsMin.length;
    return (src.expand.sumColumns as readonly string[]).includes(c)
      ? `${src.stepMin}-min sum, 1/${n} to each of the ${n} 30-min periods (offsets ${src.expand.offsetsMin.join(', ')} min)`
      : `${src.stepMin}-min mean, copied to each of the ${n} 30-min periods (offsets ${src.expand.offsetsMin.join(', ')} min)`;
  }
  return null;
}

/** DuckDB type of an output column, from VARIABLES. */
const COLUMN_TYPE: Record<string, string> = Object.fromEntries(VARIABLES.map((x) => [x.column, x.type]));

function mappings(src: Source): [CoreColumn, ColumnMap][] {
  return ALL_COLUMNS.flatMap((c) => {
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

// ---------- step 1: read one source file into stage_<id> ----------

async function ingestSource(conn: DuckDBConnection, src: Source): Promise<SourceReport> {
  const physicalLines = await countLines(src.path);
  const maps = mappings(src);

  // Header check. read_csv reads the names from line 1 and the unit row (if any) is skipped later.
  const encoding = lit(src.encoding ?? 'utf-8');
  const head = await conn.runAndReadAll(
    `SELECT * FROM read_csv(${lit(src.path)}, delim=${lit(src.delim)}, header=true, all_varchar=true, encoding=${encoding}) LIMIT 0`,
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
                    names=[${names.map(lit).join(', ')}], all_varchar=true, store_rejects=true, encoding=${encoding})
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
  const zeroExpr = (m: ColumnMap): string => (m.zeroIsNull ? `nullif(${m.expr}, 0)` : m.expr);
  // Then the range rule: a value outside `validRange` becomes NULL.
  const colExpr = (m: ColumnMap): string => {
    if (!m.validRange) return zeroExpr(m);
    const [lo, hi] = m.validRange;
    return `CASE WHEN (${zeroExpr(m)}) BETWEEN ${lo} AND ${hi} THEN (${zeroExpr(m)}) END`;
  };

  // The expressions are computed in a subquery first. Then an expression can use a
  // window function (for example a daily rule), which is not allowed inside count().
  const exprSql = maps.flatMap(([c, m]) => [
    `${colExpr(m)} AS ${ident(`ev_${c}`)}`,
    `${m.expr} AS ${ident(`ee_${c}`)}`,
    `${zeroExpr(m)} AS ${ident(`ez_${c}`)}`,
  ]);
  const statSql = maps.flatMap(([c, m]) => {
    const first = m.sourceColumns[0]!;
    return [
      `count(${ident(`ev_${c}`)}) AS ${ident(`nv_${c}`)}`,
      `count(*) FILTER (WHERE ${ident(first)} IS NOT NULL AND num(${ident(first)}) IS NULL) AS ${ident(`ns_${c}`)}`,
      m.zeroIsNull ? `count(*) FILTER (WHERE ${ident(`ee_${c}`)} = 0) AS ${ident(`nz_${c}`)}` : `0 AS ${ident(`nz_${c}`)}`,
      `count(${ident(`ez_${c}`)}) - count(${ident(`ev_${c}`)}) AS ${ident(`nr_${c}`)}`,
    ];
  });
  const s = await one(
    conn,
    `SELECT count(*) AS rows_read, count(ts_local) AS rows_ok,
            count(ts_parsed) FILTER (WHERE ts_local IS NOT NULL) - count(DISTINCT ts_parsed) FILTER (WHERE ts_local IS NOT NULL) AS dup_stamps,
            ${statSql.join(', ')}
     FROM (SELECT *, ${exprSql.join(', ')} FROM ${ident(`raw_${src.id}`)})`,
  );

  // Stage: one row per period with all output columns. Missing columns are NULL.
  const allCols = ALL_COLUMNS.map((c) => {
    const m = src.columns[c];
    return m ? `${colExpr(m)} AS ${ident(c)}` : `NULL::DOUBLE AS ${ident(c)}`;
  });
  let stageSql: string;
  if (src.aggregate) {
    const minCount = src.aggregate.minCount;
    stageSql = `
      WITH r AS (SELECT source_row, ts_parsed, ts_local, ${allCols.join(', ')} FROM ${ident(`raw_${src.id}`)} WHERE ts_local IS NOT NULL),
      d AS (SELECT ts_parsed, ts_local, min(source_row) AS source_row,
                   ${ALL_COLUMNS.map((c) => `any_value(${ident(c)} ORDER BY source_row) AS ${ident(c)}`).join(', ')}
            FROM r GROUP BY ts_parsed, ts_local)
      SELECT ts_local, min(source_row) AS source_row,
             ${ALL_COLUMNS.map((c) => `CASE WHEN count(${ident(c)}) >= ${minCount} THEN round(avg(${ident(c)}), 10) END AS ${ident(c)}`).join(', ')}
      FROM d GROUP BY ts_local`;
  } else if (src.expand) {
    // One row per offset. A sum column is divided by the number of offsets, a mean is copied.
    const { offsetsMin, sumColumns } = src.expand;
    const n = offsetsMin.length;
    const out = ALL_COLUMNS.map((c) =>
      (sumColumns as readonly string[]).includes(c) && src.columns[c] ? `${ident(c)} / ${n} AS ${ident(c)}` : ident(c),
    );
    stageSql = `
      WITH r AS (SELECT source_row, ts_local, ${allCols.join(', ')} FROM ${ident(`raw_${src.id}`)} WHERE ts_local IS NOT NULL)
      SELECT r.ts_local + to_minutes(o.off) AS ts_local, r.source_row, ${out.join(', ')}
      FROM r CROSS JOIN (VALUES ${offsetsMin.map((x) => `(${x})`).join(', ')}) o(off)`;
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
      n_range_nulled: num(s[`nr_${c}`]),
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
    rowsAfterExpansion: src.expand ? num(staged.n) : null,
    columns,
  };
  log(`  ${src.id}: ${report.physicalLines} lines, ${report.rowsRead} rows read, ${report.rowsRejected} rejected, ${report.duplicateStamps} duplicate stamps`);
  return report;
}

// ---------- step 2: merge the sources of one site ----------

async function mergeSite(conn: DuckDBConnection, site: Site, sources: Source[]): Promise<Record<CoreColumn, number>> {
  const union = sources
    .map((s) => `SELECT ${s.rank} AS rank, source_row, ts_local, ${ALL_COLUMNS.map(ident).join(', ')} FROM ${ident(`stage_${s.id}`)}`)
    .join('\n UNION ALL ');
  await conn.run(`
    CREATE TABLE ${ident(`merged_${site.code}`)} AS
    SELECT ${site.siteId} AS site_id, ts_local,
           ${ALL_COLUMNS.map((c) => `any_value(${ident(c)} ORDER BY rank, source_row) AS ${ident(c)}`).join(', ')},
           ${ALL_COLUMNS.map((c) => `count(DISTINCT ${ident(c)}) > 1 AS ${ident(`conflict_${c}`)}`).join(', ')}
    FROM (${union})
    GROUP BY ts_local`);
  const r = await one(
    conn,
    `SELECT ${ALL_COLUMNS.map((c) => `count(*) FILTER (WHERE ${ident(`conflict_${c}`)}) AS ${ident(c)}`).join(', ')} FROM ${ident(`merged_${site.code}`)}`,
  );
  return Object.fromEntries(ALL_COLUMNS.map((c) => [c, num(r[c])])) as Record<CoreColumn, number>;
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
  return ALL_COLUMNS.map(
    (c) => `count(${ident(c)}) AS ${ident(`nv_${c}`)}, min(${ident(c)}) AS ${ident(`min_${c}`)}, max(${ident(c)}) AS ${ident(`max_${c}`)}, avg(${ident(c)}) AS ${ident(`mean_${c}`)}`,
  ).join(', ');
}

function colStats(r: Record<string, unknown>): Record<string, ColStat> {
  const out: Record<string, ColStat> = {};
  for (const c of ALL_COLUMNS) {
    out[c] = { n_valid: num(r[`nv_${c}`]), min: numOrNull(r[`min_${c}`]), max: numOrNull(r[`max_${c}`]), mean: numOrNull(r[`mean_${c}`]) };
  }
  return out;
}

// ---------- report rendering ----------

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
  parts.push('## Management events');
  parts.push('');
  parts.push('Rows of events.parquet per site and type, and the rows with a yield (kg DW/ha), carbon (g C m-2) or N input (kg N/ha). Source: scripts/lib/events.ts; carbon from scripts/lib/calc/management.ts.');
  parts.push('');
  parts.push(table(['Site', 'Type', 'Events', 'With yield', 'With C', 'With N'], report.events.map((e) => [e.site, e.type, e.n, e.withYield, e.withC, e.withN])));
  parts.push('');
  parts.push('Carbon rows of the management table that match no event (same site, date and type):');
  parts.push('');
  parts.push(
    report.unmatchedCarbon.length === 0
      ? 'None.'
      : table(['Site', 'Date', 'Action', 'Product', 'C (g C m-2)'], report.unmatchedCarbon.map((m) => [m.site, m.date, m.action, m.product, m.cGm2])),
  );
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
        ALL_COLUMNS.map((c) => {
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
        ['Year', 'Rows', ...ALL_COLUMNS],
        s.years.map((y) => [
          y.year,
          y.rows,
          ...ALL_COLUMNS.map((c) => {
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
      ['Source', 'File', 'Lines', 'Header', 'Rows read', 'Skipped', 'Rejected', 'Duplicate stamps', 'Rows after aggregation', 'Rows after expansion'],
      report.sources.map((s) => [s.id, s.path, s.physicalLines, s.headerLines, s.rowsRead, s.linesSkippedByParser, s.rowsRejected, s.duplicateStamps, s.rowsAfterAggregation, s.rowsAfterExpansion]),
    ),
  );
  parts.push('');
  parts.push('Per source column: valid values, sentinel values set to NULL (-9999, NA, inf), exact zeros set to NULL, values outside the valid range set to NULL, factor applied.');
  parts.push('');
  parts.push(
    table(
      ['Source', 'Column', 'Valid', 'Sentinels', 'Zeros nulled', 'Out of range', 'Factor'],
      report.sources.flatMap((s) => Object.entries(s.columns).map(([c, cs]) => [s.id, c, cs.n_valid, cs.n_sentinel, cs.n_zero_nulled, cs.n_range_nulled, cs.factor === null ? '' : String(cs.factor)])),
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
          `SELECT site_id, ts_local - to_minutes(${site.utcOffsetMin}) AS ts_start, ${ALL_COLUMNS.map(ident).join(', ')} FROM ${ident(`merged_${site.code}`)}`,
      )
      .join('\n UNION ALL ')}`);
  await conn.run(`
    CREATE TABLE span AS SELECT site_id, min(ts_start) AS t0, max(ts_start) AS t1, count(*) AS n_merged FROM merged GROUP BY site_id`);
  await conn.run(`
    CREATE TABLE obs AS
    WITH grid AS (SELECT site_id, unnest(generate_series(t0, t1, ${STEP})) AS ts_start FROM span)
    SELECT g.site_id::UTINYINT AS site_id, g.ts_start::TIMESTAMP AS ts_start,
           ${ALL_COLUMNS.map((c) => `m.${ident(c)}::${COLUMN_TYPE[c] ?? 'DOUBLE'} AS ${ident(c)}`).join(', ')}
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
        m.depthCm ?? null, src.rank, aggregationText(src, c), m.note ?? null,
      ].map(lit).join(', ')})`;
    }),
  );
  await conn.run(`
    CREATE TABLE site_variables AS
    SELECT site_id::UTINYINT AS site_id, site_code, column_name, source_id, source_path, source_columns, expression,
           factor::DOUBLE AS factor, zero_is_null::BOOLEAN AS zero_is_null, depth_cm::DOUBLE AS depth_cm, rank::SMALLINT AS rank, aggregation, note
    FROM (VALUES ${siteVariableRows.join(',\n')})
    t(site_id, site_code, column_name, source_id, source_path, source_columns, expression, factor, zero_is_null, depth_cm, rank, aggregation, note)`);

  // Management events (hand-typed table, checked here)
  // Carbon per event from the management table of the calculated products (one source).
  const carbon = withCarbon(EVENTS, MANAGEMENT_CARBON);
  const unmatchedCarbon = carbon.unmatched;
  const eventIssues = carbon.events.flatMap((e) => {
    const p = v.safeParse(EventRowSchema, e);
    return p.success ? [] : [`${e.site} ${e.date} ${e.type}: ${p.issues.map((i) => i.message).join('; ')}`];
  });
  if (eventIssues.length > 0) fail(`event rows are not valid:\n${eventIssues.join('\n')}`);
  const siteIdOf = new Map(registry.sites.map((s) => [s.code, s.siteId]));
  await conn.run(`
    CREATE TABLE events AS
    SELECT site_id::UTINYINT AS site_id, site_code, date::DATE AS date, date_end::DATE AS date_end, type, detail, source,
           crop::VARCHAR AS crop, amount::DOUBLE AS amount, amount_unit::VARCHAR AS amount_unit, dm_fraction::DOUBLE AS dm_fraction,
           dry_mass_kg_ha::DOUBLE AS dry_mass_kg_ha, n_kg_ha::DOUBLE AS n_kg_ha, c_g_m2::DOUBLE AS c_g_m2, area_ha::DOUBLE AS area_ha
    FROM (VALUES
      ${carbon.events
        .map(
          (e) =>
            `(${[
              siteIdOf.get(e.site)!, e.site, e.date, e.date_end ?? null, e.type, e.detail, e.source,
              e.crop ?? null, e.amount ?? null, e.amount_unit ?? null, e.dm_fraction ?? null,
              e.dry_mass_kg_ha ?? null, e.n_kg_ha ?? null, e.c_g_m2 ?? null, e.area_ha ?? null,
            ].map(lit).join(', ')})`,
        )
        .join(',\n')}
    ) t(site_id, site_code, date, date_end, type, detail, source, crop, amount, amount_unit, dm_fraction, dry_mass_kg_ha, n_kg_ha, c_g_m2, area_ha)
    ORDER BY site_id, date, type, detail`);
  const dupEvents = await rows(conn, `SELECT site_code, date::VARCHAR AS d, type, count(*) AS n FROM events GROUP BY ALL HAVING count(*) > 1 AND count(DISTINCT detail) < count(*)`);
  if (dupEvents.length > 0) fail(`duplicate event rows: ${dupEvents.map((r) => `${str(r.site_code)} ${str(r.d)} ${str(r.type)}`).join(', ')}`);

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
  for (const t of ['sites', 'variables', 'site_variables', 'events']) {
    await conn.run(`COPY (SELECT * FROM ${t}) TO ${lit(`${OUT_DIR}/${t}.parquet`)} (FORMAT parquet, COMPRESSION zstd, ${meta})`);
  }

  // 6. Statistics
  log('Computing statistics');
  const outputs: Report['outputs'] = [];
  for (const t of ['observations', 'sites', 'variables', 'site_variables', 'events']) {
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
    for (const c of ALL_COLUMNS) columns[c] = { ...stats[c]!, conflicts: conflict[c], rangeWarnings: warnings.get(c) ?? 0 };
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
    events: (
      await rows(
        conn,
        `SELECT site_code, type, count(*) AS n, count(dry_mass_kg_ha) AS n_yield, count(c_g_m2) AS n_c, count(n_kg_ha) AS n_n
         FROM events GROUP BY ALL ORDER BY min(site_id), type`,
      )
    ).map((r) => ({
      site: str(r.site_code),
      type: str(r.type),
      n: num(r.n),
      withYield: num(r.n_yield),
      withC: num(r.n_c),
      withN: num(r.n_n),
    })),
    unmatchedCarbon: unmatchedCarbon.map((m) => ({ site: m.site, date: m.date, action: m.action, product: m.product, cGm2: cGm2(m)! })),
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
