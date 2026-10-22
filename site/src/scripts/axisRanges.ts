// Fixed y ranges of all data (view option "Fixed y range (all data)", `params.fixedY`).
// scripts/axis-ranges.ts computes the ranges at build time (npm run site:sync) and writes
// site/src/data/axis-ranges.json. app.ts imports the JSON and calls setAxisRanges().
// The diagrams then get the same y range for each site, period and window width.
// This file has no DOM code and no chart code, so Node can run it (unit test, build script).
import * as v from 'valibot';
import { AGGREGATIONS, VARIABLES, type Aggregation, type Variable, type ViewParams } from './state.ts';
import { niceRange } from './diagrams/nice.ts';

/** [min, max] with min <= max. */
const RangeSchema = v.pipe(
  v.tuple([v.pipe(v.number(), v.finite()), v.pipe(v.number(), v.finite())]),
  v.check(([lo, hi]) => lo <= hi, 'min is larger than max'),
);
export type Range = [number, number];

/** One range per variable. A variable without data has no entry. */
const VariableRangesSchema = v.pipe(
  v.record(v.string(), RangeSchema),
  v.check((r) => Object.keys(r).every((k) => (VARIABLES as readonly string[]).includes(k)), 'unknown variable'),
);
type VariableRanges = Partial<Record<Variable, Range>>;

export const AxisRangesSchema = v.object({
  version: v.literal(1),
  /** Time of the build (ISO 8601, UTC). */
  created: v.string(),
  /** Min and max of the value of one time step (raw = 30 min), per site and step bucket. */
  step: v.object(Object.fromEntries(AGGREGATIONS.map((a) => [a, VariableRangesSchema])) as Record<Aggregation, typeof VariableRangesSchema>),
  /** Diurnal: mean and 25 to 75 % band per site, year and half hour of local time. */
  diurnal: VariableRangesSchema,
  /** Monthly bars: the `month` range with 0. */
  monthly: VariableRangesSchema,
  /** Cumulative: running sum per site and calendar year (g C m-2 or g CH4-C m-2), with 0. */
  cumulative: VariableRangesSchema,
  /** Budget: annual sum per site and year (g C m-2 yr-1), GPP negative, with 0. */
  budget: VariableRangesSchema,
  /** Fingerprint colour range: 2 % and 98 % quantiles of all 30-min values. */
  fingerprint: VariableRangesSchema,
});
export type AxisRanges = v.InferOutput<typeof AxisRangesSchema>;

/** Kinds of range. `step` needs the step of the view. */
export type RangeKind = 'step' | 'diurnal' | 'monthly' | 'cumulative' | 'budget' | 'fingerprint';

let ranges: AxisRanges | null = null;

/**
 * Check the data of axis-ranges.json and use it. Bad data gives a console warning and no fixed
 * ranges: the charts then use the range of the loaded rows.
 */
export function setAxisRanges(data: unknown): void {
  const r = v.safeParse(AxisRangesSchema, data);
  if (r.success) {
    ranges = r.output;
  } else {
    ranges = null;
    console.warn(`axis-ranges.json is not valid: ${v.summarize(r.issues)}`);
  }
}

function entry(kind: RangeKind, variable: Variable, step: Aggregation): Range | undefined {
  if (ranges === null) return undefined;
  const table: VariableRanges = kind === 'step' ? ranges.step[step] : ranges[kind];
  return table[variable];
}

/** Nice axis range: `{min, max, interval}` for an ECharts value axis. */
export type NiceRange = ReturnType<typeof niceRange>;

/**
 * Fixed axis range of one variable, rounded outwards with niceRange().
 * null when the view option is off or the variable has no entry: then use the auto range.
 * `step` is used only for kind `step`.
 */
export function fixedRange(params: ViewParams, kind: RangeKind, variable: Variable, step: Aggregation = params.aggregation): NiceRange | null {
  if (!params.fixedY) return null;
  const r = entry(kind, variable, step);
  return r ? niceRange(r) : null;
}

/**
 * Fixed range of a block of panels with one shared y axis (budget, cumulative): the union of the
 * ranges of the variables, rounded with niceRange(). Variables without an entry are skipped.
 * null when the option is off or no variable has an entry.
 */
export function blockRange(params: ViewParams, kind: RangeKind, variables: readonly Variable[], step: Aggregation = params.aggregation): NiceRange | null {
  if (!params.fixedY) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const variable of variables) {
    const r = entry(kind, variable, step);
    if (!r) continue;
    lo = Math.min(lo, r[0]);
    hi = Math.max(hi, r[1]);
  }
  return lo <= hi ? niceRange([lo, hi]) : null;
}

/** Fixed colour range of the fingerprint, not rounded. null when the option is off or there is no entry. */
export function fixedColorRange(params: ViewParams, variable: Variable): Range | null {
  if (!params.fixedY) return null;
  return entry('fingerprint', variable, params.aggregation) ?? null;
}

/** Sentence for the alt text when the fixed range is on. */
export const FIXED_Y_SENTENCE = 'The value range of the axes and colours is fixed: it is the range of all sites and years, the same for each view.';
