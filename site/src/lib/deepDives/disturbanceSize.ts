// Figures and tables of the Deep Dive "Size of management disturbances"
// (pages/deep-dive/disturbance-size.mdx). Input: site/src/deep-dives/disturbance-size.json
// (scripts/deep-dives/disturbance-size.ts). Valibot checks the parts that the figures use.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';
import { AXIS, FLUX_COLOR, FLUX_DASH, FLUX_SYMBOL, FONT, gridHeight, INK, minus, niceRange, panelGrid, renderSvg, SERIES, siteColor, siteSymbol } from '../deepDiveChart';

const N = v.nullable(v.number());
const Curve = v.object({ mean: v.array(N), sd: v.array(N), n: v.array(v.number()) });
const Summary = v.object({ n: v.number(), mean: N, sd: N, min: N, max: N, ciLo: N, ciHi: N, nPositive: v.number() });
const FluxVar = v.object({ delta: Summary, deltaAdj: Summary, excess: Summary, before: N, after: N });
/** Relative change (percent) per after window (key d7, d14, d21), per episode and as the kind summary. */
const RelativeValues = v.record(v.string(), v.object({ nee: N, gpp: N, reco: N }));
const RelativeSummaries = v.record(v.string(), v.object({ nee: Summary, gpp: Summary, reco: Summary }));
const SITE = v.picklist(['haltiala', 'qvidja', 'viikki']);
const KIND = v.picklist(['harvestCut', 'harvestCutFert', 'grazing', 'fertilisation', 'tillage', 'tillageFert', 'other']);
const Means = v.record(v.string(), N);
const WindowJson = v.object({ mean: Means, rain: N });
const bySite = <T extends v.GenericSchema>(schema: T) => v.object({ haltiala: schema, qvidja: schema, viikki: schema });

const KindSummary = v.object({
  label: v.string(),
  n: v.number(),
  nFlux: v.number(),
  nSwc: v.number(),
  nee: FluxVar,
  gpp: FluxVar,
  reco: FluxVar,
  relGppPct: Summary,
  relative: RelativeSummaries,
  swc: v.object({
    delta: Summary,
    deltaAdj: Summary,
    nRainBalanced: v.number(),
    deltaRainBalanced: Summary,
    rainFit: v.object({ n: v.number(), slope: N, intercept: N, r: N, p: N }),
  }),
});

const DataSchema = v.object({
  method: v.object({
    beforeDays: v.number(),
    afterDays: v.number(),
    excessDays: v.number(),
    compositeFrom: v.number(),
    compositeTo: v.number(),
    ciLevelPct: v.number(),
    rainBalanceMm: v.number(),
    relativeAfterDays: v.array(v.number()),
    gppRefDays: v.number(),
  }),
  sites: bySite(v.object({ name: v.string(), slot: v.number() })),
  kinds: v.record(v.string(), KindSummary),
  composite: v.object({
    offsets: v.array(v.number()),
    kinds: v.record(v.string(), v.object({ fluxEpisodes: v.number(), swcEpisodes: v.number(), nee: Curve, gpp: Curve, reco: Curve, swcAnomaly: Curve, rain: Curve })),
  }),
  episodes: v.array(
    v.object({
      id: v.string(),
      site: SITE,
      kind: KIND,
      fert: v.nullable(v.string()),
      start: v.string(),
      end: v.string(),
      crop: v.nullable(v.string()),
      nKgHa: N,
      dryMassKgHa: N,
      events: v.array(v.object({ type: v.string(), detail: v.string() })),
      before: WindowJson,
      after: WindowJson,
      delta: Means,
      deltaAdj: Means,
      excess: v.object({ nee: N, gpp: N, reco: N }),
      relative: RelativeValues,
      rainDiff: N,
      rainBalanced: v.boolean(),
      rainSource: v.string(),
      fluxUsed: v.boolean(),
      fluxExclusion: v.nullable(v.string()),
      swcUsed: v.boolean(),
      swcExclusion: v.nullable(v.string()),
      measuredDay: v.object({ delta: N }),
      otherEvents: v.array(v.object({ date: v.string(), type: v.string() })),
    }),
  ),
});
export type DisturbanceData = v.InferOutput<typeof DataSchema>;
type Episode = DisturbanceData['episodes'][number];
type SummaryOut = v.InferOutput<typeof Summary>;
type Kind = v.InferOutput<typeof KIND>;
type Flux = 'nee' | 'gpp' | 'reco';

export function disturbanceData(raw: unknown): DisturbanceData {
  return v.parse(DataSchema, raw);
}

const SITES = ['haltiala', 'qvidja', 'viikki'] as const satisfies readonly SiteCode[];
const FLUXES: Flux[] = ['nee', 'gpp', 'reco'];
const FLUX_LABEL: Record<Flux, string> = { nee: 'NEE', gpp: 'GPP', reco: 'Reco' };
/** Kinds in the order of the figures. */
const KIND_ORDER: Kind[] = ['harvestCut', 'grazing', 'fertilisation', 'tillage', 'tillageFert', 'harvestCutFert', 'other'];
/** Short labels of the kinds for axis ticks. */
const KIND_SHORT: Record<Kind, string> = {
  harvestCut: 'Harvest or cut',
  harvestCutFert: 'Harvest + fert.',
  grazing: 'Grazing',
  fertilisation: 'Fertilisation',
  tillage: 'Tillage',
  tillageFert: 'Tillage + fert.',
  other: 'Other',
};
/** Colour and symbol per kind (Okabe-Ito, no green and red pair). */
const KIND_STYLE: Record<Kind, { color: string; symbol: string }> = {
  harvestCut: { color: SERIES[0], symbol: 'circle' },
  grazing: { color: SERIES[1], symbol: 'triangle' },
  fertilisation: { color: SERIES[3], symbol: 'rect' },
  tillage: { color: SERIES[2], symbol: 'diamond' },
  tillageFert: { color: SERIES[5], symbol: 'roundRect' },
  harvestCutFert: { color: INK, symbol: 'pin' },
  other: { color: INK, symbol: 'pin' },
};
/** Minimum episodes of a kind for a panel of the composite figures. */
const MIN_PANEL_N = 3;
const UNIT_DAY = 'g C m⁻² d⁻¹';
const UNIT_SWC = 'm³ m⁻³';
const f2 = (x: number | null) => (x === null ? '–' : fmtNum(x, 2));
const f2s = (x: number | null) => (x === null ? '–' : fmtNum(x, 2, { sign: true }));
const f3s = (x: number | null) => (x === null ? '–' : fmtNum(x, 3, { sign: true }));

export interface FigureOut {
  svg: string;
  alt: string;
  /** Points drawn at the edge of a panel because they lie outside the fixed y range, per panel (Figure 3 only). */
  clipped?: number[];
}

const axisLabel = { fontSize: 11, color: INK, fontFamily: FONT };
const splitLine = { lineStyle: { color: AXIS, opacity: 0.3 } };
const panelTitle = (text: string, left: number, top: number) => ({ text, left, top, textAlign: 'center', textStyle: { fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT } });

/** Kinds with at least `min` used episodes of the given count, in figure order. */
function panelKinds(d: DisturbanceData, count: 'fluxEpisodes' | 'swcEpisodes', min = MIN_PANEL_N): Kind[] {
  return KIND_ORDER.filter((k) => k !== 'other' && (d.composite.kinds[k]?.[count] ?? 0) >= min);
}

/** Band series (invisible lower line plus the stacked width) for mean ± sd. */
function bandSeries(base: Record<string, unknown>, mean: (number | null)[], sd: (number | null)[], color: string, stack: string, opacity = 0.14): Record<string, unknown>[] {
  const lower = mean.map((m, i) => (m === null || sd[i] === null ? null : m - sd[i]!));
  const width2 = sd.map((s) => (s === null ? null : 2 * s));
  return [
    { ...base, type: 'line', stack, stackStrategy: 'all', data: lower, lineStyle: { opacity: 0 } },
    { ...base, type: 'line', stack, stackStrategy: 'all', data: width2, lineStyle: { opacity: 0 }, areaStyle: { color, opacity } },
  ];
}

// ---------- Figure 1: composite flux curves per kind ----------

/** Mean daily NEE, GPP and Reco from the first day of the episode, one panel per kind, with a ±1 SD band for NEE. */
export function compositeFigure(d: DisturbanceData): FigureOut {
  const kinds = panelKinds(d, 'fluxEpisodes');
  const width = 1100;
  const cols = 3;
  const margin = { left: 58, right: 16, top: 78, bottom: 54 };
  const gap = { x: 28, y: 64 };
  const panelH = 250;
  const grids = panelGrid(kinds.length, cols, width, margin, gap, panelH);
  const height = gridHeight(kinds.length, cols, margin, gap.y, panelH);
  const offsets = d.composite.offsets;
  const cats = offsets.map(String);
  const all: number[] = [];
  for (const k of kinds) {
    const c = d.composite.kinds[k]!;
    c.nee.mean.forEach((m, i) => {
      if (m !== null) all.push(m - (c.nee.sd[i] ?? 0), m + (c.nee.sd[i] ?? 0));
    });
    for (const f of ['gpp', 'reco'] as const) for (const m of c[f].mean) if (m !== null) all.push(m);
  }
  const y = niceRange(all);
  const series: Record<string, unknown>[] = [];
  kinds.forEach((k, gi) => {
    const c = d.composite.kinds[k]!;
    const base = { xAxisIndex: gi, yAxisIndex: gi, symbol: 'none', silent: true, emphasis: { disabled: true } };
    series.push(...bandSeries(base, c.nee.mean, c.nee.sd, FLUX_COLOR.nee, `${k}-nee`));
    for (const f of FLUXES) {
      series.push({ ...base, type: 'line', name: FLUX_LABEL[f], data: c[f].mean, lineStyle: { color: FLUX_COLOR[f], width: f === 'nee' ? 2.5 : 2, type: FLUX_DASH[f] }, itemStyle: { color: FLUX_COLOR[f] }, z: f === 'nee' ? 4 : 3 });
    }
    series.push({
      ...base,
      type: 'line',
      data: [],
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, type: 'solid', width: 1 }, data: [{ yAxis: 0 }, { xAxis: '0', lineStyle: { color: INK, type: [4, 3], width: 1 } }] },
    });
  });
  const lastRowStart = Math.floor((kinds.length - 1) / cols) * cols;
  const option = {
    legend: { top: 4, left: margin.left, itemWidth: 36, itemGap: 20, textStyle: { fontSize: 12, color: INK }, data: FLUXES.map((f) => FLUX_LABEL[f]) },
    title: kinds.map((k, i) => panelTitle(`${d.kinds[k]!.label} (n = ${d.composite.kinds[k]!.fluxEpisodes})`, grids[i]!.left + grids[i]!.width / 2, grids[i]!.top - 36)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: cats,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, interval: (idx: number) => offsets[idx]! % 7 === 0, formatter: (s: string) => minus(s) },
      name: i === lastRowStart + Math.min(1, kinds.length - 1 - lastRowStart) ? 'Days from the first day of the episode' : '',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { fontSize: 12, color: INK },
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: i % cols === 0 ? UNIT_DAY : '',
      nameLocation: 'middle',
      nameGap: 36,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, show: i % cols === 0, formatter: (x: number) => minus(x) },
      splitLine,
    })),
    series,
  };
  const parts = kinds.map((k) => {
    const c = d.composite.kinds[k]!;
    const at = (f: Flux, day: number) => c[f].mean[offsets.indexOf(day)] ?? null;
    return `${d.kinds[k]!.label} (${c.fluxEpisodes} episodes): mean NEE ${f2(at('nee', -1))} on the day before and ${f2(at('nee', 7))} on day 7; GPP ${f2(at('gpp', -1))} and ${f2(at('gpp', 7))}`;
  });
  const alt = `Line chart with ${kinds.length} panels, one per kind of management: mean daily NEE (solid), GPP (dashed) and Reco (dotted) in ${UNIT_DAY} from day ${minus(offsets[0]!)} to day ${offsets[offsets.length - 1]} around the first day of the episode, with a ±1 SD band for NEE. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figures 2 and 3: change per episode and kind ----------

/** One row of three panels (NEE, GPP, Reco) of a dot figure: the value per episode and the summary per kind. */
interface DotRow {
  /** Title above the row, left-aligned; empty = no title. */
  title: string;
  value: (e: Episode, f: Flux) => number | null | undefined;
  summary: (k: Kind, f: Flux) => SummaryOut;
}

interface DotLayout {
  /** Height of one panel. */
  panelH: number;
  /** Gap between the rows (room for the row title). */
  rowGap: number;
  /** Top margin above the first row (legend and panel titles). */
  top: number;
  /** Name of the y axis of the left panels. */
  yName: string;
  /** About this many y ticks (`niceRange`); default 6. */
  yTicks?: number;
  /** Fixed y range. A value outside it is drawn at the edge with an arrow and a label (`clipLabel`). */
  yRange?: { min: number; max: number; interval: number };
  /** Label text of a clipped value; default `fmtNum(x, 1)`. */
  clipLabel?: (x: number) => string;
}

/** Fixed y range of Figure 3 (percent). A few episodes lie far outside; they are drawn at the edge with an arrow. */
export const RELATIVE_Y_CAP = { min: -150, max: 350, interval: 50 } as const;
/** Height of one label row of the clipped values (px); a second label that would touch goes one row further. */
const CLIP_LABEL_ROW = 12;
const CLIP_LABEL_FONT = 10;

interface ClipPoint {
  x: number;
  value: number;
  side: 'min' | 'max';
  color: string;
}

/** Arrow at the edge of the panel for a value outside the y range (points up at the top, down at the bottom). */
function clipArrow(base: Record<string, unknown>, c: ClipPoint, y: { min: number; max: number }, label?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    type: 'scatter',
    symbol: 'arrow',
    symbolSize: 10,
    symbolRotate: c.side === 'min' ? 180 : 0,
    data: [[c.x, c.side === 'max' ? y.max : y.min]],
    itemStyle: { color: c.color },
    label: label ?? { show: false },
    z: 6,
  };
}

/**
 * Label rows of the clipped points of one panel: points of the same side are sorted by x; when a label
 * would touch the label before it, it goes one row further (0, 1, 0, ...). `unitPx` = pixels per x unit.
 */
function clipLabelRows(clips: readonly ClipPoint[], unitPx: number, text: (x: number) => string): number[] {
  const rows = clips.map(() => 0);
  for (const side of ['min', 'max'] as const) {
    const idx = clips.map((c, i) => i).filter((i) => clips[i]!.side === side).sort((a, b) => clips[a]!.x - clips[b]!.x);
    let prevEnd = -Infinity;
    let prevRow = 0;
    for (const i of idx) {
      const c = clips[i]!;
      const halfWidth = (text(c.value).length * CLIP_LABEL_FONT * 0.6) / 2 / unitPx;
      const start = c.x - halfWidth;
      rows[i] = start < prevEnd ? (prevRow + 1) % 2 : 0;
      prevRow = rows[i]!;
      prevEnd = c.x + halfWidth;
    }
  }
  return rows;
}

const EMPTY_SUMMARY: SummaryOut = { n: 0, mean: null, sd: null, min: null, max: null, ciLo: null, ciHi: null, nPositive: 0 };
const rowTitle = (text: string, left: number, top: number) => ({ text, left, top, textAlign: 'left', textStyle: { fontSize: 12, fontWeight: 600, color: INK, fontFamily: FONT } });
/** "n = 15", or "n = 1 to 3" when the counts differ. */
const nText = (ns: readonly number[]): string => {
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  return lo === hi ? `n = ${lo}` : `n = ${lo} to ${hi}`;
};
/** "7, 14 and 21". */
const listText = (xs: readonly (string | number)[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Dot panels of the used episodes grouped by kind: one row of three panels (NEE, GPP, Reco) per entry
 * of `rows`, one shared y range over all rows, points by site (jitter by the position of the episode in
 * its kind), a diamond with the bootstrap interval per kind, a zero line, x labels on the bottom row.
 * Figure 2 (one row, absolute change) and Figure 3 (three rows, relative change) use it.
 */
function dotPanels(d: DisturbanceData, rows: readonly DotRow[], layout: DotLayout): { option: Record<string, unknown>; width: number; height: number; kinds: Kind[]; clipped: number[] } {
  const kinds = panelKinds(d, 'fluxEpisodes', 1);
  const width = 1100;
  const cols = FLUXES.length;
  const count = rows.length * cols;
  const margin = { left: 58, right: 16, top: layout.top, bottom: 78 };
  const grids = panelGrid(count, cols, width, margin, { x: 28, y: layout.rowGap }, layout.panelH);
  const height = gridHeight(count, cols, margin, layout.rowGap, layout.panelH);
  const used = d.episodes.filter((e) => e.fluxUsed && kinds.includes(e.kind));
  const vals: number[] = [];
  for (const row of rows) {
    for (const e of used) for (const f of FLUXES) {
      const x = row.value(e, f);
      if (x !== null && x !== undefined) vals.push(x);
    }
    for (const k of kinds) for (const f of FLUXES) {
      const sm = row.summary(k, f);
      if (sm.ciLo !== null) vals.push(sm.ciLo);
      if (sm.ciHi !== null) vals.push(sm.ciHi);
    }
  }
  const y = layout.yRange ?? niceRange(vals, layout.yTicks ?? 6);
  const clipText = layout.clipLabel ?? ((x: number) => fmtNum(x, 1));
  const clipped: number[] = grids.map(() => 0);
  const series: Record<string, unknown>[] = [];
  rows.forEach((row, ri) => {
    FLUXES.forEach((f, fi) => {
      const gi = ri * cols + fi;
      const base = { xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true } };
      const clips: ClipPoint[] = [];
      for (const s of SITES) {
        const slot = d.sites[s].slot;
        const pts: unknown[] = [];
        kinds.forEach((k, ki) => {
          const eps = used.filter((e) => e.kind === k && e.site === s);
          const all = used.filter((e) => e.kind === k);
          eps.forEach((e) => {
            const idx = all.indexOf(e);
            const spread = all.length > 1 ? -0.22 + (0.44 * idx) / (all.length - 1) : 0;
            const x = row.value(e, f);
            if (x === null || x === undefined) return;
            if (x < y.min || x > y.max) clips.push({ x: ki + spread, value: x, side: x < y.min ? 'min' : 'max', color: siteColor(slot) });
            else pts.push([ki + spread, x]);
          });
        });
        series.push({ ...base, type: 'scatter', name: SITE_NAMES[s], symbol: siteSymbol(slot), symbolSize: 8, data: pts, itemStyle: { color: siteColor(slot), opacity: 0.85 } });
      }
      // Clipped episode values: an arrow at the edge in the site colour and the value as a label inside the panel.
      const labelRows = clipLabelRows(clips, grids[gi]!.width / kinds.length, clipText);
      clips.forEach((c, i) => {
        const label = {
          show: true,
          position: c.side === 'max' ? 'bottom' : 'top',
          offset: [0, (c.side === 'max' ? 1 : -1) * CLIP_LABEL_ROW * labelRows[i]!],
          fontSize: CLIP_LABEL_FONT,
          color: INK,
          fontFamily: FONT,
          formatter: () => clipText(c.value),
        };
        series.push(clipArrow(base, c, y, label));
      });
      clipped[gi] = clips.length;
      kinds.forEach((k, ki) => {
        const sm = row.summary(k, f);
        const xk = ki + 0.34;
        if (sm.ciLo !== null && sm.ciHi !== null) {
          // The interval line ends at the edge of the panel; an arrow without a label marks a bound outside the range.
          series.push({ ...base, type: 'line', symbol: 'none', data: [[xk, Math.max(sm.ciLo, y.min)], [xk, Math.min(sm.ciHi, y.max)]], lineStyle: { color: INK, width: 2 } });
          if (sm.ciHi > y.max) series.push(clipArrow(base, { x: xk, value: sm.ciHi, side: 'max', color: INK }, y));
          if (sm.ciLo < y.min) series.push(clipArrow(base, { x: xk, value: sm.ciLo, side: 'min', color: INK }, y));
        }
        if (sm.mean !== null && sm.mean >= y.min && sm.mean <= y.max) series.push({ ...base, type: 'scatter', symbol: 'diamond', symbolSize: 12, data: [[xk, sm.mean]], itemStyle: { color: INK }, z: 5 });
      });
      series.push({ ...base, type: 'line', data: [], markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, type: 'solid', width: 1 }, data: [{ yAxis: 0 }] } });
    });
  });
  const lastRow = rows.length - 1;
  const title: Record<string, unknown>[] = FLUXES.map((f, i) => panelTitle(FLUX_LABEL[f], grids[i]!.left + grids[i]!.width / 2, 36));
  rows.forEach((row, ri) => {
    if (row.title) title.push(rowTitle(row.title, margin.left, grids[ri * cols]!.top - 24));
  });
  const option = {
    legend: { top: 4, left: margin.left, itemGap: 20, textStyle: { fontSize: 12, color: INK }, data: SITES.map((s) => ({ name: SITE_NAMES[s], icon: siteSymbol(d.sites[s].slot), itemStyle: { color: siteColor(d.sites[s].slot) } })) },
    title,
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: -0.5,
      max: kinds.length - 0.5,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, show: Math.floor(i / cols) === lastRow, customValues: kinds.map((_, k) => k), rotate: 45, formatter: (x: number) => (kinds[x] ? KIND_SHORT[kinds[x]!] : '') },
    })),
    yAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: i % cols === 0 ? layout.yName : '',
      axisLine: { show: false },
      axisTick: { show: false },
      nameLocation: 'middle',
      nameGap: 36,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, show: i % cols === 0, formatter: (x: number) => minus(x) },
      splitLine,
    })),
    series,
  };
  return { option, width, height, kinds, clipped };
}

/** Change (after − before) of NEE, GPP and Reco per used episode, grouped by kind, with the kind mean and its bootstrap CI. */
export function changeFigure(d: DisturbanceData): FigureOut {
  const row: DotRow = { title: '', value: (e, f) => e.delta[f], summary: (k, f) => d.kinds[k]![f].delta };
  const { option, width, height, kinds } = dotPanels(d, [row], { panelH: 280, rowGap: 0, top: 70, yName: `Change, after − before (${UNIT_DAY})` });
  const parts = kinds.map((k) => {
    const s = d.kinds[k]!;
    return `${s.label} (n = ${s.nFlux}): mean change of NEE ${f2s(s.nee.delta.mean)}, GPP ${f2s(s.gpp.delta.mean)}, Reco ${f2s(s.reco.delta.mean)}`;
  });
  const alt = `Dot chart in three panels (NEE, GPP, Reco): change of the mean daily flux from the ${d.method.beforeDays} days before to the ${d.method.afterDays} days after each episode, in ${UNIT_DAY}, grouped by kind of management. Each symbol is one episode; the symbol and colour give the site. A diamond with a vertical line gives the mean of the kind and its ${d.method.ciLevelPct} % bootstrap interval. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

/**
 * Relative change (percent) of NEE, GPP and Reco per used episode, grouped by kind, one row per after
 * window (7, 14 and 21 days). GPP and Reco: percent of their own mean before; NEE: percent of the mean
 * GPP of the 30 days before the first day of the episode.
 */
export function relativeChangeFigure(d: DisturbanceData): FigureOut {
  const days = d.method.relativeAfterDays;
  const key = (n: number) => `d${n}`;
  const rows: DotRow[] = days.map((n) => ({
    title: `After ${n} days`,
    value: (e, f) => e.relative[key(n)]?.[f] ?? null,
    summary: (k, f) => d.kinds[k]!.relative[key(n)]?.[f] ?? EMPTY_SUMMARY,
  }));
  const pct = (x: number) => `${fmtNum(x, 0, { sign: true })} %`;
  const { option, width, height, kinds, clipped } = dotPanels(d, rows, { panelH: 230, rowGap: 70, top: 92, yName: 'Change (% of the reference)', yRange: RELATIVE_Y_CAP, clipLabel: pct });
  const nClipped = clipped.reduce((a, b) => a + b, 0);
  const f0s = (x: number | null) => (x === null ? '–' : pct(x));
  const rowParts = days.map((n) => {
    const kindParts = kinds.map((k) => {
      const s = d.kinds[k]!;
      const r = s.relative[key(n)];
      if (!r) return `${s.label}: no value`;
      return `${s.label} (${nText([r.nee.n, r.gpp.n, r.reco.n])}): NEE ${f0s(r.nee.mean)}, GPP ${f0s(r.gpp.mean)}, Reco ${f0s(r.reco.mean)}`;
    });
    return `After ${n} days: ${kindParts.join('; ')}`;
  });
  const alt = `Dot chart in ${days.length} rows of three panels (NEE, GPP, Reco): relative change of the mean daily flux in percent of a reference, for the ${listText(days)} days after the last day of each episode, grouped by kind of management. GPP and Reco: change in percent of their own mean in the ${d.method.beforeDays} days before the episode. NEE: change in percent of the mean GPP of the ${d.method.gppRefDays} days before the first day of the episode. Each symbol is one episode; the symbol and colour give the site. A diamond with a vertical line gives the mean of the kind and its ${d.method.ciLevelPct} % bootstrap interval. The diamond and its interval need three or more episodes. Values outside ${fmtNum(RELATIVE_Y_CAP.min, 0)} to ${fmtNum(RELATIVE_Y_CAP.max, 0)} % are drawn at the edge of the panel with an arrow and their value; ${nClipped} ${nClipped === 1 ? 'point is' : 'points are'} clipped. ${rowParts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt, clipped };
}

// ---------- Figure 4: soil water anomaly and rain per kind ----------

/** Soil water content as the difference to the mean before the episode, with the mean daily rain as bars, one panel per kind. */
export function soilWaterFigure(d: DisturbanceData): FigureOut {
  const kinds = panelKinds(d, 'swcEpisodes');
  const width = 1100;
  const cols = 3;
  const margin = { left: 58, right: 50, top: 78, bottom: 54 };
  const gap = { x: 60, y: 64 };
  const panelH = 250;
  const grids = panelGrid(kinds.length, cols, width, margin, gap, panelH);
  const height = gridHeight(kinds.length, cols, margin, gap.y, panelH);
  const offsets = d.composite.offsets;
  const cats = offsets.map(String);
  const swcVals: number[] = [];
  const rainVals: number[] = [];
  for (const k of kinds) {
    const c = d.composite.kinds[k]!;
    c.swcAnomaly.mean.forEach((m, i) => {
      if (m !== null) swcVals.push(m - (c.swcAnomaly.sd[i] ?? 0), m + (c.swcAnomaly.sd[i] ?? 0));
    });
    for (const m of c.rain.mean) if (m !== null) rainVals.push(m);
  }
  const ySwc = niceRange(swcVals, 5);
  const yRain = niceRange(rainVals, 4);
  const rainColor = SERIES[2];
  const series: Record<string, unknown>[] = [];
  kinds.forEach((k, gi) => {
    const c = d.composite.kinds[k]!;
    const base = { xAxisIndex: gi, yAxisIndex: 2 * gi, symbol: 'none', silent: true, emphasis: { disabled: true } };
    series.push({ ...base, yAxisIndex: 2 * gi + 1, type: 'bar', name: 'Rain', data: c.rain.mean, barWidth: '70%', itemStyle: { color: rainColor, opacity: 0.55 }, z: 1 });
    series.push(...bandSeries(base, c.swcAnomaly.mean, c.swcAnomaly.sd, FLUX_COLOR.gpp, `${k}-swc`, 0.16));
    series.push({ ...base, type: 'line', name: 'Soil water', data: c.swcAnomaly.mean, lineStyle: { color: FLUX_COLOR.gpp, width: 2.5 }, itemStyle: { color: FLUX_COLOR.gpp }, z: 4 });
    series.push({
      ...base,
      type: 'line',
      data: [],
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, type: 'solid', width: 1 }, data: [{ yAxis: 0 }, { xAxis: '0', lineStyle: { color: INK, type: [4, 3], width: 1 } }] },
    });
  });
  const yAxis: Record<string, unknown>[] = [];
  grids.forEach((_, i) => {
    yAxis.push({
      type: 'value',
      gridIndex: i,
      min: ySwc.min,
      max: ySwc.max,
      interval: ySwc.interval,
      name: i % cols === 0 ? `Soil water, difference to before (${UNIT_SWC})` : '',
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, show: i % cols === 0, formatter: (x: number) => minus(x) },
      splitLine,
    });
    yAxis.push({
      type: 'value',
      gridIndex: i,
      min: yRain.min,
      max: yRain.max,
      interval: yRain.interval,
      name: i % cols === cols - 1 || i === grids.length - 1 ? 'Rain (mm d⁻¹)' : '',
      nameLocation: 'middle',
      nameGap: 34,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, show: i % cols === cols - 1 || i === grids.length - 1 },
      splitLine: { show: false },
    });
  });
  const option = {
    legend: { top: 4, left: margin.left, itemWidth: 24, itemGap: 20, textStyle: { fontSize: 12, color: INK }, data: [{ name: 'Soil water', icon: 'path://M0,5 L24,5 L24,7 L0,7 Z', itemStyle: { color: FLUX_COLOR.gpp } }, { name: 'Rain', icon: 'rect', itemStyle: { color: rainColor } }] },
    title: kinds.map((k, i) => panelTitle(`${d.kinds[k]!.label} (n = ${d.composite.kinds[k]!.swcEpisodes})`, grids[i]!.left + grids[i]!.width / 2, grids[i]!.top - 36)),
    grid: grids.map((g) => ({ left: g.left, top: g.top, width: g.width, height: g.height, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: cats,
      boundaryGap: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, interval: (idx: number) => offsets[idx]! % 7 === 0, formatter: (s: string) => minus(s) },
      name: i === Math.min(1, kinds.length - 1) ? 'Days from the first day of the episode' : '',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { fontSize: 12, color: INK },
    })),
    yAxis,
    series,
  };
  const parts = kinds.map((k) => {
    const c = d.composite.kinds[k]!;
    const at = (day: number) => c.swcAnomaly.mean[offsets.indexOf(day)] ?? null;
    const rain = c.rain.mean.filter((x): x is number => x !== null);
    return `${d.kinds[k]!.label} (${c.swcEpisodes} episodes): soil water difference ${f3s(at(7))} on day 7 and ${f3s(at(14))} on day 14; mean rain ${f2(rain.length ? rain.reduce((a, b) => a + b, 0) / rain.length : null)} mm per day`;
  });
  const alt = `Chart with ${kinds.length} panels, one per kind of management: mean soil water content as the difference to the ${d.method.beforeDays}-day mean before the episode (line, ${UNIT_SWC}, ±1 SD band) and the mean daily rain of the same episodes (bars, mm per day, right axis), from day ${minus(offsets[0]!)} to day ${offsets[offsets.length - 1]}. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 5: soil water change against the rain difference ----------

/** Change of soil water (after − before) against the rain difference of the windows, with a fit line per kind. */
export function rainFigure(d: DisturbanceData): FigureOut {
  const width = 760;
  const height = 420;
  const eps = d.episodes.filter((e) => e.swcUsed && e.rainDiff !== null && e.delta.swc !== null && e.delta.swc !== undefined);
  const kinds = KIND_ORDER.filter((k) => eps.some((e) => e.kind === k));
  const series: Record<string, unknown>[] = kinds.map((k) => ({
    type: 'scatter',
    name: KIND_SHORT[k],
    symbol: KIND_STYLE[k].symbol,
    symbolSize: 11,
    itemStyle: { color: KIND_STYLE[k].color, borderColor: INK, borderWidth: 0.5 },
    data: eps.filter((e) => e.kind === k).map((e) => [e.rainDiff, e.delta.swc]),
    emphasis: { disabled: true },
  }));
  const fitKinds = kinds.filter((k) => (d.kinds[k]?.swc.rainFit.n ?? 0) >= 5 && d.kinds[k]!.swc.rainFit.slope !== null);
  for (const k of fitKinds) {
    const fit = d.kinds[k]!.swc.rainFit;
    const xs = eps.filter((e) => e.kind === k).map((e) => e.rainDiff!);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    series.push({ type: 'line', name: `${KIND_SHORT[k]} fit`, symbol: 'none', silent: true, data: [[x0, fit.intercept! + fit.slope! * x0], [x1, fit.intercept! + fit.slope! * x1]], lineStyle: { color: KIND_STYLE[k].color, type: [6, 4], width: 2 }, itemStyle: { color: KIND_STYLE[k].color } });
  }
  series.push({ type: 'line', data: [], markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, width: 1, type: 'solid' }, data: [{ yAxis: 0 }, { xAxis: 0 }] } });
  const y = niceRange(eps.map((e) => e.delta.swc!), 5);
  const x = niceRange(eps.map((e) => e.rainDiff!), 6);
  const option = {
    // The legend wraps to two rows (kinds and fit lines); the grid starts below them.
    legend: { top: 4, left: 64, itemGap: 16, textStyle: { fontSize: 12, color: INK } },
    grid: { left: 64, right: 20, top: 72, bottom: 56, containLabel: false },
    xAxis: {
      type: 'value',
      min: x.min,
      max: x.max,
      interval: x.interval,
      name: `Rain difference, ${d.method.afterDays} days after − ${d.method.beforeDays} days before (mm)`,
      nameLocation: 'middle',
      nameGap: 32,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, formatter: (v2: number) => minus(v2) },
      splitLine,
    },
    yAxis: {
      type: 'value',
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: `Change of soil water (${UNIT_SWC})`,
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, formatter: (v2: number) => minus(v2) },
      splitLine,
    },
    series,
  };
  const parts = kinds.map((k) => {
    const fit = d.kinds[k]!.swc.rainFit;
    const n = eps.filter((e) => e.kind === k).length;
    return `${KIND_SHORT[k]}: ${n} episodes${fit.r === null ? '' : `, Pearson r ${fmtNum(fit.r, 2)}`}`;
  });
  const alt = `Scatter chart: change of the mean soil water content (${d.method.afterDays} days after minus ${d.method.beforeDays} days before, ${UNIT_SWC}) against the difference of the rain sums of the two windows (mm). Symbol and colour give the kind of management. ${parts.join('; ')}.${fitKinds.length ? ` Dashed lines: least-squares fits for ${fitKinds.map((k) => KIND_SHORT[k]).join(' and ')}.` : ''}`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Episode table ----------

export interface EpisodeRow {
  id: string;
  site: string;
  dates: string;
  kind: string;
  what: string;
  input: string;
  frac: string;
  dNee: string;
  dGpp: string;
  dReco: string;
  dNeeAdj: string;
  excessNee: string;
  dSwc: string;
  rain: string;
  fluxUse: string;
  swcUse: string;
  others: string;
}

const EXCLUSION_TEXT: Record<string, string> = {
  overlap: 'other event near',
  'too-few-days': 'too few days',
  'low-measured-fraction': 'low measured fraction',
};

/** Short text of the events of an episode: type and the first part of the detail. */
function whatText(e: DisturbanceData['episodes'][number]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const ev of e.events) {
    const detail = ev.detail.split(/[,(;]/)[0]!.trim();
    const t = detail ? `${ev.type}: ${detail}` : ev.type;
    if (!seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  }
  return parts.join('; ');
}

/** Rows of the episode table, with the numbers formatted for the page. */
export function episodeRows(d: DisturbanceData): EpisodeRow[] {
  return d.episodes.map((e) => {
    const input: string[] = [];
    if (e.dryMassKgHa !== null) input.push(`${fmtNum(e.dryMassKgHa / 1000, 1)} t DW/ha`);
    if (e.nKgHa !== null) input.push(`${fmtNum(e.nKgHa, 0)} kg N/ha`);
    const rainB = e.before.rain;
    const rainA = e.after.rain;
    return {
      id: e.id,
      site: SITE_NAMES[e.site],
      dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
      kind: KIND_SHORT[e.kind] + (e.fert ? ` (${e.fert})` : ''),
      what: whatText(e),
      input: input.length ? input.join(', ') : '–',
      frac: [e.before.mean.frac ?? null, e.after.mean.frac ?? null].map((x) => (x === null ? '–' : fmtNum(x * 100, 0))).join(' / '),
      dNee: f2s(e.delta.nee ?? null),
      dGpp: f2s(e.delta.gpp ?? null),
      dReco: f2s(e.delta.reco ?? null),
      dNeeAdj: f2s(e.deltaAdj.nee ?? null),
      excessNee: e.excess.nee === null ? '–' : fmtNum(e.excess.nee, 0, { sign: true }),
      dSwc: f3s(e.delta.swc ?? null),
      rain: rainB === null && rainA === null ? '–' : `${rainB === null ? '–' : fmtNum(rainB, 0)} / ${rainA === null ? '–' : fmtNum(rainA, 0)}${e.rainSource === 'viikki-proxy' ? ' *' : ''}`,
      fluxUse: e.fluxUsed ? 'used' : (EXCLUSION_TEXT[e.fluxExclusion ?? ''] ?? 'not used'),
      swcUse: e.swcUsed ? (e.rainBalanced ? 'used, rain-balanced' : 'used') : (EXCLUSION_TEXT[e.swcExclusion ?? ''] ?? 'not used'),
      others: e.otherEvents.length ? e.otherEvents.map((o) => `${o.type} ${o.date}`).join('; ') : '–',
    };
  });
}

/** Rows of the summary table per kind: n, mean change and interval of NEE, GPP, Reco and soil water. */
export interface KindRow {
  id: string;
  label: string;
  nFlux: string;
  nee: string;
  neeCi: string;
  gpp: string;
  reco: string;
  neeAdj: string;
  excess: string;
  relGpp: string;
  nSwc: string;
  swc: string;
  swcCi: string;
}

export function kindRows(d: DisturbanceData): KindRow[] {
  const ci = (lo: number | null, hi: number | null, f: (x: number | null) => string) => (lo === null || hi === null ? '–' : `${f(lo)} to ${f(hi)}`);
  return KIND_ORDER.filter((k) => k !== 'other' && d.kinds[k] && d.kinds[k]!.n > 0).map((k) => {
    const s = d.kinds[k]!;
    return {
      id: k,
      label: s.label,
      nFlux: String(s.nFlux),
      nee: f2s(s.nee.delta.mean),
      neeCi: ci(s.nee.delta.ciLo, s.nee.delta.ciHi, f2s),
      gpp: f2s(s.gpp.delta.mean),
      reco: f2s(s.reco.delta.mean),
      neeAdj: s.nee.deltaAdj.n ? `${f2s(s.nee.deltaAdj.mean)} (n = ${s.nee.deltaAdj.n})` : '–',
      excess: s.nee.excess.n ? `${s.nee.excess.mean === null ? '–' : fmtNum(s.nee.excess.mean, 0, { sign: true })} (n = ${s.nee.excess.n})` : '–',
      relGpp: s.relGppPct.n ? `${s.relGppPct.mean === null ? '–' : fmtNum(s.relGppPct.mean, 0, { sign: true })} % (n = ${s.relGppPct.n})` : '–',
      nSwc: String(s.nSwc),
      swc: f3s(s.swc.delta.mean),
      swcCi: ci(s.swc.delta.ciLo, s.swc.delta.ciHi, f3s),
    };
  });
}
