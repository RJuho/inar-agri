// Tables and keys of the Deep Dive "Rain pulse" (pages/deep-dive/rain-pulse.mdx). Input:
// analysis/rain-pulse/results.json (analysis/rain-pulse/rain-pulse.py). The figures are matplotlib
// SVG files of the same folder. Valibot checks the parts that the tables and the keys use; the
// schema is not strict, and the large parts (composite, pulses) get only a shape check.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';
import { siteEmoji } from '../../scripts/sites';

const N = v.nullable(v.number());
const SITES = Object.keys(SITE_NAMES) as SiteCode[];
const SITE = v.picklist(SITES);
export const VARS = ['reco', 'nee', 'gpp'] as const;
export type RainVar = (typeof VARS)[number];
export const THRESHOLDS = ['t2', 't5', 't10'] as const;

const Fit = v.object({
  method: v.picklist(['own', 'site', 'pooled', 'none']),
  e0: v.optional(N),
  e0Se: v.optional(N),
  rref: v.optional(N),
  n: v.number(),
  rmse: N,
  reason: v.string(),
});
const Used = v.object({ reco: v.number(), nee: v.number(), gpp: v.number() });
const EventCount = v.object({
  found: v.number(),
  droppedManagement: v.number(),
  droppedSwcCheck: N,
  kept: v.number(),
  used: Used,
  stops: v.record(v.string(), v.number()),
});
const VarSummary = v.object({
  day0: N,
  day0Se: N,
  day0N: v.number(),
  day7: N,
  day7Se: N,
  day7N: v.number(),
  lastDrawnLag: N,
  pulse: N,
  pulseSd: N,
  pulseSe: N,
  pulseN: v.number(),
  used: v.number(),
});
const SiteSummary = v.object({
  events: v.number(),
  reco: VarSummary,
  nee: VarSummary,
  gpp: VarSummary,
  measuredFracDay0: N,
  measuredFracPre: N,
  measuredFracRatio: N,
  lightRatioDay0: N,
  lightRatioSd: N,
  lightRatioN: v.number(),
  lightVariable: v.string(),
});
const Swc = v.object({ n: v.number(), slope: N, slopeSe: N, r: N, rP: N, rho: N, rhoP: N });
const Sens = v.object({ used: v.number(), day0: N, day0Se: N, day0N: v.number() });
const Composite = v.object({
  lag: v.array(v.number()),
  mean: v.array(N),
  sd: v.array(N),
  se: v.array(N),
  n: v.array(v.number()),
});
const perSite = <T extends v.GenericSchema>(s: T) => v.object(Object.fromEntries(SITES.map((c) => [c, s])) as Record<SiteCode, T>);
const perVar = <T extends v.GenericSchema>(s: T) => v.object({ reco: s, nee: s, gpp: s });

const DataSchema = v.object({
  method: v.object({
    sites: v.array(SITE),
    thresholds: v.array(v.number()),
    mainThreshold: v.number(),
    minCompositeN: v.number(),
    minNightHalfHours: v.number(),
    minRelationN: v.number(),
    minDayHalfHours: v.number(),
    minPrecipHalfHours: v.number(),
    minSwcHalfHours: v.number(),
    minPreDays: v.number(),
    swcRise: v.number(),
    ustarMin: v.number(),
    managementTypes: v.array(v.string()),
    lloydTaylor: v.object({ tref: v.number(), t0: v.number(), trimPercent: v.number(), minN: v.number(), minRange: v.number() }),
  }),
  fits: v.record(SITE, v.record(v.string(), Fit)),
  pooledE0: v.number(),
  fitMethodCounts: v.object({ own: v.number(), site: v.number(), pooled: v.number(), none: v.number() }),
  swcMedian: perSite(v.number()),
  events: perSite(v.object({ t2: EventCount, t5: EventCount, t10: EventCount })),
  composite: perVar(v.object({ t2: perSite(Composite), t5: perSite(Composite), t10: perSite(Composite) })),
  pulses: v.record(v.string(), v.any()),
  swc: perVar(perSite(Swc)),
  summary: perSite(SiteSummary),
  sensitivity: v.object({ prePulseMin1: perSite(perVar(Sens)) }),
  figures: v.array(v.object({ n: v.number(), file: v.string(), title: v.string(), desc: v.string() })),
  dataVersion: v.object({
    inputs: v.array(v.object({ path: v.string(), sha256: v.string(), rows: v.number(), columns: v.array(v.string()) })),
    snapshot: v.object({ builtAt: v.string(), calcBuiltAt: v.nullable(v.string()), url: v.nullable(v.string()) }),
  }),
});

export type RainPulseData = v.InferOutput<typeof DataSchema>;

/** Check the JSON and the agreement of the fit counts and the event counts. */
export function rainPulseData(raw: unknown): RainPulseData {
  const d = v.parse(DataSchema, raw);
  const counts = { own: 0, site: 0, pooled: 0, none: 0 };
  for (const site of SITES) for (const f of Object.values(d.fits[site] ?? {})) counts[f.method] += 1;
  for (const k of Object.keys(counts) as (keyof typeof counts)[]) {
    if (counts[k] !== d.fitMethodCounts[k]) throw new Error(`rain-pulse: ${k} fits ${counts[k]}, fitMethodCounts ${d.fitMethodCounts[k]}`);
  }
  for (const site of SITES) {
    const e = d.events[site].t5;
    if (e.found - e.droppedManagement - (e.droppedSwcCheck ?? 0) !== e.kept || e.kept !== d.summary[site].events) {
      throw new Error(`rain-pulse: the 5 mm event counts of ${site} do not agree`);
    }
    for (const x of VARS) {
      if (e.used[x] !== d.summary[site][x].used) throw new Error(`rain-pulse: used ${x} events of ${site} do not agree`);
    }
  }
  return d;
}

/** JSON key of a composite value at a lag (the arrays start at lag −3). */
export function lagKey(d: RainPulseData, x: RainVar, site: SiteCode, lag: number, field: 'mean' | 'se' | 'sd' | 'n', t = 't5'): string {
  const c = d.composite[x][t as 't5'][site];
  const i = c.lag.indexOf(lag);
  if (i < 0) throw new Error(`rain-pulse: no lag ${lag} in composite.${x}.${t}.${site}`);
  return `composite.${x}.${t}.${site}.${field}.${i}`;
}

const dash = '–';
const f = (x: number | null | undefined, digits: number) => (x === null || x === undefined ? dash : fmtNum(x, digits));
/** "1.19 ± 0.04 (n = 32)"; without SE (n = 1) "3.07 (single event)"; without value "–". */
function meanSe(m: number | null, se: number | null, n: number, digits: number): string {
  if (m === null) return `${dash} (n = ${n})`;
  return se === null ? `${fmtNum(m, digits)} (single event)` : `${fmtNum(m, digits)} ± ${fmtNum(se, digits)} (n = ${n})`;
}
const site = (code: SiteCode) => ({ emoji: siteEmoji(code), site: SITE_NAMES[code] });

export const VAR_LABEL: Record<RainVar, string> = { reco: 'Night Reco (ratio)', nee: 'NEE (difference)', gpp: 'GPP (difference)' };
const DIGITS: Record<RainVar, number> = { reco: 2, nee: 2, gpp: 2 };
const SOURCE_TEXT = { own: 'own fit', site: 'site fit', pooled: 'pooled', none: 'no model' } as const;

export interface FitRow { id: string; emoji: string; site: string; year: string; source: string; e0: string; rref: string; n: string; rmse: string }
/** One row per site and calendar year of the temperature model. */
export function fitRows(d: RainPulseData): FitRow[] {
  return SITES.flatMap((code) =>
    Object.entries(d.fits[code] ?? {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, x]) => ({
        id: `fit-${code}-${year}`,
        ...site(code),
        year,
        source: SOURCE_TEXT[x.method],
        e0: x.e0 == null ? dash : x.e0Se == null ? fmtNum(x.e0, 0) : `${fmtNum(x.e0, 0)} ± ${fmtNum(x.e0Se, 0)}`,
        rref: f(x.rref, 2),
        n: fmtNum(x.n, 0),
        rmse: f(x.rmse, 2),
      })),
  );
}

export interface EventRow { id: string; emoji: string; site: string; threshold: string; found: string; management: string; swcCheck: string; kept: string; reco: string; nee: string; gpp: string }
/** One row per site and threshold: events found, dropped and used per variable. */
export function eventRows(d: RainPulseData): EventRow[] {
  return SITES.flatMap((code) =>
    THRESHOLDS.map((t) => {
      const e = d.events[code][t];
      return {
        id: `ev-${code}-${t.slice(1)}`,
        ...site(code),
        threshold: `≥ ${t.slice(1)} mm`,
        found: fmtNum(e.found, 0),
        management: fmtNum(e.droppedManagement, 0),
        swcCheck: e.droppedSwcCheck === null ? dash : fmtNum(e.droppedSwcCheck, 0),
        kept: fmtNum(e.kept, 0),
        reco: fmtNum(e.used.reco, 0),
        nee: fmtNum(e.used.nee, 0),
        gpp: fmtNum(e.used.gpp, 0),
      };
    }),
  );
}

export interface SummaryRow { id: string; emoji: string; site: string; variable: string; used: string; day0: string; pulse: string; day7: string; last: string }
/** One row per site and variable for the 5 mm events. */
export function summaryRows(d: RainPulseData): SummaryRow[] {
  return VARS.flatMap((x) =>
    SITES.map((code) => {
      const s = d.summary[code][x];
      const g = DIGITS[x];
      return {
        id: `sum-${x}-${code}`,
        ...site(code),
        variable: VAR_LABEL[x],
        used: fmtNum(s.used, 0),
        day0: meanSe(s.day0, s.day0Se, s.day0N, g),
        pulse: meanSe(s.pulse, s.pulseSe, s.pulseN, g),
        day7: meanSe(s.day7, s.day7Se, s.day7N, g),
        last: s.lastDrawnLag === null ? 'none' : fmtNum(s.lastDrawnLag, 0),
      };
    }),
  );
}

export interface SwcRow { id: string; emoji: string; site: string; variable: string; n: string; slope: string; r: string; rho: string; rhoP: string }
/** One row per variable and site: relation of the pulse to the SWC anomaly (5 mm events). */
export function swcRows(d: RainPulseData, minN = d.method.minRelationN): SwcRow[] {
  return VARS.flatMap((x) =>
    SITES.map((code) => {
      const s = d.swc[x][code];
      const few = s.n < minN || s.slope === null || s.r === null || s.rho === null || s.rhoP === null;
      return {
        id: `swc-${x}-${code}`,
        ...site(code),
        variable: VAR_LABEL[x],
        n: fmtNum(s.n, 0),
        slope: few ? 'too few' : `${fmtNum(s.slope!, 1)} ± ${f(s.slopeSe, 1)}`,
        r: few ? dash : fmtNum(s.r!, 2),
        rho: few ? dash : fmtNum(s.rho!, 2),
        rhoP: few ? dash : s.rhoP! < 0.001 ? '< 0.001' : fmtNum(s.rhoP!, 3),
      };
    }),
  );
}

export interface SensRow { id: string; emoji: string; site: string; variable: string; usedMain: string; day0Main: string; usedOne: string; day0One: string }
/** Day 0 with the main rule (2 of 3 pre-pulse days) and with 1 of 3 days, 5 mm events. */
export function sensitivityRows(d: RainPulseData): SensRow[] {
  return VARS.flatMap((x) =>
    SITES.map((code) => {
      const m = d.summary[code][x];
      const o = d.sensitivity.prePulseMin1[code][x];
      const g = DIGITS[x];
      return {
        id: `sens-${x}-${code}`,
        ...site(code),
        variable: VAR_LABEL[x],
        usedMain: fmtNum(m.used, 0),
        day0Main: meanSe(m.day0, m.day0Se, m.day0N, g),
        usedOne: fmtNum(o.used, 0),
        day0One: meanSe(o.day0, o.day0Se, o.day0N, g),
      };
    }),
  );
}

export interface InputRow { path: string; sha256: string; rows: string; columns: string }
/** Input files of the snapshot (Reproduce). */
export function inputRows(d: RainPulseData): InputRow[] {
  return d.dataVersion.inputs.map((i) => ({ path: i.path, sha256: i.sha256, rows: fmtNum(i.rows, 0), columns: i.columns.join(', ') }));
}

export const FINNISH: SiteCode[] = SITES.filter((s) => s !== 'maktau');
/**
 * Keys of the smallest and the largest value of `summary.<site>.<path>` over the Finnish sites,
 * for a range in the text ("from <Num k={r.min}/> to <Num k={r.max}/>"). Sites without a value are skipped.
 */
export function finnishRange(d: RainPulseData, path: string): { min: string; max: string; minSite: SiteCode; maxSite: SiteCode; n: number } {
  const get = (s: SiteCode): number | null => {
    let cur: unknown = d.summary[s];
    for (const p of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
    return typeof cur === 'number' ? cur : null;
  };
  const vals = FINNISH.map((s) => ({ s, x: get(s) })).filter((o): o is { s: SiteCode; x: number } => o.x !== null);
  if (vals.length === 0) throw new Error(`rain-pulse: no Finnish value for summary.<site>.${path}`);
  const lo = vals.reduce((a, b) => (b.x < a.x ? b : a));
  const hi = vals.reduce((a, b) => (b.x > a.x ? b : a));
  return { min: `summary.${lo.s}.${path}`, max: `summary.${hi.s}.${path}`, minSite: lo.s, maxSite: hi.s, n: vals.length };
}
