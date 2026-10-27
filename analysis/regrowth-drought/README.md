# Regrowth after a silage harvest in a dry month

Question: how does drought (SPI-1 ≤ −1.5 in the month of the harvest) change the regrowth of a grassland after a silage harvest, measured as the light use efficiency LUE = GPP / PAR, within the same cut number? Article: https://inar.rjuho.dev/deep-dive/regrowth-drought/

Data: the harmonised database snapshot of 2026-10-23 (`builtAt` 2026-10-23T19:03:07.928Z), `db/events.parquet`, `db/sites.parquet`, `db/variables.parquet`, `db/observations.parquet` (columns `ppfd`, `sw_in`, `swc` of the four grass sites), `data/calculated/daily.parquet` and `data/SPI/SPI_all_stations.csv`. The release asset `db-2026-10-23.zip` is not yet published (TODO). The script docstring gives the SHA-256 of each input file. The episodes and the windows are those of Deep Dive #7 (`analysis/silage-harvest-response`); the 20 used episodes are the same (unit test `test_used_episodes_equal_deep_dive_7`). Daily PAR comes from `ppfd`; Qvidja has no `ppfd`, so its PAR = daily SW_in × k, with k the median PAR / SW_in ratio of the sites that have both.

Run (from the repository root): `uv run analysis/regrowth-drought/regrowth-drought.py --db db --calculated data/calculated --spi data/SPI`; check against the committed results: add `--check`.

Develop: `uvx ruff@0.17.2 format analysis/regrowth-drought && uvx ruff@0.17.2 check analysis/regrowth-drought`, `uv run --with pyright==1.1.414 --with pytest==9.1.1 --with-requirements analysis/regrowth-drought/regrowth-drought.py pyright analysis/regrowth-drought`, `uv run --with pytest==9.1.1 --with-requirements analysis/regrowth-drought/regrowth-drought.py pytest analysis/regrowth-drought/`.
