// ECharts setup for the first page: five stacked panels with one shared UTC time axis.
// We import ECharts modules one by one to keep the bundle small.
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DatasetComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  AxisPointerComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { PLOT_VARIABLES, type Dataset, type PlotVariable } from './db';

echarts.use([
  LineChart,
  DatasetComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

/** Short panel labels. Units come from variables.parquet. */
const PANEL_LABELS: Record<PlotVariable, string> = {
  nee: 'NEE, measured',
  nee_f: 'NEE, gap-filled',
  ta: 'Air temperature',
  tsoil: 'Soil temperature',
  swc: 'Soil water content',
};

/** Layout in px. */
const LAYOUT = { top: 24, bottom: 64, gap: 34, left: 56, right: 16 };

/**
 * Downsampler for the line series. It keeps, per pixel frame, the value that is
 * farthest from the frame mean, so that peaks and the daily range stay visible.
 * A frame with only NaN values gives NaN, so gaps longer than one frame stay visible.
 *
 * We do not use the built-in 'lttb': in ECharts 6.1 it returns points in the wrong
 * order when the data has NaN values and dataZoom filters the data. Then false
 * lines cross the zoomed panels. The generic sampler keeps the order.
 */
function extremeSampler(frame: ArrayLike<number>): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    if (!Number.isNaN(v)) {
      sum += v;
      count++;
    }
  }
  if (count === 0) return Number.NaN;
  const mean = sum / count;
  let best = Number.NaN;
  let bestDist = -1;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    if (!Number.isNaN(v) && Math.abs(v - mean) > bestDist) {
      bestDist = Math.abs(v - mean);
      best = v;
    }
  }
  return best;
}

/** Colours from the CSS tokens in global.css. They change with light and dark mode. */
interface Tokens {
  series: string[];
  text: string;
  textMuted: string;
  grid: string;
  axis: string;
  surface: string;
}

function readTokens(el: HTMLElement): Tokens {
  const css = getComputedStyle(el);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => get(`--series-${i}`)),
    text: get('--text-primary'),
    textMuted: get('--text-secondary'),
    grid: get('--grid-line'),
    axis: get('--axis-line'),
    surface: get('--surface-raised'),
  };
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Grid and title positions for a chart of the given height. */
function panelLayout(height: number) {
  const n = PLOT_VARIABLES.length;
  const panelH = (height - LAYOUT.top - LAYOUT.bottom - LAYOUT.gap * n) / n;
  const tops = PLOT_VARIABLES.map((_, i) => LAYOUT.top + LAYOUT.gap * (i + 1) + panelH * i);
  return {
    grid: tops.map((top) => ({ top, height: panelH, left: LAYOUT.left, right: LAYOUT.right })),
    title: tops.map((top) => ({ top: top - 24, left: LAYOUT.left - 8 })),
  };
}

function utcLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  return v.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3);
}

interface ZoomState {
  start: number;
  end: number;
}

function buildOption(data: Dataset, tokens: Tokens, height: number, zoom: ZoomState): EChartsCoreOption {
  const layout = panelLayout(height);
  const siteName = new Map(data.sites.map((s) => [s.siteId, s.name]));
  // Colour follows the site: slot = position of the site in sites.parquet.
  const siteColor = new Map(data.sites.map((s, i) => [s.siteId, tokens.series[i % tokens.series.length]]));
  const unit = (v: PlotVariable) => data.variables.get(v)?.unit ?? '';

  // One shared time range, so that all panels line up at full zoom.
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const s of data.series) {
    if (s.t.length === 0) continue;
    tMin = Math.min(tMin, s.t[0]);
    tMax = Math.max(tMax, s.t[s.t.length - 1]);
  }

  const axisIdx = PLOT_VARIABLES.map((_, i) => i);
  const last = PLOT_VARIABLES.length - 1;

  return {
    animation: false,
    useUTC: true,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'system-ui, sans-serif', color: tokens.text },
    color: tokens.series,
    legend: {
      top: 0,
      left: LAYOUT.left - 8,
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 4,
      textStyle: { color: tokens.text },
      inactiveColor: tokens.grid,
      data: data.sites.map((s) => s.name),
    },
    // Panel label, then the unit in muted text on the same line.
    title: PLOT_VARIABLES.map((v, i) => ({
      ...layout.title[i],
      text: `${PANEL_LABELS[v]}  {u|${unit(v)}}`,
      textStyle: {
        fontSize: 13,
        fontWeight: 600,
        color: tokens.text,
        rich: { u: { fontSize: 12, fontWeight: 400, color: tokens.textMuted } },
      },
    })),
    grid: layout.grid,
    xAxis: PLOT_VARIABLES.map((_, i) => ({
      type: 'time',
      gridIndex: i,
      min: tMin,
      max: tMax,
      axisLine: { lineStyle: { color: tokens.axis } },
      axisTick: { show: i === last },
      axisLabel: { show: i === last, color: tokens.textMuted, hideOverlap: true },
      splitLine: { show: true, lineStyle: { color: tokens.grid, width: 1 } },
    })),
    yAxis: PLOT_VARIABLES.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      scale: true,
      splitNumber: 3,
      axisLine: { show: false },
      axisLabel: { color: tokens.textMuted },
      splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
    })),
    axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: tokens.axis } },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: tokens.surface,
      borderColor: tokens.grid,
      textStyle: { color: tokens.text, fontSize: 12 },
      axisPointer: { type: 'line' },
      // The axis pointer is linked across panels, so the tooltip gets the series
      // of all panels. Group them by panel and skip missing values.
      formatter: (raw: unknown) => {
        const params = (Array.isArray(raw) ? raw : [raw]) as Array<{
          seriesIndex: number;
          seriesName: string;
          marker: string;
          value: number[];
          encode: { y: number[] };
          axisValue: number;
        }>;
        if (params.length === 0) return '';
        const nSites = data.series.length;
        const blocks: string[] = [];
        PLOT_VARIABLES.forEach((v, panel) => {
          const rows = params
            .filter((p) => Math.floor(p.seriesIndex / nSites) === panel)
            .filter((p) => Number.isFinite(p.value[p.encode.y[0]]))
            .map((p) => `${p.marker}${echarts.format.encodeHTML(p.seriesName)}&nbsp;&nbsp;<b>${formatValue(p.value[p.encode.y[0]])}</b>`);
          if (rows.length === 0) return;
          const head = `<span style="color:${tokens.textMuted}">${PANEL_LABELS[v]}, ${echarts.format.encodeHTML(unit(v))}</span>`;
          blocks.push(`${head}<br/>${rows.join('<br/>')}`);
        });
        return `<b>${utcLabel(params[0].axisValue)}</b><br/>${blocks.join('<br/>') || 'No data'}`;
      },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: axisIdx, start: zoom.start, end: zoom.end, filterMode: 'filter' },
      {
        type: 'slider',
        xAxisIndex: axisIdx,
        start: zoom.start,
        end: zoom.end,
        bottom: 8,
        height: 22,
        left: LAYOUT.left,
        right: LAYOUT.right,
        showDataShadow: false,
        labelFormatter: (v: number) => new Date(v).toISOString().slice(0, 10),
        textStyle: { color: tokens.textMuted },
        borderColor: tokens.grid,
      },
    ],
    // One dataset per site. Series point to it with datasetIndex and encode.
    dataset: data.series.map((s) => ({
      dimensions: [{ name: 't', type: 'time' }, ...PLOT_VARIABLES.map((v) => ({ name: v, type: 'float' }))],
      source: { t: s.t, ...s.values },
    })),
    // Series order: variable-major, then site. Index = panel * nSites + site.
    series: PLOT_VARIABLES.flatMap((v, panel) =>
      data.series.map((s, di) => ({
        type: 'line',
        name: siteName.get(s.siteId) ?? String(s.siteId),
        datasetIndex: di,
        encode: { x: 't', y: v },
        xAxisIndex: panel,
        yAxisIndex: panel,
        color: siteColor.get(s.siteId),
        showSymbol: false,
        symbol: 'none',
        connectNulls: false,
        sampling: extremeSampler,
        lineStyle: { width: 1 },
        emphasis: { disabled: true },
      })),
    ),
  };
}

export interface ChartHandle {
  seriesCount: number;
  dispose(): void;
}

/** Draw all data in `el`. Returns the series count and a dispose function. */
export function renderChart(el: HTMLElement, data: Dataset): ChartHandle {
  const chart = echarts.init(el, prefersDark() ? 'dark' : undefined);
  // Test hook: the end-to-end tests read the chart state from the container element.
  Object.assign(el, { __chart: chart });
  const zoom: ZoomState = { start: 0, end: 100 };

  const draw = () => {
    chart.setOption(buildOption(data, readTokens(el), chart.getHeight(), zoom), { notMerge: true });
  };
  chart.on('datazoom', () => {
    const dz = (chart.getOption().dataZoom as ZoomState[] | undefined)?.[0];
    if (dz) {
      zoom.start = dz.start;
      zoom.end = dz.end;
    }
  });
  draw();

  // Width changes need only resize(). Height changes also move the panels.
  let lastHeight = el.clientHeight;
  const observer = new ResizeObserver(() => {
    chart.resize();
    if (el.clientHeight !== lastHeight) {
      lastHeight = el.clientHeight;
      chart.setOption(panelLayout(chart.getHeight()));
    }
  });
  observer.observe(el);

  // Light and dark mode: change the ECharts theme and read the CSS tokens again.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    chart.setTheme(media.matches ? 'dark' : 'default');
    draw();
  };
  media.addEventListener('change', onScheme);

  const seriesCount = PLOT_VARIABLES.length * data.series.length;
  return {
    seriesCount,
    dispose() {
      media.removeEventListener('change', onScheme);
      observer.disconnect();
      chart.dispose();
    },
  };
}
