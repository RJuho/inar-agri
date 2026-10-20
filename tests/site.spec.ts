// End-to-end tests for the first page of the data website.
import { test, expect, type Page } from '@playwright/test';
import { DuckDBInstance } from '@duckdb/node-api';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const OBS_FILE = 'db/observations.parquet';
const READY_TIMEOUT = 60_000;

/** Count the rows in the Parquet file with DuckDB, so that the test does not hard-code the value. */
async function parquetRowCount(path: string): Promise<number> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const reader = await conn.runAndReadAll(`SELECT count(*)::INTEGER AS n FROM read_parquet('${path}')`);
    return Number(reader.getRowObjects()[0]?.n);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

/** Collect console errors and page errors during the test. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.describe('first page', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await page.goto('/');
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'ready', { timeout: READY_TIMEOUT });
  });

  test('loads without console errors or page errors', async () => {
    expect(errors).toEqual([]);
  });

  test('shows all rows of observations.parquet', async ({ page }) => {
    const expected = await parquetRowCount(OBS_FILE);
    expect(expected).toBeGreaterThan(0);
    await expect(page.locator('#chart')).toHaveAttribute('data-rows', String(expected));
  });

  test('draws 30 series (5 panels x 6 sites)', async ({ page }) => {
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '30');
  });

  test('shows a visible canvas', async ({ page }) => {
    await expect(page.locator('#chart canvas').first()).toBeVisible();
  });

  test('first view is "All data" with one time series diagram', async ({ page }) => {
    await expect(page.getByRole('tab')).toHaveText(['All data']);
    await expect(page.locator('.diagram')).toHaveCount(1);
    await expect(page.locator('.diagram')).toHaveAttribute('data-type', 'timeseries');
    await expect(page.locator('.diagram')).toHaveAttribute('data-series', '30');
  });

  test('legend click hides a site', async ({ page }) => {
    const chart = page.locator('#chart .diagram-chart').first();
    // Read the name of the first legend item from the ECharts instance (test hook in ui/diagrams.ts).
    const firstName = await chart.evaluate((el) => {
      const c = (el as unknown as { __chart: { getOption(): { legend: Array<{ data: string[] }> } } }).__chart;
      return c.getOption().legend[0]?.data[0] ?? '';
    });
    expect(firstName).not.toBe('');

    const selected = () =>
      chart.evaluate((el, name) => {
        const c = (el as unknown as { __chart: { getOption(): { legend: Array<{ selected?: Record<string, boolean> }> } } })
          .__chart;
        return c.getOption().legend[0]?.selected?.[name] ?? true;
      }, firstName);

    expect(await selected()).toBe(true);
    // The first legend item is at the top left of the chart element (legend left = 48 px, top = 0,
    // padding = 5 px). The option in diagrams/timeseries.ts sets this position. Click on the label text.
    await chart.click({ position: { x: 85, y: 13 } });
    await expect.poll(selected).toBe(false);
    // A second click shows the site again.
    await chart.click({ position: { x: 85, y: 13 } });
    await expect.poll(selected).toBe(true);
  });

  test('full-page screenshot', async ({ page }) => {
    await page.screenshot({ path: 'test-results/site-full-page.png', fullPage: true });
  });
});

/** Wait until all diagrams of the active view are drawn. */
async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('#chart')).toHaveAttribute('data-status', /^(ready|empty)$/, { timeout: READY_TIMEOUT });
}

/** Encode a view for the URL hash, the same way as state.ts does. */
function viewHash(view: unknown): string {
  return '#view=' + Buffer.from(JSON.stringify(view), 'utf8').toString('base64url');
}

test.describe('views and diagrams', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('new, copy, rename and delete tabs; tabs stay after reload', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const tabs = page.getByRole('tab');

    // New: an empty view with a hint and no diagrams.
    await page.locator('[data-action="new"]').click();
    await expect(tabs).toHaveText(['All data', 'New view']);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('New view');
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'empty');
    await expect(page.locator('.diagram')).toHaveCount(0);
    await expect(page.locator('#chart .hint')).toBeVisible();

    // Copy: the copy has the diagrams of the selected view.
    await tabs.filter({ hasText: 'All data' }).click();
    await waitReady(page);
    await page.locator('[data-action="copy"]').click();
    await expect(tabs).toHaveText(['All data', 'All data (copy)', 'New view']);
    await waitReady(page);
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '30');

    // Rename the copy.
    await page.locator('[data-action="rename"]').click();
    const input = page.locator('input.tab-rename');
    await input.fill('Renamed view');
    await input.press('Enter');
    await expect(tabs).toHaveText(['All data', 'Renamed view', 'New view']);

    // Delete the empty view.
    await tabs.filter({ hasText: 'New view' }).click();
    await page.locator('[data-action="delete"]').click();
    await expect(tabs).toHaveText(['All data', 'Renamed view']);

    // Reload: the tabs and the selected tab come back from localStorage.
    await page.reload();
    await waitReady(page);
    await expect(tabs).toHaveText(['All data', 'Renamed view']);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Renamed view');
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '30');
  });

  test('add, move and remove diagrams', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.locator('[data-action="new"]').click();
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'empty');

    // The list shows the registered types.
    const options = await page.locator('#add-diagram option').allTextContents();
    expect(options).toContain('Time series');

    await page.locator('#add-diagram').selectOption('timeseries');
    await expect(page.locator('.diagram')).toHaveCount(1);
    await waitReady(page);
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '30');
    await expect(page.locator('.diagram').first()).toHaveAttribute('data-status', 'ready');

    await page.locator('#add-diagram').selectOption('timeseries');
    await expect(page.locator('.diagram')).toHaveCount(2);
    await waitReady(page);
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '60');

    // Move the second diagram up. The ids change places.
    const ids = await page.locator('.diagram').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    await page.locator('.diagram').nth(1).getByRole('button', { name: 'Move diagram up' }).click();
    const moved = await page.locator('.diagram').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    expect(moved).toEqual([ids[1], ids[0]]);

    await page.locator('.diagram').first().getByRole('button', { name: 'Remove diagram' }).click();
    await expect(page.locator('.diagram')).toHaveCount(1);
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '30');
  });

  test('parameter changes update the diagram', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const chart = page.locator('#chart');
    const rowsAll = Number(await chart.getAttribute('data-rows'));

    // Remove one site: 5 variables x 5 sites.
    await page.locator('input[name="site"]').first().uncheck();
    await expect(chart).toHaveAttribute('data-series', '25');
    await waitReady(page);

    // Remove one variable: 4 variables x 5 sites.
    await page.locator('input[name="variable"][value="nee"]').uncheck();
    await expect(chart).toHaveAttribute('data-series', '20');
    await waitReady(page);

    // Daily means: fewer rows than raw data.
    await page.locator('select[name="aggregation"]').selectOption('day');
    await waitReady(page);
    await expect.poll(async () => Number(await chart.getAttribute('data-rows'))).toBeLessThan(rowsAll / 10);

    // The parameters stay after reload.
    await page.reload();
    await waitReady(page);
    await expect(chart).toHaveAttribute('data-series', '20');
    await expect(page.locator('select[name="aggregation"]')).toHaveValue('day');
  });

  test('bad localStorage value gives the default view and a backup', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('inar-agri.views', '{"version":1,"views":"bad"');
      }
    });
    await page.goto('/');
    await waitReady(page);
    await expect(page.getByRole('tab')).toHaveText(['All data']);
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '30');
    const stored = await page.evaluate(() => ({
      bak: localStorage.getItem('inar-agri.views.bak'),
      views: JSON.parse(localStorage.getItem('inar-agri.views') ?? 'null') as { version: number },
    }));
    expect(stored.bak).toBe('{"version":1,"views":"bad"');
    expect(stored.views.version).toBe(1);
  });

  test('URL hash imports a view as a new tab, one time only', async ({ page }) => {
    const view = {
      id: 'linked1',
      name: 'Linked view',
      params: { sites: [1, 2], variables: ['ta', 'swc'], xVariable: 'ta', yearFrom: 2022, yearTo: 2023, aggregation: 'day' },
      diagrams: [{ id: 'd1', type: 'timeseries' }],
    };
    await page.goto('/' + viewHash(view));
    await waitReady(page);
    await expect(page.getByRole('tab')).toHaveText(['All data', 'Linked view']);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Linked view');
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '4');
    await expect(page.locator('select[name="yearFrom"]')).toHaveValue('2022');
    // The page removes the hash. The same link again activates the existing tab.
    expect(new URL(page.url()).hash).toBe('');
    await page.locator('.tab').first().click();
    await page.goto('/' + viewHash(view));
    await waitReady(page);
    await expect(page.getByRole('tab')).toHaveText(['All data', 'Linked view']);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Linked view');
  });
});

const ALL_TYPES = ['timeseries', 'years', 'yearPanels', 'monthly', 'diurnal', 'scatter', 'cumulative'] as const;
const SITE_NAMES = ['Anttila', 'Särkisuo', 'Haltiala', 'Qvidja', 'Viikki', 'Maktau'];

/** A view with one diagram of `type`. */
function typeView(type: string, variables: string[] = ['nee_f', 'ta'], aggregation = 'raw') {
  return {
    id: `t-${type}`,
    name: `Type ${type}`,
    params: { sites: [1, 2, 3, 4, 5, 6], variables, xVariable: 'ta', yearFrom: null, yearTo: null, aggregation },
    diagrams: [{ id: 'd1', type }],
  };
}

test.describe('diagram types', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('the add list shows all diagram types', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const values = await page.locator('#add-diagram option').evaluateAll((els) => els.map((e) => e.getAttribute('value') ?? ''));
    for (const t of ALL_TYPES) expect(values).toContain(t);
  });

  for (const type of ALL_TYPES) {
    test(`${type} reaches ready with series and alt text`, async ({ page }) => {
      await page.goto('/' + viewHash(typeView(type)));
      await waitReady(page);
      const card = page.locator('.diagram');
      await expect(card).toHaveAttribute('data-type', type);
      await expect(card).toHaveAttribute('data-status', 'ready');
      expect(Number(await card.getAttribute('data-series'))).toBeGreaterThan(0);
      expect(Number(await card.getAttribute('data-rows'))).toBeGreaterThan(0);
      await expect(card.locator('canvas').first()).toBeVisible();

      // Alt text: in the figcaption, as aria-label of the chart element and from the page hook.
      const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
      expect(alt).toContain('NEE, gap-filled');
      for (const name of SITE_NAMES) expect(alt).toContain(name);
      await expect(card.locator('.diagram-chart')).toHaveAttribute('role', 'img');
      await expect(card.locator('.diagram-chart')).toHaveAttribute('aria-label', alt);
      const hook = await page.evaluate(() => (globalThis as unknown as { __inar: { altText(t: number): string } }).__inar.altText(0));
      expect(hook).toBe(alt);
      await expect(card.getByRole('button', { name: 'Copy the alt text' })).toBeVisible();
    });
  }

  test('years types show raw data as daily means', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('yearPanels')));
    await waitReady(page);
    await expect(page.locator('.diagram-sub')).toContainText('daily means');
  });

  test('cumulative without NEE shows a note, not an error', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('cumulative', ['ta', 'swc'])));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(card).toHaveAttribute('data-series', '0');
    await expect(card.locator('.diagram-note')).toContainText('needs the variable');
  });

  test('scatter with only the x variable shows a note', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('scatter', ['ta'])));
    await waitReady(page);
    await expect(page.locator('.diagram')).toHaveAttribute('data-series', '0');
    await expect(page.locator('.diagram-note')).toContainText('x variable');
  });

  test('site checkboxes show the site emoji, hidden from screen readers', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const label = page.locator('label.check', { has: page.locator('input[name="site"]') }).filter({ hasText: 'Qvidja' });
    await expect(label.locator('.check-emoji')).toHaveText('🐂🐝');
    await expect(label.locator('.check-emoji')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByRole('checkbox', { name: 'Qvidja', exact: true })).toBeVisible();
  });
});

/** Text chunks (tEXt and iTXt, no compression) of a PNG file, by keyword. */
function pngText(png: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 8;
  while (pos + 12 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'iTXt') {
      const k = data.indexOf(0);
      // Skip: separator, compression flag, method, language tag and its 0, translated keyword and its 0.
      let p = k + 3;
      p = data.indexOf(0, p) + 1;
      p = data.indexOf(0, p) + 1;
      out[data.toString('latin1', 0, k)] = data.toString('utf8', p);
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return out;
}

const pngWidth = (png: Buffer) => png.readUInt32BE(16);
const pngHeight = (png: Buffer) => png.readUInt32BE(20);

interface ExportHook {
  __inar: { exportPng(t: string | number, s: number): Promise<{ dataUrl: string; alt: string }> };
}

async function exportPng(page: Page, target: string | number, scale = 3) {
  const r = await page.evaluate(([t, s]) => (globalThis as unknown as ExportHook).__inar.exportPng(t, s), [target, scale] as const);
  return { png: Buffer.from(r.dataUrl.slice(r.dataUrl.indexOf(',') + 1), 'base64'), alt: r.alt };
}

const EXPORT_VIEW = {
  id: 'export1',
  name: 'Export view',
  params: { sites: [3, 4], variables: ['nee_f', 'ta'], xVariable: 'ta', yearFrom: 2022, yearTo: 2023, aggregation: 'day' },
  diagrams: [
    { id: 'm1', type: 'monthly' },
    { id: 'c1', type: 'cumulative' },
  ],
};

test.describe('PNG export', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
    await page.goto('/' + viewHash(EXPORT_VIEW));
    await waitReady(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('one diagram: width is 3x the chart width and the description is the alt text', async ({ page }) => {
    const chartW = await page.locator('.diagram-chart').first().evaluate((el) => el.clientWidth);
    const { png, alt } = await exportPng(page, 0);
    expect(pngWidth(png)).toBe(3 * chartW);
    const text = pngText(png);
    expect(alt).toBe(await page.evaluate(() => (globalThis as unknown as { __inar: { altText(t: number): string } }).__inar.altText(0)));
    expect(text.Description).toBe(alt);
    expect(text.Title).toContain('Export view');
    // By id: the import gives new ids, so read the id of the second card.
    const id = (await page.locator('.diagram').nth(1).getAttribute('data-id')) ?? '';
    expect((await exportPng(page, id)).alt).toContain('Cumulative NEE');
  });

  test('all diagrams: one image, at least as high as the diagrams, with all alt texts', async ({ page }) => {
    const one = await exportPng(page, 0);
    const two = await exportPng(page, 1);
    const all = await exportPng(page, 'all');
    expect(pngHeight(all.png)).toBeGreaterThanOrEqual(pngHeight(one.png) + pngHeight(two.png));
    expect(pngWidth(all.png)).toBeGreaterThanOrEqual(pngWidth(one.png));
    const text = pngText(all.png);
    expect(text.Title).toBe('Export view');
    expect(text.Description).toBe(all.alt);
    expect(all.alt).toContain(one.alt);
    expect(all.alt).toContain(two.alt);
    expect(all.alt).toContain('Haltiala and Qvidja');
  });

  test('PNG button and "Download all" save PNG files', async ({ page }) => {
    const [one] = await Promise.all([page.waitForEvent('download'), page.locator('.diagram [data-action="png"]').first().click()]);
    expect(one.suggestedFilename()).toBe('inar-agri_export-view_1-monthly.png');
    const [all] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="png-all"]').click()]);
    expect(all.suggestedFilename()).toBe('inar-agri_export-view_all.png');
    const bytes = await readFile(await all.path());
    expect(pngText(bytes).Title).toBe('Export view');
  });
});

test('screenshot script writes a PNG and an alt text file', async ({ baseURL }) => {
  test.setTimeout(240_000);
  const out = join('test-results', 'screenshot-test', 'shot.png');
  await rm(dirname(out), { recursive: true, force: true });
  const run = promisify(execFile);
  const view = JSON.stringify({ name: 'Script view', params: EXPORT_VIEW.params, diagrams: EXPORT_VIEW.diagrams });
  const { stdout } = await run('node', ['scripts/screenshot.ts', '--url', `${baseURL}/`, '--view', view, '--out', out, '--scale', '2'], {
    timeout: 200_000,
  });
  expect(stdout).toContain('PNG:');
  const png = await readFile(out);
  const alt = (await readFile(out.replace(/\.png$/, '.alt.txt'), 'utf8')).trim();
  expect(pngText(png).Title).toBe('Script view');
  expect(pngText(png).Description).toBe(alt);
  expect(alt).toContain('Monthly means');
  expect(alt).toContain('Cumulative NEE');
});

// ---------- Data export ----------

/** Hosts that the page may call: the page origin, jsDelivr (DuckDB-WASM) and the DuckDB extension host. */
const ALLOWED_HOSTS = new Set(['cdn.jsdelivr.net', 'extensions.duckdb.org']);

/** Collect the requests to other hosts. blob: and data: URLs stay in the browser. */
function trackForeignRequests(page: Page, origin: string): string[] {
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:')) return;
    const u = new URL(url);
    const host = u.protocol === 'blob:' ? new URL(u.pathname).host : u.host;
    const own = u.protocol === 'blob:' ? new URL(u.pathname).origin === origin : u.origin === origin;
    if (!own && !ALLOWED_HOSTS.has(host)) foreign.push(url);
  });
  return foreign;
}

/** Open the "Download data" menu, pick one item and return the saved file. */
async function downloadData(page: Page, item: string): Promise<{ name: string; bytes: Buffer }> {
  await page.locator('[data-action="data"]').click();
  await expect(page.getByRole('menu')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.locator(`[data-export="${item}"]`).click()]);
  const bytes = await readFile(await dl.path());
  await expect(page.locator('#status')).toContainText(`Saved ${dl.suggestedFilename()}`);
  await expect(page.locator('[data-action="data"]')).toBeEnabled();
  return { name: dl.suggestedFilename(), bytes };
}

/** Parse a CSV file without quoted fields (the site names have no comma). Returns the header and the rows. */
function parseCsv(bytes: Buffer): { header: string[]; rows: string[][] } {
  const lines = bytes.toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const header = (lines.shift() ?? '').split(',');
  return { header, rows: lines.map((l) => l.split(',')) };
}

/** Read the entries of a store-only ZIP file through its central directory. Checks the CRC-32 of each entry. */
function readZip(zip: Buffer): Array<{ name: string; data: Buffer }> {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    expect(zip.readUInt16LE(p + 10)).toBe(0); // stored
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const local = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const data = zip.subarray(local, local + size);
    expect(zlib.crc32(data)).toBe(crc);
    out.push({ name, data });
    p += 46 + nameLen;
  }
  return out;
}

/** Read a Parquet file with DuckDB (Node): rows, column names, rows per site and the key/value metadata. */
async function readParquet(bytes: Buffer, name: string) {
  const path = join('test-results', 'data-export', name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const get = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjects();
    const n = Number((await get(`SELECT count(*)::INTEGER AS n FROM read_parquet('${path}')`))[0]?.n);
    const columns = (await get(`DESCRIBE SELECT * FROM read_parquet('${path}')`)).map((r) => String(r.column_name));
    const perSite = Object.fromEntries(
      (await get(`SELECT site_code, count(*)::INTEGER AS n FROM read_parquet('${path}') GROUP BY ALL`)).map((r) => [String(r.site_code), Number(r.n)]),
    );
    const kv = Object.fromEntries(
      (await get(`SELECT decode(key) AS k, decode(value) AS v FROM parquet_kv_metadata('${path}')`)).map((r) => [String(r.k), String(r.v)]),
    );
    return { n, columns, perSite, kv };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

const DATA_VIEW = {
  id: 'data1',
  name: 'Data view',
  params: { sites: [3, 4], variables: ['nee_f', 'ta'], xVariable: 'ta', yearFrom: 2022, yearTo: 2023, aggregation: 'day' },
  diagrams: [{ id: 't1', type: 'timeseries' }],
};

test.describe('data export', () => {
  test.describe.configure({ timeout: 300_000 });
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = trackForeignRequests(page, new URL(baseURL ?? 'http://localhost:4321').origin);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test('menu opens and closes with the mouse and the keyboard', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const button = page.locator('[data-action="data"]');
    const menu = page.getByRole('menu');
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await expect(menu).toBeHidden();

    await button.click();
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem')).toHaveCount(4);
    await expect(page.locator('[data-export="one-parquet"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-export="one-csv"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('[data-export="sites-csv"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-export="one-parquet"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    // Arrow Up opens the menu on the last item. A click outside closes it.
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-export="sites-csv"]')).toBeFocused();
    await page.locator('h1').click();
    await expect(menu).toBeHidden();

    // Enter on an item starts the export.
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.keyboard.press('Enter')]);
    expect(dl.suggestedFilename()).toMatch(/^inar-agri_all-data_\d{4}-\d{4}_raw\.csv$/);

    // No site: the button is disabled.
    for (const box of await page.locator('input[name="site"]').all()) await box.uncheck();
    await expect(button).toBeDisabled();
  });

  test('default view: all four options give the full data', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const expected = await parquetRowCount(OBS_FILE);
    await expect(page.locator('#chart')).toHaveAttribute('data-rows', String(expected));
    const columns = ['site_code', 'site_name', 'ts_start_utc', 'ts_local', 'nee', 'nee_f', 'ta', 'tsoil', 'swc', 'nee_qc'];
    const codes = ['anttila', 'sarkisuo', 'haltiala', 'qvidja', 'viikki', 'maktau'];
    const sizes: Record<string, number> = {};

    const csv = await downloadData(page, 'one-csv');
    expect(csv.name).toMatch(/^inar-agri_all-data_\d{4}-\d{4}_raw\.csv$/);
    sizes[csv.name] = csv.bytes.length;
    const table = parseCsv(csv.bytes);
    expect(table.header).toEqual(columns);
    expect(table.rows.length).toBe(expected);
    expect(table.rows.every((r) => r.length === columns.length)).toBe(true);
    const first = table.rows[0] as string[];
    expect(first[2]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(first[3]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
    expect(table.rows.some((r) => r.includes(''))).toBe(true); // NULL = empty field
    expect(table.rows.find((r) => r[0] === 'sarkisuo')?.[1]).toBe('Särkisuo'); // UTF-8

    const pq = await downloadData(page, 'one-parquet');
    expect(pq.name).toBe(csv.name.replace(/\.csv$/, '.parquet'));
    sizes[pq.name] = pq.bytes.length;
    const info = await readParquet(pq.bytes, pq.name);
    expect(info.n).toBe(expected);
    expect(info.columns).toEqual(columns);
    expect(info.kv['unit:nee']).toBe('µmol CO2 m-2 s-1');
    expect(info.kv['unit:ta']).toBe('°C');
    const csvPerSite: Record<string, number> = {};
    for (const r of table.rows) csvPerSite[r[0] as string] = (csvPerSite[r[0] as string] ?? 0) + 1;
    expect(info.perSite).toEqual(csvPerSite);

    for (const format of ['csv', 'parquet'] as const) {
      const zip = await downloadData(page, `sites-${format}`);
      expect(zip.name).toBe(csv.name.replace(/\.csv$/, `_${format}.zip`));
      sizes[zip.name] = zip.bytes.length;
      const entries = readZip(zip.bytes);
      expect(entries.map((e) => e.name)).toEqual(codes.map((c) => csv.name.replace(/\.csv$/, `_${c}.${format}`)));
      let total = 0;
      for (const [i, e] of entries.entries()) {
        const code = codes[i] as string;
        if (format === 'csv') {
          const t = parseCsv(e.data);
          expect(t.header).toEqual(columns);
          expect(t.rows.every((r) => r[0] === code)).toBe(true);
          expect(t.rows.length).toBe(csvPerSite[code]);
          total += t.rows.length;
        } else {
          const p = await readParquet(e.data, e.name);
          expect(p.columns).toEqual(columns);
          expect(p.perSite).toEqual({ [code]: csvPerSite[code] });
          total += p.n;
        }
      }
      expect(total).toBe(expected);
    }
    console.log('Export sizes (bytes):', JSON.stringify(sizes));
  });

  test('changed view (2 sites, daily mean, 2 years): files hold the shown rows', async ({ page }) => {
    await page.goto('/' + viewHash(DATA_VIEW));
    await waitReady(page);
    // The time series diagram shows one row per site and day: the export must have the same rows.
    const shown = Number(await page.locator('.diagram[data-type="timeseries"]').getAttribute('data-rows'));
    expect(shown).toBeGreaterThan(600);
    const columns = ['site_code', 'site_name', 'ts_start_utc', 'ts_local', 'nee_f', 'ta'];
    const base = 'inar-agri_data-view_2022-2023_day';

    const csv = await downloadData(page, 'one-csv');
    expect(csv.name).toBe(`${base}.csv`);
    const table = parseCsv(csv.bytes);
    expect(table.header).toEqual(columns);
    expect(table.rows.length).toBe(shown);
    expect(new Set(table.rows.map((r) => r[0]))).toEqual(new Set(['haltiala', 'qvidja']));
    // Daily step: local midnight, which is 22:00 UTC on the day before (UTC+2).
    expect(table.rows.every((r) => /T00:00:00$/.test(r[3] as string) && /T22:00:00Z$/.test(r[2] as string))).toBe(true);
    expect(table.rows.every((r) => /^202[23]-/.test(r[3] as string))).toBe(true);

    const pq = await downloadData(page, 'one-parquet');
    expect(pq.name).toBe(`${base}.parquet`);
    const info = await readParquet(pq.bytes, pq.name);
    expect(info.n).toBe(shown);
    expect(info.columns).toEqual(columns);
    expect(info.kv['step']).toBe('Daily mean');

    for (const format of ['csv', 'parquet'] as const) {
      const zip = await downloadData(page, `sites-${format}`);
      expect(zip.name).toBe(`${base}_${format}.zip`);
      const entries = readZip(zip.bytes);
      expect(entries.map((e) => e.name)).toEqual([`${base}_haltiala.${format}`, `${base}_qvidja.${format}`]);
      let total = 0;
      for (const e of entries) total += format === 'csv' ? parseCsv(e.data).rows.length : (await readParquet(e.data, e.name)).n;
      expect(total).toBe(shown);
    }
  });
});
