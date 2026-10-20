# Harmonised core database

This document is the design of the harmonised database in `db/`. It tells what the database holds, which rules the build applies, and how to add a dataset. Use it again when the input datasets change.

Build: `npm install`, then `npm run build:db`. The script is `scripts/build-db.ts`. The registry of sites, files and column mappings is `scripts/lib/registry.ts`. The Valibot schemas are `scripts/lib/schemas.ts`. The build writes `db/report.md` and `db/report.json` and prints the report.

## Purpose

Six eddy-covariance sites deliver data in six layouts. The layouts differ in delimiter, decimal mark, timestamp format, missing-value code, column names and units. The database puts the variables that all sites share into one Parquet table with one row per site and 30-minute period. A small table gives the geolocation of each site. The files are for use in the browser with DuckDB-WASM.

## Principles

- `data/` is read-only. The build reads the files and does not change them.
- No loss of numeric accuracy. All measurements are DOUBLE. Each source value is a decimal text with at most 17 significant digits, so DOUBLE holds it exactly. The build applies only two arithmetic operations, and both are listed in `site_variables.parquet`: a unit factor (Viikki NEE 2022-2024) and a 30-minute mean (Viikki soil pit).
- Scope: the strict intersection. A column exists only when all six sites have the variable. The result is NEE, air temperature, soil temperature and soil water content.
- Every rule is explicit in the registry or in this document, and every rule reports its counts in the build report.
- DuckDB does all reading, cleaning, merging and writing in SQL. Valibot validates the registry, the file headers, every output row and the report.

## Output files

| File | Rows | Content |
|---|---|---|
| `db/observations.parquet` | about 538 000 | One row per site and 30-minute period. Sorted by `site_id`, `ts_start`. ZSTD, row groups of 100 000 rows. |
| `db/sites.parquet` | 6 | Geolocation index: `site_id`, `code`, `fluxnet_id`, `name`, `country`, `lat`, `lon`, `elevation_m`, `utc_offset_min`, `timestep_min`, `ecosystem`, `description`, `comment`, `data_start`, `data_end`. |
| `db/variables.parquet` | 8 | One row per output column: data type, unit, description. |
| `db/site_variables.parquet` | about 60 | Provenance per site and column: source file, source columns, SQL expression, factor, zero rule, sensor depth, rank, aggregation, note. |
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

## Sites

| `site_id` | `code` | Name | FLUXNET id | Lat, lon | UTC offset | Data (local) | Note |
|---|---|---|---|---|---|---|---|
| 1 | `anttila` | Anttila | FI-Ant | not in files | +2 h | 2022-2023 | Legume grassland. |
| 2 | `sarkisuo` | Särkisuo | FI-Sar | not in files | +2 h | 2022-2023 | Mixed grasses. |
| 3 | `haltiala` | Haltiala | - | 60.271671, 24.944509 | +2 h | 2021-05 to 2025 | Cropland. |
| 4 | `qvidja` | Qvidja | - | 60.2953, 22.3918 | +2 h | 2018-05 to 2025 | Forage grassland. |
| 5 | `viikki` | Viikki | - | not in files | +2 h | 2022-2025 | Grassland in rotation, field Alaniitty 1. |
| 6 | `maktau` | Maktau | KE-Mkt | -3.425859, 38.140663 | +3 h | 2014-08 to 2025-01 | Maize and vegetables. EC data 2018-12 to 2024-09. |

The Finnish files use UTC+2 all year (no daylight saving time). All sources stamp the start of the period, with one exception: the Viikki soil pit stamps the end of each 5-minute period.

## Column mapping per site

| Site | `nee` | `nee_f` | `nee_qc` | `ta` | `tsoil` (depth cm) | `swc` (depth cm) |
|---|---|---|---|---|---|---|
| Anttila, Särkisuo | `co2_flux_final_gf_ensemble` where `co2_flux_final_gap` = 0 | `co2_flux_final_gf_ensemble` | `co2_flux_final_gap` | `TA_1_1_1` | `TS_1_1_1` (not known) | `SWC_1_1_1` (not known) |
| Haltiala | `NEE` | `NEE_F` | 0 where `NEE` has a value, else 1 | `TA_F` | `TS_010_F` (10) | `SWC_010_F` (10) |
| Qvidja | `NEE` where `NEE_QC` = 0 | `NEE` | `NEE_QC` | `TA_F` | `TS_1` (5) | `SM` (10) |
| Viikki 2022-2024 (EC file) | NULL | `NEE` × 22.7224 | NULL | `Tair` | pit `Temp_T12_Avg_1`, 30-min mean (14) | pit `WC1`, 30-min mean (14) |
| Viikki 2025 (EC file) | `NEE` | `NEE_F_XGB` | 0 where `NEE` has a value, else 1 | `avg(AirT_2.2m_digi (C))` | pit, as above | pit, as above |
| Maktau | `FC` (continuous file) | NULL | NULL | `TA_1_1_1` | `TS_1_1_1` (10) | `SWC_1_1_1` (10) |

Notes:

- Anttila and Särkisuo: the flux file and the biomet file of the same year share one time grid. The build joins them on the period.
- Viikki NEE 2022-2024: the unit is not documented. The values are about 1/22 of the 2025 values in µmol m-2 s-1. The build assumes mg CO2 m-2 s-1 and multiplies by 1000 / 44.0095 = 22.7224. This is an assumption. Change `MG_CO2_TO_UMOL` in the registry when the unit is confirmed. The measured NEE is not identified in these files (`NEE_G` has values in about 20 % of the rows and its meaning is not known), so `nee` and `nee_qc` are NULL.
- Viikki soil: the EC files have soil columns only in 2023-2024 and the 2025 file has none. The soil pit (5-minute step, 2023-2025) is the one consistent source. The build uses layer 1 (14 cm) for all years. 2022 has no soil data.
- Maktau: the continuous file (EC and biomet, 2018-2024) and the 30-minute meteo file (2014-2025) both hold TA, TS and SWC. The continuous file has rank 1 and the meteo file rank 2. Where both have a value, the continuous value is used. The two files disagree in about 490 periods for TA (median difference 0.54 °C). The report lists these conflicts. The 1-hour meteo file has a different time step and is not used.

## Rules

Each rule runs in SQL. The report gives its counts.

1. **Read as text, cast as number.** Every file is read with `all_varchar=true`. The text is trimmed. Empty text is NULL. In the Viikki EC files the decimal comma becomes a point. The macro `num(x)` casts to DOUBLE and returns NULL for the sentinels `-9999` (in any textual form such as `-9999.0000`), `NA`, `inf` and `nan`. The report counts the sentinels per source column.
2. **Timestamps.** Each source has a list of `strptime` formats, tried in order. Viikki EC files use `d.m.yyyy H:MM` and, from 2024-01-01, `yyyy-mm-dd HH:MM:SS`. Qvidja and Maktau use `YYYYMMDDHHMM`. A row whose stamp does not parse or is not on a 30-minute boundary is rejected and counted. `ts_start` = local stamp minus the UTC offset of the site.
3. **Deterministic merge.** All sources of a site are stacked. For each period and column the first non-NULL value wins, in the order of source rank and then file row. The report counts, per site and column, the periods where two sources give different non-NULL values (conflicts). Exact duplicate rows (Qvidja 2018-2023 has every row twice) give no conflict.
4. **Maktau zero fill.** In both Maktau files, an exact 0 in `TA_1_1_1`, `TS_1_1_1` or `SWC_1_1_1` is a logger fill value and becomes NULL. The site is tropical lowland, so 0 °C and 0.000 m3 m-3 do not occur. The report counts the zeros per source column.
5. **Viikki pit to 30 minutes.** The pit stamps the end of each 5-minute period. The build subtracts one microsecond and takes the 30-minute bucket, so the stamps 00:05 to 00:30 fall into the period that starts at 00:00. Duplicate 5-minute stamps are reduced to one row first. The period value is the mean of at least 3 of the 6 values, rounded to 10 decimals to remove binary summation noise. Otherwise it is NULL.
6. **Unit factor.** Only Viikki NEE 2022-2024 has a factor. The factor is a field in the registry and appears in `site_variables.parquet` and in the report.
7. **Grid completion.** Missing periods between the first and the last period of a site get a row with NULL values.
8. **Write.** `COPY ... TO 'db/observations.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000, KV_METADATA {...})`, ordered by `site_id`, `ts_start`. The key-value metadata holds the build time and the generator name.

## Validation with Valibot

- `RegistrySchema`: the registry at start. Unique ids and codes, valid offsets, files that exist, a factor that is finite and not zero, an aggregate rule for every file with a step below 30 minutes.
- `headerSchema(expected)`: the header of each file must hold every column the mapping uses. A changed file layout stops the build with the list of missing columns.
- `ObservationRowSchema`: every output row, streamed from DuckDB in chunks. Site id 1-255, timestamp on a 30-minute boundary, finite values in physical ranges (NEE ±100, TA -60 to 60, soil temperature -40 to 60, SWC 0 to 1, QC flag 0 or 1). A range violation is a warning in the report. Any other issue stops the build.
- `ReportSchema`: the report object before it is written.

## Report

`db/report.md` has:

- Output files with row counts and bytes.
- Per site: rows, inserted grid rows, first and last period (UTC). Per column: valid count, min, max, mean, conflicts, range warnings. Per year: valid count, min and max per column.
- Per source file: physical lines, header lines, rows read, lines skipped by the CSV parser, rejected rows, duplicate stamps, rows after aggregation. Per source column: valid values, sentinels, zeros set to NULL, factor.
- Validation summary.

Physical lines = header lines + rows read + lines skipped by the parser.

## How to add a dataset

1. Add the site to `SITES` in `scripts/lib/registry.ts` with a new `siteId`, the UTC offset and the coordinates.
2. Add one `Source` per file. Give the delimiter, the number of header lines, the decimal mark, the timestamp column and formats, the time step, whether the stamp marks the period end, and the rank.
3. Map each core column with a SQL expression over the cleaned text columns, with `num("col")` for numbers. Add `factor`, `zeroIsNull`, `depthCm` and `note` where they apply.
4. Run `npm run typecheck` and `npm run build:db`. Read the report: rejected rows, sentinels, conflicts and range warnings show problems in the mapping.

To add an output column, add it to `CORE_COLUMNS` and `VARIABLES` in the registry, to `ObservationRowSchema` in the schemas, and to the final `SELECT` that builds the `obs` table in the script.

## Open questions

- Coordinates of Anttila, Särkisuo and Viikki (Alaniitty 1). The sites table has NULL.
- Depth of `TS_1_1_1` and `SWC_1_1_1` at Anttila and Särkisuo.
- Unit of Viikki NEE 2022-2024, and the meaning of `NEE_G`.
- Units of Viikki N2O (2022-2023 µg m-2 s-1 per the header, 2024 nmol m-2 s-1, 2025 not documented). Not used yet.
- Maktau soil temperature in the meteo file has values near 1 °C in 2016-2017 and 2024. These pass the range check but look like sensor faults.

## Later extensions

- Variables present at two or more sites, as nullable columns: PPFD, SW_IN, RH, VPD, pressure, precipitation, LE, H, CH4 and N2O fluxes, GPP and RECO.
- Haltiala `NEE_F1` to `NEE_F10` for annual uncertainty.
- Management tables from the Haltiala and Qvidja xlsx files.
- The Maktau 1-hour meteo file as a separate table.
