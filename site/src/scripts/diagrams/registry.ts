// Registry of diagram types. The "Add diagram" list shows all registered types.
// To add a type: write a module that exports a DiagramDef and add it to DEFS.
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import type { Meta } from '../db';
import type { Tokens } from '../theme';
import type { Variable, ViewParams } from '../state';
import type { SiteStats } from '../alttext';
import { timeseries } from './timeseries';
import { years } from './years';
import { yearPanels } from './yearPanels';
import { monthly } from './monthly';
import { diurnal } from './diurnal';
import { scatter } from './scatter';
import { cumulative } from './cumulative';
import { fingerprint } from './fingerprint';
import { response } from './response';
import { budget } from './budget';
import { coverage } from './coverage';

/** Data that a diagram type made from its query result. */
export interface Prepared {
  /** Number of rows in the query result. */
  rowCount: number;
  /** Number of chart series. */
  seriesCount: number;
  /** A short note when the diagram cannot show data, for example "Select a site". The chart is then hidden. */
  note?: string;
  /** A short line below the title, for example "Raw data is shown as daily means". The chart stays visible. */
  subtitle?: string;
}

/** Values that the option builder needs, in addition to the data. */
export interface BuildContext {
  params: ViewParams;
  meta: Meta;
  tokens: Tokens;
  /** Chart height and width in px. */
  height: number;
  width: number;
  /** Zoom range in percent of the full x range. */
  zoom: { start: number; end: number };
  /** True when the option is for the PNG export: fixed width, EXPORT_TOKENS and larger text. */
  export?: boolean;
}

/** Values that the alt text template needs. */
export interface AltContext {
  params: ViewParams;
  meta: Meta;
  /** Statistics per site and variable from alttext.ts. Empty when no stats query ran. */
  stats: SiteStats[];
}

export interface DiagramDef<D extends Prepared = Prepared> {
  type: string;
  /** Label in the "Add diagram" list and the diagram title. */
  label: string;
  /** SQL on table `obs`. Return null when the parameters give no data. */
  query(params: ViewParams): string | null;
  /** Make the chart data from the query result. `table` is null when query() gave null. */
  prepare(table: Table | null, params: ViewParams, meta: Meta): D;
  /** Make the full ECharts option. */
  build(data: D, ctx: BuildContext): EChartsCoreOption;
  /** Option part that changes with the chart height. Optional. */
  relayout?(data: D, ctx: BuildContext): EChartsCoreOption;
  /** True when the layout changes with the chart width. The card then draws again after a width change. */
  widthDependent?: boolean;
  /** True when the type draws management event markers (when `params.events` is on). Optional. */
  showsEvents?: boolean;
  /** False when the type has no value range that `params.fixedY` changes (coverage). Default true. */
  usesFixedRange?: boolean;
  /** Empty band in px at the bottom of the chart, without the slider, to remove from the PNG export. Optional. */
  exportCropBottom?: number;
  /**
   * Step that the diagram really shows, for the export title ("Step: <label>"). Optional.
   * Default: the step of the view (`AGGREGATION_LABELS`).
   */
  exportStep?(params: ViewParams): string;
  /** Chart height in px. `data` is null before the first query result. */
  height(params: ViewParams, data: D | null, width: number): number;
  /** Variables for the statistics of the alt text. Default: the variables of the view. */
  statsVariables?(params: ViewParams): Variable[];
  /** Sentence that tells how the diagram shows the data. The alt text starts with it. */
  describe(data: D, ctx: AltContext): string;
}

// Each def has its own data type. The registry stores them with the base type.
const DEFS = [timeseries, years, yearPanels, monthly, diurnal, scatter, cumulative, fingerprint, response, budget, coverage] as unknown as DiagramDef[];

export const DIAGRAM_DEFS: ReadonlyMap<string, DiagramDef> = new Map(DEFS.map((d) => [d.type, d]));
export const DIAGRAM_TYPES: ReadonlySet<string> = new Set(DIAGRAM_DEFS.keys());

export function diagramDef(type: string): DiagramDef | undefined {
  return DIAGRAM_DEFS.get(type);
}
