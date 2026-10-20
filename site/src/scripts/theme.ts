// Colour tokens for the charts. The values come from the CSS tokens in global.css,
// so they change with light and dark mode.

export interface Tokens {
  series: string[];
  text: string;
  textMuted: string;
  grid: string;
  axis: string;
  surface: string;
}

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
