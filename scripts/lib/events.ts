// Field management events per site, transcribed by hand from the
// management files in data/ (read-only) and from the Qvidja paper.
// scripts/build-db.ts validates the rows (EventRowSchema in schemas.ts)
// and writes them to db/events.parquet. The website shows them as markers.
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
// - Excel serial dates: 1899-12-30 + n days.
// - Maktau has only seasonal practice (no dates). Anttila and Särkisuo have
//   no management data. These sites have no rows.
//
// Design: docs/harmonised-database.md.

import type { SiteCode } from './registry.ts';

export const EVENT_TYPES = ['harvest', 'cut', 'grazing', 'fertilisation', 'sowing', 'tillage', 'spraying', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventRow = {
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

type Short = [date: string, type: EventType, detail: string, dateEnd?: string];
const rowsOf = (site: SiteCode, source: string, list: Short[]): EventRow[] =>
  list.map(([date, type, detail, dateEnd]) => ({ site, date, ...(dateEnd ? { date_end: dateEnd } : {}), type, detail, source }));

/** Qvidja silage harvest from the xlsx: fresh mass and DM fraction. */
const qvSilage = (date: string, fresh: number, dm: number, extra = ''): Short => [
  date,
  'harvest',
  `Silage, whole crop, ${fresh} kg/ha fresh, DM ${dm}${extra}`,
];
const qvCleaningCut = (date: string): Short => [date, 'cut', 'Cleaning cut (puhdistusniitto), not removed'];

/** Qvidja grazing: the xlsx gives the start date and the duration in days. */
function qvGrazing(date: string, animals: string, days: number): Short {
  const end = new Date(`${date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return [date, 'grazing', `${animals}, ${days} days`, end.toISOString().slice(0, 10)];
}

export const EVENTS: EventRow[] = [
  // ---- Haltiala: xlsx (Year carried down, Excel serial dates, text ranges in 2023)
  ...rowsOf('haltiala', HA_XLSX, [
    ['2021-05-07', 'other', 'EC system installed'],
    ['2021-05-13', 'spraying', 'Glyphosate (Roundup PowerMax), 1.5 kg/ha'],
    ['2021-05-13', 'sowing', 'Barley (Harbinger), 370 kg/ha'],
    ['2021-05-13', 'fertilisation', 'Finnish saltpetre (Suomen salpietari), 320 kg/ha'],
    ['2021-06-10', 'spraying', 'Spraying, product not given'],
    ['2021-09-10', 'harvest', 'Barley, 7187 kg DW/ha (3595 kg C/ha) from hand plots; harvest started 8 Sep and lasted at least 5 days'],
    ['2021-09-15', 'harvest', 'Threshing, no baling'],
    ['2022-04-29', 'tillage', 'Plate modification'],
    ['2022-05-03', 'tillage', 'Harrowing, two times'],
    // The file gives "2023-05-04 and 2023-05-05" on a 2022 row with serial date 2022-05-04: the year is 2022.
    ['2022-05-04', 'sowing', 'Oats (Pettiina), 200 kg/ha', '2022-05-05'],
    ['2022-05-04', 'sowing', 'Green manure grass (viherlannoitusnurmi), 15 kg/ha'],
    ['2022-05-04', 'fertilisation', 'Finnish saltpetre (Suomen salpietari), 300 kg/ha'],
    ['2022-08-15', 'harvest', 'Oats, threshing, grain 6903 kg DW/ha (3452 kg C/ha), full biomass 11484 kg DW/ha; straw shredded and left; end 23 or 24 Aug', '2022-08-24'],
    ['2023-06-19', 'fertilisation', 'Manure, 10 m3/ha (could be 45-60 m3/ha), north sector; dry grass crushed', '2023-06-21'],
    ['2023-08-01', 'fertilisation', 'Manure, 10 m3/ha, south sector', '2023-08-02'],
    ['2023-08-04', 'tillage', 'Disc harrowing (lautasmuokkaus), 4-10 cm, to stop the grass and cover the manure', '2023-08-09'],
    ['2023-08-15', 'tillage', 'Harrowing, whole field'],
    ['2023-09-08', 'tillage', 'Harrowing again; autumn rye not sown (field too wet)'],
    ['2024-05-08', 'tillage', 'Harrowing'],
    ['2024-05-14', 'tillage', 'Harrowing'],
    ['2024-05-16', 'sowing', 'Sunflower, 10 kg/ha (probably 12-14 kg/ha)'],
    ['2024-05-16', 'fertilisation', 'Yara AXAN 27-0-1, 200 kg/ha'],
    ['2024-10-10', 'tillage', 'Crushing of the sunflower crop, left on the field', '2024-10-11'],
    ['2024-10-14', 'tillage', 'Crushing of the sunflower crop, left on the field', '2024-10-15'],
    ['2025-05-10', 'tillage', 'Disc harrowing (lautasäestys), 6 cm'],
    ['2025-05-13', 'tillage', 'Harrowing, spring tine (joustopiikkiäestys), 6 cm'],
    ['2025-05-15', 'fertilisation', 'Viljelijän Typpi 26-S4, 300 kg/ha (78 kg N/ha)'],
    ['2025-05-15', 'sowing', 'Oats (Jacky), 230 kg/ha'],
    ['2025-06-06', 'sowing', 'Italian ryegrass, 5 kg/ha'],
    ['2025-10-03', 'harvest', 'Oats, 3608 kg/ha (xlsx: kg DW/ha)'],
    ['2025-10-10', 'spraying', 'Glyphosate (Krypt 540), 2.7 L/ha'],
  ]),
  // The xlsx gives 2025-05-16 for Jett Mn235. The parcel card gives 16.06.2025, in a tank mix with the herbicides.
  ...rowsOf('haltiala', `${HA_XLSX}; ${HA_PDF}`, [
    ['2025-06-16', 'spraying', 'Herbicide Duplosan Max 0.5 L/ha (with Quelex 25 g/ha, Refine Super SX 15 g/ha, adjuvants) in tank mix with Jett Mn235 Mn fertiliser 2 L/ha'],
  ]),

  // ---- Qvidja 2018-2019 events that are only in Heimsch et al. 2021
  ...rowsOf('qvidja', QV_2021, [
    ['2018-07-16', 'fertilisation', 'NK molasses, 2800 kg/ha (57 g C/m2)'],
    ['2018-08-21', 'cut', 'Cut at 15 cm, yield left on the field'],
    ['2018-08-24', 'fertilisation', 'NK molasses, 1755 kg/ha (36 g C/m2)'],
    ['2018-09-03', 'sowing', 'Oversowing after drought damage (timothy, ryegrasses, meadow grass, red fescue)'],
    ['2019-05-08', 'fertilisation', 'By-product fertiliser mix, about 4600 kg/ha (43 g C/m2)'],
    ['2019-06-20', 'fertilisation', 'Mineral fertiliser NPK 23-10-8, 220 kg/ha'],
  ]),
  // ---- Qvidja: xlsx (sheet Taul1). Harvest dates differ by 1-2 days from the paper; the xlsx date is used.
  ...rowsOf('qvidja', QV_XLSX, [
    qvSilage('2018-06-12', 615, 0.3, ' (paper: 1985 kg DW/ha)'),
    qvSilage('2018-09-25', 1439, 0.241),
    qvSilage('2019-06-10', 7652, 0.406),
    qvSilage('2019-08-21', 2707, 0.38),
    ['2020-05-25', 'fertilisation', 'Own NPK mix 2020 (oma NPK seos), 9380 kg/ha fresh, DM 0.13'],
    qvSilage('2020-06-11', 5027.86, 0.439),
    ['2020-07-27', 'fertilisation', 'Tube compost chips / silage (tuubikompostihake), 10000 kg/ha fresh, DM 0.283'],
    qvSilage('2020-08-27', 1857.58, 0.701),
    ['2021-05-12', 'fertilisation', 'Broiler litter manure (kuivikelanta), 4000 kg/ha fresh, DM 0.66'],
    qvGrazing('2021-06-01', '4 horses', 7),
    qvSilage('2021-06-21', 3526, 0.786),
    qvGrazing('2022-06-01', '9 cows', 15),
    qvSilage('2022-06-21', 2638.9, 0.329),
    ['2022-07-04', 'fertilisation', 'Qvidja compost, 15330 kg/ha fresh, DM 0.354'],
    qvCleaningCut('2022-09-09'),
    qvCleaningCut('2023-06-19'),
    qvSilage('2023-06-20', 752.1, 0.404),
    qvCleaningCut('2023-08-21'),
    qvSilage('2023-08-22', 1088.86, 0.404),
    ['2023-08-30', 'fertilisation', 'Soilfood compost fibre (Rav.kuitu II L), 34500 kg/ha fresh, DM 0.48'],
    ['2023-09-07', 'tillage', 'Subsoiling and cultivation (jankkurointi ja kultivointi)'],
    qvSilage('2024-06-15', 3936.65, 0.423),
    qvCleaningCut('2024-07-18'),
    qvCleaningCut('2024-08-09'),
    qvGrazing('2024-10-04', '14 highland cows', 8),
    qvGrazing('2025-06-14', '4 horses', 5),
    qvGrazing('2025-07-30', '20 highland cows', 12),
  ]),

  // ---- Viikki: docx table (day and month, year from the row). The N sources
  // are matched to the application dates in the order of the table.
  ...rowsOf('viikki', VI_DOCX, [
    ['2022-05-10', 'fertilisation', 'CAN mineral fertiliser, 108 kg N/ha'],
    ['2022-07-01', 'harvest', 'Timothy, first cut'],
    ['2022-08-27', 'harvest', 'Timothy, second cut; yield of the year 3673 kg DW/ha'],
    ['2022-11-02', 'tillage', 'Tillage'],
    ['2023-04-27', 'fertilisation', 'Dry manure, 18.4 kg N/ha'],
    ['2023-04-28', 'tillage', 'Tillage'],
    ['2023-05-25', 'fertilisation', 'Mineral N, 67.5 kg N/ha'],
    ['2023-05-25', 'tillage', 'Tillage'],
    ['2023-08-17', 'harvest', 'Barley, clover and grasses, first cut'],
    ['2023-08-24', 'harvest', 'Barley, clover and grasses, second cut; yield of the year 6773 kg DW/ha'],
    ['2024-05-08', 'fertilisation', 'Mineral N, 27.0 kg N/ha'],
    ['2024-05-22', 'fertilisation', 'Liquid manure, 57.5 kg N/ha'],
    ['2024-07-31', 'harvest', 'Silage; yield of the year 2336 kg DW/ha'],
    ['2024-10-09', 'fertilisation', 'Dry manure, 22.5 kg N/ha'],
    ['2024-10-09', 'tillage', 'Tillage'],
    ['2025-05-08', 'tillage', 'Tillage', '2025-05-09'],
    ['2025-05-10', 'fertilisation', 'Mineral fertiliser, 21.6 kg N/ha'],
    ['2025-09-10', 'harvest', 'Faba beans; yield of the year 1973.7 kg DW/ha'],
  ]),
];
