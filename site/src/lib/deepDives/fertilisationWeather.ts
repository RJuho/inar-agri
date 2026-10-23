// Tables of the Deep Dive "Fertilisation and GPP: more change than the weather explains?"
// (pages/deep-dive/fertilisation-weather.mdx). Input: analysis/fertilisation-weather/results.json
// (analysis/fertilisation-weather/fertilisation-weather.py). The figures are matplotlib SVG files
// of the same folder. Valibot checks the parts that the tables use.
import * as v from 'valibot';
import { fmtNum } from '../deepDive';

const N = v.nullable(v.number());
const Summary = v.object({ n: v.number(), mean: N, sd: N, min: N, max: N, ciLo: N, ciHi: N, nPositive: v.number() });
const Fit = v.nullable(v.object({ coef: v.array(v.number()), residSd: v.number(), r2: v.number(), n: v.number() }));
const SITE = v.picklist(['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki']);
const Means = v.object({
  nDays: v.record(v.string(), v.number()),
  mean: v.record(v.string(), N),
});

const Episode = v.object({
  id: v.string(),
  site: SITE,
  siteName: v.string(),
  start: v.string(),
  end: v.string(),
  kind: v.string(),
  fert: v.string(),
  product: v.string(),
  coEvents: v.array(v.object({ date: v.string(), type: v.string(), detail: v.string() })),
  withHarvest: v.boolean(),
  withTillage: v.boolean(),
  nKgHa: N,
  before: Means,
  after: Means,
  delta: v.record(v.string(), N),
  rain14: N,
  lightPct: N,
  observed: N,
  expected: N,
  residual: N,
  residualRank: N,
  rawRank: N,
  nControls: v.number(),
  matched: v.object({ n: v.number(), controlDelta: N, diff: N }),
  lightNorm: v.object({ before: N, after: N, delta: N, pct: N }),
  residualSwc: N,
  residual10: N,
  residualRank10: N,
  fluxUsed: v.boolean(),
  fluxExclusion: v.nullable(v.string()),
  inSummary: v.boolean(),
});

const Controls = v.object({
  nPairs: v.number(),
  nYears: v.number(),
  years: v.array(v.number()),
  rTaLight: N,
  collinear: v.boolean(),
  fit: Fit,
  fitSwc: Fit,
  fitTa: v.object({ n: v.number(), slope: N, intercept: N, r: N, p: N }),
  fitLight: v.object({ n: v.number(), slope: N, intercept: N, r: N, p: N }),
  sensitivity10: v.object({ nPairs: v.number(), fit: Fit }),
  residualQuantiles: v.nullable(v.object({ p10: v.number(), p90: v.number() })),
});

const Split = v.object({
  n: v.number(),
  sites: v.record(v.string(), v.number()),
  observed: Summary,
  expected: Summary,
  residual: Summary,
  residualRank: Summary,
  matchedDiff: Summary,
  lightNormPct: Summary,
  residualSwc: Summary,
  residual10: Summary,
  nResidualAbove90: v.number(),
  nResidualBelow10: v.number(),
  nRawAbove90: v.number(),
  nMatched: v.number(),
});

const DataSchema = v.object({
  method: v.object({
    light: v.record(v.string(), v.object({ lightVar: v.string(), lightUnit: v.string(), rainSource: v.string() })),
    minMatched: v.number(),
    rankHigh: v.number(),
    rankLow: v.number(),
    controlHalfWidth: v.number(),
    controlHalfWidthSens: v.number(),
  }),
  controls: v.record(v.string(), Controls),
  summary: v.record(v.string(), Split),
  episodes: v.array(Episode),
  dataVersion: v.object({
    snapshot: v.object({
      builtAt: v.string(),
      calcBuiltAt: v.nullable(v.string()),
      url: v.nullable(v.string()),
      inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number() })),
    }),
  }),
});

export type FertData = v.InferOutput<typeof DataSchema>;
type SummaryOut = v.InferOutput<typeof Summary>;

export function fertilisationWeatherData(raw: unknown): FertData {
  return v.parse(DataSchema, raw);
}

const dash = '–';
const f0 = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 0));
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 2));
const f3 = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 3));
const f0s = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 0, { sign: true }));
const f1s = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 1, { sign: true }));
const f2s = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 2, { sign: true }));
const f3s = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 3, { sign: true }));

/** "+3.71 ± 2.01 [2.68, 4.74]"; the interval only with three or more values, the SD only with two or more. */
function meanText(s: SummaryOut, fmt: (x: number | null) => string, withCi = true): string {
  if (s.n === 0 || s.mean === null) return dash;
  let t = fmt(s.mean);
  if (s.n >= 2 && s.sd !== null) t += ` ± ${fmt(s.sd).replace(/^\+/, '')}`;
  if (withCi && s.n >= 3 && s.ciLo !== null && s.ciHi !== null) t += ` [${fmt(s.ciLo)}, ${fmt(s.ciHi)}]`;
  return t;
}

const KIND_TEXT: Record<string, string> = {
  fertilisation: 'fertilisation',
  tillageFert: 'fertilisation with tillage',
  harvestCutFert: 'fertilisation with harvest or cut',
};
const EXCLUSION_TEXT: Record<string, string> = {
  overlap: 'not used: another episode starts in a window (rule 1)',
  'too-few-days': 'not used: too few days with fluxes (rule 2)',
  'low-measured-fraction': 'not used: measured fraction too low (rule 3)',
};
const SITE_ORDER = ['haltiala', 'qvidja', 'viikki', 'anttila', 'sarkisuo'] as const;
const SPLIT_LABEL: Record<string, string> = {
  all: 'All episodes in the summaries',
  fertOnly: 'Fertilisation only',
  withTillage: 'With tillage or sowing',
  mineral: 'Mineral product',
  organic: 'Organic product',
};

export interface EpisodeRow {
  id: string;
  site: string;
  dates: string;
  kind: string;
  product: string;
  withText: string;
  n: string;
  dTa: string;
  dLight: string;
  dRain: string;
  dSwc: string;
  observed: string;
  expected: string;
  residual: string;
  residualRank: string;
  rawRank: string;
  matched: string;
  lightNorm: string;
  fluxUse: string;
  inSummary: string;
}

/** All fertilisation episodes, sites with a fit first, then by date. */
export function episodeRows(d: FertData): EpisodeRow[] {
  const order = (s: string) => SITE_ORDER.indexOf(s as (typeof SITE_ORDER)[number]);
  const rows = [...d.episodes].sort((a, b) => order(a.site) - order(b.site) || a.start.localeCompare(b.start));
  return rows.map((e) => {
    const withParts = [e.withTillage ? 'tillage or sowing' : null, e.withHarvest ? 'harvest or cut' : null].filter(Boolean);
    const proxy = d.method.light[e.site]?.rainSource === 'viikki-proxy' ? '*' : '';
    const notInSummary = !e.fluxUsed ? dash : e.withHarvest ? 'no: with harvest or cut' : e.residual === null ? 'no: no control fit' : 'no';
    return {
      id: e.id,
      site: e.siteName,
      dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
      kind: e.fert,
      product: e.product,
      withText: withParts.length ? withParts.join(', ') : dash,
      n: e.nKgHa === null ? dash : fmtNum(e.nKgHa, e.nKgHa % 1 === 0 ? 0 : 1),
      dTa: f1s(e.delta.ta),
      dLight: e.lightPct === null ? dash : `${f0s(e.lightPct)} %`,
      dRain: e.rain14 === null ? dash : `${f0s(e.rain14)}${proxy}`,
      dSwc: f3s(e.delta.swc),
      observed: f2s(e.observed),
      expected: f2s(e.expected),
      residual: f2s(e.residual),
      residualRank: f0(e.residualRank),
      rawRank: f0(e.rawRank),
      matched: e.nControls === 0 ? dash : e.matched.n >= d.method.minMatched ? `${e.matched.n}: ${f2s(e.matched.diff)}` : `${e.matched.n} (too few)`,
      lightNorm: e.lightNorm.pct === null ? dash : `${f0s(e.lightNorm.pct)} %`,
      fluxUse: e.fluxUsed ? 'used' : (EXCLUSION_TEXT[e.fluxExclusion ?? ''] ?? 'not used'),
      inSummary: e.inSummary ? 'yes' : notInSummary,
    };
  });
}

export interface ControlRow {
  id: string;
  site: string;
  pairs: string;
  years: string;
  a: string;
  b: string;
  c: string;
  r2: string;
  residSd: string;
  rTaLight: string;
  fitTaR: string;
  fitLightR: string;
  pairs10: string;
  r2_10: string;
  swcN: string;
  swcR2: string;
  band: string;
}

const SITE_TEXT: Record<string, string> = { haltiala: 'Haltiala', qvidja: 'Qvidja', viikki: 'Viikki', anttila: 'Anttila', sarkisuo: 'Särkisuo' };

/** Control pairs and fits per site. */
export function controlRows(d: FertData): ControlRow[] {
  return SITE_ORDER.map((s) => {
    const c = d.controls[s];
    if (!c) throw new Error(`fertilisation-weather: no controls for ${s}`);
    const years = c.years.length === 0 ? dash : c.years.length === 1 ? String(c.years[0]) : `${c.years[0]} to ${c.years[c.years.length - 1]}`;
    return {
      id: `controls-${s}`,
      site: SITE_TEXT[s] ?? s,
      pairs: String(c.nPairs),
      years: `${c.nYears} (${years})`,
      a: c.fit ? f2s(c.fit.coef[0]) : dash,
      b: c.fit ? f3s(c.fit.coef[1]) : dash,
      c: c.fit ? f3s(c.fit.coef[2]) : dash,
      r2: c.fit ? f2(c.fit.r2) : dash,
      residSd: c.fit ? f2(c.fit.residSd) : dash,
      rTaLight: f2(c.rTaLight),
      fitTaR: f2(c.fitTa.r),
      fitLightR: f2(c.fitLight.r),
      pairs10: String(c.sensitivity10.nPairs),
      r2_10: c.sensitivity10.fit ? f2(c.sensitivity10.fit.r2) : dash,
      swcN: c.fitSwc ? String(c.fitSwc.n) : dash,
      swcR2: c.fitSwc ? f2(c.fitSwc.r2) : dash,
      band: c.residualQuantiles ? `${f2s(c.residualQuantiles.p10)} to ${f2s(c.residualQuantiles.p90)}` : dash,
    };
  });
}

export interface SummaryRow {
  id: string;
  split: string;
  n: string;
  observed: string;
  expected: string;
  residual: string;
  rank: string;
  above: string;
  below: string;
  matched: string;
  lightNorm: string;
  residualSwc: string;
  residual10: string;
}

/** One row per split of the summaries. */
export function summaryRows(d: FertData): SummaryRow[] {
  return Object.keys(SPLIT_LABEL).map((k) => {
    const s = d.summary[k];
    if (!s) throw new Error(`fertilisation-weather: no summary ${k}`);
    const sites = Object.entries(s.sites)
      .filter(([, n]) => n > 0)
      .map(([site, n]) => `${SITE_TEXT[site] ?? site} ${n}`)
      .join(', ');
    return {
      id: `summary-${k}`,
      split: SPLIT_LABEL[k] ?? k,
      n: `${s.n} (${sites})`,
      observed: meanText(s.observed, f2s),
      expected: meanText(s.expected, f2s),
      residual: meanText(s.residual, f2s),
      rank: meanText(s.residualRank, f0, false),
      above: String(s.nResidualAbove90),
      below: String(s.nResidualBelow10),
      matched: s.matchedDiff.n === 0 ? dash : `${s.matchedDiff.n}: ${meanText(s.matchedDiff, f2s)}`,
      lightNorm: s.lightNormPct.n === 0 ? dash : `${meanText(s.lightNormPct, f0s, false)} % (n = ${s.lightNormPct.n})`,
      residualSwc: meanText(s.residualSwc, f2s),
      residual10: meanText(s.residual10, f2s),
    };
  });
}

export interface InputRow {
  path: string;
  sha256: string;
  rows: string;
}

/** The input files of the snapshot with their SHA-256 and row count (for "Reproduce"). */
export function inputRows(d: FertData): InputRow[] {
  return d.dataVersion.snapshot.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0) }));
}

export { f3 };
