// TeX to HTML + MathML with KaTeX. Runs at build time only (in .astro frontmatter).
// The page then needs no client script for the formulas.
import katex from 'katex';

/** Render a TeX formula. `display = true` gives a centred block formula. A bad formula stops the build. */
export function tex(src: string, display = false): string {
  return katex.renderToString(src, {
    displayMode: display,
    output: 'htmlAndMathml',
    throwOnError: true,
    strict: 'error',
  });
}
