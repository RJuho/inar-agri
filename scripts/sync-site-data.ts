// Copy the harmonised Parquet files from db/ to site/public/data/.
//
// Run: node scripts/sync-site-data.ts
// The website reads these copies in the browser with DuckDB-WASM.

import { copyFile, mkdir, stat } from 'node:fs/promises';

const SRC_DIR = 'db';
const OUT_DIR = 'site/public/data';
const FILES = ['observations', 'sites', 'variables', 'site_variables'].map((name) => `${name}.parquet`);

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const missing: string[] = [];
for (const file of FILES) {
  if (!(await exists(`${SRC_DIR}/${file}`))) missing.push(`${SRC_DIR}/${file}`);
}
if (missing.length > 0) {
  console.error(`Missing files: ${missing.join(', ')}. Run npm run build:db first.`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
for (const file of FILES) {
  await copyFile(`${SRC_DIR}/${file}`, `${OUT_DIR}/${file}`);
  const { size } = await stat(`${OUT_DIR}/${file}`);
  console.log(`Copied ${SRC_DIR}/${file} -> ${OUT_DIR}/${file} (${size} bytes)`);
}
