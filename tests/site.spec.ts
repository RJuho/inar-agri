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

  test('legend click hides a site', async ({ page }) => {
    const chart = page.locator('#chart');
    // Read the name of the first legend item from the ECharts instance (test hook in chart.ts).
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
    // The first legend item is at the top left of the chart (legend left = 48 px, top = 0, padding = 5 px).
    // Click on the label text of that item.
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
