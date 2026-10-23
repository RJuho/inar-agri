import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DRY_THRESHOLD,
  SEASONS,
  STATION_OF_SITE,
  dryMonths,
  isDry,
  parseSpiCsv,
  seasonDry,
  seasonMonths,
  seasonOf,
} from './spi.ts';

const HEAD =
  '"Date","Observation.station","Year","Month","Day","Time..Local.time.","Monthly.precipitation..mm.","SPI1","SPI3","SPI6","SPI12","Station"';

const FIXTURE = [
  HEAD,
  '2020-01-01,"Vantaa Helsinki-Vantaa airport",2020,1,1,"02:00",40.1,0.5,NA,NA,NA,"Vantaa"',
  '2020-02-01,"Vantaa Helsinki-Vantaa airport",2020,2,1,"02:00",5,-1.2,0.1,NA,NA,"Vantaa"',
  '2020-03-01,"Vantaa Helsinki-Vantaa airport",2020,3,1,"02:00",10,-1,-0.4,NA,NA,"Vantaa"',
  '2020-04-01,NA,2020,4,NA,NA,NA,NA,NA,NA,NA,"Vantaa"',
  '2020-01-01,"Kaarina Yltöinen",2020,1,1,"02:00",33,0.25,1.5,0.2,-0.3,"Kaarina Yltöinen"',
].join('\r\n');

test('parseSpiCsv reads the fixture, NA gives null', () => {
  const m = parseSpiCsv(FIXTURE);
  assert.equal(m.size, 2);
  const v = m.get('Vantaa')!;
  assert.equal(v.size, 4);
  assert.deepEqual(v.get('2020-01'), { year: 2020, month: 1, mm: 40.1, spi1: 0.5, spi3: null, spi6: null, spi12: null });
  assert.deepEqual(v.get('2020-04'), { year: 2020, month: 4, mm: null, spi1: null, spi3: null, spi6: null, spi12: null });
  assert.equal(m.get('Kaarina Yltöinen')!.get('2020-01')!.spi12, -0.3);
  assert.deepEqual(dryMonths(v, 2020, 2020), ['2020-02', '2020-03']);
  assert.deepEqual(dryMonths(v, 2020, 2020, -1.1), ['2020-02']);
});

test('parseSpiCsv throws on a duplicate station month', () => {
  const lines = FIXTURE.split('\r\n');
  assert.throws(() => parseSpiCsv([...lines, lines[1]].join('\n')), /duplicate/);
});

test('parseSpiCsv throws on an unknown station', () => {
  const bad = `${HEAD}\n2020-01-01,"X",2020,1,1,"02:00",1,0,0,0,0,"Helsinki Kumpula"`;
  assert.throws(() => parseSpiCsv(bad), /unknown station/);
});

test('parseSpiCsv throws on a bad header', () => {
  assert.throws(() => parseSpiCsv(FIXTURE.replace('"SPI3"', '"SPI_3"')), /bad header/);
});

test('real file: values of known months', () => {
  const m = parseSpiCsv(readFileSync('data/SPI/SPI_all_stations.csv', 'utf8'));
  assert.equal(m.size, 3);
  const vantaa = m.get('Vantaa')!;
  const kaarina = m.get('Kaarina Yltöinen')!;
  assert.ok(Math.abs(vantaa.get('2022-08')!.spi1! - -3.4694009611211) < 1e-6);
  assert.ok(Math.abs(kaarina.get('2023-06')!.spi3! - -2.97700766372516) < 1e-6);
  const gap = kaarina.get('1995-01')!;
  for (const k of ['mm', 'spi1', 'spi3', 'spi6', 'spi12'] as const) assert.equal(gap[k], null);
  assert.deepEqual(dryMonths(vantaa, 2018, 2025), [
    '2018-03', '2018-05', '2018-11', '2019-04', '2019-06', '2021-06', '2021-12',
    '2022-03', '2022-08', '2023-04', '2023-06', '2024-05', '2025-03',
  ]);
});

test('station of site', () => {
  assert.equal(STATION_OF_SITE.haltiala, 'Vantaa');
  assert.equal(STATION_OF_SITE.viikki, 'Vantaa');
  assert.equal(STATION_OF_SITE.qvidja, 'Kaarina Yltöinen');
  assert.equal(STATION_OF_SITE.anttila, 'Kuopio Maaninka');
  assert.equal(STATION_OF_SITE.sarkisuo, 'Kuopio Maaninka');
  assert.equal(STATION_OF_SITE.maktau, undefined);
});

test('season helpers', () => {
  assert.deepEqual(SEASONS, ['MAM', 'JJA', 'SON']);
  assert.deepEqual([1, 2, 3, 5, 6, 8, 9, 11, 12].map(seasonOf), [null, null, 'MAM', 'MAM', 'JJA', 'JJA', 'SON', 'SON', null]);
  assert.deepEqual(seasonMonths('JJA'), [6, 7, 8]);
  assert.equal(DRY_THRESHOLD, -1);
  assert.equal(isDry(-1), true);
  assert.equal(isDry(-0.99), false);
  assert.equal(isDry(null), false);
  assert.equal(seasonDry([0.2, null, -1.5]), true);
  assert.equal(seasonDry([0.2, null, -0.5]), false);
  assert.equal(seasonDry([null, null, null]), false);
});
