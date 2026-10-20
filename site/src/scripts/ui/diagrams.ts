// Diagram cards of the active view. Each card runs the query of its diagram type
// and draws the ECharts option. All cards use the parameters of the view.
import * as echarts from 'echarts/core';
import {
  AxisPointerComponent,
  DatasetComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { Table } from 'apache-arrow';
import { query, type Meta } from '../db';
import { diagramDef, type DiagramDef, type Prepared } from '../diagrams/registry';
import { onSchemeChange, prefersDark, readTokens } from '../theme';
import type { Diagram, View, ViewParams } from '../state';

// Components that all diagram types use. Chart types register their own series modules.
echarts.use([
  AxisPointerComponent,
  DatasetComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

type Status = 'loading' | 'ready' | 'error';

export interface DiagramActions {
  move(id: string, step: -1 | 1): void;
  remove(id: string): void;
}

// Diagrams of one view often run the same SQL. Keep the last results.
const CACHE_SIZE = 4;
const cache = new Map<string, Promise<Table>>();

function cachedQuery(sql: string): Promise<Table> {
  let p = cache.get(sql);
  if (p) {
    // Move the entry to the end: it is now the newest.
    cache.delete(sql);
  } else {
    p = query(sql);
    p.catch(() => cache.delete(sql));
  }
  cache.set(sql, p);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return p;
}

function button(label: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-button';
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

/** One diagram: a card with a title, buttons and the chart element. */
class DiagramCard {
  readonly el: HTMLElement;
  readonly id: string;
  status: Status = 'loading';
  rowCount = 0;
  seriesCount = 0;

  private readonly def: DiagramDef;
  private readonly chartEl: HTMLDivElement;
  private readonly noteEl: HTMLParagraphElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly upBtn: HTMLButtonElement;
  private readonly downBtn: HTMLButtonElement;
  private chart: echarts.ECharts | null = null;
  private data: Prepared | null = null;
  private params: ViewParams | null = null;
  private zoom = { start: 0, end: 100 };
  private token = 0;
  private lastHeight = 0;
  private readonly observer: ResizeObserver;

  constructor(
    diagram: Diagram,
    def: DiagramDef,
    private readonly meta: Meta,
    actions: DiagramActions,
    private readonly onStatus: () => void,
  ) {
    this.id = diagram.id;
    this.def = def;
    this.el = document.createElement('section');
    this.el.className = 'diagram';
    this.el.dataset.type = def.type;
    this.el.dataset.id = diagram.id;
    this.el.dataset.status = 'loading';

    const head = document.createElement('header');
    head.className = 'diagram-head';
    this.titleEl = document.createElement('h2');
    this.titleEl.textContent = def.label;
    const tools = document.createElement('div');
    tools.className = 'diagram-tools';
    this.upBtn = button('Move diagram up', '↑', () => actions.move(this.id, -1));
    this.downBtn = button('Move diagram down', '↓', () => actions.move(this.id, 1));
    tools.append(this.upBtn, this.downBtn, button('Remove diagram', '×', () => actions.remove(this.id)));
    head.append(this.titleEl, tools);

    this.noteEl = document.createElement('p');
    this.noteEl.className = 'diagram-note';
    this.noteEl.hidden = true;

    this.chartEl = document.createElement('div');
    this.chartEl.className = 'diagram-chart';
    this.chartEl.setAttribute('role', 'img');
    this.chartEl.setAttribute('aria-label', def.label);

    this.el.append(head, this.noteEl, this.chartEl);

    // Width changes need only resize(). Height changes can also move the panels.
    this.observer = new ResizeObserver(() => {
      if (!this.chart) return;
      this.chart.resize();
      const h = this.chartEl.clientHeight;
      if (h !== this.lastHeight && this.data && this.def.relayout && this.params) {
        this.lastHeight = h;
        this.chart.setOption(this.def.relayout(this.data, this.context(this.params)));
      }
    });
    this.observer.observe(this.chartEl);
  }

  /** Show the position of the card in the list: title number and button state. */
  setPosition(index: number, count: number): void {
    this.titleEl.textContent = `${index + 1}. ${this.def.label}`;
    this.upBtn.disabled = index === 0;
    this.downBtn.disabled = index === count - 1;
  }

  private setStatus(status: Status): void {
    this.status = status;
    this.el.dataset.status = status;
    this.el.dataset.rows = String(this.rowCount);
    this.el.dataset.series = String(this.seriesCount);
    this.onStatus();
  }

  private context(params: ViewParams) {
    return {
      params,
      meta: this.meta,
      tokens: readTokens(this.chartEl),
      height: this.chartEl.clientHeight,
      zoom: this.zoom,
    };
  }

  private ensureChart(): echarts.ECharts {
    if (this.chart) return this.chart;
    const chart = echarts.init(this.chartEl, prefersDark() ? 'dark' : undefined);
    // Test hook: the end-to-end tests read the chart state from the chart element.
    Object.assign(this.chartEl, { __chart: chart });
    chart.on('datazoom', () => {
      const dz = (chart.getOption().dataZoom as Array<{ start: number; end: number }> | undefined)?.[0];
      if (dz) this.zoom = { start: dz.start, end: dz.end };
    });
    this.chart = chart;
    return chart;
  }

  /** Run the query for new parameters and draw the result. */
  async update(params: ViewParams): Promise<void> {
    const token = ++this.token;
    this.params = params;
    this.zoom = { start: 0, end: 100 };
    this.setStatus('loading');
    try {
      const sql = this.def.query(params);
      const table = sql === null ? null : await cachedQuery(sql);
      if (token !== this.token) return;
      const data = this.def.prepare(table, params, this.meta);
      this.data = data;
      this.rowCount = data.rowCount;
      this.seriesCount = data.seriesCount;
      this.showNote(data.note ?? null);
      if (data.note) {
        this.chart?.clear();
        this.chartEl.hidden = true;
      } else {
        this.chartEl.hidden = false;
        this.chartEl.style.height = `${this.def.height(params)}px`;
        this.lastHeight = this.chartEl.clientHeight;
        const chart = this.ensureChart();
        chart.resize();
        this.draw();
      }
      this.setStatus('ready');
    } catch (err) {
      if (token !== this.token) return;
      console.error(err);
      this.rowCount = 0;
      this.seriesCount = 0;
      this.showNote(`Cannot draw the diagram: ${err instanceof Error ? err.message : String(err)}`);
      this.setStatus('error');
    }
  }

  private showNote(text: string | null): void {
    this.noteEl.hidden = text === null;
    this.noteEl.textContent = text ?? '';
  }

  /** Draw the option again with the current data, for example after a colour scheme change. */
  draw(): void {
    if (!this.chart || !this.data || !this.params || this.data.note) return;
    this.chart.setOption(this.def.build(this.data, this.context(this.params)), { notMerge: true });
  }

  setDark(dark: boolean): void {
    if (!this.chart) return;
    this.chart.setTheme(dark ? 'dark' : 'default');
    this.draw();
  }

  dispose(): void {
    this.token++;
    this.observer.disconnect();
    this.chart?.dispose();
    this.chart = null;
    this.el.remove();
  }
}

/**
 * The list of diagram cards in `container` (#chart).
 * The container gets data-status (ready when all cards are ready, empty when the
 * view has no diagrams), data-rows and data-series (sums over the cards).
 */
export class DiagramList {
  private cards = new Map<string, DiagramCard>();
  private paramsKey = '';
  private readonly hint: HTMLParagraphElement;
  private readonly stopScheme: () => void;

  constructor(
    private readonly container: HTMLElement,
    private readonly meta: Meta,
    private readonly actions: DiagramActions,
  ) {
    this.hint = document.createElement('p');
    this.hint.className = 'hint';
    this.hint.textContent = 'This view has no diagrams. Use "Add diagram" at the top to add one.';
    this.stopScheme = onSchemeChange((dark) => this.cards.forEach((c) => c.setDark(dark)));
  }

  /** Remove all cards. Use this before a different view is shown. */
  clear(): void {
    this.cards.forEach((c) => c.dispose());
    this.cards.clear();
    this.paramsKey = '';
  }

  /**
   * Show the diagrams of `view`. Keep the cards that exist, add new cards,
   * remove old cards and put them in the order of the view.
   * If the parameters changed, all cards run their query again.
   */
  sync(view: View): void {
    const key = JSON.stringify(view.params);
    const paramsChanged = key !== this.paramsKey;
    this.paramsKey = key;

    const wanted = new Set(view.diagrams.map((d) => d.id));
    for (const [id, card] of this.cards) {
      if (!wanted.has(id)) {
        card.dispose();
        this.cards.delete(id);
      }
    }

    const fresh: DiagramCard[] = [];
    const order: HTMLElement[] = [];
    view.diagrams.forEach((d) => {
      let card = this.cards.get(d.id);
      if (!card) {
        const def = diagramDef(d.type);
        if (!def) return;
        card = new DiagramCard(d, def, this.meta, this.actions, () => this.report());
        this.cards.set(d.id, card);
        fresh.push(card);
      }
      order.push(card.el);
    });
    order.forEach((el, i) => {
      const card = this.cards.get(el.dataset.id ?? '');
      card?.setPosition(i, order.length);
    });
    this.hint.hidden = order.length > 0;
    this.container.replaceChildren(this.hint, ...order);

    const params = structuredClone(view.params);
    for (const card of this.cards.values()) {
      if (paramsChanged || fresh.includes(card)) void card.update(params);
    }
    this.report();
  }

  /** Write the sums of all cards to the container attributes. */
  private report(): void {
    const cards = [...this.cards.values()];
    let status: string;
    if (cards.length === 0) status = 'empty';
    else if (cards.some((c) => c.status === 'error')) status = 'error';
    else if (cards.every((c) => c.status === 'ready')) status = 'ready';
    else status = 'loading';
    const el = this.container;
    el.dataset.status = status;
    el.dataset.rows = String(cards.reduce((n, c) => n + c.rowCount, 0));
    el.dataset.series = String(cards.reduce((n, c) => n + c.seriesCount, 0));
  }

  dispose(): void {
    this.clear();
    this.stopScheme();
  }
}
