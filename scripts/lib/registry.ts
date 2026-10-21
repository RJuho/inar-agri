// Registry of sites, source files and column mappings for the harmonised
// database. Edit this file to add a site, a file or a variable. The build
// script validates it with Valibot before it reads any data.
//
// Column expressions are SQL. They see the cleaned text columns of the
// source file (trimmed, decimal comma replaced by a point, empty = NULL).
// Use num("col") to get a DOUBLE with the sentinels -9999, NA and inf as NULL.

export const CORE_COLUMNS = ['nee', 'nee_f', 'nee_qc', 'ta', 'tsoil', 'swc'] as const;
export type CoreColumn = (typeof CORE_COLUMNS)[number];

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
  columns: Partial<Record<CoreColumn, ColumnMap>>;
};

export type Registry = { sites: Site[]; sources: Source[] };

/** 1 mg CO2 = 1000 / 44.0095 µmol CO2. The Viikki EC files give NEE in mg CO2 m-2 s-1 (header). */
export const MG_CO2_TO_UMOL = 1000 / 44.0095;
/** Viikki WFPS (%) to m3 m-3: porosity 0.509433962 (= 1 - 1.3 / 2.65, columns of the 2022 and 2023 files) / 100. */
export const VIIKKI_WFPS_TO_SWC = 0.509433962 / 100;

const ISO_SECONDS = '%Y-%m-%d %H:%M:%S';
const ISO_MINUTES = '%Y-%m-%d %H:%M';
const COMPACT = '%Y%m%d%H%M';
const FINNISH = '%-d.%-m.%Y %-H:%M';

export const SITES: Site[] = [
  {
    siteId: 1, code: 'anttila', fluxnetId: 'FI-Ant', name: 'Anttila', country: 'FI',
    lat: null, lon: null, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'GRA',
    description: 'Legume grassland. Data 2022-2023.',
    comment: 'Coordinates are not in the source files. Soil sensor depths are not known.',
  },
  {
    siteId: 2, code: 'sarkisuo', fluxnetId: 'FI-Sar', name: 'Särkisuo', country: 'FI',
    lat: null, lon: null, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'GRA',
    description: 'Mixed grasses. Data 2022-2023.',
    comment: 'Coordinates are not in the source files. Soil sensor depths are not known.',
  },
  {
    siteId: 3, code: 'haltiala', fluxnetId: null, name: 'Haltiala', country: 'FI',
    lat: 60.271671, lon: 24.944509, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'CRO',
    description: 'Cropland. 2021 barley, 2022 oats, 2023 grass (failed), 2024 sunflowers, 2025 oats. Data 2021-2025.',
    comment: 'EC tower coordinates from data/Haltiala/geodata/haltiala_ec_tower_coords.txt.',
  },
  {
    siteId: 4, code: 'qvidja', fluxnetId: null, name: 'Qvidja', country: 'FI',
    lat: 60.2953, lon: 22.3918, elevationM: 7, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'CRO',
    description: 'Forage grassland, managed intensively with conventional practices until 2017, then more sustainable practices. Data 2018-2025.',
    comment: 'Coordinates from Qvidja-readme.xlsx (60°17\'43.2" N, 22°23\'30.6" E).',
  },
  {
    siteId: 5, code: 'viikki', fluxnetId: null, name: 'Viikki', country: 'FI',
    lat: null, lon: null, elevationM: null, utcOffsetMin: 120, timestepMin: 30, ecosystem: 'CRO',
    description: 'Grassland in rotation, field Alaniitty 1. 2022 timothy, 2023 barley / mixed grass / red clover, 2024 grassland, 2025 fava bean. Data 2022-2025.',
    comment: 'Coordinates are not in the source files. NEE unit mg CO2 m-2 s-1 per the file headers, converted to µmol. Soil 2022 from the EC file, 2023-2025 from the soil pit.',
  },
  {
    siteId: 6, code: 'maktau', fluxnetId: 'KE-Mkt', name: 'Maktau', country: 'KE',
    lat: -3.425859, lon: 38.140663, elevationM: null, utcOffsetMin: 180, timestepMin: 30, ecosystem: 'CRO',
    description: 'Maize 80 %, vegetables 20 %. Taita region. EC data 2018-2024, meteo data 2014-2025.',
    comment: 'No gap-filled NEE exists. Logger fill value 0 in TA, TS and SWC is set to NULL.',
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
      },
    },
  ];
}

function viikkiEc(year: number): Source {
  // Column names change by year. The degree sign is a literal "?" in the files.
  const nee = 'NEE (mg CO2 m-2 s-1)';
  const neeF = year === 2024 ? 'NEE _gapfilled (mg CO2 m-2 s-1)' : 'NEE_gapfilled (mg CO2 m-2 s-1)';
  const tair = year <= 2023 ? 'Tair  (?C)' : 'Tair (?C)';
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

const maktauSoil = (rank: number): Partial<Record<CoreColumn, ColumnMap>> => ({
  ta: { sourceColumns: ['TA_1_1_1'], expr: 'num("TA_1_1_1")', zeroIsNull: true, note: `Rank ${rank}. Exact 0 is a logger fill value.` },
  tsoil: { sourceColumns: ['TS_1_1_1'], expr: 'num("TS_1_1_1")', zeroIsNull: true, depthCm: 10, note: `Rank ${rank}. Exact 0 is a logger fill value.` },
  swc: { sourceColumns: ['SWC_1_1_1'], expr: 'num("SWC_1_1_1")', zeroIsNull: true, depthCm: 10, note: `Rank ${rank}. Exact 0 is a logger fill value.` },
});

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
      swc: { sourceColumns: ['SM'], expr: 'num("SM")', depthCm: 10 },
    },
  },
  viikkiEc(2022), viikkiEc(2023), viikkiEc(2024), viikkiEc(2025),
  viikkiPit(2023), viikkiPit(2024), viikkiPit(2025),
  {
    id: 'maktau_continuous', site: 'maktau', path: 'data/Maktau/Continuous_KE-Mkt.csv',
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'TIMESTAMP_START', timestampFormats: [COMPACT], timestampIsEnd: false, stepMin: 30, rank: 1,
    columns: {
      nee: { sourceColumns: ['FC'], expr: 'num("FC")', note: 'Measured CO2 flux. No gap-filled series exists.' },
      ...maktauSoil(1),
    },
  },
  {
    id: 'maktau_meteo_30min', site: 'maktau', path: 'data/Maktau/Maktau_meteo_30_min_KE-Mkt.csv',
    delim: ',', headerLines: 1, decimalComma: false,
    timestampColumn: 'TIMESTAMP_START', timestampFormats: [COMPACT], timestampIsEnd: false, stepMin: 30, rank: 2,
    columns: maktauSoil(2),
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
] as const;
