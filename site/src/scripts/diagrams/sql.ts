// SQL parts that all diagram types use.
// Only whitelisted variable names and integers go into the SQL text.
import { VARIABLES, type Variable, type ViewParams } from '../state';

/** Return the variable name only when it is in the whitelist. */
export function col(v: Variable): string {
  if (!(VARIABLES as readonly string[]).includes(v)) throw new Error(`Unknown variable: ${String(v)}`);
  return v;
}

/** WHERE clause for the sites and years of the view. Returns null when no site is selected. */
export function whereClause(params: ViewParams): string | null {
  const sites = params.sites.filter((s) => Number.isInteger(s));
  if (sites.length === 0) return null;
  const parts = [`site_id IN (${sites.join(', ')})`];
  if (params.yearFrom !== null) parts.push(`year(tl) >= ${Math.trunc(params.yearFrom)}`);
  if (params.yearTo !== null) parts.push(`year(tl) <= ${Math.trunc(params.yearTo)}`);
  return parts.join(' AND ');
}
