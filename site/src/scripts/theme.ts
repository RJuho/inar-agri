// Colour tokens for the charts. The values come from the CSS tokens in global.css,
// so they change with light and dark mode.

export interface Tokens {
  series: string[];
  text: string;
  textMuted: string;
  grid: string;
  axis: string;
  surface: string;
  /** True for EXPORT_TOKENS. The helpers in diagrams/common.ts then use the larger export sizes. */
  export?: boolean;
}

/**
 * Series colours of the PNG export: the Okabe-Ito palette, the same as the light series colours of global.css.
 * Change the export palette here only.
 */
export const EXPORT_SERIES: readonly string[] = [
  '#0072b2',
  '#e69f00',
  '#56b4e9',
  '#cc79a7',
  '#000000',
  '#d55e00',
  '#009e73',
  '#6b5a00',
];

/**
 * Colour tokens of the PNG export: a fixed light set with high contrast. They do not come
 * from CSS, so that the export is the same in light and dark mode.
 */
export const EXPORT_TOKENS: Readonly<Tokens> = Object.freeze({
  series: [...EXPORT_SERIES],
  text: '#000000',
  textMuted: '#262626',
  grid: '#cfcfcf',
  axis: '#404040',
  surface: '#ffffff',
  export: true,
});

export function readTokens(el: HTMLElement): Tokens {
  const css = getComputedStyle(el);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => get(`--series-${i}`)),
    text: get('--text-primary'),
    textMuted: get('--text-secondary'),
    grid: get('--grid-line'),
    axis: get('--axis-line'),
    surface: get('--surface-raised'),
  };
}

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function prefersDark(): boolean {
  return media().matches;
}

/** Call `cb` when the colour scheme changes. Returns a function that stops the calls. */
export function onSchemeChange(cb: (dark: boolean) => void): () => void {
  const m = media();
  const handler = () => cb(m.matches);
  m.addEventListener('change', handler);
  return () => m.removeEventListener('change', handler);
}
