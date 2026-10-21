// Annual carbon budget: bars of the annual sums of the flux variables per site and year,
// like the "GPP / Reco / NEE per year" figure of flux papers (Heimsch et al. 2021; Hu et al. 2024).
// Annual sum: sum(flux) * 1800 s * 12.011e-6 g C per µmol (one C atom per CO2 or CH4).
// CO2 fluxes in g C m-2 yr-1, CH4 flux in g CH4-C m-2 yr-1 (a second block of panels).
// One panel per site, years on the x axis, one bar per variable. GPP is drawn negative
// (carbon into the ecosystem), so that NEE = Reco - GPP reads from the bars.
// A partial year (fewer than 90 % of the half hours have a value, or the period cuts the
// year) has a lighter, hatched bar and a "*" at the year label. The step setting does not apply.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import { toFloat64, type Meta } from '../db';
import { VARIABLE_LABELS, type Variable, type ViewParams } from '../state';
import type { Tokens } from '../theme';
import type { BuildContext, DiagramDef, Prepared } from './registry';
import { col, periodBounds, whereClause } from './sql';
import {
  FIXED_GRID,
  X_NAME_SPACE,
  axisNameText,
  baseOption,
  esc,
  formatValue,
  gridLeftFor,
  groupDigits,
  joinSubtitle,
  nameLines,
  niceRange,
  siteColors,
  siteNames,
  tickLabelWidth,
  tooltipBase,
  unitText,
  valueAxis,
  valueWithUnit,
  xAxisName,
  yAxisName,
  zeroLineSeries,
} from './common';

// LineChart: for the zero lines.
echarts.use([BarChart, LineChart]);

/** Flux variables that can be summed, with the unit of the annual sum. Order = order of the form. */
const FLUXES: Partial<Record<Variable, string>> = {
  nee: 'g C m-2 yr-1',
  nee_f: 'g C m-2 yr-1',
  gpp: 'g C m-2 yr-1',
  reco: 'g C m-2 yr-1',
  gpp_src: 'g C m-2 yr-1',
  reco_src: 'g C m-2 yr-1',
  ch4: 'g CH4-C m-2 yr-1',
};
const FLUX_VARS = Object.keys(FLUXES) as Variable[];
/** Variables that are drawn negative: carbon into the ecosystem. */
const NEGATED: ReadonlySet<Variable> = new Set<Variable>(['gpp', 'gpp_src']);
const NEE_VARS: ReadonlySet<Variable> = new Set<Variable>(['nee', 'nee_f']);
/** Short names for the alt text. */
const SHORT: Partial<Record<Variable, string>> = {
  nee: 'NEE measured',
  nee_f: 'NEE gap-filled',
  gpp: 'GPP',
  reco: 'Reco',
  gpp_src: 'GPP (provider)',
  reco_src: 'Reco (provider)',
  ch4: 'CH₄',
};

/** A year is complete when at least this part of its half hours has a value. */
const MIN_COVERAGE = 0.9;
/** Smallest number of values of a complete year: 365 days × 48 half hours × 90 %. */
const MIN_ROWS = 365 * 48 * MIN_COVERAGE;
/** Most panels in one row. */
const MAX_COLS = 3;

/**
 * Layout in px. `head` is the site title above each panel, `xLabels` the space below a panel
 * for the year labels and the x axis name. `left` is the smallest left margin; `yLayout()` makes
 * it larger for the y axis name. `gapX` is the space between two panels of a row.
 */
const L = { legend: 30, head: 26, panel: 200, xLabels: X_NAME_SPACE + 4, left: 56, right: 12, gapX: 24, bottom: 4, minPanelW: 170, minPanelWNarrow: 120 };
const ROW_H = L.head + L.panel + L.xLabels;

/** Unit of the annual sum of `v`, raw form. Use `unitText()` for display. */
const unitOfSum = (v: Variable) => FLUXES[v] ?? '';

/** Colour per variable. The sites are separated by panel, so the colour tells the variable. */
function varColors(tokens: Tokens): Partial<Record<Variable, string>> {
  const s = tokens.series;
  return {
    nee: s[0],
    nee_f: tokens.text,
    gpp: s[2],
    gpp_src: s[5],
    reco: s[1],
    reco_src: s[7],
    ch4: s[6],
  };
}

/** Annual sum of one variable in one site and year. */
interface Sum {
  /** Sum in g C m-2 yr-1 (or g CH4-C m-2 yr-1), with the sign of the data. NaN = no value. */
  sum: number;
  /** Number of half hours with a value. */
  n: number;
  /** Part of the half hours of the year with a value, 0 to 1. */
  coverage: number;
  partial: boolean;
}

interface YearRow {
  year: number;
  /** Number of rows (half hours) of the site in this year, inside the period. */
  rows: number;
  sums: Partial<Record<Variable, Sum>>;
}

/** Panels with one unit: the CO2 variables, or the CH4 flux. */
interface Block {
  unit: string;
  vars: Variable[];
}

interface BudgetData extends Prepared {
  variables: Variable[];
  blocks: Block[];
  sites: Array<{ siteId: number; years: YearRow[] }>;
}

const sumVars = (params: ViewParams) => params.variables.filter((v) => FLUX_VARS.includes(v));

/** Blocks of the variables in the order of the form: one per unit. */
function blocksOf(vars: Variable[]): Block[] {
  const blocks: Block[] = [];
  for (const v of vars) {
    const unit = unitOfSum(v);
    const b = blocks.find((x) => x.unit === unit);
    if (b) b.vars.push(v);
    else blocks.push({ unit, vars: [v] });
  }
  return blocks;
}

/** Half hours in a calendar year. */
const halfHoursOf = (year: number) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365) * 48;

function query(params: ViewParams): string | null {
  const where = whereClause(params);
  const vars = sumVars(params).map(col);
  if (where === null || vars.length === 0) return null;
  return `SELECT site_id::DOUBLE AS site_id, year(tl)::DOUBLE AS yr, count(*)::DOUBLE AS n,
      ${vars.map((v) => `sum(${v}) * 1800 * 12.011e-6 AS ${v}, count(${v})::DOUBLE AS ${v}__n`).join(', ')}
    FROM obs WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`;
}

/** Years that the period cuts: the first year when it starts after January, the last year when it ends before December. */
function cutYears(params: ViewParams): Set<number> {
  const { from, to } = periodBounds(params);
  const cut = new Set<number>();
  if (from && from[1] !== 1) cut.add(from[0]);
  if (to && to[1] !== 1) cut.add(to[0]);
  return cut;
}

function prepare(table: Table | null, params: ViewParams, _meta: Meta): BudgetData {
  const vars = sumVars(params);
  const base = { variables: vars, blocks: blocksOf(vars), sites: [] as BudgetData['sites'] };
  if (table === null) {
    const note = params.sites.length === 0 ? 'Select one or more sites.' : 'Select a flux variable (NEE, GPP, Reco or CH4).';
    return { ...base, rowCount: 0, seriesCount: 0, note };
  }
  const n = table.numRows;
  const read = (name: string) => toFloat64(table.getChild(name), n);
  const site = read('site_id');
  const yr = read('yr');
  const rows = read('n');
  const cols = vars.map((v) => ({ v, sum: read(v), n: read(`${v}__n`) }));
  const cut = cutYears(params);
  const bySite = new Map<number, BudgetData['sites'][number]>();
  for (let i = 0; i < n; i++) {
    const id = site[i] as number;
    let entry = bySite.get(id);
    if (!entry) {
      entry = { siteId: id, years: [] };
      bySite.set(id, entry);
    }
    const year = yr[i] as number;
    const row: YearRow = { year, rows: rows[i] as number, sums: {} };
    for (const c of cols) {
      const count = c.n[i] as number;
      row.sums[c.v] = {
        sum: count > 0 ? (c.sum[i] as number) : Number.NaN,
        n: count,
        coverage: count / halfHoursOf(year),
        partial: count < MIN_ROWS || cut.has(year),
      };
    }
    entry.years.push(row);
  }
  // A site without a value in any variable gets no panel.
  const sites = [...bySite.values()].filter((s) => s.years.some((y) => vars.some((v) => Number.isFinite(y.sums[v]?.sum))));
  let seriesCount = 0;
  let partials = 0;
  for (const s of sites) {
    for (const v of vars) {
      if (s.years.some((y) => Number.isFinite(y.sums[v]?.sum))) seriesCount++;
      partials += s.years.filter((y) => Number.isFinite(y.sums[v]?.sum) && y.sums[v]?.partial).length;
    }
  }
  const units = [...new Set(base.blocks.map((b) => unitText(b.unit)))].join(' and ');
  const notes = [`Annual sum of the 30-minute values per site and year in ${units}.`];
  const sign: string[] = [];
  if (vars.some((v) => NEE_VARS.has(v))) sign.push('NEE < 0 = net CO₂ uptake by the ecosystem');
  if (vars.some((v) => NEGATED.has(v) || v === 'reco' || v === 'reco_src')) sign.push('GPP and Reco ≥ 0');
  if (vars.includes('ch4')) sign.push('F CH₄ > 0 = emission to the atmosphere');
  if (sign.length) notes.push(`Sign convention: ${sign.join('; ')}.`);
  if (vars.some((v) => NEGATED.has(v))) notes.push('GPP is drawn negative (uptake), so that NEE = Reco − GPP reads from the bars.');
  if (partials > 0) {
    notes.push(
      `* partial year: fewer than ${Math.round(MIN_COVERAGE * 100)} % of the half hours have a value, or the period cuts the year; the sum is not comparable.`,
    );
  }
  if (vars.includes('nee')) notes.push('Measured NEE has gaps, so its sum is not an annual balance.');
  if (params.variables.length > vars.length) notes.push('Only fluxes are summed: NEE, GPP, Reco, CH4. The other variables are not shown.');
  const data: BudgetData = { ...base, sites, rowCount: n, seriesCount, subtitle: joinSubtitle(...notes) };
  if (n === 0) data.note = 'No data for these sites and years.';
  else if (seriesCount === 0) data.note = 'No flux values for these sites and years.';
  return data;
}

/** Value as drawn: GPP negative. */
const drawn = (v: Variable, sum: number) => (NEGATED.has(v) ? -sum : sum);

/** One panel: a site and its years with a value in one or more variables of the block. */
interface Panel {
  siteId: number;
  years: YearRow[];
}

/** Panels of a block: the sites with a value in the block, with the years that have one. A site without CH4 has no CH4 panel. */
function blockPanels(data: BudgetData, b: Block): Panel[] {
  const has = (y: YearRow) => b.vars.some((v) => Number.isFinite(y.sums[v]?.sum));
  return data.sites.map((s) => ({ siteId: s.siteId, years: s.years.filter(has) })).filter((p) => p.years.length > 0);
}

/** Panels per row: at most MAX_COLS, fewer on a narrow chart. The rows are balanced: 4 sites give 2 + 2, not 3 + 1. */
function perRow(width: number, nSites: number, left = L.left): number {
  const minW = width < 600 ? L.minPanelWNarrow : L.minPanelW;
  const usable = Math.max(width, 200) - left - L.right + L.gapX;
  const max = Math.max(1, Math.min(nSites, MAX_COLS, Math.floor(usable / (minW + L.gapX))));
  return Math.ceil(nSites / Math.ceil(nSites / max));
}

/** Panel rows of the blocks and the panels per row. All blocks use the same number of columns, so that the panels line up. */
function rowsOf(counts: number[], width: number): { cols: number; rows: number[] } {
  const cols = perRow(width, Math.max(1, ...counts));
  return { cols, rows: counts.map((n) => Math.ceil(n / cols)) };
}

function totalHeight(counts: number[], width: number): number {
  const total = rowsOf(counts, width).rows.reduce((a, b) => a + b, 0);
  return total === 0 ? 160 : L.legend + total * ROW_H + L.bottom;
}

/** Y range of a block, the same for all its panels: the drawn values of all sites and years, with 0. */
function blockExtent(data: BudgetData, b: Block): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const s of data.sites) {
    for (const y of s.years) {
      for (const v of b.vars) {
        const sum = y.sums[v]?.sum;
        if (sum === undefined || !Number.isFinite(sum)) continue;
        const d = drawn(v, sum);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
  }
  return lo < hi ? [lo, hi] : [0, 1];
}

/** Y ranges, y axis names, tick label widths and the shared left margin of all panels. */
function yLayout(data: BudgetData) {
  const ranges = data.blocks.map((b) => niceRange(blockExtent(data, b)));
  const names = data.blocks.map((b) => axisNameText('Annual sum', unitText(b.unit), L.panel));
  const widths = ranges.map((r) => tickLabelWidth([r.min, r.max]));
  const left = Math.max(L.left, ...names.map((n, i) => gridLeftFor(widths[i] as number, nameLines(n))));
  return { ranges, names, widths, left };
}

/** Hatch pattern of a partial bar: thin diagonal lines in the surface colour. */
function hatch(tokens: Tokens) {
  return { symbol: 'rect', symbolSize: 1, color: tokens.surface, dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: -Math.PI / 4 };
}

function build(data: BudgetData, ctx: BuildContext): EChartsCoreOption {
  const { tokens, meta } = ctx;
  const colors = varColors(tokens);
  const siteColor = siteColors(meta, tokens);
  const names = siteNames(meta);
  const yl = yLayout(data);
  const panels = data.blocks.map((b) => blockPanels(data, b));
  const { cols, rows } = rowsOf(
    panels.map((p) => p.length),
    ctx.width,
  );
  const panelW = (Math.max(ctx.width, 200) - yl.left - L.right - L.gapX * (cols - 1)) / cols;
  const grid: unknown[] = [];
  const title: unknown[] = [];
  const xAxis: unknown[] = [];
  const yAxis: unknown[] = [];
  const series: unknown[] = [];
  const zeroLines: unknown[] = [];
  /** For each series index: the panel, the variable and its unit. */
  const info: Array<{ panel: Panel; v: Variable; unit: string }> = [];
  /** Variables with one or more values, for the legend. */
  const shown = new Set<Variable>();
  /** Panel rows above the current block. */
  let rowsAbove = 0;
  data.blocks.forEach((b, bi) => {
    const range = yl.ranges[bi] as ReturnType<typeof niceRange>;
    const unit = unitText(b.unit);
    (panels[bi] as Panel[]).forEach((s, si) => {
      const r = Math.floor(si / cols);
      const c = si % cols;
      const top = L.legend + (rowsAbove + r) * ROW_H + L.head;
      const left = yl.left + c * (panelW + L.gapX);
      const gi = grid.length;
      grid.push({ top, left, width: panelW, height: L.panel, ...FIXED_GRID });
      const name = names.get(s.siteId) ?? String(s.siteId);
      // Site name with a small marker in the site colour. The CH4 block adds the gas.
      title.push({
        top: top - L.head + 2,
        left: left - 2,
        text: `{m|■} ${name}${b.unit.includes('CH4') ? ' — CH₄' : ''}`,
        textStyle: { fontSize: 13, fontWeight: 600, color: tokens.text, rich: { m: { color: siteColor.get(s.siteId) ?? tokens.text, fontSize: 11 } } },
      });
      // A year label gets "*" when one or more bars of the panel are partial.
      const partialYear = (y: YearRow) => b.vars.some((v) => Number.isFinite(y.sums[v]?.sum) && y.sums[v]?.partial);
      xAxis.push({
        type: 'category',
        gridIndex: gi,
        data: s.years.map((y) => (partialYear(y) ? `${y.year}*` : String(y.year))),
        // The axis stays at the bottom of the panel. The zero line series marks y = 0.
        axisLine: { onZero: false, lineStyle: { color: tokens.axis } },
        axisTick: { show: false },
        axisLabel: { color: tokens.textMuted, hideOverlap: true },
        ...xAxisName(tokens, 'Year'),
      });
      yAxis.push(
        valueAxis(tokens, gi, {
          scale: false,
          ...range,
          axisLabel: { show: c === 0, color: tokens.textMuted },
          axisTick: { show: c === 0, inside: false, lineStyle: { color: tokens.axis } },
          // Shared y axis: the name on the first column only.
          ...(c === 0 ? yAxisName(tokens, yl.names[bi] as string, yl.widths[bi] as number) : {}),
        }),
      );
      const zero = zeroLineSeries(meta, tokens, b.vars[0] as Variable, gi, [range.min, range.max]);
      if (zero) zeroLines.push(zero);
      for (const v of b.vars) {
        if (!s.years.some((y) => Number.isFinite(y.sums[v]?.sum))) continue;
        shown.add(v);
        info.push({ panel: s, v, unit });
        series.push({
          type: 'bar',
          name: VARIABLE_LABELS[v],
          xAxisIndex: gi,
          yAxisIndex: gi,
          color: colors[v] ?? tokens.text,
          barMaxWidth: 28,
          barGap: '10%',
          barCategoryGap: '30%',
          itemStyle: { borderRadius: 1, borderColor: tokens.surface, borderWidth: 0.5 },
          emphasis: { disabled: true },
          data: s.years.map((y) => {
            const e = y.sums[v];
            if (!e || !Number.isFinite(e.sum)) return null;
            const value = drawn(v, e.sum);
            return e.partial ? { value, itemStyle: { opacity: 0.45, decal: hatch(tokens) } } : value;
          }),
        });
      }
    });
    rowsAbove += rows[bi] as number;
  });
  // The zero lines come after all data series, so that the tooltip index `info` stays correct.
  series.push(...zeroLines);
  const legendVars = data.variables.filter((v) => shown.has(v));
  return {
    ...baseOption(tokens),
    legend: {
      type: 'scroll',
      top: 0,
      left: yl.left - 8,
      right: L.right,
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.grid,
      pageTextStyle: { color: tokens.textMuted },
      icon: 'roundRect',
      // Opaque legend marks, also when the bars of partial years are transparent.
      itemStyle: { opacity: 1 },
      itemWidth: 14,
      itemHeight: 10,
      textStyle: { color: tokens.text },
      inactiveColor: tokens.grid,
      data: legendVars.map((v) => VARIABLE_LABELS[v]),
    },
    title,
    grid,
    xAxis,
    yAxis,
    tooltip: {
      ...tooltipBase(tokens, 'axis'),
      axisPointer: { type: 'shadow', shadowStyle: { color: tokens.grid, opacity: 0.4 } },
      formatter: (raw: unknown) => {
        const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ marker: string; seriesIndex: number; dataIndex: number }>;
        const first = list.find((p) => info[p.seriesIndex]);
        if (!first) return '';
        const panel = (info[first.seriesIndex] as (typeof info)[number]).panel;
        const year = panel.years[first.dataIndex];
        if (!year) return '';
        const lines = list
          .map((p) => {
            const i = info[p.seriesIndex];
            const e = i ? year.sums[i.v] : undefined;
            if (!i || !e || !Number.isFinite(e.sum)) return null;
            const cover = `${groupDigits(e.n)} values, ${formatValue(e.coverage * 100)} %`;
            return (
              `${p.marker}${esc(VARIABLE_LABELS[i.v])}&nbsp;&nbsp;${valueWithUnit(e.sum, i.unit)}` +
              `${NEGATED.has(i.v) ? ' (drawn negative)' : ''}<br/>&nbsp;&nbsp;&nbsp;&nbsp;${cover}${e.partial ? ' · partial year' : ''}`
            );
          })
          .filter(Boolean);
        return `<b>${esc(names.get(panel.siteId) ?? String(panel.siteId))} ${year.year}</b><br/>${lines.join('<br/>') || 'No data'}`;
      },
    },
    series,
  };
}

/** Sum as text: whole numbers for CO2 sums, decimals for small sums such as CH4. */
const sumText = (sum: number) => (Math.abs(sum) >= 10 ? String(Math.round(sum)) : formatValue(sum));

/** Annual sums per site and year, for the alt text. A partial year has "*". */
function sumsText(data: BudgetData, meta: Meta): string {
  const names = siteNames(meta);
  const parts = data.sites.map((s) => {
    const years = s.years
      .map((y) => {
        const vals = data.variables
          .map((v) => {
            const e = y.sums[v];
            return e && Number.isFinite(e.sum) ? `${SHORT[v] ?? v} ${sumText(e.sum)}${e.partial ? '*' : ''}` : null;
          })
          .filter(Boolean);
        return vals.length ? `${y.year} ${vals.join(', ')}` : null;
      })
      .filter(Boolean);
    return `${names.get(s.siteId) ?? s.siteId}: ${years.join('; ')}`;
  });
  if (parts.length === 0) return '';
  const units = [...new Set(data.blocks.map((b) => unitText(b.unit)))].join(' and ');
  return ` Annual sums in ${units} (* = partial year): ${parts.join('. ')}.`;
}

export const budget: DiagramDef<BudgetData> = {
  type: 'budget',
  label: 'Annual carbon budget (bars)',
  query,
  prepare,
  build,
  widthDependent: true,
  showsEvents: false,
  height: (params, data, width) =>
    totalHeight(data ? data.blocks.map((b) => blockPanels(data, b).length) : blocksOf(sumVars(params)).map(() => params.sites.length), width),
  statsVariables: sumVars,
  describe: (data, ctx) =>
    `Annual carbon budget: one panel per site (${data.sites.length}), years on the x axis, one bar per flux variable; ` +
    `annual sums in g C m⁻²; GPP is drawn negative; partial years are lighter and marked with *.${sumsText(data, ctx.meta)}`,
};
