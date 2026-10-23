// Standardized Precipitation Index (SPI) input of the Deep Dives.
// The file data/SPI/SPI_all_stations.csv is the output of data/SPI/SPIanalysis.R
// (SPEI R package, spi(), gamma distribution, reference period 1981 to 2010).
// This module only parses the file and gives simple helpers. It does not compute SPI.

/** The three FMI stations in SPI_all_stations.csv (column `Station`). */
export const STATIONS = ['Kaarina Yltöinen', 'Vantaa', 'Kuopio Maaninka'] as const;
export type Station = (typeof STATIONS)[number];

/** Station of each site code of scripts/lib/registry.ts. Maktau has no station. */
export const STATION_OF_SITE: Record<string, Station> = {
  haltiala: 'Vantaa',
  viikki: 'Vantaa',
  qvidja: 'Kaarina Yltöinen',
  anttila: 'Kuopio Maaninka',
  sarkisuo: 'Kuopio Maaninka',
};

/** One station month. `mm` is the monthly precipitation. NA in the file gives null. */
export interface SpiMonth {
  year: number;
  month: number;
  mm: number | null;
  spi1: number | null;
  spi3: number | null;
  spi6: number | null;
  spi12: number | null;
}

/** Key 'yyyy-mm'. */
export type Ym = string;

const HEADER = [
  'Date',
  'Observation.station',
  'Year',
  'Month',
  'Day',
  'Time..Local.time.',
  'Monthly.precipitation..mm.',
  'SPI1',
  'SPI3',
  'SPI6',
  'SPI12',
  'Station',
] as const;

/** Split one CSV line. Fields can be in double quotes (with "" for a quote). */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function numOrNull(s: string, where: string): number | null {
  if (s === 'NA' || s === '') return null;
  const x = Number(s);
  if (!Number.isFinite(x)) throw new Error(`SPI CSV: bad number "${s}" (${where})`);
  return x;
}

/**
 * Parse SPI_all_stations.csv. Returns station → 'yyyy-mm' → SpiMonth.
 * Throws on a bad header, a bad date, an unknown station or a duplicate station month.
 */
export function parseSpiCsv(text: string): Map<Station, Map<Ym, SpiMonth>> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('SPI CSV: empty file');
  const head = splitLine(lines[0] ?? '');
  if (head.length !== HEADER.length || head.some((h, i) => h !== HEADER[i])) {
    throw new Error(`SPI CSV: bad header ${JSON.stringify(head)}`);
  }
  const out = new Map<Station, Map<Ym, SpiMonth>>();
  for (let i = 1; i < lines.length; i++) {
    const fields = splitLine(lines[i] ?? '');
    const where = `line ${i + 1}`;
    if (fields.length !== HEADER.length) throw new Error(`SPI CSV: ${fields.length} fields, expected ${HEADER.length} (${where})`);
    const f = (k: number): string => fields[k] ?? '';
    const station = f(11);
    if (!(STATIONS as readonly string[]).includes(station)) throw new Error(`SPI CSV: unknown station "${station}" (${where})`);
    const m = /^(\d{4})-(\d{2})-01$/.exec(f(0));
    if (!m) throw new Error(`SPI CSV: bad date "${f(0)}" (${where})`);
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error(`SPI CSV: bad month "${f(0)}" (${where})`);
    const ym = `${m[1]}-${m[2]}`;
    let byYm = out.get(station as Station);
    if (!byYm) out.set(station as Station, (byYm = new Map()));
    if (byYm.has(ym)) throw new Error(`SPI CSV: duplicate month ${station} ${ym} (${where})`);
    byYm.set(ym, {
      year,
      month,
      mm: numOrNull(f(6), where),
      spi1: numOrNull(f(7), where),
      spi3: numOrNull(f(8), where),
      spi6: numOrNull(f(9), where),
      spi12: numOrNull(f(10), where),
    });
  }
  return out;
}

/** A month is dry when SPI-1 is at or below this value. */
export const DRY_THRESHOLD = -1;

/** True when SPI-1 is not null and at or below the threshold. */
export function isDry(spi1: number | null, threshold = DRY_THRESHOLD): boolean {
  return spi1 !== null && spi1 <= threshold;
}

/** The dry months ('yyyy-mm', sorted) of the years yearFrom to yearTo (both included). */
export function dryMonths(months: Map<Ym, SpiMonth>, yearFrom: number, yearTo: number, threshold = DRY_THRESHOLD): Ym[] {
  const out: Ym[] = [];
  for (const [ym, r] of months) {
    if (r.year >= yearFrom && r.year <= yearTo && isDry(r.spi1, threshold)) out.push(ym);
  }
  return out.sort();
}

/** Seasons of the growing period. Winter (December to February) is not used. */
export const SEASONS = ['MAM', 'JJA', 'SON'] as const;
export type Season = (typeof SEASONS)[number];

const SEASON_MONTHS: Record<Season, readonly number[]> = { MAM: [3, 4, 5], JJA: [6, 7, 8], SON: [9, 10, 11] };

/** Season of a month 1 to 12. Null for December, January and February. */
export function seasonOf(month: number): Season | null {
  for (const s of SEASONS) if (SEASON_MONTHS[s].includes(month)) return s;
  return null;
}

/** The three months of a season. */
export function seasonMonths(season: Season): readonly number[] {
  return SEASON_MONTHS[season];
}

/** A season is dry when at least one of its months is dry (SPI-1 of each month; null = not dry). */
export function seasonDry(spi1OfMonths: (number | null)[], threshold = DRY_THRESHOLD): boolean {
  return spi1OfMonths.some((x) => isDry(x, threshold));
}
