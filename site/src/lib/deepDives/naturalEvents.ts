// Figures and tables of the Deep Dive "Natural events and disturbances"
// (pages/deep-dive/natural-events.mdx). Input: site/src/deep-dives/natural-events.json
// (scripts/deep-dives/natural-events.ts). Valibot checks the parts that the figures use.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';
import { AXIS, FONT, gridHeight, INK, minus, niceRange, panelGrid, renderSvg, SERIES, siteColor, siteSymbol, SURFACE } from '../deepDiveChart';

const N = v.nullable(v.number());
const SITE = v.picklist(['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki', 'maktau']);
const CLASS = v.picklist(['frost', 'heat', 'coldSpell', 'heavyRain', 'drySpell', 'failedRains', 'soilDrought', 'soilWet', 'zeroCurtain']);
const PERIOD = v.picklist(['MAM', 'JJA', 'SON', 'DJF']);
const Summary = v.looseObject({ n: v.number(), mean: N, sd: N });
const MeanSd = v.looseObject({ n: v.number(), mean: N, sd: N });
const ClassCounts = v.record(v.string(), v.number());
const PairStats = v.object({ n: v.number(), meanX: N, meanY: N, varX: N, varY: N, r: N, slope: N, intercept: N, r2: N });

const DataSchema = v.looseObject({
  method: v.looseObject({
    classes: v.array(CLASS),
    periods: v.array(v.looseObject({ id: PERIOD, name: v.string(), months: v.array(v.number()) })),
    pointsPerSite: v.number(),
  }),
  sites: v.record(SITE, v.looseObject({ name: v.string(), slot: v.number(), hasPrecip: v.boolean(), hasEvents: v.boolean() })),
  counts: v.record(SITE, v.record(CLASS, v.looseObject({ days: v.number(), allDays: v.number(), episodes: v.number() }))),
  events: v.record(
    SITE,
    v.array(
      v.looseObject({
        class: CLASS,
        start: v.string(),
        end: v.string(),
        days: v.number(),
        usedDays: v.number(),
        peak: N,
        peakUnit: v.string(),
        heatWave: v.optional(v.boolean()),
        nee: MeanSd,
      }),
    ),
  ),
  classes: v.record(CLASS, v.record(v.string(), v.looseObject({ event: Summary, reference: Summary, diff: N }))),
  periods: v.looseObject({
    years: v.array(
      v.looseObject({
        period: PERIOD,
        year: v.number(),
        label: v.string(),
        sitesWithData: v.number(),
        n: v.number(),
        nee: MeanSd,
        eventDays: ClassCounts,
        bySite: v.record(v.string(), v.looseObject({ n: v.number(), nee: MeanSd })),
      }),
    ),
  }),
  rainSeasons: v.looseObject({
    maktau: v.array(v.looseObject({ season: v.picklist(['MAM', 'SON']), year: v.number(), precipMm: N, swcMean: N, failed: v.nullable(v.boolean()) })),
  }),
  anscombe: v.looseObject({
    ta: v.record(v.string(), PairStats),
    swc: v.record(v.string(), PairStats),
    points: v.record(v.string(), v.object({ n: v.number(), x: v.array(N), s: v.array(N), y: v.array(N), f: v.array(v.number()) })),
  }),
});
export type NaturalEventsData = v.InferOutput<typeof DataSchema>;
type EventClass = v.InferOutput<typeof CLASS>;
type Period = v.InferOutput<typeof PERIOD>;
type Pair = v.InferOutput<typeof PairStats>;

export function naturalEventsData(raw: unknown): NaturalEventsData {
  return v.parse(DataSchema, raw);
}

const SITES = Object.keys(SITE_NAMES) as SiteCode[];
/** Class names for the tables and the text. */
export const CLASS_LABEL: Record<EventClass, string> = {
  frost: 'Frost',
  heat: 'Heat',
  coldSpell: 'Cold spell',
  heavyRain: 'Heavy rain',
  drySpell: 'Dry spell',
  failedRains: 'Failed rains',
  soilDrought: 'Soil drought',
  soilWet: 'Soil wet',
  zeroCurtain: 'Zero curtain',
};
/** Bits of the class bit mask of the drawn points (see scripts/deep-dives/natural-events.ts). */
const BITS = { frost: 1, heat: 2, coldSpell: 4, heavyRain: 8, dry: 16, soilDrought: 32, soilWet: 64, zeroCurtain: 128 } as const;
const TEMP_MASK = BITS.frost | BITS.heat | BITS.coldSpell;
const WATER_MASK = BITS.heavyRain | BITS.dry | BITS.soilDrought | BITS.soilWet;
const PERIOD_TITLE: Record<Period, string> = {
  MAM: 'Spring (March to May)',
  JJA: 'Summer (June to August)',
  SON: 'Autumn (September to November)',
  DJF: 'Winter (December to February; year of January)',
};
const UNIT_DAY = 'g C m⁻² d⁻¹';
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 2));
const f2s = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 2, { sign: true }));
const meanSd = (m: { mean: number | null; sd: number | null }) => (m.mean === null ? '–' : m.sd === null ? f2(m.mean) : `${f2(m.mean)} ± ${f2(m.sd)}`);

export interface FigureOut {
  svg: string;
  alt: string;
}

const axisLabel = { fontSize: 11, color: INK, fontFamily: FONT };
const splitLine = { lineStyle: { color: AXIS, opacity: 0.3 } };
const panelTitle = (text: string, left: number, top: number) => ({ text, left, top, textStyle: { fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT } });
const zeroLine = { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, type: 'solid', width: 1 }, data: [{ yAxis: 0 }] };

// ---------- Statistics box (local copy of statValue / statsLines of scripts/diagrams/anscombe.ts) ----------

/** Number text with 3 significant digits and a true minus sign. */
function statValue(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '–';
  const s = Number(x.toPrecision(3));
  const t = Math.abs(s) >= 1e4 || (s !== 0 && Math.abs(s) < 1e-3) ? s.toExponential(2) : String(s);
  return t.replace('-', '−');
}

/** Lines of the statistics box. */
function statsLines(st: Pair): string[] {
  const sign = (st.intercept ?? 0) < 0 ? '−' : '+';
  return [
    `n = ${fmtNum(st.n, 0)}`,
    `mean x = ${statValue(st.meanX)}, mean y = ${statValue(st.meanY)}`,
    `var x = ${statValue(st.varX)}, var y = ${statValue(st.varY)}`,
    `r = ${statValue(st.r)}, R² = ${statValue(st.r2)}`,
    `y = ${statValue(st.slope)} x ${sign} ${statValue(st.intercept === null ? null : Math.abs(st.intercept))}`,
  ];
}

// ---------- Figures 1 and 2: Anscombe panels ----------

interface ScatterSpec {
  key: 'ta' | 'swc';
  /** Point array of the x value. */
  xOf: (p: NaturalEventsData['anscombe']['points'][string]) => (number | null)[];
  mask: number;
  eventName: string;
  xName: string;
  xFixed?: { min: number; max: number; interval: number };
  /** First sentences of the alt text. */
  intro: string;
}

function scatterFigure(d: NaturalEventsData, spec: ScatterSpec): FigureOut {
  const sites = SITES.filter((s) => d.anscombe[spec.key][s] && d.anscombe.points[s]);
  const width = 1100;
  const cols = 2;
  const margin = { left: 64, right: 16, top: 78, bottom: 52 };
  const gap = { x: 64, y: 78 };
  const panelH = 240;
  const grids = panelGrid(sites.length, cols, width, margin, gap, panelH);
  const height = gridHeight(sites.length, cols, margin, gap.y, panelH);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of sites) {
    const p = d.anscombe.points[s]!;
    const xv = spec.xOf(p);
    p.y.forEach((y, i) => {
      if (y !== null && xv[i] !== null && xv[i] !== undefined) {
        xs.push(xv[i]!);
        ys.push(y);
      }
    });
  }
  const x = spec.xFixed ?? niceRange(xs, 6);
  const y = niceRange(ys, 5);
  const series: Record<string, unknown>[] = [];
  const graphic: Record<string, unknown>[] = [];
  const OLS = 'Least-squares line';
  sites.forEach((s, gi) => {
    const slot = d.sites[s]!.slot;
    const p = d.anscombe.points[s]!;
    const xv = spec.xOf(p);
    const plain: [number, number][] = [];
    const marked: [number, number][] = [];
    p.y.forEach((yy, i) => {
      const xx = xv[i];
      if (yy === null || xx === null || xx === undefined) return;
      ((p.f[i] ?? 0) & spec.mask ? marked : plain).push([xx, yy]);
    });
    const base = { xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true } };
    series.push({ ...base, type: 'scatter', name: SITE_NAMES[s], symbol: siteSymbol(slot), symbolSize: 4, data: plain, itemStyle: { color: siteColor(slot), opacity: 0.5 }, z: 2 });
    series.push({ ...base, type: 'scatter', name: spec.eventName, symbol: 'triangle', symbolSize: 7, data: marked, itemStyle: { color: 'transparent', borderColor: INK, borderWidth: 1 }, z: 3 });
    const st = d.anscombe[spec.key][s]!;
    const all = [...plain, ...marked].map((q) => q[0]);
    if (st.n >= 2 && st.slope !== null && st.intercept !== null && all.length) {
      const a = Math.min(...all);
      const b = Math.max(...all);
      series.push({ ...base, type: 'line', name: OLS, symbol: 'none', data: [[a, st.intercept + st.slope * a], [b, st.intercept + st.slope * b]], lineStyle: { color: INK, width: 1.5, type: [6, 4] }, itemStyle: { color: INK }, z: 4 });
    }
    series.push({ ...base, type: 'line', data: [], markLine: zeroLine });
    const g = grids[gi]!;
    graphic.push({
      type: 'text',
      silent: true,
      z: 100,
      left: g.left + 6,
      top: g.top + 6,
      style: {
        text: st.n >= 2 ? statsLines(st).join('\n') : 'Fewer than 2 days',
        fontSize: 11,
        lineHeight: 14,
        fontFamily: FONT,
        fill: INK,
        backgroundColor: SURFACE,
        borderColor: AXIS,
        borderWidth: 1,
        padding: [3, 5],
        borderRadius: 2,
      },
    });
  });
  const lastRow = Math.floor((sites.length - 1) / cols);
  const option = {
    legend: {
      top: 4,
      left: margin.left,
      itemGap: 24,
      textStyle: { fontSize: 12, color: INK },
      data: [
        ...sites.map((s) => ({ name: SITE_NAMES[s], icon: siteSymbol(d.sites[s]!.slot), itemStyle: { color: siteColor(d.sites[s]!.slot) } })),
        { name: spec.eventName, icon: 'triangle', itemStyle: { color: 'transparent', borderColor: INK, borderWidth: 1.2 } },
        { name: OLS, icon: 'path://M0,4h7v2H0z M10,4h7v2h-7z M20,4h7v2h-7z', itemStyle: { color: INK } },
      ],
    },
    title: sites.map((s, i) => panelTitle(SITE_NAMES[s], grids[i]!.left, grids[i]!.top - 22)),
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
      name: Math.floor(i / cols) === lastRow ? spec.xName : '',
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
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, formatter: (t: number) => minus(t) },
      splitLine,
      name: i % cols === 0 ? `NEE (${UNIT_DAY})` : '',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 12, color: INK },
    })),
    graphic,
    series,
  };
  const parts = sites.map((s) => {
    const st = d.anscombe[spec.key][s]!;
    const p = d.anscombe.points[s]!;
    const xv = spec.xOf(p);
    const nMarked = p.f.filter((f, i) => f & spec.mask && xv[i] !== null && p.y[i] !== null).length;
    return `${SITE_NAMES[s]}: n = ${st.n} days, r = ${statValue(st.r)}, line y = ${statValue(st.slope)} x ${(st.intercept ?? 0) < 0 ? '−' : '+'} ${statValue(st.intercept === null ? null : Math.abs(st.intercept))}, ${nMarked} marked event days of ${xv.filter((q, i) => q !== null && p.y[i] !== null).length} drawn points`;
  });
  const alt = `${spec.intro} ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

/** Figure 1: daily NEE against the daily mean air temperature, one panel per site; frost, heat and cold-spell days marked. */
export function taFigure(d: NaturalEventsData): FigureOut {
  return scatterFigure(d, {
    key: 'ta',
    xOf: (p) => p.x,
    mask: TEMP_MASK,
    eventName: 'Frost, heat or cold-spell day',
    xName: 'Daily mean air temperature (°C)',
    intro: `Scatter chart in six panels, one per site: daily NEE (${UNIT_DAY}) against the daily mean air temperature (°C). Each panel has a box with n, the means, the variances, Pearson r, R² and the least-squares line of all used days; the points are a sample of up to ${d.method.pointsPerSite} days per site. Hollow triangles mark frost, heat and cold-spell days.`,
  });
}

/** Figure 2: daily NEE against the site percentile rank of the daily soil water content; water-class days marked. */
export function swcFigure(d: NaturalEventsData): FigureOut {
  return scatterFigure(d, {
    key: 'swc',
    xOf: (p) => p.s,
    mask: WATER_MASK,
    eventName: 'Rain, dry or soil water day',
    xName: 'Soil water content, percentile rank of the site (%)',
    xFixed: { min: 0, max: 100, interval: 20 },
    intro: `Scatter chart in six panels, one per site: daily NEE (${UNIT_DAY}) against the percentile rank of the daily soil water content in the site (0 to 100 %). Each panel has a box with n, the means, the variances, Pearson r, R² and the least-squares line of all used days; the points are a sample of up to ${d.method.pointsPerSite} days per site. Hollow triangles mark days of heavy rain, dry spell or failed rains, soil drought and soil wet.`,
  });
}

// ---------- Figure 3: event days per period and year ----------

type BarKey = 'frost' | 'coldSpell' | 'zeroCurtain' | 'heat' | 'dry' | 'soilDrought' | 'soilWet' | 'heavyRain';
const DECAL_COLOR = '#ffffff99';
const STRIPES = { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 4], color: DECAL_COLOR };
/** Bar groups of Figure 3: colour (Okabe-Ito) and a decal pattern each, so that colour is not the only cue. */
const BARS: { key: BarKey; label: string; classes: EventClass[]; color: string; decal: Record<string, unknown> | null }[] = [
  { key: 'frost', label: 'Frost', classes: ['frost'], color: SERIES[2], decal: { symbol: 'circle', symbolSize: 0.7, dashArrayX: [3, 2], dashArrayY: [3, 2], color: DECAL_COLOR } },
  { key: 'coldSpell', label: 'Cold spell', classes: ['coldSpell'], color: SERIES[0], decal: { ...STRIPES } },
  { key: 'zeroCurtain', label: 'Zero curtain', classes: ['zeroCurtain'], color: INK, decal: null },
  { key: 'heat', label: 'Heat', classes: ['heat'], color: SERIES[5], decal: { ...STRIPES, rotation: Math.PI / 4 } },
  { key: 'dry', label: 'Dry spell or failed rains', classes: ['drySpell', 'failedRains'], color: SERIES[1], decal: { ...STRIPES, rotation: Math.PI / 2 } },
  { key: 'soilDrought', label: 'Soil drought', classes: ['soilDrought'], color: SERIES[7], decal: { ...STRIPES, rotation: -Math.PI / 4 } },
  { key: 'soilWet', label: 'Soil wet', classes: ['soilWet'], color: SERIES[3], decal: { symbol: 'rect', symbolSize: 0.6, dashArrayX: [4, 2], dashArrayY: [4, 2], color: DECAL_COLOR } },
  { key: 'heavyRain', label: 'Heavy rain', classes: ['heavyRain'], color: SERIES[6], decal: { symbol: 'triangle', symbolSize: 0.8, dashArrayX: [4, 2], dashArrayY: [4, 2], color: DECAL_COLOR } },
];
const PERIODS: Period[] = ['MAM', 'JJA', 'SON', 'DJF'];

/** Pooled used event days per class, period and year, one panel per period. */
export function periodFigure(d: NaturalEventsData): FigureOut {
  const width = 760;
  const margin = { left: 64, right: 16, top: 96, bottom: 44 };
  const gap = { x: 0, y: 48 };
  const panelH = 100;
  const grids = panelGrid(PERIODS.length, 1, width, margin, gap, panelH);
  const height = gridHeight(PERIODS.length, 1, margin, gap.y, panelH);
  const years = [...new Set(d.periods.years.map((r) => r.year))].sort((a, b) => a - b);
  const cats = years.map(String);
  const rowOf = (p: Period, yr: number) => d.periods.years.find((r) => r.period === p && r.year === yr);
  const days = (r: ReturnType<typeof rowOf>, b: (typeof BARS)[number]) => (r ? b.classes.reduce((a, c) => a + (r.eventDays[c] ?? 0), 0) : null);
  const totals = d.periods.years.map((r) => BARS.reduce((a, b) => a + (days(r, b) ?? 0), 0));
  const y = niceRange(totals, 3);
  const series: Record<string, unknown>[] = [];
  PERIODS.forEach((p, gi) => {
    for (const b of BARS) {
      series.push({
        type: 'bar',
        name: b.label,
        xAxisIndex: gi,
        yAxisIndex: gi,
        stack: p,
        barWidth: '60%',
        silent: true,
        emphasis: { disabled: true },
        itemStyle: { color: b.color, ...(b.decal ? { decal: b.decal } : {}) },
        data: years.map((yr) => days(rowOf(p, yr), b) || null),
      });
    }
  });
  const option = {
    legend: { top: 4, left: margin.left, right: margin.right, itemGap: 22, itemWidth: 22, itemHeight: 12, textStyle: { fontSize: 12, color: INK }, data: BARS.map((b) => b.label) },
    title: PERIODS.map((p, i) => panelTitle(PERIOD_TITLE[p], grids[i]!.left, grids[i]!.top - 22)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: cats,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel },
      name: i === PERIODS.length - 1 ? 'Year' : '',
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
      name: 'Event days',
      nameLocation: 'middle',
      nameGap: 42,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel },
      splitLine,
    })),
    series,
  };
  const parts = d.periods.years.map((r) => {
    const top = BARS.map((b) => ({ b, n: days(r, b) ?? 0 }))
      .filter((q) => q.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 2)
      .map((q) => `${q.b.label.toLowerCase()} ${q.n}`);
    const total = BARS.reduce((a, b) => a + (days(r, b) ?? 0), 0);
    return `${r.label} (${r.sitesWithData} sites): ${total} event days${top.length ? `, most ${top.join(' and ')}` : ''}`;
  });
  const alt = `Stacked bar chart in four panels, one per period of the year: the number of used event days of all sites per class and year. A day with two classes counts in both. Dry spell and failed rains share one colour. ${parts.join('; ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Text helpers ----------

/** Maktau rain seasons that failed (rain and soil water below the medians), for example "short rains 2020". */
export function failedSeasons(d: NaturalEventsData): string[] {
  return d.rainSeasons.maktau.filter((r) => r.failed).map((r) => `${r.season === 'MAM' ? 'March to May' : 'September to November'} ${r.year}`);
}

/** Maktau rain seasons without a result (too few days with rain data). */
export function untestedSeasons(d: NaturalEventsData): string[] {
  return d.rainSeasons.maktau.filter((r) => r.failed === null).map((r) => `${r.season === 'MAM' ? 'March to May' : 'September to November'} ${r.year}`);
}

/**
 * Days of the episodes of one class and site that fall in the given calendar months (1 to 12), and the
 * total days of these episodes. Each day from start to end of an episode counts once.
 */
export function monthDays(d: NaturalEventsData, site: SiteCode, cls: EventClass, months: readonly number[]): { n: number; total: number } {
  let n = 0;
  let total = 0;
  const seen = new Set<string>();
  for (const e of d.events[site] ?? []) {
    if (e.class !== cls) continue;
    for (let t = Date.parse(`${e.start}T00:00Z`), end = Date.parse(`${e.end}T00:00Z`); t <= end; t += 86_400_000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (seen.has(iso)) continue;
      seen.add(iso);
      total++;
      if (months.includes(Number(iso.slice(5, 7)))) n++;
    }
  }
  return { n, total };
}

// ---------- Tables ----------

export interface ClassRow {
  id: string;
  cls: string;
  site: string;
  days: string;
  episodes: string;
  event: string;
  nEvent: string;
  reference: string;
  nRef: string;
  diff: string;
}

/** Event days against reference days (other used days of the same calendar months), per class and site. */
export function classRows(d: NaturalEventsData): ClassRow[] {
  const out: ClassRow[] = [];
  for (const c of d.method.classes) {
    const bySite = d.classes[c];
    if (!bySite) continue;
    for (const s of SITES) {
      const r = bySite[s];
      if (!r) continue;
      const cnt = d.counts[s]?.[c];
      out.push({
        id: `${c}-${s}`,
        cls: CLASS_LABEL[c],
        site: SITE_NAMES[s],
        days: cnt ? (cnt.days === cnt.allDays ? String(cnt.days) : `${cnt.days} (${cnt.allDays})`) : '–',
        episodes: cnt ? String(cnt.episodes) : '–',
        event: meanSd(r.event),
        nEvent: fmtNum(r.event.n, 0),
        reference: meanSd(r.reference),
        nRef: fmtNum(r.reference.n, 0),
        diff: f2s(r.diff),
      });
    }
  }
  return out;
}

export interface PeriodRow {
  id: string;
  label: string;
  sites: string;
  n: string;
  nee: string;
  bySite: string;
  eventDays: string;
}

/** Pooled period-years: n, mean ± SD of daily NEE, the means per site and the event days. */
export function periodRows(d: NaturalEventsData): PeriodRow[] {
  return d.periods.years.map((r) => {
    const total = Object.values(r.eventDays).reduce((a, b) => a + b, 0);
    return {
      id: `${r.period}-${r.year}`,
      label: r.label,
      sites: String(r.sitesWithData),
      n: fmtNum(r.n, 0),
      nee: meanSd(r.nee),
      bySite: SITES.filter((s) => r.bySite[s])
        .map((s) => `${SITE_NAMES[s]} ${f2(r.bySite[s]!.nee.mean)} (${r.bySite[s]!.n})`)
        .join('; '),
      eventDays: String(total),
    };
  });
}

export interface EventRow {
  id: string;
  site: string;
  cls: string;
  dates: string;
  days: string;
  peak: string;
  nee: string;
}

function peakText(peak: number | null, unit: string): string {
  if (peak === null) return '–';
  if (unit === '%') return `rank ${fmtNum(peak, 1)} %`;
  if (unit === 'd') return `${fmtNum(peak, 0)} d`;
  return `${fmtNum(peak, 1)} ${unit}`;
}

/** One row per episode, sorted by site and start date. */
export function eventRows(d: NaturalEventsData): EventRow[] {
  const out: EventRow[] = [];
  for (const s of SITES) {
    const list = [...(d.events[s] ?? [])].sort((a, b) => a.start.localeCompare(b.start) || a.class.localeCompare(b.class));
    for (const e of list) {
      out.push({
        id: `${s}-${e.class}-${e.start}`,
        site: SITE_NAMES[s],
        cls: CLASS_LABEL[e.class] + (e.heatWave ? ' (heat wave)' : ''),
        dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
        days: e.usedDays === e.days ? String(e.days) : `${e.usedDays} of ${e.days}`,
        peak: peakText(e.peak, e.peakUnit),
        nee: e.nee.n ? `${meanSd(e.nee)} (${e.nee.n})` : '–',
      });
    }
  }
  return out;
}
