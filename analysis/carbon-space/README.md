# Site-years in carbon space

Question: how do the management and the crop of a site-year show in the annual carbon balance (annual GPP against annual Reco) and in the share of days with net uptake? Article: https://inar.rjuho.dev/deep-dive/carbon-space/

Data: the harmonised database snapshot of 2026-10-23 (`builtAt` 2026-10-23T19:03:07.928Z), `db/sites.parquet`, `db/events.parquet`, `data/calculated/annual.csv` and `data/calculated/daily.parquet` (calculated products of the same snapshot, `built_at` 2026-10-23T19:03:09.003Z). The release asset `db-2026-10-23.zip` is not yet published (TODO). The script docstring gives the SHA-256 and the row count of each input file. The script does not use a literature value.

Inclusion: a site-year is in the figures when `full_year` and `reliable` are true in `annual.csv` (measured fraction ≥ 0.2, longest gap ≤ 30 days). Figure 1 also needs an annual GPP and Reco sum. The script derives the reason of each excluded site-year from the flags (`excluded` in `results.json`). Uptake day = a local day with daily NEE < 0.

Figures (`figures/`): 1 `1-carbon-space.svg` annual Reco against annual GPP, one marker per site-year, 1:1 line and NEE = −200 and −400 guide lines; 2 `2-uptake-days.svg` share of uptake days per site-year, whole year and June to August; 3 `3-uptake-days-peak.svg` as Figure 2, but the second bar is the share of uptake days in the 90 consecutive days with the largest GPP sum of the year (80 or more days with GPP).

Run (from the repository root): `uv run analysis/carbon-space/carbon-space.py --db db --calculated data/calculated`; check against the committed results: add `--check`.

Develop: `uvx ruff@0.17.2 format analysis/carbon-space && uvx ruff@0.17.2 check analysis/carbon-space`, `uv run --with pyright==1.1.414 --with pytest==9.1.1 --with-requirements analysis/carbon-space/carbon-space.py pyright analysis/carbon-space`, `uv run --with pytest==9.1.1 --with-requirements analysis/carbon-space/carbon-space.py pytest analysis/carbon-space/`.
