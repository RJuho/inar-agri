// Text of the management events (events.parquet, Meta.events): type labels, marker labels,
// the numbers of an event (yield, carbon, N, parcel area) and the per-site summary of the
// Events option. No ECharts and no DOM, thus the unit test (events.test.ts) runs in Node.

import type { Meta, SiteEvent } from './db';

/** Label of each event type. */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  harvest: 'Harvest',
  cut: 'Cut',
  grazing: 'Grazing',
  fertilisation: 'Fertilisation',
  sowing: 'Sowing',
  tillage: 'Tillage',
  spraying: 'Spraying',
  other: 'Other',
};

/** Short marker label of each event type. It is shown at the top of the marker line. */
export const EVENT_SYMBOLS: Record<string, string> = {
  harvest: 'H',
  cut: 'C',
  grazing: 'G',
  fertilisation: 'F',
  sowing: 'Sw',
  tillage: 'T',
  spraying: 'Sp',
  other: 'O',
};

export const eventLabel = (type: string) => EVENT_TYPE_LABELS[type] ?? type;
export const eventSymbol = (type: string) => EVENT_SYMBOLS[type] ?? '?';

/** Date text of an event: "2022-06-01" or "2022-06-01 to 2022-06-15". */
export function eventDateText(e: SiteEvent): string {
  return e.dateEnd && e.dateEnd !== e.date ? `${e.date} to ${e.dateEnd}` : e.date;
}

/** Short form of an event detail, for the tooltip and the alt text: about `max` characters, cut at a comma. */
export function shortDetail(detail: string, max = 60): string {
  if (detail.length <= max) return detail;
  const parts = detail.split(', ');
  let out = parts[0] as string;
  for (const p of parts.slice(1)) {
    if (out.length + 2 + p.length > max) break;
    out += `, ${p}`;
  }
  return out.length > max + 20 ? `${out.slice(0, max).trimEnd()}…` : `${out}…`;
}

/** Number with at most one decimal, no thousands separator (as in the source files): 3106.7, 108, 0.5. */
export function factNumber(x: number): string {
  return String(Math.round(x * 10) / 10);
}

/** True when the marker label shows the yield (harvest or cut with a dry mass). */
const hasYield = (e: SiteEvent) => e.dryMass !== null && (e.type === 'harvest' || e.type === 'cut');

/**
 * Numbers of an event that the detail text does not always give, for the tooltip and the alt text:
 * yield, carbon, N input and parcel area. Empty when the event has none.
 */
export function eventFacts(e: SiteEvent): string[] {
  const out: string[] = [];
  if (e.dryMass !== null) out.push(`yield ${factNumber(e.dryMass)} kg DW ha⁻¹`);
  if (e.cGm2 !== null) out.push(`carbon ${factNumber(e.cGm2)} g C m⁻²`);
  if (e.nKgHa !== null) out.push(`N input ${factNumber(e.nKgHa)} kg N ha⁻¹`);
  if (e.areaHa !== null) out.push(`parcel ${Math.round(e.areaHa * 100) / 100} ha`);
  return out;
}

/** Text of the marker label: the type symbol, and for a harvest with a yield the yield in t DW/ha, for example "H 3.1 t". */
export function eventMarkLabel(e: SiteEvent): string {
  return hasYield(e) ? `${eventSymbol(e.type)} ${((e.dryMass as number) / 1000).toFixed(1)} t` : eventSymbol(e.type);
}

/** Approximate width in px of a marker label (about 6 px per character at 10 to 11 px, plus padding). */
export function eventMarkLabelWidth(e: SiteEvent): number {
  return eventMarkLabel(e).length * 6 + 6;
}

/** Sentence for the subtitle when a marker label shows a yield. Empty when no event in `events` has one. */
export function yieldKeyText(events: SiteEvent[]): string {
  return events.some(hasYield) ? ' A number after H or C is the yield in t DW ha⁻¹.' : '';
}

/** Name of a count: "1 harvest", "11 harvests". */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One text per site with events: years, number of events per type and the numbers that the events
 * give. Sites without events are not in the list. Order = order of the sites in Meta.
 * Example: "2018–2025, 33 events: harvest 11 (yield 11, carbon 11), cut 6, grazing 5 (animals and days), ..."
 */
export function eventsSummary(meta: Meta): Array<{ siteId: number; text: string }> {
  const out: Array<{ siteId: number; text: string }> = [];
  for (const site of meta.sites) {
    const list = meta.events.filter((e) => e.siteId === site.siteId);
    if (list.length === 0) continue;
    const years = list.map((e) => Number(e.date.slice(0, 4)));
    const y0 = Math.min(...years);
    const y1 = Math.max(...years);
    const types = Object.keys(EVENT_TYPE_LABELS).filter((t) => list.some((e) => e.type === t));
    const parts = types.map((t) => {
      const of = list.filter((e) => e.type === t);
      const count = (f: (e: SiteEvent) => boolean) => of.filter(f).length;
      const extra: string[] = [];
      if (t === 'grazing') {
        if (count((e) => e.amountUnit === 'animals') > 0) extra.push('animals and days');
      } else if (count((e) => e.amount !== null) > 0) {
        extra.push(`amount ${count((e) => e.amount !== null)}`);
      }
      if (count((e) => e.dmFraction !== null) > 0) extra.push(`DM fraction ${count((e) => e.dmFraction !== null)}`);
      if (count((e) => e.dryMass !== null) > 0) extra.push(`yield ${count((e) => e.dryMass !== null)}`);
      if (count((e) => e.nKgHa !== null) > 0) extra.push(`N ${count((e) => e.nKgHa !== null)}`);
      if (count((e) => e.cGm2 !== null) > 0) extra.push(`carbon ${count((e) => e.cGm2 !== null)}`);
      return `${eventLabel(t).toLowerCase()} ${of.length}${extra.length ? ` (${extra.join(', ')})` : ''}`;
    });
    const area = list.filter((e) => e.areaHa !== null).length;
    const crops = list.filter((e) => e.crop !== null).length;
    const tail = [crops > 0 ? `crop or product named for ${crops}` : '', area > 0 ? `parcel area for ${area}` : ''].filter(Boolean);
    out.push({
      siteId: site.siteId,
      text:
        `${y0 === y1 ? y0 : `${y0}–${y1}`}, ${plural(list.length, 'event')}: ${parts.join(', ')}.` +
        (tail.length ? ` ${tail.join('; ').replace(/^./, (c) => c.toUpperCase())}.` : ''),
    });
  }
  return out;
}
