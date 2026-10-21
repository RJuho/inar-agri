// Screenshot tool for the data website. It opens the page in headless Chromium,
// waits until all diagrams are ready and saves a PNG image with the alt text.
// AI agents in this project can use it to look at the diagrams.
//
// Run: npm run screenshot -- [options]      (or: node scripts/screenshot.ts [options])
// Help: npm run screenshot -- --help
//
// The page must run first, for example: npm run site:preview -- --ignore-lock
// The PNG comes from window.__inar.exportPng() in the page (same image as the PNG buttons).
// It has the title and the alt text as iTXt chunks. The alt text also goes to <out>.alt.txt.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';

const DEFAULT_URL = 'http://localhost:4321/';
const DEFAULT_OUT = 'screenshots/screenshot.png';

const HELP = `Save a PNG image of diagrams of the INAR agri data website.

Usage: npm run screenshot -- [options]
       node scripts/screenshot.ts [options]

Options:
  --url <url>          Page address. Default: ${DEFAULT_URL}
  --view <json|file>   View to show: JSON text or a JSON file. Missing keys get default values:
                       name "Screenshot", the default parameters (all sites, the five variables
                       nee, nee_f, ta, tsoil, swc, all years, raw), one timeseries diagram.
                       Variable names: nee, nee_f, gpp, reco, gpp_src, reco_src, ch4, ta, sw_in,
                       ppfd, rh, vpd, ustar, tsoil, swc. Steps: raw, day, week, month. Example:
                       '{"params":{"sites":[4],"variables":["nee_f","ta"],"yearFrom":2022,"yearTo":2023,"aggregation":"day"},"diagrams":[{"id":"a","type":"monthly"},{"id":"b","type":"cumulative"}]}'
  --diagram <target>   "all" (default): one image with all diagrams, a header and the alt texts.
                       A number: the diagram at this position (0 = first). Other text: a diagram id.
  --scale <n>          Pixels per CSS pixel, 1 to 6. Default: 3.
  --width <px>         Browser window width. Default: 1400.
  --theme <name>       light (default) or dark.
  --out <file>         PNG file. Default: ${DEFAULT_OUT}
                       The alt text goes to the same path with .alt.txt in place of .png.
  --timeout <s>        Maximum wait for the diagrams, in seconds. Default: 180.
  --list               Print the view, its diagrams (index, id, type) and the diagram types. Save no image.
  --help               Print this text.

Exit codes: 0 = done, 1 = error in the page or a diagram, 2 = bad option or no server.`;

interface ViewInfo {
  id: string;
  name: string;
  params: Record<string, unknown>;
  diagrams: Array<{ index: number; id: string; type: string; title: string; ready: boolean }>;
}

// Code in page.evaluate() runs in the browser. The tsconfig of scripts/ has no DOM types,
// so that code reads the page through these small types.
interface PageGlobal {
  document: { getElementById(id: string): { dataset: Record<string, string | undefined> } | null };
  location: { hash: string };
}

interface Hook {
  view(): ViewInfo;
  exportPng(target: string | number, scale: number): Promise<{ dataUrl: string; alt: string }>;
}

class UsageError extends Error {}

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

async function readView(arg: string): Promise<Record<string, unknown>> {
  const text = arg.trim().startsWith('{') ? arg : await readFile(arg, 'utf8').catch(() => {
    throw new UsageError(`--view: "${arg}" is not JSON text and not a readable file.`);
  });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`--view: bad JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UsageError('--view: give a JSON object.');
  return value as Record<string, unknown>;
}

/** Fill the missing keys of a view with default values. `defaults` are the parameters of the default view. */
function completeView(view: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  const params = typeof view.params === 'object' && view.params !== null ? view.params : {};
  return {
    id: typeof view.id === 'string' ? view.id : 'screenshot',
    name: typeof view.name === 'string' ? view.name : 'Screenshot',
    params: { ...defaults, ...params },
    diagrams: Array.isArray(view.diagrams) ? view.diagrams : [{ id: 'd1', type: 'timeseries' }],
  };
}

/**
 * True when a server answers at `url`. "astro preview" can listen on ::1 only, and
 * fetch() in Node tries 127.0.0.1 only for "localhost". Thus try both addresses.
 */
async function reachable(url: string): Promise<boolean> {
  const u = new URL(url);
  const urls = [u.toString()];
  if (u.hostname === 'localhost') {
    for (const host of ['[::1]', '127.0.0.1']) {
      const v = new URL(url);
      v.hostname = host;
      urls.push(v.toString());
    }
  }
  for (const candidate of urls) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(10000) });
      if (res.status < 500) return true;
    } catch {
      // Try the next address.
    }
  }
  return false;
}

/** Wait until #chart is ready, empty or in error. Returns the status. */
async function waitDiagrams(page: Page, timeoutMs: number): Promise<string> {
  await page.waitForFunction(
    () => {
      const s = (globalThis as unknown as PageGlobal).document.getElementById('chart')?.dataset.status;
      return s === 'ready' || s === 'empty' || s === 'error';
    },
    undefined,
    { timeout: timeoutMs, polling: 200 },
  );
  return (await page.locator('#chart').getAttribute('data-status')) ?? '';
}

/** Width and height from the IHDR chunk of a PNG file. */
function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

async function main(): Promise<void> {
  let opts;
  try {
    opts = parseArgs({
      options: {
        url: { type: 'string' },
        view: { type: 'string' },
        diagram: { type: 'string', default: 'all' },
        scale: { type: 'string', default: '3' },
        width: { type: 'string', default: '1400' },
        theme: { type: 'string', default: 'light' },
        out: { type: 'string', default: DEFAULT_OUT },
        timeout: { type: 'string', default: '180' },
        list: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\nRun with --help for the options.`, 2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const scale = Number(opts.scale);
  const width = Number(opts.width);
  const timeoutMs = Number(opts.timeout) * 1000;
  if (!(scale >= 1 && scale <= 6)) fail('--scale must be a number from 1 to 6.', 2);
  if (!(Number.isInteger(width) && width >= 320 && width <= 8000)) fail('--width must be an integer from 320 to 8000.', 2);
  if (!(timeoutMs > 0)) fail('--timeout must be a positive number of seconds.', 2);
  if (opts.theme !== 'light' && opts.theme !== 'dark') fail('--theme must be light or dark.', 2);
  if (!opts.out.toLowerCase().endsWith('.png')) fail('--out must end with .png.', 2);
  const target: string | number = /^\d+$/.test(opts.diagram) ? Number(opts.diagram) : opts.diagram;

  let viewArg: Record<string, unknown> | null = null;
  try {
    if (opts.view !== undefined) viewArg = await readView(opts.view);
  } catch (err) {
    if (err instanceof UsageError) fail(err.message, 2);
    throw err;
  }

  const url = opts.url ?? DEFAULT_URL;
  if (!(await reachable(url))) {
    const hint =
      opts.url === undefined
        ? '\nStart the site first, in a second shell or in the background:\n' +
          '  npm run site:build && npm run site:preview -- --ignore-lock\n' +
          '(Astro 7.4 sends "astro preview" to the background for AI agents. That mode fails with --root site.\n' +
          '--ignore-lock keeps the server in the foreground.) Or give the page address with --url.'
        : '';
    fail(`No server answers at ${url}.${hint}`, 2);
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: opts.theme,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`page error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console error: ${msg.text()}`);
    });

    await page.goto(url);
    let status = await waitDiagrams(page, timeoutMs);
    if (status === 'error' && !viewArg) throw new Error('The default view has an error.');

    if (viewArg) {
      // Import the view through the URL hash. The page adds it as a tab and removes the hash.
      const defaults = await page.evaluate(() => (globalThis as unknown as { __inar: Hook }).__inar.view().params);
      const view = completeView(viewArg, defaults);
      const hash = '#view=' + Buffer.from(JSON.stringify(view), 'utf8').toString('base64url');
      await page.evaluate((h) => {
        (globalThis as unknown as PageGlobal).location.hash = h;
      }, hash);
      await page.waitForFunction(() => (globalThis as unknown as PageGlobal).location.hash === '', undefined, {
        timeout: 10_000,
      });
      const active = await page.evaluate(() => (globalThis as unknown as { __inar: Hook }).__inar.view());
      if (active.name !== view.name) {
        throw new Error(`The page did not accept the view. Check the keys and values. Active view: "${active.name}".`);
      }
      status = await waitDiagrams(page, timeoutMs);
    }

    const info = await page.evaluate(() => (globalThis as unknown as { __inar: Hook }).__inar.view());

    if (opts.list) {
      const types = await page
        .locator('#add-diagram option')
        .evaluateAll((els) => els.map((e) => (e as unknown as { value: string }).value).filter(Boolean));
      console.log(`View: ${info.name} (id ${info.id}), status ${status}`);
      console.log(`Parameters: ${JSON.stringify(info.params)}`);
      console.log('Diagrams (index, id, type, title):');
      if (info.diagrams.length === 0) console.log('  (none)');
      for (const d of info.diagrams) console.log(`  ${d.index}\t${d.id}\t${d.type}\t${d.title}`);
      console.log(`Diagram types: ${types.join(', ')}`);
      return;
    }

    if (status === 'error') {
      const notes = await page.locator('.diagram[data-status="error"] .diagram-note').allTextContents();
      throw new Error(`A diagram has an error:\n  ${notes.join('\n  ')}`);
    }

    const result = await page.evaluate(
      ([t, s]) => (globalThis as unknown as { __inar: Hook }).__inar.exportPng(t, s),
      [target, scale] as const,
    );
    const png = Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64');
    const altPath = opts.out.replace(/\.png$/i, '.alt.txt');
    await mkdir(dirname(opts.out), { recursive: true });
    await writeFile(opts.out, png);
    await writeFile(altPath, result.alt + '\n', 'utf8');

    const [w, h] = pngSize(png);
    console.log(`View: ${info.name}. Diagram: ${String(target)}. Theme: ${opts.theme}.`);
    console.log(`PNG: ${opts.out} (${w} x ${h} px, ${(png.length / 1024).toFixed(0)} KiB)`);
    console.log(`Alt text: ${altPath} (${result.alt.length} characters)`);
    if (errors.length > 0) {
      console.error(`Errors in the page:\n  ${errors.join('\n  ')}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err), 1));
