import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayNumber } from './harvest.ts';
import {
  changes,
  classify,
  excessSum,
  fertiliserKind,
  kindOf,
  mergeClassEpisodes,
  periodFree,
  seasonalBaseline,
  shiftYears,
  toClassEvent,
  windowMeans,
  windowSum,
  type ClassEvent,
  type VarRow,
} from './disturbance.ts';

const ev = (site: string, date: string, type: string, extra: Partial<ClassEvent> = {}): ClassEvent =>
  toClassEvent({ site, date, dateEnd: null, type, crop: null, detail: '', dryMassKgHa: null, nKgHa: null, ...extra });

test('classify maps the event types to the four classes', () => {
  assert.equal(classify('harvest'), 'harvest-cut');
  assert.equal(classify('cut'), 'harvest-cut');
  assert.equal(classify('grazing'), 'grazing');
  assert.equal(classify('fertilisation'), 'fertilisation');
  assert.equal(classify('tillage'), 'tillage');
  assert.equal(classify('sowing'), null);
  assert.equal(classify('spraying'), null);
  assert.equal(classify('other'), null);
});

test('fertiliserKind reads the detail text', () => {
  assert.equal(fertiliserKind('Finnish saltpetre (Suomen salpietari), 320 kg/ha'), 'mineral');
  assert.equal(fertiliserKind('Synthetic N fertiliser, 52 kg N/ha, product not given'), 'mineral');
  assert.equal(fertiliserKind('Yara AXAN 27-0-1, 200 kg/ha'), 'mineral');
  assert.equal(fertiliserKind('Viljelijän Typpi 26-S4, 300 kg/ha (78 kg N/ha)'), 'mineral');
  assert.equal(fertiliserKind('CAN mineral fertiliser, 108 kg N/ha'), 'mineral');
  assert.equal(fertiliserKind('Mineral N, 67.5 kg N/ha'), 'mineral');
  assert.equal(fertiliserKind('Mineral fertiliser NPK 23-10-8, 220 kg/ha'), 'mineral');
  assert.equal(fertiliserKind('Manure, 10 m3/ha, south sector'), 'organic');
  assert.equal(fertiliserKind('Own NPK mix 2020 (oma NPK seos), 9380 kg/ha fresh, DM 0.13'), 'organic');
  assert.equal(fertiliserKind('NK molasses, 2800 kg/ha (57 g C/m2)'), 'organic');
  assert.equal(fertiliserKind('Liquid manure, 57.5 kg N/ha'), 'organic');
  // "scan" or "can" inside a word is not the product CAN.
  assert.equal(fertiliserKind('Compost, scanned label, 10 t/ha'), 'organic');
});

test('kindOf gives the fixed kinds and other', () => {
  assert.equal(kindOf(['harvest-cut']), 'harvestCut');
  assert.equal(kindOf(['fertilisation', 'harvest-cut']), 'harvestCutFert');
  assert.equal(kindOf(['grazing']), 'grazing');
  assert.equal(kindOf(['fertilisation']), 'fertilisation');
  assert.equal(kindOf(['tillage']), 'tillage');
  assert.equal(kindOf(['tillage', 'fertilisation']), 'tillageFert');
  assert.equal(kindOf(['tillage', 'harvest-cut']), 'other');
  assert.equal(kindOf(['grazing', 'harvest-cut', 'fertilisation']), 'other');
});

test('mergeClassEpisodes joins close events of any class, skips unclassified types, extends with date_end', () => {
  const eps = mergeClassEpisodes([
    ev('a', '2023-06-20', 'harvest'),
    ev('a', '2023-06-22', 'fertilisation', { detail: 'Mineral N, 50 kg N/ha' }),
    ev('a', '2023-06-21', 'sowing'),
    ev('a', '2023-08-10', 'grazing', { dateEnd: '2023-08-20' }),
    ev('a', '2023-08-26', 'cut'),
    ev('b', '2023-06-22', 'tillage'),
  ]);
  assert.equal(eps.length, 3);
  const [a1, a2, b] = eps;
  assert.equal(a1!.site, 'a');
  assert.equal(a1!.kind, 'harvestCutFert');
  assert.deepEqual(a1!.classes, ['fertilisation', 'harvest-cut']);
  assert.equal(a1!.fert, 'mineral');
  assert.equal(a1!.events.length, 2);
  assert.equal(a1!.end - a1!.start, 2);
  // The cut 6 days after the end of the grazing joins it: kind other.
  assert.equal(a2!.kind, 'other');
  assert.equal(a2!.end, dayNumber('2023-08-26'));
  assert.equal(a2!.fert, null);
  assert.equal(b!.kind, 'tillage');
});

test('mergeClassEpisodes marks mixed fertiliser kinds', () => {
  const eps = mergeClassEpisodes([
    ev('a', '2023-05-01', 'fertilisation', { detail: 'Dry manure, 20 kg N/ha' }),
    ev('a', '2023-05-03', 'fertilisation', { detail: 'Mineral N, 50 kg N/ha' }),
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0]!.kind, 'fertilisation');
  assert.equal(eps[0]!.fert, 'mixed');
});

function days(values: Record<number, VarRow>): Map<number, VarRow> {
  return new Map(Object.entries(values).map(([k, v]) => [Number(k), v]));
}

test('windowMeans, windowSum and changes', () => {
  const byDay = days({ 8: { x: 1, y: null }, 9: { x: 3, y: 2 }, 11: { x: 5, y: 4 }, 12: { x: 7, y: 6 } });
  const before = windowMeans(byDay, 10, { from: -2, to: -1 }, ['x', 'y']);
  assert.equal(before.days, 2);
  assert.deepEqual(before.n, { x: 2, y: 1 });
  assert.deepEqual(before.mean, { x: 2, y: 2 });
  const after = windowMeans(byDay, 10, { from: 1, to: 2 }, ['x', 'y']);
  assert.deepEqual(after.mean, { x: 6, y: 5 });
  assert.deepEqual(changes(after, before, ['x', 'y'], 2), { x: 4, y: null });
  assert.deepEqual(changes(after, before, ['x', 'y'], 1), { x: 4, y: 3 });
  assert.deepEqual(windowSum(byDay, 10, { from: -2, to: 2 }, 'y'), { n: 3, sum: 12 });
  assert.deepEqual(windowSum(byDay, 100, { from: 0, to: 1 }, 'y'), { n: 0, sum: null });
});

test('shiftYears keeps the calendar day and moves 29 February to 1 March', () => {
  assert.equal(shiftYears(dayNumber('2023-06-15'), 1), dayNumber('2024-06-15'));
  assert.equal(shiftYears(dayNumber('2024-02-29'), 1), dayNumber('2025-03-01'));
  assert.equal(shiftYears(dayNumber('2023-06-15'), -2), dayNumber('2021-06-15'));
});

test('periodFree sees overlapping episodes of the same site only', () => {
  const eps = mergeClassEpisodes([ev('a', '2023-06-20', 'harvest', { dateEnd: '2023-06-22' }), ev('b', '2023-06-10', 'harvest')]);
  const d = dayNumber('2023-06-22');
  assert.equal(periodFree(eps, 'a', d, d + 5), false);
  assert.equal(periodFree(eps, 'a', d + 1, d + 5), true);
  assert.equal(periodFree(eps, 'a', d - 10, d - 3), true);
  assert.equal(periodFree(eps, 'b', d, d + 5), true);
});

test('seasonalBaseline uses the free other years only', () => {
  // Site a: an event on 2022-06-10, and events on 2021-06-11 and 2024-06-12. Year 2023 is free.
  // Data: x rises by 1 per day in 2023 (change of a 2-day window pair = 3) and is flat in 2021 and 2024.
  const eps = mergeClassEpisodes([ev('a', '2022-06-10', 'harvest'), ev('a', '2021-06-11', 'harvest'), ev('a', '2024-06-12', 'harvest')]);
  const byDay = new Map<number, VarRow>();
  for (const y of [2021, 2022, 2023, 2024]) {
    const base = dayNumber(`${y}-06-01`);
    for (let k = 0; k < 30; k++) byDay.set(base + k, { x: y === 2023 ? k : 1 });
  }
  const ep = eps.find((e) => e.start === dayNumber('2022-06-10'))!;
  const b = seasonalBaseline(byDay, eps, ep, [2021, 2022, 2023, 2024], ['x'], { from: -2, to: -1 }, { from: 1, to: 2 }, 2, 1);
  assert.deepEqual(b.years, [2023]);
  assert.deepEqual(b.n, { x: 1 });
  assert.deepEqual(b.mean, { x: 3 });
  // With minYears 2 the mean is null.
  const b2 = seasonalBaseline(byDay, eps, ep, [2021, 2022, 2023, 2024], ['x'], { from: -2, to: -1 }, { from: 1, to: 2 }, 2, 2);
  assert.deepEqual(b2.mean, { x: null });
});

test('excessSum scales the mean deviation to the window and needs enough days', () => {
  const byDay = days({ 1: { x: 3 }, 2: { x: 5 }, 3: { x: null }, 4: { x: 4 } });
  // Mean of 3, 5, 4 = 4; minus ref 1 = 3; times 4 days = 12.
  assert.equal(excessSum(byDay, 0, { from: 1, to: 4 }, 'x', 1, 3), 12);
  assert.equal(excessSum(byDay, 0, { from: 1, to: 4 }, 'x', 1, 4), null);
  assert.equal(excessSum(byDay, 0, { from: 1, to: 4 }, 'x', null, 1), null);
});
