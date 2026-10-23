// Unit tests of withCarbon() (grazing net carbon, event_crop choice). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, withCarbon, type EventRow } from './events.ts';
import { MANAGEMENT_CARBON, type ManagementRow } from './calc/management.ts';

const mrow = (over: Partial<ManagementRow>): ManagementRow => ({
  site: 'qvidja', date: '2022-08-05', action: 'harvest', product: 'p', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: null,
  c_fraction: 0.42, c_fraction_source: 'site', c_g_m2: null, source: 's', note: '', ...over,
});
const ev = (over: Partial<EventRow>): EventRow => ({ site: 'qvidja', date: '2022-08-05', type: 'grazing', detail: 'd', source: 's', ...over });

test('withCarbon: a grazing event gets grass eaten minus excreta returned', () => {
  const { events, unmatched } = withCarbon(
    [ev({ crop: 'cows' })],
    [mrow({ c_g_m2: 11.4 }), mrow({ action: 'fertilisation', c_fraction: null, c_g_m2: 4.8 })],
  );
  assert.deepEqual(unmatched, []);
  assert.equal(events[0]!.c_g_m2, 6.6);
});

test('withCarbon: event_crop chooses one of two events of the same day and type', () => {
  const two = [ev({ date: '2020-07-27', type: 'fertilisation', crop: 'Own NPK mix' }), ev({ date: '2020-07-27', type: 'fertilisation', crop: 'Tube compost chips' })];
  const m = mrow({ date: '2020-07-27', action: 'fertilisation', c_fraction: null, c_g_m2: 101 });
  assert.equal(withCarbon(two, [m]).unmatched.length, 1);
  const { events, unmatched } = withCarbon(two, [{ ...m, event_crop: 'Tube compost chips' }]);
  assert.deepEqual(unmatched, []);
  assert.equal(events[0]!.c_g_m2, undefined);
  assert.equal(events[1]!.c_g_m2, 101);
});

test('withCarbon: the real tables match except the known Haltiala sunflower row', () => {
  const { unmatched } = withCarbon(EVENTS, MANAGEMENT_CARBON);
  assert.deepEqual(unmatched.map((m) => `${m.site} ${m.date}`), ['haltiala 2024-10-10']);
});
