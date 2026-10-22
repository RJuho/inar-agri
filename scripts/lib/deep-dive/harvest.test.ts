import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dayNumber,
  delta,
  eventLevelYield,
  exclusion,
  isoDay,
  mergeEpisodes,
  windowFree,
  windowStats,
  type DayRow,
  type FieldEvent,
  type Rules,
} from './harvest.ts';

const ev = (site: string, date: string, extra: Partial<FieldEvent> = {}): FieldEvent => ({
  site,
  date,
  dateEnd: null,
  type: 'harvest',
  crop: null,
  dryMassKgHa: null,
  detail: '',
  ...extra,
});

test('dayNumber and isoDay are inverse', () => {
  assert.equal(dayNumber('1970-01-02'), 1);
  assert.equal(isoDay(dayNumber('2024-02-29')), '2024-02-29');
});

test('mergeEpisodes joins close events of one site and keeps sites apart', () => {
  const eps = mergeEpisodes([
    ev('a', '2023-06-20', { dryMassKgHa: 300 }),
    ev('a', '2023-06-19', { type: 'cut' }),
    ev('a', '2023-08-21'),
    ev('b', '2023-06-22'),
    ev('a', '2023-08-10', { dateEnd: '2023-08-15' }),
  ]);
  assert.deepEqual(
    eps.map((e) => [e.site, isoDay(e.start), isoDay(e.end), e.events.length]),
    [
      ['a', '2023-06-19', '2023-06-20', 2],
      ['a', '2023-08-10', '2023-08-21', 2],
      ['b', '2023-06-22', '2023-06-22', 1],
    ],
  );
  assert.equal(eps[0]!.yieldKgHa, 300);
  assert.equal(eps[1]!.yieldKgHa, null);
});

test('a yield of the year is not an event-level yield', () => {
  const year = ev('v', '2022-08-27', { dryMassKgHa: 3673, detail: 'Timothy, second cut; yield of the year 3673 kg DW/ha' });
  assert.equal(eventLevelYield(year), false);
  assert.equal(eventLevelYield(ev('q', '2019-06-10', { dryMassKgHa: 3106.7 })), true);
  const [first, second] = mergeEpisodes([ev('v', '2022-07-01'), year]);
  assert.equal(second!.yieldKgHa, null, 'two episodes in the year: the yield of the year is not used');
  assert.equal(second!.yearYieldKgHa, 3673);
  assert.equal(first!.yieldKgHa, null);
  const [only] = mergeEpisodes([{ ...year, date: '2025-09-10' }]);
  assert.equal(only!.yieldKgHa, 3673, 'one episode in the year: the yield of the year is the yield of the episode');
});

/** Days 0 to 59: NEE -2 before day 30, +1 from day 30; frac 0.5, GPP 5, Reco 3. */
function series(missing: number[] = []): Map<number, DayRow> {
  const m = new Map<number, DayRow>();
  for (let d = 0; d < 60; d++) {
    if (missing.includes(d)) continue;
    m.set(d, { day: d, nee: d < 30 ? -2 : 1, gpp: 5, reco: 3, frac: 0.5, ta: d < 30 ? 10 : 12 });
  }
  return m;
}

test('windowStats gives the means of the days in the window', () => {
  const s = series([20]);
  const before = windowStats(s, 30, { from: -14, to: -1 });
  assert.equal(before.days, 14);
  assert.equal(before.nDays, 13);
  assert.equal(before.nee, -2);
  assert.equal(before.ta, 10);
  const after = windowStats(s, 30, { from: 1, to: 14 });
  assert.equal(after.nee, 1);
  assert.equal(delta(after.nee, before.nee), 3);
  assert.equal(delta(null, 1), null);
});

test('exclusion rules: overlap, too few days, low measured fraction', () => {
  const rules: Rules = { before: { from: -14, to: -1 }, after: { from: 1, to: 14 }, minDays: 12, minFrac: 0.1 };
  const eps = mergeEpisodes([ev('a', '1970-01-31'), ev('a', '1970-02-12')]);
  const s = series();
  const w = (anchor: number, from: number, to: number) => windowStats(s, anchor, { from, to });
  const [e1, e2] = eps;
  assert.equal(exclusion(e1!, eps, w(e1!.start, -14, -1), w(e1!.end, 1, 14), rules), 'overlap');
  const alone = [e1!];
  assert.equal(exclusion(e1!, alone, w(e1!.start, -14, -1), w(e1!.end, 1, 14), rules), null);
  const gappy = series([31, 32, 33]);
  assert.equal(exclusion(e1!, alone, windowStats(gappy, 30, rules.before), windowStats(gappy, 30, rules.after), rules), 'too-few-days');
  const low = new Map([...s].map(([d, r]) => [d, { ...r, frac: 0.05 }]));
  assert.equal(exclusion(e1!, alone, windowStats(low, 30, rules.before), windowStats(low, 30, rules.after), rules), 'low-measured-fraction');
  assert.equal(windowFree(e1!, eps, { from: 8, to: 28 }), false);
  assert.equal(windowFree(e2!, eps, { from: 8, to: 28 }), true);
});
