# Fertilisation or weather

Question: does GPP change more after a fertilisation than the weather of the same days explains? Article: https://inar.rjuho.dev/deep-dive/fertilisation-weather/

Data: the harmonised database snapshot of 2026-10-23 (`builtAt` 2026-10-23T19:03:07.928Z), `db/*.parquet` and `data/calculated/daily.parquet`. The release asset `db-2026-10-23.zip` is not yet published (TODO). The script docstring gives the SHA-256 of each input file.

Run (from the repository root): `uv run analysis/fertilisation-weather/fertilisation-weather.py --db db --calculated data/calculated`; check against the committed results: add `--check`.

Develop: `uvx ruff@0.17.2 format analysis/fertilisation-weather && uvx ruff@0.17.2 check analysis/fertilisation-weather`, `uv run --with pyright==1.1.414 --with pytest==9.1.1 --with-requirements analysis/fertilisation-weather/fertilisation-weather.py pyright analysis/fertilisation-weather`, `uv run --with pytest==9.1.1 --with-requirements analysis/fertilisation-weather/fertilisation-weather.py pytest analysis/fertilisation-weather/`.
