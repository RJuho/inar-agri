// Tables and keys of the Deep Dive "Management events on the flux timeline: timing per site"
// (pages/deep-dive/event-timing.mdx). Input: analysis/event-timing/results.json
// (analysis/event-timing/event-timing.py). The figures are matplotlib SVG files of the same
// folder. Valibot checks the parts that the tables and the keys use.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';

const N = v.nullable(v.number());
const S = v.nullable(v.string());
const B = v.nullable(v.boolean());
const SITE = v.picklist(Object.keys(SITE_NAMES) as SiteCode[]);

/** One change-point test (GPP drop, GPP rise after sowing, Reco rise, drop of measured NEE). */
const Step = v.nullable(
  v.object({
    direction: v.string(),
    anchor: S,
    detected: S,
    offset: N,
    step: N,
    stepPct: N,
    clear: B,
    reason: S,
  }),
);
const Side = v.object({ n: v.record(v.string(), v.number()), mean: v.record(v.string(), N) });

const Episode = v.object({
  id: v.string(),
  site: SITE,
  start: v.string(),
  end: v.string(),
  anchor: v.string(),
  kind: v.string(),
  types: v.array(v.string()),
  inFluxPeriod: v.boolean(),
  before: Side,
  after: Side,
  change: v.object({ gpp: N, reco: N, nee: N, gppPct: N }),
  overlap: v.boolean(),
  spanOverlap: v.boolean(),
  spanOverlapWith: v.array(v.string()),
  gppDrop: Step,
  neeDrop: Step,
  sowingRise: Step,
  recoRise: Step,
  agree: B,
  primary: S,
  searched: v.boolean(),
  offset: N,
  detected: S,
  clear: B,
  usedForOffset: v.boolean(),
  usedForChange: v.boolean(),
});

const Event = v.object({
  date: v.string(),
  dateEnd: S,
  type: v.string(),
  letter: v.string(),
  detailShort: v.string(),
  source: v.string(),
  crop: S,
  yieldTHa: N,
  nKgHa: N,
  fieldOperation: v.boolean(),
  inFluxPeriod: v.boolean(),
  episodeId: S,
});

const Year = v.object({
  year: v.number(),
  nDays: v.number(),
  nDaysMeasured: v.number(),
  seasonStart: S,
  seasonEnd: S,
  seasonLength: N,
  events: v.record(v.string(), v.number()),
  episodes: v.number(),
});

const Alt = v.object({
  site: SITE,
  dateUsed: v.string(),
  type: v.string(),
  dateOther: v.string(),
  sourceOther: v.string(),
  sourceShort: v.string(),
  page: v.string(),
  note: v.string(),
  episodeId: v.string(),
  dateEndUsed: S,
  dateEndOther: S,
  daysApart: v.number(),
  test: S,
  detected: S,
  offsetToUsed: N,
  offsetToOther: N,
  clear: B,
  stepPct: N,
  reason: S,
  nearer: v.nullable(v.picklist(['used', 'other', 'equal'])),
  nearerBasis: S,
  recoRise: v.nullable(v.object({ detected: S, offset: N, clear: B, offsetToOther: N })),
});

const Site = v.object({
  name: v.string(),
  utcOffsetMin: v.number(),
  fluxFirst: v.string(),
  fluxLast: v.string(),
  daysWithNee: v.number(),
  daysLowFrac: v.number(),
  events: v.array(Event),
  episodes: v.array(Episode),
  years: v.array(Year),
  wetMonths: v.nullable(v.array(v.object({ month: v.string(), precipMm: v.number() }))),
  alternativeDates: v.array(Alt),
});

const Offsets = v.object({
  n: v.number(),
  mean: N,
  sd: N,
  median: N,
  min: N,
  max: N,
  ciLo: N,
  ciHi: N,
  nSearched: v.number(),
  nClear: v.number(),
  nBefore: v.number(),
  nOn: v.number(),
  nAfter: v.number(),
  nEpisodes: v.number(),
});
const Stat = v.object({ n: v.number(), mean: N, sd: N, min: N, max: N, ciLo: N, ciHi: N });
const Change = v.object({ n: v.number(), gpp: Stat, reco: Stat, nee: Stat, gppPct: Stat });

const DataSchema = v.object({
  method: v.object({
    ciLevelPct: v.number(),
    minDays: v.number(),
    windowDays: v.number(),
    agreeDays: v.number(),
    minFracPct: v.number(),
    minBefore: v.number(),
    seasonRunDays: v.number(),
    seasonThresholdC: v.number(),
  }),
  sites: v.object({
    anttila: Site,
    sarkisuo: Site,
    haltiala: Site,
    qvidja: Site,
    viikki: Site,
    maktau: Site,
  }),
  byKind: v.record(v.string(), Offsets),
  tests: v.object({ sowingRise: Offsets, recoRiseTillage: Offsets, gppDrop: Offsets, neeDrop: Offsets }),
  changes: v.record(v.string(), Change),
  alternativeDates: v.array(Alt),
  altNotes: v.array(v.object({ site: SITE, text: v.string(), source: v.string() })),
  counts: v.object({ eventsOutsideFluxPeriod: v.record(v.string(), v.array(v.string())) }),
  dataVersion: v.object({
    inputs: v.array(v.object({ path: v.string(), rows: v.number(), columns: v.array(v.string()) })),
    snapshot: v.object({
      builtAt: v.string(),
      calcBuiltAt: v.nullable(v.string()),
      url: v.nullable(v.string()),
      inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number() })),
    }),
  }),
});

export type EventTimingData = v.InferOutput<typeof DataSchema>;
type EpisodeOut = v.InferOutput<typeof Episode>;
type StepOut = v.InferOutput<typeof Step>;
type OffsetsOut = v.InferOutput<typeof Offsets>;
type StatOut = v.InferOutput<typeof Stat>;

export function eventTimingData(raw: unknown): EventTimingData {
  return v.parse(DataSchema, raw);
}

// ---------- Keys for <Num k="…" /> ----------

/** Dotted path of one episode, for example `sites.qvidja.episodes.14`. */
export function epKey(d: EventTimingData, id: string): string {
  for (const site of Object.keys(SITE_NAMES) as SiteCode[]) {
    const i = d.sites[site].episodes.findIndex((e) => e.id === id);
    if (i >= 0) return `sites.${site}.episodes.${i}`;
  }
  throw new Error(`event-timing: no episode ${id}`);
}

/** Dotted path of one event (site, date, type), for example `sites.anttila.events.3`. */
export function evKey(d: EventTimingData, site: SiteCode, date: string, type: string): string {
  const i = d.sites[site].events.findIndex((e) => e.date === date && e.type === type);
  if (i < 0) throw new Error(`event-timing: no event ${site} ${date} ${type}`);
  return `sites.${site}.events.${i}`;
}

/** Dotted path of one row of `alternativeDates`, for example `alternativeDates.8`. */
export function altKey(d: EventTimingData, site: SiteCode, dateUsed: string): string {
  const i = d.alternativeDates.findIndex((a) => a.site === site && a.dateUsed === dateUsed);
  if (i < 0) throw new Error(`event-timing: no alternative date ${site} ${dateUsed}`);
  return `alternativeDates.${i}`;
}

/** Dotted path of one year of a site, for example `sites.viikki.years.1`. */
export function yearKey(d: EventTimingData, site: SiteCode, year: number): string {
  const i = d.sites[site].years.findIndex((y) => y.year === year);
  if (i < 0) throw new Error(`event-timing: no year ${site} ${year}`);
  return `sites.${site}.years.${i}`;
}

// ---------- Number text ----------

const dash = '–';
const f0s = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 0, { sign: true }));
const f1 = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 1));
const f1s = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 1, { sign: true }));
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 2));
const f2s = (x: number | null | undefined) => (x === null || x === undefined ? dash : fmtNum(x, 2, { sign: true }));

/** "+3.59 ± 3.23 [2.47, 4.75]"; the SD with two or more values, the interval with three or more. */
function meanText(s: { n: number; mean: number | null; sd: number | null; ciLo: number | null; ciHi: number | null }, fmt: (x: number | null) => string): string {
  if (s.n === 0 || s.mean === null) return dash;
  let t = fmt(s.mean);
  if (s.n >= 2 && s.sd !== null) t += ` ± ${fmt(s.sd).replace(/^\+/, '')}`;
  if (s.n >= 3 && s.ciLo !== null && s.ciHi !== null) t += ` [${fmt(s.ciLo)}, ${fmt(s.ciHi)}]`;
  return t;
}

const TYPE_TEXT: Record<string, string> = {
  harvest: 'harvest',
  cut: 'cut',
  harvestCut: 'harvest or cut',
  grazing: 'grazing',
  tillage: 'tillage',
  sowing: 'sowing',
  fertilisation: 'fertilisation',
  spraying: 'spraying',
  other: 'other',
};
const REASON_TEXT: Record<string, string> = {
  'too-few-days': 'too few days with a value',
  'step-too-small': 'step below 25 % of the level',
  'flux-too-small': 'GPP level below 1 g C m⁻² d⁻¹',
  'no change-point test for this type': 'no change-point test for this type',
};
const SOURCE_TEXT: Record<string, string> = {
  shurpali2025: 'Shurpali et al. 2025',
  heimsch2021: 'Heimsch et al. 2021',
  heimsch2024: 'Heimsch et al. 2024',
  'qvidja-xlsx': 'Qvidja management file',
  'viikki-docx': 'Viikki management file',
  'haltiala-xlsx': 'Haltiala management file',
};

function stepText(s: StepOut, label: string): string | null {
  if (s === null) return null;
  if (s.offset === null || s.detected === null) return `${label}: ${REASON_TEXT[s.reason ?? ''] ?? 'no result'}`;
  const clear = s.clear ? 'clear' : `not clear (${REASON_TEXT[s.reason ?? ''] ?? s.reason ?? 'not clear'})`;
  return `${label} ${s.detected} (${f0s(s.offset)} d, ${clear})`;
}

// ---------- Rows ----------

export interface InputRow {
  path: string;
  sha256: string;
  rows: string;
}

/** The input files of the snapshot with their SHA-256 and row count (for "Reproduce"). */
export function inputRows(d: EventTimingData): InputRow[] {
  return d.dataVersion.snapshot.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0) }));
}

export interface InputColumnRow {
  path: string;
  rows: string;
  columns: string;
}

/** The input files with the row count and the columns that the script reads (for "Data and method"). */
export function inputColumnRows(d: EventTimingData): InputColumnRow[] {
  return d.dataVersion.inputs.map((i) => ({ path: i.path, rows: fmtNum(i.rows, 0), columns: i.columns.join(', ') }));
}

export interface SeasonRow {
  id: string;
  year: string;
  days: string;
  measured: string;
  season: string;
  events: string;
  episodes: string;
}

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** One row per year of a site: days with flux data, thermal season (Maktau: wet months), events per type. */
export function seasonRows(d: EventTimingData, site: SiteCode): SeasonRow[] {
  const s = d.sites[site];
  return s.years.map((y) => {
    let season: string;
    if (s.wetMonths !== null) {
      const wet = s.wetMonths.filter((m) => m.month.startsWith(`${y.year}-`));
      season = wet.length
        ? `wet months: ${wet.map((m) => `${MONTH[Number(m.month.slice(5)) - 1] ?? m.month} (${fmtNum(m.precipMm, 0)} mm)`).join(', ')}`
        : 'no month above the wet-month limit';
    } else {
      const start = y.seasonStart ?? 'no start (data begin after the first day of March)';
      const end = y.seasonEnd ?? 'no end in the year';
      season = `${start} to ${end}${y.seasonLength !== null ? ` (${fmtNum(y.seasonLength, 0)} d)` : ''}`;
    }
    const events = Object.entries(y.events)
      .map(([type, n]) => `${fmtNum(n, 0)} ${TYPE_TEXT[type] ?? type}`)
      .join(', ');
    return {
      id: `season-${site}-${y.year}`,
      year: String(y.year),
      days: fmtNum(y.nDays, 0),
      measured: fmtNum(y.nDaysMeasured, 0),
      season,
      events: events || dash,
      episodes: fmtNum(y.episodes, 0),
    };
  });
}

export interface EpisodeRow {
  id: string;
  dates: string;
  kind: string;
  types: string;
  anchor: string;
  gppBefore: string;
  dGpp: string;
  dReco: string;
  dNee: string;
  test: string;
  detected: string;
  offset: string;
  clear: string;
  other: string;
  nee: string;
  use: string;
}

const PRIMARY_TEXT: Record<string, string> = { gppDrop: 'GPP drop', sowingRise: 'GPP rise after sowing' };

function useText(e: EpisodeOut): string {
  if (!e.inFluxPeriod) return 'before the flux data';
  if (e.primary === null) return e.usedForChange ? '7-day change only' : dash;
  if (!e.searched) return 'no search (too few days)';
  if (e.spanOverlap) return `not in the offset summary (search reads days of ${e.spanOverlapWith.join(', ')})`;
  if (e.overlap) return 'not in the summaries (window overlap)';
  return e.usedForOffset ? 'in the summaries' : dash;
}

/** All episodes of one site, by date. */
export function episodeRows(d: EventTimingData, site: SiteCode): EpisodeRow[] {
  return d.sites[site].episodes.map((e) => {
    const others = [
      e.primary !== 'sowingRise' ? stepText(e.sowingRise, 'GPP rise after sowing') : null,
      stepText(e.recoRise, 'Reco rise'),
    ].filter((x): x is string => x !== null);
    const nee =
      e.neeDrop === null
        ? dash
        : e.neeDrop.offset === null
          ? REASON_TEXT[e.neeDrop.reason ?? ''] ?? 'no result'
          : `${f0s(e.neeDrop.offset)} d, ${e.neeDrop.clear ? 'clear' : 'not clear'}${e.agree === true ? ', agrees' : e.agree === false ? ', differs' : ''}`;
    const before = e.before.mean['gpp'];
    const primary = e.primary === 'sowingRise' ? e.sowingRise : e.primary === 'gppDrop' ? e.gppDrop : null;
    const pct = e.change.gppPct;
    return {
      id: e.id,
      dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
      kind: TYPE_TEXT[e.kind] ?? e.kind,
      types: e.types.map((t) => TYPE_TEXT[t] ?? t).join(', '),
      anchor: e.anchor,
      gppBefore: f2(before),
      dGpp: e.change.gpp === null ? dash : `${f2s(e.change.gpp)}${pct !== null ? ` (${f0s(pct)} %)` : ''}`,
      dReco: f2s(e.change.reco),
      dNee: f2s(e.change.nee),
      test: e.primary === null ? dash : (PRIMARY_TEXT[e.primary] ?? e.primary),
      detected: primary?.detected ?? dash,
      offset: primary?.offset === null || primary?.offset === undefined ? dash : `${f0s(primary.offset)} d`,
      clear:
        e.primary === null
          ? dash
          : e.clear
            ? 'yes'
            : `no: ${REASON_TEXT[primary?.reason ?? ''] ?? 'not clear'}`,
      other: others.length ? others.join('; ') : dash,
      nee,
      use: useText(e),
    };
  });
}

export interface AltRow {
  id: string;
  type: string;
  dateUsed: string;
  dateOther: string;
  source: string;
  test: string;
  toUsed: string;
  toOther: string;
  nearer: string;
}

const NEARER_TEXT = { used: 'the date in the database', other: 'the other date', equal: 'same distance' } as const;

/** Rows of ALTERNATIVE_DATES of one site. */
export function altRows(d: EventTimingData, site: SiteCode): AltRow[] {
  return d.alternativeDates
    .filter((a) => a.site === site)
    .map((a) => {
      const basis = a.nearerBasis === 'recoRise' && a.recoRise !== null ? a.recoRise : null;
      const gppText =
        a.test === null
          ? dash
          : a.detected === null
            ? REASON_TEXT[a.reason ?? ''] ?? 'no result'
            : `GPP drop ${a.detected}${a.clear ? '' : ` (not clear: ${REASON_TEXT[a.reason ?? ''] ?? a.reason ?? ''})`}`;
      const test = basis ? `${gppText}; Reco rise ${basis.detected ?? dash} (clear)` : gppText;
      const toUsed = basis ? basis.offset : a.offsetToUsed;
      const toOther = basis ? basis.offsetToOther : a.offsetToOther;
      return {
        id: `alt-${site}-${a.dateUsed}`,
        type: TYPE_TEXT[a.type] ?? a.type,
        dateUsed: a.dateEndUsed ? `${a.dateUsed} to ${a.dateEndUsed}` : a.dateUsed,
        dateOther: a.dateEndOther ? `${a.dateOther} to ${a.dateEndOther}` : a.dateOther,
        source: `${SOURCE_TEXT[a.sourceOther] ?? a.sourceOther}: ${a.page}${a.note ? `. ${a.note}` : ''}`,
        test,
        toUsed: toUsed === null ? dash : `${f0s(toUsed)} d`,
        toOther: toOther === null ? dash : `${f0s(toOther)} d`,
        nearer: a.nearer === null ? (a.test === null ? 'no test' : 'no clear change') : NEARER_TEXT[a.nearer],
      };
    });
}

/** The notes on other dates and amounts of one site (results.json altNotes). */
export function altNotes(d: EventTimingData, site: SiteCode): { text: string; source: string }[] {
  return d.altNotes.filter((n) => n.site === site).map((n) => ({ text: n.text, source: n.source }));
}

/** Dates of the events of a site that lie before its flux data, as text ("2021-06-03 (sowing), …"). */
export function outsideText(d: EventTimingData, site: SiteCode): string {
  const dates = d.counts.eventsOutsideFluxPeriod[site] ?? [];
  return dates
    .map((date) => {
      const ev = d.sites[site].events.find((e) => e.date === date);
      return ev ? `${date} (${TYPE_TEXT[ev.type] ?? ev.type})` : date;
    })
    .join(' and ');
}

/** Wet months of Maktau as text, for example "2019-04 (63 mm)". */
export function wetMonthsText(d: EventTimingData): string {
  return (d.sites.maktau.wetMonths ?? []).map((m) => `${m.month} (${fmtNum(m.precipMm, 0)} mm)`).join(', ');
}

export interface KindRow {
  id: string;
  kind: string;
  episodes: string;
  clear: string;
  mean: string;
  median: string;
  range: string;
  split: string;
}

function kindRow(id: string, label: string, s: OffsetsOut): KindRow {
  return {
    id: `kind-${id}`,
    kind: label,
    episodes: fmtNum(s.nEpisodes, 0),
    clear: `${fmtNum(s.nClear, 0)} of ${fmtNum(s.nSearched, 0)}`,
    mean: meanText(s, f1s),
    median: s.median === null ? dash : f0s(s.median),
    range: s.min === null || s.max === null ? dash : `${f0s(s.min)} to ${f0s(s.max)}`,
    split: s.n === 0 ? dash : `${fmtNum(s.nBefore, 0)} / ${fmtNum(s.nOn, 0)} / ${fmtNum(s.nAfter, 0)}`,
  };
}

/** Offset summary per episode kind and the extra tests. */
export function kindRows(d: EventTimingData): KindRow[] {
  const rows: KindRow[] = [];
  const kinds: [string, string][] = [
    ['harvest', 'Harvest: GPP drop'],
    ['cut', 'Cut: GPP drop'],
    ['harvestCut', 'Harvest or cut: GPP drop'],
    ['grazing', 'Grazing: GPP drop'],
    ['tillage', 'Tillage: GPP drop'],
    ['sowing', 'Sowing: GPP rise'],
  ];
  for (const [k, label] of kinds) {
    const s = d.byKind[k];
    if (!s) throw new Error(`event-timing: no byKind.${k}`);
    rows.push(kindRow(k, label, s));
  }
  rows.push(kindRow('sowing-rise-all', 'All episodes with a sowing: GPP rise', d.tests.sowingRise));
  rows.push(kindRow('reco-rise-tillage', 'All episodes with a tillage: Reco rise', d.tests.recoRiseTillage));
  rows.push(kindRow('gpp-drop-all', 'All GPP drop tests', d.tests.gppDrop));
  rows.push(kindRow('nee-drop-all', 'All drop tests of the measured NEE', d.tests.neeDrop));
  return rows;
}

export interface ChangeRow {
  id: string;
  kind: string;
  n: string;
  gpp: string;
  gppPct: string;
  reco: string;
  nee: string;
}

/** 7-day changes (after − before) per episode kind. */
export function changeRows(d: EventTimingData): ChangeRow[] {
  const order = ['harvest', 'cut', 'harvestCut', 'grazing', 'tillage', 'sowing', 'fertilisation', 'spraying', 'other'];
  return order.map((k) => {
    const c = d.changes[k];
    if (!c) throw new Error(`event-timing: no changes.${k}`);
    const pct = (s: StatOut) => (s.n === 0 ? dash : `${meanText(s, (x) => (x === null ? dash : fmtNum(x, 0, { sign: true })))} (n = ${fmtNum(s.n, 0)})`);
    return {
      id: `change-${k}`,
      kind: TYPE_TEXT[k] ?? k,
      n: fmtNum(c.n, 0),
      gpp: meanText(c.gpp, f2s),
      gppPct: pct(c.gppPct),
      reco: meanText(c.reco, f2s),
      nee: meanText(c.nee, f2s),
    };
  });
}

export { f1, f2 };
