// Valibot schemas of scripts/calc.ts: CLI options, management rows, report.

import * as v from 'valibot';

const nonEmpty = v.pipe(v.string(), v.nonEmpty());
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const maybeNumber = v.nullable(v.number());

export const SITE_CODES = ['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki', 'maktau'] as const;

export const OptionsSchema = v.object({
  sites: v.nullable(v.pipe(v.array(v.picklist(SITE_CODES)), v.minLength(1))),
  yearFrom: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100))),
  yearTo: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100))),
  ustar: v.picklist(['fixed', 'mpt']),
  temp: v.picklist(['ta', 'tsoil']),
  gppNight: v.picklist(['keep', 'zero']),
  out: nonEmpty,
});
export type Options = v.InferOutput<typeof OptionsSchema>;

export const ManagementRowSchema = v.pipe(
  v.object({
    site: v.picklist(SITE_CODES),
    date: v.pipe(v.string(), v.isoDate()),
    action: v.picklist(['harvest', 'fertilisation', 'grazing']),
    product: nonEmpty,
    fresh_kg_ha: v.nullable(v.pipe(v.number(), v.minValue(0))),
    dm_fraction: v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
    dry_mass_kg_ha: v.nullable(v.pipe(v.number(), v.minValue(0))),
    c_fraction: v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(0.6))),
    c_fraction_source: v.picklist(['site', 'assumed', 'none']),
    c_g_m2: v.nullable(v.pipe(v.number(), v.minValue(0))),
    source: nonEmpty,
    note: v.string(),
  }),
  v.check((r) => r.c_fraction_source !== 'none' || r.c_fraction === null, 'c_fraction_source none needs c_fraction null'),
  v.check((r) => r.action !== 'harvest' || r.c_fraction !== null, 'a harvest row needs a c_fraction'),
);

export const ReportSchema = v.object({
  builtAt: v.pipe(v.string(), v.isoTimestamp()),
  duckdb: nonEmpty,
  node: nonEmpty,
  options: OptionsSchema,
  constants: v.record(v.string(), v.unknown()),
  outputs: v.array(v.object({ file: nonEmpty, rows: count, bytes: count })),
  partition: v.array(
    v.object({
      site: nonEmpty,
      year: count,
      nNight: count,
      e0: maybeNumber,
      e0Se: maybeNumber,
      e0Method: nonEmpty,
      e0WindowsTried: count,
      e0WindowsValid: count,
      rrefWindowsUsed: count,
      rrefMin: maybeNumber,
      rrefMax: maybeNumber,
      rowsReco: count,
      rowsFqc2: count,
      tempFilled: count,
    }),
  ),
  maktau: v.nullable(
    v.object({
      ustarThreshold: v.number(),
      filter: v.record(v.string(), count),
      mpt: v.array(v.object({ year: count, threshold: maybeNumber, bounded: maybeNumber, seasons: v.array(v.object({ season: count, nNight: count, threshold: maybeNumber })) })),
      mds: v.record(v.string(), count),
      fillRange: v.object({ from: nonEmpty, to: nonEmpty }),
    }),
  ),
  warnings: v.array(v.string()),
});
export type Report = v.InferOutput<typeof ReportSchema>;
