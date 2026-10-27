// Tables and keys of the Deep Dive "Site-years in carbon space: annual GPP, Reco and the share of
// uptake days" (pages/deep-dive/carbon-space.mdx). Input: analysis/carbon-space/results.json
// (analysis/carbon-space/carbon-space.py). The figures are matplotlib SVG files of the same folder.
// Valibot checks the parts that the tables and the keys use; the schema is not strict, so the other
// parts of the JSON pass without a check.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';

const N = v.nullable(v.number());
const SITE = v.picklist(Object.keys(SITE_NAMES) as SiteCode[]);
const GROUPS = ['grassland', 'annual crop'] as const;

const Share = v.object({ days: v.number(), uptakeDays: v.number(), share: N });
const SiteYear = v.object({
  key: v.string(),
  site: SITE,
  siteName: v.string(),
  year: v.number(),
  crop: v.string(),
  group: v.picklist(GROUPS),
  cropLabel: v.nullable(v.string()),
  inFig1: v.boolean(),
  inFig2: v.boolean(),
  exclusionFig1: v.nullable(v.string()),
  exclusionFig2: v.nullable(v.string()),
  fracMeasured: v.number(),
  longestGapDays: v.number(),
  gpp: N,
  reco: N,
  nee: N,
  recoGppRatio: N,
  uptake: v.nullable(v.object({ year: Share, jja: Share })),
  events: v.object({
    harvest: v.number(),
    cut: v.number(),
    grazing: v.number(),
    tillage: v.number(),
    sowing: v.number(),
    fertilisation: v.number(),
    spraying: v.number(),
    other: v.number(),
  }),
  eventsTotal: v.number(),
});
const Excluded = v.object({ key: v.string(), site: SITE, siteName: v.string(), year: v.number(), reason: v.string(), inFig2: v.boolean() });
const Stat = v.object({ n: v.number(), mean: v.number(), sd: v.number(), min: v.number(), max: v.number() });
const Group = v.object({
  fig1SiteYears: v.array(v.string()),
  fig2SiteYears: v.array(v.string()),
  nee: Stat,
  recoGppRatio: Stat,
  uptakeYear: Stat,
  uptakeJja: Stat,
});
const Fit = v.object({ slope: v.number(), intercept: v.number(), r: v.number(), r2: v.number(), n: v.number() });

const DataSchema = v.object({
  method: v.object({ minFrac: v.number(), maxGapDays: v.number(), jjaMonths: v.array(v.number()) }),
  siteYears: v.array(SiteYear),
  fig1Keys: v.array(v.string()),
  fig2Keys: v.array(v.string()),
  excluded: v.array(Excluded),
  regression: v.object({ all: Fit, withoutMaktau: Fit }),
  groups: v.object({ grassland: Group, 'annual crop': Group, 'annual crop without Maktau': Group }),
  summary: v.object({
    nFig1: v.number(),
    nFig2: v.number(),
    nSink: v.number(),
    nSource: v.number(),
    minNee: v.string(),
    maxNee: v.string(),
  }),
  figures: v.array(v.object({ n: v.number(), file: v.string(), title: v.string(), desc: v.string() })),
  dataVersion: v.object({
    inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number(), columns: v.array(v.string()) })),
    snapshot: v.object({ builtAt: v.string(), calcBuiltAt: v.nullable(v.string()), url: v.nullable(v.string()) }),
  }),
});

export type CarbonSpaceData = v.InferOutput<typeof DataSchema>;
type SiteYearOut = v.InferOutput<typeof SiteYear>;

/** Check the JSON and the agreement of the key lists, the flags and the counts. */
export function carbonSpaceData(raw: unknown): CarbonSpaceData {
  const d = v.parse(DataSchema, raw);
  const byKey = new Map(d.siteYears.map((s) => [s.key, s]));
  const check = (keys: string[], flag: 'inFig1' | 'inFig2', n: number) => {
    const flagged = d.siteYears.filter((s) => s[flag]).map((s) => s.key);
    if (flagged.join('|') !== keys.join('|') || keys.length !== n) {
      throw new Error(`carbon-space: ${flag} of siteYears does not agree with the key list or the summary count`);
    }
  };
  check(d.fig1Keys, 'inFig1', d.summary.nFig1);
  check(d.fig2Keys, 'inFig2', d.summary.nFig2);
  for (const k of d.fig2Keys) {
    const s = byKey.get(k)!;
    if (s.uptake?.year.share == null || s.uptake.jja.share === null) throw new Error(`carbon-space: ${k} is in Figure 2 without uptake shares`);
  }
  for (const e of d.excluded) {
    const s = byKey.get(e.key);
    if (!s || s.inFig1) throw new Error(`carbon-space: excluded site-year ${e.key} is unknown or in Figure 1`);
  }
  if (d.excluded.length !== d.siteYears.length - d.fig1Keys.length) {
    throw new Error('carbon-space: the excluded list does not hold all site-years that are not in Figure 1');
  }
  for (const k of d.fig1Keys) {
    const s = byKey.get(k)!;
    if (s.gpp === null || s.reco === null || s.nee === null || s.uptake?.year.share == null || s.uptake.jja.share === null) throw new Error(`carbon-space: ${k} is in Figure 1 without annual sums`);
  }
  return d;
}

// ---------- Keys for <Num k="…" /> ----------

/** Dotted path of one site-year, for example `siteYears.5`. */
export function syKey(d: CarbonSpaceData, key: string): string {
  const i = d.siteYears.findIndex((s) => s.key === key);
  if (i < 0) throw new Error(`carbon-space: no site-year ${key}`);
  return `siteYears.${i}`;
}

/** "Haltiala 2023 grass (failed)" or "Qvidja 2022": the site name, the year and the crop label. */
export function syLabel(d: CarbonSpaceData, key: string): string {
  const s = d.siteYears.find((x) => x.key === key);
  if (!s) throw new Error(`carbon-space: no site-year ${key}`);
  return `${s.siteName} ${s.year}${s.cropLabel ? ` ${s.cropLabel}` : ''}`;
}

/** Site-year labels as "Qvidja 2022, Qvidja 2023 and Qvidja 2024". */
export function listText(d: CarbonSpaceData, keys: readonly string[]): string {
  const names = keys.map((k) => syLabel(d, k));
  return names.length <= 1 ? (names[0] ?? 'none') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The site-years of Figure 1 with NEE > 0 (net source), as "Qvidja 2022, Qvidja 2023 and …". */
export function sourceList(d: CarbonSpaceData, site?: SiteCode): string {
  const keys = d.fig1Keys.filter((k) => {
    const s = d.siteYears.find((x) => x.key === k)!;
    return (s.nee ?? 0) > 0 && (!site || s.site === site);
  });
  return listText(d, keys);
}

/** Number of Figure 1 site-years of one site. */
export function fig1Count(d: CarbonSpaceData, site: SiteCode): number {
  return d.fig1Keys.filter((k) => d.siteYears.find((x) => x.key === k)!.site === site).length;
}

// ---------- Rows ----------

const dash = '–';
const f0 = (x: number | null) => (x === null ? dash : fmtNum(x, 0));
const f2 = (x: number | null) => (x === null ? dash : fmtNum(x, 2));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x * 100, 0));

export interface SiteYearRow {
  id: string;
  site: string;
  year: number;
  crop: string;
  gpp: string;
  reco: string;
  nee: string;
  ratio: string;
  uptakeYear: string;
  uptakeJja: string;
  frac: string;
  harvestCut: number;
  grazing: number;
  tillage: number;
  sowing: number;
  fertilisation: number;
  other: number;
  figures: string;
}

function siteYearRow(s: SiteYearOut): SiteYearRow {
  const e = s.events;
  return {
    id: `sy-${s.key}`,
    site: s.siteName,
    year: s.year,
    crop: s.crop,
    gpp: f0(s.gpp),
    reco: f0(s.reco),
    nee: f0(s.nee),
    ratio: f2(s.recoGppRatio),
    uptakeYear: pct(s.uptake?.year.share),
    uptakeJja: pct(s.uptake?.jja.share),
    frac: f2(s.fracMeasured),
    harvestCut: e.harvest + e.cut,
    grazing: e.grazing,
    tillage: e.tillage,
    sowing: e.sowing,
    fertilisation: e.fertilisation,
    other: e.spraying + e.other,
    figures: s.inFig1 ? '1 and 2' : '2',
  };
}

/** The site-years of Figure 2 (Figure 1 is a subset), in the site order of db/sites.parquet. */
export function siteYearRows(d: CarbonSpaceData): SiteYearRow[] {
  return d.fig2Keys.map((k) => siteYearRow(d.siteYears.find((s) => s.key === k)!));
}

export interface ExcludedRow {
  id: string;
  site: string;
  year: number;
  reason: string;
  figure2: string;
  frac: string;
  gap: string;
}

/** The site-years that are not in Figure 1, with the reason; "yes" when the site-year is in Figure 2. */
export function excludedRows(d: CarbonSpaceData): ExcludedRow[] {
  return d.excluded.map((e) => {
    const s = d.siteYears.find((x) => x.key === e.key)!;
    return {
      id: `excluded-${e.key}`,
      site: e.siteName,
      year: e.year,
      reason: e.reason,
      figure2: e.inFig2 ? 'yes' : 'no',
      frac: fmtNum(s.fracMeasured, 3),
      gap: fmtNum(s.longestGapDays, 0),
    };
  });
}

export interface InputRow {
  path: string;
  sha256: string;
  rows: string;
  columns: string;
}

/** The input files of the snapshot with their SHA-256, row count and the columns read (for "Reproduce"). */
export function inputRows(d: CarbonSpaceData): InputRow[] {
  return d.dataVersion.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0), columns: i.columns.join(', ') }));
}
