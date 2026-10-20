// Playwright configuration for the end-to-end tests of the data website.
// Run: npm run test:e2e
import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

export default defineConfig({
  testDir: 'tests',
  outputDir: 'test-results',
  // DuckDB-WASM loads a large Parquet file and downloads an extension from the internet.
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
  webServer: {
    // Astro 7.4 runs `astro preview` in the background when it detects an AI agent.
    // That mode does not work with `--root site`. `--ignore-lock` keeps the server in the foreground.
    command: `npm run site:build && npm run site:preview -- --port ${PORT} --ignore-lock`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
