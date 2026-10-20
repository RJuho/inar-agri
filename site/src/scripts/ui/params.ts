// Parameter form of the active view: sites, variables, years, aggregation and x variable.
// All diagrams of the view use these parameters.
import type { Meta } from '../db';
import { siteEmoji } from '../sites';
import {
  AGGREGATION_LABELS,
  AGGREGATIONS,
  VARIABLE_LABELS,
  VARIABLES,
  type Aggregation,
  type Variable,
  type ViewParams,
} from '../state';

/** Wait time after the last change before the diagrams are drawn again. */
const DEBOUNCE_MS = 300;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function checkbox(name: string, value: string, label: string, checked: boolean, emoji = ''): HTMLLabelElement {
  const wrap = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.name = name;
  input.value = value;
  input.checked = checked;
  wrap.append(input);
  if (emoji) {
    // Decoration only: screen readers read the site name.
    const icon = el('span', 'check-emoji', emoji);
    icon.setAttribute('aria-hidden', 'true');
    wrap.append(icon);
  }
  wrap.append(document.createTextNode(label));
  return wrap;
}

function select(name: string, label: string, options: Array<[string, string]>, value: string): HTMLLabelElement {
  const wrap = el('label', 'field');
  const s = el('select');
  s.name = name;
  for (const [v, text] of options) {
    const o = el('option', undefined, text);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  wrap.append(el('span', 'field-label', label), s);
  return wrap;
}

export class ParamsForm {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly form: HTMLFormElement;

  constructor(
    host: HTMLElement,
    private readonly meta: Meta,
    private readonly onChange: (params: ViewParams) => void,
  ) {
    this.form = el('form', 'params');
    this.form.setAttribute('aria-label', 'Data parameters');
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.form.addEventListener('change', () => this.schedule());
    host.replaceChildren(this.form);
  }

  /** Show the parameters of a view. A pending change of the previous view is dropped. */
  show(params: ViewParams): void {
    clearTimeout(this.timer);
    const { meta } = this;

    const sites = el('fieldset', 'group');
    sites.append(el('legend', undefined, 'Sites'));
    for (const s of meta.sites) sites.append(checkbox('site', String(s.siteId), s.name, params.sites.includes(s.siteId), siteEmoji(s.code)));

    const vars = el('fieldset', 'group');
    vars.append(el('legend', undefined, 'Variables'));
    for (const v of VARIABLES) vars.append(checkbox('variable', v, VARIABLE_LABELS[v], params.variables.includes(v)));

    const years: Array<[string, string]> = [['', 'All']];
    for (let y = meta.yearMin; y <= meta.yearMax; y++) years.push([String(y), String(y)]);
    const other = el('fieldset', 'group');
    other.append(
      el('legend', undefined, 'Range and step'),
      select('yearFrom', 'From year', years, params.yearFrom === null ? '' : String(params.yearFrom)),
      select('yearTo', 'To year', years, params.yearTo === null ? '' : String(params.yearTo)),
      select(
        'aggregation',
        'Step',
        AGGREGATIONS.map((a) => [a, AGGREGATION_LABELS[a]]),
        params.aggregation,
      ),
      select(
        'xVariable',
        'X variable (scatter)',
        VARIABLES.map((v) => [v, VARIABLE_LABELS[v]]),
        params.xVariable,
      ),
    );

    this.form.replaceChildren(sites, vars, other);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(this.read()), DEBOUNCE_MS);
  }

  /** Read the form values. The state module checks them again. */
  private read(): ViewParams {
    const fd = new FormData(this.form);
    const year = (name: string) => {
      const v = String(fd.get(name) ?? '');
      return v === '' ? null : Number(v);
    };
    let yearFrom = year('yearFrom');
    let yearTo = year('yearTo');
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
    return {
      sites: fd.getAll('site').map(Number),
      variables: fd.getAll('variable').map(String) as Variable[],
      xVariable: String(fd.get('xVariable')) as Variable,
      yearFrom,
      yearTo,
      aggregation: String(fd.get('aggregation')) as Aggregation,
    };
  }
}
