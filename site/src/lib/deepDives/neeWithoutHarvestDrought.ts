// Figures and tables of the Deep Dive "NEE without harvest or drought"
// (pages/deep-dive/nee-without-harvest-drought.mdx). Input: site/src/deep-dives/nee-without-harvest-drought.json
// (scripts/deep-dives/nee-without-harvest-drought.ts). Valibot checks the parts that the figures and tables use.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';
import { AXIS, FONT, gridHeight, INK, minus, niceRange, panelGrid, renderSvg, SERIES, siteColor, siteSymbol } from '../deepDiveChart';

const N = v.nullable(v.number());
const MAIN = ['haltiala', 'qvidja', 'viikki'] as const;
type Main = (typeof MAIN)[number];
const SITE = v.picklist(MAIN);
const SEASON = v.picklist(['MAM', 'JJA', 'SON']);
const CROP = v.picklist(['grass', 'cereal', 'other']);
const Summary = v.looseObject({ n: v.number(), mean: N, sd: N, ciLo: N, ciHi: N, min: N, max: N });

const Station = v.looseObject({
  name: v.string(),
  sites: v.array(v.string()),
  nDry: v.number(),
  dryMonths: v.record(v.string(), v.number()),
  series: v.object({ months: v.array(v.string()), spi1: v.array(N), spi3: v.array(N) }),
});

const Episode = v.looseObject({
  id: v.string(),
  site: SITE,
  start: v.string(),
  end: v.string(),
  year: v.number(),
  types: v.array(v.string()),
  crop: v.nullable(v.string()),
  cropClass: CROP,
  daysUsed: v.number(),
  validDays: v.number(),
  included: v.boolean(),
  excluded: v.nullable(v.string()),
  excludedDetail: v.nullable(v.string()),
  d14: N,
  d28: N,
  gpp28: N,
  reco28: N,
  recoveryDay: N,
  cum: v.array(v.number()),
  measured: v.looseObject({ afterShare: v.number(), valid: v.boolean(), d28: N }),
  excess28: N,
});

const DryMonth = v.looseObject({
  spi1: v.number(),
  spi3: N,
  complete: v.boolean(),
  harvestUnknown: v.boolean(),
  nee: N,
  harvestDeficit: v.number(),
  neeAdj: N,
  anomaly: N,
  refKind: v.nullable(v.string()),
  refN: N,
  refMean: N,
  refSd: N,
  refYears: v.array(v.number()),
  crop: CROP,
});

const SeasonRow = v.looseObject({
  year: v.number(),
  season: SEASON,
  complete: v.boolean(),
  harvestUnknown: v.boolean(),
  nee: N,
  nHarvests: v.number(),
  harvestDeficit: v.number(),
  nDry: v.number(),
  nDryNoRef: v.number(),
  dryMonths: v.array(v.string()),
  droughtAnomaly: v.number(),
  neeWithout: N,
});

const Reg = v.looseObject({ n: v.number(), slope: N, intercept: N, r: N, p: N, ciLo: N, ciHi: N });

const DataSchema = v.looseObject({
  method: v.looseObject({ afterDays: v.number(), dryThreshold: v.number(), years: v.object({ from: v.number(), to: v.number() }) }),
  stations: v.looseObject({ vantaa: Station, kaarina: Station, kuopio: Station }),
  sites: v.looseObject({
    haltiala: v.looseObject({ slot: v.number(), name: v.string() }),
    qvidja: v.looseObject({ slot: v.number(), name: v.string() }),
    viikki: v.looseObject({ slot: v.number(), name: v.string() }),
  }),
  episodes: v.record(v.string(), Episode),
  harvest: v.looseObject({
    bySite: v.record(SITE, v.looseObject({ nEpisodes: v.number(), d28: Summary })),
    composite: v.record(SITE, v.looseObject({ days: v.array(v.number()), mean: v.array(N), median: v.array(N), n: v.array(v.number()), episodes: v.record(v.string(), v.array(v.number())) })),
  }),
  dry: v.looseObject({ months: v.record(SITE, v.record(v.string(), DryMonth)) }),
  regression: v.record(SITE, v.looseObject({ monthly: v.looseObject({ ...Reg.entries, points: v.object({ ym: v.array(v.string()), spi1: v.array(v.number()), anomaly: v.array(v.number()), dry: v.array(v.boolean()) }) }) })),
  seasons: v.record(SITE, v.record(v.string(), SeasonRow)),
  allSites: v.looseObject({
    bySeason: v.record(SEASON, v.looseObject({ n: v.number(), nee: Summary, harvestDeficit: Summary, droughtAnomaly: Summary, neeWithout: Summary })),
  }),
});
export type NeeWithoutData = v.InferOutput<typeof DataSchema>;

export function neeWithoutData(raw: unknown): NeeWithoutData {
  return v.parse(DataSchema, raw);
}

export interface FigureOut {
  svg: string;
  alt: string;
}

const UNIT = 'g C m⁻²';
const SEASON_NAME = { MAM: 'spring', JJA: 'summer', SON: 'autumn' } as const;
const CROP_NAME = { grass: 'grass', cereal: 'cereal', other: 'other' } as const;
const f1 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 1));
const f1s = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 1, { sign: true }));
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 2));
const axisLabel = { fontSize: 11, color: INK, fontFamily: FONT };
const splitLine = { lineStyle: { color: AXIS, opacity: 0.3 } };
const panelTitle = (text: string, left: number, top: number) => ({ text, left, top, textStyle: { fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT } });
const zeroLine = { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, type: 'solid', width: 1 }, data: [{ yAxis: 0 }] };
const DECAL_COLOR = '#ffffff99';
const STRIPES = { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 4], color: DECAL_COLOR };
const DOTS = { symbol: 'circle', symbolSize: 0.7, dashArrayX: [3, 2], dashArrayY: [3, 2], color: DECAL_COLOR };
const slotOf = (d: NeeWithoutData, s: Main) => d.sites[s].slot;

// ---------- Figure 1: SPI-1 per station ----------

/** SPI-1 bars of Vantaa and Kaarina Yltöinen per month; dry months (SPI-1 ≤ −1) darker with stripes. */
export function spiFigure(d: NeeWithoutData): FigureOut {
  const stations = [
    { key: 'vantaa' as const, title: `Vantaa (station of Haltiala and Viikki)` },
    { key: 'kaarina' as const, title: `Kaarina Yltöinen (station of Qvidja)` },
  ];
  const width = 1100;
  const margin = { left: 64, right: 16, top: 70, bottom: 44 };
  const gap = { x: 0, y: 60 };
  const panelH = 190;
  const grids = panelGrid(stations.length, 1, width, margin, gap, panelH);
  const height = gridHeight(stations.length, 1, margin, gap.y, panelH);
  const thr = d.method.dryThreshold;
  const months = d.stations.vantaa.series.months;
  const all = stations.flatMap((s) => d.stations[s.key].series.spi1.filter((x): x is number => x !== null));
  const y = niceRange(all, 6);
  const series: Record<string, unknown>[] = [];
  stations.forEach((st, gi) => {
    const sp = d.stations[st.key].series.spi1;
    const base = { type: 'bar', xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true }, barGap: '-100%', barWidth: '70%' };
    series.push({ ...base, name: 'SPI-1 above −1', itemStyle: { color: SERIES[2] }, data: sp.map((x) => (x !== null && x > thr ? x : null)) });
    series.push({ ...base, name: 'Dry month (SPI-1 ≤ −1)', itemStyle: { color: SERIES[5], decal: { ...STRIPES, rotation: Math.PI / 4 } }, data: sp.map((x) => (x !== null && x <= thr ? x : null)) });
    series.push({
      type: 'line',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: [],
      silent: true,
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        data: [
          { yAxis: 0, lineStyle: { color: AXIS, type: 'solid', width: 1 } },
          { yAxis: thr, lineStyle: { color: INK, type: [6, 4], width: 1.2 } },
        ],
      },
    });
  });
  const option = {
    legend: {
      top: 4,
      left: margin.left,
      itemGap: 24,
      textStyle: { fontSize: 12, color: INK },
      data: [
        { name: 'SPI-1 above −1', itemStyle: { color: SERIES[2] } },
        { name: 'Dry month (SPI-1 ≤ −1)', itemStyle: { color: SERIES[5], decal: { ...STRIPES, rotation: Math.PI / 4 } } },
      ],
    },
    title: stations.map((s, i) => panelTitle(s.title, grids[i]!.left, grids[i]!.top - 24)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: months,
      axisTick: { show: false },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, interval: (idx: number) => idx % 12 === 0, formatter: (m: string) => m.slice(0, 4) },
      name: i === stations.length - 1 ? 'Month (labels at January)' : '',
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { fontSize: 12, color: INK },
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: 'SPI-1',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, formatter: (t: number) => minus(t) },
      splitLine,
    })),
    series,
  };
  const parts = stations.map((s) => {
    const st = d.stations[s.key];
    const list = Object.entries(st.dryMonths)
      .map(([k, x]) => `${k} (${f2(x)})`)
      .join(', ');
    return `${st.name}: ${st.nDry} dry months: ${list}`;
  });
  const alt = `Bar chart in two panels, one per FMI station: the 1-month Standardized Precipitation Index (SPI-1) of each month from ${months[0]} to ${months[months.length - 1]}. Dry months (SPI-1 at or below −1) have darker bars with stripes. A dashed line marks −1. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 2: cumulative deficit after the cut ----------

/** Cumulative deficit per site: thin line per included episode, thick mean line. */
export function cumulativeFigure(d: NeeWithoutData): FigureOut {
  const width = 1100;
  const cols = 3;
  const margin = { left: 64, right: 16, top: 70, bottom: 52 };
  const gap = { x: 48, y: 0 };
  const panelH = 300;
  const grids = panelGrid(MAIN.length, cols, width, margin, gap, panelH);
  const height = gridHeight(MAIN.length, cols, margin, gap.y, panelH);
  const vals = MAIN.flatMap((s) => Object.values(d.harvest.composite[s]?.episodes ?? {}).flat());
  const y = niceRange(vals, 6);
  const days = d.harvest.composite.qvidja!.days;
  const series: Record<string, unknown>[] = [];
  MAIN.forEach((s, gi) => {
    const c = d.harvest.composite[s]!;
    const slot = slotOf(d, s);
    const base = { xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true }, type: 'line' };
    for (const cum of Object.values(c.episodes)) {
      series.push({ ...base, name: 'One episode', symbol: 'none', data: cum.map((x, i) => [i + 1, x]), lineStyle: { color: siteColor(slot), width: 1, opacity: 0.45, type: [4, 3] }, itemStyle: { color: siteColor(slot) }, z: 2 });
    }
    series.push({
      ...base,
      name: `${SITE_NAMES[s]} mean`,
      symbol: siteSymbol(slot),
      symbolSize: 6,
      showAllSymbol: false,
      data: c.mean.map((x, i) => [days[i], x]),
      lineStyle: { color: siteColor(slot), width: 3 },
      itemStyle: { color: siteColor(slot) },
      z: 4,
    });
    series.push({ ...base, data: [], markLine: zeroLine });
  });
  const option = {
    legend: {
      top: 4,
      left: margin.left,
      itemGap: 24,
      textStyle: { fontSize: 12, color: INK },
      data: [
        ...MAIN.map((s) => ({ name: `${SITE_NAMES[s]} mean`, icon: siteSymbol(slotOf(d, s)), itemStyle: { color: siteColor(slotOf(d, s)) } })),
        { name: 'One episode', icon: 'path://M0,4h5v2H0z M8,4h5v2h-5z M16,4h5v2h-5z', itemStyle: { color: INK } },
      ],
    },
    title: MAIN.map((s, i) => panelTitle(`${SITE_NAMES[s]} (n = ${d.harvest.bySite[s]!.nEpisodes})`, grids[i]!.left, grids[i]!.top - 24)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: 1,
      max: d.method.afterDays,
      interval: 7,
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel },
      splitLine,
      name: 'Day after the last cut day',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { fontSize: 12, color: INK },
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: i === 0 ? `Cumulative deficit (${UNIT})` : '',
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, formatter: (t: number) => minus(t) },
      splitLine,
    })),
    series,
  };
  const parts = MAIN.map((s) => {
    const c = d.harvest.composite[s]!;
    const b = d.harvest.bySite[s]!;
    return `${SITE_NAMES[s]}: ${b.nEpisodes} episodes, mean deficit at day ${days[days.length - 1]} ${f1s(c.mean[c.mean.length - 1])} ${UNIT} (SD ${f1(b.d28.sd)}, range ${f1s(b.d28.min)} to ${f1s(b.d28.max)})`;
  });
  const alt = `Line chart in three panels, one per site: the cumulative carbon deficit after each harvest or cut, from day 1 to day ${d.method.afterDays} after the last cut day, in ${UNIT}. A positive deficit is net CO₂ uptake that the pre-cut canopy model expects but that was not observed. Thin dashed lines are single episodes; the thick line with symbols is the mean. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 3: season budget ----------

const BAR = {
  nee: { label: 'Observed NEE', color: INK, decal: null as Record<string, unknown> | null },
  h: { label: 'Harvest deficit H', color: SERIES[0], decal: DOTS as Record<string, unknown> },
  d: { label: 'Drought anomaly D', color: SERIES[1], decal: { ...STRIPES, rotation: Math.PI / 4 } as Record<string, unknown> },
};
const WITHOUT = 'NEE without harvest and drought';
const UNKNOWN_DECAL = { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [1, 3], rotation: -Math.PI / 4, color: '#ffffffcc' };

/** Seasons of a site, sorted. */
function seasonList(d: NeeWithoutData, s: Main) {
  return Object.entries(d.seasons[s] ?? {}).map(([key, r]) => ({ key, ...r }));
}

/** Grouped bars per site-year-season: observed NEE, H, D, and a marker for NEE without both. */
export function seasonFigure(d: NeeWithoutData): FigureOut {
  const width = 1100;
  const margin = { left: 64, right: 16, top: 70, bottom: 52 };
  const gap = { x: 0, y: 70 };
  const panelH = 210;
  const grids = panelGrid(MAIN.length, 1, width, margin, gap, panelH);
  const height = gridHeight(MAIN.length, 1, margin, gap.y, panelH);
  const vals = MAIN.flatMap((s) => seasonList(d, s).flatMap((r) => [r.nee, r.harvestDeficit, r.droughtAnomaly, r.neeWithout].filter((x): x is number => x !== null)));
  const y = niceRange(vals, 5);
  const series: Record<string, unknown>[] = [];
  MAIN.forEach((s, gi) => {
    const rows = seasonList(d, s);
    const base = { type: 'bar', xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true }, barGap: '10%', barCategoryGap: '30%' };
    const item = (x: number | null, b: (typeof BAR)[keyof typeof BAR], unknown: boolean, complete: boolean) =>
      !complete || x === null
        ? null
        : { value: x, itemStyle: { color: b.color, opacity: unknown ? 0.45 : 1, ...(unknown ? { decal: UNKNOWN_DECAL } : b.decal ? { decal: b.decal } : {}) } };
    series.push({ ...base, name: BAR.nee.label, itemStyle: { color: BAR.nee.color }, data: rows.map((r) => item(r.nee, BAR.nee, r.harvestUnknown, r.complete)) });
    series.push({ ...base, name: BAR.h.label, itemStyle: { color: BAR.h.color, decal: BAR.h.decal }, data: rows.map((r) => item(r.harvestDeficit, BAR.h, r.harvestUnknown, r.complete)) });
    series.push({ ...base, name: BAR.d.label, itemStyle: { color: BAR.d.color, decal: BAR.d.decal }, data: rows.map((r) => item(r.droughtAnomaly, BAR.d, r.harvestUnknown, r.complete)) });
    series.push({
      type: 'scatter',
      name: WITHOUT,
      xAxisIndex: gi,
      yAxisIndex: gi,
      silent: true,
      symbol: 'diamond',
      symbolSize: 10,
      itemStyle: { color: 'transparent', borderColor: INK, borderWidth: 1.6 },
      data: rows.map((r, i) => (r.complete && r.neeWithout !== null ? [i, r.neeWithout] : null)).filter((p) => p !== null),
      z: 5,
    });
    series.push({ type: 'line', xAxisIndex: gi, yAxisIndex: gi, data: [], markLine: zeroLine });
  });
  const option = {
    legend: {
      top: 4,
      left: margin.left,
      itemGap: 22,
      itemWidth: 22,
      itemHeight: 12,
      textStyle: { fontSize: 12, color: INK },
      data: [
        { name: BAR.nee.label, itemStyle: { color: BAR.nee.color } },
        { name: BAR.h.label, itemStyle: { color: BAR.h.color, decal: BAR.h.decal } },
        { name: BAR.d.label, itemStyle: { color: BAR.d.color, decal: BAR.d.decal } },
        { name: WITHOUT, icon: 'diamond', itemStyle: { color: 'transparent', borderColor: INK, borderWidth: 1.6 } },
      ],
    },
    title: MAIN.map((s, i) => panelTitle(SITE_NAMES[s], grids[i]!.left, grids[i]!.top - 24)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: MAIN.map((s, i) => ({
      type: 'category',
      gridIndex: i,
      data: seasonList(d, s).map((r) => `${r.season}\n${r.year}`),
      axisTick: { show: false },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, fontSize: 10, interval: 0, lineHeight: 12 },
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: UNIT,
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, formatter: (t: number) => minus(t) },
      splitLine,
    })),
    series,
  };
  const parts = MAIN.map((s) => {
    const rows = seasonList(d, s).filter((r) => r.complete);
    const big = [...rows].sort((a, b) => Math.abs(b.harvestDeficit) + Math.abs(b.droughtAnomaly) - Math.abs(a.harvestDeficit) - Math.abs(a.droughtAnomaly))[0];
    const unk = rows.filter((r) => r.harvestUnknown).map((r) => `${r.season} ${r.year}`);
    return `${SITE_NAMES[s]}: ${rows.length} complete seasons; the largest H + D size in ${big ? `${big.season} ${big.year} (NEE ${f1(big.nee)}, H ${f1s(big.harvestDeficit)}, D ${f1s(big.droughtAnomaly)}, without ${f1(big.neeWithout)} ${UNIT})` : '–'}${unk.length ? `; harvest record unknown and hatched: ${unk.join(', ')}` : ''}`;
  });
  const alt = `Grouped bar chart in three panels, one per site, one group per year and season (MAM spring, JJA summer, SON autumn): observed NEE, harvest deficit H and drought anomaly D in ${UNIT} per season, and a hollow diamond for the NEE without harvest and drought (NEE − H − D). Incomplete seasons have no bars. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 4: monthly anomaly vs SPI-1 ----------

/** Monthly NEE anomaly (harvest removed, minus the site calendar-month mean) against SPI-1, one panel per site. */
export function regressionFigure(d: NeeWithoutData): FigureOut {
  const width = 1100;
  const cols = 3;
  const margin = { left: 64, right: 16, top: 128, bottom: 52 };
  const gap = { x: 48, y: 0 };
  const panelH = 300;
  const grids = panelGrid(MAIN.length, cols, width, margin, gap, panelH);
  const height = gridHeight(MAIN.length, cols, margin, gap.y, panelH);
  const xs = MAIN.flatMap((s) => d.regression[s]!.monthly.points.spi1);
  const ys = MAIN.flatMap((s) => d.regression[s]!.monthly.points.anomaly);
  const x = niceRange(xs, 6);
  const y = niceRange(ys, 6);
  const name = (s: Main) => {
    const g = d.regression[s]!.monthly;
    return `${SITE_NAMES[s]}: slope ${f1s(g.slope)} (95 % CI ${f1s(g.ciLo)} to ${f1s(g.ciHi)})`;
  };
  const series: Record<string, unknown>[] = [];
  MAIN.forEach((s, gi) => {
    const g = d.regression[s]!.monthly;
    const slot = slotOf(d, s);
    const base = { xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true } };
    series.push({ ...base, type: 'scatter', name: name(s), symbol: siteSymbol(slot), symbolSize: 7, data: g.points.spi1.map((xx, i) => [xx, g.points.anomaly[i]]), itemStyle: { color: siteColor(slot), opacity: 0.75 }, z: 2 });
    if (g.slope !== null && g.intercept !== null) {
      const a = Math.min(...g.points.spi1);
      const b = Math.max(...g.points.spi1);
      series.push({ ...base, type: 'line', name: 'Least-squares line', symbol: 'none', data: [[a, g.intercept + g.slope * a], [b, g.intercept + g.slope * b]], lineStyle: { color: INK, width: 1.5, type: [6, 4] }, itemStyle: { color: INK }, z: 3 });
    }
    series.push({
      ...base,
      type: 'line',
      data: [],
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        data: [
          { yAxis: 0, lineStyle: { color: AXIS, type: 'solid', width: 1 } },
          { xAxis: d.method.dryThreshold, lineStyle: { color: AXIS, type: [2, 3], width: 1 } },
        ],
      },
    });
  });
  const option = {
    legend: {
      top: 4,
      left: margin.left,
      width: 700,
      itemGap: 36,
      textStyle: { fontSize: 12, color: INK },
      data: [
        ...MAIN.map((s) => ({ name: name(s), icon: siteSymbol(slotOf(d, s)), itemStyle: { color: siteColor(slotOf(d, s)) } })),
        { name: 'Least-squares line', icon: 'path://M0,4h7v2H0z M10,4h7v2h-7z M20,4h7v2h-7z', itemStyle: { color: INK } },
      ],
    },
    title: MAIN.map((s, i) => panelTitle(`${SITE_NAMES[s]} (n = ${d.regression[s]!.monthly.n} months)`, grids[i]!.left, grids[i]!.top - 24)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: x.min,
      max: x.max,
      interval: x.interval,
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, formatter: (t: number) => minus(t) },
      splitLine,
      name: 'SPI-1 of the station',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { fontSize: 12, color: INK },
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: i === 0 ? `Monthly NEE anomaly (${UNIT})` : '',
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, formatter: (t: number) => minus(t) },
      splitLine,
    })),
    series,
  };
  const parts = MAIN.map((s) => {
    const g = d.regression[s]!.monthly;
    return `${SITE_NAMES[s]}: n = ${g.n} months, slope ${f1s(g.slope)} ${UNIT} per SPI unit (95 % bootstrap CI ${f1s(g.ciLo)} to ${f1s(g.ciHi)}), r = ${f2(g.r)}, p = ${f2(g.p)}`;
  });
  const alt = `Scatter chart in three panels, one per site: the monthly NEE anomaly (NEE minus the harvest deficit, minus the mean of the same calendar month of the site, in ${UNIT}) against the SPI-1 of the station, March to November. A dashed least-squares line per site; a dotted vertical line marks SPI-1 = −1. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Tables ----------

export interface EpisodeRow {
  id: string;
  site: string;
  dates: string;
  crop: string;
  cls: string;
  days: string;
  d14: string;
  d28: string;
  gpp: string;
  reco: string;
  recovery: string;
  excess: string;
  measured: string;
  measuredD28: string;
  excluded: string;
}

/** One row per harvest or cut episode. */
export function episodeRows(d: NeeWithoutData): EpisodeRow[] {
  return Object.values(d.episodes).map((e) => ({
    id: e.id,
    site: SITE_NAMES[e.site as SiteCode],
    dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
    crop: e.crop ?? e.types.join(', '),
    cls: CROP_NAME[e.cropClass],
    days: e.daysUsed === e.validDays ? String(e.daysUsed) : `${e.validDays} of ${e.daysUsed}`,
    d14: f1s(e.d14),
    d28: f1s(e.d28),
    gpp: f1s(e.gpp28),
    reco: f1s(e.reco28),
    recovery: e.recoveryDay === null ? (e.included ? 'none' : '–') : String(e.recoveryDay),
    excess: f1s(e.excess28),
    measured: `${fmtNum(e.measured.afterShare * 100, 0)} %`,
    measuredD28: e.measured.valid ? f1s(e.measured.d28) : '–',
    excluded: e.excluded ? `${e.excluded}${e.excludedDetail ? ` (${e.excludedDetail})` : ''}` : '–',
  }));
}

export interface SeasonTableRow {
  id: string;
  site: string;
  season: string;
  nee: string;
  harvests: string;
  h: string;
  dry: string;
  dAnom: string;
  without: string;
  note: string;
}

/** One row per site, year and season. */
export function seasonRows(d: NeeWithoutData): SeasonTableRow[] {
  return MAIN.flatMap((s) =>
    seasonList(d, s).map((r) => {
      const notes: string[] = [];
      if (!r.complete) notes.push('incomplete');
      if (r.harvestUnknown) notes.push('harvest record unknown');
      if (r.nDryNoRef) notes.push(`${r.nDryNoRef} dry month without reference`);
      return {
        id: `${s}-${r.year}-${r.season}`,
        site: SITE_NAMES[s],
        season: `${r.season} ${r.year}`,
        nee: r.complete ? f1(r.nee) : '–',
        harvests: String(r.nHarvests),
        h: r.complete ? f1s(r.harvestDeficit) : '–',
        dry: r.dryMonths.length ? r.dryMonths.join(', ') : '–',
        dAnom: r.complete && r.nDry ? f1s(r.droughtAnomaly) : '–',
        without: r.complete ? f1(r.neeWithout) : '–',
        note: notes.join('; ') || '–',
      };
    }),
  );
}

export interface DryRow {
  id: string;
  site: string;
  month: string;
  spi1: string;
  spi3: string;
  nee: string;
  h: string;
  adj: string;
  anomaly: string;
  ref: string;
  refN: string;
  refYears: string;
}

/** One row per dry site-month. */
export function dryRows(d: NeeWithoutData): DryRow[] {
  return MAIN.flatMap((s) =>
    Object.entries(d.dry.months[s] ?? {}).map(([k, m]) => ({
      id: `${s}-${k}`,
      site: SITE_NAMES[s],
      month: k,
      spi1: f2(m.spi1),
      spi3: f2(m.spi3),
      nee: m.complete ? f1(m.nee) : 'incomplete',
      h: m.complete ? f1s(m.harvestDeficit) : '–',
      adj: m.complete ? f1(m.neeAdj) : '–',
      anomaly: f1s(m.anomaly),
      ref: m.refMean === null ? '–' : `${f1(m.refMean)}${m.refSd === null ? '' : ` ± ${f1(m.refSd)}`} (${m.refKind === 'crop' ? 'same crop class' : 'all non-dry years'})`,
      refN: m.refN === null ? '–' : String(m.refN),
      refYears: m.refYears.join(', ') || '–',
    })),
  );
}

export interface SeasonSummaryRow {
  id: string;
  season: string;
  n: string;
  nee: string;
  h: string;
  dAnom: string;
  without: string;
}

const meanCi = (x: { mean: number | null; ciLo: number | null; ciHi: number | null; sd: number | null }) =>
  x.mean === null ? '–' : `${f1(x.mean)}${x.sd === null ? '' : ` ± ${f1(x.sd)}`}${x.ciLo === null ? '' : ` [${f1(x.ciLo)}, ${f1(x.ciHi)}]`}`;

/** All sites per season: mean ± SD [95 % CI] over the complete site-years with a known harvest record. */
export function seasonSummaryRows(d: NeeWithoutData): SeasonSummaryRow[] {
  return (['MAM', 'JJA', 'SON'] as const).map((se) => {
    const r = d.allSites.bySeason[se]!;
    return {
      id: se,
      season: `${se} (${SEASON_NAME[se]})`,
      n: String(r.n),
      nee: meanCi(r.nee),
      h: meanCi(r.harvestDeficit),
      dAnom: meanCi(r.droughtAnomaly),
      without: meanCi(r.neeWithout),
    };
  });
}

/** Episodes of a site that are included, for the text. */
export function includedIds(d: NeeWithoutData, site: Main): string[] {
  return Object.values(d.episodes)
    .filter((e) => e.site === site && e.included)
    .map((e) => e.id);
}
