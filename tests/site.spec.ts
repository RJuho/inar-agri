// End-to-end tests for the first page of the data website.
import { test, expect, type Page } from '@playwright/test';
import { DuckDBInstance } from '@duckdb/node-api';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { niceRange } from '../site/src/scripts/diagrams/nice.ts';

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

/**
 * Collect the requests to other origins and block them. The page loads all files
 * (DuckDB-WASM, the parquet extension, the data) from its own origin.
 * blob: URLs of the page origin and data: URLs stay in the browser.
 */
async function isolate(page: Page, origin: string): Promise<string[]> {
  const foreign: string[] = [];
  const own = (url: string): boolean => {
    if (url.startsWith('data:')) return true;
    const u = new URL(url);
    return (u.protocol === 'blob:' ? new URL(u.pathname).origin : u.origin) === origin;
  };
  page.on('request', (req) => {
    if (!own(req.url())) foreign.push(req.url());
  });
  await page.route(
    (url) => !own(url.toString()),
    (route) => route.abort('blockedbyclient'),
  );
  return foreign;
}

test.describe('first page', () => {
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
    await page.goto('/');
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'ready', { timeout: READY_TIMEOUT });
  });

  test('loads without console errors or page errors', async () => {
    expect(errors).toEqual([]);
  });

  test('makes no requests to other origins', async () => {
    expect(foreign).toEqual([]);
  });

  test('shows all rows of observations.parquet', async ({ page }) => {
    const expected = await parquetRowCount(OBS_FILE);
    expect(expected).toBeGreaterThan(0);
    await expect(page.locator('#chart')).toHaveAttribute('data-rows', String(expected));
  });

  test('draws 30 series (5 panels x 6 sites)', async ({ page }) => {
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '30');
  });

  test('each site has its own dash pattern, symbol and legend icon', async ({ page }) => {
    const info = await page.locator('#chart .diagram-chart').first().evaluate((el) => {
      type Series = { name: string; xAxisIndex: number; datasetIndex?: number; lineStyle?: { type?: unknown }; symbol?: unknown; showSymbol?: boolean };
      type Option = { series: Series[]; legend: Array<{ data: Array<string | { name: string; icon?: string }> }> };
      const o = (el as unknown as { __chart: { getOption(): Option } }).__chart.getOption();
      const first = o.series.filter((s) => s.datasetIndex !== undefined && s.xAxisIndex === 0);
      return {
        dashes: first.map((s) => JSON.stringify(s.lineStyle?.type)),
        symbols: first.map((s) => s.showSymbol === true && s.symbol !== 'none'),
        icons: (o.legend[0]?.data ?? []).map((d) => (typeof d === 'string' ? '' : (d.icon ?? ''))),
      };
    });
    expect(info.dashes.length).toBe(6);
    expect(new Set(info.dashes).size).toBe(6);
    expect(info.symbols.every(Boolean)).toBe(true);
    expect(info.icons.length).toBe(6);
    expect(info.icons.every((i) => i.startsWith('path://'))).toBe(true);
    expect(new Set(info.icons).size).toBe(6);
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
      type Item = string | { name: string };
      const c = (el as unknown as { __chart: { getOption(): { legend: Array<{ data: Item[] }> } } }).__chart;
      const item = c.getOption().legend[0]?.data[0];
      return typeof item === 'string' ? item : (item?.name ?? '');
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

  test('variable info toggle shows the summary', async ({ page }) => {
    // One info button per variable (24 variables in state.ts), plus one for the Events option.
    await expect(page.locator('.var-info-btn[aria-controls^="var-info-"]:not([aria-controls="var-info-events"])')).toHaveCount(24);
    await expect(page.locator('.var-info-btn')).toHaveCount(25);
    const box = page.locator('input[name="variable"][value="nee"]');
    const checked = await box.isChecked();
    const btn = page.locator('button.var-info-btn[aria-controls="var-info-nee"]');
    const info = page.locator('#var-info-nee');

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(info).toBeVisible();
    // Start of GLOSSARY.nee.summary in site/src/scripts/glossary.ts.
    await expect(info).toContainText('The net CO₂ flux between the field');
    await expect(info).toContainText('Heimsch et al. 2021');
    await expect(info.locator('a.var-more')).toHaveAttribute('href', /variables\/#var-nee$/);
    // The button does not change the checkbox.
    expect(await box.isChecked()).toBe(checked);

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(info).toBeHidden();
    expect(await box.isChecked()).toBe(checked);
  });
});

/** Wait until all diagrams of the active view are drawn. */
async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('#chart')).toHaveAttribute('data-status', /^(ready|empty)$/, { timeout: READY_TIMEOUT });
}

/** Text pages have one script only: the shared update check of Base.astro (update.ts). */
async function expectOnlyUpdateScript(page: Page): Promise<void> {
  const scripts = page.locator('script');
  await expect(scripts).toHaveCount(1);
  await expect(scripts).toHaveAttribute('type', 'module');
  expect(await scripts.textContent()).toContain('version.json');
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

  test('a parameter change makes the form busy until the diagrams are ready', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const box = page.locator('input[name="site"]').first();
    await box.focus();
    await box.uncheck();
    // Busy: the controls, the tabs and "Add diagram" are disabled; aria-busy and the status text are set.
    await expect(page.locator('form.params')).toHaveAttribute('aria-busy', 'true');
    await expect(box).toBeDisabled();
    await expect(page.locator('select[name="aggregation"]')).toBeDisabled();
    await expect(page.locator('[data-action="new"]')).toBeDisabled();
    await expect(page.locator('#add-diagram')).toBeDisabled();
    await expect(page.locator('#chart')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.params-status')).toHaveText('Updating diagrams…');
    await expect(page.locator('.params-status')).toHaveAttribute('role', 'status');
    // Ready: all enabled again, and the focus is back on the changed checkbox.
    await waitReady(page);
    await expect(page.locator('form.params')).not.toHaveAttribute('aria-busy', /.*/);
    await expect(page.locator('#chart')).not.toHaveAttribute('aria-busy', /.*/);
    await expect(box).toBeEnabled();
    await expect(page.locator('[data-action="new"]')).toBeEnabled();
    await expect(page.locator('#add-diagram')).toBeEnabled();
    await expect(page.locator('.params-status')).toHaveText('');
    await expect(box).toBeFocused();
    await expect(page.locator('#chart')).toHaveAttribute('data-series', '25');
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

const ALL_TYPES = ['timeseries', 'years', 'yearPanels', 'monthly', 'diurnal', 'scatter', 'anscombe', 'cumulative', 'fingerprint', 'response', 'budget', 'coverage'] as const;
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

  for (const type of ALL_TYPES) {
    test(`${type} has axis names with display units and an axes sentence in the alt text`, async ({ page }) => {
      await page.goto('/' + viewHash(typeView(type, ['nee_f', 'ta', 'swc'])));
      await waitReady(page);
      const card = page.locator('.diagram');
      await expect(card).toHaveAttribute('data-status', 'ready');
      const axes = await card.locator('.diagram-chart').evaluate((el) => {
        type Axis = { name?: string; show?: boolean; axisLabel?: { show?: boolean } };
        type Title = { id?: string; text?: string };
        const chart = (el as unknown as { __chart: { getOption(): { xAxis?: Axis[]; yAxis?: Axis[]; title?: Title[] } } }).__chart;
        const o = chart.getOption();
        const labelled = (a: Axis) => a.show !== false && a.axisLabel?.show !== false;
        return {
          y: (o.yAxis ?? []).filter(labelled).map((a) => a.name ?? ''),
          x: (o.xAxis ?? []).map((a) => a.name ?? '').filter((n) => n.trim() !== ''),
          // yearPanels: one x axis name for many panels, as a title with an id.
          xTitles: (o.title ?? []).filter((t) => (t.id ?? '').startsWith('x-axis-name')).map((t) => t.text ?? ''),
        };
      });
      expect(axes.y.length).toBeGreaterThan(0);
      for (const name of axes.y) expect(name.trim()).not.toBe('');
      expect(axes.x.length + axes.xTitles.length).toBeGreaterThan(0);
      // Display units (`unitText()`): super- and subscripts, not the raw unit strings.
      const all = [...axes.y, ...axes.x].join(' | ').replace(/\s*\n\s*/g, ' ');
      if (type === 'cumulative') {
        expect(all).toContain('g C m⁻²');
      } else if (type === 'budget') {
        // Annual sums of the fluxes only. The other variables are not shown.
        expect(all).toContain('g C m⁻² yr⁻¹');
        expect(all).not.toContain('m-2');
      } else if (type === 'fingerprint') {
        // The y axis is the time of day. The unit is on the colour scale label of each variable block.
        expect(all).toContain('Time of day');
        const titles = await card.locator('.diagram-chart').evaluate((el) => {
          const chart = (el as unknown as { __chart: { getOption(): { title?: Array<{ text?: string }> } } }).__chart;
          return (chart.getOption().title ?? []).map((t) => t.text ?? '').join(' | ');
        });
        expect(titles).toContain('µmol CO₂ m⁻² s⁻¹');
        expect(titles).not.toContain('m-2');
        expect(titles).toContain('m³ m⁻³');
      } else if (type === 'coverage') {
        // The y axis lists the sites and the colour is a share in percent. No variable unit is shown.
        expect(axes.y.every((n) => n === 'Site')).toBe(true);
        expect(all).toContain('Month (');
        const titles = await card.locator('.diagram-chart').evaluate((el) => {
          const chart = (el as unknown as { __chart: { getOption(): { title?: Array<{ text?: string }> } } }).__chart;
          return (chart.getOption().title ?? []).map((t) => t.text ?? '').join(' | ');
        });
        expect(titles).toContain('NEE, gap-filled — coverage');
        expect(titles).toContain('Soil water content — coverage');
      } else {
        expect(all).toContain('µmol CO₂ m⁻² s⁻¹');
        expect(all).not.toContain('m-2');
        expect(all).toContain('m³ m⁻³');
      }
      const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
      expect(alt).toMatch(/X ax(is|es): /);
      expect(alt).toMatch(/y ax(is|es): /);
    });
  }

  test('years types show raw data as daily means', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('yearPanels')));
    await waitReady(page);
    await expect(page.locator('.diagram-sub')).toContainText('daily means');
  });

  test('years overlay gives each year its own colour for one or two sites', async ({ page }) => {
    type Series = { name?: string; color?: string; lineStyle?: { opacity?: number; type?: string }; xAxisIndex?: number; datasetIndex?: number };
    const seriesOf = () =>
      page.locator('.diagram-chart').evaluate((el) => {
        const chart = (el as unknown as { __chart: { getOption(): { series?: Series[] } } }).__chart;
        return (chart.getOption().series ?? []).filter((s) => s.datasetIndex !== undefined && s.xAxisIndex === 0);
      });
    const base = typeView('years', ['nee_f']).params;
    // Qvidja (site 4) only: one colour per year, no fade.
    await page.goto('/' + viewHash({ ...typeView('years'), id: 'y1', params: { ...base, sites: [4] } }));
    await waitReady(page);
    let series = await seriesOf();
    expect(series.length).toBeGreaterThan(2);
    expect(new Set(series.map((s) => s.color)).size).toBe(series.length);
    expect(series.every((s) => s.lineStyle?.opacity === 1)).toBe(true);
    await expect(page.locator('.diagram-sub')).toContainText('Colour = year.');
    // Two sites: the same year has the same colour, the second site has dashed lines.
    await page.goto('/' + viewHash({ ...typeView('years'), id: 'y2', params: { ...base, sites: [1, 2] } }));
    await waitReady(page);
    series = await seriesOf();
    expect(series.filter((s) => s.lineStyle?.type === 'dashed').length).toBe(series.length / 2);
    expect(new Set(series.map((s) => s.color)).size).toBe(series.length / 2);
    // The series and legend names give the site and the year.
    expect(series.map((s) => s.name)).toContain('Anttila 2022');
    expect(series.map((s) => s.name)).toContain('Särkisuo 2023');
    // The legend wraps and lists all site-years.
    const legend = await page.locator('.diagram-chart').evaluate((el) => {
      const chart = (el as unknown as { __chart: { getOption(): { legend?: Array<{ type?: string; data?: string[] }> } } }).__chart;
      return chart.getOption().legend?.[0];
    });
    expect(legend?.type).toBe('plain');
    expect(legend?.data?.length).toBe(series.length);
    await expect(page.locator('.diagram-sub')).toContainText('dashed line');
    // Three sites: one colour per site.
    await page.goto('/' + viewHash({ ...typeView('years'), id: 'y3', params: { ...base, sites: [1, 2, 4] } }));
    await waitReady(page);
    series = await seriesOf();
    expect(new Set(series.map((s) => s.color)).size).toBe(3);
    await expect(page.locator('.diagram-sub')).not.toContainText('Colour = year.');
  });

  test('cumulative without a flux shows a note, not an error', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('cumulative', ['ta', 'swc'])));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(card).toHaveAttribute('data-series', '0');
    await expect(card.locator('.diagram-note')).toContainText('need one or more flux variables');
  });

  test('time series and fingerprint axes start at the from year, also without data there', async ({ page }) => {
    // Anttila and Särkisuo have data from 2022 only.
    const view = { ...typeView('timeseries', ['nee']), params: { ...typeView('timeseries').params, sites: [1, 2], variables: ['nee'], yearFrom: 2019 } };
    view.diagrams = [...view.diagrams, { id: 'fp', type: 'fingerprint' }];
    await page.goto('/' + viewHash(view));
    await waitReady(page);
    const info = await page.locator('.diagram-chart').evaluateAll((els) =>
      els.map((el) => {
        type Option = { xAxis?: Array<{ min?: number; data?: string[] }> };
        const x = (el as unknown as { __chart: { getOption(): Option } }).__chart.getOption().xAxis?.[0];
        return { min: x?.min ?? null, first: x?.data?.[0] ?? null };
      }),
    );
    expect(info[0]?.min).toBe(Date.UTC(2019, 0, 1));
    expect(info[1]?.first).toBe('2019-01-01');
  });

  test('fingerprint bins the days to at most 400 columns and has one colour scale per variable', async ({ page }) => {
    const view = { ...typeView('fingerprint', ['nee_f', 'ta']), params: { ...typeView('fingerprint').params, sites: [4], variables: ['nee_f', 'ta'], yearFrom: 2022, yearTo: 2023 } };
    await page.goto('/' + viewHash(view));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    // One panel per variable and site: 2 variables × 1 site.
    await expect(card).toHaveAttribute('data-series', '2');
    // 730 days in 2022 and 2023: 2 days per column, 365 columns, 48 half hours.
    expect(Number(await card.getAttribute('data-rows'))).toBe(365 * 48);
    const info = await card.locator('.diagram-chart').evaluate((el) => {
      type Option = { xAxis?: Array<{ data?: string[] }>; visualMap?: Array<{ min?: number; max?: number }>; series?: Array<{ data?: unknown[] }> };
      const chart = (el as unknown as { __chart: { getOption(): Option } }).__chart;
      const o = chart.getOption();
      return {
        columns: o.xAxis?.[0]?.data?.length ?? 0,
        first: o.xAxis?.[0]?.data?.[0] ?? '',
        scales: (o.visualMap ?? []).map((v) => [v.min, v.max]),
        cells: (o.series ?? []).map((s) => s.data?.length ?? 0),
      };
    });
    expect(info.columns).toBe(365);
    expect(info.first).toBe('2022-01-01');
    expect(info.scales.length).toBe(2);
    // NEE: a diverging scale, symmetric around 0. Air temperature: a sequential scale.
    expect(info.scales[0]?.[0]).toBeCloseTo(-(info.scales[0]?.[1] as number), 6);
    expect(info.scales[1]?.[0] as number).toBeLessThan(0);
    expect(info.scales[1]?.[1] as number).toBeGreaterThan(20);
    for (const n of info.cells) expect(n).toBeLessThanOrEqual(365 * 48);
    await expect(page.locator('.diagram-sub')).toContainText('mean of 2 days');
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('2 panels');
    expect(alt).toContain('Each column is the mean of 2 days');
  });

  test('fingerprint with more than 24 panels shows a note, not an error', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('fingerprint', ['nee', 'nee_f', 'ta', 'tsoil', 'swc'])));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(card).toHaveAttribute('data-series', '0');
    await expect(card.locator('.diagram-note')).toContainText('Too many panels: 30');
  });

  test('response fits a light response per site and shows the bins in the tooltip', async ({ page }) => {
    const base = typeView('response', ['nee_f', 'gpp']);
    const view = { ...base, params: { ...base.params, sites: [1, 2, 3, 5], xVariable: 'ppfd' } };
    await page.goto('/' + viewHash(view));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    // 2 variables × 4 sites with PPFD.
    await expect(card).toHaveAttribute('data-series', '8');
    expect(Number(await card.getAttribute('data-rows'))).toBeGreaterThan(100);
    await expect(page.locator('.diagram-sub')).toContainText('Daytime rows only (PPFD > 0)');
    await expect(page.locator('.diagram-sub')).toContainText('fitted light response');
    const info = await card.locator('.diagram-chart').evaluate((el) => {
      type Option = { series?: Array<{ lineStyle?: { type?: string }; data?: unknown[] }>; graphic?: Array<{ elements?: unknown[] }> };
      const chart = (el as unknown as { __chart: { getOption(): Option } }).__chart;
      const o = chart.getOption();
      return {
        dashed: (o.series ?? []).filter((s) => s.lineStyle?.type === 'dashed').length,
        texts: (o.graphic ?? []).reduce((n, g) => n + (g.elements?.length ?? 0), 0),
      };
    });
    // One dashed fit line and one text line per site and panel.
    expect(info.dashed).toBe(8);
    expect(info.texts).toBe(8);
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('Fitted curves (dashed)');
    expect(alt).toMatch(/Anttila: α = 0\.0\d+, β = \d+(\.\d+)? µmol CO₂ m⁻² s⁻¹, γ = /);
    expect(alt).toContain('GPP, calculated, light response');
    // Tooltip: bin range, then mean, percentiles and count per site.
    const canvas = card.locator('.diagram-chart canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) await canvas.hover({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
    await expect(card.locator('.diagram-chart').getByText(/n = \d/)).toBeVisible();
    await expect(card.locator('.diagram-chart').getByText(/PPFD \d+ to \d+/)).toBeVisible();
  });

  test('response fits the Q10 model for Reco against air temperature', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('response', ['reco'])));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(card).toHaveAttribute('data-series', '6');
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('Q₁₀ model');
    expect(alt).toMatch(/Qvidja: Q₁₀ = [1-4]\.\d+, R₁₀ = \d/);
  });

  test('response without a fit and with only the x variable', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('response', ['nee_f', 'ta'], 'day')));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(page.locator('.diagram-sub')).toContainText('from daily means');
    await expect(page.locator('.diagram-sub')).not.toContainText('Dashed line');
    expect((await card.locator('.diagram-alt p').textContent()) ?? '').toContain('No fitted curve');
    await page.goto('/' + viewHash(typeView('response', ['ta'])));
    await waitReady(page);
    await expect(card).toHaveAttribute('data-series', '0');
    await expect(page.locator('.diagram-note')).toContainText('x variable');
  });

  test('budget without a flux shows a note, not an error', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('budget', ['ta', 'swc'])));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(card).toHaveAttribute('data-series', '0');
    await expect(card.locator('.diagram-note')).toContainText('Select a flux variable');
  });

  test('budget sums match annual.csv and marks partial years', async ({ page }) => {
    // Anttila (site 1), two full years. Qvidja (site 4), 2018 starts in May: partial.
    const base = typeView('budget', ['nee_f', 'gpp', 'reco']);
    await page.goto('/' + viewHash({ ...base, params: { ...base.params, sites: [1, 4] } }));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    // 2 Anttila years + 8 Qvidja years, 3 bar series per site.
    await expect(card).toHaveAttribute('data-rows', '10');
    await expect(card).toHaveAttribute('data-series', '6');
    await expect(page.locator('.diagram-sub')).toContainText('GPP is drawn negative');
    await expect(page.locator('.diagram-sub')).toContainText('* partial year');
    const option = await card.locator('.diagram-chart').evaluate((el) => {
      type Item = number | null | { value: number; itemStyle?: { opacity?: number; decal?: unknown } };
      type Series = { type: string; name: string; xAxisIndex: number; data?: Item[] };
      const chart = (el as unknown as { __chart: { getOption(): { series: Series[]; xAxis: Array<{ data: string[] }>; legend: Array<{ data: string[] }> } } }).__chart;
      const o = chart.getOption();
      return {
        series: o.series.filter((s) => s.type === 'bar').map((s) => ({ name: s.name, panel: s.xAxisIndex, data: s.data ?? [] })),
        xLabels: o.xAxis.map((a) => a.data),
        legend: o.legend[0]?.data ?? [],
      };
    });
    expect(option.legend).toEqual(['NEE, gap-filled', 'GPP, calculated', 'Reco, calculated']);
    // Panel 0 = Anttila: full years, plain values. Panel 1 = Qvidja: 2018 is partial.
    expect(option.xLabels[0]).toEqual(['2022', '2023']);
    expect(option.xLabels[1]?.[0]).toBe('2018*');
    const qvidjaNee = option.series.find((s) => s.panel === 1 && s.name === 'NEE, gap-filled');
    const first = qvidjaNee?.data[0] as { value: number; itemStyle: { opacity: number; decal: unknown } };
    expect(first.itemStyle.opacity).toBe(0.45);
    expect(first.itemStyle.decal).toBeTruthy();
    // Each variable has its own decal pattern on all bars, so that the bars do not depend on colour alone.
    const decals = await card.locator('.diagram-chart').evaluate((el) => {
      type Series = { type: string; name: string; xAxisIndex: number; itemStyle?: { decal?: unknown } };
      const o = (el as unknown as { __chart: { getOption(): { series: Series[] } } }).__chart.getOption();
      return o.series.filter((s) => s.type === 'bar' && s.xAxisIndex === 0).map((s) => JSON.stringify(s.itemStyle?.decal ?? null));
    });
    expect(decals.length).toBe(3);
    expect(decals.every((d) => d !== 'null')).toBe(true);
    expect(new Set(decals).size).toBe(3);
    // The sums match the calculated annual table within 1.5 % (the local-year definition differs a little).
    const csv = await readFile('data/calculated/annual.csv', 'utf8');
    const [header, ...lines] = csv.trim().split('\n') as [string, ...string[]];
    const cols = header.split(',');
    const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])) as Record<string, string>);
    const anttila = (year: number) => rows.find((r) => r.site_id === '1' && r.year === String(year)) as Record<string, string>;
    type Item = number | null | { value: number };
    const value = (name: string, i: number) => {
      const d = (option.series.find((s) => s.panel === 0 && s.name === name) as { data: Item[] }).data[i];
      return typeof d === 'number' ? d : (d as { value: number }).value;
    };
    for (const [i, year] of [2022, 2023].entries()) {
      const ref = anttila(year);
      const close = (a: number, b: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(0.015);
      close(value('NEE, gap-filled', i), Number(ref.nee_f_gc));
      // GPP is drawn negative.
      close(-value('GPP, calculated', i), Number(ref.gpp_gc));
      close(value('Reco, calculated', i), Number(ref.reco_gc));
    }
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('Annual carbon budget: one panel per site (2)');
    expect(alt).toMatch(/Anttila: 2022 NEE gap-filled -?\d+, GPP \d+, Reco \d+/);
  });

  test('budget marks measured NEE as partial where it has gaps', async ({ page }) => {
    const base = typeView('budget', ['nee', 'nee_f']);
    await page.goto('/' + viewHash({ ...base, params: { ...base.params, sites: [3] } }));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(card).toHaveAttribute('data-series', '2');
    const xLabels = await card.locator('.diagram-chart').evaluate((el) => {
      const chart = (el as unknown as { __chart: { getOption(): { xAxis: Array<{ data: string[] }> } } }).__chart;
      return chart.getOption().xAxis[0]?.data ?? [];
    });
    // Haltiala: every year has a gap in the measured NEE, so every year label has "*".
    expect(xLabels.length).toBeGreaterThan(0);
    for (const label of xLabels) expect(label).toMatch(/^\d{4}\*$/);
    await expect(page.locator('.diagram-sub')).toContainText('Measured NEE has gaps');
  });

  test('coverage gives the share of half hours per site and month', async ({ page }) => {
    const base = typeView('coverage', ['nee', 'nee_f']);
    // Qvidja (4) and Viikki (5), 2022 to 2023 = 24 months.
    await page.goto('/' + viewHash({ ...base, params: { ...base.params, sites: [4, 5], yearFrom: 2022, yearTo: 2023 } }));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    // One heatmap series per variable.
    await expect(card).toHaveAttribute('data-series', '2');
    const got = await card.locator('.diagram-chart').evaluate((el) => {
      type Item = { value: [number, number, number] };
      type Option = { xAxis: Array<{ data: string[] }>; yAxis: Array<{ data: string[] }>; series: Array<{ name: string; data: Item[] }> };
      const o = (el as unknown as { __chart: { getOption(): Option } }).__chart.getOption();
      const mean = (s: { data: Item[] }, row: number) => {
        const v = s.data.filter((d) => d.value[1] === row).map((d) => d.value[2]);
        return v.reduce((a, b) => a + b, 0) / v.length;
      };
      const rows = o.yAxis[0]?.data ?? [];
      const q = rows.indexOf('Qvidja');
      const vi = rows.indexOf('Viikki');
      return {
        months: o.xAxis[0]?.data ?? [],
        rows,
        qvidjaNeeF: mean(o.series[1] as { data: Item[] }, q),
        viikkiNee: mean(o.series[0] as { data: Item[] }, vi),
        viikkiNeeF: mean(o.series[1] as { data: Item[] }, vi),
      };
    });
    expect(got.months.length).toBe(24);
    expect(got.months[0]).toBe('2022-01');
    expect(got.months[23]).toBe('2023-12');
    expect(got.rows).toEqual(['Qvidja', 'Viikki']);
    // Qvidja gap-filled NEE is near complete. Viikki measured NEE is about 20 % of the periods.
    expect(got.qvidjaNeeF).toBeGreaterThan(90);
    expect(got.viikkiNee).toBeGreaterThan(8);
    expect(got.viikkiNee).toBeLessThan(40);
    expect(got.viikkiNeeF).toBeGreaterThan(got.viikkiNee);
    await expect(page.locator('.diagram-sub')).toContainText('Share of the half hours');
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('Coverage heatmap: months on the x axis, sites on the y axis, one panel per variable (2)');
    // The two y axes have the same name, so the axes sentence gives it one time.
    expect(alt).toContain('y axis: Site.');
  });

  test('scatter with only the x variable shows a note', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('scatter', ['ta'])));
    await waitReady(page);
    await expect(page.locator('.diagram')).toHaveAttribute('data-series', '0');
    await expect(page.locator('.diagram-note')).toContainText('x variable');
  });

  test('anscombe with only the x variable shows a note', async ({ page }) => {
    await page.goto('/' + viewHash(typeView('anscombe', ['ta'])));
    await waitReady(page);
    await expect(page.locator('.diagram')).toHaveAttribute('data-series', '0');
    await expect(page.locator('.diagram-note')).toContainText('x variable');
  });

  test('anscombe statistics in the panels match a DuckDB query over all rows', async ({ page }) => {
    // Haltiala (3) and Qvidja (4), NEE gap-filled against air temperature, 30-min values.
    const base = typeView('anscombe', ['nee_f', 'ta']);
    await page.goto('/' + viewHash({ ...base, params: { ...base.params, sites: [3, 4] } }));
    await waitReady(page);
    const card = page.locator('.diagram');
    await expect(card).toHaveAttribute('data-status', 'ready');
    await expect(card).toHaveAttribute('data-series', '2');
    const option = await card.locator('.diagram-chart').evaluate((el) => {
      type Graphic = { elements?: Array<{ id?: string; style?: { text?: string } }> };
      type Axis = { min?: number; max?: number };
      const o = (el as unknown as { __chart: { getOption(): { graphic?: Graphic[]; xAxis: Axis[]; yAxis: Axis[]; series: Array<{ type: string }> } } }).__chart.getOption();
      const texts: Record<string, string> = {};
      for (const g of o.graphic ?? []) for (const e of g.elements ?? []) if (e.id && e.style?.text) texts[e.id] = e.style.text;
      return {
        texts,
        x: o.xAxis.map((a) => [a.min, a.max]),
        y: o.yAxis.map((a) => [a.min, a.max]),
        lines: o.series.filter((s) => s.type === 'line').length,
      };
    });
    // Same x and y range in both panels of the block.
    expect(option.x[0]).toEqual(option.x[1]);
    expect(option.y[0]).toEqual(option.y[1]);
    // One OLS line per panel (and maybe zero lines).
    expect(option.lines).toBeGreaterThanOrEqual(2);

    // The same table `obs` as db.ts, from the files of the page.
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    let ref: Array<Record<string, number>>;
    try {
      const reader = await conn.runAndReadAll(
        `WITH obs AS (
           SELECT o.site_id, o.ta, coalesce(o.nee_f, f.nee_f_calc::DOUBLE) AS nee_f
           FROM 'site/public/data/observations.parquet' o
           LEFT JOIN 'site/public/data/fluxes.parquet' f USING (site_id, ts_start))
         SELECT site_id::INTEGER AS site_id, count(*)::DOUBLE AS n, avg(ta) AS mx, avg(nee_f) AS my,
           var_samp(ta) AS vx, var_samp(nee_f) AS vy, corr(nee_f, ta) AS r,
           regr_slope(nee_f, ta) AS b, regr_intercept(nee_f, ta) AS a, regr_r2(nee_f, ta) AS r2
         FROM obs WHERE site_id IN (3, 4) AND ta IS NOT NULL AND nee_f IS NOT NULL
         GROUP BY site_id ORDER BY site_id`,
      );
      ref = reader.getRowObjects().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])));
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
    expect(ref.length).toBe(2);
    const num = (s: string) => Number(s.replace(/−/g, '-').replace(/ /g, ''));
    for (const r of ref) {
      const text = option.texts[`anscombe-stats-0-${r.site_id}`] ?? '';
      const m = text.match(
        /^n = ([\d ]+)\nmean x = (\S+), mean y = (\S+)\nvar x = (\S+), var y = (\S+)\nr = (\S+), R² = (\S+)\ny = (\S+) x ([+−]) (\S+)$/,
      );
      expect(m, text).not.toBeNull();
      const g = m as RegExpMatchArray;
      expect(num(g[1] as string)).toBe(r.n);
      // The panel gives 3 significant digits.
      const close = (shown: string, exact: number) => expect(Math.abs(num(shown) - exact)).toBeLessThanOrEqual(Math.abs(exact) * 0.006 + 1e-12);
      close(g[2] as string, r.mx as number);
      close(g[3] as string, r.my as number);
      close(g[4] as string, r.vx as number);
      close(g[5] as string, r.vy as number);
      close(g[6] as string, r.r as number);
      close(g[7] as string, r.r2 as number);
      close(g[8] as string, r.b as number);
      close(`${g[9] === '−' ? '-' : ''}${g[10]}`, r.a as number);
    }
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('Equal statistics can hide different patterns');
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
/** Width in CSS px of each exported chart (EXPORT_WIDTH in export.ts) and the side margin of a composite (PAD). */
const EXPORT_WIDTH = 1200;
const EXPORT_PAD = 24;
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

  test('one diagram: width is 3 x 1200 px and the description is the alt text', async ({ page }) => {
    const { png, alt } = await exportPng(page, 0);
    expect(pngWidth(png)).toBe(3 * EXPORT_WIDTH);
    const text = pngText(png);
    // Monthly means do not use the view step.
    expect(text.Step).toBe('Mean per calendar month');
    expect(alt).toBe(await page.evaluate(() => (globalThis as unknown as { __inar: { altText(t: number): string } }).__inar.altText(0)));
    expect(text.Description).toBe(alt);
    expect(text.Title).toMatch(/ — Export view$/);
    // By id: the import gives new ids, so read the id of the second card.
    const id = (await page.locator('.diagram').nth(1).getAttribute('data-id')) ?? '';
    expect((await exportPng(page, id)).alt).toContain('Cumulative NEE');
  });

  test('all diagrams: one image, at least as high as the diagrams, with all alt texts', async ({ page }) => {
    const one = await exportPng(page, 0);
    const two = await exportPng(page, 1);
    const all = await exportPng(page, 'all');
    expect(pngHeight(all.png)).toBeGreaterThanOrEqual(pngHeight(one.png) + pngHeight(two.png));
    expect(pngWidth(all.png)).toBe(3 * (EXPORT_WIDTH + 2 * EXPORT_PAD));
    expect(pngWidth(all.png)).toBeGreaterThanOrEqual(pngWidth(one.png));
    const text = pngText(all.png);
    expect(text.Step).toBe('Daily mean');
    expect(text.Title).toBe('Export view');
    expect(text.Description).toBe(all.alt);
    expect(all.alt).toContain(one.alt);
    expect(all.alt).toContain(two.alt);
    expect(all.alt).toContain('Haltiala and Qvidja');
  });

  test('export size does not depend on the window width', async ({ page }) => {
    const wide = await exportPng(page, 1);
    await page.setViewportSize({ width: 600, height: 900 });
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'ready');
    const narrow = await exportPng(page, 1);
    expect(pngWidth(wide.png)).toBe(3 * EXPORT_WIDTH);
    expect(pngWidth(narrow.png)).toBe(pngWidth(wide.png));
    expect(pngHeight(narrow.png)).toBe(pngHeight(wide.png));
    // The page chart is narrower than the export.
    expect(await page.locator('.diagram-chart').nth(1).evaluate((el) => el.clientWidth)).toBeLessThan(EXPORT_WIDTH);
  });

  test('export is light also in the dark colour scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'ready');
    const { png } = await exportPng(page, 0, 1);
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    // Pixel near the top left corner (header margin) and the mean of the full image.
    const [corner, mean] = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += ((d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number)) / 3;
      return [[d[4 * (2 * c.width + 2)], d[4 * (2 * c.width + 2) + 1], d[4 * (2 * c.width + 2) + 2]], sum / (d.length / 4)];
    }, dataUrl);
    expect(corner).toEqual([255, 255, 255]);
    expect(mean).toBeGreaterThan(200);
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
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
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

// ---------- New variables, the weekly step and the Calculated page ----------

/** A timeseries view of the given sites, variables and step. */
function stepView(id: string, sites: number[], variables: string[], aggregation: string) {
  return {
    id,
    name: `Step ${aggregation}`,
    params: { sites, variables, xVariable: 'ta', yearFrom: 2022, yearTo: 2023, aggregation },
    diagrams: [{ id: 't1', type: 'timeseries' }],
  };
}

test.describe('new variables and weekly step', () => {
  test.describe.configure({ timeout: 300_000 });
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test('the variable checkboxes come in three groups', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    for (const legend of ['Fluxes', 'Meteorology', 'Soil']) {
      await expect(page.locator('#params legend', { hasText: legend })).toBeVisible();
    }
    for (const v of ['gpp', 'reco', 'ch4', 'n2o', 'le', 'sw_in', 'ustar', 'precip', 'pa', 'ws', 'wd', 'netrad', 'sw_out', 'g']) {
      await expect(page.locator(`input[name="variable"][value="${v}"]`)).toHaveCount(1);
    }
    await expect(page.locator('select option[value="week"]')).toHaveCount(1);
  });

  test('daily precipitation is the sum per day, not the mean', async ({ page }) => {
    // Viikki (site 5), 2023.
    const base = stepView('w-precip', [5], ['precip'], 'day');
    const view = { ...base, params: { ...base.params, yearFrom: 2023, yearTo: 2023 } };
    await page.goto('/' + viewHash(view));
    await waitReady(page);
    const card = page.locator('.diagram[data-type="timeseries"]');
    await expect(card).toHaveAttribute('data-status', 'ready');
    const chart = card.locator('.diagram-chart');
    const { titles, dailyMax } = await chart.evaluate((el) => {
      const c = (el as unknown as {
        __chart: { getOption(): { title: Array<{ text?: string }>; dataset: Array<{ source: { precip: ArrayLike<number> } }> } };
      }).__chart;
      const o = c.getOption();
      let max = -Infinity;
      for (const d of o.dataset) for (const v of Array.from(d.source.precip)) if (Number.isFinite(v)) max = Math.max(max, v);
      return { titles: o.title.map((t) => t.text ?? ''), dailyMax: max };
    });
    expect(titles).toContain('Precipitation — daily sum');
    // The statistics of the alt text come from the 30-min values: "max <value> on <date>".
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('Precipitation is the sum per step');
    const m = /Precipitation \([^)]*\): .*? max ([\d.]+) on/.exec(alt);
    expect(m).not.toBeNull();
    const halfHourMax = Number(m?.[1]);
    expect(halfHourMax).toBeGreaterThan(0);
    // A daily sum of a rain day is much larger than the largest 30-min value. A daily mean is smaller.
    // Viikki 2023: 30-min max about 16 mm, daily max about 41 mm.
    expect(dailyMax).toBeGreaterThan(1.5 * halfHourMax);
  });

  test('weekly rows lie between daily and monthly rows', async ({ page }) => {
    const rows: Record<string, number> = {};
    for (const step of ['day', 'week', 'month']) {
      await page.goto('/' + viewHash(stepView(`w-${step}`, [3], ['nee_f'], step)));
      await waitReady(page);
      rows[step] = Number(await page.locator('.diagram[data-type="timeseries"]').getAttribute('data-rows'));
    }
    // Haltiala 2022-2023: 730 days, about 105 weeks, 24 months.
    expect(rows.day).toBe(730);
    expect(rows.month).toBe(24);
    expect(rows.week).toBeGreaterThanOrEqual(104);
    expect(rows.week).toBeLessThanOrEqual(106);
  });

  test('weekly data export starts on Mondays and has the step in the file name', async ({ page }) => {
    await page.goto('/' + viewHash(stepView('w-export', [3], ['nee_f', 'gpp'], 'week')));
    await waitReady(page);
    const csv = await downloadData(page, 'one-csv');
    expect(csv.name).toBe('inar-agri_step-week_2022-2023_week.csv');
    const table = parseCsv(csv.bytes);
    expect(table.header).toEqual(['site_code', 'site_name', 'ts_start_utc', 'ts_local', 'nee_f', 'gpp']);
    expect(table.rows.length).toBeGreaterThan(100);
    for (const r of table.rows) expect(new Date(`${r[3] as string}Z`).getUTCDay()).toBe(1);
  });

  test('calculated GPP, Reco and the CH4 flux draw series with units', async ({ page }) => {
    await page.goto('/' + viewHash(stepView('w-new', [1, 2], ['gpp', 'reco', 'ch4'], 'day')));
    await waitReady(page);
    const card = page.locator('.diagram[data-type="timeseries"]');
    await expect(card).toHaveAttribute('data-status', 'ready');
    expect(Number(await card.getAttribute('data-series'))).toBe(6);
    expect(Number(await card.getAttribute('data-rows'))).toBeGreaterThan(1000);
    const alt = (await card.locator('.diagram-alt p').textContent()) ?? '';
    expect(alt).toContain('GPP, calculated');
    expect(alt).toContain('CH4 flux');
  });

  test('Maktau has a gap-filled NEE from the calculation', async ({ page }) => {
    await page.goto('/' + viewHash(stepView('w-maktau', [6], ['nee_f'], 'month')));
    await waitReady(page);
    const csv = await downloadData(page, 'one-csv');
    const table = parseCsv(csv.bytes);
    expect(table.rows.length).toBe(24);
    expect(table.rows.filter((r) => r[4] !== '').length).toBe(24);
  });

  test('cumulative sums GPP and Reco', async ({ page }) => {
    await page.goto('/' + viewHash({ ...stepView('w-cum', [3], ['gpp', 'reco'], 'day'), diagrams: [{ id: 'c1', type: 'cumulative' }] }));
    await waitReady(page);
    const card = page.locator('.diagram[data-type="cumulative"]');
    await expect(card).toHaveAttribute('data-status', 'ready');
    expect(Number(await card.getAttribute('data-series'))).toBeGreaterThan(0);
  });
});

test.describe('calculated page', () => {
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
    await page.goto('/calculated/');
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test('renders the formulas with KaTeX and MathML', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Calculated');
    expect(await page.locator('.katex').count()).toBeGreaterThan(10);
    expect(await page.locator('math').count()).toBeGreaterThan(10);
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await expectOnlyUpdateScript(page);
  });

  test('has the result tables', async ({ page }) => {
    const tables = page.locator('table');
    expect(await tables.count()).toBeGreaterThanOrEqual(5);
    for (const name of SITE_NAMES) await expect(page.locator('table', { hasText: name }).first()).toBeVisible();
  });

  test('the footer links to the source code', async ({ page }) => {
    await expect(page.locator('footer a[href="https://github.com/RJuho/inar-agri"]')).toBeVisible();
  });

  test('page navigation goes both ways', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav.getByRole('link', { name: 'Calculated' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Data', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await waitReady(page);
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Calculated' }).click();
    await expect(page).toHaveURL(/\/calculated\/?$/);
  });

  test('no horizontal page scroll at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('variables page', () => {
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
    await page.goto('/variables/');
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test('lists the 24 variables and has only the update check script', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Variables');
    await expect(page.locator('.glossary dt')).toHaveCount(24);
    await expect(page.locator('#var-precip')).toHaveCount(1);
    await expect(page.locator('#var-n2o')).toHaveCount(1);
    await expect(page.locator('#var-nee')).toHaveCount(1);
    await expect(page.locator('#var-swc')).toHaveCount(1);
    await expectOnlyUpdateScript(page);
  });

  test('has the reference list with DOI links', async ({ page }) => {
    const refs = page.locator('section:has(> #references) ol.references li');
    await expect(refs).toHaveCount(7);
    for (const li of await refs.all()) {
      expect(await li.locator('a[href^="https://doi.org/10."]').count()).toBeGreaterThan(0);
    }
    await expect(page.locator('#ref-gao2026')).toHaveCount(1);
  });

  test('each citation link goes to a reference on the page', async ({ page }) => {
    const hrefs = await page.locator('a[href^="#ref-"]').evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of new Set(hrefs)) {
      await expect(page.locator(`[id="${href.slice(1)}"]`), href).toHaveCount(1);
    }
  });

  test('the page navigation marks the Variables page', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav.getByRole('link', { name: 'Variables' })).toHaveAttribute('aria-current', 'page');
  });
});

// ---------- Data Report page and the AI notice of the text pages ----------

test.describe('data report page', () => {
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
    await page.goto('/data-report/');
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test('shows the findings table, the key item and the change log with a formula', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Data Report');
    expect(await page.locator('table.findings tbody tr').count()).toBeGreaterThan(0);
    // Each status badge has a text, not only a colour.
    for (const badge of await page.locator('table.findings .status-badge').all()) {
      expect((await badge.innerText()).trim()).toMatch(/Open|Resolved|Waits for provider/);
    }
    await expect(page.locator('#finding-ANT-01')).toHaveClass(/is-key/);
    await expect(page.locator('#finding-QVI-16')).toContainText('Open');
    await expect(page.locator('#key-issue')).toBeVisible();
    await expect(page.locator('section:has(> #changelog) article.change').first()).toBeVisible();
    await expect(page.locator('article.change .katex-display .katex').first()).toBeVisible();
    await expect(page.locator('a[href$="/docs/anomaly-data-report.md"]').first()).toHaveAttribute('href', /^https:\/\/github\.com\//);
    await expectOnlyUpdateScript(page);
  });

  test('the page navigation marks the Data Report page', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav.getByRole('link', { name: 'Data Report' })).toHaveAttribute('aria-current', 'page');
  });

  test('each finding link goes to a row on the page', async ({ page }) => {
    const hrefs = await page.locator('a[href^="#finding-"]').evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of new Set(hrefs)) {
      await expect(page.locator(`[id="${href.slice(1)}"]`), href).toHaveCount(1);
    }
  });
});

// ---------- Events page ----------

test.describe('events page', () => {
  test('shows one table per site with events, with yields', async ({ page, baseURL }) => {
    const errors = trackErrors(page);
    const foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
    await page.goto('/events/');
    await expect(page.locator('h1')).toHaveText('Events');
    const sites = await page.locator('table.events-table').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.site));
    expect(sites).toEqual(['haltiala', 'qvidja', 'viikki']);
    // Viikki 2022: yield of the year 3673 kg DW/ha on the second cut.
    await expect(page.locator('table[data-site="viikki"] tr[data-type="harvest"] td[data-col="yield"]', { hasText: '3673' })).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
    await expectOnlyUpdateScript(page);
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });
});

// ---------- Deep Dives ----------

test.describe('deep dive pages', () => {
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test('the list page lists the harvest dive and the link opens it', async ({ page }) => {
    await page.goto('/deep-dive/');
    await expect(page.locator('h1')).toHaveText('Deep Dives');
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav.getByRole('link', { name: 'Deep Dives' })).toHaveAttribute('aria-current', 'page');
    const card = page.locator('.dd-card[data-slug="harvest-carbon"]');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.dd-card-question')).toContainText('harvest');
    await expect(card.locator('.dd-status')).toHaveText(/Draft|Checked/);
    await expect(card.locator('.dd-card-index')).toHaveText('Deep Dive #0');
    // Newest first: the first card has the highest number.
    const labels = await page.locator('.dd-card-index').allInnerTexts();
    const nums = labels.map((t) => Number(t.replace(/\D/g, '')));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
    expect(Math.min(...nums)).toBe(0);
    await expectOnlyUpdateScript(page);
    await card.getByRole('link', { name: 'Harvest and cutting vs carbon balance' }).click();
    await expect(page).toHaveURL(/\/deep-dive\/harvest-carbon\/?$/);
    await expect(page.locator('h1')).toHaveText('Harvest and cutting vs carbon balance');
  });

  test('the harvest dive has the fixed sections, figures with alt text and numbers from the JSON', async ({ page }) => {
    await page.goto('/deep-dive/harvest-carbon/');
    await expect(page.locator('h1')).toHaveText('Harvest and cutting vs carbon balance');
    await expect(page.locator('.dd-kicker .dd-index')).toHaveText('Deep Dive #0');
    await expect(page.locator('.dd-facts .dd-status-note')).toContainText(/AI models|No independent check/);
    expect(await page.locator('h1 + .ai-notice[role="note"]').count()).toBe(1);
    const h2 = await page.locator('main h2').allInnerTexts();
    expect(h2).toEqual(['Question', 'Short answer', 'Data and method', 'Results', 'Limits and uncertainty', 'References', 'Reproduce']);
    const figures = page.locator('figure.dd-figure svg[role="img"]');
    expect(await figures.count()).toBeGreaterThanOrEqual(1);
    for (const svg of await figures.all()) expect((await svg.getAttribute('aria-label'))?.length ?? 0).toBeGreaterThan(40);
    expect(await page.locator('.dd-num').count()).toBeGreaterThan(20);
    // Each citation link goes to an entry of the reference list.
    const hrefs = await page.locator('a[href^="#ref-"]').evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of new Set(hrefs)) await expect(page.locator(`[id="${href.slice(1)}"]`), href).toHaveCount(1);
    // The nav marks the Deep Dives section on a dive page.
    await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Deep Dives' })).toHaveAttribute('aria-current', 'true');
    await expectOnlyUpdateScript(page);
  });

  test('the disturbance dive has the fixed sections, four figures, two tables and numbers from the JSON', async ({ page }) => {
    await page.goto('/deep-dive/disturbance-size/');
    await expect(page.locator('h1')).toHaveText('Size of management disturbances');
    const h2 = await page.locator('main h2').allInnerTexts();
    expect(h2).toEqual(['Question', 'Short answer', 'Data and method', 'Results', 'Limits and uncertainty', 'References', 'Reproduce']);
    const figures = page.locator('figure.dd-figure svg[role="img"]');
    expect(await figures.count()).toBe(4);
    for (const svg of await figures.all()) expect((await svg.getAttribute('aria-label'))?.length ?? 0).toBeGreaterThan(40);
    expect(await page.locator('.dd-num').count()).toBeGreaterThan(60);
    // The kind table and the episode table.
    expect(await page.locator('tr[id^="kind-"]').count()).toBeGreaterThanOrEqual(4);
    expect(await page.locator('tr[id^="episode-"]').count()).toBeGreaterThan(40);
    const hrefs = await page.locator('a[href^="#ref-"]').evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of new Set(hrefs)) await expect(page.locator(`[id="${href.slice(1)}"]`), href).toHaveCount(1);
    // The soil water figure links to the data page with swc and precip.
    const href = (await page.locator('#figure-3 .dd-figure-link a').getAttribute('href')) ?? '';
    const view = JSON.parse(Buffer.from(href.replace(/^\/#view=/, ''), 'base64url').toString('utf8')) as { params: { variables: string[] } };
    expect(view.params.variables).toEqual(['swc', 'precip']);
    await expectOnlyUpdateScript(page);
  });

  test('the natural events dive has the fixed sections, four figures, the tables and numbers from the JSON', async ({ page }) => {
    await page.goto('/deep-dive/natural-events/');
    await expect(page.locator('h1')).toHaveText('Natural events and disturbances');
    const h2 = await page.locator('main h2').allInnerTexts();
    expect(h2).toEqual(['Question', 'Short answer', 'Data and method', 'Results', 'Limits and uncertainty', 'References', 'Reproduce']);
    const figures = page.locator('figure.dd-figure svg[role="img"]');
    expect(await figures.count()).toBe(4);
    for (const svg of await figures.all()) expect((await svg.getAttribute('aria-label'))?.length ?? 0).toBeGreaterThan(40);
    expect(await page.locator('.dd-num').count()).toBeGreaterThan(60);
    // The class table, the period table and the episode table.
    expect(await page.locator('tr[id^="class-"]').count()).toBeGreaterThan(20);
    expect(await page.locator('tr[id^="period-"]').count()).toBeGreaterThan(0);
    expect(await page.locator('tr[id^="event-"]').count()).toBeGreaterThan(0);
    const hrefs = await page.locator('a[href^="#ref-"]').evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of new Set(hrefs)) await expect(page.locator(`[id="${href.slice(1)}"]`), href).toHaveCount(1);
    await expectOnlyUpdateScript(page);
  });

  test('the data page link of a figure opens the same sites and variables', async ({ page }) => {
    await page.goto('/deep-dive/harvest-carbon/');
    const link = page.locator('#figure-1 .dd-figure-link a');
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(/^\/#view=/);
    const view = JSON.parse(Buffer.from(href.replace(/^\/#view=/, ''), 'base64url').toString('utf8')) as { params: { sites: number[]; variables: string[] } };
    expect(view.params.sites).toEqual([3, 4, 5]);
    expect(view.params.variables).toEqual(['nee_f', 'gpp', 'reco']);
    await link.click();
    await waitReady(page);
    const params = await viewParams(page);
    expect(params.sites).toEqual([3, 4, 5]);
    expect(params.aggregation).toBe('day');
  });

  test('no horizontal page scroll at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/deep-dive/', '/deep-dive/harvest-carbon/', '/deep-dive/disturbance-size/', '/deep-dive/natural-events/']) {
      await page.goto(path);
      const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('AI notice', () => {
  for (const path of ['/calculated/', '/variables/', '/events/', '/data-report/', '/deep-dive/', '/deep-dive/harvest-carbon/']) {
    test(`${path} shows the AI notice below the h1`, async ({ page, baseURL }) => {
      const foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
      await page.goto(path);
      const note = page.locator('header .ai-notice[role="note"]');
      await expect(note).toHaveCount(1);
      await expect(note).toBeVisible();
      await expect(note).toContainText('AI-generated content');
      expect(await page.locator('h1 + .ai-notice').count()).toBe(1);
      expect(foreign).toEqual([]);
    });
  }

  test('the data page has no AI notice', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ai-notice')).toHaveCount(0);
  });
});

// ---------- Month range, events option and PNG without the zoom slider ----------

/** A raw timeseries view of Haltiala (site 3) for the given period. */
function periodView(id: string, params: Record<string, unknown>) {
  return {
    id,
    name: `Period ${id}`,
    params: { sites: [3], variables: ['ta'], xVariable: 'ta', yearFrom: 2022, yearTo: 2022, aggregation: 'raw', ...params },
    diagrams: [{ id: 't1', type: 'timeseries' }],
  };
}

/** First and last time (ISO text, site local time) in the time series datasets of the first card. */
async function timeRange(page: Page): Promise<{ min: string; max: string; n: number }> {
  return page.locator('.diagram-chart').first().evaluate((el) => {
    const c = (el as unknown as { __chart: { getOption(): { dataset: Array<{ source: { t: ArrayLike<number> } }> } } }).__chart;
    let min = Infinity;
    let max = -Infinity;
    let n = 0;
    for (const d of c.getOption().dataset) {
      for (const t of Array.from(d.source.t)) {
        min = Math.min(min, t);
        max = Math.max(max, t);
        n++;
      }
    }
    return { min: new Date(min).toISOString(), max: new Date(max).toISOString(), n };
  });
}

interface ViewHook {
  __inar: { view(): { params: Record<string, unknown> } };
}

const viewParams = (page: Page) => page.evaluate(() => (globalThis as unknown as ViewHook).__inar.view().params);

test.describe('month range and events', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('month selects limit the rows to the period', async ({ page }) => {
    await page.goto('/' + viewHash(periodView('p1', { monthFrom: 4, monthTo: 6 })));
    await waitReady(page);
    await expect(page.locator('select[name="monthFrom"]')).toHaveValue('4');
    await expect(page.locator('select[name="monthTo"]')).toHaveValue('6');
    await expect(page.locator('select[name="monthFrom"] option')).toHaveCount(13);
    const r = await timeRange(page);
    expect(r.min >= '2022-04-01T00:00:00.000Z').toBe(true);
    expect(r.max < '2022-07-01T00:00:00.000Z').toBe(true);
    // 30-min rows of April to June: 91 days.
    expect(r.n).toBeLessThanOrEqual(91 * 48);
    expect(r.n).toBeGreaterThan(80 * 48);
    await expect(page.locator('.diagram').first()).toHaveAttribute('data-rows', String(r.n));
    expect(await page.locator('.diagram figcaption').first().textContent()).toContain('Apr to Jun 2022');

    // Change the form: from month "All" gives January to June.
    await page.locator('select[name="monthFrom"]').selectOption('');
    await expect(page.locator('.diagram').first()).not.toHaveAttribute('data-rows', String(r.n), { timeout: READY_TIMEOUT });
    await waitReady(page);
    const r2 = await timeRange(page);
    expect(r2.min < '2022-01-02T00:00:00.000Z').toBe(true);
    expect(r2.max < '2022-07-01T00:00:00.000Z').toBe(true);
    expect((await viewParams(page)).monthFrom).toBeNull();
  });

  test('a period with the start after the end is put in order', async ({ page }) => {
    await page.goto('/' + viewHash(periodView('p2', { yearFrom: 2023, yearTo: 2022, monthFrom: 2, monthTo: 11 })));
    await waitReady(page);
    const p = await viewParams(page);
    expect([p.yearFrom, p.monthFrom, p.yearTo, p.monthTo]).toEqual([2022, 11, 2023, 2]);
    const r = await timeRange(page);
    expect(r.min >= '2022-11-01T00:00:00.000Z').toBe(true);
    expect(r.max < '2023-03-01T00:00:00.000Z').toBe(true);
  });

  test('a view without the new keys loads with the defaults', async ({ page }) => {
    const old = periodView('p3', {});
    await page.goto('/' + viewHash(old));
    await waitReady(page);
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Period p3');
    const p = await viewParams(page);
    expect(p.monthFrom).toBeNull();
    expect(p.monthTo).toBeNull();
    expect(p.events).toBe(false);
    await expect(page.locator('select[name="monthFrom"]')).toHaveValue('');
    await expect(page.locator('input[name="events"]')).not.toBeChecked();
  });

  test('the events checkbox changes the view parameters', async ({ page }) => {
    await page.goto('/' + viewHash(periodView('p4', {})));
    await waitReady(page);
    const box = page.getByRole('checkbox', { name: /^Events/ });
    await expect(box).toBeVisible();
    await box.check();
    await expect.poll(async () => (await viewParams(page)).events).toBe(true);
    await waitReady(page);
    await box.uncheck();
    await expect.poll(async () => (await viewParams(page)).events).toBe(false);

    // A view with events: true keeps it.
    await page.goto('/' + viewHash(periodView('p5', { events: true })));
    await waitReady(page);
    await expect(page.locator('input[name="events"]')).toBeChecked();
  });

  test('the events info lists only the sites with events', async ({ page }) => {
    await page.goto('/' + viewHash(periodView('p9', {})));
    await waitReady(page);
    const btn = page.getByRole('button', { name: 'About the events' });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    const info = page.locator('#var-info-events');
    await expect(info).toBeVisible();
    const codes = await info.locator('li[data-site]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.site));
    expect(codes.sort()).toEqual(['haltiala', 'qvidja', 'viikki']);
    await expect(info.locator('li[data-site="qvidja"]')).toContainText('yield');
    await expect(info.getByRole('link', { name: 'All events' })).toHaveAttribute('href', /\/events\/$/);
    // The button does not change the checkbox.
    await expect(page.locator('input[name="events"]')).not.toBeChecked();
  });

  test('a harvest marker label shows the yield', async ({ page }) => {
    // Qvidja 2022: silage harvest on 2022-06-21, 868 kg DW/ha.
    await page.goto('/' + viewHash(periodView('p10', { sites: [4], events: true })));
    await waitReady(page);
    const labels = await page.locator('.diagram-chart').first().evaluate((el) => {
      type Mark = { label?: { formatter?: string } };
      const c = (el as unknown as { __chart: { getOption(): { series: Array<{ markLine?: { data?: Mark[] } }> } } }).__chart;
      return c.getOption().series.flatMap((s) => (s.markLine?.data ?? []).map((d) => d.label?.formatter ?? ''));
    });
    expect(labels).toContain('H 0.9 t');
  });

  test('data file name has the months only when they are set', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/' + viewHash(periodView('p6', { yearTo: 2023, monthFrom: 3, monthTo: 10 })));
    await waitReady(page);
    await page.locator('[data-action="data"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.locator('[data-export="one-csv"]').click()]);
    expect(dl.suggestedFilename()).toBe('inar-agri_period-p6_2022-03-2023-10_raw.csv');
  });

  test('timeseries PNG has no zoom slider band', async ({ page }) => {
    await page.goto('/' + viewHash(periodView('p7', {})));
    await waitReady(page);
    const chart = page.locator('.diagram-chart').first();
    const h = await chart.evaluate((el) => el.clientHeight);
    const w = await chart.evaluate((el) => el.clientWidth);
    // The slider stays on the page.
    const sliders = await chart.evaluate(
      (el) =>
        (el as unknown as { __chart: { getOption(): { dataZoom: Array<{ type: string }> } } }).__chart
          .getOption()
          .dataZoom.filter((d) => d.type === 'slider').length,
    );
    expect(sliders).toBe(1);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    const { png } = await exportPng(page, 0, 2);
    expect(pngWidth(png)).toBe(2 * 1200);
    // White rows at the bottom of the image: only the bottom margin (24 px) and the space below
    // the x axis name. With the 32 px slider band, there would be more.
    const blank = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let y = c.height - 1; y >= 0; y--) {
        for (let x = 0; x < c.width; x++) {
          const i = 4 * (y * c.width + x);
          if ((d[i] as number) < 240 || (d[i + 1] as number) < 240 || (d[i + 2] as number) < 240) return c.height - 1 - y;
        }
      }
      return c.height;
    }, `data:image/png;base64,${png.toString('base64')}`);
    expect(blank / 2).toBeLessThan(24 + 24);
  });
});

/** A Qvidja (site 4) view of 2022 with the given diagram types and events on or off. */
function eventsView(id: string, sites: number[], events: boolean, types: string[] = ['timeseries', 'cumulative']) {
  return {
    id,
    name: `Events ${id}`,
    params: { sites, variables: ['nee_f', 'ta'], xVariable: 'ta', yearFrom: 2022, yearTo: 2022, aggregation: 'day', events },
    diagrams: types.map((type, i) => ({ id: `e${i}`, type })),
  };
}

/** x values (epoch ms) of the markLine data of all series of diagram `index`. */
async function markLineXs(page: Page, index: number): Promise<number[]> {
  return page
    .locator('.diagram-chart')
    .nth(index)
    .evaluate((el) => {
      type S = { markLine?: { data?: Array<{ xAxis: number }> } };
      const c = (el as unknown as { __chart: { getOption(): { series: S[] } } }).__chart;
      return c.getOption().series.flatMap((s) => (s.markLine?.data ?? []).map((d) => d.xAxis));
    });
}

const altOf = async (page: Page, index: number) => (await page.locator('.diagram-alt p').nth(index).textContent()) ?? '';

test.describe('events', () => {
  let errors: string[];
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    errors = trackErrors(page);
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test('events on: timeseries and cumulative have markers of Qvidja 2022', async ({ page }) => {
    await page.goto('/' + viewHash(eventsView('ev1', [4], true)));
    await waitReady(page);
    // Timeseries: real time axis. Qvidja harvest on 2022-06-21.
    const ts = await markLineXs(page, 0);
    expect(ts).toContain(Date.UTC(2022, 5, 21));
    // Cumulative: day of the year on the reference year 2000.
    const cum = await markLineXs(page, 1);
    expect(cum).toContain(Date.UTC(2000, 5, 21));
    // The markers do not change the series count.
    await expect(page.locator('.diagram').nth(0)).toHaveAttribute('data-series', '2');
    await expect(page.locator('.diagram').nth(1)).toHaveAttribute('data-series', '1');
    for (const i of [0, 1]) {
      const alt = await altOf(page, i);
      expect(alt).toContain('Management events at Qvidja');
      expect(alt).toContain('harvest 2022-06-21');
      expect(alt).toContain('grazing 2022-06-01 to 2022-06-15');
    }
    await expect(page.locator('.diagram-sub').first()).toContainText('Event markers');
  });

  test('events on for Anttila only: alt text says no events', async ({ page }) => {
    await page.goto('/' + viewHash(eventsView('ev2', [1], true)));
    await waitReady(page);
    expect(await markLineXs(page, 0)).toEqual([]);
    expect(await altOf(page, 0)).toContain('No management events for the selected sites in this period.');
  });

  test('events on: types without markers still get the alt text sentence', async ({ page }) => {
    await page.goto('/' + viewHash(eventsView('ev3', [4], true, ['monthly'])));
    await waitReady(page);
    expect(await markLineXs(page, 0)).toEqual([]);
    expect(await altOf(page, 0)).toContain('harvest 2022-06-21');
  });

  test('events off: no markers and no events in the alt text', async ({ page }) => {
    await page.goto('/' + viewHash(eventsView('ev4', [4], false, ['timeseries', 'cumulative', 'years', 'yearPanels'])));
    await waitReady(page);
    for (const i of [0, 1, 2, 3]) {
      expect(await markLineXs(page, i)).toEqual([]);
      expect(await altOf(page, i)).not.toContain('Management events');
    }
  });
});

test.describe('site emojis', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('emojis on: the legend and the alt text start the site names with the emoji', async ({ page }) => {
    const view = {
      id: 'em1',
      name: 'Emojis',
      params: { sites: [3, 4], variables: ['nee_f'], xVariable: 'ta', yearFrom: 2022, yearTo: 2022, aggregation: 'day', emojis: true },
      diagrams: [{ id: 'd1', type: 'timeseries' }],
    };
    await page.goto('/' + viewHash(view));
    await waitReady(page);
    await expect(page.locator('input[name="emojis"]')).toBeChecked();
    const legend = await page.locator('.diagram-chart').first().evaluate((el) => {
      type Item = string | { name: string };
      const c = (el as unknown as { __chart: { getOption(): { legend: Array<{ data: Item[] }> } } }).__chart;
      return c.getOption().legend.flatMap((l) => l.data.map((d) => (typeof d === 'string' ? d : d.name)));
    });
    expect(legend).toEqual(['🧚🌾 Haltiala', '🐂🐝 Qvidja']);
    const alt = await page.evaluate(() => (globalThis as unknown as { __inar: { altText(t: number): string } }).__inar.altText(0));
    expect(alt).toContain('🐂🐝 Qvidja');
    expect(alt).toContain('🧚🌾 Haltiala');
    expect(alt).toBe(await altOf(page, 0));
  });

  test('default view: no emoji in the alt text, and the checkbox is off', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await expect(page.locator('input[name="emojis"]')).not.toBeChecked();
    const alt = await page.evaluate(() => (globalThis as unknown as { __inar: { altText(t: number): string } }).__inar.altText(0));
    expect(alt).toContain('Qvidja');
    expect(alt).not.toContain('🐂🐝');
    expect(alt).not.toContain('🧚🌾');
  });
});

const AXIS_RANGES_FILE = 'site/src/data/axis-ranges.json';

/** Min and max of the y axes of the first diagram, and the `scale` setting. */
async function yAxes(page: Page): Promise<Array<{ min: unknown; max: unknown; scale: unknown }>> {
  return page.locator('.diagram-chart').first().evaluate((el) => {
    const c = (el as unknown as { __chart: { getOption(): { yAxis: Array<{ min: unknown; max: unknown; scale: unknown }> } } }).__chart;
    return c.getOption().yAxis.map((a) => ({ min: a.min, max: a.max, scale: a.scale }));
  });
}

function rangeView(id: string, sites: number[], fixedY?: boolean) {
  return {
    id,
    name: `Range ${id}`,
    params: { sites, variables: ['nee_f', 'ta'], xVariable: 'ta', yearFrom: 2022, yearTo: 2022, aggregation: 'day', ...(fixedY === undefined ? {} : { fixedY }) },
    diagrams: [{ id: 'd1', type: 'timeseries' }],
  };
}

test.describe('fixed y range', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = trackErrors(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('on (default): the time series y axes use the range of all data, the same for one site and all sites', async ({ page }) => {
    const ranges = JSON.parse(await readFile(AXIS_RANGES_FILE, 'utf8')) as { step: Record<string, Record<string, [number, number]>> };
    const expected = (['nee_f', 'ta'] as const).map((v) => {
      const r = niceRange(ranges.step.day![v]!);
      return { min: r.min, max: r.max, scale: false };
    });
    // A view without the key gets the fixed range.
    await page.goto('/' + viewHash(rangeView('fy1', [4])));
    await waitReady(page);
    await expect(page.locator('input[name="fixedY"]')).toBeChecked();
    expect(await yAxes(page)).toEqual(expected);
    const alt = await altOf(page, 0);
    expect(alt).toContain('range of all sites and years');

    // A full page load, so that the ready state is of the new view.
    await page.goto('about:blank');
    await page.goto('/' + viewHash(rangeView('fy2', [1, 2, 3, 4, 5, 6], true)));
    await waitReady(page);
    expect(await yAxes(page)).toEqual(expected);
  });

  test('off: the y axes use the range of the loaded rows', async ({ page }) => {
    await page.goto('/' + viewHash(rangeView('fy3', [4], false)));
    await waitReady(page);
    await expect(page.locator('input[name="fixedY"]')).not.toBeChecked();
    const axes = await yAxes(page);
    expect(axes.map((a) => a.scale)).toEqual([true, true]);
    expect(await altOf(page, 0)).not.toContain('range of all sites and years');
    // The checkbox turns the fixed range on.
    await page.locator('input[name="fixedY"]').check();
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'ready', { timeout: READY_TIMEOUT });
    await expect.poll(async () => (await yAxes(page)).map((a) => a.scale)).toEqual([false, false]);
  });
});

test.describe('loading bar', () => {
  test('shows a progress bar while the data loads and removes it when ready', async ({ page }) => {
    const errors = trackErrors(page);
    // Hold back one data file, so that the bar stays on the page for some time.
    await page.route('**/data/observations.parquet', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto('/');
    const loader = page.locator('#loader[role="progressbar"]');
    await expect(loader).toBeVisible();
    await expect(page.getByText('Loading data…')).toHaveCount(0);
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'ready', { timeout: READY_TIMEOUT });
    await expect(page.locator('#loader')).toHaveCount(0);
    await expect(page.locator('#status')).toContainText('Loaded in');
    expect(errors).toEqual([]);
  });
});

test.describe('update notice and error recovery', () => {
  let foreign: string[];

  test.beforeEach(async ({ page, baseURL }) => {
    foreign = await isolate(page, new URL(baseURL ?? 'http://localhost:4321').origin);
  });

  test.afterEach(() => {
    expect(foreign).toEqual([]);
  });

  test('a new build time in version.json shows the notice; Later hides it, Reload reloads', async ({ page }) => {
    const errors = trackErrors(page);
    await page.route('**/version.json*', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ time: 1, commit: 'other' }) }),
    );
    // A text page: the notice is on all pages (Base.astro).
    await page.goto('/events/');
    const notice = page.locator('.update-notice');
    // The first check runs 5 s after the load.
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toContainText('A new version of this site is available.');
    // The notice does not take the focus.
    expect(await page.evaluate(() => document.activeElement?.closest('.update-notice') ?? null)).toBeNull();

    await notice.getByRole('button', { name: 'Later' }).click();
    await expect(notice).toBeHidden();

    // Back from another tab: a new check, but the notice stays hidden until the next page load.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(notice).toBeHidden();

    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    await page.reload();
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await Promise.all([page.waitForEvent('load'), notice.getByRole('button', { name: 'Reload' }).click()]);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('the same build time in version.json shows no notice', async ({ page }) => {
    const errors = trackErrors(page);
    const checked = page.waitForResponse((res) => new URL(res.url()).pathname.endsWith('/version.json'), {
      timeout: 15_000,
    });
    await page.goto('/variables/');
    const res = await checked;
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toContain('json');
    const body = (await res.json()) as { time: number; commit: string };
    expect(typeof body.time).toBe('number');
    // Give the page time to handle the response.
    await page.waitForTimeout(500);
    await expect(page.locator('.update-notice')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a load error shows the recovery box; the button clears the site data and reloads', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('inar-agri.views', '{"version":1,"views":[]}');
        localStorage.setItem('inar-agri.views.bak', 'old');
        sessionStorage.setItem('inar-agri.test', 'x');
        localStorage.setItem('other-site.key', 'keep');
      }
    });
    await page.route('**/data/observations.parquet*', (route) => route.fulfill({ status: 500, body: 'error' }));
    await page.goto('/');
    await expect(page.locator('#chart')).toHaveAttribute('data-status', 'error', { timeout: READY_TIMEOUT });
    await expect(page.locator('#status')).toContainText('Cannot show the data');
    const box = page.locator('#recovery');
    await expect(box).toBeVisible();
    await expect(box).toContainText('Clear the saved views and the cache, then reload the page.');
    await expect(box).toContainText('If the error stays, do a hard reload:');
    // Headless Chromium on Linux: Ctrl + Shift + R or Ctrl + F5.
    await expect(box.locator('kbd')).toHaveText(['Ctrl', 'Shift', 'R', 'Ctrl', 'F5']);

    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    await Promise.all([
      page.waitForEvent('load'),
      box.getByRole('button', { name: 'Clear site data and reload' }).click(),
    ]);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
    const stored = await page.evaluate(() => ({
      views: localStorage.getItem('inar-agri.views'),
      bak: localStorage.getItem('inar-agri.views.bak'),
      session: sessionStorage.getItem('inar-agri.test'),
      other: localStorage.getItem('other-site.key'),
    }));
    expect(stored).toEqual({ views: null, bak: null, session: null, other: 'keep' });
  });
});
