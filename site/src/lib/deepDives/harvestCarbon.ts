// Figures and tables of the Deep Dive "Harvest and cutting vs carbon balance"
// (pages/deep-dive/harvest-carbon.mdx). Input: site/src/deep-dives/harvest-carbon.json
// (scripts/deep-dives/harvest-carbon.ts). Valibot checks the parts that the figures use.
import * as v from 'valibot';
import { fmtNum, SITE_NAMES, type SiteCode } from '../deepDive';
import { AXIS, FLUX_COLOR, FLUX_DASH, FLUX_SYMBOL, FONT, INK, minus, renderSvg, siteColor, siteSymbol } from '../deepDiveChart';

const N = v.nullable(v.number());
const Curve = v.object({ mean: v.array(N), sd: v.array(N), n: v.array(v.number()) });
const Summary = v.object({ n: v.number(), mean: N, sd: N, min: N, max: N, ciLo: N, ciHi: N, nPositive: v.number() });
const Delta = v.object({ nee: N, gpp: N, reco: N, ta: N });
const SITE = v.picklist(['haltiala', 'qvidja', 'viikki']);
/** One entry per site (all three sites must be there). */
const bySite = <T extends v.GenericSchema>(schema: T) => v.object({ haltiala: schema, qvidja: schema, viikki: schema });

const DataSchema = v.object({
  method: v.object({ beforeDays: v.number(), afterDays: v.number(), compositeFrom: v.number(), compositeTo: v.number(), ciLevelPct: v.number() }),
  sites: bySite(v.object({ name: v.string(), slot: v.number(), n: v.number(), nee: Summary, gpp: Summary, reco: Summary })),
  composite: v.object({
    offsets: v.array(v.number()),
    sites: bySite(v.object({ episodes: v.number(), nee: Curve, gpp: Curve, reco: Curve })),
  }),
  episodes: v.array(
    v.object({
      id: v.string(),
      site: SITE,
      start: v.string(),
      end: v.string(),
      types: v.array(v.string()),
      crop: v.nullable(v.string()),
      used: v.boolean(),
      exclusion: v.nullable(v.string()),
      yieldT: N,
      yearYieldT: N,
      delta: Delta,
      before: v.object({ fracMeasured: N }),
      after: v.object({ fracMeasured: N }),
      measured: v.object({ deltaDay: N, deltaNight: N }),
      otherEvents: v.array(v.object({ date: v.string(), type: v.string() })),
    }),
  ),
  yield: v.object({
    points: v.array(v.object({ id: v.string(), site: SITE, yieldT: v.number(), dNee: v.number() })),
    sites: bySite(v.object({ n: v.number(), r: N, p: N, slope: N, intercept: N, yieldMin: N, yieldMax: N })),
  }),
  utcShift: v.object({ site: v.string(), hours: v.number(), episodes: v.number(), maxAbsChange: v.number(), nee: Summary }),
});
export type HarvestData = v.InferOutput<typeof DataSchema>;
type Site = v.InferOutput<typeof SITE>;
type Flux = 'nee' | 'gpp' | 'reco';

export function harvestData(raw: unknown): HarvestData {
  return v.parse(DataSchema, raw);
}

const SITES: Site[] = ['haltiala', 'qvidja', 'viikki'];
const FLUX_LABEL: Record<Flux, string> = { nee: 'NEE', gpp: 'GPP', reco: 'Reco' };
const UNIT_DAY = 'g C m⁻² d⁻¹';
const f2 = (x: number | null) => (x === null ? '–' : fmtNum(x, 2));
const f2s = (x: number | null) => (x === null ? '–' : fmtNum(x, 2, { sign: true }));

export interface FigureOut {
  svg: string;
  alt: string;
}

/** Equal y range for all panels: includes zero, rounded out to a nice tick interval (about six ticks). */
function range(values: number[]): { min: number; max: number; interval: number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const raw = (hi - lo) / 6 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const interval = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  return { min: Math.floor(lo / interval) * interval, max: Math.ceil(hi / interval) * interval, interval };
}

const axisLabel = { fontSize: 11, color: INK, fontFamily: FONT };
const splitLine = { lineStyle: { color: AXIS, opacity: 0.3 } };

/** Panel boxes side by side. */
function panels(count: number, width: number, left: number, right: number, gap: number, top: number, bottom: number) {
  const w = (width - left - right - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ left: left + i * (w + gap), width: w, top, bottom }));
}

// ---------- Figure 1: composite curves ----------

/** Mean daily NEE, GPP and Reco from the first day of the episode, per site, with ±1 SD bands for NEE and GPP. */
export function compositeFigure(d: HarvestData): FigureOut {
  const width = 1100;
  const height = 430;
  const grids = panels(SITES.length, width, 58, 16, 28, 78, 62);
  const offsets = d.composite.offsets;
  const cats = offsets.map(String);
  const all: number[] = [];
  for (const s of SITES) {
    const c = d.composite.sites[s];
    for (const f of ['nee', 'gpp'] as const) {
      c[f].mean.forEach((m, i) => {
        const sd = c[f].sd[i] ?? 0;
        if (m !== null) all.push(m - sd, m + sd);
      });
    }
    for (const m of c.reco.mean) if (m !== null) all.push(m);
  }
  const y = range(all);
  const series: Record<string, unknown>[] = [];
  SITES.forEach((s, gi) => {
    const c = d.composite.sites[s];
    const base = { xAxisIndex: gi, yAxisIndex: gi, symbol: 'none', silent: true, emphasis: { disabled: true } };
    // Bands: an invisible lower line and the band width stacked on it.
    for (const f of ['nee', 'gpp'] as const) {
      const lower = c[f].mean.map((m, i) => (m === null || c[f].sd[i] === null ? null : m - c[f].sd[i]!));
      const width2 = c[f].sd.map((sd) => (sd === null ? null : 2 * sd));
      const stack = `${s}-${f}`;
      series.push({ ...base, type: 'line', stack, stackStrategy: 'all', data: lower, lineStyle: { opacity: 0 } });
      series.push({ ...base, type: 'line', stack, stackStrategy: 'all', data: width2, lineStyle: { opacity: 0 }, areaStyle: { color: FLUX_COLOR[f], opacity: f === 'nee' ? 0.14 : 0.12 } });
    }
    for (const f of ['nee', 'gpp', 'reco'] as const) {
      series.push({
        ...base,
        type: 'line',
        name: `${FLUX_LABEL[f]}`,
        data: c[f].mean,
        lineStyle: { color: FLUX_COLOR[f], width: f === 'nee' ? 2.5 : 2, type: FLUX_DASH[f] },
        itemStyle: { color: FLUX_COLOR[f] },
        z: f === 'nee' ? 4 : 3,
      });
    }
    // Zero line and day 0.
    series.push({
      ...base,
      type: 'line',
      data: [],
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: AXIS, type: 'solid', width: 1 },
        data: [{ yAxis: 0 }, { xAxis: '0', lineStyle: { color: INK, type: [4, 3], width: 1 } }],
      },
    });
  });
  const option = {
    legend: {
      top: 4,
      left: 58,
      itemWidth: 36,
      itemGap: 20,
      textStyle: { fontSize: 12, color: INK },
      data: (['nee', 'gpp', 'reco'] as const).map((f) => FLUX_LABEL[f]),
    },
    title: SITES.map((s, i) => ({
      text: `${SITE_NAMES[s as SiteCode]} (n = ${d.composite.sites[s].episodes})`,
      left: grids[i]!.left + grids[i]!.width / 2,
      top: 40,
      textAlign: 'center',
      textStyle: { fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT },
    })),
    grid: grids.map((g) => ({ ...g, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'category',
      gridIndex: i,
      data: cats,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, interval: (idx: number) => offsets[idx]! % 7 === 0, formatter: (v: string) => minus(v) },
      name: i === 1 ? 'Days from the first day of the harvest or cut' : '',
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
      name: i === 0 ? UNIT_DAY : '',
      nameLocation: 'middle',
      nameGap: 36,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, show: i === 0, formatter: (v: number) => minus(v) },
      splitLine,
    })),
    series,
  };
  const parts = SITES.map((s) => {
    const c = d.composite.sites[s];
    const at = (f: Flux, k: number) => c[f].mean[offsets.indexOf(k)] ?? null;
    return `${SITE_NAMES[s as SiteCode]} (${c.episodes} episodes): mean NEE ${f2(at('nee', -1))} on the day before and ${f2(at('nee', 7))} on day 7; mean GPP ${f2(at('gpp', -1))} and ${f2(at('gpp', 7))}`;
  });
  const alt = `Line chart in three panels, one per site: mean daily NEE (solid), GPP (dashed) and Reco (dotted) in ${UNIT_DAY} from day ${minus(offsets[0]!)} to day ${offsets[offsets.length - 1]} around the first day of a harvest or cut, with ±1 SD bands for NEE and GPP. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 2: change per episode ----------

/** Change (after − before) of NEE, GPP and Reco per used episode, with the site mean and its bootstrap CI. */
export function changeFigure(d: HarvestData): FigureOut {
  const width = 1100;
  const height = 400;
  const grids = panels(SITES.length, width, 58, 16, 28, 70, 46);
  const fluxes: Flux[] = ['nee', 'gpp', 'reco'];
  const used = d.episodes.filter((e) => e.used);
  const vals: number[] = [];
  for (const e of used) for (const f of fluxes) if (e.delta[f] !== null) vals.push(e.delta[f]!);
  for (const s of SITES) for (const f of fluxes) {
    const sm = d.sites[s][f];
    if (sm.ciLo !== null) vals.push(sm.ciLo);
    if (sm.ciHi !== null) vals.push(sm.ciHi);
  }
  const y = range(vals);
  const series: Record<string, unknown>[] = [];
  SITES.forEach((s, gi) => {
    const eps = used.filter((e) => e.site === s);
    const base = { xAxisIndex: gi, yAxisIndex: gi, silent: true, emphasis: { disabled: true } };
    fluxes.forEach((f, fi) => {
      const pts = eps.map((e, k) => {
        const spread = eps.length > 1 ? -0.16 + (0.32 * k) / (eps.length - 1) : 0;
        const cutOnly = !e.types.includes('harvest');
        return {
          value: [fi - 0.12 + spread, e.delta[f]],
          itemStyle: cutOnly ? { color: 'none', borderColor: FLUX_COLOR[f], borderWidth: 1.5 } : { color: FLUX_COLOR[f], opacity: 0.85 },
        };
      });
      series.push({ ...base, type: 'scatter', name: FLUX_LABEL[f], symbol: FLUX_SYMBOL[f], symbolSize: 8, data: pts, itemStyle: { color: FLUX_COLOR[f] } });
      const sm = d.sites[s][f];
      if (sm.ciLo !== null && sm.ciHi !== null) {
        series.push({ ...base, type: 'line', symbol: 'none', data: [[fi + 0.3, sm.ciLo], [fi + 0.3, sm.ciHi]], lineStyle: { color: INK, width: 2 } });
      }
      if (sm.mean !== null) {
        series.push({ ...base, type: 'scatter', symbol: 'diamond', symbolSize: 13, data: [[fi + 0.3, sm.mean]], itemStyle: { color: INK }, z: 5 });
      }
    });
    series.push({ ...base, type: 'line', data: [], markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, type: 'solid', width: 1 }, data: [{ yAxis: 0 }] } });
  });
  const labels = fluxes.map((f) => FLUX_LABEL[f]);
  const option = {
    legend: {
      top: 4,
      left: 58,
      itemGap: 20,
      textStyle: { fontSize: 12, color: INK },
      data: [
        ...fluxes.map((f) => ({ name: FLUX_LABEL[f], icon: FLUX_SYMBOL[f], itemStyle: { color: FLUX_COLOR[f] } })),
      ],
    },
    title: SITES.map((s, i) => ({
      text: `${SITE_NAMES[s as SiteCode]} (n = ${d.sites[s].n})`,
      left: grids[i]!.left + grids[i]!.width / 2,
      top: 36,
      textAlign: 'center',
      textStyle: { fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT },
    })),
    grid: grids.map((g) => ({ ...g, containLabel: false })),
    xAxis: grids.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: -0.5,
      max: 2.5,
      axisTick: { show: false },
      splitLine: { show: false },
      axisLine: { onZero: false, lineStyle: { color: AXIS } },
      axisLabel: { ...axisLabel, customValues: [0, 1, 2], formatter: (v: number) => labels[v] ?? '' },
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
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, show: i === 0, formatter: (v: number) => minus(v) },
      splitLine,
    })),
    series,
  };
  const parts = SITES.map((s) => {
    const sm = d.sites[s];
    return `${SITE_NAMES[s as SiteCode]} (n = ${sm.n}): mean change of NEE ${f2s(sm.nee.mean)}, GPP ${f2s(sm.gpp.mean)}, Reco ${f2s(sm.reco.mean)}`;
  });
  const alt = `Dot chart in three panels, one per site: change of the mean daily NEE (circles), GPP (squares) and Reco (triangles) from the ${d.method.beforeDays} days before to the ${d.method.afterDays} days after each harvest or cut, in ${UNIT_DAY}. Filled symbols: harvest; open symbols: cut only. A diamond with a vertical line gives the site mean and its ${d.method.ciLevelPct} % bootstrap interval. ${parts.join('. ')}.`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Figure 3: change of NEE against yield ----------

export function yieldFigure(d: HarvestData): FigureOut {
  const width = 760;
  const height = 400;
  const pts = d.yield.points;
  const sites = SITES.filter((s) => pts.some((p) => p.site === s));
  const series: Record<string, unknown>[] = sites.map((s) => ({
    type: 'scatter',
    name: SITE_NAMES[s as SiteCode],
    symbol: siteSymbol(d.sites[s].slot),
    symbolSize: 11,
    itemStyle: { color: siteColor(d.sites[s].slot), borderColor: INK, borderWidth: 0.5 },
    data: pts.filter((p) => p.site === s).map((p) => [p.yieldT, p.dNee]),
    emphasis: { disabled: true },
  }));
  // Fit line of the site with the most points (n ≥ 5), over its yield range.
  const fitSites = sites.filter((s) => d.yield.sites[s].n >= 5 && d.yield.sites[s].slope !== null);
  for (const s of fitSites) {
    const ys = d.yield.sites[s];
    series.push({
      type: 'line',
      name: `${SITE_NAMES[s as SiteCode]} fit`,
      symbol: 'none',
      silent: true,
      data: [
        [ys.yieldMin, ys.intercept! + ys.slope! * ys.yieldMin!],
        [ys.yieldMax, ys.intercept! + ys.slope! * ys.yieldMax!],
      ],
      lineStyle: { color: siteColor(d.sites[s].slot), type: [6, 4], width: 2 },
      itemStyle: { color: siteColor(d.sites[s].slot) },
    });
  }
  series.push({ type: 'line', data: [], markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: AXIS, width: 1, type: 'solid' }, data: [{ yAxis: 0 }] } });
  const all = pts.map((p) => p.dNee);
  const y = range(all);
  const option = {
    legend: { top: 4, left: 64, itemGap: 20, textStyle: { fontSize: 12, color: INK } },
    grid: { left: 64, right: 20, top: 44, bottom: 56, containLabel: false },
    xAxis: {
      type: 'value',
      min: 0,
      name: 'Yield of the harvest (t DW ha⁻¹)',
      nameLocation: 'middle',
      nameGap: 32,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLine: { lineStyle: { color: AXIS } },
      axisLabel,
      splitLine,
    },
    yAxis: {
      type: 'value',
      min: y.min,
      max: y.max,
      interval: y.interval,
      name: `Change of NEE (${UNIT_DAY})`,
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: { fontSize: 12, color: INK },
      axisLabel: { ...axisLabel, formatter: (v: number) => minus(v) },
      splitLine,
    },
    series,
  };
  const parts = sites.map((s) => {
    const ys = d.yield.sites[s];
    return `${SITE_NAMES[s as SiteCode]}: ${ys.n} harvests${ys.r === null ? '' : `, Pearson r ${fmtNum(ys.r, 2)}`}`;
  });
  const alt = `Scatter chart: change of the mean daily NEE (${d.method.afterDays} days after minus ${d.method.beforeDays} days before) against the dry-matter yield of the harvest. ${parts.join('; ')}.${fitSites.length ? ` Dashed line: least-squares fit for ${fitSites.map((s) => SITE_NAMES[s as SiteCode]).join(', ')}.` : ''}`;
  return { svg: renderSvg(option as never, width, height, alt), alt };
}

// ---------- Episode table ----------

export interface EpisodeRow {
  id: string;
  site: string;
  dates: string;
  kind: string;
  crop: string;
  yieldT: string;
  frac: string;
  dNee: string;
  dGpp: string;
  dReco: string;
  dTa: string;
  dDay: string;
  used: string;
  others: string;
}

const EXCLUSION_TEXT: Record<string, string> = {
  overlap: 'not used: other event near',
  'too-few-days': 'not used: too few days',
  'low-measured-fraction': 'not used: low measured fraction',
};

/** Rows of the episode table, with the numbers formatted for the page. */
export function episodeRows(d: HarvestData): EpisodeRow[] {
  return d.episodes.map((e) => ({
    id: e.id,
    site: SITE_NAMES[e.site as SiteCode],
    dates: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
    kind: e.types.includes('harvest') ? (e.types.includes('cut') ? 'harvest + cut' : 'harvest') : 'cut only',
    crop: e.crop ?? '–',
    yieldT: e.yieldT !== null ? fmtNum(e.yieldT, 2) : e.yearYieldT !== null ? `(${fmtNum(e.yearYieldT, 2)} year)` : '–',
    frac: [e.before.fracMeasured, e.after.fracMeasured].map((x) => (x === null ? '–' : fmtNum(x * 100, 0))).join(' / '),
    dNee: f2s(e.delta.nee),
    dGpp: f2s(e.delta.gpp),
    dReco: f2s(e.delta.reco),
    dTa: e.delta.ta === null ? '–' : fmtNum(e.delta.ta, 1, { sign: true }),
    dDay: f2s(e.measured.deltaDay),
    used: e.used ? 'used' : (EXCLUSION_TEXT[e.exclusion ?? ''] ?? 'not used'),
    others: e.otherEvents.length ? e.otherEvents.map((o) => `${o.type} ${o.date}`).join('; ') : '–',
  }));
}

/** Text of the episodes that are not used: dates, reason and the measured fraction before / after (%). */
export function excludedEpisodes(d: HarvestData): string[] {
  return d.episodes
    .filter((e) => !e.used)
    .map((e) => {
      const pct = (x: number | null) => (x === null ? '–' : `${fmtNum(x * 100, 0)} %`);
      const dates = e.start === e.end ? e.start : `${e.start} to ${e.end}`;
      return `${SITE_NAMES[e.site as SiteCode]} ${dates} (${EXCLUSION_TEXT[e.exclusion ?? ''] ?? 'not used'}; measured ${pct(e.before.fracMeasured)} before, ${pct(e.after.fracMeasured)} after)`;
    });
}
