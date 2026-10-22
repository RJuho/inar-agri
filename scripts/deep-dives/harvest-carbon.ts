// Deep Dive "Harvest and cutting vs carbon balance" (site/src/pages/deep-dive/harvest-carbon.mdx).
// Question: is a harvest or a cut associated with a change of NEE, GPP and Reco in the days
// and weeks after it?
//
// Inputs (read only): db/events.parquet, db/sites.parquet, data/calculated/daily.parquet and
// data/calculated/fluxes_30min.parquet. Output: the result object; scripts/deep-dives.ts writes it
// to site/src/deep-dives/harvest-carbon.json. Run: npm run deep-dives.
//
// Method:
// 1. Harvest and cut events of db/events.parquet. Events at one site that are not more than
//    MERGE_DAYS apart make one episode (one harvest period).
// 2. Daily sums of gap-filled NEE, GPP and Reco (g C m-2 d-1, data/calculated/daily.parquet) in a
//    window before the first day and windows after the last day of the episode. The days of the
//    episode are not used.
// 3. An episode goes into the main result when no other episode is near, both windows have enough
//    days, and the mean measured fraction of NEE is high enough in both windows.
// 4. Per site and for all sites: mean change (after − before), SD, bootstrap 95 % CI, n.
// 5. Check without gap filling: mean measured NEE (µmol m-2 s-1) in daytime and night-time half
//    hours of the same windows.
// 6. Change of NEE against the yield of the episode (only yields of one harvest).

import type { DuckDBConnection } from '@duckdb/node-api';
import { CONST } from '../lib/calc/constants.ts';
import { num, numOrNull, rows, str } from '../lib/duck.ts';
import {
  delta,
  exclusion,
  isoDay,
  mergeEpisodes,
  MERGE_DAYS,
  windowFree,
  windowStats,
  type DayRow,
  type Episode,
  type Exclusion,
  type FieldEvent,
  type Rules,
  type Window,
  type WindowStats,
} from '../lib/deep-dive/harvest.ts';
import { finite, mean, ols, pearson, pearsonP, sd, summarise } from '../lib/deep-dive/stats.ts';

export const slug = 'harvest-carbon';
export const title = 'Harvest and cutting vs carbon balance';

export const inputs = [
  'db/events.parquet',
  'db/sites.parquet',
  'data/calculated/daily.parquet',
  'data/calculated/fluxes_30min.parquet',
] as const;

/** Sites with dated harvest or cut events. */
const SITES = ['haltiala', 'qvidja', 'viikki'] as const;
type SiteCode = (typeof SITES)[number];

const BEFORE: Window = { from: -14, to: -1 };
const AFTER: Window = { from: 1, to: 14 };
const EARLY: Window = { from: 1, to: 7 };
const LATE: Window = { from: 8, to: 28 };
/** Days of the composite curves, relative to the first day of the episode. */
const COMPOSITE: Window = { from: -14, to: 28 };

const RULES: Rules = { before: BEFORE, after: AFTER, minDays: 12, minFrac: 0.1 };
/** Minimum measured half hours in each window for the check without gap filling. */
const MIN_MEASURED_DAY = 20;
const MIN_MEASURED_NIGHT = 10;
const BOOTSTRAP_RESAMPLES = 10_000;

type Flux = 'nee' | 'gpp' | 'reco';
const FLUXES: readonly Flux[] = ['nee', 'gpp', 'reco'];

interface MeasuredWindow {
  /** Mean measured NEE (µmol m-2 s-1) and number of half hours. */
  day: number | null;
  nDay: number;
  night: number | null;
  nNight: number;
}

function windowJson(w: WindowStats) {
  return { nDays: w.nDays, nee: w.nee, gpp: w.gpp, reco: w.reco, fracMeasured: w.frac, ta: w.ta };
}

function deltas(after: WindowStats, before: WindowStats) {
  return {
    nee: delta(after.nee, before.nee),
    gpp: delta(after.gpp, before.gpp),
    reco: delta(after.reco, before.reco),
    ta: delta(after.ta, before.ta),
  };
}

/** Summaries of the changes of a group of episodes. */
function groupSummary(eps: readonly EpisodeResult[], seed: number) {
  const pick = (f: (e: EpisodeResult) => number | null) => summarise(eps.map(f), seed);
  return {
    n: eps.length,
    nee: pick((e) => e.delta.nee),
    gpp: pick((e) => e.delta.gpp),
    reco: pick((e) => e.delta.reco),
    ta: pick((e) => e.delta.ta),
    before: { nee: mean(finite(eps.map((e) => e.before.nee))), gpp: mean(finite(eps.map((e) => e.before.gpp))), reco: mean(finite(eps.map((e) => e.before.reco))) },
    after: { nee: mean(finite(eps.map((e) => e.after.nee))), gpp: mean(finite(eps.map((e) => e.after.gpp))), reco: mean(finite(eps.map((e) => e.after.reco))) },
    early: { nee: pick((e) => e.deltaEarly.nee), gpp: pick((e) => e.deltaEarly.gpp), reco: pick((e) => e.deltaEarly.reco) },
    late: { nee: pick((e) => e.deltaLate?.nee ?? null), gpp: pick((e) => e.deltaLate?.gpp ?? null), reco: pick((e) => e.deltaLate?.reco ?? null) },
    measuredDay: pick((e) => e.measured.deltaDay),
    measuredNight: pick((e) => e.measured.deltaNight),
  };
}

function summariseKind(eps: readonly EpisodeResult[], seed: number) {
  return {
    n: eps.length,
    nee: summarise(eps.map((e) => e.delta.nee), seed),
    gpp: summarise(eps.map((e) => e.delta.gpp), seed + 100),
    reco: summarise(eps.map((e) => e.delta.reco), seed + 200),
  };
}

interface EpisodeResult {
  id: string;
  site: SiteCode;
  start: string;
  end: string;
  /** Days from the first to the last day of the episode. */
  lengthDays: number;
  events: { date: string; type: string; crop: string | null; dryMassKgHa: number | null; detail: string }[];
  types: string[];
  crop: string | null;
  yieldT: number | null;
  yearYieldT: number | null;
  used: boolean;
  exclusion: Exclusion;
  before: ReturnType<typeof windowJson>;
  after: ReturnType<typeof windowJson>;
  early: ReturnType<typeof windowJson>;
  late: ReturnType<typeof windowJson> | null;
  delta: ReturnType<typeof deltas>;
  deltaEarly: ReturnType<typeof deltas>;
  deltaLate: ReturnType<typeof deltas> | null;
  measured: { before: MeasuredWindow; after: MeasuredWindow; deltaDay: number | null; deltaNight: number | null };
  /** Other management events from the start of the before window to the end of the late window. */
  otherEvents: { date: string; type: string; detail: string }[];
}

export async function run(conn: DuckDBConnection): Promise<Record<string, unknown>> {
  const siteList = SITES.map((s) => `'${s}'`).join(', ');

  // ---------- Sites ----------
  // slot = position of the site in sites.parquet: the site colour, dash and symbol of the website use it.
  const siteRows = await rows(
    conn,
    `SELECT * FROM (SELECT site_id, code, name, row_number() OVER (ORDER BY site_id) - 1 AS slot FROM 'db/sites.parquet')
     WHERE code IN (${siteList}) ORDER BY site_id`,
  );
  const siteSlot = new Map(siteRows.map((r) => [str(r.code), num(r.slot)]));
  const siteName = new Map(siteRows.map((r) => [str(r.code), str(r.name)]));
  const siteId = new Map(siteRows.map((r) => [str(r.code), num(r.site_id)]));
  if (siteRows.length !== SITES.length) throw new Error(`expected ${SITES.length} sites in db/sites.parquet, got ${siteRows.length}`);

  // ---------- Events ----------
  const evRows = await rows(
    conn,
    `SELECT site_code, CAST(date AS VARCHAR) AS date, CAST(date_end AS VARCHAR) AS date_end, type, crop, dry_mass_kg_ha, detail
     FROM 'db/events.parquet' WHERE site_code IN (${siteList}) ORDER BY site_code, date, type`,
  );
  const toEvent = (r: Record<string, unknown>): FieldEvent => ({
    site: str(r.site_code),
    date: str(r.date),
    dateEnd: r.date_end === null ? null : str(r.date_end),
    type: str(r.type),
    crop: r.crop === null ? null : str(r.crop),
    dryMassKgHa: numOrNull(r.dry_mass_kg_ha),
    detail: str(r.detail ?? ''),
  });
  const allEvents = evRows.map(toEvent);
  const hcEvents = allEvents.filter((e) => e.type === 'harvest' || e.type === 'cut');
  const episodes = mergeEpisodes(hcEvents);

  // ---------- Daily sums ----------
  const dRows = await rows(
    conn,
    `SELECT site_code, CAST(date_local AS VARCHAR) AS d, nee_f_gc, gpp_gc, reco_gc, frac_measured, ta_mean
     FROM 'data/calculated/daily.parquet' WHERE site_code IN (${siteList})`,
  );
  const daily = new Map<string, Map<number, DayRow>>(SITES.map((s) => [s, new Map()]));
  for (const r of dRows) {
    const day = Math.round(Date.parse(`${str(r.d)}T00:00:00Z`) / 86_400_000);
    daily.get(str(r.site_code))!.set(day, {
      day,
      nee: numOrNull(r.nee_f_gc),
      gpp: numOrNull(r.gpp_gc),
      reco: numOrNull(r.reco_gc),
      frac: numOrNull(r.frac_measured),
      ta: numOrNull(r.ta_mean),
    });
  }

  // ---------- Measured NEE per local day (check without gap filling) ----------
  // Sum and count of the measured half hours per site, local day and day/night.
  const mRows = await rows(
    conn,
    `SELECT site_code, CAST(CAST(tl AS DATE) AS VARCHAR) AS d, night, sum(nee) AS s, count(nee) AS n
     FROM 'data/calculated/fluxes_30min.parquet'
     WHERE site_code IN (${siteList}) AND nee_fill = 'measured' AND nee IS NOT NULL AND night IS NOT NULL
     GROUP BY ALL`,
  );
  // Share of the measured half hours without a night flag: the day/night check leaves them out.
  const nightNull = await rows(
    conn,
    `SELECT count(*) FILTER (WHERE night IS NULL) / count(*) AS share
     FROM 'data/calculated/fluxes_30min.parquet'
     WHERE site_code IN (${siteList}) AND nee_fill = 'measured' AND nee IS NOT NULL`,
  );
  const nightNullPct = num(nightNull[0]!.share) * 100;
  const measured = new Map<string, { s: number; n: number }>();
  for (const r of mRows) {
    const day = Math.round(Date.parse(`${str(r.d)}T00:00:00Z`) / 86_400_000);
    measured.set(`${str(r.site_code)}|${day}|${r.night ? 'night' : 'day'}`, { s: num(r.s), n: num(r.n) });
  }
  const measuredWindow = (site: string, anchor: number, w: Window): MeasuredWindow => {
    const acc = { day: { s: 0, n: 0 }, night: { s: 0, n: 0 } };
    for (let d = anchor + w.from; d <= anchor + w.to; d++) {
      for (const part of ['day', 'night'] as const) {
        const m = measured.get(`${site}|${d}|${part}`);
        if (m) {
          acc[part].s += m.s;
          acc[part].n += m.n;
        }
      }
    }
    return {
      day: acc.day.n >= MIN_MEASURED_DAY ? acc.day.s / acc.day.n : null,
      nDay: acc.day.n,
      night: acc.night.n >= MIN_MEASURED_NIGHT ? acc.night.s / acc.night.n : null,
      nNight: acc.night.n,
    };
  };

  // ---------- Episodes ----------
  const results: EpisodeResult[] = [];
  for (const ep of episodes) {
    const site = ep.site as SiteCode;
    const byDay = daily.get(site)!;
    const before = windowStats(byDay, ep.start, BEFORE);
    const after = windowStats(byDay, ep.end, AFTER);
    const early = windowStats(byDay, ep.end, EARLY);
    // The late window needs no other episode in it and at least RULES.minDays days with all three fluxes.
    const lateStats = windowFree(ep, episodes, LATE) ? windowStats(byDay, ep.end, LATE) : null;
    const late = lateStats && lateStats.nDays >= RULES.minDays ? lateStats : null;
    const why = exclusion(ep, episodes, before, after, RULES);
    const mb = measuredWindow(site, ep.start, BEFORE);
    const ma = measuredWindow(site, ep.end, AFTER);
    const lo = ep.start + BEFORE.from;
    const hi = ep.end + LATE.to;
    const own = new Set(ep.events);
    const others = allEvents
      .filter((e) => e.site === site && !own.has(e))
      .filter((e) => {
        const d = Math.round(Date.parse(`${e.date}T00:00:00Z`) / 86_400_000);
        return d >= lo && d <= hi;
      })
      .map((e) => ({ date: e.date, type: e.type, detail: e.detail }));
    const crops = [...new Set(ep.events.map((e) => e.crop).filter((c): c is string => c !== null))];
    results.push({
      id: `${site}-${isoDay(ep.start)}`,
      site,
      start: isoDay(ep.start),
      end: isoDay(ep.end),
      lengthDays: ep.end - ep.start,
      events: ep.events.map((e) => ({ date: e.date, type: e.type, crop: e.crop, dryMassKgHa: e.dryMassKgHa, detail: e.detail })),
      types: [...new Set(ep.events.map((e) => e.type))].sort(),
      crop: crops.length ? crops.join(', ') : null,
      yieldT: ep.yieldKgHa === null ? null : ep.yieldKgHa / 1000,
      yearYieldT: ep.yearYieldKgHa === null ? null : ep.yearYieldKgHa / 1000,
      used: why === null,
      exclusion: why,
      before: windowJson(before),
      after: windowJson(after),
      early: windowJson(early),
      late: late ? windowJson(late) : null,
      delta: deltas(after, before),
      deltaEarly: deltas(early, before),
      deltaLate: late ? deltas(late, before) : null,
      measured: {
        before: mb,
        after: ma,
        deltaDay: delta(ma.day, mb.day),
        deltaNight: delta(ma.night, mb.night),
      },
      otherEvents: others,
    });
  }

  const used = results.filter((e) => e.used);
  // Sensitivity: all episodes without overlap and with enough days, also with a low measured fraction.
  const noOverlap = results.filter((e) => e.exclusion === null || e.exclusion === 'low-measured-fraction');

  // ---------- Test of the 2-hour time stamp offset of Viikki (finding VII-01) ----------
  // The raw Viikki stamps are UTC, but the build reads them as UTC+2: the values sit 2 hours early.
  // Make the daily sums again from the 30-min rows with the local day of tl + shift, and compare
  // the changes of the used Viikki episodes. Shift 0 must give the daily file again (control).
  const dailyFrom30 = async (site: string, shiftHours: number): Promise<Map<number, DayRow>> => {
    const r = await rows(
      conn,
      `SELECT CAST(CAST(tl + INTERVAL (${shiftHours}) HOUR AS DATE) AS VARCHAR) AS d, count(*) AS n,
              count(nee_f) AS n_nee, count(gpp) AS n_gpp, count(reco) AS n_reco,
              sum(nee_f) * ${CONST.hhToGc} AS nee, sum(gpp) * ${CONST.hhToGc} AS gpp, sum(reco) * ${CONST.hhToGc} AS reco,
              count(*) FILTER (WHERE nee_fill = 'measured') / count(*) AS frac, avg(ta) AS ta
       FROM 'data/calculated/fluxes_30min.parquet' WHERE site_code = '${site}' GROUP BY ALL`,
    );
    const m = new Map<number, DayRow>();
    for (const x of r) {
      const day = Math.round(Date.parse(`${str(x.d)}T00:00:00Z`) / 86_400_000);
      const full = num(x.n) === 48;
      m.set(day, {
        day,
        nee: full && num(x.n_nee) === 48 ? num(x.nee) : null,
        gpp: full && num(x.n_gpp) === 48 ? num(x.gpp) : null,
        reco: full && num(x.n_reco) === 48 ? num(x.reco) : null,
        frac: numOrNull(x.frac),
        ta: numOrNull(x.ta),
      });
    }
    return m;
  };
  const shiftSite = 'viikki';
  const shiftHours = 2;
  const control = await dailyFrom30(shiftSite, 0);
  let controlMaxDiff = 0;
  for (const [day, row] of daily.get(shiftSite)!) {
    const c = control.get(day);
    for (const f of FLUXES) {
      if (row[f] !== null && c?.[f] !== null && c?.[f] !== undefined) controlMaxDiff = Math.max(controlMaxDiff, Math.abs(row[f]! - c[f]!));
    }
  }
  const shifted = await dailyFrom30(shiftSite, shiftHours);
  const shiftEps = used.filter((e) => e.site === shiftSite);
  const shiftDeltas = shiftEps.map((e) => {
    const ep = episodes.find((x) => `${x.site}-${isoDay(x.start)}` === e.id)!;
    return deltas(windowStats(shifted, ep.end, AFTER), windowStats(shifted, ep.start, BEFORE));
  });
  let shiftMaxAbs = 0;
  shiftEps.forEach((e, i) => {
    for (const f of FLUXES) {
      const a = e.delta[f];
      const b = shiftDeltas[i]![f];
      if (a !== null && b !== null) shiftMaxAbs = Math.max(shiftMaxAbs, Math.abs(a - b));
    }
  });
  const utcShift = {
    site: shiftSite,
    hours: shiftHours,
    controlMaxAbsDiff: controlMaxDiff,
    episodes: shiftEps.length,
    nee: summarise(shiftDeltas.map((x) => x.nee), 51),
    gpp: summarise(shiftDeltas.map((x) => x.gpp), 52),
    reco: summarise(shiftDeltas.map((x) => x.reco), 53),
    maxAbsChange: shiftMaxAbs,
  };

  // ---------- Summaries ----------
  const sites: Record<string, unknown> = {};
  const sensitivity: Record<string, unknown> = {};
  SITES.forEach((s, i) => {
    const eps = used.filter((e) => e.site === s);
    sites[s] = {
      name: siteName.get(s),
      siteId: siteId.get(s),
      slot: siteSlot.get(s),
      events: hcEvents.filter((e) => e.site === s).length,
      episodes: results.filter((e) => e.site === s).length,
      ...groupSummary(eps, 11 + i),
    };
    const all = noOverlap.filter((e) => e.site === s);
    sensitivity[s] = { n: all.length, nee: summarise(all.map((e) => e.delta.nee), 21 + i) };
  });

  // ---------- Yield relation ----------
  const withYield = used.filter((e) => e.yieldT !== null && e.delta.nee !== null);
  const yieldRel = (eps: EpisodeResult[]) => {
    const xs = eps.map((e) => e.yieldT!);
    const ys = eps.map((e) => e.delta.nee!);
    const fit = ols(xs, ys);
    const r = pearson(xs, ys);
    return { n: eps.length, r, p: pearsonP(r, eps.length), slope: fit?.slope ?? null, intercept: fit?.intercept ?? null, yieldMin: xs.length ? Math.min(...xs) : null, yieldMax: xs.length ? Math.max(...xs) : null };
  };
  const yieldBySite: Record<string, unknown> = {};
  for (const s of SITES) yieldBySite[s] = yieldRel(withYield.filter((e) => e.site === s));

  // ---------- Composite curves (relative to the first day of the episode) ----------
  const offsets: number[] = [];
  for (let k = COMPOSITE.from; k <= COMPOSITE.to; k++) offsets.push(k);
  const composite: Record<string, unknown> = {};
  for (const s of SITES) {
    const eps = episodes.filter((ep) => ep.site === s && used.some((u) => u.id === `${s}-${isoDay(ep.start)}`));
    const byDay = daily.get(s)!;
    const curve = (f: Flux) => {
      const m: (number | null)[] = [];
      const d: (number | null)[] = [];
      const n: number[] = [];
      for (const k of offsets) {
        const xs = finite(eps.map((ep: Episode) => byDay.get(ep.start + k)?.[f] ?? null));
        m.push(mean(xs));
        d.push(sd(xs));
        n.push(xs.length);
      }
      return { mean: m, sd: d, n };
    };
    composite[s] = { episodes: eps.length, nee: curve('nee'), gpp: curve('gpp'), reco: curve('reco') };
  }

  const exclusions = { overlap: 0, 'too-few-days': 0, 'low-measured-fraction': 0 } as Record<Exclusion & string, number>;
  for (const e of results) if (e.exclusion) exclusions[e.exclusion]++;
  const usedFrac = finite(used.flatMap((e) => [e.before.fracMeasured, e.after.fracMeasured]));

  return {
    question: 'Is a harvest or a cut associated with a change of NEE, GPP and Reco in the days and weeks after it?',
    method: {
      sites: [...SITES],
      fluxes: [...FLUXES],
      mergeDays: MERGE_DAYS,
      beforeDays: BEFORE.to - BEFORE.from + 1,
      afterDays: AFTER.to - AFTER.from + 1,
      earlyDays: EARLY.to - EARLY.from + 1,
      lateFrom: LATE.from,
      lateTo: LATE.to,
      compositeFrom: COMPOSITE.from,
      compositeTo: COMPOSITE.to,
      minDays: RULES.minDays,
      minFracPct: RULES.minFrac * 100,
      minMeasuredDay: MIN_MEASURED_DAY,
      minMeasuredNight: MIN_MEASURED_NIGHT,
      bootstrapResamples: BOOTSTRAP_RESAMPLES,
      ciLevelPct: 95,
      /** Significance level for the p-values of the yield relation. */
      alpha: 0.05,
      /** Rref window of the night-time partitioning (scripts/lib/calc/constants.ts). */
      rrefWindowDays: 2 * CONST.rref.winDays + 1,
      rrefStepDays: CONST.rref.stepDays,
      units: { daily: 'g C m-2 d-1', measured: 'µmol CO2 m-2 s-1', yield: 't DW ha-1' },
    },
    counts: {
      events: hcEvents.length,
      harvests: hcEvents.filter((e) => e.type === 'harvest').length,
      cuts: hcEvents.filter((e) => e.type === 'cut').length,
      episodes: results.length,
      merged: hcEvents.length - results.length,
      used: used.length,
      excluded: results.length - used.length,
      exclusions,
      sensitivity: noOverlap.length,
      withYield: withYield.length,
      withOtherEvents: used.filter((e) => e.otherEvents.length > 0).length,
      withFertilisation: used.filter((e) => e.otherEvents.some((o) => o.type === 'fertilisation')).length,
      measuredDay: used.filter((e) => e.measured.deltaDay !== null).length,
      measuredNight: used.filter((e) => e.measured.deltaNight !== null).length,
      nightNullPct,
      fracMeasuredMeanPct: usedFrac.length ? mean(usedFrac)! * 100 : null,
      fracMeasuredMinPct: usedFrac.length ? Math.min(...usedFrac) * 100 : null,
    },
    sites,
    all: groupSummary(used, 7),
    // Episodes with a harvest (biomass removed) against episodes with cuts only (the cut stays on the field).
    kinds: {
      harvest: summariseKind(used.filter((e) => e.types.includes('harvest')), 41),
      cutOnly: summariseKind(used.filter((e) => !e.types.includes('harvest')), 42),
    },
    sensitivity: { sites: sensitivity, all: { n: noOverlap.length, nee: summarise(noOverlap.map((e) => e.delta.nee), 31) } },
    yield: { ...yieldRel(withYield), sites: yieldBySite, points: withYield.map((e) => ({ id: e.id, site: e.site, yieldT: e.yieldT, dNee: e.delta.nee })) },
    composite: { offsets, sites: composite },
    utcShift,
    episodes: results,
  };
}
