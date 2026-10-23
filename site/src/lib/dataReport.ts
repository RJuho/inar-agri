// Content of the "Data Report" page (site/src/pages/data-report.astro).
// Source: docs/anomaly-data-report.md (findings) and the "Change log" of docs/qvidja-soil-moisture.md.
// To add a change log entry: add one object at the top of CHANGE_LOG. To change the state of a finding:
// change `status` (and `note`) in FINDINGS. The page reads this file at build time only.
// Text fields are plain text. A part in backticks (`name`) shows as code.

/** Repository on GitHub. The page footer and the links to the full documents use it. */
export const REPO_URL = 'https://github.com/RJuho/inar-agri';
/** Link to a file on the main branch of the repository. */
export const repoFile = (path: string): string => `${REPO_URL}/blob/main/${path}`;

// ---------- Anomaly scan ----------

/**
 * State of a finding on this page.
 * - `provider`: we sent a question to the data provider and wait for the answer.
 * - `open`: work for us (a build rule or a new scan run).
 * - `resolved`: fixed in the build, or checked and kept as it is (real event, source artefact). No more action.
 */
export type FindingStatus = 'provider' | 'open' | 'resolved';

export const STATUS_LABEL: Record<FindingStatus, string> = {
  provider: 'Waits for provider',
  open: 'Open',
  resolved: 'Resolved',
};

/** Shape symbol of each status, so that the status is not given by colour only. */
export const STATUS_ICON: Record<FindingStatus, string> = {
  provider: '◷',
  open: '○',
  resolved: '✓',
};

export const STATUS_HELP: Record<FindingStatus, string> = {
  provider: 'We sent a question to the data provider. The data stays as it is until the answer comes.',
  open: 'Work for us: a build rule or a new scan run. No answer from a provider is necessary.',
  resolved: 'Fixed in the build, or checked and kept as it is (real event, source artefact, documented). No more action.',
};

export type Severity = 'S1' | 'S2' | 'S3' | 'S4';

export const SEVERITY_HELP: Record<Severity, string> = {
  S1: 'all values of a column or a site are wrong (unit, sign, time axis)',
  S2: 'a stretch longer than one day, or a wrong annual sum',
  S3: 'isolated periods, less than 1 % of a year',
  S4: 'cosmetic',
};

export interface Finding {
  /** ID in docs/anomaly-data-report.md, for example `ANT-01`. */
  id: string;
  site: string;
  variable: string;
  severity: Severity;
  /** Short finding, one line. */
  finding: string;
  /** Effect on the data on the website and in the export. */
  impact: string;
  status: FindingStatus;
  /** Optional short text below the status badge, for example a date. */
  note?: string;
}

/** Date of the scan and of the report. */
export const SCAN = {
  date: '2026-10-21',
  updated: '2026-10-22',
  command: 'npm run scan:anomalies',
  checks: 16,
  columns: 22,
  episodes: 3910,
  reportPath: 'docs/anomaly-data-report.md',
};

/** Verified findings, sorted by severity, then site (as in the findings table of the full report). */
export const FINDINGS: Finding[] = [
  { id: 'ANT-01', site: 'Anttila', variable: 'all', severity: 'S1', finding: 'Raw stamps are UTC, period start; the build reads them as UTC+2. Radiation peak at hour 10, not 12.', impact: 'All values 2 h early', status: 'provider' },
  { id: 'SAR-01', site: 'Särkisuo', variable: 'all', severity: 'S1', finding: 'Raw stamps are UTC, period start; the build reads them as UTC+2. Radiation peak at hour 10, not 12.', impact: 'All values 2 h early', status: 'provider' },
  { id: 'QVI-01', site: 'Qvidja', variable: 'swc', severity: 'S1', finding: '`SM` is the ML3 sensor output in volts (0.369 to 0.98), not m³ m⁻³.', impact: 'Converted in the build since 2026-10-22 (see change log)', status: 'resolved', note: '2026-10-22' },
  { id: 'VII-01', site: 'Viikki', variable: 'all', severity: 'S1', finding: 'Raw stamps are UTC, period start; the build reads them as UTC+2. SWin centroid at hour 10.1 to 10.4.', impact: 'All values 2 h early', status: 'provider' },
  { id: 'VII-06', site: 'Viikki', variable: 'n2o', severity: 'S1', finding: 'Unit `ug m-2 s-1` can be µg N2O or µg N2O-N. 2022: 16.8 kg N2O ha⁻¹.', impact: 'Factor 1.57 on all N2O if the unit is N2O-N', status: 'provider' },
  { id: 'SAR-04', site: 'Särkisuo', variable: 'tsoil', severity: 'S2', finding: 'Constant 0.2 °C for 33 days in 2023-03 and most of winter 2022-23.', impact: 'Flat winter tsoil (sensor floor or zero curtain)', status: 'provider' },
  { id: 'HAL-03', site: 'Haltiala', variable: 'swc', severity: 'S2', finding: '2021 medians 0.46 to 0.51, 0.06 to 0.10 above the later years.', impact: '2021 not comparable with the later years', status: 'provider' },
  { id: 'QVI-03', site: 'Qvidja', variable: 'swc', severity: 'S2', finding: 'Drops of 0.3 to 0.4 when the soil is frozen.', impact: 'Low winter means (sensor physics, kept)', status: 'resolved' },
  { id: 'QVI-04', site: 'Qvidja', variable: 'rh, vpd', severity: 'S2', finding: 'Dry bias before 2021-10-08; RH 46.3 % at −5 °C in 2021-02.', impact: 'Not comparable before 2021-10', status: 'provider' },
  { id: 'QVI-07', site: 'Qvidja', variable: 'nee_f, gpp_src, reco_src', severity: 'S2', finding: 'Daytime partitioning: NEE ≠ Reco − GPP in 26 to 48 % of the periods.', impact: 'Budget bars do not add up', status: 'resolved' },
  { id: 'QVI-08', site: 'Qvidja', variable: 'precip', severity: 'S2', finding: 'Rain gauge gap 2021-12-29 to 2022-05-24 not filled in the file.', impact: '2022 sum (388 mm) incomplete', status: 'provider' },
  { id: 'QVI-11', site: 'Qvidja', variable: 'nee_f', severity: 'S2', finding: 'Annual NEE 25 to 109 g C m⁻² more negative than Heimsch 2024.', impact: 'Stronger sink than the article', status: 'provider' },
  { id: 'QVI-12', site: 'Qvidja', variable: 'tsoil, netrad, sw_in, sw_out', severity: 'S2', finding: 'From 2025-11-01 tsoil follows the air temperature; night netrad positive.', impact: 'End of 2025 not usable', status: 'provider' },
  { id: 'QVI-16', site: 'Qvidja', variable: 'swc', severity: 'S2', finding: 'ML3 readings in frozen soil are not reliable (manual p. 28): ice gives a much lower permittivity, so θ reads too low. 17 950 values (14.5 %) have tsoil ≤ 0 °C.', impact: 'Winter swc too low; the build keeps the values', status: 'open', note: 'NULL rule not decided' },
  { id: 'MKT-01', site: 'Maktau', variable: 'all meteo', severity: 'S2', finding: 'Logger stored day-time rows only, 2023-07 to 2024-01.', impact: 'Monthly means are day-time means', status: 'resolved' },
  { id: 'MKT-03', site: 'Maktau', variable: 'nee', severity: 'S2', finding: '`FC` repeats one value for up to 25 periods, 2024-04 to 2024-07.', impact: '11 % of the 2024 NEE values', status: 'provider' },
  { id: 'MKT-08', site: 'Maktau', variable: 'ta, vpd', severity: 'S2', finding: 'Day-time ta in 2024 1.5 to 2.8 °C above earlier years; sonic temperature rises too.', impact: '2024 ta and vpd (probably real)', status: 'provider' },
  { id: 'ANT-02', site: 'Anttila', variable: 'sw_in, sw_out, netrad', severity: 'S3', finding: 'CNR4 night offset steps from −1 to −5 W m⁻² on 2022-10-14.', impact: 'Winter daily sums too low', status: 'provider' },
  { id: 'ANT-03', site: 'Anttila', variable: 'reco_src', severity: 'S3', finding: '12 night periods with Reco down to −10.74 (copies of negative NEE).', impact: '12 half hours', status: 'resolved' },
  { id: 'ANT-04', site: 'Anttila', variable: 'le', severity: 'S3', finding: 'Two measured spikes of 477 and 538 W m⁻².', impact: '2 half hours', status: 'resolved' },
  { id: 'SAR-02', site: 'Särkisuo', variable: 'sw_in, sw_out', severity: 'S3', finding: 'CNR4 night offset −6 W m⁻² from 2023-08-08.', impact: 'Winter means too low', status: 'provider' },
  { id: 'SAR-03', site: 'Särkisuo', variable: 'ta, rh', severity: 'S3', finding: 'One logger row before a gap: TA −39.18 °C, RH 1.07 %.', impact: '1 half hour', status: 'provider' },
  { id: 'SAR-05', site: 'Särkisuo', variable: 'reco_src', severity: 'S3', finding: 'One night period with Reco −17.3 in 2022-01.', impact: '1 half hour', status: 'resolved' },
  { id: 'QVI-09', site: 'Qvidja', variable: '9 meteo columns', severity: 'S3', finding: 'All meteorology lost 2023-02-11 to 2023-03-01.', impact: 'Known loss; station values', status: 'resolved' },
  { id: 'QVI-10', site: 'Qvidja', variable: 'nee', severity: 'S3', finding: 'EC inlet fault 2019-01-05 to 2019-03-28; 2.6 % measured.', impact: 'nee_f is a model there', status: 'resolved' },
  { id: 'QVI-13', site: 'Qvidja', variable: 'sw_in, sw_out, netrad', severity: 'S3', finding: 'Snow on the radiometer domes: albedo > 1.', impact: 'A few winter days', status: 'resolved' },
  { id: 'VII-04', site: 'Viikki', variable: 'tsoil', severity: 'S3', finding: 'Pit layer-1 spikes to 28.9 °C after field work in 2025.', impact: '340 periods', status: 'provider' },
  { id: 'VII-05', site: 'Viikki', variable: 'nee, nee_f', severity: 'S3', finding: '2024 gap-filled NEE differs from measured NEE in 1 540 periods.', impact: 'Annual sum differs by 2 g C m⁻²', status: 'provider' },
  { id: 'MKT-02', site: 'Maktau', variable: 'vpd', severity: 'S3', finding: '6 396 VPD values kept in the logger fill rows.', impact: 'Wrong driver for MDS gap filling', status: 'open' },
  { id: 'MKT-04', site: 'Maktau', variable: 'tsoil', severity: 'S3', finding: 'Single-period drops of all depths to 0.97 to 10.07 °C.', impact: 'Minimum is wrong', status: 'open' },
  { id: 'MKT-05', site: 'Maktau', variable: 'le', severity: 'S3', finding: 'No quality filter: night spikes of 413 and −155 W m⁻².', impact: 'Spikes', status: 'open' },
  { id: 'MKT-06', site: 'Maktau', variable: 'sw_in, netrad', severity: 'S3', finding: 'Single values up to 1 570 W m⁻².', impact: 'One day 25 % too high', status: 'resolved' },
  { id: 'ANT-05', site: 'Anttila', variable: 'tsoil', severity: 'S4', finding: 'Winter runs of 0.2 to 0.6 °C (zero curtain).', impact: 'Flat lines (real)', status: 'resolved' },
  { id: 'ANT-06', site: 'Anttila', variable: 'gpp_src', severity: 'S4', finding: 'GPP 0 by day in winter (night-time method).', impact: 'None', status: 'resolved' },
  { id: 'ANT-07', site: 'Anttila', variable: 'ppfd, sw_in', severity: 'S4', finding: 'Scan flags caused by the 2-hour shift (ANT-01).', impact: 'None beyond ANT-01', status: 'open', note: 'rescan after ANT-01' },
  { id: 'ANT-08', site: 'Anttila', variable: 'nee_f, ch4, n2o', severity: 'S4', finding: 'Annual sums agree with Shurpali 2025.', impact: 'None (no anomaly)', status: 'resolved' },
  { id: 'SAR-06', site: 'Särkisuo', variable: 'gpp_src', severity: 'S4', finding: 'Night GPP > 0.5 in 49 % of the night periods, 2023-06 and 07 (from SAR-01).', impact: 'None beyond SAR-01', status: 'open', note: 'rescan after SAR-01' },
  { id: 'SAR-07', site: 'Särkisuo', variable: 'nee_f, ch4, n2o', severity: 'S4', finding: 'Annual sums agree with Shurpali 2025; CH4 2022 is a partial year.', impact: 'Partial CH4 sum 2022', status: 'resolved' },
  { id: 'HAL-01', site: 'Haltiala', variable: 'swc', severity: 'S4', finding: 'Resolution 0.01: only 36 distinct values.', impact: 'Step curve', status: 'provider' },
  { id: 'HAL-02', site: 'Haltiala', variable: 'ppfd', severity: 'S4', finding: 'Gap-fill floor of 1.0 in the evening hours.', impact: 'Cosmetic', status: 'resolved' },
  { id: 'HAL-04', site: 'Haltiala', variable: 'tsoil', severity: 'S4', finding: 'Winter tsoil flat near 0 °C (zero curtain).', impact: 'None (real)', status: 'resolved' },
  { id: 'HAL-05', site: 'Haltiala', variable: 'ta, tsoil, ppfd, nee', severity: 'S4', finding: 'Monthly level shifts are regional weather and crop effects.', impact: 'None (real)', status: 'resolved' },
  { id: 'QVI-02', site: 'Qvidja', variable: 'swc', severity: 'S4', finding: 'Sensor ceiling 0.98 V in wet periods, 2022-11 to 2023-01.', impact: 'Flat maximum', status: 'provider' },
  { id: 'QVI-05', site: 'Qvidja', variable: 'rh, vpd', severity: 'S4', finding: 'RH up to 104.54 %, VPD down to −0.84 from 2021-10.', impact: '1.2 % of the periods', status: 'resolved' },
  { id: 'QVI-06', site: 'Qvidja', variable: 'rh, vpd', severity: 'S4', finding: 'Plateaus of RH 100 % for 4 days (2019-03, 2024-12).', impact: 'Cosmetic', status: 'resolved' },
  { id: 'QVI-14', site: 'Qvidja', variable: 'ta, tsoil, sw_in, le, nee_f', severity: 'S4', finding: 'Monthly level shifts are weather and management.', impact: 'None (real)', status: 'resolved' },
  { id: 'QVI-15', site: 'Qvidja', variable: 'all', severity: 'S4', finding: 'Every row twice 2018 to 2023; `USTAR` conflicts.', impact: 'Removed in the build', status: 'provider', note: 'USTAR question' },
  { id: 'VII-02', site: 'Viikki', variable: 'sw_in, sw_out', severity: 'S4', finding: 'Radiometer night values of −7 W m⁻².', impact: 'Winter means a little low', status: 'resolved' },
  { id: 'VII-03', site: 'Viikki', variable: 'tsoil', severity: 'S4', finding: 'Constant values near 0 °C in frozen soil.', impact: 'None (real)', status: 'resolved' },
  { id: 'VII-07', site: 'Viikki', variable: 'ta, tsoil, swc, rh, sw_in', severity: 'S4', finding: 'Monthly level shifts are weather and management.', impact: 'None (real)', status: 'resolved' },
  { id: 'VII-08', site: 'Viikki', variable: 'rh, ta', severity: 'S4', finding: '2024 file has a coarser resolution (1 % and 0.1 °C).', impact: 'Steps', status: 'resolved' },
  { id: 'MKT-07', site: 'Maktau', variable: 'ws, wd', severity: 'S4', finding: 'The zero rule removes calm periods at night.', impact: 'Night ws a little high', status: 'resolved' },
  { id: 'MKT-09', site: 'Maktau', variable: 'rh, swc, tsoil, ta', severity: 'S4', finding: 'Wet-season level shifts are real.', impact: 'None (real)', status: 'resolved' },
];

// ---------- Change log ----------

export interface ReportTable {
  caption: string;
  head: string[];
  rows: string[][];
  /** Indexes of the columns with numbers (right-aligned). */
  numeric?: number[];
}

export interface ChangeLogEntry {
  /** Anchor id on the page. Do not change it after publication (links use it). */
  id: string;
  /** Date of the change, `yyyy-mm-dd`. */
  date: string;
  title: string;
  site: string;
  variable: string;
  /** Finding IDs of FINDINGS that the change closes or touches. */
  findings: string[];
  /** Paragraphs: what changed and why. */
  summary: string[];
  /** Short facts as a term and value list (provider, sensor, source, range, ...). */
  facts: { term: string; value: string }[];
  /** Formulas (TeX, rendered at build time with KaTeX) with a short explanation. */
  formulas: { tex: string; where: string }[];
  tables: ReportTable[];
  /** Open points for us (decisions, build rules). */
  openPoints: string[];
  /** Questions that are still open with the provider. */
  openQuestions: string[];
  /** Path in the repository of the full document. */
  doc: string;
}

/** Newest entry first. */
export const CHANGE_LOG: ChangeLogEntry[] = [
  {
    id: 'change-2026-10-23-article-events',
    date: '2026-10-23',
    title: 'Management events of Anttila, Särkisuo and Maktau from the articles',
    site: 'Anttila, Särkisuo, Maktau, Viikki',
    variable: 'events',
    findings: [],
    summary: [
      'The event table (`events.parquet`) now has rows for all six sites. Anttila, Särkisuo and Maktau have no management file. Their events come from the articles in `data/articles/`: Shurpali et al. 2025 (Table 2: the 2022 fertilisations in kg N/ha, two cuts, a herbicide, ditch work, the parcel areas; Table 4: the annual yield of 2022 with a grass carbon content of 0.47; p. 2: the sowing of 2021) and Räsänen et al. 2026 (p. 3: the sowing and the harvest of the 2019 long rains at Maktau and the harvest of 2020).',
      'Viikki gets the sowing of 2023-05-25 from Gao et al. 2026 and the product and amount of the manure of 2023-04-27 from Vettikkat et al. 2026. Only events with an exact day or a stated day range are rows. Month-level facts and the values that differ between the articles and the management files are listed in the documentation.',
      'The calculated NECB of Anttila and Särkisuo 2022 now has the harvest term (`necb_complete` true). For 2023 the harvest is unknown and the NECB has no harvest term. The natural events Deep Dive keeps its human-disturbance mask on the events of Haltiala, Qvidja and Viikki; its results do not change.',
    ],
    facts: [
      { term: 'Anttila', value: '6 events (2021 to 2022), parcel 6.4 ha, C harvest 2022 352.5 g C m⁻²' },
      { term: 'Särkisuo', value: '8 events (2021 to 2022), parcel 7.1 ha, C harvest 2022 220.9 g C m⁻²' },
      { term: 'Maktau', value: '3 events (2019 to 2020), no yields' },
      { term: 'Viikki', value: '1 new event (sowing 2023-05-25), 2 events with more detail' },
      { term: 'Code', value: '`scripts/lib/events.ts`, `scripts/lib/calc/management.ts`, `scripts/calc.ts`' },
    ],
    formulas: [],
    tables: [],
    openPoints: [],
    openQuestions: [],
    doc: 'docs/harmonised-database.md',
  },
  {
    id: 'change-2026-10-22-coordinates',
    date: '2026-10-22',
    title: 'Coordinates for all six sites',
    site: 'All sites',
    variable: 'lat, lon',
    findings: [],
    summary: [
      'The site table (`sites.parquet`) now has the latitude and longitude of all six sites. Before, Anttila, Särkisuo and Viikki had no coordinates, because the data files do not give them.',
      'The project team gave the values. For Haltiala and Maktau they replace the earlier values from the tower file and the site metadata (about 30 m and 140 m away). The anomaly scan now uses the true longitude to compute the expected hour of the radiation peak. The 2-hour time offset of Anttila, Särkisuo and Viikki does not change.',
    ],
    facts: [
      { term: 'Anttila', value: '63.1453, 27.3128' },
      { term: 'Särkisuo (Särkiluoto)', value: '63.15142822, 27.19906425' },
      { term: 'Haltiala', value: '60.271683, 24.94395 (tower file: 60.271671, 24.944509)' },
      { term: 'Qvidja', value: '60.295333, 22.391833' },
      { term: 'Viikki', value: '60.21845, 25.01986' },
      { term: 'Maktau', value: '-3.425833, 38.139444 (metadata: -3.425859, 38.140663)' },
      { term: 'Code', value: '`scripts/lib/registry.ts` (`SITES`).' },
    ],
    formulas: [],
    tables: [],
    openPoints: [],
    openQuestions: [],
    doc: 'docs/harmonised-database.md',
  },
  {
    id: 'change-2026-10-22-event-details',
    date: '2026-10-22',
    title: 'Management events with yield, carbon, N input and parcel area',
    site: 'Haltiala, Qvidja, Viikki',
    variable: 'events',
    findings: [],
    summary: [
      'The management events now have the numbers of the source files as columns: crop or product, amount and unit, DM fraction, harvest yield (kg DW/ha), N input (kg N/ha), carbon (g C m⁻²) and the parcel area (Qvidja). Before, these numbers were only in the free text.',
      'The carbon values come from the same table as the NECB of the Calculated page. The charts show the yield on the harvest marker (for example `H 3.7 t`) and the numbers in the tooltip and the alt text. The new Events page lists all events per site.',
    ],
    facts: [
      { term: 'Sources', value: '`haltiala_smear_management.xlsx`, `Qvidja_management.xlsx`, Heimsch et al. 2021 Table 1, Viikki `Management Information.docx`.' },
      { term: 'Derived values', value: 'Qvidja yield = fresh mass × DM fraction. N of Yara AXAN 27-0-1 and NPK 23-10-8 = 27 % and 23 % of the product mass. Viikki: the yield of the year is on the last harvest of the year.' },
      { term: 'Code', value: '`scripts/lib/events.ts` (`withCarbon()`), `scripts/lib/schemas.ts` (`EventRowSchema`), `site/src/scripts/events.ts`.' },
    ],
    formulas: [],
    tables: [],
    openPoints: [],
    openQuestions: [],
    doc: 'docs/harmonised-database.md',
  },
  {
    id: 'change-2026-10-22-qvidja-swc',
    date: '2026-10-22',
    title: 'Qvidja soil water content converted from sensor volts to m³ m⁻³',
    site: 'Qvidja',
    variable: 'swc (10 cm)',
    findings: ['QVI-01', 'QVI-16'],
    summary: [
      'The Qvidja soil water content (`swc`, 10 cm) was the raw output of the Delta-T ML3 ThetaProbe sensor in volts. The readme gave m³ m⁻³, which is not correct. The build now converts the values to volumetric water content in m³ m⁻³.',
      'The conversion uses the polynomial for a generalised mineral soil. Qvidja is clay loam, thus a mineral soil. Other sites: no change.',
    ],
    facts: [
      { term: 'Provider confirmation', value: 'Mika Korkiakoski (FMI) confirmed on 2026-10-22 that `SM` is "raw": the output of the sensor, not the water content.' },
      { term: 'Sensor', value: 'Delta-T ML3 ThetaProbe at 10 cm. Output: DC voltage, 0 to about 1 V.' },
      { term: 'Source of the formula', value: 'Delta-T Devices Ltd, User Manual for the ML3 ThetaProbe Soil Moisture Sensor, ML3-UM-2.1 (January 2017), p. 22, "Polynomial conversion", generalised mineral soil.' },
      { term: 'Valid range', value: '0 to 1 m³ m⁻³ (manual p. 26). A value outside this range becomes empty. Values set to empty: 0.' },
      { term: 'Affected rows', value: 'All Qvidja `swc` values, 2018-05-09 to 2025-12-31: 124 023 half-hour values (duplicate rows removed).' },
      { term: 'Code', value: '`scripts/lib/ml3.ts` (coefficients, range, SQL), used by `scripts/lib/registry.ts`. Unit test: `scripts/lib/ml3.test.ts`.' },
    ],
    formulas: [
      {
        tex: '\\begin{aligned} \\theta = {} & -0.071 + 0.735\\,V + 0.75\\,V^{2} - 8.759\\,V^{3} \\\\ & + 21.838\\,V^{4} - 21.998\\,V^{5} + 8.097\\,V^{6} \\end{aligned}',
        where: 'V = sensor output in volts (column `SM`), θ = volumetric water content in m³ m⁻³.',
      },
      {
        tex: '\\theta = \\frac{\\sqrt{\\varepsilon} - a_0}{a_1}, \\qquad a_0 = 1.6,\\; a_1 = 8.4',
        where: 'Equivalent form with the general mineral-soil calibration (manual p. 19 to 21). ε = dielectric permittivity from the sensor polynomial.',
      },
    ],
    tables: [
      {
        caption: 'Qvidja swc before and after the conversion (124 023 half-hour values)',
        head: ['Statistic', 'Before (V)', 'After (m³ m⁻³)'],
        rows: [
          ['Minimum', '0.369', '0.137'],
          ['2 %', '0.463', '0.176'],
          ['Median', '0.777', '0.356'],
          ['Mean', '0.737', '0.339'],
          ['98 %', '0.943', '0.503'],
          ['Maximum', '0.980', '0.557'],
        ],
        numeric: [1, 2],
      },
      {
        caption: 'May to September mean swc against the published values (m³ m⁻³)',
        head: ['Year', 'Published', 'Article', 'After conversion', 'Difference'],
        rows: [
          ['2018', '0.26', 'Heimsch et al. 2021', '0.257', '−0.003'],
          ['2019', '0.30', 'Heimsch et al. 2021', '0.305', '+0.005'],
          ['2021', '0.34', 'Heimsch et al. 2024', '0.344', '+0.004'],
          ['2022', '0.23', 'Heimsch et al. 2024', '0.219', '−0.011'],
        ],
        numeric: [0, 1, 3, 4],
      },
    ],
    openPoints: [
      'Frozen soil (QVI-16, open): readings in soil below 0 °C are not reliable (manual p. 28). Ice has a much lower permittivity than liquid water, thus θ reads too low. 17 950 values have `tsoil` (5 cm) ≤ 0 °C. The build keeps them. Decision pending: set `swc` to NULL where `tsoil` ≤ 0 °C.',
    ],
    openQuestions: [
      'Is 0.98 V the maximum of the sensor? Wet periods of 2022–2023 stay at 0.98 V (QVI-02).',
      'Is a soil-specific calibration (a0, a1) for Qvidja available? Clay can need a higher a1 (manual p. 19).',
      'Was the sensor the same, at the same depth, from 2018 to 2025?',
      'Please correct the unit of `SM` in `Qvidja-readme.xlsx` (it gives m3 m-3).',
    ],
    doc: 'docs/qvidja-soil-moisture.md',
  },
];
