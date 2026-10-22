// Astro configuration for the data website.
// Run Astro with `--root site`. See package.json scripts.
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

/** Commit of the build, or 'unknown' when git is not available. */
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Build ID: one value per build. The page compares it with dist/version.json
// to find a new deploy (site/src/scripts/update.ts).
const BUILD = { time: Math.floor(Date.now() / 1000), commit: gitCommit() };

/** Write dist/version.json after the build. `astro dev` writes no file: the update check stays silent. */
const versionFile = {
  name: 'inar-version-file',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      await writeFile(new URL('version.json', dir), `${JSON.stringify(BUILD)}\n`);
    },
  },
};

export default defineConfig({
  output: 'static',
  // MDX: the Deep Dive articles (site/src/pages/deep-dive/*.mdx).
  integrations: [mdx(), versionFile],
  vite: {
    define: {
      __BUILD_TIME__: JSON.stringify(BUILD.time),
      __BUILD_COMMIT__: JSON.stringify(BUILD.commit),
    },
    // DuckDB-WASM loads its own worker and WASM files.
    // Do not let Vite pre-bundle it.
    optimizeDeps: {
      exclude: ['@duckdb/duckdb-wasm'],
    },
  },
});
