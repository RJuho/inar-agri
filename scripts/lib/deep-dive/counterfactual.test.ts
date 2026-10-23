import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lightModel } from '../../../site/src/scripts/diagrams/fit.ts';
import { ltModel } from '../calc/lloyd-taylor.ts';
import { dayNumber } from './harvest.ts';
import {
  CROP_CLASS,
  HH_TO_GC,
  allocateByMonth,
  applyModel,
  binByLight,
  bootstrapOlsCi,
  cropClass,
  dailyDeficit,
  deficitSummary,
  fitEpisodeModel,
  isNoFit,
  monthAnomaly,
  seasonOf,
  seasonTable,
  type DailyDeficit,
  type EpisodeModel,
  type HalfHour,
  type MonthRow,
  type SeasonInput,
} from './counterfactual.ts';

const TRUE = { alpha: 0.05, beta: 20, rref: 2, e0: 300 };
const FIT_OPTS = { binWidth: 50, minPreDays: 10, minBins: 8 };

/** Synthetic half hours of `days` days from `first`: sine day curve of light, temp 15 ± 5 °C. */
function synthDays(first: number, days: number, gppFactor = 1): HalfHour[] {
  const out: HalfHour[] = [];
  for (let d = 0; d < days; d++) {
    const amp = 1000 + 37 * d; // other light values each day: more bins
    for (let i = 0; i < 48; i++) {
      const t = i / 2;
      const light = t > 6 && t < 18 ? amp * Math.sin((Math.PI * (t - 6)) / 12) : 0;
      const temp = 15 + 5 * Math.sin((2 * Math.PI * (t - 9)) / 24);
      const gpp = gppFactor * lightModel(light, 1, TRUE.alpha, TRUE.beta, 0);
      const reco = ltModel(temp, TRUE.rref, TRUE.e0);
      out.push({ day: first + d, light, temp, nee: reco - gpp, neeMeasured: i % 3 === 0, gpp, reco, e0: TRUE.e0 });
    }
  }
  return out;
}

const close = (a: number, b: number, rel: number, msg: string) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);

test('binByLight uses daytime rows only and sorts by light', () => {
  const rows = synthDays(0, 1);
  const bins = binByLight(rows, 50);
  assert.ok(bins.length >= 8);
  assert.equal(
    bins.reduce((s, b) => s + b.n, 0),
    rows.filter((r) => r.light! > 20).length,
  );
  for (let i = 1; i < bins.length; i++) assert.ok(bins[i]!.light > bins[i - 1]!.light);
});

test('fitEpisodeModel recovers alpha, beta and rref from synthetic data', () => {
  const m = fitEpisodeModel(synthDays(100, 14), FIT_OPTS);
  assert.ok(!isNoFit(m), JSON.stringify(m));
  const em = m as EpisodeModel;
  close(em.alpha, TRUE.alpha, 0.1, 'alpha');
  close(em.beta, TRUE.beta, 0.1, 'beta');
  close(em.rref, TRUE.rref, 0.05, 'rref');
  assert.equal(em.e0, TRUE.e0);
  assert.equal(em.nPreDays, 14);
  assert.ok(Math.abs(em.biasNee) < 0.2, `bias ${em.biasNee}`);
  assert.ok(em.rmseNee < 0.5, `rmse ${em.rmseNee}`);
});

test('fitEpisodeModel excludes too few days and too few bins', () => {
  assert.deepEqual(fitEpisodeModel(synthDays(0, 9), FIT_OPTS), { excluded: 'no-fit', reason: 'too-few-days' });
  assert.deepEqual(fitEpisodeModel(synthDays(0, 14), { ...FIT_OPTS, binWidth: 400 }), { excluded: 'no-fit', reason: 'too-few-bins' });
});

test('applyModel gives null values when light or temp is missing', () => {
  const r: HalfHour = { day: 0, light: null, temp: 10, nee: 1, neeMeasured: true, gpp: 0, reco: 1, e0: 300 };
  const [a, b] = applyModel(TRUE, [r, { ...r, light: 500, temp: null }]);
  assert.equal(a!.gppCf, null);
  assert.equal(a!.neeCf, null);
  assert.ok(a!.recoCf! > 0);
  assert.equal(b!.recoCf, null);
  assert.equal(b!.neeCf, null);
});

test('halved GPP gives the analytic deficit, and deficit = gppPart + recoPart', () => {
  const pre = synthDays(100, 14);
  const m = fitEpisodeModel(pre, FIT_OPTS) as EpisodeModel;
  const after = synthDays(115, 28, 0.5);
  const daily = dailyDeficit(m, after, { minHalfHours: 40 });
  assert.equal(daily.length, 28);
  for (const d of daily) {
    assert.ok(d.deficit > 0);
    assert.ok(d.valid);
    assert.ok(Math.abs(d.deficit - (d.gppPart! + d.recoPart!)) < 1e-9);
  }
  // Analytic: each row loses gpp/2 of uptake.
  const analytic = after.reduce((s, r) => s + r.gpp!, 0) * HH_TO_GC; // gpp is already halved
  const s = deficitSummary(daily, 115, 28);
  assert.equal(s.excluded, null);
  close(s.d28!, analytic, 0.02, 'd28');
  assert.ok(Math.abs(s.d28! - (s.gpp28! + s.reco28!)) < 1e-9);
  assert.equal(s.cum.length, 28);
  assert.ok(Math.abs(s.cum[27]! - s.d28!) < 1e-9);

  const meas = dailyDeficit(m, after, { minHalfHours: 10, measuredOnly: true });
  assert.equal(meas[0]!.n, 16);
});

const flat = (first: number, values: readonly number[], valid?: (i: number) => boolean): DailyDeficit[] =>
  values.map((x, i) => ({ day: first + i, n: 48, deficit: x, gppPart: x, recoPart: 0, nParts: 48, valid: valid ? valid(i) : true }));

test('deficitSummary: truncation, too few days, early sum', () => {
  const daily = flat(0, Array.from({ length: 28 }, () => 1));
  const t = deficitSummary(daily, 0, 20);
  assert.equal(t.daysUsed, 20);
  assert.equal(t.d28, 20);
  assert.equal(t.d14, 14);
  assert.equal(t.share14, 0.7);
  assert.equal(deficitSummary(daily, 0, 40).daysUsed, 28);

  const holes = flat(0, Array.from({ length: 28 }, () => 1), (i) => i >= 6);
  const x = deficitSummary(holes, 0, 28);
  assert.equal(x.validDays, 22);
  assert.equal(x.excluded, 'too-few-days');
  assert.equal(x.d28, null);
  assert.deepEqual(x.cum, []);

  // A missing day gets the mean of the valid days.
  const gap = flat(0, [2, 2, 4, 4]).filter((d) => d.day !== 1);
  const g = deficitSummary(gap, 0, 4, { afterDays: 28, earlyDays: 2, minValidShare: 0.5, recovery: { fromDay: 7, span: 5, share: 0.25 } });
  assert.equal(g.d28, 2 + 10 / 3 + 4 + 4);
  assert.equal(g.recoveryDay, null);
});

test('deficitSummary: recovery day', () => {
  const decays = flat(0, Array.from({ length: 28 }, (_, i) => (i < 10 ? 1 : 0)));
  assert.equal(deficitSummary(decays, 0, 28).recoveryDay, 10);
  const stays = flat(0, Array.from({ length: 28 }, () => 1));
  assert.equal(deficitSummary(stays, 0, 28).recoveryDay, null);
  const negative = flat(0, Array.from({ length: 28 }, (_, i) => (i < 7 ? -1 : 0)));
  assert.equal(deficitSummary(negative, 0, 28).recoveryDay, null);
});

test('allocateByMonth splits at the month border and skips invalid days', () => {
  const first = dayNumber('2022-06-28');
  const daily = flat(first, [1, 2, 3, 4, 5], (i) => i !== 4);
  assert.deepEqual(allocateByMonth(daily), { '2022-06': 6, '2022-07': 4 });
});

test('cropClass and CROP_CLASS', () => {
  assert.equal(cropClass('qvidja', 2019), 'grass');
  assert.equal(cropClass('viikki', 2023), 'cereal');
  assert.equal(cropClass('viikki', 2025), 'other');
  assert.equal(cropClass('haltiala', 2024), 'other');
  assert.equal(cropClass('haltiala', 2025), 'cereal');
  assert.throws(() => cropClass('anttila', 2022));
  assert.throws(() => cropClass('haltiala', 2020));
  assert.equal(CROP_CLASS.qvidja, 'grass');
});

test('monthAnomaly: crop, all and null reference', () => {
  const row = (year: number, neeAdj: number, extra: Partial<MonthRow> = {}): MonthRow => ({ site: 'haltiala', year, month: 6, neeAdj, dry: false, crop: 'cereal', ...extra });
  const target = row(2023, 10, { dry: true, crop: 'other' });
  const cands = [row(2021, -20), row(2022, -40), row(2024, -10, { crop: 'other' }), row(2025, 0, { dry: true }), row(2022, 99, { month: 7 })];
  const all = monthAnomaly(target, cands);
  assert.equal(all.refKind, 'all');
  assert.deepEqual(all.ref!.years, [2021, 2022, 2024]);
  assert.equal(all.anomaly, 10 - -70 / 3);

  const crop = monthAnomaly({ ...target, crop: 'cereal' }, cands);
  assert.equal(crop.refKind, 'crop');
  assert.equal(crop.ref!.mean, -30);
  assert.equal(crop.anomaly, 40);
  assert.ok(Math.abs(crop.ref!.sd! - Math.sqrt(200)) < 1e-12);

  const none = monthAnomaly(target, [row(2021, -20), row(2022, -40, { excludeFromRef: true })]);
  assert.deepEqual(none, { refKind: null, ref: null, anomaly: null });
});

test('seasonOf', () => {
  assert.deepEqual([1, 3, 5, 6, 8, 9, 11, 12].map(seasonOf), [null, 'MAM', 'MAM', 'JJA', 'JJA', 'SON', 'SON', null]);
});

test('seasonTable sums and neeWithout', () => {
  const m = (month: number, extra: Partial<SeasonInput> = {}): SeasonInput => ({
    site: 'qvidja', year: 2022, month, nee: -50, nDays: 30, complete: true, dry: false, nHarvests: 0, harvestDeficit: 0, droughtAnomaly: null, ...extra,
  });
  const rows = seasonTable([
    m(6, { nHarvests: 1, harvestDeficit: 15, dry: true, droughtAnomaly: 20 }),
    m(7, { dry: true, droughtAnomaly: null }),
    m(8, { harvestDeficit: 5, droughtAnomaly: 99 }), // not dry: anomaly not used
    m(4, { complete: false }),
    m(1),
  ]);
  assert.equal(rows.length, 2);
  const [mam, jja] = rows;
  assert.equal(mam!.season, 'MAM');
  assert.equal(mam!.complete, false);
  assert.equal(jja!.nee, -150);
  assert.equal(jja!.nDays, 90);
  assert.equal(jja!.complete, true);
  assert.deepEqual(jja!.dryMonths, ['2022-06', '2022-07']);
  assert.equal(jja!.nDry, 2);
  assert.equal(jja!.nDryNoRef, 1);
  assert.equal(jja!.nHarvests, 1);
  assert.equal(jja!.harvestDeficit, 20);
  assert.equal(jja!.droughtAnomaly, 20);
  assert.equal(jja!.neeWithout, -150 - 20 - 20);
});

test('bootstrapOlsCi contains the true slope', () => {
  const next = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  })();
  const xs = Array.from({ length: 30 }, (_, i) => i / 3 - 5);
  const ys = xs.map((x) => 1.5 + 2 * x + next());
  const r = bootstrapOlsCi(xs, ys)!;
  assert.equal(r.n, 30);
  assert.ok(r.ciLo < 2 && r.ciHi > 2, `${r.ciLo}..${r.ciHi}`);
  assert.ok(r.ciLo < r.slope && r.slope < r.ciHi);
  assert.deepEqual(bootstrapOlsCi(xs, ys), r); // same seed, same result
  assert.equal(bootstrapOlsCi([1, 2, 3], [1, 2, 3]), null);
});
