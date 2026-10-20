// Page start: load the data, read the views from Web storage and the URL hash,
// and connect the add-diagram list, the tabs, the parameter form and the diagrams.
import { loadMeta } from './db';
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

  const t0 = performance.now();
  let meta;
  try {
    meta = await loadMeta();
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Cannot show the data: ${err instanceof Error ? err.message : String(err)}`;
    statusEl.classList.add('error');
    chartEl.dataset.status = 'error';
    return;
  }
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
  });

  const form = new ParamsForm(byId('params'), meta, (params) => {
    const clean = parseParams(params);
    if (!clean) return;
    activeView(store).params = clean;
    commit();
  });

  const diagrams = new DiagramList(chartEl, meta, {
    move(id, step) {
      moveDiagram(activeView(store), id, step);
      commit();
    },
    remove(id) {
      removeDiagram(activeView(store), id);
      commit();
    },
  });

  // Hook for scripts and tests: the alt text of a diagram of the active view (id or index).
  const hook = ((window as unknown as { __inar?: Record<string, unknown> }).__inar ??= {});
  hook.altText = (target: string | number) => diagrams.altText(target);

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
    addEl.disabled = !canAddDiagram(view);
    chartEl.setAttribute('aria-label', `Diagrams of view ${view.name}`);
  }

  window.addEventListener('hashchange', importFromHash);
  const fromHash = viewFromHash(window.location.hash, DIAGRAM_TYPES);
  clearHash();
  if (fromHash) importView(store, fromHash);
  saveStore(store);
  render();
}
