// "Download data" button and its menu (WAI-ARIA menu button pattern).
// The menu has six items: all sites in one file or one file per site (ZIP),
// each as Parquet, CSV or Excel (XLSX).
// Keys: Enter, Space or Arrow Down open the menu on the first item, Arrow Up on the last item.
// In the menu, Arrow Up and Arrow Down move (with wrap), Home and End go to the ends,
// Escape closes the menu and puts the focus on the button, Tab closes the menu.
// A click outside the menu closes it.
import type { DataFormat, DataScope } from '../dataexport';

export type PickData = (scope: DataScope, format: DataFormat) => Promise<void>;

interface ItemDef {
  scope: DataScope;
  format: DataFormat;
  text: string;
  ext: string;
}

const GROUPS: Array<{ label: string; items: ItemDef[] }> = [
  {
    label: 'All sites in one file',
    items: [
      { scope: 'one', format: 'parquet', text: 'Parquet', ext: '.parquet' },
      { scope: 'one', format: 'csv', text: 'CSV', ext: '.csv' },
      { scope: 'one', format: 'xlsx', text: 'Excel', ext: '.xlsx' },
    ],
  },
  {
    label: 'One file per site (ZIP)',
    items: [
      { scope: 'sites', format: 'parquet', text: 'Parquet', ext: '.zip' },
      { scope: 'sites', format: 'csv', text: 'CSV', ext: '.zip' },
      { scope: 'sites', format: 'xlsx', text: 'Excel', ext: '.zip' },
    ],
  },
];

let menuSeq = 0;

export class DataMenu {
  readonly el: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly menu: HTMLDivElement;
  private readonly items: HTMLButtonElement[] = [];
  private busy = false;
  private enabled = true;

  constructor(private readonly pick: PickData) {
    const id = `data-menu-${++menuSeq}`;
    this.el = document.createElement('div');
    this.el.className = 'data-menu';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'tab-action';
    this.button.dataset.action = 'data';
    this.button.id = `${id}-button`;
    this.button.textContent = 'Download data';
    this.button.title = 'Download the data of the selected view as Parquet, CSV or Excel';
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', id);
    this.button.addEventListener('click', () => (this.isOpen() ? this.close(false) : this.open(0)));
    this.button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.open(e.key === 'ArrowDown' ? 0 : -1);
      }
    });

    this.menu = document.createElement('div');
    this.menu.className = 'menu';
    this.menu.id = id;
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-labelledby', this.button.id);
    this.menu.hidden = true;
    for (const g of GROUPS) {
      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', g.label);
      const head = document.createElement('div');
      head.className = 'menu-label';
      head.setAttribute('aria-hidden', 'true');
      head.textContent = g.label;
      group.append(head);
      for (const def of g.items) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'menu-item';
        item.setAttribute('role', 'menuitem');
        item.tabIndex = -1;
        item.dataset.export = `${def.scope}-${def.format}`;
        const name = document.createElement('span');
        name.textContent = def.text;
        const ext = document.createElement('span');
        ext.className = 'menu-ext';
        ext.textContent = def.ext;
        item.append(name, ext);
        item.addEventListener('click', () => void this.run(def));
        group.append(item);
        this.items.push(item);
      }
      this.menu.append(group);
    }
    this.menu.addEventListener('keydown', (e) => this.onMenuKey(e));
    this.el.append(this.button, this.menu);

    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen() && !this.el.contains(e.target as Node)) this.close(false);
    });
  }

  /** Enable or disable the button, for example when the view has no site. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.update();
  }

  private update(): void {
    this.button.disabled = !this.enabled || this.busy;
    if (this.busy) this.button.setAttribute('aria-busy', 'true');
    else this.button.removeAttribute('aria-busy');
    this.button.textContent = this.busy ? 'Making file…' : 'Download data';
    if (this.button.disabled) this.close(false);
  }

  private isOpen(): boolean {
    return !this.menu.hidden;
  }

  /** Open the menu and put the focus on item `index` (-1 = last item). */
  private open(index: number): void {
    if (this.button.disabled) return;
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    // Open to the right side when the menu does not fit on the left of the button end.
    this.menu.classList.remove('menu-start');
    if (this.menu.getBoundingClientRect().left < 8) this.menu.classList.add('menu-start');
    this.focusItem(index < 0 ? this.items.length - 1 : index);
  }

  private close(focusButton: boolean): void {
    if (!this.isOpen()) return;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (focusButton) this.button.focus();
  }

  private focusItem(i: number): void {
    const n = this.items.length;
    this.items[((i % n) + n) % n]?.focus();
  }

  private onMenuKey(e: KeyboardEvent): void {
    const i = this.items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') this.focusItem(i + 1);
    else if (e.key === 'ArrowUp') this.focusItem(i - 1);
    else if (e.key === 'Home') this.focusItem(0);
    else if (e.key === 'End') this.focusItem(-1);
    else if (e.key === 'Escape') this.close(true);
    else if (e.key === 'Tab') {
      this.close(false);
      return;
    } else return;
    e.preventDefault();
  }

  private async run(def: ItemDef): Promise<void> {
    this.close(true);
    this.busy = true;
    this.update();
    try {
      await this.pick(def.scope, def.format);
    } finally {
      this.busy = false;
      this.update();
      this.button.focus();
    }
  }
}
