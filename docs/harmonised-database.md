# Harmonised core database

This document is the design of the harmonised database in `db/`. It tells what the database holds, which rules the build applies, and how to add a dataset. Use it again when the input datasets change.

Build: `npm install`, then `npm run build:db`. The script is `scripts/build-db.ts`. The registry of sites, files and column mappings is `scripts/lib/registry.ts`. The Valibot schemas are `scripts/lib/schemas.ts`. The build writes `db/report.md` and `db/report.json` and prints the report.

## Purpose

Six eddy-covariance sites deliver data in six layouts. The layouts differ in delimiter, decimal mark, timestamp format, missing-value code, column names and units. The database puts the variables that all sites share into one Parquet table with one row per site and 30-minute period. A small table gives the geolocation of each site. The files are for use in the browser with DuckDB-WASM.

## Principles

- `data/` is read-only. The build reads the files and does not change them.
- No loss of numeric accuracy. All measurements are DOUBLE. Each source value is a decimal text with at most 17 significant digits, so DOUBLE holds it exactly. The build applies only three arithmetic operations, and all are listed in `site_variables.parquet`: a unit factor for Viikki NEE (mg CO2 to µmol), a unit factor for Viikki WFPS 2022 (% to m3 m-3), and a 30-minute mean (Viikki soil pit).
- Scope: the strict intersection. A column exists only when all six sites have the variable. The result is NEE, air temperature, soil temperature and soil water content.
- Every rule is explicit in the registry or in this document, and every rule reports its counts in the build report.
- DuckDB does all reading, cleaning, merging and writing in SQL. Valibot validates the registry, the file headers, every output row and the report.

## Output files

| File | Rows | Content |
|---|---|---|
| `db/observations.parquet` | about 538 000 | One row per site and 30-minute period. Sorted by `site_id`, `ts_start`. ZSTD, row groups of 100 000 rows. |
| `db/sites.parquet` | 6 | Geolocation index: `site_id`, `code`, `fluxnet_id`, `name`, `country`, `lat`, `lon`, `elevation_m`, `utc_offset_min`, `timestep_min`, `ecosystem`, `description`, `comment`, `data_start`, `data_end`. |
| `db/variables.parquet` | 8 | One row per output column: data type, unit, description. |
| `db/site_variables.parquet` | about 65 | Provenance per site and column: source file, source columns, SQL expression, factor, zero rule, sensor depth, rank, aggregation, note. |
| `db/events.parquet` | about 80 | Field management events per site (harvest, cut, grazing, fertilisation, sowing, tillage, spraying, other). Hand-typed in `scripts/lib/events.ts`. |
| `db/report.md`, `db/report.json` | - | Build report. |

The Parquet files are not in git (`db/*.parquet` is in `.gitignore`). The reports are in git.

### `observations.parquet`

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `site_id` | UTINYINT | - | Key to `sites.parquet`. |
| `ts_start` | TIMESTAMP | UTC | Start of the 30-minute period. Local time = `ts_start` + `utc_offset_min` of the site. |
| `nee` | DOUBLE | µmol CO2 m-2 s-1 | Measured net ecosystem exchange. NULL in gaps. |
| `nee_f` | DOUBLE | µmol CO2 m-2 s-1 | Gap-filled net ecosystem exchange. NULL where the site has no gap-filled series (Maktau). |
| `nee_qc` | UTINYINT | - | 0 = measured, 1 = gap-filled, NULL = not known. |
| `ta` | DOUBLE | °C | Air temperature. |
| `tsoil` | DOUBLE | °C | Soil temperature of the shallowest sensor. Depth per site below. |
| `swc` | DOUBLE | m3 m-3 | Volumetric soil water content of the shallowest sensor. Depth per site below. |

The timestamp is a naive TIMESTAMP in UTC, not TIMESTAMPTZ. In the browser, TIMESTAMPTZ functions use the time zone of the viewer and would shift the data.

The grid is complete. Between the first and the last period of a site, every 30-minute period has a row. Periods without data have NULL in all value columns. The report gives the number of inserted rows per site.

### `events.parquet`

One row per field management event. Sorted by `site_id`, `date`.

| Column | Type | Meaning |
|---|---|---|
| `site_id` | UTINYINT | Key to `sites.parquet`. |
| `site_code` | VARCHAR | Site code, for example `qvidja`. |
| `date` | DATE | First day of the event, local calendar day. |
| `date_end` | DATE | Last day of a multi-day event (grazing, harvest over some days, harrowing). NULL for a one-day event. |
| `type` | VARCHAR | `harvest`, `cut`, `grazing`, `fertilisation`, `sowing`, `tillage`, `spraying` or `other`. |
| `detail` | VARCHAR | Short English text: crop or product, amount and unit as in the source. |
| `source` | VARCHAR | Source file in `data/`. Two files are separated by `; `. |
| `crop` | VARCHAR | Crop, product or animal, short English name. NULL = not given. |
| `amount` | DOUBLE | Amount as in the source, in `amount_unit`. |
| `amount_unit` | VARCHAR | `kg/ha` (product or seed), `kg/ha fresh` (fresh mass, Qvidja), `m3/ha`, `L/ha`, or `animals` (grazing). |
| `dm_fraction` | DOUBLE | Dry matter fraction of `amount` (0 to 1). |
| `dry_mass_kg_ha` | DOUBLE | Harvest yield, kg DW/ha. Only `harvest` and `cut`. Qvidja: `amount × dm_fraction`; 2018-06-12: 1985 (Heimsch et al. 2021). Viikki, Anttila and Särkisuo: yield of the year, on the last harvest of the year. |
| `n_kg_ha` | DOUBLE | N input, kg N/ha. Only `fertilisation`. Source value (Viikki, Haltiala 2025), or the N share of the grade in the product name (Yara AXAN 27-0-1: 27 %, NPK 23-10-8: 23 %). Finnish saltpetre: NULL (no grade in the file). |
| `c_g_m2` | DOUBLE | Carbon of the harvest or the organic input, g C m-2. Copied from `scripts/lib/calc/management.ts` (`cGm2()`) by `withCarbon()`: same site, same date, matching type. The report lists carbon rows that match no event. |
| `area_ha` | DOUBLE | Area of the field parcel, ha (Qvidja "Area of kasvulohko"; Anttila 6.4 and Särkisuo 7.1 from Shurpali et al. 2025, Table 2). |

The rows come from a hand-typed table, `scripts/lib/events.ts`, because the repository has no xlsx, docx or pdf reader. Sources:

- Haltiala: `haltiala_smear_management.xlsx` (2021 to 2025). The parcel card `haltiala_smear_Lohkokortit_2025.pdf` corrects one date: Jett Mn235 was applied on 2025-06-16 in a tank mix with the herbicide, not on 2025-05-16.
- Qvidja: `Qvidja_management.xlsx` (2018 to 2025) and Table 1 of `Qvidja_C-balance.pdf` (Heimsch et al. 2021) for the 2018 and 2019 events that are not in the xlsx. If a harvest date differs by 1 or 2 days between the two, the xlsx date is used.
- Viikki: `EC/Management Information.docx` (2022 to 2025). The yield of the year is in the detail and in `dry_mass_kg_ha` of the last harvest of the year. The N input of each application is in `n_kg_ha`. Two articles add to the docx: Gao et al. 2026 (`data/articles/Gao_2026_Cfootprint_milk-DNDC.pdf`, Table A2) gives the sowing of 2023-05-25 (barley 200 kg/ha with 20 kg/ha grass seed), and Vettikkat et al. 2026 (`data/articles/Vettikkat_2026_NH3-flux_SMEAR-Agri_mass-spec_EC.pdf`, Table 1) gives the product and the amount of the manure of 2023-04-27 (43 m3/ha of the separated solid fraction of cow manure, field Alaniitty 1, 6.86 ha) and the harrowing of 2023-04-28.
- Anttila and Särkisuo: no management file. The rows come from Shurpali et al. 2025 (`data/articles/Shurpali_2025.pdf`, added 2026-10-23): the 2021 sowing (p. 2) and the 2022 events of Table 2 (fertilisation with kg N/ha, two cuts, herbicide, ditch work) with the parcel areas. The annual yield of 2022 (Table 4, 7.5 and 4.7 t DM/ha, grass carbon content 0.47) is on the second cut. The article has no 2023 data. Fertiliser products are not named.
- Maktau: no management file. The rows come from Räsänen et al. 2026 (`data/articles/Räsänen_2026_kenia.pdf`, p. 3): the sowing and the harvest of the 2019 long rains and the harvest of 2020. No yields.

Only events with an exact day or a stated day range are rows. Type rules: seeding and oversowing are `sowing`; herbicide, glyphosate and a micronutrient tank mix are `spraying`; harrowing, disc work, subsoiling, cultivation and crushing of the crop are `tillage` (as in the source files); a cleaning cut or a cut left on the field is `cut`; the EC installation and ditch work are `other`.

### Article facts that are not events

These facts of the articles have no exact day, or they differ from the management file. They are not rows of `events.parquet`.

- Anttila, 2020 (Shurpali et al. 2025, p. 2): ploughed and sown in May 2020 (timothy, tall fescue, barley as cover crop), barley harvested in August, glyphosate in September, autumn ploughing in November, bare soil over the winter. 2021: one whole crop harvest on 2 August (a row, no yield). The EC data start in 2022.
- Särkisuo, 2020 (p. 2): fertilised early in May and in late June, grass harvested in June and August, glyphosate in late September, fallow over the winter. 2021: ploughing in June, whole crop harvest in July (month only). The EC data start in 2022.
- Maktau (Räsänen et al. 2026): the 2020 sowing was in the third week of March (p. 3). The 2021 long rains gave 0.22 t/ha (p. 11, from Tuure et al. 2025, not in the repository); the 2022 long rains were a complete crop failure (p. 11). `Ancillary_KE-Mkt.csv` gives seasonal practice only: stover burning in June and July after the long rains and in January and February after the short rains, weeding and burning in March and April and in September and October, ox-plough tillage before sowing.
- Qvidja (Heimsch et al. 2024, `data/articles/Heimsch_2024.pdf`, p. 2; `data/Qvidja/Qvidja.pdf` is the same file): grazing in August 2021 (8 cows, 6 days, rotational) and in August 2022 (9 cows, 9 days). The xlsx gives June 2021 (4 horses, 7 days) and June 2022 (9 cows, 15 days). The 2020 fertilisation was on about 26 May (p. 7, "one day after the fertilisation, i.e. on 27 May"); the xlsx gives 2020-05-25. Table 1 (p. 5) gives the annual carbon input and output per measurement year (4 May to 3 May).
- Viikki (Gao et al. 2026, Table A2 and p. 3): yield 3000 kg/ha for the 2022 cuts (docx: 3673 kg DW/ha), 6595 kg/ha for the 2023 barley whole crop (docx: 6773; the article gives 17 August only), tillage on 2022-11-01 (docx: 2022-11-02), manure of 2023-04-27 with 1701 kg DM/ha and 12.9 kg N/ha (docx: 18.4 kg N/ha; Vettikkat et al. 2026: 18.5 kg TAN/ha). The docx values are used. Table A1 gives the crop history of the field 1996 to 2021.

## Sites

| `site_id` | `code` | Name | FLUXNET id | Lat, lon | UTC offset | Data (local) | Note |
|---|---|---|---|---|---|---|---|
| 1 | `anttila` | Anttila | FI-Ant | 63.1453, 27.3128 | +2 h | 2022-2023 | Legume grassland. |
| 2 | `sarkisuo` | Särkisuo | FI-Sar | 63.15142822, 27.19906425 | +2 h | 2022-2023 | Mixed grasses. |
| 3 | `haltiala` | Haltiala | - | 60.271683, 24.94395 | +2 h | 2021-05 to 2025 | Cropland. |
| 4 | `qvidja` | Qvidja | - | 60.295333, 22.391833 | +2 h | 2018-05 to 2025 | Forage grassland. |
| 5 | `viikki` | Viikki | - | 60.21845, 25.01986 | +2 h | 2022-2025 | Grassland in rotation, field Alaniitty 1. |
| 6 | `maktau` | Maktau | KE-Mkt | -3.425833, 38.139444 | +3 h | 2014-08 to 2025-01 | Maize and vegetables. EC data 2018-12 to 2024-09. |

The project team gave all coordinates on 2026-10-22 (WGS 84 decimal degrees). They are not in the data files. The Haltiala tower file and the Maktau metadata give points about 30 m and 140 m away.

The Finnish files use UTC+2 all year (no daylight saving time). All sources stamp the start of the period, with one exception: the Viikki soil pit stamps the end of each 5-minute period.

## Column mapping per site

| Site | `nee` | `nee_f` | `nee_qc` | `ta` | `tsoil` (depth cm) | `swc` (depth cm) |
|---|---|---|---|---|---|---|
| Anttila, Särkisuo | `co2_flux_final_gf_ensemble` where `co2_flux_final_gap` = 0 | `co2_flux_final_gf_ensemble` | `co2_flux_final_gap` | `TA_1_1_1` | `TS_1_1_1` (not known) | `SWC_1_1_1` (not known) |
| Haltiala | `NEE` | `NEE_F` | 0 where `NEE` has a value, else 1 | `TA_F` | `TS_010_F` (10) | `SWC_010_F` (10) |
| Qvidja | `NEE` where `NEE_QC` = 0 | `NEE` | `NEE_QC` | `TA_F` | `TS_1` (5) | `SM` in V, ML3 polynomial to m³ m⁻³ (10) |
| Viikki (EC file) | `NEE (mg CO2 m-2 s-1)` × 22.7224 | `NEE_gapfilled (mg CO2 m-2 s-1)` × 22.7224 | 0 where `NEE` has a value, else 1 | `Tair (?C)` | 2022: EC `T1 (?C)` (14). 2023-2025: pit `Temp_T12_Avg_1`, 30-min mean (14) | 2022: EC `WFPS1 (%)` × 0.00509433962 (14). 2023-2025: pit `WC1`, 30-min mean (14) |
| Maktau | `FC` (continuous file) | NULL | NULL | `TA_1_1_1` | `TS_1_1_1` (10) | `SWC_1_1_1` (10) |

Notes:

- Qvidja `SM` is the raw output of the Delta-T ML3 ThetaProbe in V (provider, 2026-10-22). The build converts it with the polynomial for mineral soil of the ML3 manual (p. 22): θ = −0.071 + 0.735V + 0.75V² − 8.759V³ + 21.838V⁴ − 21.998V⁵ + 8.097V⁶ (`scripts/lib/ml3.ts`). The column map has `validRange: [0, 1]`: a result outside the range becomes NULL, and the report counts it (column "Out of range"; 0 values). Details: `docs/qvidja-soil-moisture.md`.
- Anttila and Särkisuo: the flux file and the biomet file of the same year share one time grid. The build joins them on the period.
- Viikki EC files (version of 2026-10-20): the headers give the NEE unit, mg CO2 m-2 s-1, for all four years. The build multiplies by 1000 / 44.0095 = 22.7224 (`MG_CO2_TO_UMOL`). The measured NEE is in `NEE (mg CO2 m-2 s-1)` (about 20 % of the periods) and the gap-filled NEE in `NEE_gapfilled (mg CO2 m-2 s-1)` (2024: `NEE _gapfilled`, with a space). In 2024 (1 750 periods) and 2025 (228) the gap-filled value differs from the measured value. The files are Latin-1; the degree sign is a literal `?` (`Tair (?C)`, two spaces in 2022 and 2023). The source has `encoding: 'latin-1'`.
- Viikki soil: the soil pit (5-minute step, 2023-2025) gives layer 1 (14 cm). No pit file exists for 2022. The 2022 EC file holds the same sensor: `T1 (?C)` is the 30-minute mean of pit `Temp_T12_Avg_1` (checked for 2023 and 2024, mean absolute difference 0.02 °C), and `WFPS1 (%)` × 0.509433962 / 100 is pit `WC1` exactly (porosity 0.509433962 = 1 − 1.3 / 2.65, columns `Soil Bulk density` and `Soil Particle Density`). The build uses these two columns for 2022 only, from 2022-04-12. On 2022-12-31 both sources exist and the report counts 48 `swc` conflicts from rounding; the pit value (rank 10) loses against the EC file (rank 1) in these 48 periods.
- Maktau: the continuous file (EC and biomet, 2018-2024) and the 30-minute meteo file (2014-2025) both hold TA, TS and SWC. The continuous file has rank 1 and the meteo file rank 2. Where both have a value, the continuous value is used. The two files disagree in about 490 periods for TA (median difference 0.54 °C). The report lists these conflicts. The 1-hour meteo file has a different time step and is not used.

## Rules

Each rule runs in SQL. The report gives its counts.

1. **Read as text, cast as number.** Every file is read with `all_varchar=true` and the encoding of the source (`utf-8`, or `latin-1` for the Viikki EC files). The text is trimmed. Empty text is NULL. In the Viikki EC files the decimal comma becomes a point. The macro `num(x)` casts to DOUBLE and returns NULL for the sentinels `-9999` (in any textual form such as `-9999.0000`), `NA`, `inf` and `nan`. The report counts the sentinels per source column.
2. **Timestamps.** Each source has a list of `strptime` formats, tried in order. Viikki EC files use `d.m.yyyy H:MM`. Qvidja and Maktau use `YYYYMMDDHHMM`. A row whose stamp does not parse or is not on a 30-minute boundary is rejected and counted. `ts_start` = local stamp minus the UTC offset of the site.
3. **Deterministic merge.** All sources of a site are stacked. For each period and column the first non-NULL value wins, in the order of source rank and then file row. The report counts, per site and column, the periods where two sources give different non-NULL values (conflicts). Exact duplicate rows (Qvidja 2018-2023 has every row twice) give no conflict.
4. **Maktau zero fill.** In both Maktau files, an exact 0 in `TA_1_1_1`, `TS_1_1_1` or `SWC_1_1_1` is a logger fill value and becomes NULL. The site is tropical lowland, so 0 °C and 0.000 m3 m-3 do not occur. The report counts the zeros per source column. Other Maktau rules (fill rows, stuck wind vane, low wind speed) are in the section "Optional columns".
5. **Viikki pit to 30 minutes.** The pit stamps the end of each 5-minute period. The build subtracts one microsecond and takes the 30-minute bucket, so the stamps 00:05 to 00:30 fall into the period that starts at 00:00. Duplicate 5-minute stamps are reduced to one row first. The period value is the mean of at least 3 of the 6 values, rounded to 10 decimals to remove binary summation noise. Otherwise it is NULL.
6. **Unit factor.** Viikki NEE (all years, mg CO2 to µmol) and Viikki WFPS 2022 (% to m3 m-3) have a factor. The factor is a field in the registry and appears in `site_variables.parquet` and in the report.
7. **Grid completion.** Missing periods between the first and the last period of a site get a row with NULL values.
8. **Write.** `COPY ... TO 'db/observations.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000, KV_METADATA {...})`, ordered by `site_id`, `ts_start`. The key-value metadata holds the build time and the generator name.

## Validation with Valibot

- `RegistrySchema`: the registry at start. Unique ids and codes, valid offsets, files that exist, a factor that is finite and not zero, an aggregate rule for every file with a step below 30 minutes.
- `headerSchema(expected)`: the header of each file must hold every column the mapping uses. A changed file layout stops the build with the list of missing columns.
- `ObservationRowSchema`: every output row, streamed from DuckDB in chunks. Site id 1-255, timestamp on a 30-minute boundary, finite values in physical ranges (NEE ±100, TA -60 to 60, soil temperature -40 to 60, SWC 0 to 1, QC flag 0 or 1). A range violation is a warning in the report. Any other issue stops the build.
- `EventRowSchema`: every row of `scripts/lib/events.ts`. Known site code and type, ISO dates in 2014 to 2030, `date_end` after `date`, the source file exists. Numbers ≥ 0, `dm_fraction` 0 to 1, `amount` and `amount_unit` together, `dry_mass_kg_ha` only on harvest or cut, `n_kg_ha` only on fertilisation. The build also stops on two equal rows.
- `ReportSchema`: the report object before it is written.

## Report

`db/report.md` has:

- Output files with row counts and bytes.
- Management events: count per site and type, with the number of rows with a yield, carbon and N input, and the carbon rows that match no event.
- Per site: rows, inserted grid rows, first and last period (UTC). Per column: valid count, min, max, mean, conflicts, range warnings. Per year: valid count, min and max per column.
- Per source file: physical lines, header lines, rows read, lines skipped by the CSV parser, rejected rows, duplicate stamps, rows after aggregation. Per source column: valid values, sentinels, zeros set to NULL, factor.
- Validation summary.

Physical lines = header lines + rows read + lines skipped by the parser.

## How to add a dataset

1. Add the site to `SITES` in `scripts/lib/registry.ts` with a new `siteId`, the UTC offset and the coordinates.
2. Add one `Source` per file. Give the delimiter, the number of header lines, the decimal mark, the encoding (if not UTF-8), the timestamp column and formats, the time step, whether the stamp marks the period end, and the rank.
3. Map each core column with a SQL expression over the cleaned text columns, with `num("col")` for numbers. Add `factor`, `zeroIsNull`, `validRange`, `depthCm` and `note` where they apply.
4. Run `npm run typecheck` and `npm run build:db`. Read the report: rejected rows, sentinels, conflicts and range warnings show problems in the mapping.

To add an output column, add it to `CORE_COLUMNS` and `VARIABLES` in the registry, to `ObservationRowSchema` in the schemas, and to the final `SELECT` that builds the `obs` table in the script.

## Open questions

- Coordinates of Anttila, Särkisuo and Viikki (Alaniitty 1). The sites table has NULL.
- Depth of `TS_1_1_1` and `SWC_1_1_1` at Anttila and Särkisuo.
- Maktau soil temperature in the meteo file has values near 1 °C in 2016-2017 and 2024. These pass the range check but look like sensor faults.

## Optional columns (added 2026-10-21)

These columns are NULL at the sites that do not measure them. They are the inputs of `scripts/calc.ts` (see `docs/calculated.md`). `OPTIONAL_COLUMNS` in the registry lists them; the build treats them like the core columns (merge by rank, conflicts, range warnings).

| Column | Unit | Sites | Source columns |
|---|---|---|---|
| `sw_in` | W m-2 | Anttila, Särkisuo (`SWIN_1_1_1`; Särkisuo 2022 has 3 234 values only), Qvidja (`SW_IN_F`), Viikki (`SWin (W/m2)`), Maktau (`SW_IN_1_1_1`, continuous then meteo) | |
| `ppfd` | µmol m-2 s-1 | Anttila, Särkisuo (`PPFD_1_1_1`), Haltiala (`PPFD_IN_F`), Viikki (`PAR (umol/m2s)`, 2025 `PPFD (umol/m2s)`) | |
| `rh` | % | Anttila, Särkisuo (`RH_1_1_1`), Qvidja (`RH_F`), Viikki (`RH(%)` / `RH (%)`), Maktau (`RH_1_1_1`, 0 = NULL) | |
| `vpd` | hPa | Haltiala (`VPD_F`), Qvidja (`VPD_F`), Maktau (`VPD`) | |
| `ustar` | m s-1 | Qvidja (`USTAR`), Maktau (`USTAR`) | |
| `nee_ssitc` | - | Maktau (`FC_SSITC_TEST`: 0 best, 1 good, 2 poor) | |
| `gpp_src` | µmol CO2 m-2 s-1 | Anttila, Särkisuo (`GPP_gf_ensemble_NT`), Qvidja (`GPP` × −1: the source gives uptake as negative) | |
| `reco_src` | µmol CO2 m-2 s-1 | Anttila, Särkisuo (`Reco_gf_ensemble_NT`), Qvidja (`RECO`) | |
| `ch4` | µmol CH4 m-2 s-1 | Anttila, Särkisuo (`ch4_flux_final_gf_ensemble`) | |
| `precip` | mm (sum per 30 min) | Anttila, Särkisuo (`P_RAIN_1_1_1`), Qvidja (`P`), Viikki (`P (mm)`, 2024 `P(mm)`; = rainfall + snowfall), Maktau (meteo `P_RAIN_1_1_1`) | Maktau: NULL in logger fill rows (see below) |
| `pa` | kPa | Anttila, Särkisuo (`PA_1_1_1`), Viikki (`Pair`, 2022-2023 only), Maktau (meteo `PA_1_1_1`, 0 = NULL) | |
| `ws` | m s-1 | Qvidja (`WS`), Viikki (`WS (m/s)`), Maktau (meteo `WS_1_1_1`, 0 = NULL) | The continuous Maktau `WS` is not a speed (33 % negative). It is not used. Maktau: NULL from 2023-07 to 2024-06 (see below). |
| `wd` | degrees from north | Qvidja (`WD`), Viikki (`WD (deg)`), Maktau (meteo `WD_1_1_1`) | Maktau: NULL where `WS_1_1_1` is exact 0 and on days with a stuck vane (see below). 0° is a valid direction, so no zero rule on WD itself. |
| `netrad` | W m-2 | Anttila, Särkisuo (`RN_1_1_1`), Qvidja (`NETRAD`), Maktau (meteo `NETRAD_1_1_1`, 14 % of periods, 0 = NULL) | The continuous Maktau `NETRAD_1_1_1` is a copy of SW_IN. It is not used. |
| `sw_out` | W m-2 | Anttila, Särkisuo (`SWOUT_1_1_1`), Qvidja (`SW_OUT`), Viikki (`Swout (W/m2)` 2022-2023, `SWout (W/m2)` 2024-2025) | |
| `le` | W m-2 | Anttila, Särkisuo (`LE_final_gf_ensemble`, gap-filled), Qvidja (`LE_F`, gap-filled), Maktau (continuous `LE`, measured only, 19 % of periods) | |
| `g` | W m-2, positive = into the soil | Anttila, Särkisuo (`SHF_1_1_1`), Viikki (`HF (W/m2)`, 2024 `HF(W/m2)`), Maktau (meteo `G_1_1_1`, 0 = NULL) | Sign checked: summer midday mean is positive, night mean negative. |
| `n2o` | nmol N2O m-2 s-1, positive = emission | Anttila, Särkisuo (`n2o_flux_final_gf_ensemble` × 1000, µmol in the unit row), Viikki (`N2O_gapfilled (ug m-2 s-1)` × 1000 / 44.013) | Viikki assumption: the header unit is µg N2O, not µg N2O-N. If it is N2O-N, multiply by 44.013 / 28.013. |

Maktau logger fill rows: in the meteo file, `TA_1_1_1` and `RH_1_1_1` are both exact 0 in about 13 400 rows, mainly from 2023-02-24 to 2024-02 (the continuous file has the same rows). In these rows TA, RH, TS, SWC, SW_IN, P_RAIN, WS and G are 0. SW_IN is 0 also at midday (2 043 rows from 09 to 15 h). A real 0 is normal for precipitation and for SW_IN at night, so the build sets `precip` and `sw_in` to NULL only in these rows. Maktau 2023 thus has precipitation for 33 % of the year only (69 mm). Do not use the Maktau 2023 annual sum. `NETRAD_1_1_1` and `PA_1_1_1` are not affected: in the fill rows the night mean of NETRAD is -56 W m-2, the same as in the other rows, and the midday values are normal. Thus the build keeps `netrad` in these rows.

Maktau net radiation 2023: the meteo file has NETRAD for part of each day only in 2023-05 to 2024-01 (many weeks have daytime values only). The values are plausible (Rn / SW_IN = 0.6 to 0.8 at midday, night -40 to -80 W m-2), but a weekly or monthly mean of these weeks is too high (up to 480 W m-2). Use only days with full coverage for means.

Maktau wind direction: the vane of `WD_1_1_1` is stuck from 2019-06. WD stays at one value for days or months (0.89° in 2021, 351° in 2022 to 2023, 22.6° from 2024-07). The daily SD of WD is below 0.5° on 1 421 days; in 2014 to 2018 only 1 day has an SD below 5°. Rule: WD is NULL on a local day where the SD of WD (rows with WS not 0) is below 5°. The SD is the smaller of the SD of WD and of (WD + 180) mod 360, so that a vane near north gives a small SD too. This removes 68 450 values. Valid WD after the rule: 2014 to 2018 nearly complete, 2019 7 038, 2020 1 783, 2021 39, 2022 to 2025 4.

Maktau wind speed: `WS_1_1_1` reads too low from 2023-07-19 to 2024-06-30. The ratio of WS to the EC friction velocity USTAR is 0.5 to 2.5 (3.3 to 4.4 before and after), and in 2023-10 to 2024-04 30 to 70 % of the midday values are below 0.2 m s-1. From 2024-07-25 the ratio is normal again. USTAR has too many gaps for a row rule, so the rule is a date range: WS is NULL from 2023-07-01 to 2024-06-30 (4 783 values).

Maktau latent heat flux: the high `le` in 2023-11 and 2023-12 (daily means up to 240 W m-2) is not a fault. These are daytime values only, in the wet season after heavy rain (53 mm in 2023-11), and LE + H is near Rn on the days with Rn. Maktau `pa` from the continuous file (1 165 more periods) is not used, because the meteo file is preferred and the merge takes one source per column by rank.

Qvidja duplicate rows: the merge takes the first non-NULL value per column, so the new columns use the same deduplication. The new columns have no merge conflicts.

Not added, because fewer than three sites have usable data:

- Snow depth (`D_SNOW_1_1_1` at Anttila and Särkisuo, `Snow Depth` at Viikki).
- Sensible heat flux H (Qvidja `H` is not gap-filled and partly empty; Maktau `H` only).
- Longwave in and out (Anttila, Särkisuo only; the Viikki `LWin` and `LWout` columns are the raw thermopile signal, not the radiation).

Known range warnings: Qvidja `vpd` below 0 in 2 018 rows (gap-filled values), Maktau `sw_in` above 1 500 W m-2 in 4 rows. Qvidja `ustar` has 76 268 merge conflicts: the duplicate rows of 2018-2023 differ in USTAR; the first row wins.

## Later extensions

- More variables as nullable columns: snow depth, H, longwave radiation (see above).
- The Maktau 1-hour meteo file as a separate table.
