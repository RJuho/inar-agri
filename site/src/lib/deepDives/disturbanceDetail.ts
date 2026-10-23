// Figures and tables of the Deep Dive "Management disturbances in detail"
// (pages/deep-dive/disturbance-detail.mdx). Input: site/src/deep-dives/disturbance-detail.json
// (scripts/deep-dives/disturbance-detail.ts). Valibot checks the parts that the figures and tables use.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';
import { AXIS, FONT, gridHeight, INK, minus, niceRange, panelGrid, renderSvg, siteColor, siteSymbol } from '../deepDiveChart';

const N = v.nullable(v.number());
const S = v.nullable(v.string());
const Summary = v.object({ n: v.number(), mean: N, sd: N, min: N, max: N, ciLo: N, ciHi: N, nPositive: v.number() });
const Curve = v.object({ mean: v.array(N), sd: v.array(N), n: v.array(v.number()) });
const SITE = v.picklist(['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki']);
const GROUP = v.picklist(['silageHarvest', 'cleaningCut', 'grainHarvest']);
const FluxSummary = v.object({ delta: Summary, delta7: Summary, deltaLate: Summary, relPct: Summary, before: N, after: N });
const groupCore = {
  n: v.number(),
  nFlux: v.number(),
  nee: FluxSummary,
  gpp: FluxSummary,
  reco: FluxSummary,
  recoveryShare: Summary,
  daysToRecover: Summary,
  nRecovered: v.number(),
  nCensored: v.number(),
  fertInWindow: v.number(),
};
const GroupCore = v.object(groupCore);
const GroupSummary = v.object({
  ...groupCore,
  label: v.string(),
  deltaNoFert: v.object({ n: v.number(), nee: Summary, gpp: Summary, reco: Summary, gppRelPct: Summary }),
  bySite: v.record(v.string(), GroupCore),
});
const TimingPoint = v.object({ offset: N, clear: v.boolean(), reason: S, dropPct: N, before: N, detectedDate: S });
const TimingSummary = v.object({
  n: v.number(),
  nClear: v.number(),
  nNotClear: v.number(),
  offsets: Summary,
  median: N,
  nBefore: v.number(),
  nOn: v.number(),
  nAfter: v.number(),
  nNeeClear: v.number(),
  neeOffsets: Summary,
  nBoth: v.number(),
  nAgree: v.number(),
  preDropPct: Summary,
});
const Means = v.record(v.string(), N);
const Fit = v.object({ n: v.number(), slope: N, intercept: N, r: N, p: N });
const FitPoints = v.object({ ...Fit.entries, points: v.array(v.object({ id: v.string(), site: SITE, x: v.number(), y: v.number() })) });

const SiteInfo = v.object({ name: v.string(), slot: v.number() });

const DataSchema = v.object({
  method: v.object({
    beforeDays: v.number(),
    afterDays: v.number(),
    ciLevelPct: v.number(),
    recoverySharePct: v.number(),
    recoveryFrom: v.number(),
    recoveryTo: v.number(),
    compositeFrom: v.number(),
    compositeTo: v.number(),
    timingRefFrom: v.number(),
    timingRefTo: v.number(),
  }),
  sites: v.object({ anttila: SiteInfo, sarkisuo: SiteInfo, haltiala: SiteInfo, qvidja: SiteInfo, viikki: SiteInfo }),
  groups: v.object({ silageHarvest: GroupSummary, cleaningCut: GroupSummary, grainHarvest: GroupSummary }),
  harvestEpisodes: v.array(
    v.object({
      id: v.string(),
      site: SITE,
      group: GROUP,
      start: v.string(),
      end: v.string(),
      recorded: v.string(),
      override: v.array(v.string()),
      coEvents: v.array(v.object({ date: v.string(), type: v.string(), detail: v.string() })),
      yieldKgHa: N,
      yearYieldKgHa: N,
      before: v.object({ mean: Means }),
      delta: Means,
      relPct: v.object({ gpp: N, reco: N, nee: N }),
      fluxUsed: v.boolean(),
      fluxExclusion: S,
      fluxUse: v.string(),
      fertInWindow: v.boolean(),
      recovery: v.object({ sharePct: N, days: N, censored: v.boolean(), reason: S }),
      timing: v.object({
        used: v.boolean(),
        exclusion: S,
        recorded: v.string(),
        gpp: TimingPoint,
        nee: TimingPoint,
        agree: v.nullable(v.boolean()),
        preDrop: v.object({ pct: N }),
        lowFracDays: v.array(v.number()),
      }),
    }),
  ),
  yield: v.object({ vsYield: FitPoints, relVsYield: FitPoints, relVsGppBefore: FitPoints }),
  timing: v.object({
    all: TimingSummary,
    groups: v.object({ silageHarvest: TimingSummary, cleaningCut: TimingSummary, grainHarvest: TimingSummary }),
    sites: v.record(v.string(), TimingSummary),
    composite: v.object({
      offsets: v.array(v.number()),
      groups: v.record(
        v.string(),
        v.object({
          ...Curve.entries,
          lines: v.array(v.object({ id: v.string(), site: SITE, values: v.array(N), detectedOffset: N, clear: v.boolean() })),
        }),
      ),
    }),
  }),
  composite: v.object({
    offsets: v.array(v.number()),
    groups: v.record(v.string(), v.object({ episodes: v.number(), gppSharePct: Curve })),
  }),
});
export type DetailData = v.InferOutput<typeof DataSchema>;
type Group = v.InferOutput<typeof GROUP>;
type Site = v.InferOutput<typeof SITE>;
type SummaryOut = v.InferOutput<typeof Summary>;
type HarvestEpisode = DetailData['harvestEpisodes'][number];
type Flux = 'nee' | 'gpp' | 'reco';

export function disturbanceDetailData(raw: unknown): DetailData {
  return v.parse(DataSchema, raw);
}

const SITES = ['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki'] as const satisfies readonly SiteCode[];
const GROUPS: Group[] = ['silageHarvest', 'cleaningCut', 'grainHarvest'];
const GROUP_SHORT: Record<Group, string> = { silageHarvest: 'Silage harvest', cleaningCut: 'Cleaning cut', grainHarvest: 'Grain or bean harvest' };
/** Symbol per group in Figure 5 (the site gives the row and the colour). */
const GROUP_SYMBOL: Record<Group, string> = { silageHarvest: 'circle', cleaningCut: 'triangle', grainHarvest: 'diamond' };
const FLUXES: Flux[] = ['nee', 'gpp', 'reco'];
const FLUX_LABEL: Record<Flux, string> = { nee: 'NEE', gpp: 'GPP', reco: 'Reco' };
const UNIT_DAY = 'g C m⁻² d⁻¹';
const EXCLUSION_TEXT: Record<string, string> = { overlap: 'other event near', 'too-few-days': 'too few days', 'low-measured-fraction': 'low measured fraction' };
const REASON_TEXT: Record<string, string> = { 'drop-too-small': 'drop too small', 'flux-too-small': 'GPP too small', 'too-few-days': 'too few days' };

const f0 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 0));
const f1 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 1));
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 2));
const f0s = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 0, { sign: true }));
const f1s = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 1, { sign: true }));
const f2s = (x: number | null | undefined) => (x === null || x === undefined ? '–' : fmtNum(x, 2, { sign: true }));

/** "+3.71 ± 2.01 [2.68, 4.74]"; the interval only with three or more values, the SD only with two or more. */
function meanText(s: SummaryOut, fmt: (x: number | null) => string, withCi = true): string {
  if (s.n === 0 || s.mean === null) return '–';
  let t = fmt(s.mean);
  if (s.n >= 2 && s.sd !== null) t += ` ± ${fmt(s.sd).replace(/^\+/, '')}`;
  if (withCi && s.n >= 3 && s.ciLo !== null && s.ciHi !== null) t += ` [${fmt(s.ciLo)}, ${fmt(s.ciHi)}]`;
  return t;
}
/** Mean with n for the alt texts: "+3.71 (n = 14, 95 % interval +2.68 to +4.74)". */
function altMean(s: SummaryOut, fmt: (x: number | null) => string): string {
  if (s.n === 0 || s.mean === null) return 'no value';
  const ci = s.n >= 3 && s.ciLo !== null && s.ciHi !== null ? `, interval ${fmt(s.ciLo)} to ${fmt(s.ciHi)}` : '';
  return `${fmt(s.mean)} (n = ${s.n}${ci})`;
}

export interface FigureOut {
  svg: string;
  alt: string;
}

const axisLabel = { fontSize: 11, color: INK, fontFamily: FONT };
const nameStyle = { fontSize: 12, color: INK };
const splitLine = { lineStyle: { color: AXIS, opacity: 0.3 } };
const panelTitle = (text: string, left: number, top: number) => ({ text, left, top, textAlign: 'center', textStyle: { fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT } });
const zeroLine = (base: Record<string, unknown>, data: Record<string, unknown>[]) => ({
  ...base,
  type: 'line',
  data: [],
  markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, type: 'solid', width: 1 }, data },
});
/** Hollow symbol style: outline in the colour, no fill. */
const hollow = (color: string, width = 1.5) => ({ color: 'transparent', borderColor: color, borderWidth: width });
const siteSlot = (d: DetailData, s: Site) => d.sites[s].slot;
const siteLegend = (d: DetailData, sites: readonly Site[]) =>
  sites.map((s) => ({ name: SITE_NAMES[s], icon: siteSymbol(siteSlot(d, s)), itemStyle: { color: siteColor(siteSlot(d, s)) } }));

/** Band series (invisible lower line plus the stacked width) for mean ± sd on a category axis. */
function bandSeries(base: Record<string, unknown>, mean: (number | null)[], sd: (number | null)[], color: string, stack: string, opacity = 0.16): Record<string, unknown>[] {
  const lower = mean.map((m, i) => (m === null || sd[i] === null ? null : m - sd[i]!));
  const width2 = sd.map((s, i) => (s === null || mean[i] === null ? null : 2 * s));
  return [
    { ...base, type: 'line', stack, stackStrategy: 'all', data: lower, lineStyle: { opacity: 0 } },
    { ...base, type: 'line', stack, stackStrategy: 'all', data: width2, lineStyle: { opacity: 0 }, areaStyle: { color, opacity } },
  ];
}

// ---------- Figure 1: change per group ----------

/** Change (after − before) of NEE, GPP and Reco per used episode, grouped by harvest group, with the group mean and CI. */
export function groupChangeFigure(d: DetailData): FigureOut {
  const width = 1100;
  const cols = FLUXES.length;
  const margin = { left: 58, right: 16, top: 72, bottom: 92 };
  const grids = panelGrid(cols, cols, width, margin, { x: 28, y: 0 }, 290);
  const height = gridHeight(cols, cols, margin, 0, 290);
  const used = d.harvestEpisodes.filter((e) => e.fluxUsed);
  const vals: number[] = [];
  for (const e of used) for (const f of FLUXES) if (e.delta[f] !== null && e.delta[f] !== undefined) vals.push(e.delta[f]!);
  for (const g of GROUPS) for (const f of FLUXES) {
    const s = d.groups[g][f].delta;
    if (s.n >= 3 && s.ciLo !== null && s.ciHi !== null) vals.push(s.ciLo, s.ciHi);
  }
  const y = niceRange(vals, 6);
  const series: Record<string, unknown>[] = [];
  FLUXES.forEach((f, gi) => {
    const base = { xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true } };
    for (const s of SITES) {
      const slot = siteSlot(d, s);
      const pts: number[][] = [];
      GROUPS.forEach((g, ki) => {
        const all = used.filter((e) => e.group === g);
        all.forEach((e, idx) => {
          if (e.site !== s) return;
          const x = e.delta[f];
          if (x === null || x === undefined) return;
          const spread = all.length > 1 ? -0.26 + (0.42 * idx) / (all.length - 1) : -0.05;
          pts.push([ki + spread, x]);
        });
      });
      series.push({ ...base, type: 'scatter', name: SITE_NAMES[s], symbol: siteSymbol(slot), symbolSize: 9, data: pts, itemStyle: { color: siteColor(slot), opacity: 0.9 } });
    }
    GROUPS.forEach((g, ki) => {
      const s = d.groups[g][f].delta;
      const xk = ki + 0.34;
      if (s.n >= 3 && s.ciLo !== null && s.ciHi !== null) series.push({ ...base, type: 'line', symbol: 'none', data: [[xk, s.ciLo], [xk, s.ciHi]], lineStyle: { color: INK, width: 2 } });
      if (s.mean !== null) series.push({ ...base, type: 'scatter', symbol: 'diamond', symbolSize: 13, data: [[xk, s.mean]], itemStyle: { color: INK }, z: 5 });
    });
    series.push(zeroLine(base, [{ yAxis: 0 }]));
  });
  const option = {
    legend: { top: 4, left: margin.left, itemGap: 20, textStyle: { fontSize: 12, color: INK }, data: siteLegend(d, SITES) },
    title: FLUXES.map((f, i) => panelTitle(FLUX_LABEL[f], grids[i]!.left + grids[i]!.width / 2, 38)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: -0.5,
      max: GROUPS.length - 0.5,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, customValues: GROUPS.map((_, k) => k), rotate: 30, formatter: (x: number) => (GROUPS[x] ? GROUP_SHORT[GROUPS[x]!] : '') },
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: i === 0 ? `Change, after − before (${UNIT_DAY})` : '',
      axisLine: { show: false },
      axisTick: { show: false },
      nameLocation: 'middle',
      nameGap: 36,
      nameTextStyle: nameStyle,
      axisLabel: { ...axisLabel, show: i === 0, formatter: (x: number) => minus(x) },
      splitLine,
    })),
    series,
  };
  const parts = GROUPS.map((g) => {
    const s = d.groups[g];
    return `${s.label}, ${s.nFlux} used episodes: NEE ${altMean(s.nee.delta, f2s)}, GPP ${altMean(s.gpp.delta, f2s)}, Reco ${altMean(s.reco.delta, f2s)}`;
  });
  const alt = `Dot chart in three panels (NEE, GPP, Reco): change of the mean daily flux from the ${d.method.beforeDays} days before to the ${d.method.afterDays} days after each harvest or cut episode, in ${UNIT_DAY}, grouped as silage harvest, cleaning cut and grain or bean harvest. Each symbol is one used episode; the symbol and colour give the site. A diamond gives the group mean, a vertical line its ${d.method.ciLevelPct} % bootstrap interval (three or more episodes). ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 2: recovery of GPP ----------

/** GPP as percent of the mean before, mean ± SD of the used episodes, one panel per group. */
export function recoveryFigure(d: DetailData): FigureOut {
  const width = 1100;
  const cols = GROUPS.length;
  const margin = { left: 58, right: 16, top: 72, bottom: 54 };
  const panelH = 270;
  const grids = panelGrid(cols, cols, width, margin, { x: 28, y: 0 }, panelH);
  const height = gridHeight(cols, cols, margin, 0, panelH);
  const offsets = d.composite.offsets;
  const cats = offsets.map(String);
  /** Mean and SD only where two or more episodes have a value. */
  const curve = (g: Group) => {
    const c = d.composite.groups[g]!.gppSharePct;
    return { mean: c.mean.map((m, i) => (c.n[i]! >= 2 ? m : null)), sd: c.sd.map((s, i) => (c.n[i]! >= 2 ? s : null)), n: c.n };
  };
  const vals: number[] = [];
  for (const g of GROUPS) {
    const c = curve(g);
    c.mean.forEach((m, i) => {
      if (m !== null) vals.push(m - (c.sd[i] ?? 0), m + (c.sd[i] ?? 0));
    });
  }
  const y = niceRange(vals, 6);
  const series: Record<string, unknown>[] = [];
  GROUPS.forEach((g, gi) => {
    const c = curve(g);
    const base = { xAxisIndex: gi, yAxisIndex: gi, symbol: 'none', silent: true, emphasis: { disabled: true } };
    series.push(...bandSeries(base, c.mean, c.sd, INK, `${g}-gpp`));
    series.push({ ...base, type: 'line', name: 'GPP, mean', data: c.mean, lineStyle: { color: INK, width: 2.5 }, itemStyle: { color: INK }, z: 4 });
    series.push(
      zeroLine(base, [
        { yAxis: 0 },
        { yAxis: 100, lineStyle: { color: INK, type: 'solid', width: 1, opacity: 0.6 } },
        { yAxis: d.method.recoverySharePct, lineStyle: { color: INK, type: [2, 3], width: 1 } },
        { xAxis: '0', lineStyle: { color: INK, type: [6, 4], width: 1 } },
      ]),
    );
  });
  const option = {
    title: GROUPS.map((g, i) => panelTitle(`${GROUP_SHORT[g]} (n = ${d.composite.groups[g]!.episodes})`, grids[i]!.left + grids[i]!.width / 2, grids[i]!.top - 40)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: cats,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, interval: (idx: number) => offsets[idx]! % 7 === 0, formatter: (s: string) => minus(s) },
      name: i === 1 ? 'Days from the first day of the episode' : '',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: nameStyle,
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: i === 0 ? 'GPP (% of the mean before)' : '',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: nameStyle,
      axisLabel: { ...axisLabel, show: i === 0, formatter: (x: number) => minus(x) },
      splitLine,
    })),
    series,
  };
  const at = (g: Group, day: number) => curve(g).mean[offsets.indexOf(day)] ?? null;
  const parts = GROUPS.map((g) => {
    const s = d.groups[g];
    return `${s.label} (${d.composite.groups[g]!.episodes} episodes): ${f0(at(g, 7))} % on day 7, ${f0(at(g, 21))} % on day 21; recovery share (days ${d.method.recoveryFrom} to ${d.method.recoveryTo} after the end) ${altMean(s.recoveryShare, f0)} %; ${s.nRecovered} episodes reached ${d.method.recoverySharePct} %, ${s.nCensored} censored`;
  });
  const alt = `Line chart with three panels, one per harvest group: daily GPP as percent of the mean of the ${d.method.beforeDays} days before the episode, mean of the used episodes (line) with a ±1 SD band, from day ${minus(offsets[0]!)} to day ${offsets[offsets.length - 1]} around the first day of the episode. Horizontal lines at 100 % and at ${d.method.recoverySharePct} % (dotted, the recovery level); dashed vertical line at day 0. Days with fewer than two episodes are left out. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 3: yield and canopy ----------

/** Two scatter panels: ΔGPP against the per-event yield (Anttila, Qvidja, Särkisuo), and the relative ΔGPP against the GPP before (all silage harvests). */
export function yieldFigure(d: DetailData): FigureOut {
  const width = 1100;
  const height = 420;
  const margin = { left: 64, right: 20, top: 84, bottom: 58 };
  const grids = panelGrid(2, 2, width, margin, { x: 76, y: 0 }, height - margin.top - margin.bottom);
  const panels = [
    { fit: d.yield.vsYield, xScale: 1 / 1000, xName: 'Yield of the harvest (t DW/ha)', yName: `ΔGPP (${UNIT_DAY})`, title: 'ΔGPP against the yield of the harvest' },
    { fit: d.yield.relVsGppBefore, xScale: 1, xName: `Mean GPP before (${UNIT_DAY})`, yName: 'ΔGPP (% of the GPP before)', title: 'Relative ΔGPP against the GPP before (silage harvests)' },
  ];
  const series: Record<string, unknown>[] = [];
  const sitesShown = SITES.filter((s) => panels.some((p) => p.fit.points.some((q) => q.site === s)));
  const xAxis: Record<string, unknown>[] = [];
  const yAxis: Record<string, unknown>[] = [];
  panels.forEach((p, gi) => {
    const base = { xAxisIndex: gi, yAxisIndex: gi, emphasis: { disabled: true } };
    for (const s of sitesShown) {
      const slot = siteSlot(d, s);
      series.push({ ...base, type: 'scatter', name: SITE_NAMES[s], symbol: siteSymbol(slot), symbolSize: 11, data: p.fit.points.filter((q) => q.site === s).map((q) => [q.x * p.xScale, q.y]), itemStyle: { color: siteColor(slot), opacity: 0.9 } });
    }
    const xs = p.fit.points.map((q) => q.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    if (p.fit.slope !== null && p.fit.intercept !== null) {
      series.push({ ...base, type: 'line', silent: true, symbol: 'none', data: [[x0 * p.xScale, p.fit.intercept + p.fit.slope * x0], [x1 * p.xScale, p.fit.intercept + p.fit.slope * x1]], lineStyle: { color: INK, type: [6, 4], width: 2 } });
    }
    series.push(zeroLine(base, [{ yAxis: 0 }]));
    const yr = niceRange(p.fit.points.map((q) => q.y), 5);
    const xr = niceRange(xs.map((x) => x * p.xScale), 6);
    xAxis.push({ type: 'value', gridIndex: gi, min: xr.min, max: xr.max, interval: xr.interval, name: p.xName, nameLocation: 'middle', nameGap: 32, nameTextStyle: nameStyle, axisLine: { onZero: false, lineStyle: { color: AXIS } }, axisLabel: { ...axisLabel, formatter: (x: number) => minus(x) }, splitLine });
    yAxis.push({ type: 'value', gridIndex: gi, min: yr.min, max: yr.max, interval: yr.interval, name: p.yName, nameLocation: 'middle', nameGap: 44, nameTextStyle: nameStyle, axisLabel: { ...axisLabel, formatter: (x: number) => minus(x) }, splitLine });
  });
  const fitText = (f: (typeof panels)[number]['fit']) => `n = ${f.n}, r = ${f2(f.r)}, p = ${f.p === null ? '–' : fmtNum(f.p, 3)}`;
  const option = {
    legend: { top: 4, left: margin.left, itemGap: 20, textStyle: { fontSize: 12, color: INK }, data: siteLegend(d, sitesShown) },
    title: panels.flatMap((p, i) => [
      panelTitle(p.title, grids[i]!.left + grids[i]!.width / 2, 36),
      { text: fitText(p.fit), left: grids[i]!.left + grids[i]!.width / 2, top: 56, textAlign: 'center', textStyle: { fontSize: 12, fontWeight: 400, color: INK, fontFamily: FONT } },
    ]),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis,
    yAxis,
    series,
  };
  const ry = d.yield.relVsYield;
  const alt = `Scatter chart in two panels. Left: change of the mean daily GPP (after − before, ${UNIT_DAY}) against the dry-matter yield of the same harvest (t DW/ha), silage harvests with a yield per harvest (${SITES.filter((s) => d.yield.vsYield.points.some((q) => q.site === s)).map((s) => SITE_NAMES[s]).join(', ')}), ${fitText(d.yield.vsYield)}, slope ${f2s(d.yield.vsYield.slope === null ? null : d.yield.vsYield.slope * 1000)} ${UNIT_DAY} per t DW/ha. The relative change against the yield gives ${fitText(ry)}. Right: relative change of GPP (% of the mean before) against the mean GPP before, all used silage harvests of ${sitesShown.length} sites, ${fitText(d.yield.relVsGppBefore)}. Symbol and colour give the site; dashed lines are least-squares fits.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 4: timing composite ----------

/** GPP around the recorded date, as percent of the reference days, one thin line per episode and the group mean. */
export function timingFigure(d: DetailData): FigureOut {
  const width = 1100;
  const cols = GROUPS.length;
  const margin = { left: 58, right: 16, top: 100, bottom: 54 };
  const panelH = 290;
  const grids = panelGrid(cols, cols, width, margin, { x: 28, y: 0 }, panelH);
  const height = gridHeight(cols, cols, margin, 0, panelH);
  const tc = d.timing.composite;
  const offsets = tc.offsets;
  const cats = offsets.map(String);
  const vals: number[] = [];
  for (const g of GROUPS) for (const l of tc.groups[g]?.lines ?? []) for (const x of l.values) if (x !== null) vals.push(x);
  const y = niceRange(vals, 6);
  const series: Record<string, unknown>[] = [];
  const sitesShown = SITES.filter((s) => GROUPS.some((g) => tc.groups[g]?.lines.some((l) => l.site === s)));
  GROUPS.forEach((g, gi) => {
    const c = tc.groups[g];
    const base = { xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true } };
    if (!c) return;
    for (const l of c.lines) {
      const slot = siteSlot(d, l.site);
      series.push({ ...base, type: 'line', symbol: 'none', data: l.values, lineStyle: { color: siteColor(slot), width: 1, opacity: 0.55 } });
      if (l.detectedOffset !== null) {
        const idx = offsets.indexOf(l.detectedOffset);
        const yv = idx >= 0 ? l.values[idx] : null;
        if (yv !== null && yv !== undefined) {
          series.push({ ...base, type: 'scatter', symbol: siteSymbol(slot), symbolSize: 10, data: [[String(l.detectedOffset), yv]], itemStyle: l.clear ? { color: siteColor(slot), borderColor: '#ffffff', borderWidth: 0.5 } : hollow(siteColor(slot)), z: 5 });
        }
      }
    }
    series.push({ ...base, type: 'line', name: 'Group mean', symbol: 'none', data: c.mean.map((m, i) => (c.n[i]! >= 2 ? m : null)), lineStyle: { color: INK, width: 3 }, itemStyle: { color: INK }, z: 6 });
    series.push(
      zeroLine(base, [
        { yAxis: 0 },
        { yAxis: 100, lineStyle: { color: INK, type: 'solid', width: 1, opacity: 0.6 } },
        { xAxis: '0', lineStyle: { color: INK, type: [6, 4], width: 1 } },
      ]),
    );
  });
  const legendData: Record<string, unknown>[] = [
    ...siteLegend(d, sitesShown),
    { name: 'Group mean', icon: 'path://M0,4 L24,4 L24,7 L0,7 Z', itemStyle: { color: INK } },
  ];
  // Legend-only series for the site entries.
  for (const s of sitesShown) series.push({ type: 'scatter', name: SITE_NAMES[s], data: [], xAxisIndex: 0, yAxisIndex: 0, itemStyle: { color: siteColor(siteSlot(d, s)) } });
  const option = {
    legend: { top: 4, left: margin.left, itemGap: 20, textStyle: { fontSize: 12, color: INK }, data: legendData },
    title: GROUPS.map((g, i) => panelTitle(`${GROUP_SHORT[g]} (${tc.groups[g]?.lines.length ?? 0} episodes)`, grids[i]!.left + grids[i]!.width / 2, grids[i]!.top - 40)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: cats,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, interval: (idx: number) => offsets[idx]! % 5 === 0, formatter: (s: string) => minus(s) },
      name: i === 1 ? 'Days from the recorded harvest date' : '',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: nameStyle,
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: i === 0 ? `GPP (% of days ${minus(d.method.timingRefFrom)} to ${minus(d.method.timingRefTo)})` : '',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: nameStyle,
      axisLabel: { ...axisLabel, show: i === 0, formatter: (x: number) => minus(x) },
      splitLine,
    })),
    series,
  };
  const parts = GROUPS.map((g) => {
    const t = d.timing.groups[g];
    const lines = tc.groups[g]?.lines ?? [];
    const clear = lines.filter((l) => l.clear).map((l) => `${l.id} ${f0s(l.detectedOffset)}`);
    return `${d.groups[g].label}: ${lines.length} lines, ${t.nClear} of ${t.n} used episodes with a clear drop${t.nClear ? `, mean offset ${altMean(t.offsets, f1s)} days, median ${f0s(t.median)}` : ''}${clear.length && clear.length <= 4 ? ` (${clear.join(', ')})` : ''}`;
  });
  const alt = `Line chart with three panels, one per harvest group: daily GPP from day ${minus(offsets[0]!)} to day ${offsets[offsets.length - 1]} around the recorded harvest date, as percent of the mean of days ${minus(d.method.timingRefFrom)} to ${minus(d.method.timingRefTo)}. One thin line per episode in the site colour; the site symbol marks the detected day of the drop (filled = clear drop, hollow = no clear drop); the thick line is the group mean. Dashed vertical line at the recorded date. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 5: offsets per site ----------

/** Offset of the detected drop from the recorded date, per site row; filled = GPP, hollow = measured NEE; symbol = group. */
export function offsetFigure(d: DetailData): FigureOut {
  const width = 1100;
  const margin = { left: 96, right: 20, top: 64, bottom: 58 };
  const rowH = 58;
  const height = margin.top + SITES.length * rowH + margin.bottom;
  const used = d.harvestEpisodes.filter((e) => e.timing.used);
  const series: Record<string, unknown>[] = [];
  const xs: number[] = [];
  const counts = new Map<string, number>();
  /** Stack points of the same site, flux and offset a little apart. */
  const place = (row: number, flux: 'gpp' | 'nee', x: number) => {
    const key = `${row}|${flux}|${x}`;
    const k = counts.get(key) ?? 0;
    counts.set(key, k + 1);
    return row + (flux === 'gpp' ? -0.17 : 0.17) + (flux === 'gpp' ? -1 : 1) * 0.1 * k;
  };
  SITES.forEach((s, row) => {
    const slot = siteSlot(d, s);
    const color = siteColor(slot);
    for (const g of GROUPS) {
      const eps = used.filter((e) => e.site === s && e.group === g);
      const gpp = eps.filter((e) => e.timing.gpp.clear && e.timing.gpp.offset !== null).map((e) => [e.timing.gpp.offset!, place(row, 'gpp', e.timing.gpp.offset!)]);
      const nee = eps.filter((e) => e.timing.nee.clear && e.timing.nee.offset !== null).map((e) => [e.timing.nee.offset!, place(row, 'nee', e.timing.nee.offset!)]);
      for (const p of [...gpp, ...nee]) xs.push(p[0]!);
      if (gpp.length) series.push({ type: 'scatter', symbol: GROUP_SYMBOL[g], symbolSize: 12, data: gpp, itemStyle: { color }, emphasis: { disabled: true } });
      if (nee.length) series.push({ type: 'scatter', symbol: GROUP_SYMBOL[g], symbolSize: 12, data: nee, itemStyle: hollow(color, 2), emphasis: { disabled: true } });
    }
  });
  series.push({ type: 'line', data: [], markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: INK, type: [6, 4], width: 1 }, data: [{ xAxis: 0 }] } });
  // Legend-only series.
  const legendItems = [
    ...GROUPS.map((g) => ({ name: GROUP_SHORT[g], symbol: GROUP_SYMBOL[g], style: { color: INK } as Record<string, unknown> })),
    { name: 'GPP (filled)', symbol: 'circle', style: { color: INK } as Record<string, unknown> },
    { name: 'Measured NEE (hollow)', symbol: 'circle', style: hollow(INK, 2) },
  ];
  for (const it of legendItems) series.push({ type: 'scatter', name: it.name, symbol: it.symbol, data: [], itemStyle: it.style });
  // One day of space at each end, so that no symbol is cut at the edge.
  const xMin = 2 * Math.floor((Math.min(0, ...xs) - 1) / 2);
  const xMax = 2 * Math.ceil((Math.max(0, ...xs) + 1) / 2);
  const option = {
    legend: { top: 4, left: margin.left, itemGap: 34, textStyle: { fontSize: 12, color: INK }, data: legendItems.map((it) => ({ name: it.name, icon: it.symbol, itemStyle: it.style })) },
    grid: { left: margin.left, right: margin.right, top: margin.top, bottom: margin.bottom, containLabel: false },
    xAxis: { type: 'value', min: xMin, max: xMax, interval: 2, name: 'Detected day of the drop − recorded date (days; < 0 = before the record)', nameLocation: 'middle', nameGap: 32, nameTextStyle: nameStyle, axisLine: { onZero: false, lineStyle: { color: AXIS } }, axisLabel: { ...axisLabel, formatter: (x: number) => minus(x) }, splitLine },
    yAxis: {
      type: 'value',
      min: -0.5,
      max: SITES.length - 0.5,
      inverse: true,
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: { ...axisLabel, fontSize: 12, customValues: SITES.map((_, i) => i), formatter: (x: number) => (SITES[x] ? SITE_NAMES[SITES[x]!] : '') },
    },
    series,
  };
  const parts = SITES.map((s) => {
    const t = d.timing.sites[s];
    if (!t || t.n === 0) return `${SITE_NAMES[s]}: no used episode`;
    const gppList = used.filter((e) => e.site === s && e.timing.gpp.clear).map((e) => f0s(e.timing.gpp.offset));
    return `${SITE_NAMES[s]}: ${t.n} used episodes, ${t.nClear} clear GPP drops (offsets ${gppList.join(', ') || 'none'}), ${t.nNeeClear} clear drops of measured NEE`;
  });
  const a = d.timing.all;
  const alt = `Dot chart: offset in days of the detected flux drop from the recorded harvest or cut date, one row per site. Filled symbols use daily GPP, hollow symbols the measured day-time NEE; the symbol gives the group (circle silage harvest, triangle cleaning cut, diamond grain or bean harvest); the colour gives the site. Dashed vertical line at 0. ${a.nNotClear} of the ${a.n} used episodes have no clear GPP drop and are not drawn as filled symbols. All sites: mean GPP offset ${altMean(a.offsets, f1s)} days, median ${f0s(a.median)}. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Tables ----------

export interface GroupRow {
  id: string;
  group: string;
  site: string;
  n: string;
  nee: string;
  gpp: string;
  reco: string;
  nee7: string;
  relGpp: string;
  recovery: string;
  days: string;
  censored: string;
}

function groupRow(id: string, label: string, site: string, s: v.InferOutput<typeof GroupCore>): GroupRow {
  return {
    id,
    group: label,
    site,
    n: `${s.nFlux} / ${s.n}`,
    nee: meanText(s.nee.delta, f2s),
    gpp: meanText(s.gpp.delta, f2s),
    reco: meanText(s.reco.delta, f2s),
    nee7: meanText(s.nee.delta7, f2s, false),
    relGpp: meanText(s.gpp.relPct, f0s),
    recovery: meanText(s.recoveryShare, f0),
    days: s.daysToRecover.n ? `${meanText(s.daysToRecover, f1, false)} (n = ${s.daysToRecover.n})` : '–',
    censored: String(s.nCensored),
  };
}

/** Summary per group (all sites) and per group and site (groups with two or more sites). */
export function groupRows(d: DetailData): GroupRow[] {
  const rows: GroupRow[] = [];
  for (const g of GROUPS) {
    const s = d.groups[g];
    const sites = SITES.filter((x) => s.bySite[x] && s.bySite[x]!.n > 0);
    rows.push(groupRow(`group-${g}`, s.label, sites.length > 1 ? 'All' : sites.map((x) => SITE_NAMES[x]).join(', '), s));
    if (sites.length > 1) for (const x of sites) rows.push(groupRow(`group-${g}-${x}`, '', SITE_NAMES[x], s.bySite[x]!));
  }
  return rows;
}

export interface EpisodeRow {
  id: string;
  site: string;
  dates: string;
  group: string;
  override: string;
  coEvents: string;
  yieldText: string;
  gppBefore: string;
  dNee: string;
  dGpp: string;
  dReco: string;
  relGpp: string;
  recovery: string;
  gppOffset: string;
  neeOffset: string;
  agree: string;
  preDrop: string;
  lowFrac: string;
  fluxUse: string;
  timingUse: string;
}

const offsetText = (p: HarvestEpisode['timing']['gpp']) =>
  p.offset === null ? (p.reason ? `– (${REASON_TEXT[p.reason] ?? p.reason})` : '–') : p.clear ? f0s(p.offset) : `${f0s(p.offset)} (not clear: ${REASON_TEXT[p.reason ?? ''] ?? p.reason ?? ''})`;

/** All harvest and cut episodes with the change, the recovery and the timing columns. */
export function episodeRows(d: DetailData): EpisodeRow[] {
  return d.harvestEpisodes.map((e) => {
    const r = e.recovery;
    const recovery = [r.sharePct === null ? null : `${f0(r.sharePct)} %`, r.days !== null ? `${f0(r.days)} d` : r.censored ? 'censored' : null].filter(Boolean).join(', ') || '–';
    const t = e.timing;
    return {
      id: e.id,
      site: SITE_NAMES[e.site],
      dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
      group: GROUP_SHORT[e.group],
      override: e.override.length ? e.override.join(' ') : '–',
      coEvents: e.coEvents.length ? e.coEvents.map((c) => `${c.type} ${c.date}`).join('; ') : '–',
      yieldText: e.yieldKgHa !== null ? `${fmtNum(e.yieldKgHa / 1000, 2)} t` : e.yearYieldKgHa !== null ? `year: ${fmtNum(e.yearYieldKgHa / 1000, 2)} t` : '–',
      gppBefore: f2(e.before.mean.gpp),
      dNee: f2s(e.delta.nee),
      dGpp: f2s(e.delta.gpp),
      dReco: f2s(e.delta.reco),
      relGpp: e.relPct.gpp === null ? '–' : `${f0s(e.relPct.gpp)} %`,
      recovery: e.fluxUsed ? recovery : '–',
      gppOffset: t.used ? offsetText(t.gpp) : '–',
      neeOffset: t.used ? offsetText(t.nee) : '–',
      agree: t.agree === null ? '–' : t.agree ? 'yes' : 'no',
      preDrop: t.preDrop.pct === null ? '–' : `${f0s(t.preDrop.pct)} %`,
      lowFrac: t.lowFracDays.length ? String(t.lowFracDays.length) : '0',
      fluxUse: e.fluxUsed ? (e.fertInWindow ? 'used (fertilisation in a window)' : 'used') : (EXCLUSION_TEXT[e.fluxExclusion ?? ''] ?? e.fluxUse),
      timingUse: t.used ? 'used' : (t.exclusion ?? 'not used'),
    };
  });
}
