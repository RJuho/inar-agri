// Deep Dive "NEE without harvest or drought" (site/src/pages/deep-dive/nee-without-harvest-drought.mdx).
// Question: how much net CO2 uptake went away after each harvest and in each dry month at Haltiala,
// Qvidja and Viikki, and what would the seasonal NEE have been without them?
//
// Inputs (read only): db/sites.parquet, db/events.parquet, data/calculated/daily.parquet,
// data/calculated/fluxes_30min.parquet and data/SPI/SPI_all_stations.csv (SPI of the FMI stations,
// made by data/SPI/SPIanalysis.R). Output: the result object; scripts/deep-dives.ts writes it to
// site/src/deep-dives/nee-without-harvest-drought.json. Run: npm run deep-dives.
//
// Method:
// A. Harvest counterfactual per episode (harvest and cut events, merged when ≤ 7 days apart).
//    PRE = local days −14..−1 before the first day. AFTER = days 1..28 after the last day, cut at the
//    day before the next episode of the site. A model fitted on the PRE half hours (GPP = rectangular
//    hyperbola of the site light driver, Reco = Lloyd-Taylor with the E0 of the partitioning) gives
//    the NEE that the pre-cut canopy would have had in the AFTER weather. Daily deficit = mean of
//    (nee_f − model NEE) × 48 half hours, in g C m-2 d-1; positive = uptake lost. Helpers:
//    scripts/lib/deep-dive/counterfactual.ts.
// B. Drought anomaly per site-month (March to November, ≥ 25 days of daily NEE). Dry = SPI-1 ≤ −1 at
//    the station of the site. NEE_adj = NEE_obs − harvest deficit of the month. Anomaly of a dry month
//    = NEE_adj − mean NEE_adj of the same calendar month in the non-dry years of the site (same crop
//    class when ≥ 2 years, else all non-dry years when ≥ 2, else no anomaly). Regression of the
//    monthly anomaly (NEE_adj − site calendar-month mean) on SPI-1.
// C. Season table per site × year × season: NEE_without = NEE_obs − H − D. Site totals and
//    all-sites summaries over complete seasons with a known harvest record.

import { readFileSync } from 'node:fs';
import type { DuckDBConnection } from '@duckdb/node-api';
import { CONST } from '../lib/calc/constants.ts';
import { log, num, numOrNull, rows, str } from '../lib/duck.ts';
import {
  allocateByMonth,
  CROP_CLASS,
  cropClass,
  dailyDeficit,
  deficitSummary,
  fitEpisodeModel,
  isNoFit,
  monthAnomaly,
  seasonTable,
  bootstrapOlsCi,
  SUMMARY_DEFAULTS,
  type CropClass,
  type DailyDeficit,
  type HalfHour,
  type MonthRow,
  type SeasonInput,
  type SummaryOptions,
} from '../lib/deep-dive/counterfactual.ts';
import { dayNumber, isoDay, mergeEpisodes, MERGE_DAYS, type FieldEvent } from '../lib/deep-dive/harvest.ts';
import { excessSum, windowMeans, type VarRow } from '../lib/deep-dive/disturbance.ts';
import { DRY_THRESHOLD, dryMonths, isDry, parseSpiCsv, seasonMonths, SEASONS, STATION_OF_SITE, type Season, type SpiMonth, type Station } from '../lib/deep-dive/spi.ts';
import { finite, mean, median, ols, pearson, pearsonP, summarise } from '../lib/deep-dive/stats.ts';

export const slug = 'nee-without-harvest-drought';
export const title = 'NEE without harvest or drought';

export const inputs = [
  'db/sites.parquet',
  'db/events.parquet',
  'data/calculated/daily.parquet',
  'data/calculated/fluxes_30min.parquet',
  'data/SPI/SPI_all_stations.csv',
] as const;

const SITES = ['haltiala', 'qvidja', 'viikki'] as const;
type SiteCode = (typeof SITES)[number];
const NORTH = ['anttila', 'sarkisuo'] as const;

/** Light driver per site (one driver per site) and the bin width of the light fit. */
const LIGHT: Record<SiteCode, { column: 'ppfd' | 'sw_in'; bin: number; unit: string }> = {
  haltiala: { column: 'ppfd', bin: 50, unit: 'µmol m-2 s-1' },
  qvidja: { column: 'sw_in', bin: 25, unit: 'W m-2' },
  viikki: { column: 'ppfd', bin: 50, unit: 'µmol m-2 s-1' },
};

const PRE_DAYS = 14;
const MIN_PRE_DAYS = 10;
const MIN_BINS = 8;
const MIN_HALF_HOURS = 40;
const SUMMARY: SummaryOptions = SUMMARY_DEFAULTS;
/** Measured-only sensitivity: valid when this share of the AFTER half hours is measured. */
const MEASURED_MIN_SHARE = 0.1;
const SPI_REF = { from: 1981, to: 2010 };
const MIN_MONTH_DAYS = 25;
const MIN_REF_YEARS = 2;
const YEARS = { from: 2018, to: 2025 };
const GROWING_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11];
/** Years without a known harvest record: kept out of the reference sets and the totals. */
const EVENTS_UNKNOWN_YEARS: Record<SiteCode, number[]> = { haltiala: [], qvidja: [2025], viikki: [] };
/** Station distances (haversine from the registry coordinates and the FMI station coordinates). */
const STATION_DISTANCE_KM: Record<string, number> = { haltiala: 6, viikki: 13, qvidja: 14, anttila: 0.3, sarkisuo: 6 };
const STATION_KEY: Record<Station, 'vantaa' | 'kaarina' | 'kuopio'> = { Vantaa: 'vantaa', 'Kaarina Yltöinen': 'kaarina', 'Kuopio Maaninka': 'kuopio' };
const K_DAY = 48 * CONST.hhToGc;

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

interface EpisodeOut {
  id: string;
  site: SiteCode;
  start: string;
  end: string;
  year: number;
  types: string[];
  crop: string | null;
  cropClass: CropClass;
  /** Day of the next episode of the site (ISO) or null. */
  nextStart: string | null;
  daysUsed: number;
  validDays: number;
  included: boolean;
  excluded: string | null;
  excludedDetail: string | null;
  fit: Record<string, number | boolean | null> | null;
  d14: number | null;
  d28: number | null;
  gpp28: number | null;
  reco28: number | null;
  share14: number | null;
  recoveryDay: number | null;
  /** Deficit per day of the window (g C m-2 d-1), after the fill of missing days. */
  daily: number[];
  cum: number[];
  measured: { preShare: number; afterShare: number; valid: boolean; d28: number | null; meanResidual: number | null; nRows: number };
  lightMissingAfterShare: number;
  excess28: number | null;
  d28MinusExcess: number | null;
  months: Record<string, number>;
}

export async function run(conn: DuckDBConnection): Promise<Record<string, unknown>> {
  const siteList = [...SITES, ...NORTH].map((s) => `'${s}'`).join(', ');

  // ---------- Sites ----------
  const siteRows = await rows(
    conn,
    `SELECT * FROM (SELECT site_id, code, name, utc_offset_min, row_number() OVER (ORDER BY site_id) - 1 AS slot FROM 'db/sites.parquet')
     WHERE code IN (${siteList}) ORDER BY site_id`,
  );
  if (siteRows.length !== SITES.length + NORTH.length) throw new Error(`expected ${SITES.length + NORTH.length} sites, got ${siteRows.length}`);
  const siteInfo = new Map(siteRows.map((r) => [str(r.code), { id: num(r.site_id), name: str(r.name), slot: num(r.slot), utcOffsetMin: num(r.utc_offset_min) }]));

  // ---------- SPI ----------
  const spi = parseSpiCsv(readFileSync('data/SPI/SPI_all_stations.csv', 'utf8'));
  const spiOf = (site: string, y: number, m: number): SpiMonth | null => spi.get(STATION_OF_SITE[site]!)?.get(ym(y, m)) ?? null;
  const stations: Record<string, unknown> = {};
  for (const [station, months] of spi) {
    const key = STATION_KEY[station];
    const dry = dryMonths(months, YEARS.from, YEARS.to);
    const seriesMonths: string[] = [];
    const seriesSpi1: (number | null)[] = [];
    const seriesSpi3: (number | null)[] = [];
    for (let y = YEARS.from; y <= YEARS.to; y++) {
      for (let m = 1; m <= 12; m++) {
        const r = months.get(ym(y, m)) ?? null;
        seriesMonths.push(ym(y, m));
        seriesSpi1.push(r?.spi1 ?? null);
        seriesSpi3.push(r?.spi3 ?? null);
      }
    }
    const spi1s = finite(seriesSpi1);
    stations[key] = {
      name: station,
      sites: Object.keys(STATION_OF_SITE).filter((s) => STATION_OF_SITE[s] === station),
      nDry: dry.length,
      dryMonths: Object.fromEntries(dry.map((k) => [k, months.get(k)!.spi1])),
      minSpi1: Math.min(...spi1s),
      maxSpi1: Math.max(...spi1s),
      series: { months: seriesMonths, spi1: seriesSpi1, spi3: seriesSpi3 },
    };
    log(`SPI ${station}: ${dry.length} dry months ${YEARS.from}–${YEARS.to}: ${dry.join(' ')}`);
  }

  // ---------- Events and episodes ----------
  const mainList = SITES.map((s) => `'${s}'`).join(', ');
  const evRows = await rows(
    conn,
    `SELECT site_code, CAST(date AS VARCHAR) AS date, CAST(date_end AS VARCHAR) AS date_end, type, crop, dry_mass_kg_ha, detail
     FROM 'db/events.parquet' WHERE site_code IN (${mainList}) AND type IN ('harvest', 'cut') ORDER BY site_code, date, type`,
  );
  const events: FieldEvent[] = evRows.map((r) => ({
    site: str(r.site_code),
    date: str(r.date),
    dateEnd: r.date_end === null ? null : str(r.date_end),
    type: str(r.type),
    crop: r.crop === null ? null : str(r.crop),
    dryMassKgHa: numOrNull(r.dry_mass_kg_ha),
    detail: str(r.detail ?? ''),
  }));
  const episodes = mergeEpisodes(events);
  log(`${events.length} harvest and cut events, ${episodes.length} episodes`);

  // ---------- Daily NEE (daily.parquet) ----------
  const dRows = await rows(
    conn,
    `SELECT site_code, CAST(date_local AS VARCHAR) AS d, nee_f_gc FROM 'data/calculated/daily.parquet' WHERE site_code IN (${siteList})`,
  );
  const daily = new Map<string, Map<number, VarRow>>();
  for (const r of dRows) {
    const s = str(r.site_code);
    if (!daily.has(s)) daily.set(s, new Map());
    daily.get(s)!.set(dayNumber(str(r.d)), { nee: numOrNull(r.nee_f_gc) });
  }

  // ---------- Episodes: half hours, model, deficit ----------
  const results: EpisodeOut[] = [];
  for (const ep of episodes) {
    const site = ep.site as SiteCode;
    const id = `${site}-${isoDay(ep.start)}`;
    const next = episodes.find((o) => o.site === site && o.start > ep.end);
    const first = ep.end + 1;
    const maxDays = next ? Math.min(SUMMARY.afterDays, next.start - 1 - ep.end) : SUMMARY.afterDays;
    const preLo = ep.start - PRE_DAYS;
    const light = LIGHT[site];
    const hh = await rows(
      conn,
      `SELECT CAST(CAST(tl AS DATE) AS VARCHAR) AS d, ${light.column} AS light, temp_f, nee_f, nee_fill = 'measured' AS meas, gpp, reco, e0
       FROM 'data/calculated/fluxes_30min.parquet'
       WHERE site_code = '${site}' AND CAST(tl AS DATE) BETWEEN DATE '${isoDay(preLo)}' AND DATE '${isoDay(first + SUMMARY.afterDays - 1)}'
       ORDER BY tl`,
    );
    const toHH = (r: Record<string, unknown>): HalfHour => ({
      day: dayNumber(str(r.d)),
      light: numOrNull(r.light),
      temp: numOrNull(r.temp_f),
      nee: numOrNull(r.nee_f),
      neeMeasured: r.meas === true,
      gpp: numOrNull(r.gpp),
      reco: numOrNull(r.reco),
      e0: numOrNull(r.e0),
    });
    const all = hh.map(toHH);
    const pre = all.filter((r) => r.day >= preLo && r.day < ep.start);
    const after = all.filter((r) => r.day >= first && r.day < first + maxDays);
    const share = (xs: HalfHour[], f: (r: HalfHour) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);
    const preShare = share(pre, (r) => r.neeMeasured);
    const afterShare = share(after, (r) => r.neeMeasured);
    const lightMissingAfterShare = share(after, (r) => r.light === null);
    const year = Number(isoDay(ep.start).slice(0, 4));
    const crops = [...new Set(ep.events.map((e) => e.crop).filter((c): c is string => c !== null))];
    const base = {
      id,
      site,
      start: isoDay(ep.start),
      end: isoDay(ep.end),
      year,
      types: [...new Set(ep.events.map((e) => e.type))].sort(),
      crop: crops.length ? crops.join(', ') : null,
      cropClass: cropClass(site, year),
      nextStart: next ? isoDay(next.start) : null,
      lightMissingAfterShare,
    };
    const model = fitEpisodeModel(pre, { binWidth: light.bin, minPreDays: MIN_PRE_DAYS, minBins: MIN_BINS });
    const empty = { d14: null, d28: null, gpp28: null, reco28: null, share14: null, recoveryDay: null, daily: [], cum: [], excess28: null, d28MinusExcess: null, months: {} };
    if (isNoFit(model)) {
      results.push({
        ...base,
        daysUsed: maxDays,
        validDays: 0,
        included: false,
        excluded: 'no-fit',
        excludedDetail: model.reason,
        fit: null,
        ...empty,
        measured: { preShare, afterShare, valid: false, d28: null, meanResidual: null, nRows: 0 },
      });
      continue;
    }
    const fit = {
      alpha: model.alpha,
      beta: model.beta,
      betaBound: model.betaBound,
      r2: model.r2,
      nBins: model.nBins,
      rref: model.rref,
      e0: model.e0,
      nPreDays: model.nPreDays,
      biasNee: model.biasNee,
      rmseNee: model.rmseNee,
      nNee: model.nNee,
    };
    const dd = dailyDeficit(model, after, { minHalfHours: MIN_HALF_HOURS });
    const sum = deficitSummary(dd, first, maxDays, SUMMARY);
    // Measured-only sensitivity: mean residual of the measured AFTER half hours, scaled to the window.
    const ddm = dailyDeficit(model, after, { minHalfHours: 1, measuredOnly: true });
    const nm = ddm.reduce((a, d) => a + d.n, 0);
    const meanResidual = nm ? ddm.reduce((a, d) => a + (d.deficit / K_DAY) * d.n, 0) / nm : null;
    const measuredValid = afterShare >= MEASURED_MIN_SHARE && meanResidual !== null;
    const measured = {
      preShare,
      afterShare,
      valid: measuredValid,
      d28: measuredValid ? meanResidual! * K_DAY * sum.daysUsed : null,
      meanResidual,
      nRows: nm,
    };
    // Comparison with dive #1: excess of daily NEE over the mean of the PRE days, same AFTER days.
    const byDay = daily.get(site)!;
    const ref = windowMeans(byDay, ep.start, { from: -PRE_DAYS, to: -1 }, ['nee']).mean.nee ?? null;
    const excess28 = sum.daysUsed > 0 ? excessSum(byDay, ep.end, { from: 1, to: sum.daysUsed }, 'nee', ref, Math.ceil(SUMMARY.minValidShare * sum.daysUsed)) : null;
    if (sum.excluded) {
      results.push({
        ...base,
        daysUsed: sum.daysUsed,
        validDays: sum.validDays,
        included: false,
        excluded: sum.excluded,
        excludedDetail: `${sum.validDays} of ${sum.daysUsed} days valid`,
        fit,
        ...empty,
        excess28,
        measured,
      });
      continue;
    }
    // Daily values after the fill of missing days (the differences of the cumulative curve).
    const dailyFilled = sum.cum.map((c, i) => c - (i ? sum.cum[i - 1]! : 0));
    const filled: DailyDeficit[] = dailyFilled.map((x, i) => ({ day: first + i, n: 0, deficit: x, gppPart: null, recoPart: null, nParts: 0, valid: true }));
    results.push({
      ...base,
      daysUsed: sum.daysUsed,
      validDays: sum.validDays,
      included: true,
      excluded: null,
      excludedDetail: null,
      fit,
      d14: sum.d14,
      d28: sum.d28,
      gpp28: sum.gpp28,
      reco28: sum.reco28,
      share14: sum.share14,
      recoveryDay: sum.recoveryDay,
      daily: dailyFilled,
      cum: sum.cum,
      measured,
      excess28,
      d28MinusExcess: excess28 !== null && sum.d28 !== null ? sum.d28 - excess28 : null,
      months: allocateByMonth(filled),
    });
  }
  const included = results.filter((e) => e.included);
  log(`episodes: ${results.length}, included ${included.length}; excluded: ${results.filter((e) => !e.included).map((e) => `${e.id} (${e.excluded}: ${e.excludedDetail})`).join(', ') || 'none'}`);
  for (const e of results) log(`  ${e.id} ${e.cropClass} days ${e.daysUsed} d28 ${e.d28?.toFixed(1) ?? '–'} excess ${e.excess28?.toFixed(1) ?? '–'} meas ${(e.measured.afterShare * 100).toFixed(0)} %`);

  // ---------- Harvest summaries ----------
  const harvestSummary = (eps: EpisodeOut[], seed: number) => ({
    nEpisodes: eps.length,
    d28: summarise(eps.map((e) => e.d28), seed),
    d14: summarise(eps.map((e) => e.d14), seed + 1),
    gpp28: summarise(eps.map((e) => e.gpp28), seed + 2),
    reco28: summarise(eps.map((e) => e.reco28), seed + 3),
    share14: summarise(eps.map((e) => e.share14), seed + 4),
    recoveryDay: summarise(eps.map((e) => e.recoveryDay), seed + 5),
    nNoRecovery: eps.filter((e) => e.recoveryDay === null).length,
    measuredD28: summarise(eps.map((e) => e.measured.d28), seed + 6),
    nMeasuredValid: eps.filter((e) => e.measured.valid).length,
    vsDive1: summarise(eps.map((e) => e.d28MinusExcess), seed + 7),
    excess28: summarise(eps.map((e) => e.excess28), seed + 8),
  });
  const bySite: Record<string, unknown> = {};
  const composite: Record<string, unknown> = {};
  const dayAxis = Array.from({ length: SUMMARY.afterDays }, (_, i) => i + 1);
  SITES.forEach((s, i) => {
    const eps = included.filter((e) => e.site === s);
    bySite[s] = harvestSummary(eps, 100 + 10 * i);
    const m: (number | null)[] = [];
    const md: (number | null)[] = [];
    const n: number[] = [];
    for (let k = 0; k < SUMMARY.afterDays; k++) {
      const xs = finite(eps.map((e) => e.cum[k]));
      m.push(mean(xs));
      md.push(median(xs));
      n.push(xs.length);
    }
    composite[s] = { days: dayAxis, mean: m, median: md, n, episodes: Object.fromEntries(eps.map((e) => [e.id, e.cum])) };
  });
  const byCrop: Record<string, unknown> = {};
  (['grass', 'cereal', 'other'] as const).forEach((c, i) => {
    byCrop[c] = harvestSummary(included.filter((e) => e.cropClass === c), 200 + 10 * i);
  });
  // Per site and crop class: only classes with at least one included episode.
  const bySiteCrop: Record<string, Record<string, unknown>> = {};
  SITES.forEach((s, i) => {
    const out: Record<string, unknown> = {};
    (['grass', 'cereal', 'other'] as const).forEach((c, j) => {
      const eps = included.filter((e) => e.site === s && e.cropClass === c);
      if (!eps.length) return;
      const seed = 1000 + 30 * i + 10 * j;
      out[c] = {
        nEpisodes: eps.length,
        d28: summarise(eps.map((e) => e.d28), seed),
        d14: summarise(eps.map((e) => e.d14), seed + 1),
        gpp28: summarise(eps.map((e) => e.gpp28), seed + 2),
        reco28: summarise(eps.map((e) => e.reco28), seed + 3),
      };
    });
    bySiteCrop[s] = out;
  });

  // ---------- Months ----------
  const harvestByMonth = new Map<string, number>();
  const startsByMonth = new Map<string, number>();
  for (const e of included) for (const [k, x] of Object.entries(e.months)) harvestByMonth.set(`${e.site}|${k}`, (harvestByMonth.get(`${e.site}|${k}`) ?? 0) + x);
  for (const e of results) {
    const k = `${e.site}|${e.start.slice(0, 7)}`;
    startsByMonth.set(k, (startsByMonth.get(k) ?? 0) + 1);
  }
  const siteYears = (s: string): number[] => {
    const ys = new Set<number>();
    for (const d of daily.get(s)!.keys()) ys.add(Number(isoDay(d).slice(0, 4)));
    return [...ys].filter((y) => y >= YEARS.from && y <= YEARS.to).sort((a, b) => a - b);
  };
  interface MonthOut {
    site: SiteCode;
    year: number;
    month: number;
    nDays: number;
    complete: boolean;
    nee: number | null;
    spi1: number | null;
    spi3: number | null;
    dry: boolean;
    crop: CropClass;
    harvestUnknown: boolean;
    nHarvests: number;
    harvestDeficit: number;
    neeAdj: number | null;
    anomaly: number | null;
    refKind: string | null;
    refN: number | null;
    refMean: number | null;
    refSd: number | null;
    refYears: number[];
    calAnomaly: number | null;
  }
  const monthsOut: Record<string, Record<string, MonthOut>> = {};
  const monthList: MonthOut[] = [];
  for (const s of SITES) {
    monthsOut[s] = {};
    const byDay = daily.get(s)!;
    for (const y of siteYears(s)) {
      for (const m of GROWING_MONTHS) {
        const dim = daysInMonth(y, m);
        const d0 = dayNumber(`${ym(y, m)}-01`);
        const xs: number[] = [];
        for (let d = d0; d < d0 + dim; d++) {
          const x = byDay.get(d)?.nee;
          if (x !== null && x !== undefined) xs.push(x);
        }
        const complete = xs.length >= MIN_MONTH_DAYS;
        // A month with missing days is scaled to the full month (mean × days of the month).
        const nee = complete ? (xs.length === dim ? xs.reduce((a, b) => a + b, 0) : mean(xs)! * dim) : null;
        const sp = spiOf(s, y, m);
        const H = harvestByMonth.get(`${s}|${ym(y, m)}`) ?? 0;
        const row: MonthOut = {
          site: s,
          year: y,
          month: m,
          nDays: xs.length,
          complete,
          nee,
          spi1: sp?.spi1 ?? null,
          spi3: sp?.spi3 ?? null,
          dry: isDry(sp?.spi1 ?? null),
          crop: cropClass(s, y),
          harvestUnknown: EVENTS_UNKNOWN_YEARS[s].includes(y),
          nHarvests: startsByMonth.get(`${s}|${ym(y, m)}`) ?? 0,
          harvestDeficit: H,
          neeAdj: nee === null ? null : nee - H,
          anomaly: null,
          refKind: null,
          refN: null,
          refMean: null,
          refSd: null,
          refYears: [],
          calAnomaly: null,
        };
        monthsOut[s][ym(y, m)] = row;
        monthList.push(row);
      }
    }
  }
  const candidates: MonthRow[] = monthList.map((r) => ({ site: r.site, year: r.year, month: r.month, neeAdj: r.complete ? r.neeAdj : null, dry: r.dry, crop: r.crop, excludeFromRef: r.harvestUnknown }));
  monthList.forEach((r, i) => {
    const a = monthAnomaly(candidates[i]!, candidates, { minRefYears: MIN_REF_YEARS });
    r.anomaly = a.anomaly;
    r.refKind = a.refKind;
    r.refN = a.ref?.n ?? null;
    r.refMean = a.ref?.mean ?? null;
    r.refSd = a.ref?.sd ?? null;
    r.refYears = a.ref?.years ?? [];
  });
  // Calendar-month anomaly for the regression: NEE_adj − mean NEE_adj of the same month of all used years of the site.
  const usedForReg = (r: MonthOut) => r.complete && r.neeAdj !== null && !r.harvestUnknown && r.spi1 !== null;
  for (const s of SITES) {
    for (const m of GROWING_MONTHS) {
      const rs = monthList.filter((r) => r.site === s && r.month === m && usedForReg(r));
      const mu = mean(rs.map((r) => r.neeAdj!));
      for (const r of rs) r.calAnomaly = r.neeAdj! - mu!;
    }
  }

  // ---------- Regression ----------
  const regression: Record<string, unknown> = {};
  SITES.forEach((s, i) => {
    const rs = monthList.filter((r) => r.site === s && usedForReg(r));
    const xs = rs.map((r) => r.spi1!);
    const ys = rs.map((r) => r.calAnomaly!);
    const r = pearson(xs, ys);
    const ci = bootstrapOlsCi(xs, ys, 0.95, 2000, 300 + i);
    const fit = ols(xs, ys);
    const out: Record<string, unknown> = {
      monthly: {
        n: rs.length,
        slope: fit?.slope ?? null,
        intercept: fit?.intercept ?? null,
        r,
        p: pearsonP(r, rs.length),
        ciLo: ci?.ciLo ?? null,
        ciHi: ci?.ciHi ?? null,
        points: { ym: rs.map((q) => ym(q.year, q.month)), spi1: xs, anomaly: ys, dry: rs.map((q) => q.dry) },
      },
    };
    if (s === 'qvidja') {
      const seasonal: Record<string, unknown> = {};
      SEASONS.forEach((se, j) => {
        const pts: { year: number; x: number; y: number }[] = [];
        for (const y of siteYears(s)) {
          const ms = seasonMonths(se).map((m) => monthsOut[s]![ym(y, m)]);
          if (ms.some((q) => !q || !usedForReg(q))) continue;
          pts.push({ year: y, x: mean(ms.map((q) => q!.spi1!))!, y: ms.reduce((a, q) => a + q!.neeAdj!, 0) });
        }
        const sx = pts.map((p) => p.x);
        const sy = pts.map((p) => p.y);
        const rr = pearson(sx, sy);
        const f = ols(sx, sy);
        const c = bootstrapOlsCi(sx, sy, 0.95, 2000, 400 + j);
        seasonal[se] = { n: pts.length, years: pts.map((p) => p.year), slope: f?.slope ?? null, intercept: f?.intercept ?? null, r: rr, p: pearsonP(rr, pts.length), ciLo: c?.ciLo ?? null, ciHi: c?.ciHi ?? null };
      });
      out.seasonal = seasonal;
    }
    regression[s] = out;
  });

  // ---------- Seasons ----------
  const seasonInputs: SeasonInput[] = monthList.map((r) => ({
    site: r.site,
    year: r.year,
    month: r.month,
    nee: r.complete ? r.nee : null,
    nDays: r.nDays,
    complete: r.complete,
    dry: r.dry,
    nHarvests: r.nHarvests,
    harvestDeficit: r.harvestDeficit,
    droughtAnomaly: r.dry ? r.anomaly : null,
  }));
  const seasonRows = seasonTable(seasonInputs).map((r) => ({ ...r, harvestUnknown: EVENTS_UNKNOWN_YEARS[r.site as SiteCode].includes(r.year) }));
  const seasons: Record<string, Record<string, unknown>> = {};
  for (const s of SITES) seasons[s] = {};
  for (const r of seasonRows) {
    seasons[r.site]![`${r.year}-${r.season}`] = {
      year: r.year,
      season: r.season,
      complete: r.complete,
      harvestUnknown: r.harvestUnknown,
      nDays: r.nDays,
      // An incomplete season has no NEE sum (seasonTable adds only the months with a value).
      nee: r.complete ? r.nee : null,
      nHarvests: r.nHarvests,
      harvestDeficit: r.harvestDeficit,
      nDry: r.nDry,
      nDryNoRef: r.nDryNoRef,
      dryMonths: r.dryMonths,
      droughtAnomaly: r.droughtAnomaly,
      neeWithout: r.complete ? r.neeWithout : null,
    };
  }
  const used = seasonRows.filter((r) => r.complete && !r.harvestUnknown);
  const bySeason: Record<string, unknown> = {};
  SEASONS.forEach((se, i) => {
    const rs = used.filter((r) => r.season === se);
    bySeason[se] = {
      n: rs.length,
      nDry: rs.filter((r) => r.nDry > 0).length,
      nHarvest: rs.filter((r) => r.nHarvests > 0 || r.harvestDeficit !== 0).length,
      nee: summarise(rs.map((r) => r.nee), 500 + 10 * i),
      harvestDeficit: summarise(rs.map((r) => r.harvestDeficit), 501 + 10 * i),
      droughtAnomaly: summarise(rs.map((r) => r.droughtAnomaly), 502 + 10 * i),
      neeWithout: summarise(rs.map((r) => r.neeWithout), 503 + 10 * i),
    };
  });
  const totalOf = (rs: typeof seasonRows) => {
    const sumOf = (f: (r: (typeof seasonRows)[number]) => number) => rs.reduce((a, r) => a + f(r), 0);
    const H = sumOf((r) => r.harvestDeficit);
    const D = sumOf((r) => r.droughtAnomaly);
    const n = rs.length;
    return {
      nSeasons: n,
      nDrySeasons: rs.filter((r) => r.nDry > 0).length,
      nDryMonths: sumOf((r) => r.nDry),
      nDryNoRef: sumOf((r) => r.nDryNoRef),
      nee: sumOf((r) => r.nee),
      harvestDeficit: H,
      droughtAnomaly: D,
      neeWithout: sumOf((r) => r.neeWithout),
      // Share of the harvest part in the size of both parts: |H| / (|H| + |D|). H and D can have different signs
      // (a negative D is more uptake in the dry months), thus H / (H + D) is not a share.
      shareHarvestAbs: Math.abs(H) + Math.abs(D) > 0 ? Math.abs(H) / (Math.abs(H) + Math.abs(D)) : null,
      perSeason: n ? { nee: sumOf((r) => r.nee) / n, harvestDeficit: H / n, droughtAnomaly: D / n, neeWithout: sumOf((r) => r.neeWithout) / n } : null,
    };
  };
  const totals: Record<string, unknown> = {};
  for (const s of SITES) totals[s] = totalOf(used.filter((r) => r.site === s));
  totals.all = totalOf(used);
  const excludedSeasons = {
    incomplete: seasonRows.filter((r) => !r.complete).map((r) => `${r.site}-${r.year}-${r.season}`),
    harvestUnknown: seasonRows.filter((r) => r.complete && r.harvestUnknown).map((r) => `${r.site}-${r.year}-${r.season}`),
  };

  // ---------- Dry months (table) ----------
  const dryOut: Record<string, Record<string, unknown>> = {};
  for (const s of SITES) {
    dryOut[s] = {};
    for (const r of monthList.filter((q) => q.site === s && q.dry)) {
      dryOut[s]![ym(r.year, r.month)] = {
        spi1: r.spi1,
        spi3: r.spi3,
        complete: r.complete,
        harvestUnknown: r.harvestUnknown,
        nee: r.nee,
        harvestDeficit: r.harvestDeficit,
        neeAdj: r.neeAdj,
        anomaly: r.anomaly,
        refKind: r.refKind,
        refN: r.refN,
        refMean: r.refMean,
        refSd: r.refSd,
        refYears: r.refYears,
        crop: r.crop,
      };
    }
  }
  const dryList = monthList.filter((r) => r.dry && r.complete);
  const dryWithAnomaly = dryList.filter((r) => r.anomaly !== null);
  const drySummary: Record<string, unknown> = {};
  SITES.forEach((s, i) => {
    const rs = dryWithAnomaly.filter((r) => r.site === s);
    drySummary[s] = { nDry: monthList.filter((r) => r.site === s && r.dry).length, nWithAnomaly: rs.length, anomaly: summarise(rs.map((r) => r.anomaly), 600 + i) };
  });
  drySummary.all = { nDry: monthList.filter((r) => r.dry).length, nWithAnomaly: dryWithAnomaly.length, anomaly: summarise(dryWithAnomaly.map((r) => r.anomaly), 610) };

  // ---------- Examples ----------
  const q = monthsOut.qvidja!['2022-06']!;
  const h = monthsOut.haltiala!['2023-06']!;
  const example = {
    qvidja2022June: { nee: q.nee, harvestDeficit: q.harvestDeficit, neeAdj: q.neeAdj, anomaly: q.anomaly, spi1: q.spi1, spi3: q.spi3, refKind: q.refKind, refN: q.refN, refMean: q.refMean, refSd: q.refSd, refYears: q.refYears, neeWithout: q.neeAdj !== null && q.anomaly !== null ? q.neeAdj - q.anomaly : null },
    haltiala2023June: { spi1: h.spi1, spi3: h.spi3, nee: h.nee, anomaly: h.anomaly, refKind: h.refKind, refN: h.refN, refYears: h.refYears, crop: h.crop },
  };

  // ---------- Kuopio side note ----------
  const kuopio = spi.get('Kuopio Maaninka')!;
  const northDry = dryMonths(kuopio, 2022, 2023);
  const monthNee = (s: string, y: number, m: number): number | null => {
    const byDay = daily.get(s)!;
    const d0 = dayNumber(`${ym(y, m)}-01`);
    const xs: number[] = [];
    for (let d = d0; d < d0 + daysInMonth(y, m); d++) {
      const x = byDay.get(d)?.nee;
      if (x !== null && x !== undefined) xs.push(x);
    }
    return xs.length >= MIN_MONTH_DAYS ? (mean(xs)! * daysInMonth(y, m)) : null;
  };
  const northMonths: Record<string, unknown> = {};
  for (const k of northDry) {
    const [y, m] = k.split('-').map(Number) as [number, number];
    const other = y === 2022 ? 2023 : 2022;
    northMonths[k] = {
      spi1: kuopio.get(k)!.spi1,
      otherYear: other,
      otherSpi1: kuopio.get(ym(other, m))?.spi1 ?? null,
      sites: Object.fromEntries(NORTH.map((s) => [s, { nee: monthNee(s, y, m), neeOther: monthNee(s, other, m) }])),
    };
  }
  const north = {
    station: 'Kuopio Maaninka',
    dryMonths: northMonths,
    nDry: northDry.length,
    june2023: { kuopioSpi1: kuopio.get('2023-06')?.spi1 ?? null, vantaaSpi1: spi.get('Vantaa')!.get('2023-06')?.spi1 ?? null, kaarinaSpi1: spi.get('Kaarina Yltöinen')!.get('2023-06')?.spi1 ?? null },
  };

  // ---------- Sites ----------
  const sitesOut: Record<string, unknown> = {};
  for (const s of SITES) {
    const info = siteInfo.get(s)!;
    const all = results.filter((e) => e.site === s);
    sitesOut[s] = {
      name: info.name,
      siteId: info.id,
      slot: info.slot,
      utcOffsetMin: info.utcOffsetMin,
      station: STATION_OF_SITE[s],
      stationKm: STATION_DISTANCE_KM[s],
      light: LIGHT[s].column,
      years: siteYears(s),
      events: events.filter((e) => e.site === s).length,
      episodes: all.length,
      included: all.filter((e) => e.included).length,
      eventsUnknownYears: EVENTS_UNKNOWN_YEARS[s],
      measuredShareAfter: summarise(all.map((e) => e.measured.afterShare), 700),
      dryMonths: monthList.filter((r) => r.site === s && r.dry).length,
    };
  }
  for (const s of NORTH) {
    const info = siteInfo.get(s)!;
    sitesOut[s] = { name: info.name, siteId: info.id, slot: info.slot, station: STATION_OF_SITE[s], stationKm: STATION_DISTANCE_KM[s] };
  }

  const exclusions: Record<string, number> = {};
  for (const e of results) if (e.excluded) exclusions[e.excluded] = (exclusions[e.excluded] ?? 0) + 1;

  // Qvidja: first cut of the year (June) against the later cuts of the same year.
  const qv = included.filter((e) => e.site === 'qvidja');
  const qvidjaCuts = {
    june: harvestSummary(qv.filter((e) => e.start.slice(5, 7) === '06'), 800),
    later: harvestSummary(qv.filter((e) => e.start.slice(5, 7) !== '06'), 810),
  };

  return {
    question: 'How much net CO2 uptake went away after each harvest and in each dry month at Haltiala, Qvidja and Viikki, and what would the seasonal NEE have been without them?',
    method: {
      sites: [...SITES],
      preDays: PRE_DAYS,
      afterDays: SUMMARY.afterDays,
      earlyDays: SUMMARY.earlyDays,
      mergeDays: MERGE_DAYS,
      minPreDays: MIN_PRE_DAYS,
      minBins: MIN_BINS,
      minHalfHours: MIN_HALF_HOURS,
      halfHoursPerDay: 48,
      minValidShare: SUMMARY.minValidShare,
      recovery: { ...SUMMARY.recovery },
      measuredMinShare: MEASURED_MIN_SHARE,
      dryThreshold: DRY_THRESHOLD,
      spiRef: SPI_REF,
      years: YEARS,
      minMonthDays: MIN_MONTH_DAYS,
      minRefYears: MIN_REF_YEARS,
      lightMin: 20,
      lightBin: Object.fromEntries(SITES.map((s) => [s, LIGHT[s].bin])),
      light: Object.fromEntries(SITES.map((s) => [s, LIGHT[s].column])),
      seasons: Object.fromEntries(SEASONS.map((se) => [se, [...seasonMonths(se)]])),
      cropClass: CROP_CLASS,
      stationOfSite: STATION_OF_SITE,
      stationKm: STATION_DISTANCE_KM,
      bootstrapResamplesMean: 10_000,
      bootstrapResamplesSlope: 2000,
      ciLevelPct: 95,
      units: { deficit: 'g C m-2', daily: 'g C m-2 d-1', month: 'g C m-2 month-1', season: 'g C m-2 season-1', slope: 'g C m-2 month-1 per SPI unit' },
    },
    stations,
    sites: sitesOut,
    counts: {
      events: events.length,
      episodes: results.length,
      included: included.length,
      excluded: results.length - included.length,
      exclusions,
      seasons: seasonRows.length,
      seasonsComplete: seasonRows.filter((r) => r.complete).length,
      seasonsUsed: used.length,
      seasonsHarvestUnknown: excludedSeasons.harvestUnknown.length,
      months: monthList.length,
      monthsComplete: monthList.filter((r) => r.complete).length,
      dryMonths: monthList.filter((r) => r.dry).length,
      dryMonthsWithAnomaly: dryWithAnomaly.length,
    },
    episodes: Object.fromEntries(results.map((e) => [e.id, e])),
    harvest: { bySite, byCrop, bySiteCrop, all: harvestSummary(included, 90), qvidjaCuts, composite },
    months: monthsOut,
    dry: { months: dryOut, summary: drySummary },
    regression,
    seasons,
    allSites: { bySeason, totals, excludedSeasons },
    example,
    north,
  };
}
