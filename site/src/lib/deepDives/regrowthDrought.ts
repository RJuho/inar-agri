// Tables and keys of the Deep Dive "Regrowth after a silage harvest in a dry month: light use
// efficiency" (pages/deep-dive/regrowth-drought.mdx). Input: analysis/regrowth-drought/results.json
// (analysis/regrowth-drought/regrowth-drought.py). The figures are matplotlib SVG files of the same
// folder. Valibot checks the parts that the tables and the keys use; the schema is not strict, so
// the other parts of the JSON (day-by-day curves, seeds) pass without a check.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';

const N = v.nullable(v.number());
const S = v.nullable(v.string());
const SITE = v.picklist(Object.keys(SITE_NAMES) as SiteCode[]);
const CUT_GROUPS = ['first', 'later'] as const;
type CutGroup = (typeof CUT_GROUPS)[number];
const WINDOWS = ['after', 'late'] as const;
type Window = (typeof WINDOWS)[number];
const QUANTITIES = ['relLue', 'relGpp', 'relPar'] as const;
type Quantity = (typeof QUANTITIES)[number];
const K_SITES = ['anttila', 'sarkisuo', 'viikki'] as const;

/** Statistics of one group, window and quantity (n, mean, SD, median, range, bootstrap interval). */
const Stat = v.object({ n: v.number(), mean: N, sd: N, median: N, min: N, max: N, ciLo: N, ciHi: N });
/** The one dry episode against the normal group (later cuts). */
const Single = v.object({
  value: v.number(),
  normalMean: v.number(),
  normalSd: v.number(),
  normalMin: v.number(),
  normalMax: v.number(),
  sdUnits: v.number(),
  aboveNormalMax: v.boolean(),
  belowNormalMin: v.boolean(),
});
const Diff = v.object({
  nDry: v.number(),
  nNormal: v.number(),
  diff: N,
  ci: v.nullable(v.tuple([v.number(), v.number()])),
  permutationP: N,
  nSplits: v.number(),
  single: v.nullable(Single),
});
const Comparison = v.object({ dry: Stat, normal: Stat, diff: Diff });
const WindowStats = v.object({ relLue: Comparison, relGpp: Comparison, relPar: Comparison });
/**
 * One cut group. The dry statistics are null (n = 0) when no episode is dry, for example the later
 * cuts by SPI-3; `Stat` and `Diff` allow null for this.
 */
const Group = v.object({
  label: v.string(),
  n: v.object({ dry: v.number(), normal: v.number() }),
  ids: v.object({ dry: v.array(v.string()), normal: v.array(v.string()) }),
  after: WindowStats,
  late: WindowStats,
});
/** The second full grouping, dry = SPI-3 ≤ the threshold of `method.spi3Rule` (Figures 4 and 5). */
const GroupsSpi3 = v.object({ first: Group, later: Group, rule: v.string(), note: v.string() });

/** Sensitivity statistics: group means only, no interval and no test. */
const SStat = v.object({ n: v.number(), mean: N, sd: N, min: N, max: N });
const SComparison = v.object({ dry: SStat, normal: SStat, diff: N });
const SWindow = v.object({ relLue: SComparison, relGpp: SComparison, relPar: SComparison });
const SGroup = v.object({
  label: v.string(),
  n: v.object({ dry: v.number(), normal: v.number() }),
  ids: v.object({ dry: v.array(v.string()), normal: v.array(v.string()) }),
  after: SWindow,
  late: SWindow,
});
const SPair = v.object({ first: SGroup, later: SGroup });

const EpisodeWindow = v.object({ nDays: v.number(), relLue: N, relGpp: N, relPar: N, relLueTimesRelPar: N, gpp: N, par: N, lue: N });
const Episode = v.object({
  id: v.string(),
  site: SITE,
  year: v.number(),
  cutNo: v.number(),
  cutGroup: v.picklist(CUT_GROUPS),
  start: v.string(),
  end: v.string(),
  durationDays: v.number(),
  crop: S,
  detailShort: v.string(),
  overrides: v.array(v.string()),
  fertInWindow: v.boolean(),
  nextDisturbanceDays: N,
  used: v.boolean(),
  exclusion: S,
  flags: v.object({ establishmentYear: v.boolean(), partialHarvest: v.boolean(), note: S }),
  flagged: v.boolean(),
  inGroup: v.boolean(),
  station: v.string(),
  spi1: N,
  spi3: N,
  dry: v.boolean(),
  drySpi3: v.boolean(),
  drySwc: v.boolean(),
  drySpiMinus1: v.boolean(),
  swcAnomaly: v.object({ nDays: v.number(), mean: N, nYears: v.number(), anomaly: N }),
  lateFree: v.boolean(),
  before: v.object({ nDays: v.number(), gpp: N, par: N, lue: N }),
  /** `late` is null when another event overlaps the late window (`lateFree` false). */
  windows: v.object({ after: EpisodeWindow, late: v.nullable(EpisodeWindow) }),
});

const ParSite = v.object({ nDays: v.number(), median: v.number(), p10: v.number(), p90: v.number(), min: v.number(), max: v.number() });

const Literature = v.object({
  key: v.string(),
  text: v.string(),
  ref: v.string(),
  section: S,
  page: v.string(),
  tableFigure: S,
});

const DataSchema = v.object({
  method: v.object({
    stationOfSite: v.record(v.string(), v.string()),
    mergeDays: v.number(),
    overrides: v.array(v.object({ site: SITE, date: v.string(), text: v.string() })),
    beforeDays: v.tuple([v.number(), v.number()]),
    afterDays: v.tuple([v.number(), v.number()]),
    lateDays: v.tuple([v.number(), v.number()]),
    windowDays: v.number(),
    minDays: v.number(),
    minFracPct: v.number(),
    minHalfHours: v.number(),
    halfHoursPerDay: v.number(),
    dayFactor: v.number(),
    minPar: v.number(),
    spiDry: v.number(),
    spiDryOtherDive: v.number(),
    parUmolPerJ: v.number(),
    kMinDays: v.number(),
    swcWindow: v.tuple([v.number(), v.number()]),
    compositeFrom: v.number(),
    compositeTo: v.number(),
    compositeMinN: v.number(),
    yStep: v.number(),
    bootstrapResamples: v.number(),
    bootstrapMinN: v.number(),
    ciLevelPct: v.number(),
    utcShiftHours: v.number(),
    spi3Rule: v.object({ threshold: v.number(), note: v.string() }),
    yRangeRule: v.string(),
  }),
  counts: v.object({
    silageEpisodes: v.number(),
    usedFlux: v.number(),
    used: v.number(),
    excluded: v.object({ overlap: v.number(), 'too-few-days': v.number(), 'low-measured-fraction': v.number(), 'too-few-par-days': v.number() }),
    flagged: v.number(),
    inGroups: v.number(),
    overrides: v.number(),
    perCutGroup: v.object({
      first: v.object({ inGroups: v.number(), dry: v.number(), normal: v.number(), lateWindows: v.object({ dry: v.number(), normal: v.number() }) }),
      later: v.object({ inGroups: v.number(), dry: v.number(), normal: v.number(), lateWindows: v.object({ dry: v.number(), normal: v.number() }) }),
    }),
    daysParBelowMin: v.number(),
  }),
  sites: v.array(
    v.object({
      code: SITE,
      name: v.string(),
      station: v.string(),
      parSource: v.string(),
      dataYears: v.array(v.number()),
      episodes: v.number(),
      used: v.number(),
      inGroups: v.number(),
    }),
  ),
  episodes: v.array(Episode),
  groups: v.object({ first: Group, later: Group, spi3: GroupsSpi3 }),
  composite: v.object({
    yRange: v.tuple([v.number(), v.number()]),
    /** The y range of Figure 4: one range over the curves of Figures 1, 2 and 4. */
    yRangeSpi3: v.tuple([v.number(), v.number()]),
    /** True when `yRangeSpi3` equals `yRange`. */
    yRangeShared: v.boolean(),
  }),
  par: v.object({
    k: v.number(),
    kMin: v.number(),
    kMax: v.number(),
    energyFractionPct: v.number(),
    kSites: v.array(v.string()),
    perSite: v.object({ anttila: ParSite, sarkisuo: ParSite, viikki: ParSite }),
    pooled: ParSite,
  }),
  sensitivity: v.object({
    dryness: v.object({ drySpi3: SPair, drySwc: SPair }),
    spiMinus1: v.object({ threshold: v.number(), first: SGroup, later: SGroup }),
    k: v.object({ k: v.number(), kMin: v.number(), kMax: v.number(), note: v.string() }),
  }),
  summary: v.object({
    extra: v.object({
      june2018: v.object({ station: v.string(), month: v.string(), spi1: v.number(), spi3: v.number(), dry: v.boolean(), dryMinus1: v.boolean() }),
    }),
  }),
  literatureByKey: v.record(v.string(), Literature),
  figures: v.array(v.object({ n: v.number(), file: v.string(), title: v.string(), desc: v.string() })),
  dataVersion: v.object({
    inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number(), columns: v.array(v.string()) })),
    snapshot: v.object({ builtAt: v.string(), calcBuiltAt: v.nullable(v.string()), url: v.nullable(v.string()) }),
  }),
});

export type RegrowthData = v.InferOutput<typeof DataSchema>;
type EpisodeOut = v.InferOutput<typeof Episode>;
type StatOut = v.InferOutput<typeof Stat>;
type SStatOut = v.InferOutput<typeof SStat>;
type SGroupOut = v.InferOutput<typeof SGroup>;

export function regrowthData(raw: unknown): RegrowthData {
  const d = v.parse(DataSchema, raw);
  for (const g of CUT_GROUPS) {
    const n = d.groups[g].n;
    if (n.dry !== d.counts.perCutGroup[g].dry || n.normal !== d.counts.perCutGroup[g].normal) {
      throw new Error(`regrowth-drought: the group counts of ${g} differ between groups and counts.perCutGroup`);
    }
    // The SPI-3 grouping uses the same episodes as the main rule.
    const s = d.groups.spi3[g];
    if (s.n.dry + s.n.normal !== n.dry + n.normal) {
      throw new Error(`regrowth-drought: the SPI-3 groups of ${g} do not hold the episodes of the main rule`);
    }
    if (s.n.dry !== s.ids.dry.length || s.n.normal !== s.ids.normal.length) {
      throw new Error(`regrowth-drought: the SPI-3 counts of ${g} differ from the id lists`);
    }
  }
  if (d.composite.yRangeShared !== (d.composite.yRangeSpi3[0] === d.composite.yRange[0] && d.composite.yRangeSpi3[1] === d.composite.yRange[1])) {
    throw new Error('regrowth-drought: composite.yRangeShared does not agree with yRange and yRangeSpi3');
  }
  return d;
}

// ---------- Keys for <Num k="…" /> ----------

/** Dotted path of one episode, for example `episodes.7`. */
export function epKey(d: RegrowthData, id: string): string {
  const i = d.episodes.findIndex((e) => e.id === id);
  if (i < 0) throw new Error(`regrowth-drought: no episode ${id}`);
  return `episodes.${i}`;
}

/**
 * Citation note of a literature row: "section 7.1.2, p. 91" for the textbook (the Finnish page
 * text "s. 91" becomes "p. 91"), else the page text of the row, for example "PDF p. 4".
 */
export function litNote(d: RegrowthData, key: string): string {
  const r = d.literatureByKey[key];
  if (!r) throw new Error(`regrowth-drought: no literature row ${key}`);
  const page = r.page.replace(/^s\. /, '');
  if (r.section) {
    const num = r.section.split(' ')[0];
    return `section ${num}, p. ${page}${r.tableFigure ? `, ${r.tableFigure}` : ''}`;
  }
  return `${page}${r.tableFigure ? `, ${r.tableFigure}` : ''}`;
}

// ---------- Number text ----------

const dash = '–';
const f0 = (x: number | null) => (x === null ? dash : fmtNum(x, 0));
const f1 = (x: number | null) => (x === null ? dash : fmtNum(x, 1));
const f2 = (x: number | null) => (x === null ? dash : fmtNum(x, 2));
const f2s = (x: number | null) => (x === null ? dash : fmtNum(x, 2, { sign: true }));
const f3 = (x: number | null) => (x === null ? dash : fmtNum(x, 3));

/**
 * "0.64 ± 0.29 [0.30, 0.82]" when n is 3 or more (mean, sample SD, bootstrap interval);
 * the two values when n = 2; the value when n = 1; a dash when n = 0.
 */
export function statText(s: StatOut, fmt: (x: number | null) => string = f2): string {
  if (s.n === 0 || s.mean === null) return dash;
  if (s.n === 1) return fmt(s.mean);
  if (s.n === 2) return `${fmt(s.min)} and ${fmt(s.max)}`;
  return `${fmt(s.mean)} ± ${fmt(s.sd)} [${fmt(s.ciLo)}, ${fmt(s.ciHi)}]`;
}

/** "0.64 ± 0.29" when n is 3 or more; the two values when n = 2; the value when n = 1; a dash when n = 0. */
function sStatText(s: SStatOut): string {
  if (s.n === 0 || s.mean === null) return dash;
  if (s.n === 1) return f2(s.mean);
  if (s.n === 2) return `${f2(s.min)} and ${f2(s.max)}`;
  return `${f2(s.mean)} ± ${f2(s.sd)}`;
}

const QUANTITY_LABEL: Record<Quantity, string> = { relLue: 'LUE', relGpp: 'GPP', relPar: 'PAR' };
const WINDOW_LABEL = (d: RegrowthData): Record<Window, string> => ({
  after: `days ${fmtNum(d.method.afterDays[0], 0, { sign: true })} to ${fmtNum(d.method.afterDays[1], 0, { sign: true })}`,
  late: `days ${fmtNum(d.method.lateDays[0], 0, { sign: true })} to ${fmtNum(d.method.lateDays[1], 0, { sign: true })}`,
});
const GROUP_LABEL: Record<CutGroup, string> = { first: 'First cut', later: 'Later cuts' };

// ---------- Rows ----------

export interface InputRow {
  path: string;
  sha256: string;
  rows: string;
  columns: string;
}

/** The input files of the snapshot with their SHA-256, row count and the columns read (for "Reproduce"). */
export function inputRows(d: RegrowthData): InputRow[] {
  return d.dataVersion.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0), columns: i.columns.join(', ') }));
}

export interface EpisodeRow {
  id: string;
  site: string;
  dates: string;
  cutNo: string;
  group: string;
  use: string;
  dryness: string;
  spi1: string;
  spi3: string;
  swcAnomaly: string;
  parBefore: string;
  lueBefore: string;
  afterLue: string;
  afterGpp: string;
  afterPar: string;
  lateLue: string;
  lateGpp: string;
  latePar: string;
  fert: string;
  flag: string;
}

const EXCLUSION_TEXT: Record<string, string> = {
  overlap: 'not used: overlap',
  'too-few-days': 'not used: too few flux days',
  'low-measured-fraction': 'not used: low measured fraction',
  'too-few-par-days': 'not used: too few LUE days before',
};

function useText(e: EpisodeOut): string {
  if (e.inGroup) return 'used';
  if (e.flagged) return 'flagged, not in a group';
  return EXCLUSION_TEXT[e.exclusion ?? ''] ?? `not used: ${e.exclusion ?? ''}`;
}

function flagText(e: EpisodeOut): string {
  const f: string[] = [];
  if (e.flags.establishmentYear) f.push('establishment year');
  if (e.flags.partialHarvest) f.push('partial harvest');
  if (e.overrides.length) f.push('override');
  return f.length ? f.join('; ') : dash;
}

/** Text of the late window value: the value, or the reason when there is none. */
function lateText(d: RegrowthData, e: EpisodeOut, q: Quantity): string {
  const w = e.windows.late;
  if (w === null || !e.lateFree) return 'overlap';
  const x = w[q];
  if (x !== null) return f2(x);
  if (e.before.lue === null) return dash;
  return w.nDays < d.method.minDays ? `${fmtNum(w.nDays, 0)} days` : dash;
}

/** All silage harvest episodes, in the site order of db/sites.parquet, then by date. */
export function episodeRows(d: RegrowthData): EpisodeRow[] {
  const order = d.sites.map((s) => s.code as string);
  return [...d.episodes]
    .sort((a, b) => order.indexOf(a.site) - order.indexOf(b.site) || a.start.localeCompare(b.start))
    .map((e) => ({
      id: e.id,
      site: SITE_NAMES[e.site],
      dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
      cutNo: fmtNum(e.cutNo, 0),
      group: GROUP_LABEL[e.cutGroup],
      use: useText(e),
      dryness: e.spi1 === null ? dash : e.dry ? 'dry' : 'normal',
      spi1: f2(e.spi1),
      spi3: f2(e.spi3),
      swcAnomaly: e.swcAnomaly.anomaly === null ? dash : `${f3(e.swcAnomaly.anomaly)} (${fmtNum(e.swcAnomaly.nYears, 0)} y)`,
      parBefore: f1(e.before.par),
      lueBefore: f3(e.before.lue),
      afterLue: f2(e.windows.after.relLue),
      afterGpp: f2(e.windows.after.relGpp),
      afterPar: f2(e.windows.after.relPar),
      lateLue: lateText(d, e, 'relLue'),
      lateGpp: lateText(d, e, 'relGpp'),
      latePar: lateText(d, e, 'relPar'),
      fert: e.fertInWindow ? 'yes' : 'no',
      flag: flagText(e),
    }));
}

export interface GroupRow {
  id: string;
  group: string;
  window: string;
  quantity: string;
  dry: string;
  nDry: string;
  normal: string;
  nNormal: string;
  diff: string;
  p: string;
}

type GroupOut = v.InferOutput<typeof Group>;

/** The rows of one cut group: one row per window and quantity. `idPrefix` makes the row ids, for example `group-first`. */
function groupRowsOf(d: RegrowthData, g: CutGroup, group: GroupOut, idPrefix: string): GroupRow[] {
  const rows: GroupRow[] = [];
  const wl = WINDOW_LABEL(d);
  for (const w of WINDOWS) {
    for (const q of QUANTITIES) {
      const c = group[w][q];
      const diff = c.diff;
      let diffText: string;
      let pText: string;
      if (diff.single) {
        const s = diff.single;
        diffText = `${f2s(diff.diff)} (${f2(s.sdUnits)} SD units of the normal group)`;
        pText = 'no test (one dry episode)';
      } else if (c.dry.n === 0) {
        diffText = dash;
        pText = 'no test (no dry episode)';
      } else {
        diffText = diff.ci ? `${f2s(diff.diff)} [${f2s(diff.ci[0])}, ${f2s(diff.ci[1])}]` : f2s(diff.diff);
        pText = diff.permutationP === null ? dash : `${f2(diff.permutationP)} (${fmtNum(diff.nSplits, 0)} splits)`;
      }
      rows.push({
        id: `${idPrefix}-${w}-${q}`,
        group: GROUP_LABEL[g],
        window: wl[w],
        quantity: QUANTITY_LABEL[q],
        dry: statText(c.dry),
        nDry: fmtNum(c.dry.n, 0),
        normal: statText(c.normal),
        nNormal: fmtNum(c.normal.n, 0),
        diff: diffText,
        p: pText,
      });
    }
  }
  return rows;
}

/** One row per cut group, window and quantity: dry, normal, the difference with its interval, and the permutation p (main rule, Table B). */
export function groupRows(d: RegrowthData): GroupRow[] {
  return CUT_GROUPS.flatMap((g) => groupRowsOf(d, g, d.groups[g], `group-${g}`));
}

/**
 * The same rows for the SPI-3 grouping (Table B2), first cuts only: no later cut is dry by SPI-3,
 * so the later-cut rows would hold only the normal group. Ids `group-spi3-first-<window>-<quantity>`.
 */
export function groupRowsSpi3(d: RegrowthData): GroupRow[] {
  return groupRowsOf(d, 'first', d.groups.spi3.first, 'group-spi3-first');
}

export interface SensitivityRow {
  id: string;
  rule: string;
  group: string;
  window: string;
  n: string;
  lueDry: string;
  lueNormal: string;
  lueDiff: string;
  gppDry: string;
  gppNormal: string;
  parDry: string;
  parNormal: string;
}

/** The main rule and the three sensitivity rules, per cut group and window: n, and the LUE, GPP and PAR means. */
export function sensitivityRows(d: RegrowthData): SensitivityRow[] {
  const wl = WINDOW_LABEL(d);
  const spi = (x: number) => fmtNum(x, 1);
  const rules: { id: string; label: string; get: (g: CutGroup) => SGroupOut }[] = [
    {
      id: 'spi1',
      label: `SPI-1 ≤ ${spi(d.method.spiDry)} (main rule)`,
      get: (g) => {
        // The main groups have the same fields as a sensitivity group, plus the intervals and tests.
        const m = d.groups[g];
        const strip = (w: v.InferOutput<typeof WindowStats>) => {
          const out = {} as v.InferOutput<typeof SWindow>;
          for (const q of QUANTITIES) out[q] = { dry: w[q].dry, normal: w[q].normal, diff: w[q].diff.diff };
          return out;
        };
        return { label: m.label, n: m.n, ids: m.ids, after: strip(m.after), late: strip(m.late) };
      },
    },
    { id: 'spi3', label: `SPI-3 ≤ ${spi(d.method.spiDry)}`, get: (g) => d.sensitivity.dryness.drySpi3[g] },
    { id: 'swc', label: 'SWC anomaly < 0', get: (g) => d.sensitivity.dryness.drySwc[g] },
    { id: 'spim1', label: `SPI-1 ≤ ${spi(d.sensitivity.spiMinus1.threshold)}`, get: (g) => d.sensitivity.spiMinus1[g] },
  ];
  const rows: SensitivityRow[] = [];
  for (const r of rules) {
    for (const g of CUT_GROUPS) {
      const s = r.get(g);
      for (const w of WINDOWS) {
        const x = s[w];
        rows.push({
          id: `sens-${r.id}-${g}-${w}`,
          rule: r.label,
          group: GROUP_LABEL[g],
          window: wl[w],
          n: `${fmtNum(x.relLue.dry.n, 0)} / ${fmtNum(x.relLue.normal.n, 0)}`,
          lueDry: sStatText(x.relLue.dry),
          lueNormal: sStatText(x.relLue.normal),
          lueDiff: f2s(x.relLue.diff),
          gppDry: sStatText(x.relGpp.dry),
          gppNormal: sStatText(x.relGpp.normal),
          parDry: sStatText(x.relPar.dry),
          parNormal: sStatText(x.relPar.normal),
        });
      }
    }
  }
  return rows;
}

export interface KRow {
  id: string;
  site: string;
  nDays: string;
  median: string;
  p10: string;
  p90: string;
  min: string;
  max: string;
}

/** The daily PAR / SW_in ratio per site and pooled: day count, median, 10 and 90 % values, range. */
export function kRows(d: RegrowthData): KRow[] {
  const row = (id: string, site: string, p: v.InferOutput<typeof ParSite>): KRow => ({
    id: `k-${id}`,
    site,
    nDays: fmtNum(p.nDays, 0),
    median: f3(p.median),
    p10: f3(p.p10),
    p90: f3(p.p90),
    min: f3(p.min),
    max: f3(p.max),
  });
  const rows = K_SITES.map((s) => row(s, SITE_NAMES[s], d.par.perSite[s]));
  rows.push(row('pooled', `Pooled (k)`, d.par.pooled));
  return rows;
}

/** The override texts of Deep Dive #4, with the site name and the date. */
export function overrideTexts(d: RegrowthData): string[] {
  return d.method.overrides.map((o) => `${SITE_NAMES[o.site]} ${o.date}: ${o.text}`);
}

/** Site names of a list of episode ids, each one time, in the site order of db/sites.parquet. */
export function sitesOf(d: RegrowthData, ids: readonly string[]): string {
  const order = d.sites.map((s) => s.code as string);
  const codes = [...new Set(ids.map((id) => d.episodes.find((e) => e.id === id)?.site).filter((s): s is SiteCode => s !== undefined))];
  codes.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return codes.map((c) => SITE_NAMES[c]).join(', ');
}

/** Number of episodes in the groups with a fertilisation in the windows. */
export function fertInWindowCount(d: RegrowthData): number {
  return d.episodes.filter((e) => e.inGroup && e.fertInWindow).length;
}

export { CUT_GROUPS, WINDOWS, QUANTITIES };
