// Tab list: one tab per view, and the buttons New, Copy, Rename, Delete, Copy link, Download all
// and Download data (menu).
import type { DataFormat, DataScope } from '../dataexport';
import { activeView, canAddView, type Store } from '../state';
import { DataMenu } from './dataMenu';

export interface TabActions {
  activate(id: string): void;
  addEmpty(): void;
  copy(): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  copyLink(): void;
  /** Download one PNG image with all diagrams of the selected view. */
  downloadAll(): void;
  /** Make and save the data of the selected view. The promise ends when the file is saved. */
  downloadData(scope: DataScope, format: DataFormat): Promise<void>;
}

function button(text: string, cls: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export class Tabs {
  /** Id of the view whose name is in edit mode, or null. */
  private renaming: string | null = null;
  private store: Store | null = null;
  /** The menu stays the same element across renders, so that its state (open, busy) stays. */
  private readonly dataMenu: DataMenu;
  /** True while the diagrams load after a parameter change: all buttons are disabled. */
  private busy = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly actions: TabActions,
  ) {
    this.dataMenu = new DataMenu((scope, format) => this.actions.downloadData(scope, format));
  }

  render(store: Store): void {
    this.store = store;
    const list = document.createElement('div');
    list.className = 'tab-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Views');

    for (const view of store.views) {
      const active = view.id === store.activeId;
      if (active && this.renaming === view.id) {
        list.append(this.renameInput(view.id, view.name));
        continue;
      }
      const tab = button(view.name, 'tab', () => this.actions.activate(view.id));
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      tab.dataset.id = view.id;
      tab.tabIndex = active ? 0 : -1;
      tab.addEventListener('dblclick', () => this.startRename(view.id));
      tab.addEventListener('keydown', (e) => this.onTabKey(e, view.id));
      list.append(tab);
    }

    const tools = document.createElement('div');
    tools.className = 'tab-tools';
    const full = !canAddView(store);
    const add = button('New', 'tab-action', () => this.actions.addEmpty(), 'Add a new empty view');
    const copy = button('Copy', 'tab-action', () => this.actions.copy(), 'Copy the selected view');
    add.disabled = full;
    copy.disabled = full;
    const rename = button('Rename', 'tab-action', () => this.startRename(store.activeId), 'Rename the selected view');
    const del = button('Delete', 'tab-action', () => this.actions.remove(store.activeId), 'Delete the selected view');
    del.disabled = store.views.length <= 1;
    const link = button('Copy link', 'tab-action', () => this.actions.copyLink(), 'Copy a link to the selected view');
    add.dataset.action = 'new';
    copy.dataset.action = 'copy';
    rename.dataset.action = 'rename';
    del.dataset.action = 'delete';
    const all = button('Download all', 'tab-action', () => this.actions.downloadAll(), 'Download all diagrams of the selected view as one PNG image');
    all.disabled = activeView(store).diagrams.length === 0;
    link.dataset.action = 'link';
    all.dataset.action = 'png-all';
    const params = activeView(store).params;
    this.dataMenu.setEnabled(!this.busy && params.sites.length > 0 && params.variables.length > 0);
    tools.append(add, copy, rename, del, link, all, this.dataMenu.el);
    if (this.busy) {
      for (const b of [...list.querySelectorAll('button'), add, copy, rename, del, link, all]) b.disabled = true;
      this.el.setAttribute('aria-busy', 'true');
    } else {
      this.el.removeAttribute('aria-busy');
    }

    this.el.replaceChildren(list, tools);
    if (this.renaming) {
      const input = this.el.querySelector<HTMLInputElement>('input.tab-rename');
      input?.focus();
      input?.select();
    }
  }

  /** Turn the busy state on or off and draw the tabs again. */
  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    if (this.store) this.render(this.store);
  }

  private startRename(id: string): void {
    if (!this.store) return;
    if (this.store.activeId !== id) this.actions.activate(id);
    this.renaming = id;
    this.render(this.store);
  }

  private renameInput(id: string, name: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename';
    input.value = name;
    input.maxLength = 80;
    input.setAttribute('aria-label', 'View name');
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (save && input.value.trim() !== '') this.actions.rename(id, input.value);
      else if (this.store) this.render(this.store);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    return input;
  }

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern). */
  private onTabKey(e: KeyboardEvent, id: string): void {
    if (!this.store) return;
    const ids = this.store.views.map((v) => v.id);
    const i = ids.indexOf(id);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'F2') {
      this.startRename(id);
      return;
    }
    if (j < 0) return;
    e.preventDefault();
    const next = ids[j];
    if (next === undefined) return;
    this.actions.activate(next);
    this.el.querySelector<HTMLButtonElement>(`.tab[data-id="${next}"]`)?.focus();
  }
}
