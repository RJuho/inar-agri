// Deep Dives: articles that an AI assistant writes from the project data. Each article answers one
// question. This file has the shared build-time parts: the frontmatter schema (Valibot), the result
// data of each dive (site/src/deep-dives/<slug>.json, written by `npm run deep-dives`), number
// format, references and the links to the data page. Rules: CLAUDE.md, section "Deep Dive".
import * as v from 'valibot';
import { REFERENCES, REF_IDS, type Reference } from '../scripts/glossary';
import { defaultParams, VARIABLES, viewToHash, type Aggregation, type Variable, type View } from '../scripts/state';

// ---------- Sites ----------

/** Site codes and names, in the order of sites.parquet. */
export const SITE_NAMES = {
  anttila: 'Anttila',
  sarkisuo: 'Särkisuo',
  haltiala: 'Haltiala',
  qvidja: 'Qvidja',
  viikki: 'Viikki',
  maktau: 'Maktau',
} as const;
export type SiteCode = keyof typeof SITE_NAMES;
const SITE_CODES = Object.keys(SITE_NAMES) as SiteCode[];
/** Site key (sites.site_id) of each site code. */
export const SITE_IDS: Record<SiteCode, number> = { anttila: 1, sarkisuo: 2, haltiala: 3, qvidja: 4, viikki: 5, maktau: 6 };

// ---------- References ----------

/** A source that is not in glossary.ts: an article or a document of the data folder or the repository. */
export interface DiveReference {
  short: string;
  /** Full citation text (authors, year, title, journal) or a document description. */
  text: string;
  doi?: string;
  /** Path of the local copy, relative to the repository root. */
  file: string;
}

/** Sources of the Deep Dives in addition to REFERENCES of glossary.ts. */
export const EXTRA_REFERENCES = {
  hu2024: {
    short: 'Hu et al. 2024',
    text: 'Hu, T., Malone, S. L., Rumpel, C. and Chabbi, A. (2024). Maximizing soil organic carbon stocks through optimal ploughing and renewal strategies in (Ley) grassland. Communications Earth & Environment 5, 38.',
    doi: '10.1038/s43247-024-01202-3',
    file: 'data/s43247-024-01202-3.pdf',
  },
  'qvidja-management': {
    short: 'Qvidja management file',
    text: 'Qvidja field management records (date, action, amount, dry matter fraction, harvest type).',
    file: 'data/Qvidja/Qvidja_management.xlsx',
  },
  'viikki-management': {
    short: 'Viikki management file',
    text: 'Viikki management information per year (N input, dates, yield kg DW/ha).',
    file: 'data/Viikki/EC/Management Information.docx',
  },
  'haltiala-management': {
    short: 'Haltiala management file',
    text: 'Haltiala SMEAR management records (year, date, action, value, units, description).',
    file: 'data/Haltiala/haltiala_smear_management.xlsx',
  },
  'calculated-doc': {
    short: 'Calculated data documentation',
    text: 'Design, formulas and assumptions of the calculated flux products (GPP, Reco, daily sums) of this project.',
    file: 'docs/calculated.md',
  },
  'anomaly-report': {
    short: 'Data anomaly report',
    text: 'Verified data findings of this project, with status and a check query each.',
    file: 'docs/anomaly-data-report.md',
  },
} as const satisfies Record<string, DiveReference>;

export type DiveRefId = (typeof REF_IDS)[number] | keyof typeof EXTRA_REFERENCES;
const ALL_REF_IDS = [...REF_IDS, ...Object.keys(EXTRA_REFERENCES)] as DiveRefId[];

/** A reference in one form for the list: short text, full text, DOI and local file path. */
export interface ResolvedReference {
  id: DiveRefId;
  short: string;
  text: string;
  doi: string | null;
  file: string;
}

export function resolveReference(id: DiveRefId): ResolvedReference {
  if (id in REFERENCES) {
    const r: Reference = REFERENCES[id as keyof typeof REFERENCES];
    return {
      id,
      short: r.short,
      text: `${r.authors} (${r.year}). ${r.title}. ${r.journal}.`,
      doi: r.doi,
      file: `data/articles/${r.file}`,
    };
  }
  const r: DiveReference = EXTRA_REFERENCES[id as keyof typeof EXTRA_REFERENCES];
  return { id, short: r.short, text: r.text, doi: r.doi ?? null, file: r.file };
}

// ---------- Frontmatter ----------

/** Text without digits: numbers come from the result JSON, not from typed text. */
const noDigits = v.check((s: string) => !/\d/.test(s), 'must not contain digits (numbers come from the result JSON)');
/**
 * Date `yyyy-mm-dd`. YAML reads an unquoted date as a Date object, and Astro gives it to the layout
 * as an ISO time at midnight UTC; the schema accepts both forms and keeps the date only.
 */
const isoDate = v.pipe(
  v.union([v.string(), v.date()]),
  v.transform((x) => (x instanceof Date ? x.toISOString() : x).replace(/T00:00:00(\.000)?Z$/, '')),
  v.isoDate(),
);

const CheckSchema = v.strictObject({
  /** recompute = independent recompute of the numbers; review = language and reference review. */
  kind: v.picklist(['recompute', 'review']),
  /** Model or person that did the check. */
  by: v.pipe(v.string(), v.nonEmpty()),
  date: isoDate,
  result: v.picklist(['pass', 'fail', 'partial']),
  note: v.pipe(v.string(), v.nonEmpty()),
});

export const FrontmatterSchema = v.pipe(
  v.strictObject({
    layout: v.optional(v.string()),
    title: v.pipe(v.string(), v.nonEmpty(), v.maxLength(80)),
    question: v.pipe(v.string(), v.nonEmpty(), v.endsWith('?'), noDigits),
    shortAnswer: v.pipe(v.string(), v.nonEmpty(), v.maxLength(200), noDigits),
    sites: v.pipe(v.array(v.picklist(SITE_CODES)), v.minLength(1)),
    variables: v.pipe(v.array(v.picklist(VARIABLES)), v.minLength(1)),
    period: v.strictObject({ from: v.pipe(v.number(), v.integer()), to: v.pipe(v.number(), v.integer()) }),
    date: isoDate,
    status: v.picklist(['draft', 'checked']),
    models: v.pipe(
      v.array(v.strictObject({ model: v.pipe(v.string(), v.nonEmpty()), role: v.pipe(v.string(), v.nonEmpty()) })),
      v.minLength(1),
    ),
    script: v.pipe(v.string(), v.regex(/^scripts\/deep-dives\/[a-z0-9-]+\.ts$/)),
    references: v.pipe(v.array(v.picklist(ALL_REF_IDS)), v.minLength(1)),
    checks: v.array(CheckSchema),
  }),
  v.check((f) => f.period.from <= f.period.to, 'period.from is after period.to'),
  v.check(
    (f) =>
      f.status === 'draft' ||
      (f.checks.some((c) => c.kind === 'recompute' && c.result === 'pass') && f.checks.some((c) => c.kind === 'review' && c.result === 'pass')),
    'status "checked" needs a passed "recompute" check and a passed "review" check',
  ),
);
export type Frontmatter = v.InferOutput<typeof FrontmatterSchema>;

/** Slug of a dive page from its file path (…/deep-dive/<slug>.mdx). */
export function slugFromFile(file: string): string {
  const m = /([a-z0-9-]+)\.mdx$/.exec(file);
  if (!m?.[1]) throw new Error(`Deep Dive: cannot find the slug in ${file}`);
  return m[1];
}

/** Check the frontmatter of a dive. A bad frontmatter stops the build. */
export function parseFrontmatter(raw: unknown, slug: string): Frontmatter {
  // Astro adds `file` and `url` to the frontmatter of an MDX page; they are not part of the schema.
  const { file: _file, url: _url, ...own } = (raw ?? {}) as Record<string, unknown>;
  const r = v.safeParse(FrontmatterSchema, own);
  if (!r.success) {
    const issues = r.issues.map((i) => `${v.getDotPath(i) ?? '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Deep Dive ${slug}: bad frontmatter: ${issues}`);
  }
  if (r.output.script !== `scripts/deep-dives/${slug}.ts`) {
    throw new Error(`Deep Dive ${slug}: script must be scripts/deep-dives/${slug}.ts, not ${r.output.script}`);
  }
  const data = diveData(slug);
  if (data.script !== r.output.script) throw new Error(`Deep Dive ${slug}: the JSON was made by ${String(data.script)}, not ${r.output.script}`);
  return r.output;
}

// ---------- Result data ----------

const DATA = import.meta.glob<Record<string, unknown>>('../deep-dives/*.json', { eager: true, import: 'default' });

/** Result JSON of a dive. Stops the build when the file is missing. */
export function diveData(slug: string): Record<string, unknown> & { script?: unknown; dataVersion?: DataVersion } {
  const found = DATA[`../deep-dives/${slug}.json`];
  if (!found) throw new Error(`Deep Dive ${slug}: site/src/deep-dives/${slug}.json is missing. Run npm run deep-dives.`);
  return found;
}

export interface DataVersion {
  generatedAt: string;
  git: { commit: string; dirty: boolean };
  dbBuiltAt: string | null;
  calcBuiltAt: string | null;
  inputs: { path: string; bytes: number; sha256: string }[];
}

/** Value at a dotted path, for example `sites.qvidja.nee.mean` or `episodes.0.delta.nee`. */
export function lookup(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Number at a dotted path of a dive's JSON. Stops the build when the key is missing or not a number. */
export function diveNumber(slug: string, path: string): number {
  const value = lookup(diveData(slug), path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Deep Dive ${slug}: key "${path}" is ${value === undefined ? 'missing' : `not a number (${JSON.stringify(value)})`} in site/src/deep-dives/${slug}.json`);
  }
  return value;
}

/** Slug of the dive page of a URL (…/deep-dive/<slug>/). */
export function slugFromUrl(url: URL): string {
  const m = /\/deep-dive\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (!m?.[1]) throw new Error(`Deep Dive: ${url.pathname} is not a dive page. Give the dive prop.`);
  return m[1];
}

// ---------- Number format ----------

export interface NumFormat {
  /** Show + before a positive value. */
  sign?: boolean;
  /** Use the absolute value (for text such as "decreased by …"). */
  abs?: boolean;
}

/** Number with a fixed count of decimals, thin-space thousands and a true minus sign. */
export function fmtNum(x: number, digits: number, opt: NumFormat = {}): string {
  const value = opt.abs ? Math.abs(x) : x;
  let s = value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/,/g, ' ');
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  if (s.startsWith('-')) return `−${s.slice(1)}`;
  return opt.sign && value > 0 && !/^0(\.0+)?$/.test(s) ? `+${s}` : s;
}

// ---------- Links to the data page ----------

export interface DataLink {
  name: string;
  sites: SiteCode[];
  variables: Variable[];
  yearFrom: number;
  yearTo: number;
  monthFrom?: number;
  monthTo?: number;
  aggregation: Aggregation;
  events?: boolean;
  /** Diagram types, for example ['timeseries']. */
  diagrams: string[];
}

/** URL of the data page with a `#view=` hash for the given sites, variables and period. */
export function dataPageHref(base: string, link: DataLink): string {
  const params = defaultParams(link.sites.map((s) => SITE_IDS[s]));
  const view: View = {
    id: `deep-dive-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: link.name,
    params: {
      ...params,
      variables: [...link.variables],
      yearFrom: link.yearFrom,
      yearTo: link.yearTo,
      monthFrom: link.monthFrom ?? null,
      monthTo: link.monthTo ?? null,
      aggregation: link.aggregation,
      events: link.events ?? true,
    },
    diagrams: link.diagrams.map((type, i) => ({ id: `d${i + 1}`, type })),
  };
  return `${base}${viewToHash(view)}`;
}

/** Base URL of the site with a trailing slash. */
export function baseUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/?$/, '/');
}

// ---------- Fixed structure ----------

/** The h2 headings of a dive, in this order. The layout writes "Question"; the MDX file has the others. */
export const SECTIONS = ['Question', 'Short answer', 'Data and method', 'Results', 'Limits and uncertainty', 'References', 'Reproduce'] as const;

/** Check the h2 headings of the rendered MDX body and the citation links. Stops the build on an error. */
export function checkBody(html: string, slug: string): void {
  const h2 = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, '').trim());
  const expected = SECTIONS.slice(1);
  if (h2.join('|') !== expected.join('|')) {
    throw new Error(`Deep Dive ${slug}: the h2 headings must be "${expected.join('", "')}". Found: "${h2.join('", "')}"`);
  }
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#(ref-[^"]+)"/g)) {
    if (!ids.has(m[1])) throw new Error(`Deep Dive ${slug}: citation #${m[1]} has no entry in the reference list (add the id to frontmatter references)`);
  }
}
