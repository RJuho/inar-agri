// Parameter form of the active view: sites, variables, years, aggregation and x variable.
// All diagrams of the view use these parameters.
import type { Meta } from '../db';
import { siteEmoji } from '../sites';
import {
  AGGREGATION_LABELS,
  AGGREGATIONS,
  VARIABLE_GROUPS,
  VARIABLE_LABELS,
  VARIABLE_SITES,
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

function checkbox(name: string, value: string, label: string, checked: boolean, emoji = '', hint = ''): HTMLLabelElement {
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
  if (hint) {
    // The hint comes after the label text, thus the accessible name starts with the label.
    // One span for both, thus they wrap as one text.
    const text = el('span', 'check-text', label);
    text.append(el('small', 'var-sites', ` · ${hint}`));
    wrap.append(text);
  } else {
    wrap.append(document.createTextNode(label));
  }
  return wrap;
}

type Options = Array<[string, string]>;

function options(parent: HTMLSelectElement | HTMLOptGroupElement, items: Options): void {
  for (const [v, text] of items) {
    const o = el('option', undefined, text);
    o.value = v;
    parent.append(o);
  }
}

/** A select field. Items with a label and options go into an <optgroup>. */
function select(
  name: string,
  label: string,
  items: Options | Array<{ label: string; options: Options }>,
  value: string,
): HTMLLabelElement {
  const wrap = el('label', 'field');
  const s = el('select');
  s.name = name;
  for (const item of items) {
    if (Array.isArray(item)) {
      options(s, [item]);
    } else {
      const g = el('optgroup');
      g.label = item.label;
      options(g, item.options);
      s.append(g);
    }
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

    const vars = el('fieldset', 'group vars');
    const varGroups = el('div', 'var-groups');
    vars.append(el('legend', undefined, 'Variables'), varGroups);
    for (const group of VARIABLE_GROUPS) varGroups.append(this.variableGroup(group.label, group.variables, params.variables));

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
        VARIABLE_GROUPS.map((g) => ({ label: g.label, options: g.variables.map((v): [string, string] => [v, VARIABLE_LABELS[v]]) })),
        params.xVariable,
      ),
    );

    this.form.replaceChildren(sites, vars, other);
  }

  /** One group of variable checkboxes, with "All" and "None" buttons. */
  private variableGroup(label: string, variables: readonly Variable[], selected: readonly Variable[]): HTMLFieldSetElement {
    const box = el('fieldset', 'var-group');
    box.append(el('legend', undefined, label));

    const tools = el('div', 'var-group-tools');
    const list = el('div', 'var-list');
    const button = (text: string, aria: string, checked: boolean) => {
      const b = el('button', 'var-group-btn', text);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => {
        for (const input of list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) input.checked = checked;
        // Same path as a click on a checkbox: the form listens for "change".
        list.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return b;
    };
    tools.append(
      button('All', `Select all ${label} variables`, true),
      button('None', `Clear all ${label} variables`, false),
    );

    for (const v of variables) {
      const item = checkbox('variable', v, VARIABLE_LABELS[v], selected.includes(v), '', VARIABLE_SITES[v]);
      const info = this.meta.variables.get(v);
      if (info) {
        const unit = info.unit ? ` Unit: ${info.unit}.` : '';
        const title = `${info.description ?? ''}${unit}`.trim();
        if (title) item.title = title;
      }
      list.append(item);
    }
    box.append(tools, list);
    return box;
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
