// Carbon in harvest and in organic inputs per site and event, transcribed
// from the management files in data/ (read-only) and from the two Qvidja
// papers. Rules: dry_mass_kg_ha = fresh_kg_ha * dm_fraction, or the value
// given; c_g_m2 = dry_mass_kg_ha * c_fraction / 10. NULL c_fraction = the
// carbon content is not known, the row counts as an unknown input.
//
// Carbon fraction per site (user decision 2026-10-21): Qvidja 0.42
// (Heimsch et al. 2021, 2024), Haltiala 0.50 (the xlsx gives kg C/ha that
// equal 0.50 x kg DW/ha), Viikki 0.42 as an assumption. Anttila and
// Särkisuo 0.47 (Shurpali et al. 2025, Table 4, added 2026-10-23); the
// yields per cut of 2022 and 2023 come from AG_XLSX. AG_XLSX says "Maaninka
// C content of dry biomass 41.7 %", but its C column is yield x 0.583; the
// paper value 0.47 is kept (user decision 2026-10-23).
//
// Qvidja grazing (AG_XLSX, values from Heimsch et al. 2024): two rows per
// grazing, the grass eaten as action harvest and the excreta returned as
// action fertilisation, both with c_g_m2 given. A grazing row without carbon
// stays action grazing (NECB note "Grazing not quantified").
//
// Design: docs/calculated.md.

export type ManagementAction = 'harvest' | 'fertilisation' | 'grazing';
export type CFractionSource = 'site' | 'assumed' | 'none';

export type ManagementRow = {
  site: 'anttila' | 'sarkisuo' | 'haltiala' | 'qvidja' | 'viikki' | 'maktau';
  date: string;
  action: ManagementAction;
  product: string;
  fresh_kg_ha: number | null;
  dm_fraction: number | null;
  dry_mass_kg_ha: number | null;
  c_fraction: number | null;
  c_fraction_source: CFractionSource;
  /** Carbon of the event in g C m-2. Computed by cGm2() when null and the inputs exist. */
  c_g_m2: number | null;
  /** Crop of the event in events.ts that takes the carbon, when more than one event has the same site, date and type. */
  event_crop?: string;
  source: string;
  note: string;
};

const QV_XLSX = 'data/Qvidja/Qvidja_management.xlsx';
const QV_2021 = 'data/Qvidja/Qvidja_C-balance.pdf (Heimsch et al. 2021, Table 1)';
const QV_2024 = 'data/Qvidja/Qvidja.pdf (Heimsch et al. 2024)';
const HA_XLSX = 'data/Haltiala/haltiala_smear_management.xlsx';
const VI_DOCX = 'data/Viikki/EC/Management Information.docx';
const SH_2025 = 'data/articles/Shurpali_2025.pdf (Shurpali et al. 2025, Table 4)';
const AG_XLSX = 'data/Agri_site_management_events 2018-2025.xlsx';
const QV_AG = `${QV_XLSX}; ${AG_XLSX}`;

const qvHarvest = (date: string, fresh: number, dm: number, note = ''): ManagementRow => ({
  site: 'qvidja', date, action: 'harvest', product: 'silage feed, whole crop', fresh_kg_ha: fresh, dm_fraction: dm, dry_mass_kg_ha: null,
  c_fraction: 0.42, c_fraction_source: 'site', c_g_m2: null, source: QV_XLSX, note,
});

const qvFertUnknown = (date: string, product: string, fresh: number, dm: number): ManagementRow => ({
  site: 'qvidja', date, action: 'fertilisation', product, fresh_kg_ha: fresh, dm_fraction: dm, dry_mass_kg_ha: null,
  c_fraction: null, c_fraction_source: 'none', c_g_m2: null, source: QV_XLSX,
  note: 'Carbon content of the product is not in the data. With an assumed 0.30 g C per g DM the input would be ' + Math.round((fresh * dm * 0.3) / 10) + ' g C m-2.',
});

/** Qvidja carbon value given in AG_XLSX as kg C/ha. */
const qvAgC = (date: string, action: ManagementAction, product: string, kgCHa: number, note: string, event_crop?: string): ManagementRow => ({
  site: 'qvidja', date, action, product, fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: null,
  c_fraction: action === 'harvest' ? 0.42 : null, c_fraction_source: 'site', c_g_m2: kgCHa / 10, source: QV_AG, note,
  ...(event_crop ? { event_crop } : {}),
});

/** Anttila or Särkisuo cut from AG_XLSX, kg DW/ha, grass C content 0.47 of Shurpali et al. 2025. */
const grassCut = (site: 'anttila' | 'sarkisuo', date: string, product: string, dw: number, note = ''): ManagementRow => ({
  site, date, action: 'harvest', product, fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: dw,
  c_fraction: 0.47, c_fraction_source: 'site', c_g_m2: null, source: `${AG_XLSX}; ${SH_2025}`, note: `Yield per cut from AG_XLSX. Grass C content 0.47 from the paper.${note}`,
});

const haHarvest = (date: string, dw: number, note: string): ManagementRow => ({
  site: 'haltiala', date, action: 'harvest', product: 'grain', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: dw,
  c_fraction: 0.5, c_fraction_source: 'site', c_g_m2: null, source: HA_XLSX, note,
});

export const MANAGEMENT_CARBON: ManagementRow[] = [
  // ---- Qvidja harvests. Amount = fresh mass kg/ha, DM fraction in the file.
  {
    ...qvHarvest('2018-06-12', 615, 0.3), fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 1985, source: QV_2021,
    note: 'The xlsx row gives 615 kg/ha x 0.30 = 185 kg DM/ha. Heimsch et al. 2021 Table 1 gives 1985 kg DW/ha for this cut. The paper value is used.',
  },
  // Dates from AG_XLSX (user decision 2026-10-23); the Qvidja xlsx date is in the note.
  { ...qvHarvest('2018-09-23', 1439, 0.241, 'Matches Heimsch et al. 2021 (348 kg DW/ha). Qvidja xlsx date 2018-09-25.'), source: QV_AG },
  { ...qvHarvest('2019-06-11', 7652, 0.406, 'Matches Heimsch et al. 2021 (3107 kg DW/ha). Qvidja xlsx date 2019-06-10.'), source: QV_AG },
  { ...qvHarvest('2019-08-20', 2707, 0.38, 'Matches Heimsch et al. 2021 (1029 kg DW/ha). Qvidja xlsx date 2019-08-21.'), source: QV_AG },
  { ...qvHarvest('2020-06-23', 5027.86, 0.439, 'Qvidja xlsx date 2020-06-11; the flux data show the cut on 23-24 June.'), source: QV_AG },
  { ...qvHarvest('2020-08-28', 1857.58, 0.701, 'DM fraction 0.70 is high for silage. The amount may be on a dry basis. Qvidja xlsx date 2020-08-27.'), source: QV_AG },
  // AG_XLSX gives kg C/ha for 2021 and 2022. With the grazing removal they agree with Heimsch et al. 2024, Table 1
  // (2021-22: 1968 + 57 = 2025 kg C/ha vs 203 g C m-2; 2022-23: 439 + 114 = 553 kg C/ha vs 55 g C m-2).
  qvAgC('2021-06-14', 'harvest', 'silage feed, whole crop', 1968, 'AG_XLSX 1968 kg C/ha. The Qvidja xlsx gives 3526 kg/ha x DM 0.786 = 116 g C m-2 and the date 2021-06-21; the flux data show the cut on 14-15 June.'),
  qvAgC('2022-06-21', 'harvest', 'silage feed, whole crop', 439, 'AG_XLSX 439 kg C/ha (DM 0.786). The Qvidja xlsx gives 2638.9 kg/ha x DM 0.329 = 36 g C m-2.'),
  qvHarvest('2023-06-20', 752.1, 0.404),
  qvHarvest('2023-08-22', 1088.86, 0.404),
  qvHarvest('2024-06-15', 3936.65, 0.423, 'AG_XLSX gives 717.6 kg C/ha with DM 0.434; the Qvidja xlsx DM 0.423 is kept.'),
  // ---- Qvidja organic inputs
  {
    site: 'qvidja', date: '2018-07-16', action: 'fertilisation', product: 'NK molasses fertiliser', fresh_kg_ha: 2800, dm_fraction: null, dry_mass_kg_ha: null,
    c_fraction: null, c_fraction_source: 'site', c_g_m2: 57, source: QV_2021, note: '205 g organic C per kg product: 2800 x 0.205 / 10 = 57 g C m-2 (paper value).',
  },
  {
    site: 'qvidja', date: '2018-08-24', action: 'fertilisation', product: 'NK molasses fertiliser', fresh_kg_ha: 1755, dm_fraction: null, dry_mass_kg_ha: null,
    c_fraction: null, c_fraction_source: 'site', c_g_m2: 36, source: QV_2021, note: '205 g organic C per kg product (paper value).',
  },
  {
    site: 'qvidja', date: '2019-05-08', action: 'fertilisation', product: 'NK molasses fertiliser', fresh_kg_ha: 4606, dm_fraction: null, dry_mass_kg_ha: null,
    c_fraction: null, c_fraction_source: 'site', c_g_m2: 43, source: QV_2021, note: 'Paper value. The product of 2019 had a lower C content than in 2018.',
  },
  { ...qvFertUnknown('2020-07-27', 'own NPK mix 2020 (oma NPK seos)', 9380, 0.13), source: QV_AG, event_crop: 'Own NPK mix' },
  {
    ...qvAgC('2020-07-27', 'fertilisation', 'tube compost chips / silage (tuubikompostihake)', 1010, 'AG_XLSX 1010 kg C/ha (10000 kg/ha fresh, DM 0.283: C 0.36 of DM). Heimsch et al. 2024, Table 1: input 110 ± 15 g C m-2 in 2020-21.', 'Tube compost chips'),
    fresh_kg_ha: 10000, dm_fraction: 0.283,
  },
  qvFertUnknown('2021-05-12', 'broiler litter manure (kuivikelanta)', 4000, 0.66),
  {
    ...qvAgC('2022-07-04', 'fertilisation', 'Qvidja compost', 1495, 'AG_XLSX 1495 kg C/ha (15330 kg/ha fresh, DM 0.354: C 0.28 of DM). With the grazing return 1543 kg C/ha = Heimsch et al. 2024, Table 1 (154 g C m-2 in 2022-23).'),
    fresh_kg_ha: 15330, dm_fraction: 0.354,
  },
  // AG_XLSX gives 4968 kg C/ha = 34500 x 0.48 x 0.3, an own calculation with an assumed C 0.30 of DM.
  { ...qvFertUnknown('2023-08-30', 'Soilfood compost fibre (Rav.kuitu II L)', 34500, 0.48), c_fraction: 0.3, c_fraction_source: 'assumed', source: QV_AG, note: 'C 0.30 of DM is an assumption (AG_XLSX: 4968 kg C/ha, own calculation of the file author).' },
  // ---- Qvidja grazing with carbon (AG_XLSX; grass eaten = harvest, excreta = input). Dates from AG_XLSX.
  ...(
    [
      ['2021-08-23', '4 horses, 7 days', 57, 24, 'Qvidja xlsx date 2021-06-01. Heimsch et al. 2024: 8 cows in August 2021.'],
      ['2022-08-05', '9 cows, 15 days', 114, 48, 'Qvidja xlsx date 2022-06-01. Heimsch et al. 2024: 9 cows in August 2022.'],
      ['2024-10-04', '14 highland cows, 8 days', 94.57, 39, 'Own calculation of the AG_XLSX author.'],
    ] as const
  ).flatMap(([date, what, eaten, back, note]) => [
    qvAgC(date, 'harvest', `grazing removal, ${what}`, eaten, `Grass eaten, ${eaten} kg C/ha. ${note}`),
    qvAgC(date, 'fertilisation', `grazing excreta return, ${what}`, back, `Excreta returned, ${back} kg C/ha. ${note}`),
  ]),
  // ---- Qvidja grazing without carbon
  ...[
    ['2025-06-14', '4 horses, 5 days'],
    ['2025-07-30', '20 highland cows, 12 days'],
  ].map(
    ([date, product]): ManagementRow => ({
      site: 'qvidja', date: date!, action: 'grazing', product: product!, fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: null,
      c_fraction: null, c_fraction_source: 'none', c_g_m2: null, source: QV_XLSX, note: 'Grass eaten and excreta returned are not quantified. Heimsch et al. 2024 include both in their balance.',
    }),
  ),
  // ---- Haltiala
  haHarvest('2021-09-10', 7187, 'Barley. Whole above-ground biomass from 4 x 4 plots of 50 x 50 cm. The file gives 3595 kg C/ha (= 0.50 x DW).'),
  haHarvest('2022-08-15', 6903, 'Oats, grain only (threshing). The file gives 3452 kg C/ha. Straw (full biomass 11484 kg DW/ha) was shredded and left on the field.'),
  {
    site: 'haltiala', date: '2023-06-20', action: 'fertilisation', product: 'manure, 10 m3/ha (north sector 19-21 June, south sector 1-2 August)', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: null,
    c_fraction: null, c_fraction_source: 'none', c_g_m2: null, source: HA_XLSX, note: 'Volume only, no mass, DM or C content. The grass crop of 2023 failed; no harvest.',
  },
  {
    site: 'haltiala', date: '2024-10-10', action: 'harvest', product: 'sunflower, crop crushed and left (tillage)', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 0,
    c_fraction: 0.5, c_fraction_source: 'site', c_g_m2: 0, source: HA_XLSX, note: 'No export from the field.',
  },
  haHarvest('2025-10-03', 3608, 'Oats. The file says kg DW/ha; the parcel card gives the same number as the farm yield (117260 kg on 32.5 ha), which may be fresh grain weight. No C value in the file.'),
  // ---- Viikki
  {
    site: 'viikki', date: '2022-08-27', action: 'harvest', product: 'timothy, two cuts (1 July, 27 August)', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 3673,
    c_fraction: 0.42, c_fraction_source: 'assumed', c_g_m2: null, source: VI_DOCX, note: 'Yield of the year 3673 kg DW/ha (docx). C fraction 0.42 assumed as for Qvidja.',
  },
  {
    site: 'viikki', date: '2023-08-24', action: 'harvest', product: 'barley, clover and grasses, two cuts (17 and 24 August)', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 6773,
    c_fraction: 0.42, c_fraction_source: 'assumed', c_g_m2: null, source: VI_DOCX, note: 'Yield of the year 6773 kg DW/ha (docx). C fraction 0.42 assumed.',
  },
  {
    site: 'viikki', date: '2023-04-27', action: 'fertilisation', product: 'dry manure (18.4 kg N/ha) + mineral N', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: null,
    c_fraction: null, c_fraction_source: 'none', c_g_m2: null, source: VI_DOCX, note: 'Only the N input is given.',
  },
  {
    site: 'viikki', date: '2024-07-31', action: 'harvest', product: 'grass hay, two cuts (14 June about 1 ha only, 31 July)', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 2336,
    c_fraction: 0.42, c_fraction_source: 'assumed', c_g_m2: null, source: VI_DOCX, note: 'Yield 2336 kg DW/ha (docx) = 1660 + 676.45 kg/ha of the two cuts in AG_XLSX. C fraction 0.42 assumed.',
  },
  {
    site: 'viikki', date: '2024-05-22', action: 'fertilisation', product: 'liquid manure (57.5 kg N/ha) + dry manure (22.5 kg N/ha, 9 Oct) + mineral N', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: null,
    c_fraction: null, c_fraction_source: 'none', c_g_m2: null, source: VI_DOCX, note: 'Only the N input is given.',
  },
  {
    site: 'viikki', date: '2025-09-10', action: 'harvest', product: 'faba beans', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 1973.7,
    c_fraction: 0.42, c_fraction_source: 'assumed', c_g_m2: null, source: VI_DOCX, note: 'Yield 1973.7 kg DW/ha (docx). C fraction 0.42 assumed.',
  },
  // ---- Anttila and Särkisuo: yields per cut from AG_XLSX, grass C content of Shurpali et al. 2025.
  grassCut('anttila', '2022-06-21', 'timothy and red clover, first cut', 3360),
  grassCut('anttila', '2022-08-08', 'timothy and red clover, second cut', 4140, ' Sum of 2022 = 7500 kg DM/ha = Table 4. Paper date of the cut 2022-09-08; the flux data show 8 August.'),
  grassCut('anttila', '2023-06-21', 'timothy and red clover, first cut', 5138),
  grassCut('anttila', '2023-07-19', 'timothy and red clover, second cut', 2576),
  grassCut('sarkisuo', '2022-06-30', 'timothy and meadow fescue, first cut', 2450),
  grassCut('sarkisuo', '2022-08-15', 'timothy and meadow fescue, second cut', 2220, ' Sum of 2022 = 4670 kg DW/ha; Table 4 gives 4700.'),
  grassCut('sarkisuo', '2023-06-29', 'timothy and meadow fescue, first cut', 4032),
  grassCut('sarkisuo', '2023-08-15', 'timothy and meadow fescue, second cut', 2440),
];

/** Carbon of a row in g C m-2, or null when an input is missing. */
export function cGm2(r: ManagementRow): number | null {
  if (r.c_g_m2 !== null) return r.c_g_m2;
  const dry = r.dry_mass_kg_ha ?? (r.fresh_kg_ha !== null && r.dm_fraction !== null ? r.fresh_kg_ha * r.dm_fraction : null);
  if (dry === null || r.c_fraction === null) return null;
  return (dry * r.c_fraction) / 10;
}

export function dryMass(r: ManagementRow): number | null {
  return r.dry_mass_kg_ha ?? (r.fresh_kg_ha !== null && r.dm_fraction !== null ? r.fresh_kg_ha * r.dm_fraction : null);
}
