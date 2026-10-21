// Valibot schemas for the build script: the registry, the file headers,
// the output rows and the build report.

import { existsSync } from 'node:fs';
import { DuckDBTimestampValue } from '@duckdb/node-api';
import * as v from 'valibot';
import { ALL_COLUMNS } from './registry.ts';

const nonEmpty = v.pipe(v.string(), v.nonEmpty());
const SITE_CODES = ['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki', 'maktau'] as const;

export const ColumnMapSchema = v.object({
  sourceColumns: v.pipe(v.array(nonEmpty), v.minLength(1)),
  expr: nonEmpty,
  factor: v.optional(v.pipe(v.number(), v.finite(), v.notValue(0))),
  zeroIsNull: v.optional(v.boolean()),
  depthCm: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0)))),
  note: v.optional(v.string()),
});

export const SiteSchema = v.object({
  siteId: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(255)),
  code: v.picklist(SITE_CODES),
  fluxnetId: v.nullable(nonEmpty),
  name: nonEmpty,
  country: v.pipe(v.string(), v.length(2)),
  lat: v.nullable(v.pipe(v.number(), v.minValue(-90), v.maxValue(90))),
  lon: v.nullable(v.pipe(v.number(), v.minValue(-180), v.maxValue(180))),
  elevationM: v.nullable(v.number()),
  utcOffsetMin: v.pipe(v.number(), v.integer(), v.minValue(-14 * 60), v.maxValue(14 * 60)),
  timestepMin: v.literal(30),
  ecosystem: nonEmpty,
  description: nonEmpty,
  comment: v.nullable(v.string()),
});

export const SourceSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.regex(/^[a-z0-9_]+$/, 'id must be lower-case letters, digits and underscores')),
    site: v.picklist(SITE_CODES),
    path: v.pipe(nonEmpty, v.check((p) => existsSync(p), 'file does not exist')),
    delim: v.picklist([',', ';']),
    headerLines: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2)),
    decimalComma: v.boolean(),
    encoding: v.optional(v.picklist(['utf-8', 'latin-1'])),
    timestampColumn: nonEmpty,
    timestampFormats: v.pipe(v.array(nonEmpty), v.minLength(1)),
    timestampIsEnd: v.boolean(),
    stepMin: v.picklist([5, 10, 15, 30]),
    rank: v.pipe(v.number(), v.integer(), v.minValue(1)),
    aggregate: v.optional(v.object({ method: v.literal('mean'), minCount: v.pipe(v.number(), v.integer(), v.minValue(1)) })),
    columns: v.object(Object.fromEntries(ALL_COLUMNS.map((c) => [c, v.optional(ColumnMapSchema)]))),
  }),
  v.check((s) => Object.keys(s.columns).length > 0, 'a source needs at least one column mapping'),
  v.check((s) => s.stepMin === 30 || s.aggregate !== undefined, 'a source with a step below 30 min needs an aggregate rule'),
);

export const RegistrySchema = v.pipe(
  v.object({ sites: v.pipe(v.array(SiteSchema), v.minLength(1)), sources: v.pipe(v.array(SourceSchema), v.minLength(1)) }),
  v.check((r) => new Set(r.sites.map((s) => s.siteId)).size === r.sites.length, 'site ids must be unique'),
  v.check((r) => new Set(r.sites.map((s) => s.code)).size === r.sites.length, 'site codes must be unique'),
  v.check((r) => new Set(r.sources.map((s) => s.id)).size === r.sources.length, 'source ids must be unique'),
  v.check((r) => r.sources.every((s) => r.sites.some((site) => site.code === s.site)), 'every source must point to a registered site'),
);

export type Registry = v.InferOutput<typeof RegistrySchema>;
export type Site = Registry['sites'][number];
export type Source = Registry['sources'][number];

/** The header of a source file must hold every column the mapping uses. */
export function headerSchema(expected: string[]) {
  return v.pipe(
    v.array(v.string()),
    v.check(
      (names) => expected.every((e) => names.includes(e)),
      (issue) => `header lacks the columns: ${expected.filter((e) => !(issue.input as string[]).includes(e)).join(', ')}`,
    ),
  );
}

const HALF_HOUR_MICROS = 30n * 60n * 1_000_000n;
const range = (min: number, max: number) => v.nullable(v.pipe(v.number(), v.finite(), v.minValue(min), v.maxValue(max)));

/** One output row, in the column order of the observations table. */
export const OBSERVATION_COLUMNS = ['site_id', 'ts_start', ...ALL_COLUMNS] as const;
export const ObservationRowSchema = v.strictTuple([
  v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(255)),
  v.pipe(
    v.instance(DuckDBTimestampValue),
    v.check((t) => t.micros % HALF_HOUR_MICROS === 0n, 'timestamp is not on a 30-minute boundary'),
  ),
  range(-100, 100), // nee
  range(-100, 100), // nee_f
  v.nullable(v.picklist([0, 1])), // nee_qc
  range(-60, 60), // ta
  range(-40, 60), // tsoil
  range(0, 1), // swc
  range(-50, 1500), // sw_in
  range(-50, 3000), // ppfd
  range(0, 105), // rh
  range(0, 100), // vpd
  range(0, 5), // ustar
  v.nullable(v.picklist([0, 1, 2])), // nee_ssitc
  range(-100, 100), // gpp_src
  range(-100, 100), // reco_src
  range(-10, 10), // ch4
]);

/** Physical range issues are warnings. Every other issue is an error. */
export function isRangeIssue(issue: v.BaseIssue<unknown>): boolean {
  return issue.kind === 'validation' && (issue.type === 'min_value' || issue.type === 'max_value');
}

const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const ColumnStatSchema = v.object({
  n_valid: count,
  min: v.nullable(v.number()),
  max: v.nullable(v.number()),
  mean: v.nullable(v.number()),
});

export const ReportSchema = v.object({
  builtAt: v.pipe(v.string(), v.isoTimestamp()),
  duckdb: nonEmpty,
  node: nonEmpty,
  outputs: v.array(v.object({ file: nonEmpty, rows: count, bytes: count })),
  sites: v.array(
    v.object({
      siteId: count,
      code: nonEmpty,
      name: nonEmpty,
      rows: count,
      gridRowsInserted: count,
      tsFirstUtc: nonEmpty,
      tsLastUtc: nonEmpty,
      columns: v.record(v.string(), v.object({ ...ColumnStatSchema.entries, conflicts: count, rangeWarnings: count })),
      years: v.array(v.object({ year: count, rows: count, columns: v.record(v.string(), ColumnStatSchema) })),
    }),
  ),
  sources: v.array(
    v.object({
      id: nonEmpty,
      site: nonEmpty,
      path: nonEmpty,
      physicalLines: count,
      headerLines: count,
      rowsRead: count,
      rowsRejected: count,
      linesSkippedByParser: count,
      duplicateStamps: count,
      rowsAfterAggregation: v.nullable(count),
      columns: v.record(v.string(), v.object({ n_valid: count, n_sentinel: count, n_zero_nulled: count, factor: v.nullable(v.number()) })),
    }),
  ),
  validation: v.object({
    rowsChecked: count,
    errors: count,
    warningsByColumn: v.record(v.string(), count),
  }),
});
export type Report = v.InferOutput<typeof ReportSchema>;
