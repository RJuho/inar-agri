// Small CSV reader for the build. It reads the files in site/src/data/calculated/.
// Format: comma delimiter, header row, double-quoted fields can hold commas and "" quotes, empty field = null.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, string | null>;

/** Folder of the calculated data. Astro bundles the frontmatter, so try more than one place. */
function dataDir(): string {
  const candidates = [
    join(process.cwd(), 'site', 'src', 'data', 'calculated'),
    join(process.cwd(), 'src', 'data', 'calculated'),
  ];
  try {
    candidates.push(fileURLToPath(new URL('../data/calculated/', import.meta.url)));
  } catch {
    // import.meta.url is not a file URL in this context.
  }
  const found = candidates.find((dir) => existsSync(join(dir, 'report.json')));
  if (!found) throw new Error(`Cannot find the calculated data. Tried: ${candidates.join(', ')}`);
  return found;
}

/** Split CSV text into rows of fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Read a CSV file of the calculated data as objects. Empty fields become null. */
export function readCsv(name: string): Row[] {
  const [header, ...body] = parseCsv(readFileSync(join(dataDir(), name), 'utf8'));
  if (!header) return [];
  return body.map((fields) => {
    const out: Row = {};
    header.forEach((key, i) => {
      const v = fields[i];
      out[key] = v === undefined || v === '' ? null : v;
    });
    return out;
  });
}

/** Read a JSON file of the calculated data. */
export function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir(), name), 'utf8')) as T;
}
