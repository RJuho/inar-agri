// End-to-end tests for the first page of the data website.
import { test, expect, type Page } from '@playwright/test';
import { DuckDBInstance } from '@duckdb/node-api';

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
