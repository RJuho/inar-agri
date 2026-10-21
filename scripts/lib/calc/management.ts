// Carbon in harvest and in organic inputs per site and event, transcribed
// from the management files in data/ (read-only) and from the two Qvidja
// papers. Rules: dry_mass_kg_ha = fresh_kg_ha * dm_fraction, or the value
// given; c_g_m2 = dry_mass_kg_ha * c_fraction / 10. NULL c_fraction = the
// carbon content is not known, the row counts as an unknown input.
//
// Carbon fraction per site (user decision 2026-10-21): Qvidja 0.42
// (Heimsch et al. 2021, 2024), Haltiala 0.50 (the xlsx gives kg C/ha that
// equal 0.50 x kg DW/ha), Viikki 0.42 as an assumption.
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
  source: string;
  note: string;
};

const QV_XLSX = 'data/Qvidja/Qvidja_management.xlsx';
const QV_2021 = 'data/Qvidja/Qvidja_C-balance.pdf (Heimsch et al. 2021, Table 1)';
const QV_2024 = 'data/Qvidja/Qvidja.pdf (Heimsch et al. 2024)';
const HA_XLSX = 'data/Haltiala/haltiala_smear_management.xlsx';
const VI_DOCX = 'data/Viikki/EC/Management Information.docx';

const qvHarvest = (date: string, fresh: number, dm: number, note = ''): ManagementRow => ({
  site: 'qvidja', date, action: 'harvest', product: 'silage feed, whole crop', fresh_kg_ha: fresh, dm_fraction: dm, dry_mass_kg_ha: null,
  c_fraction: 0.42, c_fraction_source: 'site', c_g_m2: null, source: QV_XLSX, note,
});

const qvFertUnknown = (date: string, product: string, fresh: number, dm: number): ManagementRow => ({
  site: 'qvidja', date, action: 'fertilisation', product, fresh_kg_ha: fresh, dm_fraction: dm, dry_mass_kg_ha: null,
  c_fraction: null, c_fraction_source: 'none', c_g_m2: null, source: QV_XLSX,
  note: 'Carbon content of the product is not in the data. With an assumed 0.30 g C per g DM the input would be ' + Math.round((fresh * dm * 0.3) / 10) + ' g C m-2.',
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
  qvHarvest('2018-09-25', 1439, 0.241, 'Matches Heimsch et al. 2021 (348 kg DW/ha).'),
  qvHarvest('2019-06-10', 7652, 0.406, 'Matches Heimsch et al. 2021 (3107 kg DW/ha).'),
  qvHarvest('2019-08-21', 2707, 0.38, 'Matches Heimsch et al. 2021 (1029 kg DW/ha).'),
  qvHarvest('2020-06-11', 5027.86, 0.439),
  qvHarvest('2020-08-27', 1857.58, 0.701, 'DM fraction 0.70 is high for silage. The amount may be on a dry basis. Check with the site.'),
  qvHarvest('2021-06-21', 3526, 0.786, 'DM fraction 0.79 is high for silage. The amount may be on a dry basis. Check with the site.'),
  qvHarvest('2022-06-21', 2638.9, 0.329),
  qvHarvest('2023-06-20', 752.1, 0.404),
  qvHarvest('2023-08-22', 1088.86, 0.404),
  qvHarvest('2024-06-15', 3936.65, 0.423),
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
  qvFertUnknown('2020-05-25', 'own NPK mix 2020 (oma NPK seos)', 9380, 0.13),
  qvFertUnknown('2020-07-27', 'tube compost chips / silage (tuubikompostihake)', 10000, 0.283),
  qvFertUnknown('2021-05-12', 'broiler litter manure (kuivikelanta)', 4000, 0.66),
  qvFertUnknown('2022-07-04', 'Qvidja compost', 15330, 0.354),
  qvFertUnknown('2023-08-30', 'Soilfood compost fibre (Rav.kuitu II L)', 34500, 0.48),
  // ---- Qvidja grazing (no carbon computed)
  ...[
    ['2021-06-01', '4 horses, 7 days'],
    ['2022-06-01', '9 cows, 15 days'],
    ['2024-10-04', '14 highland cows, 8 days'],
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
    site: 'viikki', date: '2024-07-31', action: 'harvest', product: 'silage, one cut', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 2336,
    c_fraction: 0.42, c_fraction_source: 'assumed', c_g_m2: null, source: VI_DOCX, note: 'Yield 2336 kg DW/ha (docx). C fraction 0.42 assumed.',
  },
  {
    site: 'viikki', date: '2024-05-22', action: 'fertilisation', product: 'liquid manure (57.5 kg N/ha) + dry manure (22.5 kg N/ha, 9 Oct) + mineral N', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: null,
    c_fraction: null, c_fraction_source: 'none', c_g_m2: null, source: VI_DOCX, note: 'Only the N input is given.',
  },
  {
    site: 'viikki', date: '2025-09-10', action: 'harvest', product: 'faba beans', fresh_kg_ha: null, dm_fraction: null, dry_mass_kg_ha: 1973.7,
    c_fraction: 0.42, c_fraction_source: 'assumed', c_g_m2: null, source: VI_DOCX, note: 'Yield 1973.7 kg DW/ha (docx). C fraction 0.42 assumed.',
  },
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
