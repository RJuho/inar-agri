// SQL parts that all diagram types use.
// Only whitelisted variable names and integers go into the SQL text.
import { VARIABLES, type Variable, type ViewParams } from '../state';

/** Return the variable name only when it is in the whitelist. */
export function col(v: Variable): string {
  if (!(VARIABLES as readonly string[]).includes(v)) throw new Error(`Unknown variable: ${String(v)}`);
  return v;
}

/** First and last data year. app.ts sets them from the metadata at start. */
const bounds = { yearMin: 1900, yearMax: 2100 };

/** Set the first and last data year. A month limit without a year uses them. */
export function setYearBounds(yearMin: number, yearMax: number): void {
  if (Number.isInteger(yearMin)) bounds.yearMin = yearMin;
  if (Number.isInteger(yearMax)) bounds.yearMax = yearMax;
}

/**
 * Start (inclusive) and end (exclusive) of the period of the view in site local time,
 * as [year, month] pairs. null = no limit on that side.
 */
export function periodBounds(params: ViewParams): { from: [number, number] | null; to: [number, number] | null } {
  const int = (n: number) => Math.trunc(n);
  const { yearFrom, yearTo, monthFrom, monthTo } = params;
  let from: [number, number] | null = null;
  if (yearFrom !== null || monthFrom !== null) from = [int(yearFrom ?? bounds.yearMin), int(monthFrom ?? 1)];
  let to: [number, number] | null = null;
  if (yearTo !== null || monthTo !== null) {
    // The first day after the last month.
    const y = int(yearTo ?? bounds.yearMax);
    const m = int(monthTo ?? 12);
    to = m >= 12 ? [y + 1, 1] : [y, m + 1];
  }
  return { from, to };
}

const ts = ([y, m]: [number, number]) => `make_timestamp(${y}, ${m}, 1, 0, 0, 0)`;

/** WHERE clause for the sites and the period of the view. Returns null when no site is selected. */
export function whereClause(params: ViewParams): string | null {
  const sites = params.sites.filter((s) => Number.isInteger(s));
  if (sites.length === 0) return null;
  const parts = [`site_id IN (${sites.join(', ')})`];
  const { from, to } = periodBounds(params);
  if (from) parts.push(`tl >= ${ts(from)}`);
  if (to) parts.push(`tl < ${ts(to)}`);
  return parts.join(' AND ');
}
