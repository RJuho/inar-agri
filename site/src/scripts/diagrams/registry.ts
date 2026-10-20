// Registry of diagram types. The "Add diagram" list shows all registered types.
// To add a type: write a module that exports a DiagramDef and add it to DEFS.
import type { EChartsCoreOption } from 'echarts/core';
import type { Table } from 'apache-arrow';
import type { Meta } from '../db';
import type { Tokens } from '../theme';
import type { ViewParams } from '../state';
import { timeseries } from './timeseries';

/** Data that a diagram type made from its query result. */
export interface Prepared {
  /** Number of rows in the query result. */
  rowCount: number;
  /** Number of chart series. */
  seriesCount: number;
  /** A short note when the diagram cannot show data, for example "Select a site". */
  note?: string;
}

/** Values that the option builder needs, in addition to the data. */
export interface BuildContext {
  params: ViewParams;
  meta: Meta;
  tokens: Tokens;
  /** Chart height in px. */
  height: number;
  /** Zoom range in percent of the full x range. */
  zoom: { start: number; end: number };
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
  /** Chart height in px for these parameters. */
  height(params: ViewParams): number;
}

// Each def has its own data type. The registry stores them with the base type.
const DEFS: DiagramDef[] = [timeseries as unknown as DiagramDef];

export const DIAGRAM_DEFS: ReadonlyMap<string, DiagramDef> = new Map(DEFS.map((d) => [d.type, d]));
export const DIAGRAM_TYPES: ReadonlySet<string> = new Set(DIAGRAM_DEFS.keys());

export function diagramDef(type: string): DiagramDef | undefined {
  return DIAGRAM_DEFS.get(type);
}
