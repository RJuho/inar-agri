import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayNumber } from './harvest.ts';
import { harvestGroup, mergeHarvestEpisodes, yieldPerEvent, type HarvestEvent } from './harvest-groups.ts';

const ev = (site: string, date: string, type: string, crop: string | null, detail: string, dateEnd: string | null = null): HarvestEvent => ({
  site,
  date,
  dateEnd,
  type,
  crop,
  detail,
  dryMassKgHa: null,
});

test('harvestGroup separates silage, cleaning cut and grain', () => {
  assert.equal(harvestGroup('cut', null, 'Cleaning cut (puhdistusniitto), not removed'), 'cleaningCut');
  assert.equal(harvestGroup('harvest', 'Silage', 'Silage, whole crop'), 'silageHarvest');
  assert.equal(harvestGroup('harvest', 'Barley', 'Barley, 7187 kg DW/ha'), 'grainHarvest');
  assert.equal(harvestGroup('harvest', 'Barley', 'Threshing, no baling'), 'grainHarvest');
  assert.equal(harvestGroup('harvest', 'Faba beans', 'Faba beans; yield of the year'), 'grainHarvest');
  assert.equal(harvestGroup('harvest', 'Oats', 'Oats, 3608 kg/ha'), 'grainHarvest');
  // Barley with grass undersown and cut: silage.
  assert.equal(harvestGroup('harvest', 'Barley, clover and grasses', 'Barley, clover and grasses, first cut'), 'silageHarvest');
  assert.equal(harvestGroup('harvest', 'Legume grass', 'Grass, first cut'), 'silageHarvest');
});

test('yieldPerEvent is false for the yield of the year', () => {
  assert.equal(yieldPerEvent('Timothy, second cut; yield of the year 3673 kg DW/ha'), false);
  assert.equal(yieldPerEvent('Silage, whole crop, 7652 kg/ha fresh, DM 0.406'), true);
});

test('mergeHarvestEpisodes merges within 7 days, sets the group and the co-events', () => {
  const eps = mergeHarvestEpisodes([
    ev('q', '2023-06-19', 'cut', null, 'Cleaning cut'),
    ev('q', '2023-06-20', 'harvest', 'Silage', 'Silage, whole crop'),
    ev('q', '2023-05-01', 'fertilisation', null, 'Manure'),
    ev('q', '2024-07-18', 'cut', null, 'Cleaning cut'),
    ev('q', '2024-08-09', 'cut', null, 'Cleaning cut'),
    ev('v', '2023-08-17', 'harvest', 'Barley, clover and grasses', 'first cut'),
    ev('v', '2023-08-24', 'harvest', 'Barley, clover and grasses', 'second cut'),
    ev('v', '2023-09-01', 'harvest', 'Barley, clover and grasses', 'third cut'),
  ]);
  assert.equal(eps.length, 5);
  const [q23, q24a, q24b, v23, v23b] = eps;
  assert.equal(q23!.group, 'silageHarvest');
  assert.equal(q23!.start, dayNumber('2023-06-19'));
  assert.equal(q23!.end, dayNumber('2023-06-20'));
  assert.deepEqual(q23!.coEvents.map((e) => e.type), ['cut']);
  assert.equal(q24a!.group, 'cleaningCut');
  assert.equal(q24b!.group, 'cleaningCut');
  // 17 Aug and 24 Aug (7 days) merge; 1 Sep is 8 days after 24 Aug: a new episode.
  assert.equal(v23!.events.length, 2);
  assert.equal(v23!.end, dayNumber('2023-08-24'));
  assert.equal(v23b!.start, dayNumber('2023-09-01'));
});

test('mergeHarvestEpisodes uses date_end, the grain group and the overrides', () => {
  const eps = mergeHarvestEpisodes(
    [
      ev('h', '2021-09-10', 'harvest', 'Barley', 'harvest started 8 Sep'),
      ev('h', '2021-09-15', 'harvest', 'Barley', 'Threshing'),
      ev('h', '2022-08-15', 'harvest', 'Oats', 'Oats, threshing', '2022-08-24'),
    ],
    [{ site: 'h', date: '2021-09-15', start: '2021-09-08', text: 'start from the file text' }],
  );
  assert.equal(eps.length, 2);
  assert.equal(eps[0]!.start, dayNumber('2021-09-08'));
  assert.equal(eps[0]!.recorded, dayNumber('2021-09-10'));
  assert.equal(eps[0]!.end, dayNumber('2021-09-15'));
  assert.deepEqual(eps[0]!.overrides, ['start from the file text']);
  assert.equal(eps[0]!.group, 'grainHarvest');
  assert.equal(eps[1]!.end, dayNumber('2022-08-24'));
  assert.deepEqual(eps[1]!.overrides, []);
  assert.throws(() => mergeHarvestEpisodes([ev('h', '2021-09-10', 'harvest', 'Barley', '')], [{ site: 'h', date: '2020-01-01', text: 'x' }]));
});
