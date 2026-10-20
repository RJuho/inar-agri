Use ASD-STE100 Simplified Technical English for approximately 80 % of all prose. Apply it to docs, comments, commit messages, and changelog entries.

- 👱🏻‍♂️🫛Anttila – Legume grassland - Data from 2022-2023 
- 🧚🌾Haltiala – Cropland (cereal crops, wheat and barley, one year sun flower) - Data from 2021-2025 
- 🐟🌱Särkisuo - Mixed grasses - Data from 2022-2023 
- 🐂🐝Qvidja – Forage grassland, managed intensively with conventional practices. 2017 they changed to more sustainable and environmentally friendly practices. - Data from 2018-2025 
- 👩🏻‍🔬🎓Viikki – Grassland in rotation - Data from 2022-2025, (Datacloud, SmartSMEAR) 
- 🇰🇪🌽Maktau, Taita region, Kenya, maize - Matti has the data

All data is located in 'data/'.

Use DuckDB as SQL database to store data.
https://duckdb.org/llms.txt

## Data inventory

Full column tables with units and one example value per column: see `docs/data-dictionary.md`.
Row counts below include header lines. Finnish sites use local time UTC+2. Maktau uses UTC+3.

### 👱🏻‍♂️🫛 Anttila (FI-Ant) and 🐟🌱 Särkisuo (FI-Sar)

- Files per site and year (2022, 2023): `EC_flux_L3_final_<code>_<year>.csv` (197 columns) and `biomet_final_30min_<code>_<year>.csv` (26 to 32 columns). 17 522 rows per file, 30-minute step, full calendar year.
- Comma delimiter. Line 2 is a unit row. Data starts on line 3. Missing value: `-9999`.
- Flux timestamp column `time`, format `yyyy-mm-dd HH:MM:SS`, example `2022-01-01 00:00:00`.
- Biomet timestamp column `TIMESTAMP_1`, same format.
- Key flux columns (µmol m-2 s-1, LE in W m-2): `co2_flux_final_gf_ensemble` (0.44701907), `co2_flux_final_gap` (1 = gap-filled), `LE_final_gf_ensemble` (-0.53086621), `ch4_flux_final_gf_ensemble` (-0.00033240), `n2o_flux_final_gf_ensemble` (0.00047142), `GPP_gf_ensemble_NT` (0.0), `Reco_gf_ensemble_NT` (0.44701907).
- Key biomet columns: `TA_1_1_1` C (-6.5222), `RH_1_1_1` % (84.6626), `PPFD_1_1_1` umol/m^2/s (-0.0007), `P_RAIN_1_1_1` mm (0.0), `SWC_1_1_1` m^3/m^3 (0.1599), `TS_1_1_1` C (0.4), `SHF_1_1_1` W/m^2 (-1.77), `PA_1_1_1` kPa (98.9632), `D_SNOW_1_1_1` m.
- Biomet column sets differ: Anttila 2022 has `SO411O2_1_1_1..1_5_1`, `WTD_1_1_1` and `BF5_*`. Anttila 2023 drops `SO411O2_*` and `WTD`. Särkisuo has no `BF5_*`.
- Coordinates are not in the data files.

### 🧚🌾 Haltiala

- `data/Haltiala/haltiala.csv`: 81 601 rows, 19 columns, comma delimiter, 30-minute step, 2021-05-07 to 2025-12-31.
- Timestamp column `TIMESTAMP_START`, format `yyyy-mm-dd HH:MM`, example `2021-05-07 00:00`. Missing value: `NA`.
- Columns: `NEE` (NA), `NEE_F` (0.559385), `NEE_F_UNC` (0.538254), `TA_F` (4.05), `PPFD_IN_F` (0), `VPD_F` (1.10), `TS_010_F` (7.87), `SWC_010_F` (0.52), `NEE_F1` to `NEE_F10` (ten XGBoost gap-fill models). Units in `data/Haltiala/ReadMe.md`.
- Annual uncertainty: sum `NEE_F1` to `NEE_F10` per year, then take SD or 95 % CI of the ten sums. Do not aggregate `NEE_F_UNC`.
- `haltiala_smear_management.xlsx`: Year, Date (Excel serial), Action, Value, Units, Description.
- `geodata/`: field polygon as Shapefile and GeoPackage, CRS EPSG:3067 (TM35FIN). EC tower at 60.271671 N, 24.944509 E.
- Crops: 2021 barley, 2022 oats, 2023 grass (failed), 2024 sunflowers, 2025 oats.

### 🐂🐝 Qvidja

- `data/Qvidja/Qvidja_2018-2025.csv`: 237 556 rows, 28 columns, comma delimiter, 30-minute step, 2018-05-09 to 2025-12-31.
- Timestamp columns `TIMESTAMP_START` and `TIMESTAMP_END`, format `YYYYMMDDHHMM`, example `201805090200`. Missing value: empty field.
- Columns: `USTAR` (0.0241), `WS` (0.3025), `WD` (335.385), `NEE` µmol m-2 s-1 (2.6142), `NEE_QC` (1.0), `GPP` (0.0), `RECO` (2.4175), `H` (empty), `LE_F` (-4.5349), `NETRAD` (-51.38), `SW_IN_F` (0.0), `SW_OUT` (0.25), `TA_F` (5.44), `P` mm (0.0), `CO2` ppm (459.874), `RH_F` (84.6), `VPD_F` hPa (1.384), `TS_1` 5 cm (9.07), `TS_2` 15 cm (empty), `TS_3` 30 cm (10.64), `SM` 10 cm m3 m-3 (0.822). `_QC` columns: 0 = measured, 1 = gap-filled.
- Site: 60°17'43.2" N, 22°23'30.6" E, 7 m a.s.l., clay loam, EC height 2.3 m. Units and descriptions in `Qvidja-readme.xlsx`.
- `Qvidja_management.xlsx`: Date, Area (ha), Management action, Name, Amount, Unit, DM fraction, Harvest type, Duration (days), Straws removed, Comment.

### 👩🏻‍🔬🎓 Viikki

- EC files `data/Viikki/EC/2022.csv` to `2025.csv`: 16 033 to 17 569 rows, 36 to 43 columns, 30-minute step.
- Semicolon delimiter. Comma decimal mark. Datetime column `Datetime`, format `d.m.yyyy H:MM`, example `1.1.2022 0:00`. Missing value: empty field. The 2023 and 2024 files start on 1 December of the previous year.
- Column names change by year. 2022 to 2024 key columns: `PAR` (-0,13), `Pair` (100,22), `WS` (1,1), `WD` (329), `P` (0), `Snow Depth` (9), `NEE` (0,006168531), `GFN2O` (0,010908517), `RH` (92,43), `SWin`, `SWout`, `LWin`, `LWout`, `Tair` (-0,95), `WC1..3`, `WFPS1..2`, `WL`, `precip_phase` (no_precip), `snowfall`, `rainfall`.
- N2O unit changes: µg m-2 s-1 in 2022 and 2023, nmol m-2 s-1 in 2024. The 2022 file also has `N2O_sameunit` and `GF_N2O_sameunit`.
- 2025 key columns: `PA_FMI` (100,51), `P_FMI`, `SNOWDEPTH_FMI`, `avg(AirT_2.2m_digi (C))` (-2,44), `avg(AirRH_2.2m (%))`, `PPFD (umol/m2s)`, `NEE_F_XGB` (0,966301), `N2O_gapfilled` (0,001741306), `WFPS1`, `WFPS2`, `Rainfall `, `Snowfall`. Note the trailing space in `Rainfall `.
- Soil pit files `data/Viikki/pit1_cleaned_2023.csv` to `2025.csv`: about 105 000 rows each, 35 to 37 columns, comma delimiter, 5-minute step. Timestamp column `TIMESTAMP`, format `yyyy-mm-dd HH:MM:SS`, example `2022-12-31 00:05:00`. Each file starts on 31 December of the previous year.
- Pit columns, index 1 to 5 = depth 14, 37, 54, 95, 120 cm: `Redox_Avg_n` mV, add +200 mV (471.4), `Temp_T12_Avg_n` C (0.4), `EC_Avg_n` µS/cm (60), `Temp_T21_Avg_n` C, `Matric_potential_Avg_n` kPa (-0.1), `WC1..5` m3/m3 (0.449), `Water_level_Avg` m (1.777), `Temp_ottpls_Avg` C, `shf_plate_Avg` W/m2. Details in `pit1_metadata.txt`.
- Crops (field Alaniitty 1): 2022 timothy, 2023 barley / mixed grass / red clover, 2024 grassland, 2025 fava bean. Coordinates are not in the data files.

### 🇰🇪🌽 Maktau (KE-Mkt)

- `data/Maktau/Continuous_KE-Mkt.csv`: 99 501 rows, 165 columns, 30-minute step, 2018-12-17 to 2024-09-04. EC and biomet in one file. Many columns hold only `-9999`.
- `Maktau_meteo_30_min_KE-Mkt.csv`: 182 065 rows, 44 columns, 2014-08-23 to 2025-01-10.
- `Maktau_meteo_1_hour_KE-Mkt.csv`: 53 380 rows, 25 columns, 2018-11-01 to 2024-12-03. The last column header is empty.
- All three: comma delimiter, AmeriFlux names, timestamp columns `TIMESTAMP_END` and `TIMESTAMP_START`, format `YYYYMMDDHHMM`, example `201812171200`. Missing value: `-9999`. No unit row.
- Key continuous columns: `FC` (-8.2375), `CO2` (395.027), `H2O` (21.2876), `H` (254.98), `LE` (-9999), `USTAR` (0.58), `WS`, `WD` (48.3), `TA_1_1_1` (27.43), `RH_1_1_1` (59.79), `PA_1_1_1` (89.7), `P_RAIN_1_1_1` (0), `SW_IN_1_1_1` (754.7), `NETRAD_1_1_1`, `NDVI_1_1_1` (0.3647), `SWC_1_1_1` (0.0845), `TS_1_1_1` (26.49), `G_1_1_1` (19.85), `SWP_2_1_1` (-933.4).
- Site: -3.425859, 38.140663, UTC+3, maize 80 % and vegetables 20 %, EC height 3.3 m. `Ancillary_KE-Mkt.csv` is a key/value metadata file in Windows-1252 encoding. `BADM-Site-General-Info-KE-Mkt.xlsx` is the AmeriFlux BADM template.

## Read rules for `data/`

- Treat `data/` as read-only. Do not write, rename or reformat files there.
- Files are large. Read only the first lines with `head` when you inspect a file.
- Skip the unit row in Anttila and Särkisuo files. DuckDB applies `skip` before it reads the header. Read the names first, then read the data: `read_csv(path, header=true, all_varchar=true) LIMIT 0` gives the names, then `read_csv(path, skip=2, header=false, names=[...], nullstr='-9999')` gives the data.
- Set the missing-value string per file: `nullstr='-9999'` (Anttila, Särkisuo, Maktau), `nullstr='NA'` (Haltiala), `nullstr=''` (Qvidja, Viikki).
- Viikki EC files: `read_csv(path, delim=';', decimal_separator=',', timestampformat='%-d.%-m.%Y %-H:%M')` or parse `Datetime` with `strptime(Datetime, '%d.%m.%Y %H:%M')`.
- `YYYYMMDDHHMM` timestamps (Qvidja, Maktau): read as VARCHAR or BIGINT, then `strptime(CAST(col AS VARCHAR), '%Y%m%d%H%M')`.
- Example: `SELECT * FROM read_csv('data/Haltiala/haltiala.csv', nullstr='NA') LIMIT 5;`

## Harmonised database (`db/`)

- Design and rules: `docs/harmonised-database.md`. Build: `npm run build:db` (runs `scripts/build-db.ts`, DuckDB + Valibot, about 12 s). Registry of sites, files and column mappings: `scripts/lib/registry.ts`.
- Output: `db/observations.parquet` (one row per site and 30-min period, UTC `ts_start`, strict core columns `nee`, `nee_f`, `nee_qc`, `ta`, `tsoil`, `swc`), `db/sites.parquet` (geolocation index), `db/variables.parquet`, `db/site_variables.parquet`, `db/report.md`.
- The Parquet files are not in git. Run the build to create them. Read the report for counts, conflicts and warnings.

## Website (`site/`)

- Static Astro site. Apache ECharts draws the charts. DuckDB-WASM reads the Parquet files in the browser. Vanilla TypeScript and vanilla CSS only. Do not add a UI framework.
- Data flow: `npm run build:db` writes `db/*.parquet`. `npm run site:sync` (`scripts/sync-site-data.ts`) copies them to `site/public/data/` (not in git). The page fetches the files, registers them in DuckDB-WASM and runs SQL.
- Code: `site/src/pages/index.astro` (page), `site/src/scripts/db.ts` (DuckDB-WASM start and queries), `site/src/scripts/chart.ts` (ECharts option), `site/src/styles/global.css`.
- The first page shows all data: five panels (`nee`, `nee_f`, `ta`, `tsoil`, `swc`), one series per site, shared UTC time axis, zoom linked across panels. Labels and units come from `sites.parquet` and `variables.parquet`.
- The chart container gets `data-status="ready"`, `data-rows` and `data-series` when the chart is drawn. Tests use these attributes.
- Commands: `npm run site:dev`, `npm run site:build`, `npm run site:preview`, `npm run test:e2e` (Playwright, Chromium, `tests/site.spec.ts`).
- DuckDB-WASM downloads the parquet extension from `extensions.duckdb.org` at run time. The page needs internet access.
- To add a chart: add a query in `db.ts`, an option builder in `site/src/scripts/`, and a container in the page.
