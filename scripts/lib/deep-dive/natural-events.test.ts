import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayNumber, isoDay } from './harvest.ts';
import {
  classMask,
  detectClasses,
  episodesFromFlags,
  eventDayMask,
  percentileRank,
  periodLabel,
  periodOf,
  poolByPeriod,
  rainSeasons,
  runs,
  type DayRow,
  type DetectOptions,
} from './natural-events.ts';

test('eventDayMask covers -2 to +14 days, both ends included', () => {
  const m = eventDayMask([{ site: 'a', date: '2023-06-10', dateEnd: null }]);
  const set = m.get('a')!;
  assert.equal(set.size, 17);
  assert.ok(set.has(dayNumber('2023-06-08')));
  assert.ok(!set.has(dayNumber('2023-06-07')));
  assert.ok(set.has(dayNumber('2023-06-24')));
  assert.ok(!set.has(dayNumber('2023-06-25')));
});

test('eventDayMask uses date_end of a multi-day event and keeps the sites apart', () => {
  const m = eventDayMask(
    [
      { site: 'a', date: '2023-06-10', dateEnd: '2023-06-12' },
      { site: 'b', date: '2023-01-01', dateEnd: null },
    ],
    1,
    2,
  );
  const a = [...m.get('a')!].sort((x, y) => x - y).map(isoDay);
  assert.deepEqual(a, ['2023-06-09', '2023-06-10', '2023-06-11', '2023-06-12', '2023-06-13', '2023-06-14']);
  assert.deepEqual([...m.get('b')!].sort((x, y) => x - y).map(isoDay), ['2022-12-31', '2023-01-01', '2023-01-02', '2023-01-03']);
  // Overlapping windows do not count a day two times.
  const o = eventDayMask([
    { site: 'a', date: '2023-06-10', dateEnd: null },
    { site: 'a', date: '2023-06-12', dateEnd: null },
  ]);
  assert.equal(o.get('a')!.size, 19);
});

test('runs keeps runs of the minimum length; null and false break a run', () => {
  assert.deepEqual(runs([true, true, false, true, true, true], 3), [{ start: 3, end: 5 }]);
  assert.deepEqual(runs([true, null, true], 1), [
    { start: 0, end: 0 },
    { start: 2, end: 2 },
  ]);
  assert.deepEqual(runs([true, true, undefined, true], 2), [{ start: 0, end: 1 }]);
  assert.deepEqual(runs([], 1), []);
  assert.deepEqual(runs([false, false], 1), []);
});

test('episodesFromFlags: a gap day breaks a run', () => {
  const d0 = dayNumber('2023-07-01');
  const days = [d0, d0 + 1, d0 + 2, d0 + 4, d0 + 5];
  const flags = [true, true, true, true, true];
  assert.deepEqual(episodesFromFlags(days, flags, 2), [
    { start: '2023-07-01', end: '2023-07-03', days: 3 },
    { start: '2023-07-05', end: '2023-07-06', days: 2 },
  ]);
  assert.deepEqual(episodesFromFlags(days, flags, 3), [{ start: '2023-07-01', end: '2023-07-03', days: 3 }]);
  assert.deepEqual(episodesFromFlags([], [], 1), []);
  assert.throws(() => episodesFromFlags([d0], [true, false], 1));
  assert.throws(() => episodesFromFlags([d0 + 1, d0], [true, true], 1));
});

test('periodOf: December goes to the winter of the next year', () => {
  assert.deepEqual(periodOf('2022-12-15'), { period: 'DJF', year: 2023 });
  assert.deepEqual(periodOf('2023-01-31'), { period: 'DJF', year: 2023 });
  assert.deepEqual(periodOf('2023-02-28'), { period: 'DJF', year: 2023 });
  assert.deepEqual(periodOf('2023-03-01'), { period: 'MAM', year: 2023 });
  assert.deepEqual(periodOf('2023-08-31'), { period: 'JJA', year: 2023 });
  assert.deepEqual(periodOf('2023-11-30'), { period: 'SON', year: 2023 });
  assert.throws(() => periodOf('2023-13-01'));
});

test('periodLabel names the winter with both years', () => {
  assert.equal(periodLabel('MAM', 2023), 'spring 2023');
  assert.equal(periodLabel('JJA', 2023), 'summer 2023');
  assert.equal(periodLabel('SON', 2019), 'autumn 2019');
  assert.equal(periodLabel('DJF', 2023), 'winter 2022/23');
  assert.equal(periodLabel('DJF', 2000), 'winter 1999/00');
});

test('percentileRank follows DuckDB percent_rank (0 and 100 at the ends, ties share the rank)', () => {
  const s = [1, 2, 2, 3, 5];
  assert.equal(percentileRank(s, 1), 0);
  assert.equal(percentileRank(s, 5), 100);
  assert.equal(percentileRank(s, 2), 25);
  assert.equal(percentileRank(s, 3), 75);
  assert.equal(percentileRank([7], 7), 0);
  assert.throws(() => percentileRank([], 1));
});

test('classMask joins the bits; dry spell and failed rains share one bit', () => {
  assert.equal(classMask(['frost', 'heat']), 3);
  assert.equal(classMask(['drySpell', 'failedRains']), 16);
  assert.equal(classMask(['zeroCurtain', 'soilWet']), 192);
  assert.equal(classMask([]), 0);
});

const day = (iso: string, x: Partial<DayRow> = {}): DayRow => ({
  day: dayNumber(iso),
  iso,
  taMean: 10,
  taMin: 5,
  taMax: 15,
  precip: 2,
  swc: 0.3,
  swcPct: 50,
  tsoil: 8,
  nee: -1,
  used: true,
  ...x,
});

const FI: DetectOptions = {
  country: 'FI',
  heatC: 25,
  heatWaveDays: 3,
  frostC: 0,
  seasonFrom: 5,
  seasonTo: 9,
  heavyRainMm: 20,
  drySpellDays: 10,
  drySpellMm: 1,
  coldSpellC: -10,
  swcP10: 0.2,
  swcP90: 0.4,
  zeroCurtainBandC: 0.3,
  zeroCurtainDays: 5,
  failedRainSeasons: [
    { id: 'MAM', months: [3, 4, 5] },
    { id: 'SON', months: [9, 10, 11] },
  ],
  minSeasonDays: 70,
  swcQuantile: 0.5,
};

const series = (from: string, n: number, f: (i: number, iso: string) => Partial<DayRow>): DayRow[] =>
  Array.from({ length: n }, (_, i) => {
    const iso = isoDay(dayNumber(from) + i);
    return day(iso, f(i, iso));
  });

test('detectClasses: frost only in the season, heat wave from three days', () => {
  const rows = [
    day('2023-04-30', { taMin: -2 }),
    day('2023-05-01', { taMin: -1 }),
    day('2023-07-01', { taMax: 26 }),
    day('2023-07-02', { taMax: 27, nee: 2 }),
    day('2023-07-03', { taMax: 28, nee: null }),
    day('2023-07-10', { taMax: 30 }),
  ];
  const d = detectClasses(rows, FI);
  const frost = d.episodes.filter((e) => e.class === 'frost');
  assert.deepEqual(frost.map((e) => [e.start, e.peak]), [['2023-05-01', -1]]);
  const heat = d.episodes.filter((e) => e.class === 'heat');
  assert.equal(heat.length, 2);
  assert.equal(heat[0]!.days, 3);
  assert.equal(heat[0]!.heatWave, true);
  assert.equal(heat[0]!.peak, 28);
  assert.deepEqual(heat[0]!.nee, { n: 2, mean: 0.5, sd: Math.sqrt(4.5) });
  assert.equal(heat[1]!.heatWave, false);
  assert.ok(d.flags.get(dayNumber('2023-07-02'))!.has('heat'));
  assert.equal(d.flags.get(dayNumber('2023-04-30')), undefined);
});

test('detectClasses: dry spell needs ten days in May to September; a missing rain day breaks it', () => {
  const dry = series('2023-06-01', 12, () => ({ precip: 0.2 }));
  assert.deepEqual(
    detectClasses(dry, FI).episodes.filter((e) => e.class === 'drySpell').map((e) => [e.start, e.end, e.peak]),
    [['2023-06-01', '2023-06-12', 12]],
  );
  const broken = series('2023-06-01', 12, (i) => ({ precip: i === 6 ? null : 0.2 }));
  assert.equal(detectClasses(broken, FI).episodes.filter((e) => e.class === 'drySpell').length, 0);
  // The season ends on 30 September.
  const late = series('2023-09-25', 12, () => ({ precip: 0 }));
  assert.equal(detectClasses(late, FI).episodes.filter((e) => e.class === 'drySpell').length, 0);
});

test('detectClasses: soil classes only on used days; zero curtain from five days', () => {
  const rows = series('2023-01-01', 7, (i) => ({ tsoil: i < 5 ? 0.1 : 1, swc: i === 5 ? 0.1 : i === 6 ? 0.5 : 0.3, swcPct: i === 5 ? 1 : i === 6 ? 99 : 50, used: i !== 6 }));
  const d = detectClasses(rows, FI);
  assert.deepEqual(d.episodes.filter((e) => e.class === 'zeroCurtain').map((e) => [e.start, e.days]), [['2023-01-01', 5]]);
  assert.deepEqual(d.episodes.filter((e) => e.class === 'soilDrought').map((e) => [e.start, e.peak]), [['2023-01-06', 1]]);
  assert.equal(d.episodes.filter((e) => e.class === 'soilWet').length, 0);
  // Heavy rain and cold spell.
  const w = detectClasses([day('2023-01-10', { precip: 25, taMean: -12 })], FI);
  assert.deepEqual(w.episodes.map((e) => e.class).sort(), ['coldSpell', 'heavyRain']);
});

test('detectClasses: Kenya has no frost, cold spell, dry spell or zero curtain', () => {
  const KE: DetectOptions = { ...FI, country: 'KE', heatC: 33 };
  const rows = [day('2020-06-01', { taMin: -1, taMean: -12, tsoil: 0, precip: 0, taMax: 34 })];
  const d = detectClasses(rows, KE);
  assert.deepEqual(d.episodes.map((e) => e.class), ['heat']);
});

test('rainSeasons: failed = rain and season mean swc both below the median of the seasons', () => {
  const rows: DayRow[] = [];
  // Three MAM seasons of 92 days: 2019 wet, 2020 dry with low swc, 2021 middle. 2022 has too few days.
  const mk = (year: number, mm: number, swc: (i: number) => number, n = 92) => rows.push(...series(`${year}-03-01`, n, (i) => ({ precip: mm, swc: swc(i) })));
  mk(2019, 3, () => 0.3);
  mk(2020, 0.5, (i) => (i < 46 ? 0.05 : 0.08));
  mk(2021, 1, () => 0.25);
  mk(2022, 0, () => 0.01, 40);
  // Season means 0.3, 0.065 and 0.25 (2022 has too few days): median 0.25.
  const s = rainSeasons(rows, [{ id: 'MAM', months: [3, 4, 5] }], 70, 0.5);
  assert.deepEqual(s.map((x) => [x.year, x.failed]), [
    [2019, false],
    [2020, true],
    [2021, false],
    [2022, null],
  ]);
  assert.equal(s[1]!.precipMm, 46);
  assert.equal(s[1]!.medianMm, 92);
  assert.equal(s[1]!.swcRef, 0.25);
  assert.equal(s[3]!.swcMean, null);
  const d = detectClasses(rows, { ...FI, country: 'KE', heatC: 33, failedRainSeasons: [{ id: 'MAM', months: [3, 4, 5] }] });
  const fr = d.episodes.filter((e) => e.class === 'failedRains');
  assert.deepEqual(fr.map((e) => [e.start, e.end, e.days, e.peak]), [['2020-03-01', '2020-05-31', 92, 46]]);
});

test('poolByPeriod pools the sites per period year and sorts by year, then MAM, JJA, SON, DJF', () => {
  const p = poolByPeriod([
    { site: 'b', iso: '2022-12-31', nee: 1, classes: ['coldSpell'] },
    { site: 'a', iso: '2023-01-05', nee: 3, classes: ['coldSpell', 'zeroCurtain'] },
    { site: 'a', iso: '2023-07-01', nee: -2, classes: [] },
    { site: 'b', iso: '2023-07-01', nee: null, classes: new Set(['heat'] as const) },
    { site: 'a', iso: '2023-04-01', nee: -1, classes: [] },
  ]);
  assert.deepEqual(p.map((x) => x.label), ['spring 2023', 'summer 2023', 'winter 2022/23']);
  const w = p[2]!;
  assert.equal(w.sitesWithData, 2);
  assert.equal(w.n, 2);
  assert.equal(w.nee.mean, 2);
  assert.equal(w.eventDays.coldSpell, 2);
  assert.equal(w.eventDays.zeroCurtain, 1);
  assert.equal(w.bySite.a!.nee.mean, 3);
  const s = p[1]!;
  assert.equal(s.sitesWithData, 1);
  assert.equal(s.n, 1);
  assert.equal(s.eventDays.heat, 1);
  assert.equal(s.bySite.b!.n, 0);
});
