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

- EC files `data/Viikki/EC/2022.csv` to `2025.csv` (version of 2026-10-20): 17 521 to 17 569 rows, 30 to 35 columns, 30-minute step, full calendar years. Encoding ISO-8859-1 (Latin-1), CRLF line ends.
- Semicolon delimiter. Comma decimal mark. Datetime column `Datetime`, format `d.m.yyyy H:MM`, example `1.1.2022 0:00`. Missing value: empty field. Units are in the column names. The degree sign is a literal `?`.
- Key columns: `NEE (mg CO2 m-2 s-1)` measured, about 20 % of periods (0,023166791), `NEE_gapfilled (mg CO2 m-2 s-1)` (0,006168531; 2024 spells it `NEE _gapfilled`), `N2O (ug m-2 s-1)`, `N2O_gapfilled (ug m-2 s-1)` (0,004809073), `Tair (?C)` (-0,95; two spaces `Tair  (?C)` in 2022 and 2023), `RH(%)` or `RH (%)` (92,43), `PAR (umol/m2s)` or 2025 `PPFD (umol/m2s)`, `WS (m/s)`, `WD (deg)`, `P (mm)` or 2024 `P(mm)`, `Snow Depth` (9), `SWin (W/m2)`, `Swout (W/m2)` or `SWout (W/m2)`, `LWin (W/m2)`, `LWout (W/m2)`, `HF (W/m2)`, `WL (m)` / `WL(m)` / 2025 `Water level (m)`, `rainfall`, `snowfall` (2025 `Rainfall`, `Snowfall`).
- Soil columns in the EC files (same sensors as pit layers 1 and 2): `RD1 (mV)`, `RD2 (mV)`, `T1 (?C)` (0,4), `T2 (?C)`, `EC1 (µS/cm)`, `EC2 (µS/cm)`, `MP1 (kPa)`, `MP2 (kPa)`, `WFPS1 (%)` (104,716448), `WFPS2 (%)`. 2022 and 2023 also have `Soil Bulk density` (1,3), `Soil Particle Density` (2,65), `Total Porosity` (0,509433962); 2022 has `MP3 (kPa)`. `WFPS1 / 100 × 0,509433962` = pit `WC1`. No `WC` columns.
- `EC/Management Information.docx`: management notes, not parsed.
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
- Viikki EC files: `read_csv(path, delim=';', decimal_separator=',', encoding='latin-1', timestampformat='%-d.%-m.%Y %-H:%M')` or parse `Datetime` with `strptime(Datetime, '%d.%m.%Y %H:%M')`. Without `encoding='latin-1'` the read fails on line 1.
- `YYYYMMDDHHMM` timestamps (Qvidja, Maktau): read as VARCHAR or BIGINT, then `strptime(CAST(col AS VARCHAR), '%Y%m%d%H%M')`.
- Example: `SELECT * FROM read_csv('data/Haltiala/haltiala.csv', nullstr='NA') LIMIT 5;`

## Harmonised database (`db/`)

- Design and rules: `docs/harmonised-database.md`. Build: `npm run build:db` (runs `scripts/build-db.ts`, DuckDB + Valibot, about 12 s). Registry of sites, files and column mappings: `scripts/lib/registry.ts`.
- Output: `db/observations.parquet` (one row per site and 30-min period, UTC `ts_start`, strict core columns `nee`, `nee_f`, `nee_qc`, `ta`, `tsoil`, `swc`), `db/sites.parquet` (geolocation index), `db/variables.parquet`, `db/site_variables.parquet`, `db/report.md`.
- The Parquet files are not in git. Run the build to create them. Read the report for counts, conflicts and warnings.

## Calculated products (`data/calculated/`)

- Design, formulas, assumptions and validation: `docs/calculated.md`. Source article: Hu et al. 2024 (`data/s43247-024-01202-3.pdf`, `.htm`). Build: `npm run calc` (runs `scripts/calc.ts`, about 7 s, needs `db/*.parquet`). Unit tests: `npm run test:unit`.
- Code: `scripts/lib/calc/` (`constants.ts` all parameters, `lloyd-taylor.ts` fitter, `partition.ts` night-time partitioning, `ustar.ts` and `mds.ts` Maktau filter and gap filling, `management.ts` harvest and manure carbon table, `schemas.ts`, `report.ts`), shared helpers in `scripts/lib/duck.ts`.
- Output (not in git): `fluxes_30min.parquet` (NEE, gap-filled NEE, Reco, GPP per 30 min, GPP ≥ 0, `nee_f = reco - gpp`), `daily.csv`, `monthly.csv`, `annual.csv` (g C m-2), `necb.csv` (NECB = −NEE − C_harvest + C_exo − C_CH4, positive = gain), `management_carbon.csv`, fit diagnostics, validation tables, `report.md`.
- The harmonised database has optional columns for this: `sw_in`, `ppfd`, `rh`, `vpd`, `ustar`, `nee_ssitc`, `gpp_src`, `reco_src`, `ch4` (NULL where a site lacks them).

## Website (`site/`)

- Static Astro site (Astro 7.4.1). Apache ECharts draws the charts. DuckDB-WASM reads the Parquet files in the browser. Vanilla TypeScript and vanilla CSS only. Do not add a UI framework.
- Hosting: Cloudflare Workers static assets. `wrangler.jsonc` (root) serves `site/dist/`. No Worker script and no Astro adapter. `site/public/_headers` sets the cache rules: `/_astro/*` and `/duckdb/*` immutable for 1 year, `/data/*` 1 hour. `/duckdb/*.gz` has `Content-Type: application/octet-stream` (no `Content-Encoding`).
- The page makes no requests to other origins. All DuckDB files come from our own build. `npm run site:sync` runs `scripts/sync-site-duckdb.ts`. It writes `site/public/duckdb/` (not in git):
  - `<npm version>/duckdb-browser-{eh,mvp}.worker.js`: copies from `node_modules/@duckdb/duckdb-wasm/dist/`. The page starts the worker with `new Worker(url)`.
  - `<npm version>/duckdb-{eh,mvp}.wasm.gz`: Cloudflare accepts files up to 25 MiB only. The WASM files are 34 to 40 MB, thus the script compresses them with gzip (level 9, about 7.7 and 8.7 MB). `db.ts` fetches the file, decompresses it with `DecompressionStream('gzip')` (only if the first bytes are `1f 8b`, because a host can decode it before) and gives a blob URL (`application/wasm`) to `db.instantiate()`. `selectBundle()` picks EH or MVP.
  - `extensions/<DuckDB version>/wasm_{eh,mvp}/parquet.duckdb_extension.wasm`: the official signed parquet extension (about 3 MB). It is not on npm. The script downloads it one time from `extensions.duckdb.org` into `node_modules/.cache/inar-duckdb-ext/`. Without internet and without cache, the script fails. The DuckDB version (for example `v1.4.3`) comes from the Node build of the npm package (`getVersion()`). `db.ts` sets `custom_extension_repository` to `<origin><base>duckdb/extensions` and runs `LOAD parquet` before the first Parquet read. Our queries load no other extension. If a new query needs one (for example `json`), add it to `EXTENSIONS` in the script.
  - The script does no work for a file when the output is newer than the input. When you update `@duckdb/duckdb-wasm`, the paths change and the script removes the old versions.
- `scripts/check-dist.ts` runs in `site:build` and fails if a file in `site/dist/` is 25 MiB or larger. Do not put uncompressed `.wasm` files of DuckDB in `site/public/`.
- Data flow: `npm run build:db` writes `db/*.parquet`. `npm run site:sync` (`scripts/sync-site-data.ts`) copies them to `site/public/data/` (not in git). The page fetches the files, registers them in DuckDB-WASM and runs SQL.
- At start, `db.ts` makes table `obs`: all columns of `observations.parquet` plus `tl`, the period start in site local time (`ts_start` + `sites.utc_offset_min`). The database stays open. `query(sql)` runs SQL on it.
- Code in `site/src/scripts/`: `app.ts` (start, connects the parts), `db.ts` (DuckDB-WASM, `query(sql)`, `loadMeta()`), `state.ts` (types, guards, Web storage, URL hash), `theme.ts` (CSS colour tokens), `ui/tabs.ts`, `ui/params.ts`, `ui/diagrams.ts` (diagram cards, ECharts setup), `diagrams/registry.ts` (diagram types), `diagrams/sql.ts` (shared WHERE clause), `diagrams/common.ts` (site colours, axes, legend, row groups), one file per diagram type, `alttext.ts` (stats query and alt text), `export.ts` (PNG of one diagram and composite PNG of all diagrams), `png.ts` (iTXt chunk writer, data URL helpers), `crc32.ts` (CRC-32, for PNG chunks and ZIP entries), `dataexport.ts` (data export SQL and files), `zip.ts` (store-only ZIP writer), `ui/dataMenu.ts` ("Download data" menu), `sites.ts` (site emojis, used only in the site checkboxes). Page: `site/src/pages/index.astro`. Styles: `site/src/styles/global.css`.
- Layout, top to bottom: "Add diagram" list, tabs (New, Copy, Rename, Delete, Copy link, Download all, Download data), parameter form, diagram cards (PNG, up, down, remove). One tab = one view = data parameters (sites, variables, year range, step, x variable) + diagrams. All diagrams of a view use the same parameters.
- State: `localStorage` key `inar-agri.views` (`{version: 1, activeId, views}`). `parseStore()` checks the value with whitelists. If the value is bad, the page copies it to `inar-agri.views.bak` and uses the default view "All data" (all sites, five variables, all years, raw, one time series diagram).
- URL hash `#view=<base64url(JSON of one view)>` adds the view as a new tab, or selects an equal tab. Then the page removes the hash. "Copy link" makes this URL.
- The default view shows five panels (`nee`, `nee_f`, `ta`, `tsoil`, `swc`), one series per site, shared time axis in site local time (`tl`), zoom linked across panels.
- Diagram types: `timeseries` (time series, raw / daily / monthly mean), `years` (overlay, x = day of year, one line per site and year, earlier years lighter), `yearPanels` (one small panel per year side by side, shared y axis per variable), `monthly` (grouped bars of the mean per calendar month), `diurnal` (mean per half hour of local time with a 25 to 75 % band), `scatter` (x variable against the other variables, reservoir sample of 20 000 rows, `REPEATABLE (1)`), `cumulative` (running sum of `nee` / `nee_f` per site and year in g C m-2: `sum(nee) * 1800 * 12.011e-6` per day). `years`, `yearPanels` and `cumulative` show raw data as daily means and tell this in the subtitle. When the parameters do not fit a type (for example `cumulative` without NEE), the card shows a note and no chart.
- The site colour is the position of the site in `sites.parquet` (`siteColors()` in `diagrams/common.ts`). It is the same in all diagrams.
- Alt text: `alttext.ts` runs a stats query per site and variable (count, mean, min, max, time of min and max, change of the annual mean per year). Each type adds one sentence (`describe()`). The card shows the text in a figcaption with a Copy button and sets it as `aria-label` of the chart element (`role="img"`). `window.__inar.altText(idOrIndex)` returns the alt text of a diagram of the active view.
- To add a diagram type: write a `DiagramDef` (`query`, `prepare`, `build`, `height`, `describe`; optional `relayout`, `widthDependent`, `statsVariables`) in a new file in `site/src/scripts/diagrams/` and add it to `DEFS` in `registry.ts`. The "Add diagram" list then shows it. Use the helpers in `common.ts` for the site colours, legend and axes. Add the type to `ALL_TYPES` in `tests/site.spec.ts`.
- Test attributes: `#chart` has `data-status` (`ready` when all diagrams are ready, `empty` when the view has no diagrams), `data-rows` and `data-series` (sums). Each `.diagram` has `data-type`, `data-status`, `data-rows` and `data-series`. The ECharts instance is on `.diagram-chart` as `__chart`.
- PNG export: the PNG button of a card saves the chart at 3 pixels per CSS pixel (`getDataURL`, theme background `--surface`). "Download all" saves one composite image: a header (view name, parameters line, source), then for each diagram the title, subtitle, chart and alt text (wrapped). Both files have iTXt chunks (UTF-8) `Title` and `Description` (= alt text). File names: `inar-agri_<view-slug>_<n>-<type>.png` and `inar-agri_<view-slug>_all.png`. If the composite is too large for a canvas (32 000 px per side, 200 million px), the scale goes down.
- `window.__inar.exportPng(target, scale)` returns `Promise<{dataUrl, alt}>`. `target` = `'all'`, a diagram index (0 = first) or a diagram id. `window.__inar.view()` returns the active view with its diagrams (index, id, type, title).
- Data export: "Download data" opens a menu (menu button pattern: arrow keys, Home, End, Escape, Tab, click outside closes). Items: all sites in one file (Parquet or CSV) and one file per site in one ZIP (Parquet or CSV). The data = the rows of the time series diagram for the view parameters (sites, variables, years in local time, step; `day` / `month` = mean per local day / month). DuckDB-WASM writes the file with `COPY ... TO` in its virtual file system, then `copyFileToBuffer` and `dropFile`. No server calls. The status line shows the progress, then the file size and the row count.
  - Columns: `site_code`, `site_name`, `ts_start_utc` (period start, UTC), `ts_local` (period start, site local time), the selected variables, and `nee_qc` for raw data when `nee` is selected. Units are in `variables.parquet`.
  - CSV: UTF-8, header row, no unit row, `,` delimiter, `.` decimal mark, empty field = NULL, times in ISO 8601 (`2022-01-01T00:00:00Z` for UTC, no offset for local time). Parquet: ZSTD, key/value metadata `unit:<column>`, `description:<column>`, `source`, `view`, `params`, `step`, `years`.
  - File names: `inar-agri_<view-slug>_<from>-<to>_<step>.parquet|csv`, ZIP `..._<step>_parquet.zip` or `..._csv.zip` with entries `..._<step>_<site_code>.<ext>`. The ZIP is store only (no compression, no ZIP64, max 4 GiB).
  - Full data (all sites, raw): CSV about 49 MB, Parquet about 9.5 MB.
- Commands: `npm run site:dev`, `npm run site:build`, `npm run site:preview`, `npm run test:e2e` (Playwright, Chromium, `tests/site.spec.ts`), `npm run cf:preview` (build, then `wrangler dev` on the local Workers runtime), `npm run deploy` (build, then `wrangler deploy`; needs a Cloudflare login).
- Astro 7.4 runs `astro preview` in the background when it detects an AI agent, and that mode fails with `--root site`. Add `--ignore-lock` to keep it in the foreground. The Playwright config does this.
- Screenshot tool for AI agents: `scripts/screenshot.ts` (`npm run screenshot -- <options>`). It opens the page in headless Chromium (from `@playwright/test`), waits until all diagrams are ready, calls `__inar.exportPng()` and writes the PNG and the alt text. Run `npm run screenshot -- --help` for all options.
  1. Start the server one time, in the background: `npm run site:build && npm run site:preview -- --ignore-lock` (port 4321). Without `--ignore-lock`, Astro sends the server to the background for AI agents, and that mode fails. Or give `--url` (for example the Playwright server or `wrangler dev`).
  2. Default view, all diagrams: `npm run screenshot -- --out screenshots/all.png`
  3. Own view (missing keys get defaults; new ids are made): `npm run screenshot -- --view '{"name":"Qvidja","params":{"sites":[4],"variables":["nee_f","ta"],"yearFrom":2022,"yearTo":2023,"aggregation":"day"},"diagrams":[{"id":"a","type":"monthly"},{"id":"b","type":"cumulative"}]}' --out screenshots/qvidja.png`. `--view` also takes a JSON file.
  4. One diagram: `--diagram 0` (index) or `--diagram <id>`. Dark mode: `--theme dark`. Other options: `--scale 3`, `--width 1400`, `--timeout 180`.
  5. `--list` prints the view, its diagrams (index, id, type, title) and the diagram types. It saves no image.
  - Output: `<out>.png` and `<out>.alt.txt` (the `.png` part changes to `.alt.txt`). Default `screenshots/screenshot.png` (not in git). Write to the scratchpad when the image is only for you.
  - Look at the image with the Read tool on the PNG path. The Read tool makes large images smaller; for details use `--scale 1` or `--diagram <n>`. Read the `.alt.txt` file for the numbers.
  - Exit codes: 0 = done, 1 = error in the page or a diagram, 2 = bad option or no server (the script prints how to start the server).
- Tests: `isolate()` in `tests/site.spec.ts` blocks all requests to other origins (`page.route`) and fails the test if the page makes one, at page load and during the data export.
