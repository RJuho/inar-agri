// Registry of sites, source files and column mappings for the harmonised
// database. Edit this file to add a site, a file or a variable. The build
// script validates it with Valibot before it reads any data.
//
// Column expressions are SQL. They see the cleaned text columns of the
// source file (trimmed, decimal comma replaced by a point, empty = NULL).
// Use num("col") to get a DOUBLE with the sentinels -9999, NA and inf as NULL.
// `ts_parsed` is the parsed source timestamp (local time, as in the file). An
// expression can use a window function, for example a rule per local day.

import { ML3_THETA_RANGE, ml3MineralThetaSql } from './ml3.ts';

/** Strict core: present at all six sites. */
export const CORE_COLUMNS = ['nee', 'nee_f', 'nee_qc', 'ta', 'tsoil', 'swc'] as const;
/** Optional columns: present at some sites only, NULL elsewhere. Inputs of scripts/calc.ts. */
export const OPTIONAL_COLUMNS = [
  'sw_in', 'ppfd', 'rh', 'vpd', 'ustar', 'nee_ssitc', 'gpp_src', 'reco_src', 'ch4',
  'precip', 'pa', 'ws', 'wd', 'netrad', 'sw_out', 'le', 'g', 'n2o',
] as const;
export const ALL_COLUMNS = [...CORE_COLUMNS, ...OPTIONAL_COLUMNS] as const;
export type CoreColumn = (typeof ALL_COLUMNS)[number];

export type SiteCode = 'anttila' | 'sarkisuo' | 'haltiala' | 'qvidja' | 'viikki' | 'maktau';

export type Site = {
  siteId: number;
  code: SiteCode;
  fluxnetId: string | null;
  name: string;
  country: string;
  lat: number | null;
  lon: number | null;
  elevationM: number | null;
  utcOffsetMin: number;
  timestepMin: number;
  ecosystem: string;
  description: string;
  comment: string | null;
};

export type ColumnMap = {
  /** Source columns that the expression uses. Checked against the file header. */
  sourceColumns: string[];
  /** SQL expression over the cleaned text columns. */
  expr: string;
  /** Multiplication factor that the expression applies (documentation and report). */
  factor?: number;
  /** Exact 0 becomes NULL after the expression (logger fill value). */
  zeroIsNull?: boolean;
  /** Valid range [min, max] of the result. Values outside become NULL; the build report counts them. */
  validRange?: readonly [number, number];
  /** Sensor depth in cm. null = not known. */
  depthCm?: number | null;
  note?: string;
};

export type Source = {
  id: string;
  site: SiteCode;
  path: string;
  delim: ',' | ';';
  /** Lines before the first data line: 1 = header only, 2 = header and unit row. */
  headerLines: number;
  decimalComma: boolean;
  /** Text encoding of the file. Default utf-8. */
  encoding?: 'utf-8' | 'latin-1';
  timestampColumn: string;
  /** strptime formats, tried in this order. */
  timestampFormats: string[];
  /** true = the stamp marks the end of the averaging period. */
  timestampIsEnd: boolean;
  /** Time step of the file in minutes. */
  stepMin: number;
  /** Precedence when two sources give a value for the same site and period. 1 = highest. */
  rank: number;
  /** Required for files with a time step below 30 minutes. */
  aggregate?: { method: 'mean'; minCount: number };
  /**
   * Required for files with a time step above 30 minutes. Each row gives its values to the
   * 30-min periods that start at the parsed stamp + each offset (minutes). The value of a
   * column in `sumColumns` (a sum over the step) is divided by the number of offsets;
   * the other columns (means) are copied.
   */
  expand?: { offsetsMin: number[]; sumColumns: CoreColumn[] };
  columns: Partial<Record<CoreColumn, ColumnMap>>;
};

export type Registry = { sites: Site[]; sources: Source[] };

/** 1 mg CO2 = 1000 / 44.0095 µmol CO2. The Viikki EC files give NEE in mg CO2 m-2 s-1 (header). */
export const MG_CO2_TO_UMOL = 1000 / 44.0095;
/** Viikki WFPS (%) to m3 m-3: porosity 0.509433962 (= 1 - 1.3 / 2.65, columns of the 2022 and 2023 files) / 100. */
export const VIIKKI_WFPS_TO_SWC = 0.509433962 / 100;
/** 1 µmol = 1000 nmol. Anttila and Särkisuo give N2O in µmol m-2 s-1 (unit row). */
export const UMOL_TO_NMOL = 1000;
/** 1 µg N2O = 1000 / 44.013 nmol N2O. Assumption: the Viikki N2O header "ug m-2 s-1" means µg N2O, not µg N2O-N. */
export const UG_N2O_TO_NMOL = 1000 / 44.013;

const ISO_SECONDS = '%Y-%m-%d %H:%M:%S';
const ISO_MINUTES = '%Y-%m-%d %H:%M';
const COMPACT = '%Y%m%d%H%M';
const FINNISH = '%-d.%-m.%Y %-H:%M';

export const SITES: Site[] = [
  {
    siteId: 1, code: 'anttila', fluxnetId: 'FI-Ant', name: 'Anttila', country: 'FI',
    lat: 63.1453, lon: 27.3128, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'GRA',
    description: 'Legume grassland. Data 2022-2023.',
    comment: 'Coordinates given by the project team 2026-10-22. Soil sensor depths are not known.',
  },
  {
    siteId: 2, code: 'sarkisuo', fluxnetId: 'FI-Sar', name: 'Särkisuo', country: 'FI',
    lat: 63.15142822, lon: 27.19906425, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'GRA',
    description: 'Mixed grasses. Data 2022-2023.',
    comment: 'Coordinates given by the project team 2026-10-22 (name in that list: Särkiluoto). Soil sensor depths are not known.',
  },
  {
    siteId: 3, code: 'haltiala', fluxnetId: null, name: 'Haltiala', country: 'FI',
    lat: 60.271683, lon: 24.94395, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'CRO',
    description: 'Cropland. 2021 barley, 2022 oats, 2023 grass (failed), 2024 sunflowers, 2025 oats. Data 2021-2025.',
    comment: 'Coordinates given by the project team 2026-10-22. data/Haltiala/geodata/haltiala_ec_tower_coords.txt gives 60.271671, 24.944509 (about 30 m east).',
  },
  {
    siteId: 4, code: 'qvidja', fluxnetId: null, name: 'Qvidja', country: 'FI',
    lat: 60.295333, lon: 22.391833, elevationM: 7, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'CRO',
    description: 'Forage grassland, managed intensively with conventional practices until 2017, then more sustainable practices. Data 2018-2025.',
    comment: 'Coordinates given by the project team 2026-10-22. Same point as Qvidja-readme.xlsx (60°17\'43.2" N, 22°23\'30.6" E).',
  },
  {
    siteId: 5, code: 'viikki', fluxnetId: null, name: 'Viikki', country: 'FI',
    lat: 60.21845, lon: 25.01986, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'CRO',
    description: 'Grassland in rotation, field Alaniitty 1. 2022 timothy, 2023 barley / mixed grass / red clover, 2024 grassland, 2025 fava bean. Data 2022-2025.',
    comment: 'Coordinates given by the project team 2026-10-22. NEE unit mg CO2 m-2 s-1 per the file headers, converted to µmol. Soil 2022 from the EC file, 2023-2025 from the soil pit.',
  },
  {
    siteId: 6, code: 'maktau', fluxnetId: 'KE-Mkt', name: 'Maktau', country: 'KE',
    lat: -3.425833, lon: 38.139444, elevationM: null, utcOffsetMin: 180, timestepMin: 30, ecosystem: 'CRO',
    description: 'Maize 80 %, vegetables 20 %. Taita region. EC data 2018-2024, meteo data 2014-2025.',
    comment: 'Coordinates given by the project team 2026-10-22. The earlier value -3.425859, 38.140663 is about 140 m east. No gap-filled NEE exists. Logger fill value 0 in TA, TS and SWC is set to NULL.',
  },
];

function anttilaLike(site: SiteCode, code: string, dir: string, year: number): Source[] {
  return [
    {
      id: `${site}_flux_${year}`, site, path: `data/${dir}/EC_flux_L3_final_${code}_${year}.csv`,
      delim: ',', headerLines: 2, decimalComma: false,
      timestampColumn: 'time', timestampFormats: [ISO_SECONDS], timestampIsEnd: false, stepMin: 30, rank: 1,
      columns: {
        nee: {
          sourceColumns: ['co2_flux_final_gf_ensemble', 'co2_flux_final_gap'],
          expr: 'CASE WHEN num("co2_flux_final_gap") = 0 THEN num("co2_flux_final_gf_ensemble") END',
          note: 'Measured value = ensemble value where the gap flag is 0.',
        },
        nee_f: { sourceColumns: ['co2_flux_final_gf_ensemble'], expr: 'num("co2_flux_final_gf_ensemble")' },
        nee_qc: { sourceColumns: ['co2_flux_final_gap'], expr: 'num("co2_flux_final_gap")', note: '0 = measured, 1 = gap-filled.' },
        gpp_src: { sourceColumns: ['GPP_gf_ensemble_NT'], expr: 'num("GPP_gf_ensemble_NT")', note: 'Night-time partitioning of the data provider. GPP >= 0, NEE = Reco - GPP.' },
        reco_src: { sourceColumns: ['Reco_gf_ensemble_NT'], expr: 'num("Reco_gf_ensemble_NT")', note: 'Night-time partitioning of the data provider.' },
        ch4: { sourceColumns: ['ch4_flux_final_gf_ensemble'], expr: 'num("ch4_flux_final_gf_ensemble")', note: 'Gap-filled CH4 flux. Unit row: µmol m-2 s-1.' },
        le: { sourceColumns: ['LE_final_gf_ensemble'], expr: 'num("LE_final_gf_ensemble")', note: 'Gap-filled LE (ensemble). Unit row: W m-2.' },
        n2o: {
          sourceColumns: ['n2o_flux_final_gf_ensemble'], expr: `num("n2o_flux_final_gf_ensemble") * ${UMOL_TO_NMOL}`, factor: UMOL_TO_NMOL,
          note: 'Gap-filled N2O flux. Unit row: µmol m-2 s-1, converted to nmol.',
        },
      },
    },
    {
      id: `${site}_biomet_${year}`, site, path: `data/${dir}/biomet_final_30min_${code}_${year}.csv`,
      delim: ',', headerLines: 2, decimalComma: false,
      timestampColumn: 'TIMESTAMP_1', timestampFormats: [ISO_SECONDS], timestampIsEnd: false, stepMin: 30, rank: 2,
      columns: {
        ta: { sourceColumns: ['TA_1_1_1'], expr: 'num("TA_1_1_1")' },
        tsoil: { sourceColumns: ['TS_1_1_1'], expr: 'num("TS_1_1_1")', depthCm: null, note: 'Depth not in the source files.' },
        swc: { sourceColumns: ['SWC_1_1_1'], expr: 'num("SWC_1_1_1")', depthCm: null, note: 'Depth not in the source files.' },
        sw_in: { sourceColumns: ['SWIN_1_1_1'], expr: 'num("SWIN_1_1_1")' },
        ppfd: { sourceColumns: ['PPFD_1_1_1'], expr: 'num("PPFD_1_1_1")' },
        rh: { sourceColumns: ['RH_1_1_1'], expr: 'num("RH_1_1_1")' },
        precip: { sourceColumns: ['P_RAIN_1_1_1'], expr: 'num("P_RAIN_1_1_1")', note: 'Rain gauge, mm per 30 min.' },
        pa: { sourceColumns: ['PA_1_1_1'], expr: 'num("PA_1_1_1")' },
        netrad: { sourceColumns: ['RN_1_1_1'], expr: 'num("RN_1_1_1")' },
        sw_out: { sourceColumns: ['SWOUT_1_1_1'], expr: 'num("SWOUT_1_1_1")' },
        g: { sourceColumns: ['SHF_1_1_1'], expr: 'num("SHF_1_1_1")', depthCm: null, note: 'Heat flux plate 1. Depth not in the source files.' },
      },
    },
  ];
}

function viikkiEc(year: number): Source {
  // Column names change by year. The degree sign is a literal "?" in the files.
  const nee = 'NEE (mg CO2 m-2 s-1)';
  const neeF = year === 2024 ? 'NEE _gapfilled (mg CO2 m-2 s-1)' : 'NEE_gapfilled (mg CO2 m-2 s-1)';
  const tair = year <= 2023 ? 'Tair  (?C)' : 'Tair (?C)';
  const rh = year <= 2023 ? 'RH(%)' : 'RH (%)';
  const ppfd = year === 2025 ? 'PPFD (umol/m2s)' : 'PAR (umol/m2s)';
  const precip = year === 2024 ? 'P(mm)' : 'P (mm)';
  const swOut = year <= 2023 ? 'Swout (W/m2)' : 'SWout (W/m2)';
  const hf = year === 2024 ? 'HF(W/m2)' : 'HF (W/m2)';
  const n2o = 'N2O_gapfilled (ug m-2 s-1)';
  // Air pressure is only in the 2022 and 2023 files.
  const pair: Partial<Record<CoreColumn, ColumnMap>> = year <= 2023 ? { pa: { sourceColumns: ['Pair'], expr: 'num("Pair")', note: 'Only 2022 and 2023.' } } : {};
  const soil2022: Partial<Record<CoreColumn, ColumnMap>> =
    year === 2022
      ? {
          tsoil: {
            sourceColumns: ['T1 (?C)'], expr: 'num("T1 (?C)")', depthCm: 14,
            note: 'Only 2022, where no pit file exists. Same sensor as pit Temp_T12_Avg_1 (30-min mean, checked for 2023 and 2024). Values from 2022-04-12.',
          },
          swc: {
            sourceColumns: ['WFPS1 (%)'], expr: `num("WFPS1 (%)") * ${VIIKKI_WFPS_TO_SWC}`, factor: VIIKKI_WFPS_TO_SWC, depthCm: 14,
            note: 'Only 2022, where no pit file exists. WFPS1 = WC1 / porosity * 100 in the file. The factor gives back pit WC1 (exact for 2023 and 2024). Values from 2022-04-12.',
          },
        }
      : {};
  return {
    id: `viikki_ec_${year}`, site: 'viikki', path: `data/Viikki/EC/${year}.csv`,
    delim: ';', headerLines: 1, decimalComma: true, encoding: 'latin-1',
    timestampColumn: 'Datetime', timestampFormats: [FINNISH], timestampIsEnd: false, stepMin: 30, rank: 1,
    columns: {
      nee: { sourceColumns: [nee], expr: `num("${nee}") * ${MG_CO2_TO_UMOL}`, factor: MG_CO2_TO_UMOL, note: 'Measured NEE. Unit mg CO2 m-2 s-1 in the header.' },
      nee_f: {
        sourceColumns: [neeF], expr: `num("${neeF}") * ${MG_CO2_TO_UMOL}`, factor: MG_CO2_TO_UMOL,
        note: 'Gap-filled NEE. Unit mg CO2 m-2 s-1 in the header. In 2024 (1750 periods) and 2025 (228) the gap-filled value differs from the measured value.',
      },
      nee_qc: { sourceColumns: [nee], expr: `CASE WHEN num("${nee}") IS NOT NULL THEN 0 ELSE 1 END`, note: '0 where a measured NEE exists.' },
      ta: { sourceColumns: [tair], expr: `num("${tair}")` },
      sw_in: { sourceColumns: ['SWin (W/m2)'], expr: 'num("SWin (W/m2)")' },
      ppfd: { sourceColumns: [ppfd], expr: `num("${ppfd}")` },
      rh: { sourceColumns: [rh], expr: `num("${rh}")` },
      precip: { sourceColumns: [precip], expr: `num("${precip}")`, note: 'Total precipitation, mm per 30 min. Equals rainfall + snowfall in the file.' },
      ...pair,
      ws: { sourceColumns: ['WS (m/s)'], expr: 'num("WS (m/s)")' },
      wd: { sourceColumns: ['WD (deg)'], expr: 'num("WD (deg)")' },
      sw_out: { sourceColumns: [swOut], expr: `num("${swOut}")` },
      g: { sourceColumns: [hf], expr: `num("${hf}")`, depthCm: null, note: 'Heat flux plate. Depth not in the source files.' },
      n2o: {
        sourceColumns: [n2o], expr: `num("${n2o}") * ${UG_N2O_TO_NMOL}`, factor: UG_N2O_TO_NMOL,
        note: 'Gap-filled N2O flux. Assumption: header unit ug m-2 s-1 = µg N2O (not N2O-N), converted with M(N2O) = 44.013 g mol-1.',
      },
      ...soil2022,
    },
  };
}

function viikkiPit(year: number): Source {
  return {
    id: `viikki_pit_${year}`, site: 'viikki', path: `data/Viikki/pit1_cleaned_${year}.csv`,
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'TIMESTAMP', timestampFormats: [ISO_SECONDS], timestampIsEnd: true, stepMin: 5, rank: 10,
    aggregate: { method: 'mean', minCount: 3 },
    columns: {
      tsoil: { sourceColumns: ['Temp_T12_Avg_1'], expr: 'num("Temp_T12_Avg_1")', depthCm: 14, note: 'Teros-12 layer 1. Mean of the 5-min values in the 30-min period.' },
      swc: { sourceColumns: ['WC1'], expr: 'num("WC1")', depthCm: 14, note: 'Teros-12 layer 1. Mean of the 5-min values in the 30-min period.' },
    },
  };
}

/**
 * Rows where TA_1_1_1 and RH_1_1_1 are both exact 0 are logger fill rows (mainly 2023-02-24 to 2024-02,
 * in both Maktau files). In these rows TA, RH, TS, SWC, SW_IN, P_RAIN, WS and G are 0 (SW_IN is 0 also at
 * midday: 2 043 day rows). NETRAD_1_1_1 and PA_1_1_1 are not affected: they have normal values there
 * (night mean of NETRAD -56 W m-2 in fill rows and in other rows).
 * Use `${MAKTAU_FILL_ROW} THEN NULL` in a CASE, so that a missing TA or RH does not remove the value.
 */
const MAKTAU_FILL_ROW = 'num("TA_1_1_1") = 0 AND num("RH_1_1_1") = 0';

const maktauSoil = (rank: number): Partial<Record<CoreColumn, ColumnMap>> => ({
  ta: { sourceColumns: ['TA_1_1_1'], expr: 'num("TA_1_1_1")', zeroIsNull: true, note: `Rank ${rank}. Exact 0 is a logger fill value.` },
  tsoil: { sourceColumns: ['TS_1_1_1'], expr: 'num("TS_1_1_1")', zeroIsNull: true, depthCm: 10, note: `Rank ${rank}. Exact 0 is a logger fill value.` },
  swc: { sourceColumns: ['SWC_1_1_1'], expr: 'num("SWC_1_1_1")', zeroIsNull: true, depthCm: 10, note: `Rank ${rank}. Exact 0 is a logger fill value.` },
  sw_in: {
    sourceColumns: ['SW_IN_1_1_1', 'TA_1_1_1', 'RH_1_1_1'],
    expr: `CASE WHEN ${MAKTAU_FILL_ROW} THEN NULL ELSE num("SW_IN_1_1_1") END`,
    note: `Rank ${rank}. NULL in logger fill rows (TA and RH exact 0): SW_IN is 0 there also at midday.`,
  },
  rh: { sourceColumns: ['RH_1_1_1'], expr: 'num("RH_1_1_1")', zeroIsNull: true, note: `Rank ${rank}. Exact 0 is a logger fill value.` },
});

/**
 * Wind vane fault. From 2019-06 the meteo WD_1_1_1 stays at one value for days or months
 * (for example 0.89° in 2021, 351° in 2022, 22.6° from 2024-07). The daily SD of WD is below 0.5°
 * on 1 421 days; before 2019 only 1 day has an SD below 5°. Rule: WD is NULL on a local day
 * (date of ts_parsed) where the SD of WD (rows with WS not 0) is below 5°. The SD is the smaller
 * of the SD of WD and of (WD + 180) mod 360, so that a vane near north (0°/360°) gives a small SD too.
 */
const MAKTAU_WD_DAY = 'PARTITION BY CAST(ts_parsed AS DATE)';
const maktauWdSd = (shift: string): string =>
  `stddev_samp(CASE WHEN num("WS_1_1_1") <> 0 THEN (num("WD_1_1_1")${shift}) % 360 END) OVER (${MAKTAU_WD_DAY})`;
const MAKTAU_WD_STUCK = `coalesce(least(${maktauWdSd('')}, ${maktauWdSd(' + 180')}), 999) < 5`;
/**
 * Anemometer fault. From 2023-07-19 to 2024-06-30 WS_1_1_1 reads low: the ratio of WS to the
 * EC USTAR is 0.5 to 2.5 (3.3 to 4.4 before and after), and 30 to 70 % of the midday values
 * are below 0.2 m s-1 in 2023-10 to 2024-04. The sensor reads normal again from 2024-07-25.
 * USTAR has too many gaps for a row rule, so the rule is a date range (no WS data from 2023-03-08 to 2023-07-18).
 */
const MAKTAU_WS_BAD = "ts_parsed >= TIMESTAMP '2023-07-01' AND ts_parsed < TIMESTAMP '2024-07-01'";
/**
 * Wind sensor before 2014-09. The monthly mean of WS is 10 to 12 m s-1 from 2013-09 to 2014-08
 * (1 to 2 m s-1 from 2014-09, maximum 5.3 m s-1 from 2015). The values are not plausible for this
 * site, thus WS and WD are NULL before 2014-09-01 (MKT-10). The AWS file has the same values.
 */
const MAKTAU_WIND_EARLY = "ts_parsed < TIMESTAMP '2014-09-01'";
/**
 * Meteo file only. The continuous file has no usable WS, and its NETRAD_1_1_1 is a copy of SW_IN.
 * No precip: P_RAIN_1_1_1 of this file is rounded to whole mm (MKT-11). Precip comes from the AWS file.
 */
const maktauMeteo: Partial<Record<CoreColumn, ColumnMap>> = {
  pa: { sourceColumns: ['PA_1_1_1'], expr: 'num("PA_1_1_1")', zeroIsNull: true, note: 'Meteo file only. Exact 0 is a logger fill value.' },
  ws: {
    sourceColumns: ['WS_1_1_1'],
    expr: `CASE WHEN ${MAKTAU_WS_BAD} OR ${MAKTAU_WIND_EARLY} THEN NULL ELSE num("WS_1_1_1") END`,
    zeroIsNull: true,
    note: 'Exact 0 is a logger fill value. NULL before 2014-09-01 (10 to 12 m s-1, not plausible, MKT-10) and from 2023-07 to 2024-06 (anemometer reads low). The WS column of the continuous file is not a speed.',
  },
  wd: {
    sourceColumns: ['WD_1_1_1', 'WS_1_1_1'],
    expr: `CASE WHEN num("WS_1_1_1") <> 0 AND NOT (${MAKTAU_WD_STUCK}) AND NOT (${MAKTAU_WIND_EARLY}) THEN num("WD_1_1_1") END`,
    note: 'NULL where WS_1_1_1 is exact 0 (fill value, WD is then 0 too), on days with a stuck vane (daily SD of WD below 5°) and before 2014-09-01 (wind sensor not plausible, MKT-10). 0° is a valid direction, so no zero rule on WD.',
  },
  netrad: {
    sourceColumns: ['NETRAD_1_1_1'],
    expr: 'num("NETRAD_1_1_1")',
    zeroIsNull: true,
    note: 'Meteo file only (the continuous NETRAD_1_1_1 is a copy of SW_IN). Kept in logger fill rows: the values there are normal. Exact 0 (5 rows) is a fill value.',
  },
  g: { sourceColumns: ['G_1_1_1'], expr: 'num("G_1_1_1")', zeroIsNull: true, depthCm: null, note: 'Meteo file only. Exact 0 is a logger fill value.' },
};

/**
 * Maktau_AWS_1h.dat: hourly values of the same logger as the 30-min meteo file, 2013-09-28 22:00 to
 * 2025-01-10 16:00 (local time UTC+3). The value at stamp t is the mean (rain: the sum) of the
 * 30-min periods that start at t - 30 min and t; thus `expand` gives it to these two periods.
 * The first header is empty (DuckDB name `column00`). Logger fill hours are empty fields here, but
 * Rain_mm_Tot is 0 and Presmb and SlrW_Avg can have values in them: these columns are NULL where
 * AirTC_Avg is empty.
 * Use: all variables before the 30-min file starts (2014-08-23 16:30), and precip for all years,
 * because Rain_mm_Tot has 0.2 mm resolution (the 30-min file rounds to whole mm, MKT-11).
 * No WS and WD (not plausible before 2014-09, MKT-10) and no net radiation column.
 */
const MAKTAU_AWS_GAP = "ts_parsed <= TIMESTAMP '2014-08-23 16:00'";
const MAKTAU_AWS_FILL = 'num("AirTC_Avg") IS NULL';
const awsGap = (col: string, extra: Partial<ColumnMap> = {}, scale = ''): ColumnMap => ({
  sourceColumns: [col],
  expr: `CASE WHEN ${MAKTAU_AWS_GAP} THEN num("${col}")${scale} END`,
  zeroIsNull: true,
  note: 'AWS file, only before the 30-min meteo file starts (stamp up to 2014-08-23 16:00). Hourly mean in both 30-min periods. Exact 0 is a logger fill value.',
  ...extra,
});
const maktauAws: Partial<Record<CoreColumn, ColumnMap>> = {
  ta: awsGap('AirTC_Avg'),
  rh: awsGap('RH'),
  tsoil: awsGap('T_10cm_Avg', { depthCm: 10 }),
  swc: awsGap('VWC_10cm_corr', { depthCm: 10 }),
  sw_in: {
    sourceColumns: ['SlrW_Avg', 'AirTC_Avg'],
    expr: `CASE WHEN ${MAKTAU_AWS_GAP} AND NOT (${MAKTAU_AWS_FILL}) THEN num("SlrW_Avg") END`,
    note: 'AWS file, only before the 30-min meteo file starts (stamp up to 2014-08-23 16:00). Hourly mean in both 30-min periods. NULL in logger fill hours (AirTC_Avg empty).',
  },
  pa: awsGap('Presmb', { factor: 0.1, note: 'AWS file, only before the 30-min meteo file starts (stamp up to 2014-08-23 16:00). Presmb is hPa; factor 0.1 gives kPa. Hourly mean in both 30-min periods. Exact 0 is a logger fill value.' }, ' * 0.1'),
  g: awsGap('Flux_corr_Avg(1)'),
  precip: {
    sourceColumns: ['Rain_mm_Tot', 'AirTC_Avg'],
    expr: `CASE WHEN ${MAKTAU_AWS_FILL} THEN NULL ELSE num("Rain_mm_Tot") END`,
    note: 'All years. Hourly sum with 0.2 mm resolution; half of it in each 30-min period (mm per 30 min). NULL in logger fill hours (AirTC_Avg empty; the file gives 0 there). The 30-min meteo file rounds rain to whole mm (MKT-11) and is not used for precip.',
  },
};

export const SOURCES: Source[] = [
  ...anttilaLike('anttila', 'FI-Ant', 'Anttila', 2022),
  ...anttilaLike('anttila', 'FI-Ant', 'Anttila', 2023),
  ...anttilaLike('sarkisuo', 'FI-Sar', 'Särkisuo', 2022),
  ...anttilaLike('sarkisuo', 'FI-Sar', 'Särkisuo', 2023),
  {
    id: 'haltiala', site: 'haltiala', path: 'data/Haltiala/haltiala.csv',
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'TIMESTAMP_START', timestampFormats: [ISO_MINUTES], timestampIsEnd: false, stepMin: 30, rank: 1,
    columns: {
      nee: { sourceColumns: ['NEE'], expr: 'num("NEE")' },
      nee_f: { sourceColumns: ['NEE_F'], expr: 'num("NEE_F")', note: 'Mean of 10 XGBoost models.' },
      nee_qc: { sourceColumns: ['NEE'], expr: 'CASE WHEN num("NEE") IS NOT NULL THEN 0 ELSE 1 END', note: '0 where a measured NEE exists.' },
      ta: { sourceColumns: ['TA_F'], expr: 'num("TA_F")' },
      tsoil: { sourceColumns: ['TS_010_F'], expr: 'num("TS_010_F")', depthCm: 10 },
      swc: { sourceColumns: ['SWC_010_F'], expr: 'num("SWC_010_F")', depthCm: 10 },
      ppfd: { sourceColumns: ['PPFD_IN_F'], expr: 'num("PPFD_IN_F")', note: 'Gap-filled.' },
      vpd: { sourceColumns: ['VPD_F'], expr: 'num("VPD_F")', note: 'Gap-filled. hPa.' },
    },
  },
  {
    id: 'qvidja', site: 'qvidja', path: 'data/Qvidja/Qvidja_2018-2025.csv',
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'TIMESTAMP_START', timestampFormats: [COMPACT], timestampIsEnd: false, stepMin: 30, rank: 1,
    columns: {
      nee: { sourceColumns: ['NEE', 'NEE_QC'], expr: 'CASE WHEN num("NEE_QC") = 0 THEN num("NEE") END', note: 'Measured value = NEE where NEE_QC is 0.' },
      nee_f: { sourceColumns: ['NEE'], expr: 'num("NEE")' },
      nee_qc: { sourceColumns: ['NEE_QC'], expr: 'num("NEE_QC")', note: '0 = measured, 1 = gap-filled.' },
      ta: { sourceColumns: ['TA_F'], expr: 'num("TA_F")' },
      tsoil: { sourceColumns: ['TS_1'], expr: 'num("TS_1")', depthCm: 5 },
      swc: {
        sourceColumns: ['SM'], expr: ml3MineralThetaSql('num("SM")'), validRange: ML3_THETA_RANGE, depthCm: 10,
        note: 'SM is the raw ML3 ThetaProbe output in V (provider, 2026-10-22). Converted to m3 m-3 with the Delta-T polynomial for mineral soil (ML3 manual ML3-UM-2.1, p. 22). Values outside 0 to 1 m3 m-3 are NULL.',
      },
      sw_in: { sourceColumns: ['SW_IN_F'], expr: 'num("SW_IN_F")', note: 'Gap-filled.' },
      rh: { sourceColumns: ['RH_F'], expr: 'num("RH_F")', note: 'Gap-filled.' },
      vpd: { sourceColumns: ['VPD_F'], expr: 'num("VPD_F")', note: 'Gap-filled. hPa.' },
      ustar: { sourceColumns: ['USTAR'], expr: 'num("USTAR")' },
      gpp_src: {
        sourceColumns: ['GPP'], expr: '-num("GPP")', factor: -1,
        note: 'Daytime partitioning of the data provider. The source GPP is negative (uptake). The factor -1 gives GPP >= 0 like the other sites.',
      },
      reco_src: { sourceColumns: ['RECO'], expr: 'num("RECO")', note: 'Daytime partitioning of the data provider.' },
      precip: { sourceColumns: ['P'], expr: 'num("P")', note: 'mm per 30 min.' },
      ws: { sourceColumns: ['WS'], expr: 'num("WS")' },
      wd: { sourceColumns: ['WD'], expr: 'num("WD")' },
      netrad: { sourceColumns: ['NETRAD'], expr: 'num("NETRAD")' },
      sw_out: { sourceColumns: ['SW_OUT'], expr: 'num("SW_OUT")' },
      le: { sourceColumns: ['LE_F'], expr: 'num("LE_F")', note: 'Gap-filled LE (LE_F).' },
    },
  },
  viikkiEc(2022), viikkiEc(2023), viikkiEc(2024), viikkiEc(2025),
  viikkiPit(2023), viikkiPit(2024), viikkiPit(2025),
  {
    id: 'maktau_continuous', site: 'maktau', path: 'data/Maktau/Continuous_KE-Mkt.csv',
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'TIMESTAMP_START', timestampFormats: [COMPACT], timestampIsEnd: false, stepMin: 30, rank: 1,
    columns: {
      nee: { sourceColumns: ['FC'], expr: 'num("FC")', note: 'Measured CO2 flux, not quality filtered. No gap-filled series exists.' },
      nee_ssitc: { sourceColumns: ['FC_SSITC_TEST'], expr: 'num("FC_SSITC_TEST")', note: 'Quality flag of FC: 0 best, 1 good, 2 poor. NULL for some FC rows.' },
      ustar: { sourceColumns: ['USTAR'], expr: 'num("USTAR")' },
      vpd: { sourceColumns: ['VPD'], expr: 'num("VPD")', note: 'hPa.' },
      le: { sourceColumns: ['LE'], expr: 'num("LE")', note: 'Measured LE only, not gap-filled. Few values.' },
      ...maktauSoil(1),
    },
  },
  {
    id: 'maktau_meteo_30min', site: 'maktau', path: 'data/Maktau/Maktau_meteo_30_min_KE-Mkt.csv',
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'TIMESTAMP_START', timestampFormats: [COMPACT], timestampIsEnd: false, stepMin: 30, rank: 2,
    columns: { ...maktauSoil(2), ...maktauMeteo },
  },
  {
    id: 'maktau_aws_1h', site: 'maktau', path: 'data/Maktau/Maktau_AWS_1h.dat',
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'column00', timestampFormats: [ISO_SECONDS], timestampIsEnd: false, stepMin: 60, rank: 3,
    expand: { offsetsMin: [-30, 0], sumColumns: ['precip'] },
    columns: maktauAws,
  },
];

export const REGISTRY: Registry = { sites: SITES, sources: SOURCES };

/** Output column metadata for variables.parquet. */
export const VARIABLES = [
  { column: 'site_id', type: 'UTINYINT', unit: '-', description: 'Site key. See sites.parquet.' },
  { column: 'ts_start', type: 'TIMESTAMP', unit: 'UTC', description: 'Start of the 30-minute averaging period in UTC. Local time = ts_start + utc_offset_min of the site.' },
  { column: 'nee', type: 'DOUBLE', unit: 'µmol CO2 m-2 s-1', description: 'Measured net ecosystem exchange. NULL in gaps. Positive = emission to the atmosphere.' },
  { column: 'nee_f', type: 'DOUBLE', unit: 'µmol CO2 m-2 s-1', description: 'Gap-filled net ecosystem exchange. NULL where no gap-filled series exists.' },
  { column: 'nee_qc', type: 'UTINYINT', unit: '-', description: '0 = measured, 1 = gap-filled, NULL = not known.' },
  { column: 'ta', type: 'DOUBLE', unit: '°C', description: 'Air temperature.' },
  { column: 'tsoil', type: 'DOUBLE', unit: '°C', description: 'Soil temperature of the shallowest sensor. Depth per site in site_variables.parquet.' },
  { column: 'swc', type: 'DOUBLE', unit: 'm3 m-3', description: 'Volumetric soil water content of the shallowest sensor. Depth per site in site_variables.parquet.' },
  { column: 'sw_in', type: 'DOUBLE', unit: 'W m-2', description: 'Incoming shortwave radiation. Not at Haltiala. Särkisuo 2022 has few values.' },
  { column: 'ppfd', type: 'DOUBLE', unit: 'µmol m-2 s-1', description: 'Incoming photosynthetic photon flux density. Not at Qvidja and Maktau.' },
  { column: 'rh', type: 'DOUBLE', unit: '%', description: 'Relative humidity. Not at Haltiala.' },
  { column: 'vpd', type: 'DOUBLE', unit: 'hPa', description: 'Vapour pressure deficit from the source file. Haltiala, Qvidja, Maktau only.' },
  { column: 'ustar', type: 'DOUBLE', unit: 'm s-1', description: 'Friction velocity. Qvidja and Maktau only.' },
  { column: 'nee_ssitc', type: 'UTINYINT', unit: '-', description: 'Quality flag of the measured CO2 flux (Foken scheme: 0 best, 1 good, 2 poor). Maktau only.' },
  { column: 'gpp_src', type: 'DOUBLE', unit: 'µmol CO2 m-2 s-1', description: 'Gross primary production from the data provider, GPP >= 0 (uptake). Anttila, Särkisuo (night-time method), Qvidja (daytime method, sign changed).' },
  { column: 'reco_src', type: 'DOUBLE', unit: 'µmol CO2 m-2 s-1', description: 'Ecosystem respiration from the data provider. Anttila, Särkisuo, Qvidja.' },
  { column: 'ch4', type: 'DOUBLE', unit: 'µmol CH4 m-2 s-1', description: 'Gap-filled methane flux. Anttila and Särkisuo only.' },
  { column: 'precip', type: 'DOUBLE', unit: 'mm', description: 'Precipitation, sum per 30-minute period. Not at Haltiala. Maktau: hourly sum, half in each 30-minute period.' },
  { column: 'pa', type: 'DOUBLE', unit: 'kPa', description: 'Air pressure. Anttila, Särkisuo, Viikki (2022-2023), Maktau.' },
  { column: 'ws', type: 'DOUBLE', unit: 'm s-1', description: 'Wind speed. Qvidja, Viikki, Maktau.' },
  { column: 'wd', type: 'DOUBLE', unit: 'degrees', description: 'Wind direction, degrees from north (clockwise). Qvidja, Viikki, Maktau.' },
  { column: 'netrad', type: 'DOUBLE', unit: 'W m-2', description: 'Net radiation. Anttila, Särkisuo, Qvidja, Maktau.' },
  { column: 'sw_out', type: 'DOUBLE', unit: 'W m-2', description: 'Outgoing (reflected) shortwave radiation. Anttila, Särkisuo, Qvidja, Viikki.' },
  { column: 'le', type: 'DOUBLE', unit: 'W m-2', description: 'Latent heat flux. Gap-filled at Anttila, Särkisuo and Qvidja; measured only at Maktau.' },
  { column: 'g', type: 'DOUBLE', unit: 'W m-2', description: 'Soil heat flux. Positive = into the soil. Anttila, Särkisuo, Viikki, Maktau.' },
  { column: 'n2o', type: 'DOUBLE', unit: 'nmol N2O m-2 s-1', description: 'Gap-filled nitrous oxide flux. Positive = emission. Anttila, Särkisuo, Viikki.' },
] as const;
