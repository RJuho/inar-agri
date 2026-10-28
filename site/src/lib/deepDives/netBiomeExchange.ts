// Tables and keys of the Deep Dive "Net biome exchange: NEE plus the carbon of management"
// (pages/deep-dive/net-biome-exchange.mdx). Input: analysis/net-biome-exchange/results.json
// (analysis/net-biome-exchange/net-biome-exchange.py). The figure is a matplotlib SVG of the same
// folder. Valibot checks the parts that the tables use; the schema is not strict.
import * as v from 'valibot';
import { EXTRA_REFERENCES, fmtNum, resolveReference, type DiveRefId } from '../deepDive';
import { siteEmoji } from '../../scripts/sites';

const N = v.nullable(v.number());
const Term = v.object({
  kind: v.picklist(['out', 'in']),
  date: v.string(),
  product: v.string(),
  value: v.number(),
  valueAtLowNbe: v.number(),
  valueAtHighNbe: v.number(),
  assumption: v.nullable(v.string()),
});
const SiteYear = v.object({
  key: v.string(),
  site: v.string(),
  siteName: v.string(),
  year: v.number(),
  crop: v.string(),
  fullYear: v.boolean(),
  reliable: v.boolean(),
  gpp: N,
  ter: N,
  nee: N,
  cOut: N,
  cIn: N,
  nbe: N,
  nbeLow: N,
  nbeHigh: N,
  class: v.nullable(v.picklist(['A', 'B'])),
  assumptions: v.array(v.string()),
  nbeReason: v.nullable(v.string()),
  inFigure: v.boolean(),
  figureReason: v.nullable(v.string()),
  terms: v.array(Term),
});
const Lit = v.object({
  key: v.string(),
  text: v.string(),
  value: v.number(),
  unit: v.string(),
  uncertainty: N,
  ref: v.string(),
  page: v.string(),
  tableFigure: v.nullable(v.string()),
});
const DataSchema = v.object({
  siteYears: v.array(SiteYear),
  figureKeys: v.array(v.string()),
  noNbe: v.array(v.object({ key: v.string(), site: v.string(), year: v.number(), reason: v.string() })),
  assumptions: v.array(v.object({ key: v.string(), text: v.string(), siteYears: v.array(v.string()) })),
  summary: v.object({ nWithNbe: v.number(), nWithoutNbe: v.number(), nFigure: v.number() }),
  literature: v.array(Lit),
  dataVersion: v.object({
    inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number(), columns: v.array(v.string()) })),
    snapshot: v.object({ builtAt: v.string(), calcBuiltAt: v.nullable(v.string()), url: v.nullable(v.string()) }),
  }),
});

export type NbeData = v.InferOutput<typeof DataSchema>;

/** Check the JSON and the agreement of the figure keys, the flags and the counts. */
export function nbeData(raw: unknown): NbeData {
  const d = v.parse(DataSchema, raw);
  const inFig = d.siteYears.filter((s) => s.inFigure).map((s) => s.key);
  if (inFig.join('|') !== d.figureKeys.join('|') || inFig.length !== d.summary.nFigure) {
    throw new Error('net-biome-exchange: inFigure does not agree with figureKeys or the count');
  }
  const withNbe = d.siteYears.filter((s) => s.nbe !== null);
  if (withNbe.length !== d.summary.nWithNbe || d.noNbe.length !== d.summary.nWithoutNbe) {
    throw new Error('net-biome-exchange: the NBE counts do not agree with the site-years');
  }
  for (const s of withNbe) {
    if (s.nee === null || s.cOut === null || s.cIn === null || s.nbeLow === null || s.nbeHigh === null || s.class === null) {
      throw new Error(`net-biome-exchange: ${s.key} has NBE without its terms`);
    }
  }
  return d;
}

/** Short label of an assumption key: the letter of METHOD step 4, or a word. */
export function assumptionLabel(key: string): string {
  if (key === 'partial-year') return 'partial year';
  if (key === 'hyytiala-thinning-2020') return 'thinning';
  return key.split('-')[0] ?? key;
}

/** Emoji of a site code; the reference forest Hyytiälä is not a database site. */
export function emojiOf(code: string): string {
  return code === 'hyytiala' ? '🌲🍄' : siteEmoji(code);
}

const f0 = (x: number | null) => (x === null ? '–' : fmtNum(x, 0));

export interface NbeRow {
  id: string;
  emoji: string;
  site: string;
  year: number;
  crop: string;
  nee: string;
  cOut: string;
  cIn: string;
  nbe: string;
  range: string;
  cls: string;
  figure: string;
  assumptions: string;
}

/** All site-years with NBE, in the order of results.json (site order of db/sites.parquet, then Hyytiälä). */
export function nbeRows(d: NbeData): NbeRow[] {
  return d.siteYears
    .filter((s) => s.nbe !== null)
    .map((s) => ({
      id: `nbe-${s.key}`,
      emoji: emojiOf(s.site),
      site: s.siteName,
      year: s.year,
      crop: s.crop,
      nee: f0(s.nee),
      cOut: f0(s.cOut),
      cIn: f0(s.cIn),
      nbe: f0(s.nbe),
      range: s.nbeLow === s.nbeHigh ? '–' : `${f0(s.nbeLow)} to ${f0(s.nbeHigh)}`,
      cls: s.class ?? '–',
      figure: s.inFigure ? 'yes' : `no: ${s.figureReason ?? ''}`,
      assumptions: [...new Set(s.assumptions.map(assumptionLabel))].join(', ') || '–',
    }));
}

export interface NoNbeRow {
  id: string;
  emoji: string;
  site: string;
  year: number;
  reason: string;
}

/** The site-years without NBE and the reason. */
export function noNbeRows(d: NbeData): NoNbeRow[] {
  return d.noNbe.map((r) => {
    const s = d.siteYears.find((x) => x.key === r.key)!;
    return { id: `nonbe-${r.key}`, emoji: emojiOf(r.site), site: s.siteName, year: r.year, reason: r.reason };
  });
}

export interface LitRow {
  id: string;
  text: string;
  value: string;
  source: string;
  page: string;
}

const fmtLit = (x: number, unit = '') => {
  if (unit === 'year') return String(x);
  const s = String(x);
  const digits = s.includes('.') ? s.split('.')[1]!.length : 0;
  return fmtNum(x, digits);
};

/** The LITERATURE rows of the script: value with unit and uncertainty, short citation, page. */
export function litRows(d: NbeData): LitRow[] {
  return d.literature.map((r) => ({
    id: `lit-${r.key}`,
    text: r.text,
    value: `${fmtLit(r.value, r.unit)}${r.uncertainty !== null ? ` ± ${fmtLit(r.uncertainty)}` : ''} ${r.unit}`,
    source: resolveReference(r.ref as DiveRefId).short,
    page: r.page + (r.tableFigure ? `, ${r.tableFigure}` : ''),
  }));
}

/** Site-year keys of one assumption, as "Viikki 2022, Viikki 2023 …". */
export function assumptionSiteYears(d: NbeData, key: string): string {
  const a = d.assumptions.find((x) => x.key === key);
  if (!a) throw new Error(`net-biome-exchange: unknown assumption ${key}`);
  return a.siteYears.map((k) => {
    const s = d.siteYears.find((x) => x.key === k)!;
    return `${s.siteName} ${s.year}`;
  }).join(', ');
}

export interface InputRow {
  path: string;
  sha256: string;
  rows: string;
  columns: string;
}

export function inputRows(d: NbeData): InputRow[] {
  return d.dataVersion.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0), columns: i.columns.join(', ') }));
}

/** Dotted <Num> path of a site-year, for example `sy.qvidja-2023`. */
export const SY = (key: string) => `sy.${key}`;

/** The reference id of the thinning report, so that the MDX need not type it twice. */
export const THINNING_REF: keyof typeof EXTRA_REFERENCES = 'aalto-thinning2023';
