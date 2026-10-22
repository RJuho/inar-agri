// Update check: tell the user when a new build of the site is online.
// The build writes /version.json (site/astro.config.mjs). The page compares its `time`
// with __BUILD_TIME__ of the loaded code. The check runs 5 s after the load, then every
// 5 minutes while the page is visible, and at once when the computer wakes up or the
// user comes back to the tab. All errors (offline, 404 in `astro dev`) are silent.

/** Time between two checks. Long, to save battery. */
const CHECK_MS = 300_000;
/** First check after the page load. */
const FIRST_MS = 5_000;
/** No new check when the last one is less old than this. */
const MIN_GAP_MS = 30_000;

const NOTICE_TEXT = 'A new version of this site is available. Reload the page to use it. Your saved views stay.';

let started = false;
let found = false;
let lastCheck = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let notice: HTMLElement | null = null;

function versionUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return new URL(`${base}version.json?t=${Date.now()}`, window.location.href).toString();
}

/** Show the notice at the bottom of the page. The focus does not move to it. */
function showNotice(): void {
  found = true;
  if (timer !== undefined) clearInterval(timer);
  if (notice) {
    notice.hidden = false;
    return;
  }
  notice = document.createElement('div');
  notice.className = 'update-notice';
  notice.setAttribute('role', 'status');

  const text = document.createElement('p');
  text.textContent = NOTICE_TEXT;

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'update-reload';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => window.location.reload());

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'update-later';
  later.textContent = 'Later';
  // Hide the notice until the next page load.
  later.addEventListener('click', () => {
    if (notice) notice.hidden = true;
  });

  const actions = document.createElement('div');
  actions.className = 'update-actions';
  actions.append(reload, later);
  notice.append(text, actions);
  document.body.append(notice);
}

/** Read /version.json and compare the build time. `force` ignores the 30 s gap. */
async function check(force = false): Promise<void> {
  if (found || document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (!force && now - lastCheck < MIN_GAP_MS) return;
  lastCheck = now;
  try {
    const res = await fetch(versionUrl(), { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { time?: unknown };
    if (typeof body.time === 'number' && body.time !== __BUILD_TIME__) showNotice();
  } catch {
    // Offline or a bad file: try again at the next check.
  }
}

/** Start the update check one time per page. */
export function startUpdateCheck(): void {
  if (started) return;
  started = true;

  // An old page can request a code file that the new deploy removed. Vite then sends this event.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    showNotice();
  });

  setTimeout(() => void check(true), FIRST_MS);

  // Timers stop while the computer sleeps. A tick that comes much too late means a wake-up.
  let lastTick = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const late = now - lastTick > 2 * CHECK_MS;
    lastTick = now;
    void check(late);
  }, CHECK_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  // Page from the back-forward cache.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void check(true);
  });
  window.addEventListener('online', () => void check());
}
