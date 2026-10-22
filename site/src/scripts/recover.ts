// Error recovery: an error box with a "Clear site data and reload" button and
// the hard reload shortcut for the operating system of the user.
// reloadShortcut() takes the platform and the user agent as arguments, so that the
// unit test (recover.test.ts) can run it in Node.

/** Prefix of all Web storage keys of the site (state.ts STORAGE_KEY, BACKUP_KEY). */
export const STORAGE_PREFIX = 'inar-agri.';

/**
 * Hard reload shortcut. `keys` is a list of key combinations (each one a list of keys),
 * or null when the device has no keyboard shortcut (phone, tablet): then `text` tells what to do.
 */
export interface ReloadShortcut {
  keys: string[][] | null;
  text: string;
}

/**
 * Keys of the hard reload for a platform string (navigator.userAgentData.platform or
 * navigator.platform), a user agent and navigator.maxTouchPoints.
 */
export function reloadShortcut(platform: string, userAgent: string, maxTouchPoints = 0): ReloadShortcut {
  const p = platform.toLowerCase();
  const ua = userAgent.toLowerCase();
  // iPadOS 13+ sends the macOS platform and user agent. Only the touch points show the iPad.
  const ipad = p.startsWith('mac') && maxTouchPoints > 1;
  const mobile = ipad || /android|iphone|ipad|ipod|mobile/.test(ua) || /^(ios|android|iphone|ipad)/.test(p);
  if (mobile) {
    return { keys: null, text: 'close the tab and open the page again' };
  }
  const mac = p.startsWith('mac') || (p === '' && ua.includes('mac os x'));
  if (mac) {
    // Safari: the user agent has "Safari" but not the names of the Chromium and Firefox browsers.
    const safari = ua.includes('safari') && !/chrome|chromium|crios|fxios|firefox|edg|opr\//.test(ua);
    if (safari) return { keys: [['⌥ Option', '⌘ Cmd', 'R']], text: '⌥ Option + ⌘ Cmd + R' };
    return { keys: [['⌘ Cmd', '⇧ Shift', 'R']], text: '⌘ Cmd + ⇧ Shift + R' };
  }
  // Windows, Linux, ChromeOS and all other desktop systems.
  return { keys: [['Ctrl', 'Shift', 'R'], ['Ctrl', 'F5']], text: 'Ctrl + Shift + R or Ctrl + F5' };
}

/** The shortcut for this browser. */
export function currentReloadShortcut(): ReloadShortcut {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return reloadShortcut(nav.userAgentData?.platform || nav.platform || '', nav.userAgent, nav.maxTouchPoints ?? 0);
}

/** Put the shortcut into an element: one <kbd> per key, "+" between keys, "or" between combinations. */
export function appendShortcut(parent: HTMLElement, shortcut: ReloadShortcut): void {
  if (!shortcut.keys) {
    parent.append(shortcut.text);
    return;
  }
  shortcut.keys.forEach((combo, i) => {
    if (i > 0) parent.append(' or ');
    combo.forEach((key, j) => {
      if (j > 0) parent.append(' + ');
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      parent.append(kbd);
    });
  });
}

/** Remove the keys of the site from one storage. Storage can be blocked: then do nothing. */
function clearStorage(get: () => Storage): void {
  try {
    const storage = get();
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch (err) {
    console.warn('Cannot clear the Web storage.', err);
  }
}

/**
 * Delete the site data: the saved views (all localStorage and sessionStorage keys with the
 * prefix "inar-agri.", also the backup), the Cache Storage and the service workers.
 * Each step continues when a step before fails.
 */
export async function clearSiteData(): Promise<void> {
  clearStorage(() => window.localStorage);
  clearStorage(() => window.sessionStorage);
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch (err) {
    console.warn('Cannot clear the Cache Storage.', err);
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (err) {
    console.warn('Cannot remove the service workers.', err);
  }
}

/** Error text of an unknown value. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Show the error in `statusEl` (the #status element of the data page, role="status") and
 * put the recovery box after it. The box does not repeat the message. A second call replaces the box.
 */
export function showRecovery(statusEl: HTMLElement, err: unknown): HTMLElement {
  statusEl.textContent = `Cannot show the data: ${errorText(err)}`;
  statusEl.classList.add('error');
  document.getElementById('recovery')?.remove();
  const box = document.createElement('section');
  box.id = 'recovery';
  box.className = 'recovery';
  box.setAttribute('aria-label', 'Recover from the error');

  const help = document.createElement('p');
  help.textContent = 'Clear the saved views and the cache, then reload the page.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'recovery-button';
  btn.textContent = 'Clear site data and reload';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await clearSiteData();
    window.location.reload();
  });

  const note = document.createElement('p');
  note.className = 'recovery-note';
  note.textContent = 'This deletes your saved views and tabs in this browser.';

  box.append(help, btn, note, hardReloadLine());
  statusEl.after(box);
  return box;
}

/**
 * One line with the hard reload shortcut. Use tag 'span' in a <p> (the error note of a diagram card).
 */
export function hardReloadLine(tag: 'p' | 'span' = 'p'): HTMLElement {
  const p = document.createElement(tag);
  p.className = 'recovery-hard';
  p.append('If the error stays, do a hard reload: ');
  appendShortcut(p, currentReloadShortcut());
  p.append('.');
  return p;
}
