// Pure helpers of the Deep Dive "Management disturbances in detail"
// (scripts/deep-dives/disturbance-detail.ts): the group of a harvest or cut, harvest episodes with a
// table of manual corrections (overrides), and the test for a per-event yield. No I/O.
// Unit test: harvest-groups.test.ts.

import { dayNumber, isoDay } from './harvest.ts';

/**
 * Groups of harvest and cut episodes.
 * - silageHarvest: grass or whole crop is cut and removed from the field.
 * - cleaningCut: grass is cut and left on the field (type `cut` in db/events.parquet).
 * - grainHarvest: grain or beans are threshed (cereals, faba beans).
 */
export const HARVEST_GROUPS = ['silageHarvest', 'cleaningCut', 'grainHarvest'] as const;
export type HarvestGroup = (typeof HARVEST_GROUPS)[number];

export const HARVEST_GROUP_LABELS: Record<HarvestGroup, string> = {
  silageHarvest: 'Silage harvest (grass removed)',
  cleaningCut: 'Cleaning cut (grass left on the field)',
  grainHarvest: 'Grain or bean harvest',
};

const GRAIN_RE = /thresh|grain|faba|\boats\b|barley/i;
const GRASS_RE = /\bcut\b|silage|grass/i;

/**
 * Group of one harvest or cut event. Type `cut` is a cleaning cut. A harvest is a grain harvest when
 * the crop or detail text names threshing, grain, faba beans, oats or barley and does not name a
 * cut, silage or grass. All other harvests are silage harvests.
 */
export function harvestGroup(type: string, crop: string | null, detail: string): HarvestGroup {
  if (type === 'cut') return 'cleaningCut';
  const text = `${crop ?? ''} ${detail}`;
  return GRAIN_RE.test(text) && !GRASS_RE.test(text) ? 'grainHarvest' : 'silageHarvest';
}

/**
 * True when the dry mass of the event is the yield of this event only. The management files of
 * Viikki and the articles of Anttila and Särkisuo give the yield of the year on the last harvest of
 * the year ("yield of the year"); that value is not the yield of one harvest. When the text also gives
 * a per-cut value in kg DW/ha (for example "second cut, 4140 kg DW/ha; yield of the year 7500 kg DM/ha
 * in the paper"), the dry mass is the yield of this cut.
 */
export function yieldPerEvent(detail: string): boolean {
  if (!/yield of the year/i.test(detail)) return true;
  const rest = detail.replace(/yield of the year\s+[\d.]+\s*kg\s*D[WM]\/ha/gi, '');
  return /\d\s*kg\s*DW\/ha/i.test(rest);
}

/** One harvest or cut event of db/events.parquet. */
export interface HarvestEvent {
  site: string;
  date: string;
  dateEnd: string | null;
  type: string;
  crop: string | null;
  detail: string;
  dryMassKgHa: number | null;
}

/**
 * Manual correction of one episode. `date` is the date of one event of the episode. `start` and `end`
 * replace the first and the last day (ISO). `text` tells the reason (shown in the result).
 */
export interface EpisodeOverride {
  site: string;
  date: string;
  start?: string;
  end?: string;
  text: string;
}

export interface HarvestEpisode {
  site: string;
  /** First and last day (day numbers), after the overrides. */
  start: number;
  end: number;
  /** First recorded event date (day number), before the overrides. */
  recorded: number;
  events: HarvestEvent[];
  group: HarvestGroup;
  /** Events of the episode whose own group is not the group of the episode (for example a cut one day before a silage harvest). */
  coEvents: HarvestEvent[];
  /** Override texts that apply, or an empty list. */
  overrides: string[];
}

/** Group of an episode: grain when one event is a grain harvest, else silage when one event is a harvest, else cleaning cut. */
export function episodeGroup(events: readonly HarvestEvent[]): HarvestGroup {
  const gs = events.map((e) => harvestGroup(e.type, e.crop, e.detail));
  if (gs.includes('grainHarvest')) return 'grainHarvest';
  if (gs.includes('silageHarvest')) return 'silageHarvest';
  return 'cleaningCut';
}

/**
 * Merge the harvest and cut events of each site into episodes: an event that starts not more than
 * `mergeDays` after the end of the current episode joins it. Other event types are ignored. Then the
 * overrides apply: an override changes the first or the last day of the episode that contains an
 * event on its `date`. An override that matches no episode is an error (the table is out of date).
 */
export function mergeHarvestEpisodes(events: readonly HarvestEvent[], overrides: readonly EpisodeOverride[] = [], mergeDays = 7): HarvestEpisode[] {
  const sorted = events
    .filter((e) => e.type === 'harvest' || e.type === 'cut')
    .sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
  const out: HarvestEpisode[] = [];
  for (const e of sorted) {
    const start = dayNumber(e.date);
    const end = e.dateEnd ? dayNumber(e.dateEnd) : start;
    const last = out[out.length - 1];
    if (last && last.site === e.site && start - last.end <= mergeDays) {
      last.end = Math.max(last.end, end);
      last.events.push(e);
    } else {
      out.push({ site: e.site, start, end, recorded: start, events: [e], group: 'silageHarvest', coEvents: [], overrides: [] });
    }
  }
  for (const ep of out) {
    ep.group = episodeGroup(ep.events);
    ep.coEvents = ep.events.filter((e) => harvestGroup(e.type, e.crop, e.detail) !== ep.group);
  }
  for (const o of overrides) {
    const ep = out.find((x) => x.site === o.site && x.events.some((e) => e.date === o.date));
    if (!ep) throw new Error(`override ${o.site} ${o.date}: no episode has an event on this date`);
    if (o.start) ep.start = dayNumber(o.start);
    if (o.end) ep.end = dayNumber(o.end);
    if (ep.end < ep.start) throw new Error(`override ${o.site} ${o.date}: end ${isoDay(ep.end)} is before start ${isoDay(ep.start)}`);
    ep.overrides.push(o.text);
  }
  return out;
}
