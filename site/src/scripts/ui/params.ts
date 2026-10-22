// Parameter form of the active view: sites, variables, events, period, aggregation and x variable.
// All diagrams of the view use these parameters.
import type { Meta } from '../db';
import { siteEmoji } from '../sites';
import { MONTH_NAMES } from '../diagrams/common';
import { GLOSSARY, citeShort } from '../glossary';
import {
  AGGREGATION_LABELS,
  AGGREGATIONS,
  VARIABLE_GROUPS,
  VARIABLE_LABELS,
  VARIABLE_SITES,
  orderRange,
  type Aggregation,
  type Variable,
  type ViewParams,
} from '../state';

/** Wait time after the last change before the diagrams are drawn again. */
const DEBOUNCE_MS = 300;

/** Base path of the site, with a slash at the end (same as db.ts). */
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * One variable: the checkbox label, an info button and the summary text (hidden at start).
 * The button is not in the label, thus a click on it does not change the checkbox.
 * A button has no "change" event and FormData ignores it, thus the form does not see the click.
 */
function variableItem(v: Variable, label: HTMLLabelElement): HTMLDivElement {
  const item = el('div', 'var-item');
  const id = `var-info-${v}`;
  const entry = GLOSSARY[v];

  const btn = el('button', 'var-info-btn', 'ⓘ');
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', id);
  btn.setAttribute('aria-label', `About ${VARIABLE_LABELS[v]}`);

  const info = el('p', 'var-info');
  info.id = id;
  info.hidden = true;
  info.append(document.createTextNode(entry.summary));
  const cite = citeShort(entry.sources);
  if (cite) info.append(' ', el('span', 'var-cite', cite));
  const more = el('a', 'var-more', 'All terms');
  more.href = `${BASE}variables/#var-${v}`;
  info.append(' ', more);

  btn.addEventListener('click', () => {
    info.hidden = !info.hidden;
    btn.setAttribute('aria-expanded', String(!info.hidden));
  });

  item.append(label, btn, info);
  return item;
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
  /** Live region for "Updating diagrams…". */
  private readonly statusEl: HTMLParagraphElement;
  /** The control of the last change. The focus goes back to it after the busy state. */
  private lastControl: HTMLElement | null = null;
  private busy = false;

  constructor(
    host: HTMLElement,
    private readonly meta: Meta,
    private readonly onChange: (params: ViewParams) => void,
  ) {
    this.form = el('form', 'params');
    this.form.setAttribute('aria-label', 'Data parameters');
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.form.addEventListener('change', (e) => {
      // The All / None buttons send "change" from the list. Then the focused button is the control.
      const t = e.target;
      this.lastControl =
        t instanceof HTMLInputElement || t instanceof HTMLSelectElement
          ? t
          : document.activeElement instanceof HTMLElement && this.form.contains(document.activeElement)
            ? document.activeElement
            : null;
      this.schedule();
    });
    this.statusEl = el('p', 'params-status');
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    host.replaceChildren(this.form, this.statusEl);
  }

  /**
   * Busy state while the diagrams load after a parameter change: the controls are disabled,
   * the form has aria-busy and the live region says "Updating diagrams…". At the end, the focus
   * goes back to the changed control, if the focus is not on an other element.
   */
  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    this.applyBusy();
    this.statusEl.textContent = busy ? 'Updating diagrams…' : '';
    if (!busy) {
      const active = document.activeElement;
      const lost = active === null || active === document.body || this.form.contains(active);
      if (lost && this.lastControl?.isConnected) this.lastControl.focus();
    }
  }

  private applyBusy(): void {
    for (const fs of this.form.querySelectorAll<HTMLFieldSetElement>(':scope > fieldset')) fs.disabled = this.busy;
    if (this.busy) this.form.setAttribute('aria-busy', 'true');
    else this.form.removeAttribute('aria-busy');
    this.form.classList.toggle('busy', this.busy);
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
    const events = el('div', 'var-events');
    events.append(checkbox('events', 'on', 'Events', params.events, '', 'Management events (harvest, sowing, ...) as markers'));
    events.append(checkbox('emojis', 'on', 'Site emojis', params.emojis, '', 'Emoji before the site name in the charts and the alt text'));
    events.append(
      checkbox('fixedY', 'on', 'Fixed y range (all data)', params.fixedY, '', 'Same y range for each export: the minimum and maximum of all sites and years'),
    );
    vars.append(events);

    const years: Array<[string, string]> = [['', 'All']];
    for (let y = meta.yearMin; y <= meta.yearMax; y++) years.push([String(y), String(y)]);
    const months: Options = [['', 'All'], ...MONTH_NAMES.map((m, i): [string, string] => [String(i + 1), m])];
    const monthValue = (m: number | null) => (m === null ? '' : String(m));
    const other = el('fieldset', 'group');
    other.append(
      el('legend', undefined, 'Range and step'),
      select('yearFrom', 'From year', years, params.yearFrom === null ? '' : String(params.yearFrom)),
      select('monthFrom', 'From month', months, monthValue(params.monthFrom)),
      select('yearTo', 'To year', years, params.yearTo === null ? '' : String(params.yearTo)),
      select('monthTo', 'To month', months, monthValue(params.monthTo)),
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
    this.applyBusy();
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
      list.append(variableItem(v, item));
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
    const num = (name: string) => {
      const v = String(fd.get(name) ?? '');
      return v === '' ? null : Number(v);
    };
    const range = orderRange({ yearFrom: num('yearFrom'), yearTo: num('yearTo'), monthFrom: num('monthFrom'), monthTo: num('monthTo') });
    return {
      sites: fd.getAll('site').map(Number),
      variables: fd.getAll('variable').map(String) as Variable[],
      xVariable: String(fd.get('xVariable')) as Variable,
      yearFrom: range.yearFrom,
      yearTo: range.yearTo,
      monthFrom: range.monthFrom,
      monthTo: range.monthTo,
      aggregation: String(fd.get('aggregation')) as Aggregation,
      events: fd.get('events') === 'on',
      emojis: fd.get('emojis') === 'on',
      fixedY: fd.get('fixedY') === 'on',
    };
  }
}
