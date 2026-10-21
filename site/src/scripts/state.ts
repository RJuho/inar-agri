// UI state: views (tabs), their data parameters and their diagrams.
// The state is kept in localStorage. A view can also come from the URL hash.
// This file has no DOM code and no chart code.

/** Variables that the user can select. Only these names go into SQL. Order = panel order. */
export const VARIABLES = [
  'nee', 'nee_f', 'gpp', 'reco', 'gpp_src', 'reco_src', 'ch4',
  'ta', 'sw_in', 'ppfd', 'rh', 'vpd', 'ustar',
  'tsoil', 'swc',
] as const;
export type Variable = (typeof VARIABLES)[number];

/** Checkbox groups of the parameter form. */
export const VARIABLE_GROUPS: readonly { label: string; variables: readonly Variable[] }[] = [
  { label: 'Fluxes', variables: ['nee', 'nee_f', 'gpp', 'reco', 'gpp_src', 'reco_src', 'ch4'] },
  { label: 'Meteorology', variables: ['ta', 'sw_in', 'ppfd', 'rh', 'vpd', 'ustar'] },
  { label: 'Soil', variables: ['tsoil', 'swc'] },
];

/** Variables of the default view. */
export const DEFAULT_VARIABLES: readonly Variable[] = ['nee', 'nee_f', 'ta', 'tsoil', 'swc'];

/** Short labels. Units come from variables.parquet. */
export const VARIABLE_LABELS: Record<Variable, string> = {
  nee: 'NEE, measured',
  nee_f: 'NEE, gap-filled',
  gpp: 'GPP, calculated',
  reco: 'Reco, calculated',
  gpp_src: 'GPP, data provider',
  reco_src: 'Reco, data provider',
  ch4: 'CH4 flux',
  ta: 'Air temperature',
  sw_in: 'Shortwave radiation',
  ppfd: 'PPFD',
  rh: 'Relative humidity',
  vpd: 'Vapour pressure deficit',
  ustar: 'Friction velocity u*',
  tsoil: 'Soil temperature',
  swc: 'Soil water content',
};

/** Sites that have the variable, for variables that only some sites have. Shown as a hint. */
export const VARIABLE_SITES: Partial<Record<Variable, string>> = {
  gpp_src: 'Anttila, Särkisuo, Qvidja',
  reco_src: 'Anttila, Särkisuo, Qvidja',
  ch4: 'Anttila, Särkisuo',
  sw_in: 'not Haltiala',
  ppfd: 'not Qvidja, Maktau',
  rh: 'not Haltiala',
  vpd: 'Haltiala, Qvidja, Maktau',
  ustar: 'Qvidja, Maktau',
};

export const AGGREGATIONS = ['raw', 'day', 'week', 'month'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  raw: '30 min (raw)',
  day: 'Daily mean',
  week: 'Weekly mean',
  month: 'Monthly mean',
};

/** Data parameters of a view. All diagrams of the view use them. */
export interface ViewParams {
  /** Site keys (sites.site_id). */
  sites: number[];
  variables: Variable[];
  /** X variable for diagram types that plot one variable against another. */
  xVariable: Variable;
  /** First and last year in site local time. null = no limit. */
  yearFrom: number | null;
  yearTo: number | null;
  /** First and last month (1 to 12). null = January for the first month, December for the last month. */
  monthFrom: number | null;
  monthTo: number | null;
  aggregation: Aggregation;
  /** Show the management events (harvest, sowing, ...) as markers. */
  events: boolean;
}

export interface Diagram {
  id: string;
  type: string;
}

export interface View {
  id: string;
  name: string;
  params: ViewParams;
  diagrams: Diagram[];
}

export interface Store {
  version: 1;
  activeId: string;
  views: View[];
}

export const STORAGE_KEY = 'inar-agri.views';
export const BACKUP_KEY = 'inar-agri.views.bak';
export const HASH_KEY = 'view';

const MAX_VIEWS = 50;
const MAX_DIAGRAMS = 20;
const MAX_NAME = 80;
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/** Make a short random id. */
export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Default parameters: all sites, the default variables, all years, raw data. */
export function defaultParams(allSites: number[]): ViewParams {
  return {
    sites: [...allSites],
    variables: [...DEFAULT_VARIABLES],
    xVariable: 'ta',
    yearFrom: null,
    yearTo: null,
    monthFrom: null,
    monthTo: null,
    aggregation: 'raw',
    events: false,
  };
}

/** The first view: all data in one time series diagram. */
export function defaultView(allSites: number[]): View {
  return {
    id: newId(),
    name: 'All data',
    params: defaultParams(allSites),
    diagrams: [{ id: newId(), type: 'timeseries' }],
  };
}

export function defaultStore(allSites: number[]): Store {
  const view = defaultView(allSites);
  return { version: 1, activeId: view.id, views: [view] };
}

// ---------- Guards. They accept only known keys and values. ----------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseId(x: unknown): string | null {
  return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x) ? x : null;
}

function parseName(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const name = x.trim().slice(0, MAX_NAME);
  return name === '' ? null : name;
}

function parseYear(x: unknown): number | null | undefined {
  if (x === null) return null;
  if (typeof x === 'number' && Number.isInteger(x) && x >= YEAR_MIN && x <= YEAR_MAX) return x;
  return undefined;
}

function parseMonth(x: unknown): number | null | undefined {
  if (x === null) return null;
  if (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 12) return x;
  return undefined;
}

type Range = Pick<ViewParams, 'yearFrom' | 'yearTo' | 'monthFrom' | 'monthTo'>;

/**
 * Put the start before the end. The (year, month) pairs change places when the start is
 * after the end. Only when both years are set: else the order depends on the data years.
 */
export function orderRange<R extends Range>(r: R): R {
  const { yearFrom, yearTo, monthFrom, monthTo } = r;
  if (yearFrom === null || yearTo === null) return r;
  const from = yearFrom * 12 + (monthFrom ?? 1);
  const to = yearTo * 12 + (monthTo ?? 12);
  if (from <= to) return r;
  if (yearFrom === yearTo) return { ...r, monthFrom: monthTo, monthTo: monthFrom };
  return { ...r, yearFrom: yearTo, yearTo: yearFrom, monthFrom: monthTo, monthTo: monthFrom };
}

function isVariable(x: unknown): x is Variable {
  return typeof x === 'string' && (VARIABLES as readonly string[]).includes(x);
}

/** Check the parameters. Unknown variables and bad site keys are removed. */
export function parseParams(x: unknown): ViewParams | null {
  if (!isRecord(x)) return null;
  if (!Array.isArray(x.sites) || !Array.isArray(x.variables)) return null;
  const sites = [...new Set(x.sites.filter((s): s is number => Number.isInteger(s) && s >= 0 && s <= 9999))].sort(
    (a, b) => a - b,
  );
  // Keep the panel order of VARIABLES.
  const picked = new Set(x.variables.filter(isVariable));
  const variables = VARIABLES.filter((v) => picked.has(v));
  const xVariable = isVariable(x.xVariable) ? x.xVariable : 'ta';
  const yearFrom = parseYear(x.yearFrom);
  const yearTo = parseYear(x.yearTo);
  if (yearFrom === undefined || yearTo === undefined) return null;
  // Views from before the month fields have no month keys: then no month limit.
  const monthFrom = parseMonth(x.monthFrom ?? null);
  const monthTo = parseMonth(x.monthTo ?? null);
  if (monthFrom === undefined || monthTo === undefined) return null;
  const range = orderRange({ yearFrom, yearTo, monthFrom, monthTo });
  const aggregation = (AGGREGATIONS as readonly unknown[]).includes(x.aggregation) ? (x.aggregation as Aggregation) : null;
  if (aggregation === null) return null;
  const events = x.events === true;
  // Fixed key order: sameView() compares the JSON text.
  return {
    sites,
    variables,
    xVariable,
    yearFrom: range.yearFrom,
    yearTo: range.yearTo,
    monthFrom: range.monthFrom,
    monthTo: range.monthTo,
    aggregation,
    events,
  };
}

/** Check one view. Diagrams of unknown types are removed. */
export function parseView(x: unknown, knownTypes: ReadonlySet<string>): View | null {
  if (!isRecord(x)) return null;
  const id = parseId(x.id);
  const name = parseName(x.name);
  const params = parseParams(x.params);
  if (id === null || name === null || params === null || !Array.isArray(x.diagrams)) return null;
  const diagrams: Diagram[] = [];
  const seen = new Set<string>();
  for (const d of x.diagrams.slice(0, MAX_DIAGRAMS)) {
    if (!isRecord(d)) return null;
    const did = parseId(d.id);
    if (did === null || seen.has(did) || typeof d.type !== 'string') return null;
    if (!knownTypes.has(d.type)) continue;
    seen.add(did);
    diagrams.push({ id: did, type: d.type });
  }
  return { id, name, params, diagrams };
}

/** Check a stored value. Returns null when the value is not a valid store. */
export function parseStore(x: unknown, knownTypes: ReadonlySet<string>): Store | null {
  if (!isRecord(x) || x.version !== 1 || !Array.isArray(x.views)) return null;
  if (x.views.length === 0 || x.views.length > MAX_VIEWS) return null;
  const views: View[] = [];
  const ids = new Set<string>();
  for (const raw of x.views) {
    const view = parseView(raw, knownTypes);
    if (view === null || ids.has(view.id)) return null;
    ids.add(view.id);
    views.push(view);
  }
  const first = views[0] as View;
  const activeId = typeof x.activeId === 'string' && ids.has(x.activeId) ? x.activeId : first.id;
  return { version: 1, activeId, views };
}

// ---------- Web storage. All access is in try/catch: storage can be blocked. ----------

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is full or blocked. The state then lives only in this page.
  }
}

/**
 * Read the store from localStorage.
 * If the value is bad, copy it to BACKUP_KEY and use the default store.
 */
export function loadStore(allSites: number[], knownTypes: ReadonlySet<string>): Store {
  const raw = storageGet(STORAGE_KEY);
  if (raw === null) return defaultStore(allSites);
  let parsed: Store | null = null;
  try {
    parsed = parseStore(JSON.parse(raw), knownTypes);
  } catch {
    parsed = null;
  }
  if (parsed) return parsed;
  storageSet(BACKUP_KEY, raw);
  const store = defaultStore(allSites);
  saveStore(store);
  return store;
}

export function saveStore(store: Store): void {
  storageSet(STORAGE_KEY, JSON.stringify(store));
}

// ---------- URL hash: #view=<base64url(JSON View)> ----------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Make the URL hash for one view. */
export function viewToHash(view: View): string {
  return `#${HASH_KEY}=${toBase64Url(JSON.stringify(view))}`;
}

/** Read a view from the URL hash. Returns null when the hash has no valid view. */
export function viewFromHash(hash: string, knownTypes: ReadonlySet<string>): View | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get(HASH_KEY);
  if (!value) return null;
  try {
    return parseView(JSON.parse(fromBase64Url(value)), knownTypes);
  } catch {
    return null;
  }
}

/** True when two views have the same name, parameters and diagram types. Ids are not compared. */
export function sameView(a: View, b: View): boolean {
  const key = (v: View) => JSON.stringify([v.name, v.params, v.diagrams.map((d) => d.type)]);
  return key(a) === key(b);
}

/**
 * Add a view from the URL hash to the store, or activate an equal view.
 * Returns true when the store changed.
 */
export function importView(store: Store, view: View): boolean {
  const equal = store.views.find((v) => sameView(v, view));
  if (equal) {
    store.activeId = equal.id;
    return true;
  }
  if (store.views.length >= MAX_VIEWS) return false;
  const copy: View = { ...structuredClone(view), id: newId(), diagrams: view.diagrams.map((d) => ({ id: newId(), type: d.type })) };
  store.views.push(copy);
  store.activeId = copy.id;
  return true;
}

// ---------- Store operations ----------

export function activeView(store: Store): View {
  return store.views.find((v) => v.id === store.activeId) ?? (store.views[0] as View);
}

/** Make a name that no other view has: "New view", "New view 2", ... */
function uniqueName(store: Store, base: string): string {
  const names = new Set(store.views.map((v) => v.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function canAddView(store: Store): boolean {
  return store.views.length < MAX_VIEWS;
}

export function canAddDiagram(view: View): boolean {
  return view.diagrams.length < MAX_DIAGRAMS;
}

/** Add an empty view (default parameters, no diagrams) after the active view and activate it. */
export function addEmptyView(store: Store, allSites: number[]): void {
  if (!canAddView(store)) return;
  const view: View = { id: newId(), name: uniqueName(store, 'New view'), params: defaultParams(allSites), diagrams: [] };
  insertAfterActive(store, view);
}

/** Copy the active view and activate the copy. */
export function copyActiveView(store: Store): void {
  if (!canAddView(store)) return;
  const src = activeView(store);
  const view: View = {
    id: newId(),
    name: uniqueName(store, `${src.name} (copy)`.slice(0, MAX_NAME)),
    params: structuredClone(src.params),
    diagrams: src.diagrams.map((d) => ({ id: newId(), type: d.type })),
  };
  insertAfterActive(store, view);
}

function insertAfterActive(store: Store, view: View): void {
  const i = store.views.findIndex((v) => v.id === store.activeId);
  store.views.splice(i + 1, 0, view);
  store.activeId = view.id;
}

/** Remove a view. The last view cannot be removed. */
export function removeView(store: Store, id: string): void {
  if (store.views.length <= 1) return;
  const i = store.views.findIndex((v) => v.id === id);
  if (i < 0) return;
  store.views.splice(i, 1);
  if (store.activeId === id) store.activeId = (store.views[Math.max(0, i - 1)] as View).id;
}

export function renameView(store: Store, id: string, name: string): void {
  const clean = parseName(name);
  const view = store.views.find((v) => v.id === id);
  if (view && clean !== null) view.name = clean;
}

export function addDiagram(view: View, type: string): void {
  if (canAddDiagram(view)) view.diagrams.push({ id: newId(), type });
}

export function removeDiagram(view: View, id: string): void {
  view.diagrams = view.diagrams.filter((d) => d.id !== id);
}

/** Move a diagram up (-1) or down (+1). */
export function moveDiagram(view: View, id: string, step: -1 | 1): void {
  const i = view.diagrams.findIndex((d) => d.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= view.diagrams.length) return;
  const list = view.diagrams;
  [list[i], list[j]] = [list[j] as Diagram, list[i] as Diagram];
}
