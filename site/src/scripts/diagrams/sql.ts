// SQL parts that all diagram types use.
// Only whitelisted variable names and integers go into the SQL text.
import { VARIABLES, type Variable, type ViewParams } from '../state.ts';

/** Return the variable name only when it is in the whitelist. */
export function col<V extends Variable>(v: V): V {
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

/**
 * Start (inclusive) and end (exclusive) of the period as epoch ms of local wall time,
 * the same base as `epoch_ms(tl)`. null = no limit on that side.
 */
export function periodMs(params: ViewParams): { from: number | null; to: number | null } {
  const { from, to } = periodBounds(params);
  const ms = ([y, m]: [number, number]) => Date.UTC(y, m - 1, 1);
  return { from: from ? ms(from) : null, to: to ? ms(to) : null };
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

/** Variables that are an amount per period (mm per 30 min). A time step gives their sum. */
export const SUM_VARS: ReadonlySet<Variable> = new Set<Variable>(['precip']);
/** Directions in degrees (0 = north, 90 = east). Their mean is a circular mean. */
export const CIRCULAR_VARS: ReadonlySet<Variable> = new Set<Variable>(['wd']);

/**
 * SQL expression for the mean of `v` over a group of rows. Directions (`wd`) get the circular
 * mean in degrees 0 to 360: the direction of the mean unit vector. The other variables get avg().
 * Use it for statistics that are a mean also for `precip` (mean per half hour, per bin).
 */
export function meanExpr(v: Variable): string {
  const c = col(v);
  if (CIRCULAR_VARS.has(v)) return `((degrees(atan2(avg(sin(radians(${c}))), avg(cos(radians(${c}))))) + 360) % 360)`;
  return `avg(${c})`;
}

/**
 * SQL expression for the value of `v` in one time step (day, ISO week, month): the sum for
 * `SUM_VARS` (precipitation), else `meanExpr()`. A step with gaps gives a sum that is too low.
 */
export function stepExpr(v: Variable): string {
  return SUM_VARS.has(v) ? `sum(${col(v)})` : meanExpr(v);
}
