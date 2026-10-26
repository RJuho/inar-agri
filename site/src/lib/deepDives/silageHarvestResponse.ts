// Tables and keys of the Deep Dive "Silage harvest and grassland CO₂ fluxes: GPP, TER and NEE
// around the cut" (pages/deep-dive/silage-harvest-response.mdx). Input:
// analysis/silage-harvest-response/results.json (analysis/silage-harvest-response/silage-harvest-response.py).
// The figures are matplotlib SVG files of the same folder. Valibot checks the parts that the
// tables and the keys use.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';

const N = v.nullable(v.number());
const S = v.nullable(v.string());
const SITE = v.picklist(Object.keys(SITE_NAMES) as SiteCode[]);
const PANEL_SITES = ['anttila', 'sarkisuo', 'qvidja', 'viikki'] as const;
type PanelSite = (typeof PANEL_SITES)[number];
const FLUXES = ['gpp', 'reco', 'nee'] as const;
type Flux = (typeof FLUXES)[number];

const Side = v.object({
  nDays: v.object({ nee: v.number(), gpp: v.number(), reco: v.number(), frac: v.number() }),
  mean: v.object({ nee: N, gpp: N, reco: N, frac: N }),
});
const Delta = v.object({ gpp: N, reco: N, nee: N });

const Episode = v.object({
  id: v.string(),
  site: SITE,
  year: v.number(),
  cutNo: v.number(),
  start: v.string(),
  end: v.string(),
  recorded: v.string(),
  durationDays: v.number(),
  crop: S,
  detailShort: v.string(),
  yieldKgHa: N,
  yearYieldKgHa: N,
  overrides: v.array(v.string()),
  fertInWindow: v.boolean(),
  before: Side,
  after: Side,
  late: v.nullable(Side),
  delta: Delta,
  relPct: Delta,
  used: v.boolean(),
  exclusion: S,
  recovery: v.object({ sharePct: N, days: N, censored: v.boolean(), reason: S, nextDisturbanceDays: N }),
  timing: v.object({
    used: v.boolean(),
    exclusion: S,
    gpp: v.object({ detectedDate: S, offset: N, drop: N, dropPct: N, before: N, clear: v.boolean(), reason: S }),
    preDrop: v.object({ near: N, far: N, pct: N }),
  }),
  flags: v.object({ establishmentYear: v.boolean(), partialHarvest: v.boolean(), note: S }),
});

/** Summary statistics of one quantity (n, mean, SD, median, range, bootstrap interval). */
const Stat = v.object({
  n: v.number(),
  mean: N,
  sd: N,
  median: N,
  min: N,
  max: N,
  ciLo: N,
  ciHi: N,
  nNegative: v.number(),
  nZero: v.number(),
  nPositive: v.number(),
});

const SummaryBlock = v.object({
  n: v.number(),
  ids: v.array(v.string()),
  deltaGpp: Stat,
  deltaReco: Stat,
  deltaNee: Stat,
  relGpp: Stat,
  relReco: Stat,
  relNee: Stat,
  gppBefore: N,
  recoveryShare: Stat,
  daysToRecover: Stat,
  gppOffset: Stat,
  preDropPct: Stat,
  nRecovered: v.number(),
  nCensored: v.number(),
  censored: v.object({ blocked: v.number(), 'data-end': v.number(), 'max-days': v.number() }),
  timingUsed: v.number(),
  clearDrops: v.number(),
  nBefore: v.number(),
  nOn: v.number(),
  nAfter: v.number(),
  fertInWindow: v.number(),
});

const Curve = v.object({
  mean: v.array(N),
  sd: v.array(N),
  n: v.array(v.number()),
  meanDays1to14: N,
  meanDays15to28: N,
  minN: v.number(),
  maxN: v.number(),
});
const CompositeBlock = v.object({ episodes: v.number(), ids: v.array(v.string()), gpp: Curve, reco: Curve, nee: Curve });

const DataSchema = v.object({
  method: v.object({
    mergeDays: v.number(),
    beforeDays: v.tuple([v.number(), v.number()]),
    afterDays: v.tuple([v.number(), v.number()]),
    lateDays: v.tuple([v.number(), v.number()]),
    windowDays: v.number(),
    minDays: v.number(),
    minFracPct: v.number(),
    minGppBefore: v.number(),
    recoverySharePct: v.number(),
    recoveryMaxDays: v.number(),
    recoveryRunDays: v.number(),
    recoveryMinRun: v.number(),
    searchFrom: v.number(),
    searchTo: v.number(),
    sideDays: v.number(),
    minSideGpp: v.number(),
    minBeforeGpp: v.number(),
    minDropPct: v.number(),
    spanOverlapFrom: v.number(),
    spanOverlapTo: v.number(),
    preNear: v.tuple([v.number(), v.number()]),
    preFar: v.tuple([v.number(), v.number()]),
    preMinNear: v.number(),
    preMinFar: v.number(),
    compositeFrom: v.number(),
    compositeTo: v.number(),
    compositeMinN: v.number(),
    yStep: v.number(),
    bootstrapResamples: v.number(),
    ciLevelPct: v.number(),
    utcShiftHours: v.number(),
    grainRegex: v.string(),
    grassRegex: v.string(),
    overrides: v.array(v.object({ site: SITE, date: v.string(), text: v.string() })),
  }),
  counts: v.object({
    silageEpisodes: v.number(),
    used: v.number(),
    excluded: v.object({ overlap: v.number(), 'too-few-days': v.number(), 'low-measured-fraction': v.number() }),
    overrides: v.number(),
    timingUsed: v.number(),
    clearDrops: v.number(),
  }),
  sites: v.array(v.object({ code: v.picklist(PANEL_SITES), name: v.string(), episodes: v.number(), used: v.number(), usedIds: v.array(v.string()) })),
  episodes: v.array(Episode),
  composite: v.object({
    offsets: v.array(v.number()),
    yRange: v.tuple([v.number(), v.number()]),
    yRangeAbs: v.tuple([v.number(), v.number()]),
    perSite: v.object({ anttila: CompositeBlock, sarkisuo: CompositeBlock, qvidja: CompositeBlock, viikki: CompositeBlock }),
    all: CompositeBlock,
    allAbs: CompositeBlock,
  }),
  summary: v.object({
    perSite: v.object({ anttila: SummaryBlock, sarkisuo: SummaryBlock, qvidja: SummaryBlock, viikki: SummaryBlock }),
    all: SummaryBlock,
  }),
  figures: v.array(v.object({ n: v.number(), file: v.string(), title: v.string(), desc: v.string() })),
  dataVersion: v.object({
    inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number(), columns: v.array(v.string()) })),
    snapshot: v.object({ builtAt: v.string(), calcBuiltAt: v.nullable(v.string()), url: v.nullable(v.string()) }),
  }),
});

export type SilageData = v.InferOutput<typeof DataSchema>;
type EpisodeOut = v.InferOutput<typeof Episode>;
type StatOut = v.InferOutput<typeof Stat>;
type SummaryOut = v.InferOutput<typeof SummaryBlock>;
/** `all` = all used episodes as a fraction of the GPP before; `allAbs` = the same in g C m⁻² d⁻¹. */
export type CompositeKey = PanelSite | 'all' | 'allAbs';

export function silageData(raw: unknown): SilageData {
  const d = v.parse(DataSchema, raw);
  if (d.composite.offsets.length !== d.composite.all.gpp.mean.length) {
    throw new Error('silage-harvest-response: composite offsets and curves have different lengths');
  }
  return d;
}

// ---------- Keys for <Num k="…" /> ----------

/** Dotted path of one episode, for example `episodes.14`. */
export function epKey(d: SilageData, id: string): string {
  const i = d.episodes.findIndex((e) => e.id === id);
  if (i < 0) throw new Error(`silage-harvest-response: no episode ${id}`);
  return `episodes.${i}`;
}

// ---------- Number text ----------

const dash = '–';
const f0 = (x: number | null) => (x === null ? dash : fmtNum(x, 0));
const f0s = (x: number | null) => (x === null ? dash : fmtNum(x, 0, { sign: true }));
const f1s = (x: number | null) => (x === null ? dash : fmtNum(x, 1, { sign: true }));
const f2 = (x: number | null) => (x === null ? dash : fmtNum(x, 2));
const f2s = (x: number | null) => (x === null ? dash : fmtNum(x, 2, { sign: true }));

/**
 * "−4.56 ± 3.12 [−5.89, −3.26]" when n is 3 or more (mean, sample SD, bootstrap interval);
 * the two values when n = 2; the value when n = 1; a dash when n = 0.
 */
export function statText(s: StatOut, fmt: (x: number | null) => string): string {
  if (s.n === 0 || s.mean === null) return dash;
  if (s.n === 1) return fmt(s.mean);
  if (s.n === 2) return `${fmt(s.min)} and ${fmt(s.max)}`;
  const sd = s.sd === null ? dash : fmt(s.sd).replace(/^\+/, '');
  return `${fmt(s.mean)} ± ${sd} [${fmt(s.ciLo)}, ${fmt(s.ciHi)}]`;
}

/** Short text of an exclusion reason; the table caption explains the rules. */
const EXCLUSION_TEXT: Record<string, string> = {
  overlap: 'not used: overlap',
  'too-few-days': 'not used: too few days',
  'low-measured-fraction': 'not used: low measured fraction',
};

const CENSOR_TEXT = (d: SilageData): Record<string, string> => ({
  blocked: 'censored: next disturbance first',
  'data-end': 'censored: data end',
  'max-days': `censored: not reached in ${fmtNum(d.method.recoveryMaxDays, 0)} days`,
});

const NOT_CLEAR_TEXT = (d: SilageData): Record<string, string> => ({
  'drop-too-small': `drop below ${fmtNum(d.method.minDropPct, 0)} %`,
  'flux-too-small': `GPP before below ${fmtNum(d.method.minBeforeGpp, 0)} g C m⁻² d⁻¹`,
  'too-few-days': 'too few days with GPP',
});

// ---------- Rows ----------

export interface InputRow {
  path: string;
  sha256: string;
  rows: string;
  columns: string;
}

/** The input files of the snapshot with their SHA-256, row count and the columns read (for "Reproduce"). */
export function inputRows(d: SilageData): InputRow[] {
  return d.dataVersion.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0), columns: i.columns.join(', ') }));
}

export interface EpisodeRow {
  id: string;
  site: string;
  dates: string;
  cutNo: string;
  detail: string;
  yieldKgHa: string;
  use: string;
  gppBefore: string;
  dGpp: string;
  dReco: string;
  dNee: string;
  relGpp: string;
  relReco: string;
  relNee: string;
  recoveryShare: string;
  daysToRecover: string;
  offset: string;
  preDrop: string;
  flag: string;
}

function recoveryText(d: SilageData, e: EpisodeOut): string {
  const r = e.recovery;
  if (r.days !== null) return fmtNum(r.days, 0);
  if (r.censored) return CENSOR_TEXT(d)[r.reason ?? ''] ?? `censored: ${r.reason ?? ''}`;
  return dash;
}

function offsetText(d: SilageData, e: EpisodeOut): string {
  const t = e.timing;
  if (!t.used) return NOT_CLEAR_TEXT(d)[t.gpp.reason ?? ''] ?? (t.exclusion ?? dash);
  if (t.gpp.offset === null) return NOT_CLEAR_TEXT(d)[t.gpp.reason ?? ''] ?? dash;
  const off = `${f0s(t.gpp.offset)} d`;
  return t.gpp.clear ? off : `not clear (${NOT_CLEAR_TEXT(d)[t.gpp.reason ?? ''] ?? t.gpp.reason ?? ''}): ${off}`;
}

function flagText(e: EpisodeOut): string {
  const f: string[] = [];
  if (e.flags.establishmentYear) f.push('establishment year');
  if (e.flags.partialHarvest) f.push('partial harvest');
  if (e.overrides.length) f.push('override');
  return f.length ? f.join('; ') : dash;
}

/** All silage harvest episodes, in the site order of db/sites.parquet, then by date. */
export function episodeRows(d: SilageData): EpisodeRow[] {
  const order = d.sites.map((s) => s.code as string);
  const excl = EXCLUSION_TEXT;
  return [...d.episodes]
    .sort((a, b) => order.indexOf(a.site) - order.indexOf(b.site) || a.start.localeCompare(b.start))
    .map((e) => ({
      id: e.id,
      site: SITE_NAMES[e.site],
      dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
      cutNo: fmtNum(e.cutNo, 0),
      detail: e.crop ?? e.detailShort,
      yieldKgHa: e.yieldKgHa !== null ? fmtNum(e.yieldKgHa, 0) : e.yearYieldKgHa !== null ? `year: ${fmtNum(e.yearYieldKgHa, 0)}` : dash,
      use: e.used ? 'used' : (excl[e.exclusion ?? ''] ?? `not used: ${e.exclusion ?? ''}`),
      gppBefore: f2(e.before.mean.gpp),
      dGpp: f2s(e.delta.gpp),
      dReco: f2s(e.delta.reco),
      dNee: f2s(e.delta.nee),
      relGpp: f0s(e.relPct.gpp),
      relReco: f0s(e.relPct.reco),
      relNee: f0s(e.relPct.nee),
      recoveryShare: f0(e.recovery.sharePct),
      daysToRecover: recoveryText(d, e),
      offset: offsetText(d, e),
      preDrop: f0s(e.timing.preDrop.pct),
      flag: flagText(e),
    }));
}

export interface SummaryRow {
  id: string;
  group: string;
  n: string;
  gppBefore: string;
  dGpp: string;
  dReco: string;
  dNee: string;
  relGpp: string;
  relReco: string;
  relNee: string;
  recoveryShare: string;
  daysToRecover: string;
  offset: string;
  split: string;
  preDrop: string;
}

function summaryRow(id: string, group: string, s: SummaryOut): SummaryRow {
  const pct = (x: StatOut) => statText(x, f0s);
  return {
    id: `summary-${id}`,
    group,
    n: fmtNum(s.n, 0),
    gppBefore: f2(s.gppBefore),
    dGpp: statText(s.deltaGpp, f2s),
    dReco: statText(s.deltaReco, f2s),
    dNee: statText(s.deltaNee, f2s),
    relGpp: pct(s.relGpp),
    relReco: pct(s.relReco),
    relNee: pct(s.relNee),
    recoveryShare: `${statText(s.recoveryShare, f0)} (n = ${fmtNum(s.recoveryShare.n, 0)})`,
    daysToRecover: `${statText(s.daysToRecover, f0)} (${fmtNum(s.nRecovered, 0)} recovered, ${fmtNum(s.nCensored, 0)} censored)`,
    offset: `${statText(s.gppOffset, f1s)}; median ${s.gppOffset.median === null ? dash : f0s(s.gppOffset.median)} (${fmtNum(s.clearDrops, 0)} clear of ${fmtNum(s.timingUsed, 0)})`,
    split: `${fmtNum(s.nBefore, 0)} / ${fmtNum(s.nOn, 0)} / ${fmtNum(s.nAfter, 0)}`,
    preDrop: pct(s.preDropPct),
  };
}

/** One row per site and one row for all used episodes. */
export function summaryRows(d: SilageData): SummaryRow[] {
  const rows = d.sites.map((s) => summaryRow(s.code, SITE_NAMES[s.code], d.summary.perSite[s.code]));
  rows.push(summaryRow('all', 'All sites', d.summary.all));
  return rows;
}

export interface CompositeRow {
  id: string;
  day: string;
  gpp: string;
  gppN: string;
  reco: string;
  recoN: string;
  nee: string;
  neeN: string;
}

function compositeBlock(d: SilageData, block: CompositeKey) {
  if (block === 'all') return d.composite.all;
  if (block === 'allAbs') return d.composite.allAbs;
  return d.composite.perSite[block];
}

/** The composite curve of one site or of all sites, one row per day from the last day of the harvest. */
export function compositeRows(d: SilageData, block: CompositeKey): CompositeRow[] {
  const c = compositeBlock(d, block);
  // Fractions with 2 decimals, g C m⁻² d⁻¹ with 1 decimal.
  const digits = block === 'allAbs' ? 1 : 2;
  // "mean ± SD" of the episodes on that day; empty when fewer than compositeMinN episodes have a value.
  const cell = (f: Flux, i: number) => {
    const m = c[f].mean[i];
    const s = c[f].sd[i];
    if (m === null || m === undefined) return '';
    return s === null || s === undefined ? fmtNum(m, digits) : `${fmtNum(m, digits)} ± ${fmtNum(s, digits)}`;
  };
  const nOf = (f: Flux, i: number) => fmtNum(c[f].n[i] ?? 0, 0);
  return d.composite.offsets.map((day, i) => ({
    id: `composite-${block}-${day < 0 ? `m${-day}` : day}`,
    day: f0s(day),
    gpp: cell('gpp', i),
    gppN: nOf('gpp', i),
    reco: cell('reco', i),
    recoN: nOf('reco', i),
    nee: cell('nee', i),
    neeN: nOf('nee', i),
  }));
}

/** Label of a composite block: the site name with n, or "All sites (n = 20)". */
export function compositeLabel(d: SilageData, block: CompositeKey): string {
  const c = compositeBlock(d, block);
  const name = block === 'all' ? 'All sites' : block === 'allAbs' ? 'All sites, g C m⁻² d⁻¹' : SITE_NAMES[block];
  return `${name} (n = ${fmtNum(c.episodes, 0)})`;
}

/** The five override texts of Deep Dive #4, with the site name and the date. */
export function overrideTexts(d: SilageData): string[] {
  return d.method.overrides.map((o) => `${SITE_NAMES[o.site]} ${o.date}: ${o.text}`);
}

export { PANEL_SITES };
