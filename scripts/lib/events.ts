// Field management events per site, transcribed by hand from the
// management files in data/ (read-only) and from the Qvidja paper.
// scripts/build-db.ts validates the rows (EventRowSchema in schemas.ts)
// and writes them to db/events.parquet. The website shows them as markers
// and on the Events page.
//
// Rules:
// - One row per event. A multi-day event has date (first day) and date_end
//   (last day). Dates are local calendar days.
// - type is one of EVENT_TYPES. Mapping of the source words:
//   seeding, sowing, oversowing -> sowing; herbicide, glyphosate,
//   micronutrient tank mix -> spraying; harrowing, disc and plate work,
//   subsoiling, cultivation, crushing of the crop -> tillage (as in the
//   source files); cleaning cut and cut left on the field -> cut;
//   EC system installed -> other.
// - detail is short English text with the amount and the unit of the source.
// - The numeric facts (EventFacts) repeat the numbers of the source. Only
//   n_kg_ha can be derived: from the N share of the grade in the product
//   name (Yara AXAN 27-0-1, NPK 23-10-8). Finnish saltpetre has no grade in
//   the file, thus no N value. c_g_m2 comes from MANAGEMENT_CARBON
//   (calc/management.ts) through withCarbon(), not from this table.
// - Viikki, Anttila and Särkisuo give one yield per year. It is on the last
//   harvest of the year.
// - Excel serial dates: 1899-12-30 + n days.
// - Anttila, Särkisuo and Maktau have no management file. Their rows come
//   from the articles in data/articles/ (Shurpali et al. 2025, Räsänen et
//   al. 2026). Only events with an exact day or a stated day range are rows.
//   Month-level facts (for example "harvested in August 2020") and the
//   differences between the articles and the management files are listed
//   in docs/harmonised-database.md, not here. Ditch work -> other.
//
// Design: docs/harmonised-database.md.

import type { SiteCode } from './registry.ts';
import { cGm2, type ManagementRow } from './calc/management.ts';

export const EVENT_TYPES = ['harvest', 'cut', 'grazing', 'fertilisation', 'sowing', 'tillage', 'spraying', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Unit of `amount`: product or seed mass, fresh mass, volume, or number of animals (grazing). */
export const AMOUNT_UNITS = ['kg/ha', 'kg/ha fresh', 'm3/ha', 'L/ha', 'animals'] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

/** Numbers of an event from the source. All optional: NULL in events.parquet. */
export type EventFacts = {
  /** Crop, product or animal, short English name. */
  crop?: string;
  amount?: number;
  amount_unit?: AmountUnit;
  /** Dry matter fraction of `amount` (0 to 1). */
  dm_fraction?: number;
  /** Harvest yield, dry weight, kg DW/ha. */
  dry_mass_kg_ha?: number;
  /** N input, kg N/ha. */
  n_kg_ha?: number;
  /** Carbon of the event, g C m-2 (harvest export or organic input). Set by withCarbon(). */
  c_g_m2?: number;
  /** Area of the field parcel, ha (Qvidja). */
  area_ha?: number;
};

export type EventRow = EventFacts & {
  site: SiteCode;
  /** First day, yyyy-mm-dd. */
  date: string;
  /** Last day of a multi-day event, yyyy-mm-dd. */
  date_end?: string;
  type: EventType;
  detail: string;
  source: string;
};

const HA_XLSX = 'data/Haltiala/haltiala_smear_management.xlsx';
const HA_PDF = 'data/Haltiala/haltiala_smear_Lohkokortit_2025.pdf';
const QV_XLSX = 'data/Qvidja/Qvidja_management.xlsx';
const QV_2021 = 'data/Qvidja/Qvidja_C-balance.pdf (Heimsch et al. 2021, Table 1)';
const VI_DOCX = 'data/Viikki/EC/Management Information.docx';
const SH_2025 = 'data/articles/Shurpali_2025.pdf (Shurpali et al. 2025, p. 2, Tables 2 and 4)';
const RA_2026 = 'data/articles/Räsänen_2026_kenia.pdf (Räsänen et al. 2026, p. 3)';
const GAO_2026 = 'data/articles/Gao_2026_Cfootprint_milk-DNDC.pdf (Gao et al. 2026, Table A2)';
const VE_2026 = 'data/articles/Vettikkat_2026_NH3-flux_SMEAR-Agri_mass-spec_EC.pdf (Vettikkat et al. 2026, Table 1)';

type Facts = EventFacts & { end?: string };
type Short = [date: string, type: EventType, detail: string, facts?: Facts];
const rowsOf = (site: SiteCode, source: string, list: Short[]): EventRow[] =>
  list.map(([date, type, detail, { end, ...facts } = {}]) => ({ site, date, ...(end ? { date_end: end } : {}), type, detail, source, ...facts }));

const kgHa = (crop: string, amount: number, more: Facts = {}): Facts => ({ crop, amount, amount_unit: 'kg/ha', ...more });

/** Qvidja silage harvest from the xlsx: fresh mass, DM fraction and parcel area. */
const qvSilage = (date: string, fresh: number, dm: number, area: number, extra = '', dry = fresh * dm): Short => [
  date,
  'harvest',
  `Silage, whole crop, ${fresh} kg/ha fresh, DM ${dm}${extra}`,
  { crop: 'Silage', amount: fresh, amount_unit: 'kg/ha fresh', dm_fraction: dm, dry_mass_kg_ha: Math.round(dry * 10) / 10, area_ha: area },
];
const qvCleaningCut = (date: string, area: number): Short => [date, 'cut', 'Cleaning cut (puhdistusniitto), not removed', { area_ha: area }];
/** Qvidja organic fertiliser from the xlsx: fresh mass and DM fraction. */
const qvFert = (date: string, detail: string, crop: string, fresh: number, dm: number, area: number): Short => [
  date,
  'fertilisation',
  `${detail}, ${fresh} kg/ha fresh, DM ${dm}`,
  { crop, amount: fresh, amount_unit: 'kg/ha fresh', dm_fraction: dm, area_ha: area },
];

/** Qvidja grazing: the xlsx gives the start date, the number of animals and the duration in days. */
function qvGrazing(date: string, n: number, animal: string, days: number, area: number): Short {
  const end = new Date(`${date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return [date, 'grazing', `${n} ${animal}, ${days} days`, { end: end.toISOString().slice(0, 10), crop: animal, amount: n, amount_unit: 'animals', area_ha: area }];
}

/** Viikki N input of one application, from the docx. */
const viN = (crop: string, n: number): Facts => ({ crop, n_kg_ha: n });

export const EVENTS: EventRow[] = [
  // ---- Haltiala: xlsx (Year carried down, Excel serial dates, text ranges in 2023)
  ...rowsOf('haltiala', HA_XLSX, [
    ['2021-05-07', 'other', 'EC system installed'],
    ['2021-05-13', 'spraying', 'Glyphosate (Roundup PowerMax), 1.5 kg/ha', kgHa('Glyphosate (Roundup PowerMax)', 1.5)],
    ['2021-05-13', 'sowing', 'Barley (Harbinger), 370 kg/ha', kgHa('Barley', 370)],
    ['2021-05-13', 'fertilisation', 'Finnish saltpetre (Suomen salpietari), 320 kg/ha', kgHa('Finnish saltpetre', 320)],
    ['2021-06-10', 'spraying', 'Spraying, product not given'],
    ['2021-09-10', 'harvest', 'Barley, 7187 kg DW/ha (3595 kg C/ha) from hand plots; harvest started 8 Sep and lasted at least 5 days', { crop: 'Barley', dry_mass_kg_ha: 7187 }],
    ['2021-09-15', 'harvest', 'Threshing, no baling', { crop: 'Barley' }],
    ['2022-04-29', 'tillage', 'Plate modification'],
    ['2022-05-03', 'tillage', 'Harrowing, two times'],
    // The file gives "2023-05-04 and 2023-05-05" on a 2022 row with serial date 2022-05-04: the year is 2022.
    ['2022-05-04', 'sowing', 'Oats (Pettiina), 200 kg/ha', kgHa('Oats', 200, { end: '2022-05-05' })],
    ['2022-05-04', 'sowing', 'Green manure grass (viherlannoitusnurmi), 15 kg/ha', kgHa('Green manure grass', 15)],
    ['2022-05-04', 'fertilisation', 'Finnish saltpetre (Suomen salpietari), 300 kg/ha', kgHa('Finnish saltpetre', 300)],
    ['2022-08-15', 'harvest', 'Oats, threshing, grain 6903 kg DW/ha (3452 kg C/ha), full biomass 11484 kg DW/ha; straw shredded and left; end 23 or 24 Aug', { end: '2022-08-24', crop: 'Oats', dry_mass_kg_ha: 6903 }],
    ['2023-06-19', 'fertilisation', 'Manure, 10 m3/ha (could be 45-60 m3/ha), north sector; dry grass crushed', { end: '2023-06-21', crop: 'Manure', amount: 10, amount_unit: 'm3/ha' }],
    ['2023-08-01', 'fertilisation', 'Manure, 10 m3/ha, south sector', { end: '2023-08-02', crop: 'Manure', amount: 10, amount_unit: 'm3/ha' }],
    ['2023-08-04', 'tillage', 'Disc harrowing (lautasmuokkaus), 4-10 cm, to stop the grass and cover the manure', { end: '2023-08-09' }],
    ['2023-08-15', 'tillage', 'Harrowing, whole field'],
    ['2023-09-08', 'tillage', 'Harrowing again; autumn rye not sown (field too wet)'],
    ['2024-05-08', 'tillage', 'Harrowing'],
    ['2024-05-14', 'tillage', 'Harrowing'],
    ['2024-05-16', 'sowing', 'Sunflower, 10 kg/ha (probably 12-14 kg/ha)', kgHa('Sunflower', 10)],
    // N = 27 % of the product (grade 27-0-1 in the name).
    ['2024-05-16', 'fertilisation', 'Yara AXAN 27-0-1, 200 kg/ha', kgHa('Yara AXAN 27-0-1', 200, { n_kg_ha: 54 })],
    ['2024-10-10', 'tillage', 'Crushing of the sunflower crop, left on the field', { end: '2024-10-11', crop: 'Sunflower' }],
    ['2024-10-14', 'tillage', 'Crushing of the sunflower crop, left on the field', { end: '2024-10-15', crop: 'Sunflower' }],
    ['2025-05-10', 'tillage', 'Disc harrowing (lautasäestys), 6 cm'],
    ['2025-05-13', 'tillage', 'Harrowing, spring tine (joustopiikkiäestys), 6 cm'],
    ['2025-05-15', 'fertilisation', 'Viljelijän Typpi 26-S4, 300 kg/ha (78 kg N/ha)', kgHa('Viljelijän Typpi 26-S4', 300, { n_kg_ha: 78 })],
    ['2025-05-15', 'sowing', 'Oats (Jacky), 230 kg/ha', kgHa('Oats', 230)],
    ['2025-06-06', 'sowing', 'Italian ryegrass, 5 kg/ha', kgHa('Italian ryegrass', 5)],
    ['2025-10-03', 'harvest', 'Oats, 3608 kg/ha (xlsx: kg DW/ha)', { crop: 'Oats', dry_mass_kg_ha: 3608 }],
    ['2025-10-10', 'spraying', 'Glyphosate (Krypt 540), 2.7 L/ha', { crop: 'Glyphosate (Krypt 540)', amount: 2.7, amount_unit: 'L/ha' }],
  ]),
  // The xlsx gives 2025-05-16 for Jett Mn235. The parcel card gives 16.06.2025, in a tank mix with the herbicides.
  ...rowsOf('haltiala', `${HA_XLSX}; ${HA_PDF}`, [
    [
      '2025-06-16',
      'spraying',
      'Herbicide Duplosan Max 0.5 L/ha (with Quelex 25 g/ha, Refine Super SX 15 g/ha, adjuvants) in tank mix with Jett Mn235 Mn fertiliser 2 L/ha',
      { crop: 'Duplosan Max (herbicide)', amount: 0.5, amount_unit: 'L/ha' },
    ],
  ]),

  // ---- Qvidja 2018-2019 events that are only in Heimsch et al. 2021
  ...rowsOf('qvidja', QV_2021, [
    ['2018-07-16', 'fertilisation', 'NK molasses, 2800 kg/ha (57 g C/m2)', kgHa('NK molasses', 2800)],
    ['2018-08-21', 'cut', 'Cut at 15 cm, yield left on the field'],
    ['2018-08-24', 'fertilisation', 'NK molasses, 1755 kg/ha (36 g C/m2)', kgHa('NK molasses', 1755)],
    ['2018-09-03', 'sowing', 'Oversowing after drought damage (timothy, ryegrasses, meadow grass, red fescue)', { crop: 'Grass mix' }],
    ['2019-05-08', 'fertilisation', 'By-product fertiliser mix, about 4600 kg/ha (43 g C/m2)', kgHa('NK molasses mix', 4600)],
    // N = 23 % of the product (grade 23-10-8).
    ['2019-06-20', 'fertilisation', 'Mineral fertiliser NPK 23-10-8, 220 kg/ha', kgHa('NPK 23-10-8', 220, { n_kg_ha: 50.6 })],
  ]),
  // ---- Qvidja: xlsx (sheet Taul1). Harvest dates differ by 1-2 days from the paper; the xlsx date is used.
  // Area = "Area of kasvulohko" (ha) of the row.
  ...rowsOf('qvidja', QV_XLSX, [
    // The xlsx gives 615 kg/ha x 0.30 = 185 kg DM/ha. The paper gives 1985 kg DW/ha; the paper value is used.
    qvSilage('2018-06-12', 615, 0.3, 16.25, ' (paper: 1985 kg DW/ha)', 1985),
    qvSilage('2018-09-25', 1439, 0.241, 11.75),
    qvSilage('2019-06-10', 7652, 0.406, 9.58),
    qvSilage('2019-08-21', 2707, 0.38, 4.02),
    qvFert('2020-05-25', 'Own NPK mix 2020 (oma NPK seos)', 'Own NPK mix', 9380, 0.13, 3.23),
    qvSilage('2020-06-11', 5027.86, 0.439, 3.23),
    qvFert('2020-07-27', 'Tube compost chips / silage (tuubikompostihake)', 'Tube compost chips', 10000, 0.283, 3.23),
    qvSilage('2020-08-27', 1857.58, 0.701, 3.23),
    qvFert('2021-05-12', 'Broiler litter manure (kuivikelanta)', 'Broiler litter manure', 4000, 0.66, 5.18),
    qvGrazing('2021-06-01', 4, 'horses', 7, 5.18),
    qvSilage('2021-06-21', 3526, 0.786, 5.18),
    qvGrazing('2022-06-01', 9, 'cows', 15, 4.75),
    qvSilage('2022-06-21', 2638.9, 0.329, 4.75),
    qvFert('2022-07-04', 'Qvidja compost', 'Qvidja compost', 15330, 0.354, 4.75),
    qvCleaningCut('2022-09-09', 4.75),
    qvCleaningCut('2023-06-19', 4.75),
    qvSilage('2023-06-20', 752.1, 0.404, 4.75),
    qvCleaningCut('2023-08-21', 4.75),
    qvSilage('2023-08-22', 1088.86, 0.404, 4.75),
    qvFert('2023-08-30', 'Soilfood compost fibre (Rav.kuitu II L)', 'Soilfood compost fibre', 34500, 0.48, 4.75),
    ['2023-09-07', 'tillage', 'Subsoiling and cultivation (jankkurointi ja kultivointi)', { area_ha: 4.75 }],
    qvSilage('2024-06-15', 3936.65, 0.423, 4.42),
    qvCleaningCut('2024-07-18', 4.42),
    qvCleaningCut('2024-08-09', 4.42),
    qvGrazing('2024-10-04', 14, 'highland cows', 8, 4.42),
    qvGrazing('2025-06-14', 4, 'horses', 5, 4.42),
    qvGrazing('2025-07-30', 20, 'highland cows', 12, 4.42),
  ]),

  // ---- Viikki: docx table (day and month, year from the row). The N sources
  // are matched to the application dates in the order of the table.
  ...rowsOf('viikki', VI_DOCX, [
    ['2022-05-10', 'fertilisation', 'CAN mineral fertiliser, 108 kg N/ha', viN('CAN mineral fertiliser', 108)],
    ['2022-07-01', 'harvest', 'Timothy, first cut', { crop: 'Timothy' }],
    ['2022-08-27', 'harvest', 'Timothy, second cut; yield of the year 3673 kg DW/ha', { crop: 'Timothy', dry_mass_kg_ha: 3673 }],
    ['2022-11-02', 'tillage', 'Tillage'],
    // Vettikkat et al. 2026 give the product and the amount of the same day (field Alaniitty 1, 6.86 ha); the N value is from the docx.
    [
      '2023-04-27',
      'fertilisation',
      'Dry manure (separated solid fraction of cow manure, 43 m3/ha, 18.5 kg TAN/ha), 18.4 kg N/ha',
      { ...viN('Dry manure', 18.4), amount: 43, amount_unit: 'm3/ha' },
    ],
    ['2023-04-28', 'tillage', 'Levelling harrow, about 5 cm, manure worked in'],
    ['2023-05-25', 'fertilisation', 'Mineral N, 67.5 kg N/ha', viN('Mineral N', 67.5)],
    ['2023-05-25', 'tillage', 'Tillage'],
    ['2023-08-17', 'harvest', 'Barley, clover and grasses, first cut', { crop: 'Barley, clover and grasses' }],
    ['2023-08-24', 'harvest', 'Barley, clover and grasses, second cut; yield of the year 6773 kg DW/ha', { crop: 'Barley, clover and grasses', dry_mass_kg_ha: 6773 }],
    ['2024-05-08', 'fertilisation', 'Mineral N, 27.0 kg N/ha', viN('Mineral N', 27)],
    ['2024-05-22', 'fertilisation', 'Liquid manure, 57.5 kg N/ha', viN('Liquid manure', 57.5)],
    ['2024-07-31', 'harvest', 'Silage; yield of the year 2336 kg DW/ha', { crop: 'Silage', dry_mass_kg_ha: 2336 }],
    ['2024-10-09', 'fertilisation', 'Dry manure, 22.5 kg N/ha', viN('Dry manure', 22.5)],
    ['2024-10-09', 'tillage', 'Tillage'],
    ['2025-05-08', 'tillage', 'Tillage', { end: '2025-05-09' }],
    ['2025-05-10', 'fertilisation', 'Mineral fertiliser, 21.6 kg N/ha', viN('Mineral fertiliser', 21.6)],
    ['2025-09-10', 'harvest', 'Faba beans; yield of the year 1973.7 kg DW/ha', { crop: 'Faba beans', dry_mass_kg_ha: 1973.7 }],
  ]),
  // The 2023 sowing is only in Gao et al. 2026 (Table A2).
  ...rowsOf('viikki', GAO_2026, [['2023-05-25', 'sowing', 'Barley, 200 kg/ha, undersown with mixed grass seed, 20 kg/ha', kgHa('Barley', 200)]]),

  // ---- Anttila: Shurpali et al. 2025. Field parcel 6.4 ha (Table 2). The fertiliser
  // products are not named; the paper gives kg N/ha only. The yield of 2022 is an
  // annual value (Table 4, dry biomass, grass C content 0.47).
  ...rowsOf('anttila', SH_2025, [
    ['2021-06-03', 'sowing', 'Harrowed, sown and fertilised: red clover and timothy with barley as cover crop; fertiliser amount not given', { crop: 'Legume grass', area_ha: 6.4 }],
    ['2021-08-02', 'harvest', 'Whole crop harvest; no yield given', { crop: 'Legume grass', area_ha: 6.4 }],
    ['2022-05-23', 'fertilisation', 'Synthetic N fertiliser, 52 kg N/ha, product not given', { crop: 'Synthetic N', n_kg_ha: 52, area_ha: 6.4 }],
    ['2022-06-21', 'harvest', 'Grass, first cut (red clover and timothy, sown 2021-06-03)', { crop: 'Legume grass', area_ha: 6.4 }],
    ['2022-06-22', 'fertilisation', 'Synthetic N fertiliser, 44 kg N/ha, product not given', { crop: 'Synthetic N', n_kg_ha: 44, area_ha: 6.4 }],
    ['2022-09-08', 'harvest', 'Grass, second cut; yield of the year 7500 kg DM/ha (grass C content 0.47)', { crop: 'Legume grass', dry_mass_kg_ha: 7500, area_ha: 6.4 }],
  ]),

  // ---- Särkisuo: Shurpali et al. 2025. Field parcel 7.1 ha (Table 2), drained peat soil.
  ...rowsOf('sarkisuo', SH_2025, [
    ['2021-06-09', 'sowing', 'Sown and fertilised: wheat, oat and grasses; amounts not given', { crop: 'Mixed grasses', area_ha: 7.1 }],
    ['2022-03-10', 'other', 'Ditch preparation', { end: '2022-03-17', area_ha: 7.1 }],
    ['2022-05-30', 'fertilisation', 'Synthetic N fertiliser, 90 kg N/ha, product not given', { crop: 'Synthetic N', n_kg_ha: 90, area_ha: 7.1 }],
    ['2022-06-08', 'spraying', 'Herbicide against weeds, product not given', { area_ha: 7.1 }],
    ['2022-06-30', 'harvest', 'Mixed grasses, first cut', { crop: 'Mixed grasses', area_ha: 7.1 }],
    ['2022-07-04', 'fertilisation', 'Synthetic N fertiliser, 69 kg N/ha, product not given', { crop: 'Synthetic N', n_kg_ha: 69, area_ha: 7.1 }],
    ['2022-08-03', 'other', 'Ditch preparation', { end: '2022-08-15', area_ha: 7.1 }],
    ['2022-08-15', 'harvest', 'Mixed grasses, second cut; yield of the year 4700 kg DM/ha (grass C content 0.47)', { crop: 'Mixed grasses', dry_mass_kg_ha: 4700, area_ha: 7.1 }],
  ]),

  // ---- Maktau: Räsänen et al. 2026 (site description). Only the long rains of 2019
  // and 2020 have exact days. The 2020 sowing is "the third week of March" only.
  ...rowsOf('maktau', RA_2026, [
    ['2019-04-12', 'sowing', 'Maize (hybrid DH02), after 24 mm rain in the second week of April', { crop: 'Maize' }],
    ['2019-08-13', 'harvest', 'Maize, 123 days after sowing; no yield given', { crop: 'Maize' }],
    ['2020-07-30', 'harvest', 'Maize, 135 days after sowing (sown in the third week of March); no yield given', { crop: 'Maize' }],
  ]),
];

/** Event types that can take the carbon of a management row of each action. */
const CARBON_TYPES: Record<ManagementRow['action'], EventType[]> = {
  harvest: ['harvest', 'cut'],
  fertilisation: ['fertilisation'],
  grazing: ['grazing'],
};

/**
 * Copy the carbon of the management table (g C m-2, cGm2()) to the event with the same
 * site, date and a matching type. Returns the events and the carbon rows that match no event.
 */
export function withCarbon(events: EventRow[], management: ManagementRow[]): { events: EventRow[]; unmatched: ManagementRow[] } {
  const out = events.map((e) => ({ ...e }));
  const unmatched: ManagementRow[] = [];
  for (const m of management) {
    const c = cGm2(m);
    if (c === null) continue;
    const hits = out.filter((e) => e.site === m.site && e.date === m.date && CARBON_TYPES[m.action].includes(e.type));
    if (hits.length !== 1) {
      unmatched.push(m);
      continue;
    }
    hits[0]!.c_g_m2 = Math.round(c * 10) / 10;
  }
  return { events: out, unmatched };
}

