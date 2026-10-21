# INAR agri

A harmonised eddy-covariance database and a browser tool for six agricultural flux sites.

> **Notice.** All code in this repository was written by Claude Code. A human reviewed it. The purpose of this codebase is to show how to use agentic coding for fast-phase data analysis.

## Made for

This tool was made for the University of Helsinki Autumn School 2026 on [Analysis of Atmosphere-Surface Interactions and Feedbacks](https://www.atm.helsinki.fi/peex/index.php/portfolio-items/autumn-2026-school-on-analysis-of-atmosphere-surface-interactions-and-feedbacks/).

## Start with Claude Code

This project is also a demo of modern tools for data work. Claude Code runs in a dev container. Thus Claude can access only the project files, not your computer.

1. Install [Visual Studio Code](https://code.visualstudio.com/) and [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Open the project folder in VS Code. Run the command "Dev Containers: Rebuild Container". VS Code also shows a prompt for this when you open the folder.
3. In the container terminal, download or update the agent skills:

   ```sh
   npx skills experimental_install   # install the skills in skills-lock.json
   npx skills update                 # update the skills
   ```

4. Start Claude Code:

   ```sh
   claude --allow-dangerously-skip-permissions
   ```

   This is safe enough here, because all commands run inside the container.

Then ask Claude a question, for example: "Is all datasets where they should be?"

## Sites

| Site | Code | Ecosystem | Data |
|---|---|---|---|
| 👱🏻‍♂️🫛 Anttila | FI-Ant | Legume grassland | 2022-2023 |
| 🧚🌾 Haltiala | | Cropland: barley, oats, grass, sunflower, oats | 2021-2025 |
| 🐟🌱 Särkisuo | FI-Sar | Mixed grasses | 2022-2023 |
| 🐂🐝 Qvidja | | Forage grassland. Intensive management until 2017, then more sustainable practices | 2018-2025 |
| 👩🏻‍🔬🎓 Viikki | | Grassland in rotation (Datacloud, SmartSMEAR) | 2022-2025 |
| 🇰🇪🌽 Maktau | KE-Mkt | Maize, Taita region, Kenya | 2018-2024 |

All sites are in Finland, except Maktau. The Finnish sites use local time UTC+2. Maktau uses UTC+3.

## The data is not in this repository

The folders `data/` and `db/*.parquet` are not in git. The repository holds all information about how the data was handled:

- [`docs/data-dictionary.md`](docs/data-dictionary.md): every file, every column, the unit and one example value.
- [`docs/harmonised-database.md`](docs/harmonised-database.md): the design of the harmonised database and the rules of the build.
- [`docs/data-overlap.md`](docs/data-overlap.md): the variables that the sites share, and the plant growth data (Maktau NDVI and LAI, harvest records of Qvidja and Haltiala).
- [`scripts/lib/registry.ts`](scripts/lib/registry.ts): the registry of sites, files and column mappings.
- [`db/report.md`](db/report.md) (also [`db/report.json`](db/report.json)): the data report of the last build. It gives the row counts, the gaps, the conflicts and the warnings per site and file.

To build the database, put the source files in `data/` as the tree below shows, then run `npm run build:db`. The build reads only the files marked with `*`. The other files are metadata and reports. The data dictionary describes all of them.

```text
data/
├── Anttila/
│   ├── EC_flux_L3_final_FI-Ant_2022.csv       *
│   ├── EC_flux_L3_final_FI-Ant_2023.csv       *
│   ├── biomet_final_30min_FI-Ant_2022.csv     *
│   └── biomet_final_30min_FI-Ant_2023.csv     *
├── Haltiala/
│   ├── haltiala.csv                           *
│   ├── ReadMe.md
│   ├── haltiala_smear_management.xlsx
│   ├── haltiala_smear_Lohkokortit_2025.pdf
│   └── geodata/
│       ├── haltiala.shp  (+ .shx .dbf .prj .cpg .qmd)
│       ├── haltiala.gpkg
│       └── haltiala_ec_tower_coords.txt
├── Maktau/
│   ├── Continuous_KE-Mkt.csv                  *
│   ├── Maktau_meteo_30_min_KE-Mkt.csv         *
│   ├── Maktau_meteo_1_hour_KE-Mkt.csv
│   ├── Ancillary_KE-Mkt.csv
│   └── BADM-Site-General-Info-KE-Mkt.xlsx
├── Qvidja/
│   ├── Qvidja_2018-2025.csv                   *
│   ├── Qvidja_management.xlsx
│   ├── Qvidja-readme.xlsx
│   ├── Qvidja.pdf
│   └── Qvidja_C-balance.pdf
├── Särkisuo/
│   ├── EC_flux_L3_final_FI-Sar_2022.csv       *
│   ├── EC_flux_L3_final_FI-Sar_2023.csv       *
│   ├── biomet_final_30min_FI-Sar_2022.csv     *
│   └── biomet_final_30min_FI-Sar_2023.csv     *
└── Viikki/
    ├── EC/
    │   ├── 2022.csv                           *
    │   ├── 2023.csv                           *
    │   ├── 2024.csv                           *
    │   ├── 2025.csv                           *
    │   └── Management Information.docx
    ├── pit1_cleaned_2023.csv                  *
    ├── pit1_cleaned_2024.csv                  *
    ├── pit1_cleaned_2025.csv                  *
    └── pit1_metadata.txt
```

## What is in the repository

- **Build script.** DuckDB reads, cleans and merges the six source layouts in SQL. Valibot validates the registry, the headers and every output row. `npm run build:db` writes the Parquet files to `db/`.
- **Harmonised database.** One row per site and 30-minute period. Columns: NEE, gap-filled NEE, QC flag, air temperature, soil temperature and soil water content. A small table gives the geolocation of each site.
- **Website** (`site/`). A static Astro site. Apache ECharts draws the diagrams. DuckDB-WASM reads the Parquet files in the browser and runs all SQL there. There is no server.

## Commands

```sh
npm install
npm run build:db     # build the Parquet files in db/
npm run site:dev     # start the website in development mode
npm run site:build   # build the static site to site/dist/
npm run test:e2e     # run the Playwright tests
npm run deploy       # deploy to Cloudflare Workers
```

## How the code was made

Claude Code wrote the code and the docs from the instructions in [`CLAUDE.md`](CLAUDE.md). That file is the project brief and is part of the deliverable. The prose uses ASD-STE100 Simplified Technical English.
