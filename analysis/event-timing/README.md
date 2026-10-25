# Management events on the flux timeline

Question: at each site, how do the recorded dates of the management events sit against the change of daily GPP, Reco and NEE, and against the crop calendar of field crop production? Article: https://inar.rjuho.dev/deep-dive/event-timing/

Data: the harmonised database snapshot of 2026-10-23 (`builtAt` 2026-10-23T19:03:07.928Z), `db/*.parquet` and `data/calculated/daily.parquet`. The release asset `db-2026-10-23.zip` is not yet published (TODO). The script docstring gives the SHA-256 of each input file. Second dates of some events from other sources are typed in the script (`ALTERNATIVE_DATES`, with the source and the page). The crop calendar comes from the book *Peltokasvien tuotanto* (Seppänen et al. 2016; `LITERATURE`, with the section and the printed page).

Run (from the repository root): `uv run analysis/event-timing/event-timing.py --db db --calculated data/calculated`; check against the committed results: add `--check`.

Develop: `uvx ruff@0.17.2 format analysis/event-timing && uvx ruff@0.17.2 check analysis/event-timing`, `uv run --with pyright==1.1.414 --with pytest==9.1.1 --with-requirements analysis/event-timing/event-timing.py pyright analysis/event-timing`, `uv run --with pytest==9.1.1 --with-requirements analysis/event-timing/event-timing.py pytest analysis/event-timing/`.
