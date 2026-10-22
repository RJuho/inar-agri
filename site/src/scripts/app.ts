// Page start: load the data, read the views from Web storage and the URL hash,
// and connect the add-diagram list, the tabs, the parameter form and the diagrams.
import { loadMeta, setLoadProgress } from './db';
import { setYearBounds } from './diagrams/sql';
import { setAxisRanges } from './axisRanges';
// Fixed y ranges of all data: npm run site:sync writes the file, Vite puts it in the bundle.
import axisRangesData from '../data/axis-ranges.json';
import { DIAGRAM_DEFS, DIAGRAM_TYPES } from './diagrams/registry';
import {
  activeView,
  addDiagram,
  addEmptyView,
  canAddDiagram,
  copyActiveView,
  importView,
  loadStore,
  moveDiagram,
  parseParams,
  removeDiagram,
  removeView,
  renameView,
  saveStore,
  viewFromHash,
  viewToHash,
} from './state';
import { DiagramList } from './ui/diagrams';
import { showRecovery } from './recover';
import { compositePng, DEFAULT_SCALE, diagramPng, download, downloadBlob, slug, type PngResult } from './export';
import { exportData, sizeText, type DataFormat, type DataScope } from './dataexport';
import { ParamsForm } from './ui/params';
import { Tabs } from './ui/tabs';

// Group digits with a space, for example 537 980.
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} is missing.`);
  return e as T;
}

/** Remove the hash from the URL, so that a reload does not import the view again. */
function clearHash(): void {
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
}

export async function start(): Promise<void> {
  const statusEl = byId<HTMLElement>('status');
  const chartEl = byId<HTMLElement>('chart');
  const addEl = byId<HTMLSelectElement>('add-diagram');

  const loaderEl = byId<HTMLElement>('loader');
  const barEl = loaderEl.querySelector<HTMLElement>('.loader-bar');
  let shown = 0;
  setLoadProgress((fraction) => {
    // null = size not known: the bar moves back and forth. The bar never goes back.
    if (fraction === null) {
      loaderEl.dataset.indeterminate = '';
      loaderEl.removeAttribute('aria-valuenow');
      return;
    }
    delete loaderEl.dataset.indeterminate;
    shown = Math.max(shown, fraction);
    barEl?.style.setProperty('width', `${(shown * 100).toFixed(1)}%`);
    loaderEl.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
  });

  const t0 = performance.now();
  let meta;
  try {
    meta = await loadMeta();
  } catch (err) {
    console.error(err);
    loaderEl.remove();
    showRecovery(statusEl, err);
    chartEl.dataset.status = 'error';
    return;
  }
  setLoadProgress(null);
  loaderEl.remove();
  setYearBounds(meta.yearMin, meta.yearMax);
  setAxisRanges(axisRangesData);
  const loadSec = ((performance.now() - t0) / 1000).toFixed(1);
  const baseStatus =
    `${fmt(meta.rowCount)} rows, ${meta.sites.length} sites, ${meta.yearMin} to ${meta.yearMax}. ` + `Loaded in ${loadSec} s.`;
  statusEl.textContent = baseStatus;

  const allSites = meta.sites.map((s) => s.siteId);
  const store = loadStore(allSites, DIAGRAM_TYPES);
  let shownId: string | null = null;

  const commit = () => {
    saveStore(store);
    render();
  };

  const importFromHash = () => {
    const view = viewFromHash(window.location.hash, DIAGRAM_TYPES);
    clearHash();
    if (view && importView(store, view)) commit();
  };

  // Add-diagram list: one option per registered type.
  for (const def of DIAGRAM_DEFS.values()) {
    const o = document.createElement('option');
    o.value = def.type;
    o.textContent = def.label;
    addEl.append(o);
  }
  addEl.addEventListener('change', () => {
    const type = addEl.value;
    addEl.value = '';
    if (!DIAGRAM_TYPES.has(type)) return;
    addDiagram(activeView(store), type);
    commit();
  });

  const tabs = new Tabs(byId('tabs'), {
    activate(id) {
      if (store.activeId === id) return;
      store.activeId = id;
      commit();
    },
    addEmpty() {
      addEmptyView(store, allSites);
      commit();
    },
    copy() {
      copyActiveView(store);
      commit();
    },
    rename(id, name) {
      renameView(store, id, name);
      commit();
    },
    remove(id) {
      removeView(store, id);
      commit();
    },
    async copyLink() {
      const url = new URL(window.location.href);
      url.hash = viewToHash(activeView(store));
      try {
        await navigator.clipboard.writeText(url.toString());
        statusEl.textContent = 'Link to the view copied.';
      } catch {
        statusEl.textContent = `Link to the view: ${url.toString()}`;
      }
      setTimeout(() => {
        statusEl.textContent = baseStatus;
      }, 4000);
    },
    downloadAll() {
      void savePng('all');
    },
    downloadData: (scope, format) => saveData(scope, format),
  });

  /**
   * Busy state after a parameter change, until all diagrams are ready, have a note or have an error.
   * The form, the tabs and "Add diagram" are disabled, so that updates do not overlap.
   */
  let busy = false;
  const setBusy = (on: boolean) => {
    busy = on;
    form.setBusy(on);
    tabs.setBusy(on);
    addEl.disabled = on || !canAddDiagram(activeView(store));
    if (on) chartEl.setAttribute('aria-busy', 'true');
    else chartEl.removeAttribute('aria-busy');
  };

  const form = new ParamsForm(byId('params'), meta, (params) => {
    const clean = parseParams(params);
    if (!clean) return;
    activeView(store).params = clean;
    commit();
    setBusy(true);
    diagrams.whenSettled(() => setBusy(false));
  });

  /** Show a message in the status line. After `ms` (0 = never), show the normal text again. */
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const flash = (text: string, error = false, ms = 4000) => {
    clearTimeout(flashTimer);
    statusEl.textContent = text;
    statusEl.classList.toggle('error', error);
    if (ms > 0) {
      flashTimer = setTimeout(() => {
        statusEl.textContent = baseStatus;
        statusEl.classList.remove('error');
      }, ms);
    }
  };

  /** Make the data file of the active view in the browser and save it. */
  const saveData = async (scope: DataScope, format: DataFormat) => {
    const view = activeView(store);
    const what = `${format === 'csv' ? 'CSV' : 'Parquet'} ${scope === 'one' ? 'file' : 'files (one per site, ZIP)'}`;
    flash(`Making the ${what} for view ${view.name}…`, false, 0);
    try {
      const file = await exportData(view, meta, scope, format);
      downloadBlob(new Blob([file.bytes], { type: file.mime }), file.fileName);
      const parts = file.files > 1 ? `${file.files} files, ` : '';
      flash(`Saved ${file.fileName}: ${sizeText(file.bytes.length)}, ${parts}${fmt(file.rows)} rows.`, false, 10_000);
    } catch (err) {
      console.warn(err);
      flash(`Cannot make the data file: ${err instanceof Error ? err.message : String(err)}`, true, 10_000);
    }
  };

  /** PNG of one diagram (id or index) or of all diagrams ("all") of the active view. */
  const exportPng = async (target: string | number = 'all', scale = DEFAULT_SCALE): Promise<PngResult> => {
    const view = activeView(store);
    if (target === 'all') return compositePng(view, meta, diagrams.exportItems(), scale);
    const item = diagrams.exportItem(target);
    if (!item) throw new Error(`No diagram ${JSON.stringify(target)} in view ${view.name}.`);
    return diagramPng(item, view, meta, scale);
  };

  const savePng = async (target: string | number) => {
    const view = activeView(store);
    try {
      const { dataUrl } = await exportPng(target);
      let part = 'all';
      if (target !== 'all') {
        const items = diagrams.exportItems();
        const i = items.findIndex((it) => it.id === target);
        part = `${i + 1}-${items[i]?.type ?? 'diagram'}`;
      }
      download(dataUrl, `inar-agri_${slug(view.name)}_${part}.png`);
    } catch (err) {
      console.warn(err);
      flash(`Cannot make the PNG image: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };

  const diagrams = new DiagramList(chartEl, meta, {
    move(id, step) {
      moveDiagram(activeView(store), id, step);
      commit();
    },
    remove(id) {
      removeDiagram(activeView(store), id);
      commit();
    },
    png(id) {
      void savePng(id);
    },
  });

  // Hook for scripts and tests: the alt text of a diagram of the active view (id or index).
  const hook = ((window as unknown as { __inar?: Record<string, unknown> }).__inar ??= {});
  hook.altText = (target: string | number) => diagrams.altText(target);
  // PNG data URL and alt text of one diagram (id or index) or of all diagrams ("all").
  hook.exportPng = exportPng;
  // The active view and its diagrams, for scripts/screenshot.ts --list.
  hook.view = () => {
    const view = activeView(store);
    return {
      id: view.id,
      name: view.name,
      params: structuredClone(view.params),
      diagrams: diagrams.exportItems().map((d, index) => ({ index, id: d.id, type: d.type, title: d.title, ready: d.ready })),
    };
  };

  function render(): void {
    const view = activeView(store);
    tabs.render(store);
    if (view.id !== shownId) {
      // Other view: dispose the old charts and show the new parameters.
      diagrams.clear();
      form.show(view.params);
      shownId = view.id;
    }
    diagrams.sync(view);
    addEl.disabled = busy || !canAddDiagram(view);
    chartEl.setAttribute('aria-label', `Diagrams of view ${view.name}`);
  }

  window.addEventListener('hashchange', importFromHash);
  const fromHash = viewFromHash(window.location.hash, DIAGRAM_TYPES);
  clearHash();
  if (fromHash) importView(store, fromHash);
  saveStore(store);
  render();
}
