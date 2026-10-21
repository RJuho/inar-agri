import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROWS_PER_DAY } from './constants.ts';
import { ltModel } from './lloyd-taylor.ts';
import { fillTemperature, partitionYear, type SiteSeries } from './partition.ts';

/** One synthetic year: Reco from Lloyd-Taylor with a seasonal Rref, GPP from radiation. */
function syntheticYear(e0: number): { s: SiteSeries; rrefOf: (day: number) => number } {
  const days = 365;
  const n = days * ROWS_PER_DAY;
  const day = new Int32Array(n);
  const year = new Int32Array(n).fill(2022);
  const month = new Int32Array(n);
  const nee = new Float64Array(n);
  const neeQc = new Float64Array(n);
  const neeF = new Float64Array(n);
  const ta = new Float64Array(n);
  const swIn = new Float64Array(n);
  const night = new Float64Array(n);
  const rrefOf = (d: number) => 1 + 2 * Math.max(0, Math.sin(((d - 60) / 365) * Math.PI));
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < n; i++) {
    const d = Math.floor(i / ROWS_PER_DAY);
    const h = (i % ROWS_PER_DAY) / 2;
    day[i] = 10000 + d;
    month[i] = 1 + Math.floor((d / 365) * 12);
    const sun = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * (0.4 + 0.6 * Math.max(0, Math.sin(((d - 80) / 365) * Math.PI)));
    swIn[i] = 900 * sun;
    night[i] = swIn[i]! < 10 ? 1 : 0;
    ta[i] = 5 + 12 * Math.sin(((d - 100) / 365) * Math.PI) + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + 3 * (rnd() - 0.5);
    const reco = ltModel(ta[i]!, rrefOf(d), e0);
    const gpp = 25 * sun;
    neeF[i] = reco - gpp;
    const measured = rnd() < 0.6;
    nee[i] = measured ? neeF[i]! + 0.3 * (rnd() - 0.5) : NaN;
    neeQc[i] = measured ? 0 : 1;
  }
  const s: SiteSeries = {
    n, day, year, month, nee, neeQc, neeF, ta, tsoil: ta, swIn,
    ppfd: new Float64Array(n).fill(NaN), vpd: new Float64Array(n).fill(NaN), ustar: new Float64Array(n).fill(NaN), ssitc: new Float64Array(n).fill(NaN), night,
  };
  return { s, rrefOf };
}

test('partitionYear recovers E0 and the seasonal Rref', () => {
  const { s, rrefOf } = syntheticYear(180);
  const tf = fillTemperature(s.ta);
  const r = partitionYear(s, tf.values, s.neeF, 0, s.n, { tempVar: 'ta', gppNight: 'keep', ustarMin: NaN });
  assert.equal(r.e0Method, 'windows');
  assert.ok(Math.abs(r.e0 - 180) / 180 < 0.1, `e0 ${r.e0}`);
  // Rref in mid-summer (day 200) and in winter (day 20)
  const mid = r.rref[200 * ROWS_PER_DAY]!;
  const win = r.rref[20 * ROWS_PER_DAY]!;
  assert.ok(Math.abs(mid - rrefOf(200)) / rrefOf(200) < 0.15, `mid ${mid} vs ${rrefOf(200)}`);
  assert.ok(Math.abs(win - rrefOf(20)) / rrefOf(20) < 0.15, `win ${win} vs ${rrefOf(20)}`);
  // identity in every row
  for (let i = 0; i < s.n; i += 997) {
    assert.ok(Math.abs(r.reco[i]! - r.gpp[i]! - s.neeF[i]!) < 1e-9);
  }
  // annual sums close to the truth
  let sumGpp = 0;
  let trueGpp = 0;
  for (let i = 0; i < s.n; i++) {
    sumGpp += r.gpp[i]!;
    trueGpp += ltModel(s.ta[i]!, rrefOf(Math.floor(i / ROWS_PER_DAY)), 180) - s.neeF[i]!;
  }
  assert.ok(Math.abs(sumGpp - trueGpp) / trueGpp < 0.05, `gpp ${sumGpp} vs ${trueGpp}`);
});

test('partitionYear falls back when no night data exist', () => {
  const { s } = syntheticYear(150);
  s.nee.fill(NaN);
  s.neeQc.fill(1);
  const r = partitionYear(s, s.ta, s.neeF, 0, s.n, { tempVar: 'ta', gppNight: 'keep', ustarMin: NaN });
  assert.equal(r.e0Method, 'none');
  assert.ok(Number.isNaN(r.e0));
  assert.ok(Number.isNaN(r.reco[1000]!));
});

test('gppNight zero sets GPP to 0 at night', () => {
  const { s } = syntheticYear(150);
  const r = partitionYear(s, s.ta, s.neeF, 0, s.n, { tempVar: 'ta', gppNight: 'zero', ustarMin: NaN });
  const i = 200 * ROWS_PER_DAY + 2; // 01:00
  assert.equal(s.night[i], 1);
  assert.equal(r.gpp[i], 0);
  assert.equal(r.reco[i], s.neeF[i]);
});

test('forceE0 uses the given E0 and the u* filter removes low-u* nights', () => {
  const { s } = syntheticYear(150);
  const r = partitionYear(s, s.ta, s.neeF, 0, s.n, { tempVar: 'ta', gppNight: 'keep', ustarMin: NaN, forceE0: 120 });
  assert.equal(r.e0Method, 'neighbour');
  assert.equal(r.e0, 120);
  s.ustar.fill(0.05);
  const u = partitionYear(s, s.ta, s.neeF, 0, s.n, { tempVar: 'ta', gppNight: 'keep', ustarMin: 0.1 });
  assert.equal(u.nNight, 0);
});
