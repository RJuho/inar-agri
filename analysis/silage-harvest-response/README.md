# Silage harvest and grassland CO₂ fluxes

Question: how do daily GPP, TER (= Reco) and NEE of a grassland develop from 14 days before to 28 days after a silage harvest, per site and over all sites? Article: https://inar.rjuho.dev/deep-dive/silage-harvest-response/

Data: the harmonised database snapshot of 2026-10-23 (`builtAt` 2026-10-23T19:03:07.928Z), `db/events.parquet`, `db/sites.parquet`, `db/variables.parquet` and `data/calculated/daily.parquet`. The release asset `db-2026-10-23.zip` is not yet published (TODO). The script docstring gives the SHA-256 of each input file. The episode, window, recovery and change-point rules are those of Deep Dive #4 (`scripts/deep-dives/disturbance-detail.ts`), ported to Python; the five overrides of that dive are typed in the script (`OVERRIDES`). The 20 used episodes give the same numbers as Deep Dive #4 (unit test `test_results_equal_deep_dive_4`).

Run (from the repository root): `uv run analysis/silage-harvest-response/silage-harvest-response.py --db db --calculated data/calculated`; check against the committed results: add `--check`.

Develop: `uvx ruff@0.17.2 format analysis/silage-harvest-response && uvx ruff@0.17.2 check analysis/silage-harvest-response`, `uv run --with pyright==1.1.414 --with pytest==9.1.1 --with-requirements analysis/silage-harvest-response/silage-harvest-response.py pyright analysis/silage-harvest-response`, `uv run --with pytest==9.1.1 --with-requirements analysis/silage-harvest-response/silage-harvest-response.py pytest analysis/silage-harvest-response/`.
