// Copy the data files for the website.
//
// Run: node scripts/sync-site-data.ts (part of npm run site:sync)
// 1. db/*.parquet -> site/public/data/ (the page reads them with DuckDB-WASM).
// 2. data/calculated/fluxes_30min.parquet -> site/public/data/fluxes.parquet:
//    a slim copy with gpp, reco and the Maktau gap-filled NEE as FLOAT. The
//    full file is 29 MB, above the 25 MiB limit of Cloudflare static assets.
// 3. Small tables of data/calculated/ -> site/src/data/calculated/: the
//    "Calculated" page reads them at build time. They are not served.
// 4. Fixed y ranges of all data -> site/src/data/axis-ranges.json (scripts/axis-ranges.ts).
// 5. db/events.parquet with the site names -> site/src/data/events.json: the
//    "Events" page reads it at build time.
// Steps 2 to 4 need npm run calc. Design: docs/calculated.md.

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { DuckDBInstance } from '@duckdb/node-api';
import { writeAxisRanges } from './axis-ranges.ts';

const SRC_DIR = 'db';
const OUT_DIR = 'site/public/data';
const FILES = ['observations', 'sites', 'variables', 'site_variables', 'events'].map((name) => `${name}.parquet`);

const CALC_DIR = 'data/calculated';
const CALC_FLUXES = `${CALC_DIR}/fluxes_30min.parquet`;
const OUT_FLUXES = `${OUT_DIR}/fluxes.parquet`;
const PAGE_DATA_DIR = 'site/src/data/calculated';
const EVENTS_JSON = 'site/src/data/events.json';
const PAGE_FILES = [
  'annual.csv',
  'necb.csv',
  'partition_params.csv',
  'validation_partition.csv',
  'validation_qvidja.csv',
  'validation_haltiala.csv',
  'management_carbon.csv',
  'report.json',
];

async function mtime(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.mtimeMs : null;
  } catch {
    return null;
  }
}

const missing: string[] = [];
for (const file of FILES) if ((await mtime(`${SRC_DIR}/${file}`)) === null) missing.push(`${SRC_DIR}/${file}`);
if (missing.length > 0) {
  console.error(`Missing files: ${missing.join(', ')}. Run npm run build:db first.`);
  process.exit(1);
}
const missingCalc: string[] = [];
for (const file of [CALC_FLUXES, ...PAGE_FILES.map((f) => `${CALC_DIR}/${f}`)]) if ((await mtime(file)) === null) missingCalc.push(file);
if (missingCalc.length > 0) {
  console.error(`Missing files: ${missingCalc.join(', ')}. Run npm run calc first.`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
for (const file of FILES) {
  await copyFile(`${SRC_DIR}/${file}`, `${OUT_DIR}/${file}`);
  const { size } = await stat(`${OUT_DIR}/${file}`);
  console.log(`Copied ${SRC_DIR}/${file} -> ${OUT_DIR}/${file} (${size} bytes)`);
}

// 2. Slim fluxes file. Skip when it is newer than its input.
const src = (await mtime(CALC_FLUXES))!;
const out = await mtime(OUT_FLUXES);
if (out !== null && out >= src) {
  console.log(`${OUT_FLUXES} is up to date`);
} else {
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  await conn.run(`
    COPY (
      -- nee_f_calc: the gap-filled NEE that observations.parquet does not have. Maktau has no
      -- gap-filled NEE in the source, thus all its rows (measured and MDS) go in; the other sites
      -- give only the MDS rows (Viikki 2023). db.ts fills nee_f with it where the source is NULL.
      SELECT site_id, ts_start, gpp::FLOAT AS gpp, reco::FLOAT AS reco, reco_fqc, gpp_fqc,
             CASE WHEN nee_fill = 'mds' OR site_code = 'maktau' THEN nee_f::FLOAT END AS nee_f_calc
      FROM read_parquet('${CALC_FLUXES}') ORDER BY site_id, ts_start
    ) TO '${OUT_FLUXES}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 19, ROW_GROUP_SIZE 100000)`);
  conn.closeSync();
  const { size } = await stat(OUT_FLUXES);
  console.log(`Wrote ${OUT_FLUXES} from ${CALC_FLUXES} (${size} bytes)`);
}

// 3. Tables for the Calculated page
await mkdir(PAGE_DATA_DIR, { recursive: true });
for (const file of PAGE_FILES) await copyFile(`${CALC_DIR}/${file}`, `${PAGE_DATA_DIR}/${file}`);
console.log(`Copied ${PAGE_FILES.length} files ${CALC_DIR} -> ${PAGE_DATA_DIR}`);

// 4. Fixed y ranges. They need fluxes.parquet (gpp, reco, Maktau nee_f), thus they come last.
await writeAxisRanges();

// 5. Events for the Events page, in the order of the sites
{
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  await conn.run(`
    COPY (
      SELECT e.site_code, s.name AS site_name, strftime(e.date, '%Y-%m-%d') AS date, strftime(e.date_end, '%Y-%m-%d') AS date_end,
             e.type, e.crop, e.amount, e.amount_unit, e.dm_fraction, e.dry_mass_kg_ha, e.c_g_m2, e.n_kg_ha, e.area_ha, e.detail, e.source
      FROM read_parquet('${SRC_DIR}/events.parquet') e JOIN read_parquet('${SRC_DIR}/sites.parquet') s USING (site_id)
      ORDER BY e.site_id, e.date, e.type, e.detail
    ) TO '${EVENTS_JSON}' (FORMAT json, ARRAY true)`);
  conn.closeSync();
  const { size } = await stat(EVENTS_JSON);
  console.log(`Wrote ${EVENTS_JSON} (${size} bytes)`);
}
