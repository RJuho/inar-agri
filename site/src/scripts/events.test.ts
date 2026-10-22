// Unit tests of the event text helpers in events.ts. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Meta, SiteEvent } from './db';
import { eventFacts, eventMarkLabel, eventMarkLabelWidth, eventsSummary, yieldKeyText } from './events.ts';

const ev = (over: Partial<SiteEvent>): SiteEvent => ({
  siteId: 4,
  date: '2022-06-21',
  dateEnd: null,
  type: 'harvest',
  detail: 'Silage',
  crop: null,
  amount: null,
  amountUnit: null,
  dmFraction: null,
  dryMass: null,
  cGm2: null,
  nKgHa: null,
  areaHa: null,
  ...over,
});

test('eventFacts lists yield, carbon, N and parcel area', () => {
  assert.deepEqual(eventFacts(ev({ dryMass: 868.198, cGm2: 36.46, areaHa: 4.75 })), [
    'yield 868.2 kg DW ha⁻¹',
    'carbon 36.5 g C m⁻²',
    'parcel 4.75 ha',
  ]);
  assert.deepEqual(eventFacts(ev({ type: 'fertilisation', nKgHa: 108 })), ['N input 108 kg N ha⁻¹']);
  assert.deepEqual(eventFacts(ev({})), []);
});

test('the marker label shows the yield in t DW/ha for a harvest only', () => {
  assert.equal(eventMarkLabel(ev({ dryMass: 3673 })), 'H 3.7 t');
  assert.equal(eventMarkLabel(ev({})), 'H');
  assert.equal(eventMarkLabel(ev({ type: 'sowing' })), 'Sw');
  assert.ok(eventMarkLabelWidth(ev({ dryMass: 3673 })) > eventMarkLabelWidth(ev({})));
  assert.notEqual(yieldKeyText([ev({ dryMass: 1 })]), '');
  assert.equal(yieldKeyText([ev({})]), '');
});

test('eventsSummary has one text per site with events only', () => {
  const site = (siteId: number, code: string) => ({ siteId, code, name: code }) as Meta['sites'][number];
  const meta = {
    sites: [site(1, 'anttila'), site(4, 'qvidja')],
    events: [
      ev({ date: '2018-06-12', dryMass: 1985, cGm2: 83.4, crop: 'Silage', areaHa: 16.25 }),
      ev({ date: '2021-06-01', type: 'grazing', amount: 4, amountUnit: 'animals', crop: 'horses' }),
    ],
  } as unknown as Meta;
  const out = eventsSummary(meta);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.siteId, 4);
  assert.match(out[0]!.text, /^2018–2021, 2 events: harvest 1 \(yield 1, carbon 1\), grazing 1 \(animals and days\)\./);
  assert.match(out[0]!.text, /parcel area for 1/);
});
