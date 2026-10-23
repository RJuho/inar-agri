# Calculated flux products (`data/calculated/`)

The website page `/calculated/` shows a summary of this document with the formulas and the result tables. This document describes `scripts/calc.ts`: what it calculates, which formulas and parameters it uses, which assumptions it makes, and how to check the result. Run it with `npm run calc`. The output folder `data/calculated/` is not in git; the script makes it from `db/*.parquet` in about 7 seconds. The run writes `data/calculated/report.md` with all counts, fit diagnostics and validation tables.

## 1. Source article and scope

Hu, T., Malone, S. L., Rumpel, C. and Chabbi, A. (2024). *Maximizing soil organic carbon stocks through optimal ploughing and renewal strategies in (Ley) grassland.* Communications Earth & Environment 5, 38. https://doi.org/10.1038/s43247-024-01202-3. Local copies: `data/s43247-024-01202-3.pdf` and `.htm`.

The article is a model study (DailyDayCent) of the Lusignan site in France. Its Methods give these equations (their numbering):

| Eq. | Formula | Terms |
|---|---|---|
| 1 | NECB = NEE + C_exo − C_harvest − C_D − C_fire − C_volatile − C_CH4 − C_erosion | Net ecosystem carbon balance after Smith et al. 2010. C_exo = carbon in manure and organic fertiliser. C_harvest = carbon exported in grain, straw or cut grass. C_D = dissolved carbon leached. C_CH4 = carbon lost as methane. |
| 2 | NECB = NEE − C_harvest | The article drops the small terms. |
| 3 | NEE = NPP − Rh | Net primary production minus heterotrophic respiration. |
| 4 | NECB = NPP − Rh − C_harvest | |
| 5 | C_input = NPP − C_harvest | Carbon that enters the soil. |
| 6 | NECB = C_input − Rh | |
| 7 | RCB = NECB − SCB | Residue carbon balance = NECB minus the soil carbon balance. |

The article also names its flux methods: a u* threshold of 0.10 m s-1, the plausibility limit −50 < NEE < 50 µmol m-2 s-1, gap filling after Reichstein et al. 2005, and the comparison of daily and monthly NEE totals.

What the script calculates from our eddy-covariance data:

1. **GPP and Reco** (gross primary production and ecosystem respiration) with the night-time method of Reichstein et al. 2005, for all six sites. Haltiala, Viikki and Maktau had no partitioning before. Anttila, Särkisuo and Qvidja have a partitioning from the data provider; the script uses it to validate its own result.
2. **Gap-filled NEE for Maktau** (quality filter, u* filter, MDS gap filling). Maktau had no gap-filled NEE before.
3. **Daily, monthly and annual sums** of NEE, GPP and Reco in g C m-2, with the measured fraction and the longest gap, and the annual uncertainty of Haltiala from its ten gap-filling models.
4. **NECB per site and year** (Eq. 1 without the terms we cannot measure) with a carbon table of harvests and organic inputs.

What the script cannot calculate: NPP, Rh, C_input (Eq. 3 to 6) and SCB, RCB (Eq. 7). These need a soil model or repeated soil carbon samplings. The data folder has one soil carbon stock only (Qvidja, October 2018: 16.59 ± 2.25 kg C m-2 in the top 1 m, Heimsch et al. 2021). C_D, C_fire, C_volatile and C_erosion are not measured at any site.

## 2. Sign conventions

| Quantity | In the data files | In `data/calculated/` |
|---|---|---|
| NEE | Positive = emission to the atmosphere (all sites) | Positive = emission |
| GPP | Anttila, Särkisuo: GPP ≥ 0. Qvidja: GPP ≤ 0 (uptake negative) | GPP ≥ 0 = uptake. `gpp_src` of Qvidja has the sign changed |
| Reco | Positive | Positive |
| NEE, GPP, Reco relation | Anttila, Särkisuo: NEE = Reco − GPP exactly. Qvidja: NEE ≠ GPP + RECO (daytime model, residual ±3.6 µmol m-2 s-1) | NEE_f = Reco − GPP in every row |
| NECB, Hu et al. 2024 | NEE positive = uptake, NECB positive = carbon gain | Positive = the ecosystem gains carbon |
| NECB, Heimsch et al. 2024 (Qvidja paper) | NEE positive = emission, NECB positive = carbon loss | The validation table changes the sign of the paper values |

With our NEE sign, Eq. 1 reads:

```
NECB = -NEE - C_harvest + C_exo - C_CH4        (g C m-2 yr-1, positive = gain)
```

## 3. Inputs

`db/observations.parquet` (build with `npm run build:db`) with the core columns and the optional columns `sw_in`, `ppfd`, `rh`, `vpd`, `ustar`, `nee_ssitc`, `gpp_src`, `reco_src`, `ch4` (see `docs/harmonised-database.md`). The script reads three things from the raw files directly, because they are not harmonised: Haltiala `NEE_F1` to `NEE_F10`, and the Anttila and Särkisuo `E0_gf_ensemble_NT` and `Rref_gf_ensemble_NT` (validation only).

Derived inputs:

- Local time `tl = ts_start + utc_offset_min` (Finnish sites UTC+2, Maktau UTC+3). Days and years are local calendar days and years.
- Night flag: `sw_in < 10 W m-2`. Where `sw_in` is NULL and `ppfd` exists: `ppfd < 20 µmol m-2 s-1`. Haltiala has PPFD only; Särkisuo 2022 has few SW_IN values and uses PPFD in most rows. REddyProc uses the same 10 W m-2 limit plus the potential radiation; the script uses the measured radiation only.
- VPD: the file value where it exists (Haltiala, Qvidja, Maktau). Else from air temperature and relative humidity with the Magnus formula: `VPD = 6.1078 · exp(17.27 · T / (T + 237.3)) · (1 − RH / 100)` hPa. The report lists the rows per site.

All parameters are in `scripts/lib/calc/constants.ts`. The report and the Parquet metadata contain a copy.

## 4. Night-time partitioning (Reichstein et al. 2005)

Respiration follows Lloyd and Taylor (1994):

```
Reco(T) = Rref · exp( E0 · ( 1 / (Tref − T0) − 1 / (T − T0) ) )
Tref = 15 °C, T0 = −46.02 °C, T = air temperature (°C)
```

E0 (K) is the temperature sensitivity, Rref (µmol CO2 m-2 s-1) the respiration at 15 °C. The option `--temp tsoil` uses the soil temperature instead of the air temperature.

Steps per site and local calendar year (`scripts/lib/calc/partition.ts`), with the REddyProc defaults that we checked in `R/EddyPartitioning.R`:

1. **Night sample.** Rows with the night flag, a measured NEE (`nee_qc = 0`) and a temperature. At the sites with u* (Qvidja, Maktau), rows with `ustar < 0.10 m s-1` are left out; rows without a u* value stay. Negative night fluxes stay in the sample (REddyProc does the same).
2. **E0 from short windows.** Windows of 15 days (±7 days) every 5 days. A window needs more than 6 values and a temperature range of at least 5 K. The script fits Rref and E0 by least squares (Levenberg-Marquardt, `scripts/lib/calc/lloyd-taylor.ts`), drops the residuals outside the 5 to 95 % band and fits again (REddyProc "trimmed" fit). A window is valid when `E0 − SE > 30 K` and `E0 + SE < 350 K` (air temperature; 550 K for soil temperature). The year's E0 is the mean of the 3 valid estimates with the smallest standard error. Fallbacks, in this order: fewer than 3 valid windows → mean of the valid ones (`few_windows`); none → one fit on all nights of the year (`annual`); none → the E0 of the nearest year of the site that has one (`neighbour`); none → no Reco and GPP for the year (`none`).
3. **Rref from short windows.** Windows of 7 days (±3 days) every 4 days with E0 fixed. A window needs more than 2 values. Rref is the closed-form least-squares value `Rref = Σ(NEE · f) / Σ(f²)` with `f = exp(E0 · g(T))`. A negative Rref is not used. The value sits at the mean row of the window, and the script interpolates linearly between the window centres and holds the first and last values to the year edges. Rows farther than 14 days from a usable window get `reco_fqc = 2`.
4. **Temperature for every row.** Gaps in the air temperature are filled by linear interpolation up to 3 hours, then by the mean diurnal course (same time of day ±1 h, over ±7, ±14, ±30 days). `temp_fqc` 0 = measured, 1 = interpolated, 2 = diurnal course. A row without a temperature gets no Reco.
5. **Reco and GPP for every row.** `Reco = Rref(t) · exp(E0 · g(T))` and `GPP = Reco − NEE_f`. GPP is not forced to zero at night, so the identity `NEE_f = Reco − GPP` holds in every row (REddyProc does the same). The option `--gpp-night zero` sets GPP = 0 and Reco = NEE_f at night, as the Anttila and Särkisuo provider did.

### Worked example: Anttila, 2022

The 15-day window centred on 2022-07-02 has 45 night values with a temperature range of 13.3 K. The trimmed fit gives E0 = 264 ± 64 K and Rref = 5.51 µmol m-2 s-1 (status `ok`). The neighbouring window centred on 2022-07-07 gives E0 = 364 ± 64 K and is out of limits. The year has 72 windows, 29 are valid, and the mean of the 3 with the smallest standard error is **E0 = 111.1 ± 4.5 K**. (The provider's file gives E0 = 36.7 K for 2022; see section 9.)

With E0 fixed, the 7-day Rref window centred on 2022-07-03 has 9 values and gives Rref = 8.10 ± 2.22; the window centred on 2022-07-07 has 19 values and gives Rref = 4.63 ± 0.86. Between the two centres Rref is interpolated. For the row at 2022-07-05 03:00 local time with T = 12.0 °C: `g(T) = 1/61.02 − 1/58.02 = −0.000847`, `exp(111.1 · g) = 0.910`, so Reco = Rref · 0.910.

The night values of 2022-07-01 to 2022-07-15 (48 rows) have a mean temperature of 15.5 °C and a mean NEE of 6.55 µmol m-2 s-1, which is the respiration at 15 °C of that time of the year.

## 5. Maktau: quality filter, u* and gap filling

Maktau has a measured flux `FC` with the quality flag `FC_SSITC_TEST` and u*, but no gap-filled NEE. The script (`scripts/lib/calc/ustar.ts`, `scripts/lib/calc/mds.ts`):

1. Keeps rows with flag 0 or 1. Rows with a flux but no flag are rejected (they also have no u*). Rows with flag 2 are rejected.
2. Keeps `|FC| < 50 µmol m-2 s-1` (the article's limit; no row fails).
3. Keeps `u* ≥ 0.10 m s-1` (the article's threshold). The moving point test of Papale et al. 2006 (4 seasons, 6 temperature classes, 20 u* classes, plateau at 99 % of the next 10 classes, |corr(T, u*)| < 0.4) runs on every year and is written to `ustar_thresholds.csv`, but it is only applied with `--ustar mpt`. The night flux at Maktau is small (0.5 to 2 µmol m-2 s-1) and the test gives unstable values (0.09 to 0.39 m s-1 between years).
4. Fills the gaps between the first and the last kept flux with MDS (marginal distribution sampling, Reichstein et al. 2005 Fig. A1, REddyProc defaults): look-up tables with `sw_in ± 50 W m-2`, `ta ± 2.5 °C`, `vpd ± 5 hPa`, at least 2 values per look-up.

| Step | Window | `nee_fqc` |
|---|---|---|
| Look-up table, 3 drivers | ±7 days, then ±14 days | 1 |
| Look-up table, `sw_in` only | ±7 days | 1 |
| Mean diurnal course (same time ±1 h) | same day, ±1 day | 1 |
| Mean diurnal course | ±2 days | 2 |
| Look-up table, 3 drivers | ±21, ±28 days | 2 |
| | ±35 … ±70 days | 3 |
| Look-up table, `sw_in` only | ±14, ±21, ±28 days | 2 |
| | ±35 … ±70 days | 3 |
| Mean diurnal course | ±7 … ±210 days | 3 |

A row without VPD skips the 3-driver steps. Rows outside the measured period stay empty; the years 2014 to 2017 and 2025 have no flux at all. The MDS result of a long gap (Maktau 2021: 285 days, 2023: 199 days) is a model, not a measurement: `nee_fqc = 3` marks it and the annual table flags those years as not reliable. Maktau has no storage flux and no profile measurement.

Result of the run of 2026-10-21: 38 235 of 52 648 flux rows kept (10 480 without flag, 2 704 with flag 2, 1 229 below u*). MDS filled 61 988 rows (20 360 with qc 1, 10 863 with qc 2, 30 765 with qc 3).

At the other five sites the gap-filled NEE of the data provider is used. Viikki has 576 rows (2023) where the provider's gap-filled column is empty; the script fills them with MDS and marks them `nee_fill = mds`.

## 6. Daily, monthly and annual sums

One 30-minute value of 1 µmol CO2 m-2 s-1 is 1800 s × 12.011 µg C µmol-1 = 0.021620 g C m-2 (the same factor as the website's cumulative diagram). The sums use the gap-filled NEE (`nee_f`) and the calculated GPP and Reco, grouped by local day, month and calendar year. A sum is NULL when a row of the period has no value, so the annual table gives no partial sums (the daily table shows the partial days). Other columns: `n_measured` and `frac_measured` (measured NEE), `longest_gap_days` (longest run without a measured NEE), `reliable` (measured fraction ≥ 0.2 and longest gap ≤ 30 days), `n_qc3` (MDS rows of the lowest quality), `gpp_src_gc` and `reco_src_gc` (sums of the provider's partitioning where it exists).

Haltiala uncertainty (rule in `CLAUDE.md`): the script sums each of `NEE_F1` to `NEE_F10` per calendar year, then takes the sample standard deviation of the ten sums (`nee_f_sd10`) and `1.96 × SD` (`nee_f_ci95`). The mean of the ten sums equals `nee_f_gc` within 0.15 g C m-2 (validation table).

## 7. Management carbon table and NECB

`scripts/lib/calc/management.ts` holds the harvest and organic input events, transcribed from `data/Qvidja/Qvidja_management.xlsx`, the two Qvidja papers (`Qvidja_C-balance.pdf` = Heimsch et al. 2021, `Qvidja.pdf` = Heimsch et al. 2024), `data/Haltiala/haltiala_smear_management.xlsx` and `data/Viikki/EC/Management Information.docx`. The script checks every row with Valibot and writes `management_carbon.csv`. Rules:

- `dry_mass_kg_ha = fresh_kg_ha × dm_fraction`, or the dry mass given in the file.
- `c_g_m2 = dry_mass_kg_ha × c_fraction / 10`.
- Carbon fraction per site: Qvidja 0.42 (both Qvidja papers), Haltiala 0.50 (the xlsx gives kg C/ha equal to 0.50 × kg DW/ha), Viikki 0.42 as an assumption (`c_fraction_source = assumed`).
- Organic inputs without a carbon content (Qvidja compost, NPK mix, broiler litter, Soilfood fibre; Haltiala manure in m3/ha; Viikki manure in kg N/ha) get `c_g_m2 = NULL` and count as `n_exo_unknown`. The note of each row gives the size with an assumed 0.30 g C per g DM. The Qvidja molasses fertiliser of 2018 and 2019 has a carbon content in Heimsch et al. 2021 (205 g C per kg), and those paper values are used.
- Grazing events have no carbon value; the NECB note says "Grazing not quantified".
- Anttila and Särkisuo have harvest data for 2022 only: the annual yield (7.5 and 4.7 t DM/ha) and the grass carbon content (0.47) of Shurpali et al. 2025 (Table 4). For 2023 the table gives `NECB = −NEE − C_CH4`, `c_harvest` NULL and `necb_complete = false`. Maktau has no harvest data; the table gives no NECB.

Known problems of the sources, kept in the row notes: the Qvidja cut of 2018-06-12 is 615 kg/ha × 0.30 in the xlsx but 1 985 kg DW/ha in Heimsch et al. 2021 (the paper value is used); two Qvidja cuts have a DM fraction of 0.70 and 0.79, which can mean that the amount is already dry; the Haltiala 2025 yield can be a fresh grain weight. The Viikki docx gives the yields in kg DW/ha (2022 3 673, 2023 6 773, 2024 2 336, 2025 1 973.7).

NECB per site and local year (`necb.csv`):

```
necb = -nee_f_gc - c_harvest + c_exo - c_ch4
```

`c_ch4` is the annual sum of the gap-filled CH4 flux in g C m-2 (Anttila, Särkisuo). `necb_complete` is true only when the year is a full calendar year with a complete NEE_f, and no harvest, input or grazing row is unknown or assumed.

The Calculated page of the website shows `annual.csv` and `necb.csv` as a figure (`site/src/lib/budgetFigure.ts`, SVG made at build time): per site and full year, bars of Reco and C_harvest (positive, carbon leaves the field) and of GPP and C_exo (drawn negative, carbon enters the field), a circle at NEE and a diamond at −NECB (hollow when `necb_complete` is false), with lighter bars for years that are not reliable.

### Worked example: Qvidja, 2019

Harvests: 2019-06-10, 7 652 kg/ha × 0.406 = 3 107 kg DM/ha; 2019-08-21, 2 707 kg/ha × 0.38 = 1 029 kg DM/ha. `c_harvest = (3 107 + 1 029) × 0.42 / 10 = 173.7 g C m-2`. Organic input: 2019-05-08, molasses fertiliser, 43 g C m-2 (paper value). Annual NEE_f 2019 = −246.7 g C m-2 (uptake). `NECB = 246.7 − 173.7 + 43.0 = +116.0 g C m-2`: the field gained carbon. `necb_complete = true`.

## 8. Outputs

All files are in `data/calculated/`. CSV: UTF-8, header row, comma delimiter, point decimal mark, empty field = NULL. Parquet: ZSTD, key/value metadata `built_at`, `generator`, `design`, `options`, `constants` and `unit_<column>`.

| File | Grain | Content |
|---|---|---|
| `fluxes_30min.parquet` | site, 30 min | `site_id`, `site_code`, `ts_start` (UTC), `tl` (local), `yr`, `mo`, `night`, `nee_qc_src`, `nee` (measured, after the Maktau filter), `nee_f`, `nee_fqc` (0 measured, 1 to 3 as in section 5; 1 for the provider's gap filling), `nee_fill` (measured, source, mds), `ta`, `tsoil`, `sw_in`, `ppfd`, `vpd`, `ustar`, `temp_f`, `temp_fqc`, `reco`, `gpp`, `rref`, `e0`, `reco_fqc`, `gpp_fqc`, `gpp_src`, `reco_src`, `ch4` |
| `daily.csv`, `daily.parquet` | site, local day | sums and counts of section 6 |
| `monthly.csv` | site, local month | same |
| `annual.csv` | site, local year | same plus `full_year`, `longest_gap_days`, `reliable`, `nee_f_sd10`, `nee_f_ci95` |
| `necb.csv` | site, year | section 7 |
| `management_carbon.csv` | event | section 7 |
| `partition_params.csv` | site, year | E0, SE, method, window counts, Rref range |
| `e0_windows.csv`, `rref_windows.csv` | window | every window with its fit and status (`centre_day` = days since 2000-01-01, local) |
| `ustar_thresholds.csv` | Maktau year, season | moving point test results and the applied threshold |
| `validation_partition.csv`, `validation_qvidja.csv`, `validation_haltiala.csv` | | section 9 |
| `report.md`, `report.json` | | all of the above in one report |

Units: fluxes in µmol CO2 m-2 s-1 (CH4 in µmol CH4 m-2 s-1), sums in g C m-2, E0 in K, Rref in µmol CO2 m-2 s-1, temperatures in °C.

## 9. Validation (run of 2026-10-21)

**Against the data providers** (`validation_partition.csv`). The calculated annual GPP and Reco of Anttila are within 1.2 % of the provider's night-time partitioning (2022: GPP 1 270 vs 1 259, Reco 1 021 vs 1 010 g C m-2; 2023: 1 374 vs 1 378 and 1 091 vs 1 095). The half-hourly RMSE is 0.7 to 1.2 µmol m-2 s-1 and the bias below 0.03. The interpolated Rref correlates with the provider's Rref at r = 0.97 to 0.98. The E0 values differ (ours 111 and 98 K, the provider's 36.7 and 85.4 K): E0 and Rref compensate each other in the annual sums. Särkisuo 2022 is 5 % below the provider; Särkisuo 2023 has no annual sum because the air temperature has an 84-day gap.

Qvidja is 15 to 31 % below the provider's GPP and Reco. The provider used a daytime method whose Reco at night is about 55 % above the measured night NEE (summer rows with `nee_qc = 0`: measured 4.6, provider's Reco 7.3 µmol m-2 s-1, and the provider's GPP is 2.9 at night). The night-time method follows the measured night flux by construction. The difference is a known difference between the two method families; it is reported, not corrected.

**Against Heimsch et al. 2024, Table 1** (`validation_qvidja.csv`, years from 4 May). Our NEE sums from the current Qvidja file are 35 to 110 g C m-2 more negative than the paper (for example 2019-20: −232 vs −190). The file is a later processing version than the paper (readme: neural-network gap filling). The GPP and Reco of the provider's file agree with the paper within 5 %; ours are lower by the method difference above. The NECB cannot be compared one to one: the paper includes the carbon of grazing.

**Haltiala** (`validation_haltiala.csv`). The annual `nee_f_gc` equals the mean of the ten model sums within 0.15 g C m-2 in every year. The annual values (2021 partial year: 59.8; 2022: −271.2; 2023: 131.3; 2024: −47.0; 2025: −3.9 g C m-2) match the website's cumulative diagram.

**Internal checks** in the report: `nee_f = reco − gpp` holds in every row; E0 is inside 30 to 350 K; Reco is never negative; the night mean |GPP| is reported per site when above 1 µmol m-2 s-1.

## 10. Risks and open questions

- Viikki measures NEE in about 20 % of the periods. The E0 windows are few (11 to 16 valid of 72) and the Rref interpolation spans long gaps in winter. Haltiala and Anttila have 30 to 60 valid windows.
- Maktau: only 2019 is nearly complete. 2018 and 2023 take E0 from a neighbour year; 2023 has no Reco because the few measured nights (July and August 2023) have a negative NEE and every Rref window is negative. 2020, 2022 and 2024 have long gaps and are not reliable.
- Anttila, Särkisuo, Haltiala and Viikki have no u* in the files. The providers filtered the measured NEE; the script trusts their quality flag.
- Särkisuo 2023: air temperature gap of 84 days (May to August). `--temp tsoil` is an option, but the soil temperature has the same gap.
- NECB is a lower bound in years with an organic input of unknown carbon content (Qvidja 2020 to 2023, Haltiala 2023, Viikki 2023 and 2024). A compost application of 34 500 kg/ha × 0.48 DM can hold about 500 g C m-2, more than the annual NEE.
- The Viikki C fraction (0.42) is assumed; the Haltiala 2025 yield may be fresh weight; two Qvidja DM fractions are suspect. These rows are marked `assumed` or noted.
- The provider's E0 of Anttila 2022 (36.7 K) is close to the lower limit of the method. Our 111 K is the mean of windows with a wide range (74 to 364 K). The annual sums are robust to this; the seasonal course of Reco is less certain.

## 11. How to run and test

```
npm run build:db          # db/*.parquet with the optional columns
npm run calc              # data/calculated/*
npm run calc -- --sites haltiala,viikki --years 2022-2023
npm run calc -- --ustar mpt --temp tsoil --gpp-night zero --out /tmp/calc-test
npm run test:unit         # node --test scripts/lib/calc/*.test.ts (fitter, windows, MDS, u*)
npm run typecheck
```

Read `data/calculated/report.md` after a run: the partition table, the Maktau filter counts, the annual and NECB tables, the validation tables and the warnings.

To add a management event: add a row to `MANAGEMENT_CARBON` in `scripts/lib/calc/management.ts` with the source file and a note, then run `npm run calc`. To change a parameter: edit `scripts/lib/calc/constants.ts` only; the report prints the constants.
