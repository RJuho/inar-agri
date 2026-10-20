// Astro configuration for the data website.
// Run Astro with `--root site`. See package.json scripts.
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  vite: {
    // DuckDB-WASM loads its own worker and WASM files.
    // Do not let Vite pre-bundle it.
    optimizeDeps: {
      exclude: ['@duckdb/duckdb-wasm'],
    },
  },
});
