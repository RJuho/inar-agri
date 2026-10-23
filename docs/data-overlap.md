# Shared variables and plant growth data

This report tells which variables the six sites share and which data shows plant growth. Sources: `docs/data-dictionary.md`, `docs/harmonised-database.md` and DuckDB checks on the files in `data/` (2026-10-21).

Site codes: Ant = Anttila, Sar = Särkisuo, Hal = Haltiala, Qvi = Qvidja, Vii = Viikki, Mkt = Maktau.

## 1. Shared variables (30-minute time series)

| Variable | Ant | Sar | Hal | Qvi | Vii | Mkt | Sites |
|---|---|---|---|---|---|---|---|
| NEE / CO2 flux (core DB) | ✓ | ✓ | ✓ | ✓ | ✓ mg CO2 | ✓ `FC` | 6 |
| Air temperature (core DB) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |
| Soil temperature (core DB) | ✓ 3 sensors | ✓ 3 sensors | ✓ 10 cm | ✓ 5, 30 cm | ✓ pit, 5 depths | ✓ 10 to 50 cm | 6 |
| Soil water content (core DB) | ✓ | ✓ | ✓ 10 cm | ✓ 10 cm | ✓ WC / WFPS | ✓ | 6 |
| PAR / PPFD | ✓ | ✓ | ✓ | – | ✓ | ✓ 1-hour file | 5 |
| SW_IN (global radiation) | ✓ | ✓ | – | ✓ | ✓ | ✓ | 5 |
| RH | ✓ | ✓ | – | ✓ | ✓ | ✓ | 5 |
| VPD | from TA and RH | from TA and RH | ✓ | ✓ | from TA and RH | ✓ | 6 (3 calculated) |
| Precipitation | ✓ | ✓ | – | ✓ | ✓ | ✓ | 5 |
| SW_OUT, LW, net radiation | ✓ | ✓ | – | ✓ SW_OUT, NETRAD | ✓ | ✓ | 5 |
| Wind, USTAR | – | – | – | ✓ | WS, WD | ✓ | 3 |
| Air pressure | ✓ | ✓ | – | – | ✓ | ✓ | 4 |
| LE / H | ✓ | ✓ | – | ✓ | – | ✓ (LE often -9999) | 4 |
| Soil heat flux | ✓ | ✓ | – | – | column almost empty | ✓ `G` | 3 |
| GPP / Reco (partitioned) | ✓ | ✓ | – | ✓ | – | – | 3 |
| N2O flux | ✓ | ✓ | – | – | ✓ | – | 3 |
| Snow depth | ✓ | ✓ | – | – | ✓ | – | 3 |
| CH4 flux | ✓ | ✓ | – | – | – | – | 2 |
| Water table | 2022, empty | – | – | – | ✓ | ✓ `WTD` | 2 |
| Soil water potential | – | – | – | – | ✓ `MP` | ✓ `SWP` | 2 |

Haltiala limits the overlap. It has only NEE, TA, PPFD, VPD, TS and SWC. Qvidja has no PAR. The next shared set is PPFD or SW_IN, RH or VPD, and precipitation: five or six sites each. `docs/harmonised-database.md` already lists these as the next nullable columns.

## 2. Plant growth data

### Direct vegetation measurements: Maktau only

- `NDVI_1_1_1` in `Continuous_KE-Mkt.csv`: 41 861 half-hour values, 2018-12 to 2024-09. Almost full years 2019 to 2022. 2023 has 1 585 values and 2024 has 4 951 values. `NDVI_2_1_1` has only 2 069 values.
- The same file has spectral NIR in and out (`SPEC_NIR_*`) and canopy temperature (`T_CANOPY_1_1_1`). The `APAR`, `FAPAR` and `FIPAR` columns hold only -9999.
- `Ancillary_KE-Mkt.csv`: canopy height (0 to 253 cm) and LAI (0 to 8), 18 values each. The file gives no dates for these values.

No Finnish site has NDVI, LAI, canopy height or a biomass time series.

### Harvest and yield records

- **Qvidja** (`Qvidja_management.xlsx`): harvest amount in kg/ha with a DM fraction per cut, 2018 to 2024 (no rows for 2025). Sums of amounts above zero per year: 2018 2 054, 2019 10 359, 2020 6 885, 2021 3 526, 2022 2 639, 2023 1 841, 2024 3 937 kg/ha. Rows with amount 0 are cleaning cuts (`puhdistusniitto`). The file also has grazing (animal, days) and fertilisation. Make sure that `Amount` is fresh mass before you multiply it by the DM fraction.
- **Haltiala** (`haltiala_smear_management.xlsx`): 37 rows, 2021 to 2025. Harvest values: 2021 7 187 kg DW/ha (3 595 kg C/ha, barley, manual plots), 2022 6 903 kg DW/ha grain (3 452 kg C/ha, oats, straw left), 2025 3 608 kg DW/ha (oats, no C value). 2023: manure 2 × 10 m3/ha, grass failed, no harvest. 2024: sunflower crushed, no harvest. The parcel card PDF (`haltiala_smear_Lohkokortit_2025.pdf`) repeats the 2025 yield (117 260 kg on 32.5 ha). The carbon values are in `scripts/lib/calc/management.ts`.
- **Viikki** (`EC/Management Information.docx`): one table row per year, 2022 to 2025: crop, N source and N input (kg N/ha), application dates, harvest dates, tillage dates, yield (kg DW/ha): 2022 3 673 (timothy), 2023 6 773 (barley, clover and grasses), 2024 2 336 (silage), 2025 1 973.7 (faba beans).
- **Maktau**: text only (stover burning, weeding, ploughing). Räsänen et al. 2026 give the sowing and harvest days of the 2019 long rains and the harvest of 2020.
- **Anttila, Särkisuo**: no management file. Shurpali et al. 2025 give the 2022 events (fertilisation in kg N/ha, two cuts, herbicide, ditch work) and the annual yield of 2022.

The dated events of the Haltiala, Qvidja and Viikki files (and of the 2025 parcel card and Heimsch et al. 2021 for Qvidja 2018 to 2019), and the dated events of the articles for Anttila, Särkisuo, Maktau and Viikki, are in `db/events.parquet`, from `scripts/lib/events.ts`. See `docs/harmonised-database.md`.

### Indirect growth indicators

- GPP: columns at Ant, Sar and Qvi. For Hal and Vii, flux partitioning of NEE with PPFD and TA can give GPP.
- Seasonal NEE uptake and cumulative NEE. The website shows both now.
- Albedo (SW_OUT / SW_IN) changes with canopy cover: Ant, Sar, Qvi, Vii, Mkt.
- No site measures reflected PAR, thus a PAR-based NDVI is not possible.

## 3. Conclusions

1. After the four core variables, the best shared set is PPFD or SW_IN, RH or VPD, and precipitation.
2. Measured vegetation data (NDVI, LAI, canopy height) is available for Maktau only.
3. For the Finnish sites, use GPP and the harvest records. Qvidja has yield per cut for seven years. Haltiala has one yield value (2021).
