// Check the size of each file in the website build.
//
// Run: node scripts/check-dist.ts
// Cloudflare Workers static assets accept files up to 25 MiB.
// The script fails if one file in site/dist/ is 25 MiB or larger.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIST_DIR = 'site/dist';
const MAX_BYTES = 25 * 1024 * 1024;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = await listFiles(DIST_DIR);
const tooLarge: string[] = [];
let largest = { path: '', size: 0 };
for (const path of files) {
  const { size } = await stat(path);
  if (size >= MAX_BYTES) tooLarge.push(`${path} (${size} bytes)`);
  if (size > largest.size) largest = { path, size };
}

if (tooLarge.length > 0) {
  console.error(`Files of 25 MiB or larger in ${DIST_DIR}:\n  ${tooLarge.join('\n  ')}`);
  process.exit(1);
}
console.log(`Checked ${files.length} files in ${DIST_DIR}. Largest: ${largest.path} (${largest.size} bytes).`);
