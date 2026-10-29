# Soil temperature, soil water and soil type as drivers of CH4 and N2O

Question: how do soil temperature, soil water content and soil type (peat or mineral) relate to the CH4 and N2O fluxes at Anttila, Särkisuo and Viikki? Article: https://inar.rjuho.dev/deep-dive/soil-ghg-drivers/

Data: the harmonised database snapshot of 2026-10-28 (`builtAt` 2026-10-28T10:44:08.475Z): `db/observations.parquet` (columns `site_id`, `ts_start`, `ch4`, `n2o`, `tsoil`, `swc`), `db/sites.parquet`, `db/variables.parquet` (unit check) and `db/events.parquet` (fertilisation dates). The release asset `db-2026-10-28.zip` is not yet published (TODO). The script docstring gives the SHA-256 and the row count of each input file. The script stops with exit code 3 when a file does not agree.

CH4 is only at Anttila and Särkisuo (2022 to 2023). N2O is at Anttila, Särkisuo (2022 to 2023) and Viikki (2022 to 2025). The fluxes are the gap-filled values of the providers. The gap-fill models use soil drivers, thus a part of each relation comes from the models. Soil type: Anttila mineral and Särkisuo drained peat (Shurpali et al. 2025, p. 2 and Table 2), Viikki clay loam (Vettikkat et al. 2026, p. 2 and 3). The literature values are in the table `LITERATURE` of the script, with the page.

Method (details in the script docstring): daily means of local days (40 or more of 48 half hours); median per 1 °C `tsoil` bin and per 0.02 m3 m-3 `swc` bin; Spearman rho; Q10 fit in log space to the bin medians; OLS of the daily flux on the standardised `tsoil`, `swc` and their product with Newey-West standard errors; annual sums compared with Shurpali et al. 2025 Table 3; paired days of Särkisuo and Anttila with a block bootstrap (7-day blocks, seed 20261029); N2O again without the 30 days that start on each fertilisation day.

Figures (`figures/`): 1 `1-temperature-response.svg` flux against soil temperature; 2 `2-water-response.svg` flux against soil water content; 3 `3-temperature-water-map.svg` mean daily flux per soil temperature and soil water cell; 4 `4-peat-vs-mineral.svg` annual sums per site-year with the Shurpali 2022 values.

Run (from the repository root): `uv run analysis/soil-ghg-drivers/soil-ghg-drivers.py --db db`. To compare with the committed results, add `--check`.

Develop: `uvx ruff@0.17.2 format analysis/soil-ghg-drivers && uvx ruff@0.17.2 check analysis/soil-ghg-drivers`, `uv run --with pyright==1.1.414 --with pytest==9.1.1 --with-requirements analysis/soil-ghg-drivers/soil-ghg-drivers.py pyright analysis/soil-ghg-drivers`, `uv run --with pytest==9.1.1 --with-requirements analysis/soil-ghg-drivers/soil-ghg-drivers.py pytest analysis/soil-ghg-drivers/`.
