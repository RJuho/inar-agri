// Nice axis steps and ranges. This file has no DOM code and no chart code, so Node can run it (unit tests).

/** Nice step near `raw`: 1, 2 or 5 times a power of 10, not smaller than `raw`. */
export function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Axis range rounded outwards to a nice step (1, 2 or 5 times a power of 10), about 4 steps. */
export function niceRange([lo, hi]: [number, number]): { min: number; max: number; interval: number } {
  const span = hi - lo || Math.abs(hi) || 1;
  const step = niceStep(span / 4);
  // Round to remove float noise such as 0.30000000000000004.
  const round = (v: number) => Number(v.toPrecision(12));
  return { min: round(Math.floor(lo / step) * step), max: round(Math.ceil(hi / step) * step), interval: round(step) };
}
