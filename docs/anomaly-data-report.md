# Anomaly report: site variables (scan of 2026-10-21)

Status: report of 2026-10-21. Input: `db/observations.parquet`, built 2026-10-21 11:18 UTC. Scope: the 22 harmonised columns of the 24 website variables (`gpp` and `reco` are calculated by `scripts/calc.ts` and have no raw column). No data was changed. No correction was made. Update 2026-10-22: QVI-01 resolved; the Qvidja `swc` is now converted from volts to m³ m⁻³ (the numbers of QVI-02 and QVI-03 are raw `SM` values in V). New finding QVI-16 (2026-10-22): 17 950 Qvidja `swc` values in frozen soil, open. Related documents: `docs/qvidja-soil-moisture.md` (the Qvidja `SM` unit) and `docs/harmonised-database.md` (build rules and known problems).

## Summary

- Time axis (S1): the raw time stamps of Anttila, Särkisuo and Viikki are UTC and mark the period start. The build reads them as UTC+2. All data of these three sites sits 2 hours early on the website, in `ts_start` and in the data export. The daily radiation peak is at local hour 10, not 12 (ANT-01, SAR-01, VII-01).
- Qvidja `swc` (S1, resolved 2026-10-22): `SM` is the ML3 sensor output in volts (provider confirmed). The build converts it to m³ m⁻³ with the ML3 manual polynomial for mineral soil (QVI-01, `docs/qvidja-soil-moisture.md`).
- Qvidja `swc` in frozen soil (S2, open, added 2026-10-22): the ML3 manual (p. 28) says that readings below 0 °C are not reliable. 17 950 values (14.5 %) have `tsoil` ≤ 0 °C. The build keeps them. A rule (`swc` NULL where `tsoil` ≤ 0 °C) is not decided (QVI-16).
- Qvidja end of 2025 (S2, new): from 2025-11-01 the soil probes follow the air temperature and the net radiation is positive at night, to about 2025-12-22. `sw_out` is missing from 2025-10-26 to 2025-12-28 (QVI-12).
- Qvidja NEE (S2, open): the annual NEE sums of the file are 25 to 109 g C m-2 more negative than Heimsch 2024 Table 1. The file is probably a different processing version (QVI-11). Qvidja GPP and Reco come from a daytime method and do not close with NEE (QVI-07).
- Viikki N2O (S1 if wrong, open): the header unit `ug m-2 s-1` can be µg N2O or µg N2O-N. The build assumes µg N2O. The 2022 sum is 16.8 kg N2O ha-1 after 108 kg N ha-1 (VII-06).
- Maktau (S2): `FC` repeats one value for up to 25 periods in 2024-04 to 2024-07, 11 % of the 2024 NEE values (MKT-03). The logger stored day-time rows only from 2023-07 to 2024-01 (MKT-01). Day-time `ta` in 2024 is 1.5 to 2.8 °C above the earlier years; the sonic temperature of the EC system shows the same rise, so the warm 2024 is probably real (MKT-08).
- Haltiala `swc` 2021 (S2, open): the level is 0.06 to 0.10 above the later years (HAL-03).
- Radiometers (S3 for winter sums): the CNR4 night offset at Anttila stepped from −1 to −5 W m-2 on 2022-10-14, and at Särkisuo to −6 W m-2 from 2023-08-08. Viikki has −7 W m-2 at night (ANT-02, SAR-02, VII-02).

Findings per site and severity (counts of findings, not of flags):

| Site | S1 | S2 | S3 | S4 | Findings | Of which new |
|---|---:|---:|---:|---:|---:|---:|
| Anttila | 1 | 0 | 3 | 4 | 8 | 1 |
| Särkisuo | 1 | 1 | 3 | 2 | 7 | 2 |
| Haltiala | 0 | 1 | 0 | 4 | 5 | 0 |
| Qvidja | 1 | 7 | 3 | 5 | 16 | 4 |
| Viikki | 2 | 0 | 2 | 4 | 8 | 2 |
| Maktau | 0 | 3 | 4 | 2 | 9 | 5 |
| Total | 5 | 12 | 15 | 21 | 53 | 14 |

A finding with two severities counts at the higher one (ANT-02, SAR-02, SAR-04, VII-06, MKT-08). "New" = status new, with the part-new findings QVI-04 and QVI-08, and QVI-16 (open, added 2026-10-22).

## Method

The scan script `scripts/scan-anomalies.ts` (`npm run scan:anomalies`, 5 s) reads `db/observations.parquet` and runs 16 checks per site and variable. All checks use the harmonised units and the site local time. The thresholds are in `CHECKS` in the script and in `data/anomaly-scan/checks.json` (with the SQL of each check). The output folder `data/anomaly-scan/` is not in git.

| Check | Rule (short) |
|---|---|
| A range | Value outside physical bounds (for example `ta` −40 to 35 °C in Finland, 5 to 45 °C at Maktau; `rh` 5 to 103 %; `swc` 0.02 to 0.8; `sw_in` −10 to 1 000 W m-2; `precip` 0 to 30 mm per 30 min). |
| B stuck value | The same value in 48 or more consecutive periods (12 for `ta`, `rh`, `ws`, `nee`). Night zeros of radiation and heat fluxes are not flags. |
| C step | One period that differs from both neighbours in the same direction by more than a step (for example `ta` 6 °C, `tsoil` 2 °C, `pa` 0.5 kPa, `le` 300 W m-2). |
| D level shift | Monthly median (day and night apart) more than 5 MAD and a minimum difference away from the same calendar month of the other years. Ratios `ppfd/sw_in`, `netrad/sw_in`, `sw_out/sw_in` against the other sites. |
| E fill values | A value with a share above 5 %, fewer than 200 distinct values in a year, exact 0 in `ta`, `rh`, `pa`, `swc`, `tsoil`, `ws`, negative values where the variable cannot be negative. |
| F cross-variable | F1 `sw_out > sw_in`; F2 daily `ppfd/sw_in` outside 1.6 to 2.4; F3 `rh > 103`; F4 `vpd` against the Magnus formula; F5 `nee ≠ nee_f` where `nee` is measured; F6 `nee_f ≠ reco_src − gpp_src`; F7 night `nee_f < −1` or `gpp_src > 0.5`; F8 midday `netrad/sw_in` outside 0.45 to 0.85; F9 monthly correlation of `tsoil` with `ta` and of `le` with `netrad` below 0.5. |
| G time axis | Local hour of the daily radiation peak against solar noon (12 + UTC offset − longitude / 15), against the site median (clock jump), and the first hour with radiation against the astronomical sunrise. Flag at 0.75 h. |
| H longest gap | Longest NULL run per site, variable and year. Information only. |
| I copied column | Two columns equal (not 0) in more than 1 % of the rows of a year. |
| J repeated day | A day whose 48 values of `nee_f` or `le` equal the day before. |
| K flat fill | Summer day with no measured `nee` and SD of `nee_f` below 0.2. |
| L annual sums | NEE, precipitation, CH4 and N2O sums per year with the coverage. Information only, compared with the articles. |
| M radiometer | Days with `sw_in` far below `ppfd / 2` in cold months (snow or dirt on one sensor), and runs of 5 or more days with `sw_in` below 30 W m-2. |
| N drift | Night median of `sw_in`, `ppfd` or `netrad` away from 0; monthly maximum of `rh` below 95 % in a wet month. |
| P coverage pattern | Months where the night coverage is less than half of the day coverage (day-only data gives biased means). |
| Q correlation drop | Annual correlation of sensor pairs (`sw_in`-`ppfd`, `ta`-`tsoil`, `sw_in`-`netrad`, `nee_f`-`ppfd`) more than 0.2 below the other years. |

The scan found 3 910 episodes (consecutive flagged periods merged; `data/anomaly-scan/summary.md` Table 1). Three agents then verified the flags of two sites each in the raw source files: for each flag group they ran a control query (the other years of the site, the same months at another site), looked at the raw rows at the start of the episode, and classified the cause. The reference values come from the articles in `data/articles/` (sensor types, time-zone statements, published annual sums and ranges). The J, K and Q checks gave no flags.

Each finding has a status and a severity. Status: new (found by this scan, not yet confirmed by the provider) | verified (confirmed in the raw file with a control) | known (already in the docs or an earlier check) | handled in build (a build rule removes it) | real event (physical, keep the data) | source artefact (behaviour of the provider's gap filling or partitioning) | open question (sent to the provider). Severity: S1 = all values of a column or a site are wrong (unit, sign, time axis); S2 = a stretch longer than one day, or a wrong annual sum; S3 = isolated periods, less than 1 % of a year; S4 = cosmetic.

## Findings table

Sorted by severity, then site. The details are in the site sections.

| ID | Site | Variable | Period | Check | Observed | Expected | Status | Severity | Effect | Next action |
|---|---|---|---|---|---|---|---|---|---|---|
| ANT-01 | Anttila | all | 2022 to 2023 | G | radiation peak at raw hour 10 | solar noon 12:11 UTC+2 | verified | S1 | all values 2 h early | build rule, ask provider |
| SAR-01 | Särkisuo | all | 2022 to 2023 | G | radiation peak at raw hour 10 | solar noon 12:11 UTC+2 | verified | S1 | all values 2 h early | build rule, ask provider |
| QVI-01 | Qvidja | swc | 2018 to 2025 | A, D | 0.369 to 0.98 | 0.16 to 0.55 m³ m⁻³ | known | S1 | wrong unit on website and export | wait for provider |
| VII-01 | Viikki | all | 2022 to 2025 | G | SWin centroid 10.1 to 10.4 raw | 12.1 to 12.2 for UTC+2 | new (verified) | S1 | all values 2 h early | ask provider, then build rule |
| VII-06 | Viikki | n2o | 2022, all years | D | 16.8 kg N2O ha-1 in 2022 | unit µg N2O or µg N2O-N | open question | S1 if wrong | factor 1.57 on all N2O | ask provider |
| SAR-04 | Särkisuo | tsoil | winter 2022-23 | B, E, F9 | 0.2 °C for 33 days in 2023-03 | zero curtain, or sensor floor | open question | S2 if sensor, S4 if real | flat winter tsoil | ask provider |
| HAL-03 | Haltiala | swc | 2021-05 to 2021-11 | D | medians 0.46 to 0.51 | 0.26 to 0.44 as later years | open question | S2 | 2021 not comparable | ask provider |
| QVI-03 | Qvidja | swc | winters 2021 to 2025 | D | drops of 0.3 to 0.4 in frozen soil | sensor physics (article) | known | S2 | low winter means | document |
| QVI-04 | Qvidja | rh, vpd | 2018-05 to 2021-10 | D, N, B | RH 46.3 % at −5 °C in 2021-02 | 80 to 95 % | known; new for 2021-01 to 06 | S2 | not comparable before 2021-10 | ask provider |
| QVI-07 | Qvidja | nee_f, gpp_src, reco_src | all years | F6, F7 | NEE ≠ Reco − GPP in 26 to 48 % | equal (night-time method) | known | S2 | budget bars do not add up | document |
| QVI-08 | Qvidja | precip | 2021-12-29 to 2022-05-24 | L | 437 of 7 056 periods | Kaarina fill (article) | known; new for the file | S2 | 2022 sum 388 mm incomplete | ask provider |
| QVI-11 | Qvidja | nee_f | 2018-19 to 2022-23 | L | NEE −99 to −232 g C m-2 | article +10 to −190 | open question | S2 | stronger sink than article | ask provider |
| QVI-12 | Qvidja | tsoil, netrad, sw_in, sw_out | 2025-10-26 to 2025-12-28 | N, C, D | tsoil follows ta; night netrad +9 | night netrad −6 to −29 | new | S2 | tsoil = air temperature | ask provider, build rule |
| QVI-16 | Qvidja | swc | winters 2018 to 2025 | none (manual) | 17 950 values with tsoil ≤ 0 °C | not reliable below 0 °C (ML3 manual p. 28) | open (decision pending) | S2 | winter swc too low | decide build rule |
| MKT-01 | Maktau | all meteo | 2023-07 to 2024-01 | P | night rows missing | full days | handled in build | S2 | day-time means | document |
| MKT-03 | Maktau | nee | 2024-04 to 2024-07 | B | FC equal in runs up to 25 | no repeated flux | new (verified) | S2 | 11 % of 2024 NEE | ask provider |
| MKT-08 | Maktau | ta, vpd | 2024-02 to 2024-11 | D | day ta +1.5 to 2.8 °C; T_SONIC rises too | day and night move together | open question | S2 if sensor, S4 if real | 2024 ta and vpd | ask provider |
| ANT-02 | Anttila | sw_in, sw_out, netrad | from 2022-10-14 | E, A, N, F2, M | night −5 W m-2 | 0 ± 2 W m-2 | new | S4; S3 for sums | winter daily sums too low | ask provider |
| ANT-03 | Anttila | reco_src | 12 periods 2022 to 2023 | A | Reco to −10.74 | Reco ≥ 0 | verified | S3 | 12 half hours | document |
| ANT-04 | Anttila | le | 2023-05-20, 2023-08-08 | C | 477 and 538 W m-2 | ≤ 385 | verified | S3 | 2 half hours | document |
| SAR-02 | Särkisuo | sw_in, sw_out | from 2023-08-08 | E, A, N, F2 | night −6 W m-2 | 0 ± 2 W m-2 | new | S4; S3 for sums | winter means too low | ask provider |
| SAR-03 | Särkisuo | ta, rh | 2023-10-17 09:30 raw | A, C | TA −39.18, RH 1.07 | 2 °C, 79 % | new | S3 | 1 half hour | build rule, ask provider |
| SAR-05 | Särkisuo | reco_src | 2022-01-25 | A | −17.3 | ≥ 0 | verified | S3 | 1 half hour | document |
| QVI-09 | Qvidja | 9 meteo columns | 2023-02-11 to 2023-03-01 | none | 6 columns NULL, 3 filled | known loss (article) | known | S3 | station values | document |
| QVI-10 | Qvidja | nee | 2019-01-05 to 2019-03-28 | none | 2.6 % measured | 21.5 % | known | S3 | nee_f is a model | document |
| QVI-13 | Qvidja | sw_in, sw_out, netrad | winters | M, A, F8, D | albedo > 1, netrad −343 | albedo ≤ 0.9 | verified | S3 | a few winter days | document |
| VII-04 | Viikki | tsoil | 2025-05, 08, 09 | C | spikes to 28.9 °C at 14 cm | daily range 2 to 4 °C | new (verified) | S3 | 340 periods | ask provider |
| VII-05 | Viikki | nee, nee_f | 2024 | F5, I, D | nee_f ≠ nee in 1 540 periods | copy of nee | known, verified | S3 | sum 20.4 vs 22.5 g C m-2 | ask provider |
| MKT-02 | Maktau | vpd | 2023-02 to 2024-02 | C | 6 396 values in fill rows | NULL | new (verified) | S3 | MDS driver | build rule |
| MKT-04 | Maktau | tsoil | 12 periods | A, C | 0.97 to 10.07 °C | ≥ 15 °C | new (verified) | S3 | minimum wrong | build rule |
| MKT-05 | Maktau | le | 2019 to 2022 | A, C | night 413 and −155 W m-2 | flag 2 removed | new (verified) | S3 | spikes | build rule |
| MKT-06 | Maktau | sw_in, netrad | 2018-04-06/07; 8 periods | A | 1 570 W m-2 | ≤ 1 100 | known, verified | S3 | one day 25 % too high | document |
| ANT-05 | Anttila | tsoil | winters | B, E, F9 | runs of 0.2 to 0.6 °C | zero curtain | real event | S4 | flat lines | document |
| ANT-06 | Anttila | gpp_src | winter, 2022-04 | B | GPP 0 by day | night-time method | source artefact | S4 | none | document |
| ANT-07 | Anttila | ppfd, sw_in | 2022 to 2023 | N, G | "night" ppfd 7 to 29 | 0 ± 5 after fix | verified | S4 | none beyond ANT-01 | rescan |
| ANT-08 | Anttila | nee_f, ch4, n2o | 2022 | L | NEE −249, N2O 3.85 | −250, 3.8 | verified | S4 | none | document |
| SAR-06 | Särkisuo | gpp_src | 2023-06, 2023-07 | F7 | night GPP > 0.5 in 49 % | 0 | verified | S4 | none beyond SAR-01 | rescan |
| SAR-07 | Särkisuo | nee_f, ch4, n2o | 2022, 2023 | L | NEE −53, CH4 10.35 | −50, 11 | verified | S4 | partial CH4 2022 | document |
| HAL-01 | Haltiala | swc | all | B, E | 36 distinct values | 3 decimals | source artefact | S4 | step curve | ask provider |
| HAL-02 | Haltiala | ppfd | from 2022-05 | E | 1.0 in evening hours | 0 | known | S4 | cosmetic | document |
| HAL-04 | Haltiala | tsoil | winters | F9 | flat near 0 °C | zero curtain | real event | S4 | none | document |
| HAL-05 | Haltiala | ta, tsoil, ppfd, nee | 40 months | D | regional weather | same at other sites | real event | S4 | none | document |
| QVI-02 | Qvidja | swc | 2022-11 to 2023-01 | A, B | ceiling 0.98 | sensor maximum | verified | S4 | flat maximum | ask with QVI-01 |
| QVI-05 | Qvidja | rh, vpd | from 2021-10 | A, F3 | RH to 104.54, VPD −0.84 | ≤ 100 | known | S4 | 1.2 % of periods | document |
| QVI-06 | Qvidja | rh, vpd | 2019-03, 2024-12 | B | 100.0 for 4 days | fog varies | verified | S4 | cosmetic | document |
| QVI-14 | Qvidja | ta, tsoil, sw_in, le, nee_f | 39 months | D | weather, management | events | real event | S4 | none | document |
| QVI-15 | Qvidja | all | 2018 to 2023 | none | every row twice | once | handled in build | S4 | none in Parquet | ask provider |
| VII-02 | Viikki | sw_in, sw_out | all nights | A, E, N | night −7 W m-2 | 0 | verified | S4 | winter means low | document |
| VII-03 | Viikki | tsoil | winters | B, E | 0.2 °C for 534 periods | zero curtain | real event | S4 | none | document |
| VII-07 | Viikki | ta, tsoil, swc, rh, sw_in | 68 months | D | weather | same at other sites | real event | S4 | none | document |
| VII-08 | Viikki | rh, ta | 2024 | B | 268 and 532 distinct values | 5 335 and 3 633 | source artefact | S4 | steps of 1 % and 0.1 °C | document |
| MKT-07 | Maktau | ws, wd | 2019 to 2022 | P | night zeros removed | calm nights | new (verified) | S4 | night ws high | document |
| MKT-09 | Maktau | rh, swc, tsoil, ta | wet months | D | rain seasons | real | real event | S4 | none | document |

## Findings per site

Raw stamp = the text in the source file. For Anttila, Särkisuo and Viikki the build subtracts 2 h (`ts_start` = raw stamp − 2 h).

### Anttila

Files: `data/Anttila/EC_flux_L3_final_FI-Ant_<year>.csv` (flux, stamp `time`), `data/Anttila/biomet_final_30min_FI-Ant_<year>.csv` (biomet, stamp `TIMESTAMP_1`). No file and no article states a time zone or a period convention.

#### ANT-01 all columns: raw stamps are UTC and mark the period start; the build treats them as UTC+2

- Source: all columns ← both files, `time` and `TIMESTAMP_1`
- Period: 2022-01-01 00:00 to 2023-12-31 23:30 (all rows of both years)
- Observed: the provider's potential radiation `SWIN_POT` peaks at raw stamp hour 10 in June (09 h 784, 10 h 788, 11 h 772 W m-2) and in December. Centroid of the raw stamp hour weighted by `SWIN_POT`, May to July: 9.96 (2022) and 9.96 (2023); by `SWIN_1_1_1` 9.87 and 9.81; by `PPFD_1_1_1` 9.64 and 9.62. On the clear day 2023-06-21 the `SWIN_1_1_1` maximum is at the raw stamp 10:00 (773.9 W m-2). The hourly mean of the measured NEE (June, July) has its minimum at raw stamp hour 9 (−15.6 µmol m-2 s-1). In `db/observations.parquet` the first row of site 1 has `ts_start` 2021-12-31 22:00 for the raw stamp 2022-01-01 00:00. The median local peak hour of `sw_in` in June is 10.0 (Qvidja: 12.0).
- Expected: solar noon at 27.235 °E is 10:11 UTC (10:13 UTC on 21 June), 12:11 UTC+2. Period-start UTC stamps give a `SWIN_POT` centroid of 9.97; period-end UTC stamps give 10.47. Shurpali 2025 gives no time-zone statement. The ICOS convention is UTC with period-end stamps, but the data here follow the period start.
- Raw rows: made by the build. The raw file is consistent with UTC period-start stamps: `2023-06-21 09:30:00` SWIN 768.7682; `10:00:00` 773.9317; `10:30:00` 770.9761. `scripts/lib/registry.ts` gives `utcOffsetMin: 120` and `timestampIsEnd: false`.
- Control: Särkisuo (same processing) gives the same numbers. Qvidja (stamps UTC+2 by its readme) has the June peak at local hour 12.0. The flux and biomet files share one convention (PPFD maximum and NEE minimum at raw hour 9 to 10).
- Probable cause: time-stamp problem. The provider wrote UTC stamps (period start). The registry adds the Finnish offset. Alternative tested: local standard time with period-end stamps gives a centroid of 12.47; UTC period-end stamps 10.47. Both years give 9.96 (2022 and 2023), the December centroid of `SWIN_1_1_1` is 10.19 and 10.08, so no year and no season follows UTC+2.
- Status / Severity: verified / S1
- Effect: every value of the site sits 2 h early in `ts_start`, on the website (the local time axis shows 10:00 as the solar noon), in `scripts/calc.ts` (night definition by local hour, diurnal fits, day-of-year sums; the annual sums do not change) and in the data export (`ts_start_utc`, `ts_local`). Hourly comparisons with Qvidja, Viikki and Haltiala are offset by 2 h. ANT-07 flags are consequences.
- Next action: add build rule (a per-source stamp offset of 0 min for the Anttila and Särkisuo sources, period start; keep `utc_offset_min` 120 for the site display). Ask the provider to confirm "stamps are UTC, start of the 30-minute period".
- Verify:
  ```sql
  SELECT round(sum((hour(t)+minute(t)/60.0)*p)/sum(p),2) AS centroid_hour_swin_pot
  FROM (SELECT strptime(TIMESTAMP_1,'%Y-%m-%d %H:%M:%S') t, try_cast(SWIN_POT AS DOUBLE) p
        FROM read_csv('data/Anttila/biomet_final_30min_FI-Ant_2023.csv', all_varchar=true)
        WHERE try_strptime(TIMESTAMP_1,'%Y-%m-%d %H:%M:%S') IS NOT NULL)
  WHERE month(t) IN (5,6,7) AND p > 0;  -- 9.96; UTC+2 stamps would give 11.96
  ```

#### ANT-02 sw_in, sw_out, netrad: night offset of the CNR4 steps from −1 to −5 W m-2 on 2022-10-14

- Source: `sw_in` ← biomet `SWIN_1_1_1`; `sw_out` ← `SWOUT_1_1_1`; `netrad` ← `RN_1_1_1`
- Period: raw stamps 2022-10-14 to 2023-12-31
- Observed: in the night periods (`SWIN_POT` = 0, 17 233 periods) `SWIN_1_1_1` is negative in 16 157, median of the negative values −4.79 W m-2, minimum −17.37, 91 periods below −10. `SWOUT_1_1_1` is negative in 11 694 night periods, median −3.85, minimum −13.51. Monthly night median of `SWIN_1_1_1`: −0.4 to −1.9 W m-2 from 2022-01 to 2022-09, then −4.9 (2022-10), −4.8, −5.1, −5.3 to −7.1 in 2023. `SWOUT_1_1_1` night median +0.4 to +2.4 before, −3.0 to −4.5 after. Daily night medians: 2022-10-13 −1.67 / +1.82; 2022-10-14 −4.46 / −3.16; 2022-10-15 −5.06 / −4.82. The offset is larger on clear nights (−7.26 against −4.52). Daytime maxima are not affected (median daily maximum of `SWIN_1_1_1` in June 777 and 776 W m-2). The scan's full-day ratio `ppfd/sw_in` of 4.68 (2022-11) comes from about 30 night periods with −4.8 W m-2 in the denominator; over the day-lit periods the ratio is 1.92.
- Expected: a pyranometer gives 0 ± 2 W m-2 at night. The thermopile offset of a CNR4 is typically 0 to −5 W m-2 on clear nights (manufacturer limit 15 W m-2). A step change on one day points to a change of the logger program or the calibration.
- Raw rows: in the raw file. `biomet_final_30min_FI-Ant_2022.csv`: `2022-10-17 00:00:00` SWIN −6.4785, SWOUT −3.5284; `00:30:00` −8.5204, −5.0215; `01:00:00` −13.3752, −9.7701.
- Control: Särkisuo, the same sensor type, has −0.7 to −1.8 W m-2 (2022-10 to 2023-05) and −6 W m-2 from 2023-08-08 (SAR-02). Anttila 2022-01 to 2022-09 has −0.4 to −1.9.
- Probable cause: sensor fault (thermopile offset of the CNR4 after a change on 2022-10-14; the sign of night `SWOUT` changed from + to − on the same day, so the processing of the whole radiometer changed).
- Status / Severity: new / S4 for the 30-minute values; S3 for winter daily and monthly sums of `sw_in` and `sw_out` (−5 W m-2 over 48 periods is −0.43 MJ m-2 d-1; the daily mean `sw_in` in November is about 10 W m-2, so the daily sum is 50 % too low)
- Effect: website daily and monthly means of `sw_in`, `sw_out` from 2022-10 are too low by about 5 and 3.5 W m-2. The cumulative and budget diagrams are not affected. `scripts/calc.ts` uses `sw_in` only as a night flag and a driver; the offset is below the night threshold. The F2, N, A, E and M flags are consequences.
- Next action: ask provider (was the CNR4 or its logger program changed on 2022-10-14; is a night-offset correction applied?). Document only. A rule could set `sw_in` and `sw_out` to 0 where `SWIN_POT` = 0, but `SWIN_POT` is not in the database.
- Verify:
  ```sql
  SELECT date_trunc('day', ts_start + INTERVAL 2 HOUR) d, round(median(sw_in),2) swin_night, round(median(sw_out),2) swout_night
  FROM 'db/observations.parquet' WHERE site_id = 1 AND ts_start BETWEEN '2022-10-12 22:00' AND '2022-10-16 21:30'
    AND (hour(ts_start + INTERVAL 2 HOUR) >= 20 OR hour(ts_start + INTERVAL 2 HOUR) < 2) GROUP BY 1 ORDER BY 1;
  -- 2022-10-13: -2.01 / +1.90; 2022-10-14: -4.33 / -3.04; 2022-10-15: -5.08 / -4.76
  ```

#### ANT-03 reco_src: 12 night periods with Reco below −5 µmol m-2 s-1 (copies of negative measured NEE)

- Source: `reco_src` ← flux `Reco_gf_ensemble_NT`
- Period: raw stamps 2022-04-17 23:00, 2022-06-29 21:00 to 2022-06-30 03:00, 2022-07-09 00:00, 2023-07-11 23:30
- Observed: 12 periods with `Reco_gf_ensemble_NT` < −5 (minimum −10.74 on 2022-06-29 21:00). In all of them `GPP_gf_ensemble_NT` = 0 and `Reco` = `co2_flux_final_gf_ensemble` exactly. 6 of the 12 have gap flag 0 (measured NEE −6.4 to −10.7 at night), 6 are gap-filled neighbours. Over both years `GPP` = 0 in 20 379 periods and `Reco` = NEE in all of them. Maximum `Reco` 25.6 (2022).
- Expected: Reco ≥ 0. The night-time method (Reichstein 2005) sets GPP = 0 at night and Reco = NEE. A measured night NEE of −10 µmol m-2 s-1 in June at 23:00 local is not plausible.
- Raw rows: in the raw file. `EC_flux_L3_final_FI-Ant_2022.csv`: `2022-06-29 21:00:00` gap 0, NEE −10.742898, GPP 0, Reco −10.74289800; `22:00:00` 0, −9.85952, 0, −9.85952000.
- Control: Särkisuo has one such period (SAR-05). Särkisuo 2023 minimum Reco −2.2.
- Probable cause: gap-filling or partitioning artefact (a measured negative night NEE that passed the QC is copied into Reco).
- Status / Severity: verified / S3
- Effect: 12 half hours of `reco_src` (and `nee`, `nee_f`) on the website. The annual Reco sum changes by less than 0.1 g C m-2. `scripts/calc.ts` fits its own Reco.
- Next action: document only.
- Verify:
  ```sql
  SELECT count(*), min(reco_src) FROM 'db/observations.parquet' WHERE site_id = 1 AND reco_src < -5;  -- 12, -10.74
  ```

#### ANT-04 le: two measured spikes of 477 and 538 W m-2 above the net radiation

- Source: `le` ← flux `LE_final_gf_ensemble`
- Period: raw stamps 2023-05-20 04:30 and 2023-08-08 11:30 (`ts_start` 02:30 and 09:30)
- Observed: 2023-05-20 04:30: `LE` 476.85 (gap flag 0), neighbours 59.9 and 123.5; `RN_1_1_1` 159.3, `SWIN_1_1_1` 344.3. 2023-08-08 11:30: `LE` 537.53 (gap flag 0), neighbours 81.9 and 193.6; `RN` 128.2, `SWIN` 172.7 (a cloud passed). These are the only two periods with `LE` > 400 in 2022 and 2023 (maximum 2022: 385).
- Expected: LE ≤ Rn − G in a grassland; LE up to about 350 W m-2 at this site.
- Raw rows: in the raw file. `EC_flux_L3_final_FI-Ant_2023.csv`: `2023-05-20 04:00:00` gap 1, 59.89584021; `04:30:00` 0, 476.84848700; `05:00:00` 0, 123.53464000.
- Control: Särkisuo has 6 periods above 400 W m-2 in 2023 (maximum 440), none in 2022.
- Probable cause: sensor fault (measured LE spike that passed the QC; both in unstable, cloudy conditions).
- Status / Severity: verified / S3
- Effect: two half hours of `le` on the website. `le` is not used by `scripts/calc.ts`.
- Next action: document only.
- Verify:
  ```sql
  SELECT ts_start, le FROM 'db/observations.parquet' WHERE site_id = 1 AND le > 400;  -- 2023-05-20 02:30 476.85; 2023-08-08 09:30 537.53
  ```

#### ANT-05 tsoil: constant runs of 0.2 to 0.6 °C in winter, values at a 0.1 °C resolution

- Source: `tsoil` ← biomet `TS_1_1_1`
- Period: winter months 2022-01 to 2022-04, 2022-11 to 2023-04, 2023-11 to 2023-12
- Observed: in every winter month `TS_1_1_1` stays between 0.2 and 0.9 °C (2022-01 0.3 to 0.6, 82 distinct values; 2022-12 −0.2 to 0.48; 2023-02 0.6 to 0.85). The longest run is 450 periods of 0.2 (raw stamps 2022-12-08 15:00 to 2022-12-17 23:30). `TS_2_1_1` is also nearly constant then. In 2022, 7 783 of 17 419 values have one decimal. The 160 exact zeros are 2022-11-25 to 2022-12-06, when the soil freezes. Snow depth 0.17 to 0.42 m in 2022-12 to 2023-03.
- Expected: a soil at 5 cm under snow stays at the freezing point for weeks (zero curtain). Shurpali 2025 p. 4 gives an April mean of 2.9 °C and no winter values. The HydraProbe reports 0.1 °C steps.
- Raw rows: in the raw file. `biomet_final_30min_FI-Ant_2022.csv`: `2022-12-08 15:00:00` TS_1 0.2000 (run start), constant to `2022-12-17 23:30:00`.
- Control: Särkisuo shows the same pattern, stronger (SAR-04). Qvidja `TS_1` (5 cm) is not constant in winter, but that site has little snow.
- Probable cause: real event (zero curtain under snow) with the 0.1 °C resolution of the sensor. The F9 negative correlation with `ta` in winter is a consequence.
- Status / Severity: real event / S4
- Effect: none on the sums. The fingerprint and time series show flat winter lines.
- Next action: document only. Ask the provider for the sensor depth of `TS_1_1_1` (open question of the database).
- Verify:
  ```sql
  SELECT count(*) FILTER (WHERE tsoil = 0.2) n02, count(*) FILTER (WHERE tsoil = 0.5) n05, count(*) FILTER (WHERE tsoil = 0.6) n06, count(tsoil) n
  FROM 'db/observations.parquet' WHERE site_id = 1;  -- 0.5 in 3 544 and 0.6 in 2 915 of 34 880
  ```

#### ANT-06 gpp_src: zero runs of 2 to 3 days also cover the daylight periods in winter

- Source: `gpp_src` ← flux `GPP_gf_ensemble_NT`
- Period: 27 runs ≥ 48 periods; 21 in November to February, 3 in 2022-04-14 to 2022-04-19 (85, 75, 68 periods), 3 in October or March
- Observed: in the run 2022-12-08 to 2022-12-11 all 8 to 9 daylight periods per day (`SWIN_1_1_1` up to 61 W m-2) have `GPP` = 0 and `Reco` = NEE. In April 2022 three runs of 1.4 to 1.8 days include the daytime. In June the GPP is 0 only at raw hours 21 to 23 (true local 23 to 01).
- Expected: the night-time method gives GPP = 0 at night by definition and GPP = max(0, Reco − NEE) by day. In winter the fitted Reco is at or below the measured NEE, so GPP is clipped to 0 for whole days. Shurpali 2025 p. 11: GPP > 0 within 2 days after snowmelt.
- Raw rows: in the raw file. `EC_flux_L3_final_FI-Ant_2022.csv`: all 48 periods of 2022-12-09 have `GPP_gf_ensemble_NT` = 0.00000000 and `Reco_gf_ensemble_NT` = `co2_flux_final_gf_ensemble`.
- Control: Särkisuo: 21 runs, 18 in winter, none in April to September.
- Probable cause: expected behaviour of the provider's night-time partitioning with GPP ≥ 0.
- Status / Severity: source artefact / S4
- Effect: none. `scripts/calc.ts` fits its own GPP.
- Next action: document only.
- Verify:
  ```sql
  SELECT count(*) FILTER (WHERE gpp_src = 0) n0, count(*) FILTER (WHERE gpp_src = 0 AND sw_in > 20) n0_daylight
  FROM 'db/observations.parquet' WHERE site_id = 1 AND ts_start BETWEEN '2022-12-08' AND '2022-12-11 23:30';  -- 185, 5
  ```

#### ANT-07 ppfd, sw_in, gpp_src: scan flags that are consequences of the 2-hour shift (ANT-01)

- Source: `ppfd`, `sw_in` ← biomet `PPFD_1_1_1`, `SWIN_1_1_1`
- Period: 2022-05 to 2023-07 (N: "night" `ppfd` medians 7 to 29 µmol m-2 s-1 in June and July, `sw_in` 8 to 13 W m-2 in June); 2022-05, 2022-10 (G: sunrise 1.5 to 2.5 h before the astronomical sunrise)
- Observed: the scan's "local hours 0 to 2" are the raw stamps 00:00 to 02:30 UTC = 02:00 to 04:30 true local time. In June the sun rises at 63 °N at about 02:30 local. `PPFD_1_1_1` at raw hours 0, 1, 2 is 17, 72 and 177 µmol m-2 s-1. In the true night (`SWIN_POT` = 0) the monthly median of `PPFD_1_1_1` is −0.0 to 2.0 µmol m-2 s-1 in every month (June 2022: 2.0; June 2023: 1.8).
- Expected: night `ppfd` 0 ± 5 after the time axis is corrected.
- Raw rows: made by the build (see ANT-01).
- Control: Särkisuo gives the same (June night `ppfd` median 1.9 in the true night; 27.6 in the scan).
- Probable cause: time-stamp problem (ANT-01); false positive of the check.
- Status / Severity: verified / S4 (no own effect)
- Effect: none beyond ANT-01.
- Next action: document only. Run the scan again after the ANT-01 fix.
- Verify:
  ```sql
  SELECT round(median(try_cast(PPFD_1_1_1 AS DOUBLE)),1) ppfd_true_night
  FROM read_csv('data/Anttila/biomet_final_30min_FI-Ant_2023.csv', all_varchar=true)
  WHERE try_cast(SWIN_POT AS DOUBLE) = 0 AND TIMESTAMP_1 LIKE '2023-06%';  -- 1.8
  ```

#### ANT-08 nee_f, gpp_src, reco_src, ch4, n2o: annual sums agree with Shurpali 2025 (sign and units confirmed)

- Source: `nee_f`, `gpp_src`, `reco_src`, `ch4`, `n2o` ← flux `co2_flux_final_gf_ensemble`, `GPP_gf_ensemble_NT`, `Reco_gf_ensemble_NT`, `ch4_flux_final_gf_ensemble`, `n2o_flux_final_gf_ensemble`
- Period: calendar year 2022 (17 520 periods, complete) and 2023
- Observed: sums × 1800 s from the raw file: NEE 2022 −249 g C m-2 (2023 −283), GPP 1 259 (1 378), Reco 1 010 (1 095); CH4 0.23 g CH4 m-2 = 2.3 kg CH4 ha-1 (2023: 2.7); N2O 3.85 kg N2O ha-1 (2023: 1.70). Daily NEE −9.3 to +3.8 µmol m-2 s-1 (2022); daily N2O maximum 14.0 nmol m-2 s-1. The database gives the same sums. NEE = Reco − GPP holds in all 17 520 periods.
- Expected: Shurpali 2025 Table 3: NEE −2 500 kg C ha-1 = −250 g C m-2, Reco 1 010, GPP 1 260, CH4 2 (2 to 3) kg CH4 ha-1, N2O 3.8 (3.7 to 4.0) kg N2O ha-1; daily NEE −9.3 to +3.8 (p. 4); daily N2O peak 17 nmol m-2 s-1 (p. 6, days with ≥ 10 measured values).
- Raw rows: in the raw file. Unit row of `n2o_flux_final_gf_ensemble`: `µmol+1s-1m-2`, example 0.00047142 (2022-01-01 00:00) = 0.47 nmol m-2 s-1.
- Control: Särkisuo 2022: NEE −53 (article −50), GPP 982 (980), Reco 929 (930), N2O 16.0 (16) kg N2O ha-1 (SAR-07).
- Probable cause: none; agreement. The article's N2O unit is kg N2O ha-1 (not N2O-N). The registry factor × 1000 (µmol to nmol N2O) is correct. Negative NEE = uptake.
- Status / Severity: verified / S4 (no anomaly)
- Effect: none.
- Next action: document only.
- Verify:
  ```sql
  SELECT round(sum(nee_f)*1800*12.011e-6) nee_gC, round(sum(n2o)/1000*1800*44.013e-6*10, 2) n2o_kg_ha
  FROM 'db/observations.parquet' WHERE site_id = 1 AND year(ts_start + INTERVAL 2 HOUR) = 2022;  -- -249, 3.85
  ```

### Särkisuo

Files: `data/Särkisuo/EC_flux_L3_final_FI-Sar_<year>.csv` (flux, stamp `time`), `data/Särkisuo/biomet_final_30min_FI-Sar_<year>.csv` (biomet, stamp `TIMESTAMP_1`). Coverage: `SWIN_1_1_1` 3 234 values in 2022 (from the raw stamp 2022-10-25 13:00) and 13 378 in 2023. The biomet file 2023 has no values from 2023-05-16 to 2023-08-08. CH4 and N2O start at the raw stamp 2022-05-06 00:00.

#### SAR-01 all columns: raw stamps are UTC and mark the period start; the build treats them as UTC+2

- Source: all columns ← both files, `time` and `TIMESTAMP_1`
- Period: 2022-01-01 00:00 to 2023-12-31 23:30 (all rows of both years)
- Observed: `SWIN_POT` peaks at raw stamp hour 10 in June (09 h 830, 10 h 832, 11 h 825 W m-2) and in December (09 h 61, 10 h 71, 11 h 21). Centroid weighted by `SWIN_POT`, May to July: 9.97 (2022) and 9.79 (2023, with the data gap); by `PPFD_1_1_1` 9.82 and 9.52; by `SWIN_1_1_1` 2023: 9.57. On 2022-06-21 the first stamp with `SWIN_POT` > 0 is 00:30 and the last is 19:30. The hourly mean of the measured NEE (June, July) has its minimum at raw hour 9 (−12.9 µmol m-2 s-1). The first row of site 2 has `ts_start` 2021-12-31 22:00 for the raw stamp 2022-01-01 00:00.
- Expected: solar noon at 27.2 °E is 10:11 UTC (12:11 UTC+2). Period-start UTC stamps give a centroid of 9.97; period-end stamps 10.47; UTC+2 stamps 11.97. The lit periods on 2022-06-21 have their mid-point at 10:15 with period-start stamps (solar noon 10:13). Shurpali 2025 gives no time-zone statement.
- Raw rows: made by the build (`utcOffsetMin: 120`, `timestampIsEnd: false`). In `biomet_final_30min_FI-Sar_2022.csv` the maximum of `SWIN_POT` on 2022-06-21 is at the stamp `10:00:00`.
- Control: Anttila gives the same (ANT-01). Qvidja has the June peak at local hour 12.0. The flux and biomet files share one convention.
- Probable cause: time-stamp problem. The provider wrote UTC stamps (period start). The registry adds the Finnish offset. Alternative tested: local standard time with period-end stamps gives a centroid of 12.47; UTC period-end stamps 10.47. Both years follow UTC period start (9.97 in 2022, 9.79 in 2023 with the biomet gap).
- Status / Severity: verified / S1
- Effect: every value of the site sits 2 h early in `ts_start`, on the website, in `scripts/calc.ts` (night definition, diurnal fits; the annual sums do not change) and in the data export. The scan flags N (`ppfd` 27.6 at "night" in June 2022), G (sunrise) and F7 (SAR-06) are consequences.
- Next action: add build rule (stamp offset 0 min for the Anttila and Särkisuo sources, period start). Ask the provider to confirm "stamps are UTC, start of the 30-minute period". Same rule as ANT-01.
- Verify:
  ```sql
  SELECT round(sum((hour(t)+minute(t)/60.0)*p)/sum(p),2) AS centroid_hour_swin_pot
  FROM (SELECT strptime(TIMESTAMP_1,'%Y-%m-%d %H:%M:%S') t, try_cast(SWIN_POT AS DOUBLE) p
        FROM read_csv('data/Särkisuo/biomet_final_30min_FI-Sar_2022.csv', all_varchar=true)
        WHERE try_strptime(TIMESTAMP_1,'%Y-%m-%d %H:%M:%S') IS NOT NULL)
  WHERE month(t) IN (5,6,7) AND p > 0;  -- 9.97; UTC+2 stamps would give 11.97
  ```

#### SAR-02 sw_in, sw_out: night offset of the CNR4 −1 W m-2 until 2023-05-15, −6 W m-2 from 2023-08-08

- Source: `sw_in` ← biomet `SWIN_1_1_1`; `sw_out` ← `SWOUT_1_1_1`; `netrad` ← `RN_1_1_1`
- Period: raw stamps 2022-10-25 13:00 to 2023-12-31 (all periods with radiation data)
- Observed: night periods (`SWIN_POT` = 0, 10 186 with a value): `SWIN_1_1_1` negative in 9 558 (median of the negatives −2.99 W m-2, minimum −11.26, 4 below −10); `SWOUT_1_1_1` negative in 6 310 (median −3.02, minimum −8.43). Monthly night median of `SWIN_1_1_1`: −0.7 to −1.8 W m-2 from 2022-10 to 2023-05 (`SWOUT` −1.1 to +2.2), then −6.2 (2023-08), −6.4, −5.5, −4.6, −4.5 (`SWOUT` −3.3 to −4.9). Weekly night medians: week of 2023-05-15 `SWIN` −1.04, `SWOUT` +1.69; week of 2023-08-07 −6.05, −3.20. The change is inside the data gap 2023-05-16 to 2023-08-08. Daytime values are not affected (median daily maximum in October 2023 197 W m-2, Anttila 202). The scan's full-day ratio of 4.59 (2023-11) comes from the negative night periods.
- Expected: 0 ± 2 W m-2 at night. The same change happened at Anttila on 2022-10-14 (ANT-02), so it is a change in the radiometer processing of the provider, not a single sensor.
- Raw rows: in the raw file. `biomet_final_30min_FI-Sar_2023.csv`: `2023-01-01 00:00:00` SWIN −1.5891, SWOUT 0.5048 (before); the first rows after the gap, 2023-08-08, have night values near −6 and −3.
- Control: Anttila 2022-01 to 2022-09: −0.4 to −1.9 W m-2; from 2022-10-14: −4.5 to −7.1.
- Probable cause: sensor fault (thermopile offset after a change of the CNR4 processing or calibration).
- Status / Severity: new / S4 for the 30-minute values; S3 for the winter daily and monthly means of `sw_in` and `sw_out` from 2023-08 (about −6 and −3.5 W m-2 on a daily mean of about 10 W m-2 in November)
- Effect: website daily and monthly means of `sw_in`, `sw_out` from 2023-08 are too low. No effect on the carbon sums. The F2, N, A and E flags are consequences.
- Next action: ask provider (same question as ANT-02). Document only.
- Verify:
  ```sql
  SELECT year(ts_start + INTERVAL 2 HOUR) y, month(ts_start + INTERVAL 2 HOUR) m, round(median(sw_in),2) swin_night, round(median(sw_out),2) swout_night
  FROM 'db/observations.parquet' WHERE site_id = 2 AND (hour(ts_start + INTERVAL 2 HOUR) >= 21 OR hour(ts_start + INTERVAL 2 HOUR) < 1)
    AND ts_start >= '2023-01-01' GROUP BY 1,2 ORDER BY 1,2;  -- 2023-05: -1.42 / +2.16; 2023-08: -6.22 / -3.24
  ```

#### SAR-03 ta, rh: one logger row before a gap with TA −39.18 °C and RH 1.07 %

- Source: `ta` ← biomet `TA_1_1_1`; `rh` ← `RH_1_1_1`; also `sw_in`
- Period: raw stamp 2023-10-17 09:30 (`ts_start` 07:30); also the raw stamp 2023-09-13 11:00 (`ts_start` 09:00)
- Observed: raw stamp 2023-10-17 09:00: `TA_1_1_1` 2.1865, `RH_1_1_1` 78.9506, `SWIN_1_1_1` 147.5; 09:30: `TA` −39.1814, `RH` 1.0715, `SWIN` −9999; 10:00: all −9999 (gap). The −39.18 passes the range check of the scan (−40) and of the build (−60). Raw stamp 2023-09-13 11:00: `RH` 20.5474 (neighbours 79.2 and 78.3), `SWIN` 53.5 (before 155.7, after −9999). Both rows are the last period before a data gap. No other `TA` below −30 °C in the two years (minimum 2022: −29.8).
- Expected: `TA` 2 °C, `RH` 79 % (the neighbours). A period mean over a few 1-minute samples with a sensor power loss gives such values.
- Raw rows: in the raw file. `biomet_final_30min_FI-Sar_2023.csv`: `2023-10-17 09:00:00` 2.1865, 78.9506; `09:30:00` −39.1814, 1.0715; `10:00:00` −9999, −9999.
- Control: Anttila has no row with a `TA` jump above 5 °C before a gap. Särkisuo has only these two rows.
- Probable cause: logger fill (partial period before a logger stop; HMP155 at power loss).
- Status / Severity: new / S3
- Effect: one half hour of `ta` (−39 °C) and `rh` (1 %) on the website, in the daily minimum of `ta` and in `scripts/calc.ts` (one period with a very small weight in the Lloyd-Taylor fit). One half hour of `rh` 20.5 % and `sw_in` 53 W m-2 on 2023-09-13.
- Next action: add build rule (set `ta`, `rh` and `sw_in` to NULL in the last period before a gap when the step against the previous period is above a limit; or set the two rows to NULL by date). Ask provider whether the last period before a logger stop is a partial mean.
- Verify:
  ```sql
  SELECT ts_start, ta, rh FROM 'db/observations.parquet' WHERE site_id = 2 AND (ta < -30 OR rh < 5);  -- 2023-10-17 07:30, -39.18, 1.07
  ```

#### SAR-04 tsoil: `TS_1_1_1` constant at 0.2 °C for 33 days in March 2023 and for most of the winter 2022-23

- Source: `tsoil` ← biomet `TS_1_1_1`
- Period: raw stamps 2023-03-01 11:30 to 2023-04-03 08:30 (1 579 periods); also 2022-11-29 to 2022-12-24 (1 199 periods), 2023-01-08 to 2023-01-30 (1 089), 2022-03-29 to 2022-04-17 (890 periods of 0.3), 2022-01-16 to 2022-01-31 (704 of 0.4), 2023-12-04 to 2023-12-12 (391 of 1.5)
- Observed: 2023-03: 1 484 of 1 488 values are 0.2000 (2 distinct values); 2022-12: 1 190 of 1 488; 2023-01: 1 273 of 1 487. From 2022-12 to 2023-03 the minimum is 0.2 and the maximum 0.3. The run ends on 2023-04-03 09:00 with 0.2033, 0.2033, 0.2067 while `TA_1_1_1` goes from −5.0 to +0.8 °C. During the run `TS_2_1_1` is constant 0.6 and `TS_3_1_1` 0.9 to 1.1; `SWC_1_1_1` varies (452 distinct values in 2023-03, 0.485 to 0.681); mean `TA` in 2023-03 −5.5 °C. In 2023, 11 061 of 13 226 values have one decimal.
- Expected: a wet peat soil at 5 cm under snow stays at the freezing point for weeks (zero curtain). Shurpali 2025 p. 4: Särkisuo SWC 30 to 69 %; no winter soil temperature given. The alternative, a sensor floor at 0.2 °C, cannot be excluded: Anttila goes down to −0.2 °C in 2022-12, Särkisuo never below 0.2 in the winter 2022-23 (but 0.1 in 2023-04 and 0.0 in other months).
- Raw rows: in the raw file. `biomet_final_30min_FI-Sar_2023.csv` (TS_1, TS_2, TS_3, SWC_1, TA): `2023-03-01 09:00:00` 0.2000, 0.6, 1.1, 0.4923, −0.93; `2023-04-03 08:30:00` 0.2000, 0.6, 0.9367, 0.6112, −1.262; `09:00:00` 0.2033, 0.6, 0.92, 0.6113, −0.6689.
- Control: Anttila (mineral soil) has the same pattern with shorter runs (ANT-05). Särkisuo 2022-02 constant 0.4 (3 distinct values), 2022-03/04 constant 0.3 (890 periods).
- Probable cause: real event (zero curtain in frozen peat under snow) with the 0.1 °C resolution; a sensor floor is an open question. Alternative tested (sensor floor at 0.2 °C): from 2022-11 to 2023-03 no value is below 0.2 (minimum 0.2 in every month); 2023-04 has 5 values of 0.1 and 2022-03 and 2022-04 have minima of 0.2 and 0.3 with 70 and 401 distinct values. The floor cannot be excluded with the file alone.
- Status / Severity: open question / S4 if real; S2 if the sensor was frozen in and reads a constant
- Effect: flat winter lines in the website time series and fingerprint. The F9 flags are consequences. `scripts/calc.ts` uses `tsoil` as a Reco driver only where the Lloyd-Taylor fit uses it.
- Next action: ask provider (sensor depth of `TS_1_1_1`; did the HydraProbe at 5 cm read 0.2 °C for the whole winter 2022-23 in the raw 1-minute data?). Document only.
- Verify:
  ```sql
  SELECT count(*) FILTER (WHERE tsoil = 0.2) n02, count(DISTINCT tsoil) nd, min(tsoil), max(tsoil)
  FROM 'db/observations.parquet' WHERE site_id = 2 AND ts_start BETWEEN '2023-02-28 22:00' AND '2023-03-31 21:30';  -- 1484, 2, 0.2, 0.2033
  ```

#### SAR-05 reco_src: one night period with Reco −17.3 µmol m-2 s-1 in January 2022

- Source: `reco_src` ← flux `Reco_gf_ensemble_NT`; also `nee`, `nee_f`
- Period: raw stamp 2022-01-25 23:00 (`ts_start` 21:00)
- Observed: `Reco_gf_ensemble_NT` −17.30061, `GPP_gf_ensemble_NT` 0, `co2_flux_final_gf_ensemble` −17.30061 with gap flag 0 at night in January (`TA` about −7 °C, snow). The only period below −5 in both years (minimum 2023: −2.2). Over both years `GPP` = 0 in 20 411 periods and `Reco` = NEE in all of them.
- Expected: Reco ≥ 0; measured winter NEE about +0.5 µmol m-2 s-1 (article p. 4).
- Raw rows: in the raw file. `EC_flux_L3_final_FI-Sar_2022.csv`: `2022-01-25 23:00:00` gap 0, NEE −17.30061, GPP 0, Reco −17.30061000.
- Control: Anttila has 12 such periods (ANT-03).
- Probable cause: gap-filling or partitioning artefact (a measured NEE spike that passed the QC is copied into Reco).
- Status / Severity: verified / S3
- Effect: one half hour of `nee`, `nee_f`, `reco_src`. The annual sum changes by 0.4 g C m-2.
- Next action: document only.
- Verify:
  ```sql
  SELECT ts_start, nee, nee_qc, reco_src FROM 'db/observations.parquet' WHERE site_id = 2 AND reco_src < -5;  -- 2022-01-25 21:00, -17.3, 0, -17.3
  ```

#### SAR-06 gpp_src: F7 "night GPP > 0.5 in 49 % of the night periods" in June and July 2023 is a consequence of SAR-01 and the biomet gap

- Source: `gpp_src` ← flux `GPP_gf_ensemble_NT`
- Period: 2023-06 and 2023-07
- Observed: the scan defines night by `sw_in` ≤ 5 or `ppfd` ≤ 5 and, where both are NULL, by local hour < 3 or > 22. Särkisuo has no biomet values from 2023-05-16 to 2023-08-08, so the hour rule applies. The "local" hours 0 to 3 are the raw stamps 00:00 to 02:30 UTC = 02:00 to 04:30 true local time, after sunrise. June 2023, `GPP` > 0.5 at raw hour 0: 15 of 60 periods; hour 1: 58 of 60; hour 2: 60 of 60. At raw hours 21 to 23 `GPP` = 0 in all 180 periods.
- Expected: night GPP = 0 (night-time method). Anttila has no F7 flag, because its `ppfd` is present.
- Raw rows: made by the build (time axis) and by the fallback rule of the check. `EC_flux_L3_final_FI-Sar_2023.csv`: `GPP_gf_ensemble_NT` at `2023-06-15 22:00:00` to `23:30:00` is 0; from `2023-06-16 01:00:00` > 0.5.
- Control: Anttila June 2023 at raw hours 0, 1, 2: 30, 59, 59 of 60 periods with `GPP` > 0.5 (the same pattern, not flagged).
- Probable cause: time-stamp problem (SAR-01); false positive of the check.
- Status / Severity: verified / S4
- Effect: none beyond SAR-01.
- Next action: document only. Run the scan again after the SAR-01 fix.
- Verify:
  ```sql
  SELECT hour(ts_start + INTERVAL 2 HOUR) h, count(*) FILTER (WHERE gpp_src > 0.5) n_gt05, count(*) n
  FROM 'db/observations.parquet' WHERE site_id = 2 AND ts_start BETWEEN '2023-05-31 22:00' AND '2023-06-30 21:30'
    AND hour(ts_start + INTERVAL 2 HOUR) IN (0, 1, 2, 21, 22, 23) GROUP BY 1 ORDER BY 1;  -- 0: 15, 1: 58, 2: 60, 21 to 23: 0
  ```

#### SAR-07 nee_f, gpp_src, reco_src, ch4, n2o: annual sums agree with Shurpali 2025; the 2022 CH4 and N2O sums cover 2022-05-06 to 2022-12-31 only

- Source: `nee_f`, `gpp_src`, `reco_src`, `ch4`, `n2o` ← flux `co2_flux_final_gf_ensemble`, `GPP_gf_ensemble_NT`, `Reco_gf_ensemble_NT`, `ch4_flux_final_gf_ensemble`, `n2o_flux_final_gf_ensemble`
- Period: calendar years 2022 and 2023
- Observed: sums × 1800 s from the raw file: NEE 2022 −53 g C m-2 (2023 −159), GPP 982 (1 187), Reco 929 (1 028); CH4 2022 10.35 g CH4 m-2 = 103.5 kg CH4 ha-1 over 11 520 periods from 2022-05-06; CH4 2023 12.82 g CH4 m-2 = 128 kg ha-1; N2O 2022 16.01 kg N2O ha-1 (2023: 11.32). Daily means 2022: NEE −8.0 to +5.9 µmol m-2 s-1; CH4 maximum 143.4 nmol m-2 s-1; N2O maximum 28.1 (2023: 34.6). The database gives the same sums. NEE = Reco − GPP holds in all periods.
- Expected: Shurpali 2025 Table 3: NEE −500 (−500 to −600) kg C ha-1 = −50 g C m-2; Reco 930; GPP 980; CH4 110 (110 to 120) kg ha-1 = 11 g CH4 m-2 with the gaps before 6 May filled with December medians (p. 4); N2O 16 (16 to 17) kg N2O ha-1; daily NEE −7.8 to +6.3; daily CH4 peak 143 nmol m-2 s-1; daily N2O peak 34 nmol m-2 s-1.
- Raw rows: in the raw file. `EC_flux_L3_final_FI-Sar_2022.csv`: `2022-05-05 23:30:00` CH4 −9999; `2022-05-06 00:00:00` first value; unit row `µmol+1s-1m-2`.
- Control: Anttila 2022 (ANT-08): NEE −249 (article −250), N2O 3.85 (3.8).
- Probable cause: none; agreement. The CH4 2022 sum in the database is 6 % below the article because the file has no values before 2022-05-06.
- Status / Severity: verified (the partial CH4 and N2O year 2022 is known: `annual.csv` share 0.66) / S4 (no anomaly)
- Effect: the website annual budget for `ch4` and `n2o` 2022 is a partial year (the budget diagram marks it with `*`).
- Next action: document only.
- Verify:
  ```sql
  SELECT round(sum(nee_f)*1800*12.011e-6) nee_gC, round(sum(ch4)*1800*16.043e-6, 2) ch4_g_m2, count(ch4) n_ch4, round(sum(n2o)/1000*1800*44.013e-6*10, 2) n2o_kg_ha
  FROM 'db/observations.parquet' WHERE site_id = 2 AND year(ts_start + INTERVAL 2 HOUR) = 2022;  -- -53, 10.35, 11520, 16.01
  ```

### Haltiala

File: `data/Haltiala/haltiala.csv` (`TIMESTAMP_START` in UTC+2, missing `NA`, 81 600 rows, no gaps in the time axis). All columns except `NEE` are gap-filled (`_F`). There is no quality flag.

#### HAL-01 swc: 0.01 resolution gives long runs of equal values

- Source: `swc` ← `haltiala.csv`, `SWC_010_F`
- Period: whole file (2021-05-07 to 2025-12-31)
- Observed: all 81 600 values have 2 decimals; 36 distinct values in the file (0.25 to 0.68); 410 runs of ≥ 48 equal periods hold 62 487 periods = 76.6 % of the series; longest run 1 487 periods at 0.29 (2022-08-01 04:30 to 2022-09-01 03:30 local). In the same run `TS_010_F` and `TA_F` have a normal daily cycle.
- Expected: a 10-cm SWC sensor (ML3 or Teros-12, Vira 2025 p. 5) gives 3 decimals. A dry August soil moves by less than 0.01 per day. Viikki `swc` in 2022-08 (3 decimals): 0.125 to 0.141, 260 distinct values.
- Raw rows: in the raw file (rounding by the provider). 2022-08-01 03:30 `0.30`, 04:00 `0.30`, 04:30 `0.29`, 05:00 `0.29`.
- Control: `tsoil` (2 decimals) has 2 runs ≥ 48 (0.1 % of the series), `vpd` 2 runs, `ta`, `ppfd`, `nee_f` none.
- Probable cause: coarse resolution of the delivered column, not a stuck sensor. The B and E flags are false positives.
- Status / Severity: source artefact / S4
- Effect: a step-like curve on the website; `swc` daily means have a 0.01 quantisation. No effect on `calc.ts`.
- Next action: ask provider (is a 3-decimal `SWC_010` available?). Document only.
- Verify:
  ```sql
  SELECT count(DISTINCT SWC_010_F) nd, count(*) n FROM read_csv('data/Haltiala/haltiala.csv', all_varchar=true, nullstr='NA');
  ```

#### HAL-02 ppfd: gap-fill floor of 1.0 in the evening hours

- Source: `ppfd` ← `haltiala.csv`, `PPFD_IN_F`
- Period: from 2022-05-01 21:00 local to 2025-12-30
- Observed: `PPFD_IN_F` = 1 in 0 periods in 2021, 1 584 (9.0 %) in 2022, 1 984 (11.3 %) in 2023, 3 491 (19.9 %) in 2024, 3 594 (20.5 %) in 2025. The value 1 occurs at local hours 15 to 23 (2 283 at hour 23), in 25 periods at hours 2 to 9, and never at hours 0 to 1 and 10 to 14. No value between 0 and 1 exists.
- Expected: 0 at night, as in 2021 and in the morning hours.
- Raw rows: in the raw file. The values `0`, `1`, `2` are integers in the text.
- Control: annual mean with 1 set to 0: 2022 214.30 against 214.39, 2025 195.04 against 195.25 µmol m-2 s-1 (difference < 0.1 %).
- Probable cause: the provider's evening gap filler gives a floor of 1 instead of 0.
- Status / Severity: known / S4
- Effect: night `ppfd` on the website shows 1 instead of 0 in the evening. `response` diagrams keep rows with x > 0 only, so 1 counts as "light". The `calc.ts` night definition `ppfd < 20` is not affected.
- Next action: document only (a rule could set `ppfd` = 1 at hours 15 to 23 to 0).
- Verify:
  ```sql
  SELECT hour(strptime(TIMESTAMP_START,'%Y-%m-%d %H:%M')) hr, count(*) FILTER (WHERE PPFD_IN_F = '1') n1 FROM read_csv('data/Haltiala/haltiala.csv', all_varchar=true, nullstr='NA') GROUP BY hr ORDER BY hr;
  ```

#### HAL-03 swc: 2021 level about 0.06 to 0.10 above the later years

- Source: `swc` ← `haltiala.csv`, `SWC_010_F`
- Period: 2021-05 to 2021-11
- Observed: monthly medians 2021: May 0.51, Jun 0.50, Jul 0.33, Aug 0.46, Sep 0.48, Oct 0.50, Nov 0.51, Dec 0.40. The same months 2022 to 2025: May 0.38 to 0.44, Jun 0.27 to 0.49, Aug 0.26 to 0.36, Sep 0.27 to 0.43, Oct 0.39 to 0.44, Nov 0.41 to 0.44. After the winter 2021-22 the wet-season level is 0.43 to 0.45 and stays there in all later autumns.
- Expected: the same autumn saturation level each year. The field polygon and the tower did not move (ReadMe, `geodata/`).
- Raw rows: in the raw file. 2021-11 median 0.51, p90 0.53; 2022-11 median 0.43.
- Control: Qvidja `swc` 2021-08 0.83 against 0.59 in other years (wet August, P 197 mm against 93 mm median), but 2021-11 0.89 against 0.90: the Qvidja autumn level did not change. Haltiala events: barley harvest 2021-09-10 and 09-15; tillage 2022-04-29 and 2022-05-03.
- Probable cause: open; a sensor re-installation at the 2022 tillage, or a different calibration in the first season. The ReadMe says `SWC_010_F` was a predictor "where available for the whole year", so the 2021 column can come from a different sensor or fill. Alternative tested (a constant offset of the 2021 column): the dry end of 2021 equals the later years (annual minimum 0.26 against 0.25 to 0.29; July median 0.33 against 0.26 to 0.34; 5th percentile 0.31 against 0.26 to 0.32), so a constant offset is excluded. A higher saturation level in 2021 (before the 2022 tillage) or a wet 2021 autumn remains possible; Haltiala has no rain column to test it.
- Status / Severity: open question / S2
- Effect: `swc` 2021 is not comparable with 2022 to 2025 on the website (`years`, `monthly`, `fingerprint`). No effect on `calc.ts`.
- Next action: ask provider (was the SWC sensor moved, replaced or recalibrated between the 2021 and 2022 seasons; was 2021 SWC gap-filled from another source?).
- Verify:
  ```sql
  SELECT strftime(tl,'%Y-%m') m, round(median(swc),2) med FROM (SELECT strptime(TIMESTAMP_START,'%Y-%m-%d %H:%M') tl, try_cast(SWC_010_F AS DOUBLE) swc FROM read_csv('data/Haltiala/haltiala.csv', all_varchar=true, nullstr='NA')) WHERE month(tl)=11 GROUP BY m ORDER BY m;
  ```

#### HAL-04 tsoil: winter soil temperature flat near 0 °C, no correlation with air temperature

- Source: `tsoil` ← `haltiala.csv`, `TS_010_F`; `ta` ← `TA_F`
- Period: winter months 2021-12 to 2025-03 (20 flagged months, lowest r −0.33 in 2022-03 and −0.28 in 2024-01)
- Observed: 2022-03: TS median −0.24 °C, p2 −0.29, p98 −0.20 while TA median −0.05 and minimum −14.6 °C. 2024-01: TS median −0.33, p2 −0.52, p98 +0.27 while TA median −6.1 and minimum −26.3 °C. In every winter month with r < 0.1 the TS range (p2 to p98) is below 1.5 °C.
- Expected: a frozen or snow-covered mineral soil at 10 cm stays between −1 and +1 °C (zero curtain) and does not follow TA. A positive correlation is expected only without snow (2021-12: r 0.70, TS −4.6 to −0.4 °C).
- Raw rows: in the raw file. 2022-02-21 03:00 `TS_010_F` −0.30, 03:30 −0.30, 04:00 −0.29 with TA −1.35 to −0.51.
- Control: Qvidja (5 cm) 2022-03 r −0.25, TS median −0.1; 2024-01 r 0.47. Viikki 2024-01 TS median −0.4. The same at all three sites.
- Probable cause: real event (snow insulation and frozen soil); false positive of check F9.
- Status / Severity: real event / S4
- Effect: none. Check F9 should skip months with a TS range < 2 °C.
- Next action: document only.
- Verify:
  ```sql
  SELECT corr(tsoil, ta) r, round(quantile_cont(tsoil,0.02),2) p2, round(quantile_cont(tsoil,0.98),2) p98, round(min(ta),1) ta_min FROM 'db/observations.parquet' WHERE site_id=3 AND ts_start BETWEEN '2022-02-28 22:00' AND '2022-03-31 21:30';
  ```

#### HAL-05 ta, tsoil, ppfd, nee: monthly level shifts are regional weather and crop effects

- Source: `ta`, `tsoil`, `ppfd`, `nee`, `nee_f`, `vpd` ← `haltiala.csv`, `TA_F`, `TS_010_F`, `PPFD_IN_F`, `NEE`, `NEE_F`, `VPD_F`
- Period: 2021-05 to 2025-12, 40 flagged months (without the 12 `swc` months of HAL-03)
- Observed: every flagged TA, TS and PPFD month has the same sign and a similar size at the other sites. Examples (Haltiala against its other years; Qvidja in brackets): 2021-07 TS 21.1 against 17.2 (19.4 against 16.8, heat wave); 2022-03 PPFD 426 against 298 (SW_IN 511 against 328, sunny March); 2023-10 TA 3.5 against 8.6 (3.6 against 9.1); 2024-01 TA −6.1 against −0.1 (−4.7 against −0.5); 2025-06 PPFD 424 against 665 (541 against 755, dull cool June); 2025-12 TA 3.0 against −3.4 (5.1 against −0.2). NEE: 2024-08 day median −12.3 against +1.8 (sunflowers, sown 2024-05-16) and 2022-06 `NEE_F` −15.5 against −5.9 (oats, sown 2022-05-04). The reference "other years" mixes crops.
- Expected: Ke 2025 p. 11: summer midday median NEE −10 ± 15 µmol m-2 s-1. Haltiala measured midday medians (Jun to Aug): 2021 −6.2, 2022 −16.9, 2023 −5.5, 2024 −13.9, 2025 −15.0.
- Raw rows: the medians come from the raw columns; the anomaly is in the weather, not in a file.
- Control: Qvidja, Viikki or Anttila in the same months, as listed.
- Probable cause: real event (regional weather, crop rotation); false positive of check D.
- Status / Severity: real event / S4
- Effect: none.
- Next action: document only.
- Verify:
  ```sql
  SELECT site_id, round(median(ta),1) ta FROM 'db/observations.parquet' WHERE site_id IN (3,4,5) AND ts_start BETWEEN '2023-09-30 22:00' AND '2023-10-31 21:30' GROUP BY site_id ORDER BY site_id;
  ```

Annual NEE sums (not flagged): `annual.csv` and the raw file agree. `NEE_F` sums 2021 +59.8 g C m-2 (May 7 to Dec 31, 65 % of the year), 2022 −271.2, 2023 +131.3, 2024 −47.0, 2025 −3.9. Summer midday measured NEE is negative in every year and the winter mean `NEE_F` is +0.23 to +0.59. The sign follows the convention negative = uptake (Ke 2025 p. 5). The 2022 sum is at the edge of the article range (−250 to +170), but 2022 is the year with the largest yield and the earliest sowing. No sign problem.

### Qvidja

File: `data/Qvidja/Qvidja_2018-2025.csv` (`TIMESTAMP_START` `YYYYMMDDHHMM` in UTC+2, missing = empty, every 2018 to 2023 row twice; read with `DISTINCT ON (TIMESTAMP_START)`: 134 108 rows).

#### QVI-01 swc: `SM` is the ML3 sensor output in volts, not m³ m⁻³ (resolved 2026-10-22)

- Source: `swc` ← `Qvidja_2018-2025.csv`, `SM`
- Period: whole file (2018-05-09 to 2025-12-31)
- Observed: 124 023 values, 612 distinct, 0.369 to 0.98; median 0.777; 445 periods above 0.97.
- Expected: 0.16 to 0.55 m³ m⁻³ (Heimsch 2021 p. 6). The ML3 polynomial for mineral soil (ML3 manual p. 22) gives back the published growing-season means within 0.011 (`docs/qvidja-soil-moisture.md`).
- Raw rows: in the raw file. See `docs/qvidja-soil-moisture.md`.
- Control: the other sites have `swc` 0.03 to 0.80.
- Probable cause: unit or scale problem. Alternative tested (a very wet clay loam in m³ m⁻³): 86.5 % of the values are above 0.55, the published site maximum, and 95.3 % above 0.50, the porosity of a clay loam. A volumetric reading cannot give this.
- Status / Severity: resolved 2026-10-22. The provider (Mika Korkiakoski) confirmed that `SM` is "raw". `scripts/lib/ml3.ts` converts it in the build: `swc` is now 0.137 to 0.557 m³ m⁻³ (median 0.356), 0 values out of range / S1
- Effect: until the build of 2026-10-22, all Qvidja `swc` values on the website and in the export were in volts. `calc.ts` does not use `swc`.
- Next action: none. Run `npm run site:sync` to update the website data.
- Verify: see `docs/qvidja-soil-moisture.md`, section Reproduce.

#### QVI-02 swc: sensor ceiling 0.98 in wet periods and flat runs

- Source: `swc` ← `Qvidja_2018-2025.csv`, `SM`
- Period: 2022-11-07 to 2023-01-22 (ceiling), 2018 to 2025 (runs)
- Observed: `SM` = 0.98 in 145 periods (first 2022-11-08 04:00, last 2023-01-15 04:30 local); 0.979 in 25, 0.978 in 46, 0.977 in 88. No value above 0.98. On 2022-11-07 the raw `SM` climbs 0.796, 0.798, 0.807, 0.812, 0.819 (18:00 to 20:00 local) with rain 0.25 to 0.80 mm per 30 min, then reaches 0.97 to 0.98 on 2022-11-08. Runs of equal values ≥ 48 periods: 64 runs, 4 295 periods = 3.5 % of the series; longest 159 periods at 0.84 (from 2024-11-17 22:00 local). The values have 3 decimals (111 332 rows), 2 decimals (11 075) or 1 decimal (1 616).
- Expected: a wet clay loam near saturation gives a flat sensor signal. The ML3 output saturates at about 1 V.
- Raw rows: in the raw file. 2022-11-07 18:00 `0.796`, 18:30 `0.798`, 19:00 `0.807`; 2024-11-17 21:00 `0.841`, 22:00 `0.84`, 23:00 `0.84`.
- Control: the Parquet runs are the same as in the raw file. Särkisuo (peat) `swc` also sits at 0.80 for days in winter.
- Probable cause: sensor fault (output ceiling) on top of QVI-01. The flat runs are a saturated wet soil with a 0.001 to 0.01 resolution.
- Status / Severity: verified / S4
- Effect: after the unit conversion (2026-10-22) the ceiling is a flat maximum of 0.557 m³ m⁻³ (ML3 polynomial). No effect on `calc.ts`.
- Next action: document only. Ask the provider together with QVI-01 whether 0.98 is the sensor maximum.
- Verify:
  ```sql
  SELECT count(*) FILTER (WHERE SM::DOUBLE = 0.98) n_eq098, count(*) FILTER (WHERE SM::DOUBLE > 0.97) n_gt097 FROM (SELECT DISTINCT ON (TIMESTAMP_START) * FROM read_csv('data/Qvidja/Qvidja_2018-2025.csv', all_varchar=true, nullstr=''));
  ```

#### QVI-03 swc: drops of 0.3 to 0.4 when the soil is frozen (winters 2021, 2022, 2024, 2025)

- Source: `swc` ← `Qvidja_2018-2025.csv`, `SM`; `tsoil` ← `TS_1`
- Period: 2024-01-01 to 2024-04-08 (flagged 2024-02); also 2021-01 to 03, 2021-12 to 2022-01, 2025-02
- Observed: weekly medians of `SM` with `TS_1`: 2023-12-25 0.879 (TS +0.10 °C); 2024-01-08 0.516 (TS −0.80); 2024-01-22 0.663 (thaw, P 16 mm); 2024-02-12 0.429 (TS −1.37); 2024-04-08 0.744 (TS +2.09, thaw). 2025-02-17 0.562 (TS −0.65), 2025-03-03 0.856. Median `SM` in Dec to Mar when `TS_1` ≤ 0: 2021 0.535, 2022 0.490, 2024 0.550, 2025 0.656; when `TS_1` > 0.5: 0.80 to 0.92 in all years.
- Expected: Heimsch 2021 p. 6: "rapid data drops were likely related to soil freezing". Ice has a low permittivity; the water does not go away.
- Raw rows: in the raw file (weekly aggregates above).
- Control: Haltiala `swc` 2022-01 0.27 against 0.43 with `tsoil` −0.6 °C; Viikki 2024-01 0.14 against 0.41. The same freezing drop at the mineral sites.
- Probable cause: real event (sensor physics in frozen soil), not a sensor replacement: the level returns to 0.74 to 0.88 at the thaw in every year. Alternative tested: in the winters 2018-19 and 2019-20 (little or no snow) the frozen-soil median is 0.79 and 0.78 against 0.87 and 0.91 thawed, so the size of the drop follows the depth of the frost; no sensor change is needed to explain it.
- Status / Severity: known / S2
- Effect: winter `swc` means on the website are low in frozen weeks. No effect on `calc.ts`.
- Next action: document only (a rule could set `swc` to NULL where `tsoil` < 0 at the mineral sites).
- Verify:
  ```sql
  SELECT round(median(swc) FILTER (WHERE tsoil <= 0),3) frozen, round(median(swc) FILTER (WHERE tsoil > 0.5),3) thawed FROM 'db/observations.parquet' WHERE site_id=4 AND ts_start BETWEEN '2023-12-01' AND '2024-04-30';  -- in m³ m⁻³ since 2026-10-22: 0.227, 0.335 (in V before: 0.567, 0.746; the thaw is in April; a window to 2024-04-01 gives no thawed value)
  ```

#### QVI-04 rh, vpd: dry bias before 2021-10-08, and a faulty sensor in January to June 2021

- Source: `rh` ← `Qvidja_2018-2025.csv`, `RH_F` (QC `RH_F_QC`); `vpd` ← `VPD_F`
- Period: 2018-05-09 to 2021-10-07 (Kaarina RH per Heimsch 2024 p. 4); worst 2021-01-01 to 2021-06-30
- Observed: annual median `RH_F` 2018 73.7, 2019 74.7, 2020 75.1, 2021 77.1, then 86.7 (2022), 87.4, 87.4, 89.5 (2025). Values of 2018 to 2020 have 1 decimal (13 025 of 17 520 in 2019), from 2022 2 decimals: a different source. Median `RH_F` when `TA_F` < −5 °C: 2018 37.9, 2019 51.9, 2020 55.1, 2021 45.7, 2022 to 2025 82.9 to 90.0 %. 2021-01 to 03: 579 periods with RH < 30 % at TA < −5 °C (2022 to 2025: 0); 2021-02 median 46.3 (reference 90.2) with `RH_F_QC` = 0 in all 1 344 periods. 2021-07 to 09: all 4 416 periods `RH_F_QC` = 1. `VPD_F` follows `RH_F` exactly (Magnus with `TA_F`, max |difference| 0.008 hPa): 2021-02 VPD median 1.71 against 0.46 hPa.
- Expected: RH 80 to 95 % at −5 to −20 °C in a Finnish winter. Heimsch 2024 p. 4: recurring RH faults until 8 Oct 2021, Kaarina RH used 4 May 2018 to 7 Oct 2021.
- Raw rows: in the raw file. 2021-02-10 00:00 `TA_F` −19.37, `RH_F` 18.7, `RH_F_QC` 0.0, `VPD_F` 1.076; 00:30 −17.17, 14.6, 0.0, 1.362. The file does not hold the Kaarina replacement for 2021-01 to 06; the article says it does.
- Control: monthly median `vpd` Haltiala against Qvidja: 2021-05 3.40 against 2.92 hPa, 2021-06 8.0 against 6.64; in the warm months the two sites agree within 1.4 hPa. The dry bias is largest in the cold months, where no other site exists in 2018 to 2021.
- Probable cause: sensor fault (2021-01 to 06, flagged as measured) and a source change (station data 2018 to 2020 with 1 decimal and a dry bias in cold weather). Alternative tested (a station series that is dry in all seasons): in the warm months of 2021 the Qvidja `vpd` is below Haltiala (May 2.9 against 3.4 hPa, June 6.6 against 8.0, September 2.1 against 2.3), and in 2022 the two sites agree (May 4.2 against 4.0, June 5.7 against 5.7). The dry bias is confined to cold weather, which fits a sensor fault at low temperature, not a dry station series.
- Status / Severity: known (article) for the source; new for the unreplaced faulty values 2021-01 to 06 / S2
- Effect: `rh` and `vpd` before 2021-10 are not comparable with 2022 to 2025 on the website; `vpd` 2021-01 to 06 is 3 to 4 times too high. `calc.ts` does not use Qvidja `rh` or `vpd`.
- Next action: ask provider (is `RH_F` 2018-05 to 2021-10 the Kaarina series or the faulty on-site sensor; why is 2021-01 to 06 flagged as measured?). A rule could set `rh` and `vpd` to NULL from 2021-01-01 to 2021-06-30.
- Verify:
  ```sql
  SELECT count(*) FILTER (WHERE RH_F::DOUBLE < 30 AND TA_F::DOUBLE < -5) n_dry_cold, count(*) FILTER (WHERE RH_F_QC::DOUBLE = 0) n_meas FROM (SELECT DISTINCT ON (TIMESTAMP_START) * FROM read_csv('data/Qvidja/Qvidja_2018-2025.csv', all_varchar=true, nullstr='')) WHERE TIMESTAMP_START BETWEEN '202101010000' AND '202103312330';
  ```

#### QVI-05 rh, vpd: RH above 100 % and VPD below 0 from 2021-10 on

- Source: `rh` ← `RH_F`; `vpd` ← `VPD_F`
- Period: 2021-10 to 2025-12
- Observed: `RH_F` > 100 in 2 018 periods (2021: 9, 2022: 133, 2023: 604, 2024: 691, 2025: 581), maximum 104.54; `VPD_F` < 0 in the same 2 018 periods (minimum −0.84 hPa); `RH_F_QC` = 1 in 7 of them. RH > 103 in 42 periods, all measured.
- Expected: RH ≤ 100. A HMP155 can overshoot by 1 to 3 % in fog; 4.5 % is high.
- Raw rows: in the raw file. The 2 018 rows are measured values; VPD is computed from them.
- Control: Anttila and Särkisuo `rh` maximum 100 to 103.
- Probable cause: sensor fault (overshoot of the on-site RH sensor at saturation), carried into VPD.
- Status / Severity: known (`docs/harmonised-database.md`: `vpd` below 0 in 2 018 rows) / S4
- Effect: 1.2 % of the periods from 2022. A mean VPD moves by less than 0.01 hPa.
- Next action: document only (a rule could cap `rh` at 100 and `vpd` at 0).
- Verify:
  ```sql
  SELECT count(*) FILTER (WHERE rh > 100) n_rh, count(*) FILTER (WHERE vpd < 0) n_vpd, max(rh) FROM 'db/observations.parquet' WHERE site_id=4;
  ```

#### QVI-06 rh, vpd: plateaus of RH 100 % with VPD 0 in winter 2019 and in 2024-12

- Source: `rh` ← `RH_F`; `vpd` ← `VPD_F`
- Period: 2018-12-30 to 2019-03-21 (6 runs, 31 to 177 periods), 2021-09 (5 runs, 26 to 40), 2024-12-25 20:00 to 2024-12-29 09:30 (2 runs, 27 and 131)
- Observed: 2019-03-14 21:30 to 03-18 13:30 local: 179 periods, all `RH_F_QC` = 1, 177 at exactly 100.0. 2024-12-25 to 12-29: 217 periods, 179 with `RH_F_QC` = 1 and `TA_F_QC` = 1, 158 at 100.0; `TA_F` has values like 3.4333 and 2.2333 (means of three values, a station fill). Share of RH = 100: 2019 3.77 %, 2021 4.83 %, 2022 to 2025 0.05 to 0.99 %.
- Expected: a real fog gives RH 97 to 100 with small variation. A 4-day exact 100.0 is a fill.
- Raw rows: in the raw file (gap filling of the provider). 2024-12-26 18:00 `TA_F` 3.4333, `RH_F` 99.667, QC 1.0; 18:30 2.7, 100.0, 1.0; 19:00 2.2333, 100.0, 1.0.
- Control: Haltiala `vpd` has 2 runs of 0.0 (56 and 51 periods) in similar weather.
- Probable cause: gap-filling artefact (station fill at 100 %), inside the QVI-04 period for 2019.
- Status / Severity: verified / S4
- Effect: cosmetic.
- Next action: document only.
- Verify:
  ```sql
  SELECT count(*) n, count(*) FILTER (WHERE RH_F_QC::DOUBLE = 1) n_gf, count(*) FILTER (WHERE RH_F::DOUBLE = 100) n100 FROM (SELECT DISTINCT ON (TIMESTAMP_START) * FROM read_csv('data/Qvidja/Qvidja_2018-2025.csv', all_varchar=true, nullstr='')) WHERE TIMESTAMP_START BETWEEN '202412250000' AND '202412291200';
  ```

#### QVI-07 nee_f, gpp_src, reco_src: daytime partitioning, NEE differs from Reco minus GPP

- Source: `nee_f` ← `NEE`; `gpp_src` ← `−GPP`; `reco_src` ← `RECO`
- Period: 2018-05-09 to 2025-12-31 (all years)
- Observed: share of periods with |NEE − (Reco − GPP)| > 0.5 µmol m-2 s-1: 2018 44.2 %, 2019 31.6, 2020 29.1, 2021 27.5, 2022 26.1, 2023 30.2, 2024 39.3, 2025 47.5; at night 13 to 36 %. Night `gpp_src` > 0.5 in 12.1 to 20.6 % of the night periods; the night GPP sum is 103 to 144 g C m-2 per year. Annual sums (g C m-2) NEE against Reco − GPP: 2018 −130 against −147, 2019 −247 against −252, 2020 −118 against −115, 2021 −112 against −130, 2022 +35 against +21, 2023 +89 against +68, 2024 +34 against +12, 2025 −14 against −44.
- Expected: night-time partitioning gives GPP = 0 at night and NEE = Reco − GPP exactly (Anttila, Särkisuo). Heimsch 2021 p. 13: Lloyd-Taylor Reco and a rectangular hyperbola for GPP in 3-day windows, so the sum of the two fits is not the gap-filled NEE.
- Raw rows: in the raw file (method of the provider). 2018-05-09 02:00 `NEE` 2.614, `GPP` 0.0, `RECO` 2.418.
- Control: Anttila `nee_f` = `reco_src` − `gpp_src` in every period.
- Probable cause: gap-filling or partitioning artefact (daytime method, both fluxes modelled). Alternative tested (a time shift that puts daylight into the night window): Qvidja has its radiation peak at local hour 12.0. With night = `sw_in` ≤ 5 W m-2, `gpp_src` > 0.5 occurs in 2.4 % of the January night periods, 13.8 % in April, 37.8 % in June, 33.5 % in July and 14.4 % in October. The night GPP sits in the twilight hours of the light months: it comes from the light-response model of the daytime method, not from the time axis.
- Status / Severity: known / S2
- Effect: the website `budget` bars NEE, Reco and −GPP do not add up (difference up to 30 g C m-2 yr-1, 2025). GPP and Reco carry about 100 to 140 g C m-2 yr-1 of night "GPP". The `cumulative` and `diurnal` diagrams show GPP > 0 at night. `calc.ts` makes its own night-time partitioning from `nee_f`, so its products are not affected.
- Next action: document only. The Variables page should say that Qvidja GPP and Reco are modelled fluxes from a daytime method and do not close with NEE.
- Verify:
  ```sql
  SELECT year(ts_start + INTERVAL 2 HOUR) y, round(100.0*count(*) FILTER (WHERE abs(nee_f-(reco_src-gpp_src))>0.5)/count(*),1) pct FROM 'db/observations.parquet' WHERE site_id=4 AND nee_f IS NOT NULL AND gpp_src IS NOT NULL GROUP BY y ORDER BY y;
  ```

#### QVI-08 precip: rain gauge gap 2021-12-29 to 2022-05-24 is not filled in the file

- Source: `precip` ← `Qvidja_2018-2025.csv`, `P`
- Period: 2021-12-29 to 2022-05-24 (local)
- Observed: 437 of 7 056 periods have `P` (17.7 mm); monthly coverage 2022-01 20 %, 2022-02 to 04 0 %, 2022-05 22 %. Calendar sums: 2022 388 mm at 62.2 % coverage. May-to-May sum 2021-22: 586 mm at 65.7 % coverage. Not flagged (checks A and E skip NULL); found with the annual sums (`annual.csv` 2022 `precip_share` 0.62).
- Expected: Heimsch 2024 p. 4: "rain gauge broke late 2021; Kaarina rain used 29 Dec 2021 to 24 May 2022"; Table 1: 633 mm for 2021-22. The other years agree with Table 1 (2018-19 472 against 473, 2019-20 868 against 855, 2020-21 638 against 640).
- Raw rows: in the raw file. The `P` field is empty in these rows. The Kaarina fill of the article is not in the file. Alternative tested: the file has no `P_QC` or second rain column (28 columns), so the fill cannot sit in another column.
- Control: 2022-23 sum 562 mm against 631 (88.7 % coverage; the 2023-02-11 to 03-01 meteo loss, QVI-09).
- Probable cause: coverage artefact (source gap).
- Status / Severity: known (article), new for the file / S2
- Effect: the website `monthly`, `cumulative` and the daily sums of `precip` in 2022 are too low. `annual.csv` 2022 precip 388 mm is not an annual sum. `calc.ts` does not use `precip`.
- Next action: ask provider (Kaarina rain for 2021-12-29 to 2022-05-24). Mark 2022 precipitation as incomplete on the site.
- Verify:
  ```sql
  SELECT count(precip) n_valid, count(*) n, round(sum(precip),1) mm FROM 'db/observations.parquet' WHERE site_id=4 AND ts_start BETWEEN '2021-12-28 22:00' AND '2022-05-24 21:30';
  ```

#### QVI-09 ta, sw_in, rh, precip, swc, tsoil, netrad, sw_out, ws: all meteorology lost 2023-02-11 to 2023-03-01

- Source: `ta` ← `TA_F`, `sw_in` ← `SW_IN_F`, `rh` ← `RH_F`, `precip` ← `P`, `swc` ← `SM`, `tsoil` ← `TS_1`, `netrad` ← `NETRAD`, `sw_out` ← `SW_OUT`, `ws` ← `WS`
- Period: 2023-02-11 to 2023-03-01 (local), 912 periods
- Observed: `TA_F`, `SW_IN_F`, `RH_F` present in all 912 periods with QC = 1 (filled from FMI); `P`, `SM`, `TS_1`, `NETRAD`, `SW_OUT`, `WS` NULL in all 912; measured NEE 0 periods. Check B flags `rh` = 99.0 for 47 and 39 periods on 2023-02-15 to 17 inside this window (filled values).
- Expected: Heimsch 2024 p. 4: all meteo lost 11 Feb to 1 Mar 2023, FMI data used, PAR = 0.42 × global radiation.
- Raw rows: in the raw file. The rows of 2023-02-11 00:00 to 2023-03-01 23:30 have empty `P`, `SM`, `TS_1`, `NETRAD`, `SW_OUT`, `WS`.
- Control: none needed.
- Probable cause: coverage artefact (instrument failure, station fill for three columns).
- Status / Severity: known / S3
- Effect: `ta`, `sw_in`, `rh` in this window are station values. The 2022-23 May-to-May rain sum is 562 against 631 mm.
- Next action: document only.
- Verify:
  ```sql
  SELECT count(*) n, count(precip) n_p, count(tsoil) n_ts, count(netrad) n_rn, count(ta) n_ta FROM 'db/observations.parquet' WHERE site_id=4 AND ts_start >= '2023-02-10 22:00' AND ts_start < '2023-03-01 22:00';
  ```

#### QVI-10 nee: EC inlet fault 2019-01-05 to 2019-03-28, nearly all NEE removed

- Source: `nee` ← `NEE` where `NEE_QC` = 0; `nee_f` ← `NEE`
- Period: 2019-01-05 to 2019-03-28
- Observed: 105 of 3 984 periods measured (2.6 %) against 21.5 % in Jan to Mar of 2020 to 2023; measured mean 0.68, gap-filled mean 0.47 µmol m-2 s-1 (other winters 0.56 and 0.43); `CO2` mean 412 ppm (p2 405, p98 433) against 427 (414 to 448) in the other winters.
- Expected: Heimsch 2021 p. 4: inlet filter fault, wrong analyser pressure; mixing ratios recalculated with mean CO2 set to 410 ppm.
- Raw rows: in the raw file. `NEE_QC` = 1 in 3 879 of the 3 984 rows.
- Control: the other winters above.
- Probable cause: sensor fault, handled by the provider by removal; `nee_f` is a model in this period.
- Status / Severity: known / S3
- Effect: `nee` is nearly empty on the website for 2019-01 to 03. `nee_f` and the `calc.ts` 2019 sums rest on the gap filler for 12 weeks.
- Next action: document only.
- Verify:
  ```sql
  SELECT count(nee) n_meas, count(*) n FROM 'db/observations.parquet' WHERE site_id=4 AND ts_start BETWEEN '2019-01-04 22:00' AND '2019-03-28 21:30';
  ```

#### QVI-11 nee_f, gpp_src, reco_src: annual sums 40 to 110 g C m-2 more negative than Heimsch 2024 Table 1

- Source: `nee_f` ← `NEE`; `gpp_src` ← `−GPP`; `reco_src` ← `RECO`; `precip` ← `P`; `ta` ← `TA_F`
- Period: years 4 May to 3 May, 2018-19 to 2022-23
- Observed (file, g C m-2 yr-1, NEE / GPP / Reco; article in brackets): 2018-19 −99 / −1142 / 1033 (+10 / −1154 / 1147); 2019-20 −232 / −1469 / 1223 (−190 / −1441 / 1233); 2020-21 −105 / −1395 / 1291 (−80 / −1305 / 1207); 2021-22 −108 / −1259 / 1136 (−69 / −1180 / 1095); 2022-23 −10 / −1096 / 1069 (+45 / −1026 / 1057). NEE differs by −109, −42, −25, −39, −55. Ta agrees (7.5, 7.7, 6.9, 6.6, 6.7 against 7.6, 7.7, 6.8, 6.6, 6.6 °C). Rain agrees where the gauge worked. Calendar years: 2018 −130, 2019 −247, 2020 −118, 2021 −112, 2022 +35, 2023 +89, 2024 +34, 2025 −14 (`annual.csv` agrees). Summer midday measured NEE median 2018 to 2022: −6.8 µmol m-2 s-1 (n 1 530) against −8.4 ± 3.9 in Ke 2025 p. 11.
- Expected: Heimsch 2024 Table 1 (XGBoost). Heimsch 2021 Table 2 (regression gap filling) gives −62 and −216 for the first two years, closer to the file. Vira 2025 p. 5: the data were reprocessed (EddyPro 7.0.9, neural-network ensembles) and the results "did not change significantly".
- Raw rows: in the raw file. The sums come from `NEE`; the Parquet sums are equal.
- Control: GPP agrees within 12 to 90 g C. The Reco difference changes sign (2018-19 −114, 2020-21 +84), so the file is a different processing version, not a unit or sign problem.
- Probable cause: gap-filling or partitioning artefact (different processing version from the published one). Alternative tested (a different year window): the sums above use the article window, 4 May 00:00 to 3 May 24:00 local, the same as Heimsch 2024 Table 1; the file starts on 2018-05-09, so the first year lacks 5 days, which cannot explain −109 g C m-2. All five May-to-May sums of the database equal the file (−99, −232, −105, −108, −10). The window is not the cause.
- Status / Severity: open question / S2
- Effect: the website `budget` and `cumulative` diagrams and the `calc.ts` NECB for Qvidja give a stronger sink than the article in every year. The five-year NEE sum of the file is −554 g C m-2 against −284 in Heimsch 2024 p. 7.
- Next action: ask provider (which processing version is `Qvidja_2018-2025.csv`: Heimsch 2024 XGBoost, or the Vira 2025 reprocessing?).
- Verify:
  ```sql
  SELECT round(sum(nee_f)*1800*12.011e-6,0) nee_gc FROM 'db/observations.parquet' WHERE site_id=4 AND ts_start >= '2018-05-03 22:00' AND ts_start < '2019-05-03 22:00';
  ```

#### QVI-12 tsoil, netrad, sw_in, sw_out: sensors out of order from 2025-10-26 / 2025-11-01 to about 2025-12-22

- Source: `sw_out` ← `SW_OUT`; `sw_in` ← `SW_IN_F`; `netrad` ← `NETRAD`; `tsoil` ← `TS_1` (also `TS_2`, `TS_3`)
- Period: 2025-10-26 09:30 to 2025-12-28 00:00 UTC (radiation); 2025-11-01 11:00 UTC to about 2025-12-21 (soil temperature, net radiation)
- Observed: `SW_OUT` NULL and `SW_IN_F_QC` = 1 in 2 737 periods between 2025-10-26 11:30 and 2025-12-28 02:00 local. `NETRAD` night median per week: −36.8 to −7.2 W m-2 until 2025-10-27, then +21.3, 0.0, +9.2, +9.0, +19.9, +16.5, +31.5 (weeks of 2025-11-03 to 12-15), then −44.2 (12-22). Soil temperature on 2025-11-01, 12:30 local: `TS_1` 8.36, `TS_2` 8.47, `TS_3` 8.37; 13:00: 15.98, 15.79, 15.44; 13:30: 12.62, 12.59, 12.30; the three depths move together. After the jump the 30-cm daily range is 1.0 to 1.9 °C (2024: 0.2 to 0.6) and corr(`TS_1`, `TA_F`) per week 0.62 to 0.90 (2024: −0.11 to 0.54); weekly medians `TS_1` 9.7, 7.9, 2.8, 2.8, 6.0, 5.1, 7.2 follow `TA_F` 10.9, 6.3, 0.9, 3.1, 6.4, 3.8, 8.1. `SM`, `TA_F` (QC 0), `NEE` and `USTAR` continue.
- Expected: net radiation at night is negative (−6 to −29 W m-2 in Nov to Dec of 2018 to 2024). A 30-cm soil temperature changes by less than 0.5 °C per day. The article period ends 2023-12-19 (Vira 2025); the file continues to 2025-12-31.
- Raw rows: in the raw file. `202511011200` `TS_1` 6.38, `TS_3` 6.51, `TA_F` 7.935; `202511011230` 8.36, 8.37, 9.155; `202511011300` 15.98, 15.44, 12.69; `202511011330` 12.62, 12.30, 10.965.
- Control: the same weeks of 2024 (above). Haltiala and Viikki `tsoil` 2025-12 medians 3.4 and 3.9 °C (warm December) against Qvidja 5.3 = Qvidja `ta` 5.1.
- Probable cause: sensor fault. The soil probes were taken out of the soil and the radiometers were disconnected or covered (station work on 2025-11-01). The pattern looks like probes lying in the air. Alternative tested (a station fill of `TS_1` from the air temperature): `TS_1` equals `TA_F` in 0 of the 3 006 periods of the window, and the file has no `TS` QC column, so the values are a sensor signal that follows the air, not a copy of `TA_F`.
- Status / Severity: new / S2
- Effect: `tsoil` 2025-11-01 to about 2025-12-21 is air temperature, not soil temperature (website, export). `netrad` in the same weeks is wrong. `sw_in` is a station fill and `sw_out` is missing 2025-10-26 to 12-28. The 2025 Qvidja night definition in `calc.ts` rests on filled radiation for two months.
- Next action: ask provider (what happened on 2025-11-01; are `TS_1` to `TS_3` and `NETRAD` valid after that date?). Add build rule after the answer (`tsoil` and `netrad` NULL from 2025-11-01 11:00 UTC to 2025-12-21 22:00 UTC).
- Verify:
  ```sql
  SELECT count(*) n, count(SW_OUT) n_swout, count(*) FILTER (WHERE SW_IN_F_QC::DOUBLE = 1) n_swin_gf FROM (SELECT DISTINCT ON (TIMESTAMP_START) * FROM read_csv('data/Qvidja/Qvidja_2018-2025.csv', all_varchar=true, nullstr='')) WHERE TIMESTAMP_START BETWEEN '202510261130' AND '202512280200';
  ```

#### QVI-13 sw_in, sw_out, netrad: snow on the radiometer domes in winter

- Source: `sw_in` ← `SW_IN_F`; `sw_out` ← `SW_OUT`; `netrad` ← `NETRAD`
- Period: December runs 2018 to 2025 (M, 9 episodes), 2022-04-06, 2020-11-20, 2019-03-31 (A, netrad < −200), winter months (F8, D ratios)
- Observed: 2022-12-07 to 12-22: Qvidja daily maximum `sw_in` 7 to 28 W m-2 with `ta` −1 to −13 °C and daily albedo 1.0 to 4.4 (`sw_out` > `sw_in`), while Viikki has 86 (12-09), 70, 50, 78 (12-14 to 16) and Anttila and Särkisuo 54 to 65. December days with maximum `sw_in` < 30: Qvidja 11 to 23 of 31 per year, Haltiala and Viikki together 20 to 32 of 62 site-days. 2022-04-06 10:00 to 13:30 local: `NETRAD` −141 to −343 W m-2 with `SW_IN_F` 122 to 620, `SW_OUT` 229 to 435 and `TA_F` −1.5 to +0.8 (snow). `sw_out` > `sw_in` with `sw_in` > 50 in 154 periods, 149 of them at `ta` ≤ 2 °C. Winter albedo 0.56 to 0.65 with midday netrad / sw_in 0.02 to 0.12; snow-free months 0.17 to 0.31 with 0.44 to 0.65. The D ratio flags compare with one other site (Viikki albedo 0.10 to 0.14 against Qvidja 0.19 to 0.29).
- Expected: snow albedo 0.6 to 0.9 and low net radiation are physical. Albedo above 1 is not: snow or frost on the upward CMP3 dome lowers `sw_in` for days.
- Raw rows: in the raw file. `202204061100` `NETRAD` −312.49, `SW_IN_F` 401.03 (QC 0), `SW_OUT` 403.92, `TA_F` −0.64; `202204061130` −342.83, 620.04, 434.52, −0.28.
- Control: Viikki, Anttila, Särkisuo as above.
- Probable cause: sensor fault (snow on the dome) on top of a real snow cover. The D ratio flags are a false positive (the Viikki reference albedo 0.10 to 0.14 is the odd value; Qvidja grass albedo 0.2 is normal).
- Status / Severity: verified / S3
- Effect: a few winter days per year have `sw_in` too low and `netrad` too negative. The `calc.ts` night definition `sw_in <= 20` turns such days into "night" (the daytime NEE is then partitioned as Reco).
- Next action: document only (a rule could set `sw_in` and `netrad` to NULL where `sw_out` > `sw_in` and `sw_in` > 50).
- Verify:
  ```sql
  SELECT count(*) n, count(*) FILTER (WHERE ta <= 2) n_cold FROM 'db/observations.parquet' WHERE site_id=4 AND sw_out > sw_in AND sw_in > 50;
  ```

#### QVI-14 ta, tsoil, sw_in, netrad, le, nee_f, gpp_src: monthly level shifts are weather and management

- Source: `ta`, `tsoil`, `sw_in`, `netrad`, `le`, `nee_f`, `gpp_src`, `ws`, `vpd` ← `TA_F`, `TS_1`, `SW_IN_F`, `NETRAD`, `LE_F`, `NEE`, `GPP`, `WS`, `VPD_F`
- Period: 2018-05 to 2025-08 (39 D months without `swc`, `rh` and the ratios)
- Observed (monthly medians, Qvidja against its other years; other sites in brackets): 2018-05 TA 16.6 against 9.5, SW_IN 477 against 352, LE 137 against 54 W m-2 (May 2018 heat; Heimsch 2021 p. 6: May to Sep 2018 16.7 °C). 2018-07 TS 22.3 against 16.8 with `TS_1` up to 37.9 °C at 5 cm (TA 32.5, short grass after the 2018-07-16 fertilisation). 2021-02 TA −5.9 against −0.3 (cold February 2021). 2023-07 TA night 12.4 against 15.7 (Haltiala 16.6 against 19.1). 2023-09 `nee_f` day +1.3 against −6.3: harvest 2023-08-22, compost 08-30, subsoiling 09-07. 2024-05 TA 13.1 against 9.5 (Haltiala 13.8 against 10.4). 2025-06 `nee_f` day −12.0 against −4.5 and `gpp_src` 22.7 against 11.6: measured midday NEE median −19.6 (n 125); June sum −166 g C m-2 (other years −39 to −94); the uptake is in the measured data. 2021-10 WS 2.79 against 1.70 m s-1 (no other site with `ws` in 2021; not resolved).
- Expected: the same sign at the other sites in the same month, or an event in `db/events.parquet`.
- Raw rows: the medians come from the raw columns.
- Control: as listed.
- Probable cause: real event (weather, management, crop growth); false positive of check D.
- Status / Severity: real event / S4
- Effect: none.
- Next action: document only.
- Verify:
  ```sql
  SELECT round(median(nee) FILTER (WHERE nee_qc = 0),1) midday_meas, count(nee) n FROM 'db/observations.parquet' WHERE site_id=4 AND ts_start BETWEEN '2025-05-31 22:00' AND '2025-06-30 21:30' AND hour(ts_start + INTERVAL 2 HOUR) BETWEEN 10 AND 13;
  ```

#### QVI-15 all columns: duplicate rows 2018 to 2023 and `ustar` conflicts

- Source: all columns ← `Qvidja_2018-2025.csv`
- Period: 2018-05-09 to 2023-12-31
- Observed: every 2018 to 2023 stamp appears twice. The two copies differ in `USTAR` in 76 268 periods (also `H`, `CO2`). The first row wins. Not flagged (the build deduplicates).
- Expected: one row per stamp.
- Raw rows: in the raw file.
- Control: none needed.
- Probable cause: export of the provider.
- Status / Severity: handled in build (`docs/harmonised-database.md`, rule 3) / S4
- Effect: none on the Parquet. A raw-file user must deduplicate.
- Next action: ask provider (which `USTAR` copy is right). Document only.
- Verify:
  ```sql
  SELECT count(*) - count(DISTINCT TIMESTAMP_START) FROM read_csv('data/Qvidja/Qvidja_2018-2025.csv', all_varchar=true);  -- 103 447
  ```

#### QVI-16 swc: readings in frozen soil are not reliable (ML3 manual); the build keeps them

- Source: `swc` ← `Qvidja_2018-2025.csv`, `SM` (converted with the ML3 polynomial since 2026-10-22); `tsoil` ← `TS_1` (5 cm)
- Period: winters 2018-19 to 2025 (first value 2018-11-25, last 2025-12-31)
- Observed: 17 950 of 124 023 Qvidja `swc` values (14.5 %) have `tsoil` ≤ 0 °C; 17 606 of them have `tsoil` < 0 °C. The build keeps all of them.
- Expected: Delta-T ML3-UM-2.1 (January 2017), p. 28: "ML3 soil moisture readings cannot be interpreted reliably when inserted into soil below 0°C." Ice has a much lower permittivity than liquid water, thus θ reads too low in frozen soil.
- Raw rows: in `db/observations.parquet` (query below).
- Control: QVI-03 shows the drops of 0.3 to 0.4 V in the same periods.
- Probable cause: sensor physics (see QVI-03). Not a data error, but the values do not give the water content.
- Status / Severity: open (decision pending) / S2
- Effect: winter `swc` means and minima of Qvidja on the website and in the export are too low.
- Next action: decide if the build sets `swc` to NULL where `tsoil` ≤ 0 °C (or < 0 °C). The same rule can apply to the other mineral-soil sites. No question to the provider is necessary.
- Verify:
  ```sql
  SELECT count(*) n, count(*) FILTER (WHERE tsoil < 0) n_lt0, min(ts_start), max(ts_start) FROM 'db/observations.parquet' WHERE site_id = 4 AND swc IS NOT NULL AND tsoil <= 0;  -- 17 950, 17 606, 2018-11-25, 2025-12-31 (build of 2026-10-22)
  ```

### Viikki

Files: `data/Viikki/EC/<year>.csv` (stamp `Datetime`) and `data/Viikki/pit1_cleaned_<year>.csv` (stamp `TIMESTAMP`, 5-minute period end).

#### VII-01 all columns: raw time stamps are UTC, the build adds 2 hours

- Source: all columns ← EC `Datetime` and pit `TIMESTAMP`
- Period: 2022-01-01 to 2025-12-31 (all years, all months)
- Observed: in the raw EC file the daily centroid of `SWin (W/m2)` (days with maximum > 200 W m-2, median per month) is 10.1 to 10.4 on the raw stamp axis in all years: March 10.24 to 10.39, June 10.10 to 10.27, September 10.09 to 10.28. The `PAR` centroid is 0.05 to 0.1 h earlier. The first hour with SWin > 10 W m-2 in June is 1.5 on the raw axis (astronomical sunrise 3.08 local). The hourly mean of the measured NEE has its minimum at raw hour 9 to 12 (June, July), the same hour as the PAR maximum. The offset is the same in March, June and September, thus it is not daylight saving time. In the database the Haltiala and Qvidja peak is at 12.0 local, Viikki at 10.5.
- Expected: solar noon at 25.02 °E is 10:20 UTC = 12:20 UTC+2. On an axis of period-start stamps the centroid is solar noon minus 15 min: UTC 10.08 to 10.23, UTC+2 12.08 to 12.23; period-end stamps UTC 10.58 to 10.73. The raw values match UTC with period-start stamps (difference 0 to +0.15 h). Vettikkat 2026 p. 6 says "all times are in UTC+2"; the pit metadata says `TIMESTAMP` UTC+2. The data do not follow this statement.
- Raw rows: in the raw file (the stamp convention); the build applies UTC+2 (`utcOffsetMin: 120`, `timestampIsEnd: false`). `data/Viikki/EC/2023.csv`, clear day 29.6.2023, `SWin (W/m2)`: `8:00` 688,54; `9:00` 798,04; `10:00` 862,53; `11:00` 207,31 (cloud); `12:00` 675,42.
- Control: the pit file shares the clock of the EC file. EC `T1 (?C)` and the pit 30-minute mean of `Temp_T12_Avg_1` agree at lag 0 (RMSE 0.047 °C in 2023, 0.028 in 2024, 0.079 in 2025; at ±1 period 0.12 to 0.35). `HF (W/m2)` and `shf_plate_Avg` agree at lag 0 too. The pit layer-1 daily maximum is at raw hour 16 to 18 (June, July) and `shf_plate_Avg` at 12 to 14: on a UTC axis this is 18 to 20 and 14 to 16 local, normal for 14 cm depth and a heat flux plate; on a UTC+2 axis the plate would peak before solar noon.
- Probable cause: time-stamp problem. The source files stamp the period start in UTC; the registry and the article say UTC+2. Alternative tested: UTC+2 with period-end stamps would give a centroid of 12.6 to 12.7; the yearly June centroid on the raw axis is 10.19, 10.07, 10.29, 10.32 (2022 to 2025) and the December centroid 9.98, 9.96, 10.13, 10.08. Every year and both seasons follow UTC with period-start stamps.
- Status / Severity: new (verified) / S1
- Effect: all Viikki rows of `db/observations.parquet` have `ts_start` 2 hours too early. The website shows Viikki 2 hours early in every diagram with a time axis and in the alt text. The diurnal statistics of the scan (N, P, F7 night window) are shifted. The data export `ts_start_utc` and `ts_local` are wrong by 2 hours. `scripts/calc.ts` uses `ppfd` from the same file for the night test, so the day and night split is not changed, but the comparison with other sites at a given hour is. Daily, monthly and annual sums change little.
- Next action: ask provider (are the `Datetime` and pit `TIMESTAMP` columns UTC or UTC+2, and do they mark the period start?). Then add build rule: stamp offset 0 min for the Viikki sources.
- Verify:
  ```sql
  WITH d AS (SELECT month(t) AS mo, date_trunc('day', t) AS d, sum((hour(t) + minute(t)/60.0) * s) FILTER (WHERE s > 0) / sum(s) FILTER (WHERE s > 0) AS c, max(s) AS mx, count(s) AS n
    FROM (SELECT strptime("Datetime", '%d.%m.%Y %H:%M') AS t, try_cast(replace("SWin (W/m2)", ',', '.') AS DOUBLE) AS s FROM read_csv('data/Viikki/EC/2023.csv', delim=';', header=true, all_varchar=true, encoding='latin-1')) GROUP BY 1,2)
  SELECT mo, count(*) AS days, round(median(c),2) AS centroid_raw_axis FROM d WHERE mx > 200 AND n >= 46 AND mo IN (3,6,9) GROUP BY 1 ORDER BY 1;
  -- 10.25, 10.10, 10.13; expected 12.1 to 12.2 for UTC+2 period-start stamps
  ```

#### VII-02 sw_in, sw_out: negative night values of the radiometer

- Source: `sw_in` ← `SWin (W/m2)`, `sw_out` ← `Swout (W/m2)` / `SWout (W/m2)`
- Period: 2022-01-01 to 2025-12-31, every night
- Observed: the night median of `SWin` (PAR ≤ 0) is −6.8 (2022), −7.7 (2023), −7.5 (2024), −6.5 (2025) W m-2; of `Swout` −4.4, −5.7, −5.2, −4.5. Values below −10 occur only at night or at dawn (0 of the 2 062 `sw_in` periods below −10 have PAR > 40). By day (SWin > 50) `sw_out` is negative in 27 to 35 periods per year, minimum −4.45 W m-2. The strongest offsets (−19.8 W m-2 on 2025-12-15) occur at RH 100 % and 2 to 3 °C (dew or frost on the domes). Effect on the annual mean: `sw_in` −2.9 to +1.9 W m-2 when negative values are clipped to 0 (mean 105 to 120); `sw_out` +0.8 to +2.5 W m-2 (mean 16 to 28). The F2 flags (20 months, daily ratio 2.4 to 6.7) come from this offset; with SWin > 50 the median ratio `ppfd/sw_in` is 2.0 to 2.2 in every month.
- Expected: 0 at night. Night offsets of −2 to −5 W m-2 are typical for a thermopile pyranometer. `LWin (W/m2)` is −30 to −47 W m-2 at night (the raw thermopile signal), thus the sensor is a four-component net radiometer with unheated domes.
- Raw rows: in the raw file. `data/Viikki/EC/2025.csv`, `SWin`, `SWout`: `15.12.2025 3:00` −19,5 −18,65; `7:00` −17,89 −17,99; `9:00` −2,15 −13,57; `10:00` 3,16 −8,31.
- Control: the PAR sensor of Viikki has a night offset of −0.17 µmol m-2 s-1 only (`fill-values.md`).
- Probable cause: sensor fault (thermopile offset, cosmetic).
- Status / Severity: verified / S4 (daytime values are correct; night values −5 to −20 W m-2)
- Effect: daily and monthly means of `sw_in` are 2 to 3 W m-2 too low in winter, `sw_out` 1 to 2 W m-2 too low. The website shows negative radiation at night. `calc.ts` uses `ppfd` for the night test. The data export keeps the negative values.
- Next action: document only (a rule could set `sw_in` and `sw_out` to 0 where the value is negative and `ppfd` ≤ 0).
- Verify:
  ```sql
  SELECT year(ts_start) AS yr, round(median(sw_in) FILTER (WHERE ppfd <= 0), 2) AS night_sw_in, count(*) FILTER (WHERE sw_out < 0 AND sw_in > 50) AS sw_out_neg_by_day, count(*) FILTER (WHERE sw_in < -10 AND ppfd > 40) AS sw_in_below_m10_by_day FROM 'db/observations.parquet' WHERE site_id = 5 GROUP BY 1 ORDER BY 1;
  ```

#### VII-03 tsoil: constant values near 0 °C in frozen soil

- Source: `tsoil` ← pit `Temp_T12_Avg_1` (2023 to 2025), EC `T1 (?C)` (2022)
- Period: 2022-12-18 to 2022-12-23, 2023-11-29 to 2024-03-28, 2025-01-05 to 2025-03-06 (105 runs of 48 to 534 periods; 894 periods with exact 0)
- Observed: in the run 2024-01-27 to 2024-02-07 (534 periods) all 3 204 raw 5-minute values of `Temp_T12_Avg_1` are exactly 0.2; layer 2 is 0.3; `WC1` is 0.170 to 0.204 m³ m⁻³ (the unfrozen water); EC `T1 (?C)` is 0,2 in all 534 periods; air temperature mean −0.7 °C, minimum −11.4 °C, snow depth 43 cm. The runs 2023-12-17 to 12-26 (0.2) and 2025-01-05 to 01-16 (0.6) look the same. Exact 0 in the pit: 3 209 (2023), 1 794 (2024), 686 (2025) 5-minute rows, all in winter.
- Expected: the Teros-12 resolution is 0.1 °C. Soil at 14 cm under snow stays at the freezing point (zero curtain) for weeks. `WC1` drops from 0.42 to 0.17 with the freezing, as Heimsch 2021 p. 6 describes for Qvidja.
- Raw rows: in the raw file and physical. `pit1_cleaned_2024.csv`: `2024-01-27 09:30:00` 0.2, WC1 0.1701928; `2024-02-07 12:30:00` 0.2, 0.1996732.
- Control: the same sensor in summer gives 2 to 6 distinct values per hour. The winter runs end when the air temperature stays above 0 °C.
- Probable cause: real event (frozen soil at the sensor depth). False positive of check B.
- Status / Severity: real event / S4
- Effect: none. The D flags of `swc` in 2022-12 (0.29), 2023-04 (0.13) and 2023-12 (0.24, against 0.39 to 0.47 in other years) are the same freezing effect plus the dry bare-soil spring 2023 (Sirola 2024; 12 mm rain in April 2023).
- Next action: document only.
- Verify:
  ```sql
  SELECT count(*) AS n5min, count(DISTINCT Temp_T12_Avg_1) AS distinct_values, min(WC1), max(WC1) FROM read_csv('data/Viikki/pit1_cleaned_2024.csv', all_varchar=true) WHERE "TIMESTAMP" > '2024-01-27 09:30:00' AND "TIMESTAMP" <= '2024-02-07 12:30:00';
  ```

#### VII-04 tsoil: pit layer-1 temperature spikes after field work in 2025

- Source: `tsoil` ← pit `Temp_T12_Avg_1` (14 cm)
- Period: 2025-05-09 to 2025-05-12, 2025-06-03, 2025-08-28 to 08-29, 2025-09-22 to 09-24 (7 step flags; 34 days with affected periods)
- Observed: on 2025-05-09 the 5-minute `Temp_T12_Avg_1` rises from 5.36 (09:20) to 7.87, 10.48, 13.16, 15.17 °C (09:25 to 09:40) and falls back to 8.4 by 10:35. The Teros-21 of the same layer jumps too (5.4 to 15.9 °C); layer 2 stays at 5.5 °C; `WC1` is empty in the same rows. The daily range of layer 1 is −2.9 to 21.0 °C on 2025-05-09 to 05-12 (layer 2: 6 to 8 °C), 11.1 to 28.9 °C on 2025-08-28, 3.2 to 21.4 °C on 2025-09-24. In 2025, 1 440 30-minute periods on 34 days have a layer-1 temperature but fewer than 3 `WC1` values; in 340 of them layer 1 differs from layer 2 by more than 5 °C (maximum 15.4 °C; with WC1 present the maximum is 6.2 °C).
- Expected: at 14 cm depth the daily range is 2 to 4 °C. `db/events.parquet`: tillage 2025-05-08 to 05-09, fertilisation 2025-05-10, harvest 2025-09-10. Sirola 2024 p. 3: the pit data "are not cleaned, so there may be error values seen as extra spikes".
- Raw rows: in the raw file. `pit1_cleaned_2025.csv` (`Temp_T12_Avg_1`, `Temp_T21_Avg_1`, `WC1`): `2025-05-09 09:20:00` 5.359, 5.438, 0.2865628; `09:30:00` 10.48, 15.01, empty; `09:40:00` 15.17, 14.59, empty; `09:45:00` 12.94, 13.24, 0.3272923. The EC file `T1 (?C)` shows the same spike (`9.5.2025 9:30` = 12).
- Control: 2023 and 2024 have no step flag. The layer difference stays below 3.5 °C when WC1 is present.
- Probable cause: sensor fault (the layer-1 probes were exposed or disturbed by the tillage on 2025-05-08/09 and by the work in August and September). The cleaned file removed `WC1` in these rows but kept the temperature.
- Status / Severity: new (verified) / S3 (340 periods with a clear error, 1 440 doubtful, 2 % of 2025)
- Effect: `tsoil` of Viikki 2025 has spikes up to 29 °C; daily means of the affected days are 2 to 5 °C too high. `calc.ts` fits Reco on `ta`, not `tsoil`.
- Next action: ask provider (was the pit disturbed in May, August and September 2025?). A rule could set `tsoil` to NULL where the pit has fewer than 3 `WC1` values in the period, or where layer 1 differs from layer 2 by more than 5 °C.
- Verify:
  ```sql
  SELECT "TIMESTAMP", Temp_T12_Avg_1, Temp_T21_Avg_1, Temp_T12_Avg_2, WC1 FROM read_csv('data/Viikki/pit1_cleaned_2025.csv', all_varchar=true) WHERE "TIMESTAMP" BETWEEN '2025-05-09 09:15:00' AND '2025-05-09 09:50:00' ORDER BY 1;
  ```

#### VII-05 nee, nee_f: the 2024 gap-filled series does not copy the measured values

- Source: `nee` ← `NEE (mg CO2 m-2 s-1)`, `nee_f` ← `NEE _gapfilled (mg CO2 m-2 s-1)` (2024 name)
- Period: 2024-01-01 to 2024-12-31
- Observed: in the raw 2024 file the two columns differ in 1 540 of the 4 206 periods with a measured value (every month; in 2023-12 and 2025-01 they differ in 0 periods). The ratio gap-filled / measured has a median of 0.16 (January), 0.46 (February, March), 0.81 (April) and 0.96 to 1.03 (May to December); the correlation is 0.81 to 0.99. The 98th percentile of |NEE| is 1.8 µmol m-2 s-1 in 2024-12, 0.8 in 2023-12 and 2.2 in 2025-01: no change of magnitude or unit in December 2024. In 2025, 228 periods differ (registry note), 6 % of the measured periods.
- Expected: a gap-filled series copies the measured value where it exists (2022, 2023, 2025-01 onwards). Annual effect: the sum of `nee_f` 2024 is 20.4 g C m-2 (`annual.csv`); with the measured value where it exists, 22.5 g C m-2.
- Raw rows: in the raw file. `data/Viikki/EC/2024.csv`, `NEE`, `NEE _gapfilled`: `12.10.2024 10:30` 0,538122461 0,174723177; `12.6.2024 13:30` −0,165238538 −0,444759911.
- Control: 2022 and 2023 have 0 differing periods. The claim of an earlier session "NEE unit change in December 2024" is not confirmed.
- Probable cause: gap-filling artefact (the 2024 gap-filled column is a model output for all periods, not measured-plus-filled; the 2025 file restores the copy).
- Status / Severity: known (registry note), verified / S3 (annual sum differs by 2 g C m-2)
- Effect: `nee_f` 2024 differs from `nee` in 1 540 periods; `nee_qc` = 0 marks them as measured; the website shows two different lines. `calc.ts` uses `nee_f` for the Viikki annual sums (20.4 instead of 22.5 g C m-2). The D flags of `nee_f` are real: 2022-06 day median −10.9 (timothy before the first cut), 2023-08 +0.8 (barley harvest 2023-08-17), 2024-10 +3.5 (manure and tillage 2024-10-09).
- Next action: ask provider (why does the 2024 gap-filled NEE not copy the measured values; is a newer 2024 file available?). Document only until then.
- Verify:
  ```sql
  SELECT count(*) FILTER (WHERE nee IS NOT NULL AND abs(nee - nee_f) > 0.01) AS n_differ, round(sum(nee_f) * 1800 * 12.011e-6, 1) AS sum_nee_f, round(sum(coalesce(nee, nee_f)) * 1800 * 12.011e-6, 1) AS sum_measured_else_f FROM 'db/observations.parquet' WHERE site_id = 5 AND year(ts_start + INTERVAL 2 HOUR) = 2024;  -- 1540, 20.4, 22.5 (local year; the UTC year gives 20.5 and 22.6)
  ```

#### VII-06 n2o: unit of the N2O columns and the size of the 2022 emission

- Source: `n2o` ← `N2O_gapfilled (ug m-2 s-1)` × 1000 / 44.013 (assumption: µg N2O)
- Period: 2022-05-01 to 2022-06-30 (D flags, day and night medians 3.2 to 4.7 nmol m-2 s-1 against 0.3 to 0.5 in other years), 2023-09 (1.1 to 1.2 against 0.05 to 0.09), and the annual sums
- Observed: annual sums in the database (µg N2O assumption): 2022 16.8 kg N2O ha-1 (10.7 kg N ha-1), 2023 5.6, 2024 4.6, 2025 6.4 kg N2O ha-1. Daily mean peak 38.5 nmol m-2 s-1 on 2022-06-06, 30-minute maximum 59.4 nmol (raw 2.613 µg m-2 s-1). Anttila: 3.85 kg N2O ha-1 (2022), daily peak 14.0 nmol; Särkisuo (peat): 16.0 and 11.3 kg N2O ha-1, daily peaks 28 to 35 nmol. The 2022-05 and 2022-06 medians follow the fertilisation of 2022-05-10 (108 kg N ha-1); the 2023-09 rise follows the barley harvest.
- Expected: Shurpali 2025 p. 6: Anttila 3.8 kg N2O ha-1 (the database gives 3.85, so the Anttila unit chain is right). The Viikki 2022 sum equals 9.9 % of the applied N as N2O-N (Anttila: 0.18 % of N after the first fertilisation). If the header unit were µg N2O-N, the values would be 1.57 times larger (26 kg N2O ha-1, 16 % of the applied N), less plausible. If the header unit were ng, the values would be 1 000 times smaller, which does not fit the background of 0.1 nmol (the same as Anttila).
- Raw rows: in the raw file header, if any. `N2O_gapfilled (ug m-2 s-1)` per year: median 0.0047 (2022), 0.0103, 0.0044, 0.0074; 98th percentile 0.456 (2022), 0.084, 0.128, 0.198; maximum 2.613 (2022), 0.182, 0.601, 0.935. The measured column `N2O (ug m-2 s-1)` has the same maximum.
- Control: the background level (0.1 to 0.2 nmol) matches Anttila and Särkisuo under the µg N2O assumption. The clay soil at Viikki is wet (`WFPS1` about 100 %), which supports high N2O after mineral N.
- Probable cause: unit or scale problem (open) or real event. The µg N2O assumption gives the smaller of the two possible values and the same background as the ICOS sites. Alternative tested: the nine articles in `data/articles/` give no Viikki N2O sum, range or analyser, so the unit cannot be settled from the articles; the Qvidja chamber N2O of Heimsch 2024 (peaks 0.33 to 0.38 µg m-2 s-1 one day after fertilisation) is of the same order as the Viikki 98th percentile of 2022 (0.456 µg m-2 s-1) under either unit.
- Status / Severity: open question / S1 if the unit is wrong (factor 1.57), else none
- Effect: `n2o` of Viikki, the website N2O panels, the data export. `calc.ts` does not use N2O.
- Next action: ask provider (is the N2O unit µg N2O or µg N2O-N per m2 and s; which analyser; was the 2022 emission after the 108 kg N fertilisation real?).
- Verify:
  ```sql
  SELECT site_id, year(ts_start) AS yr, round(sum(n2o) * 1800 * 44.013e-9 * 10, 2) AS kg_n2o_per_ha, round(max(n2o), 1) AS max_nmol FROM 'db/observations.parquet' WHERE n2o IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;
  ```

#### VII-07 ta, tsoil, swc, ws, rh, sw_in, ppfd, sw_out: monthly level shifts are weather and management

- Source: `ta`, `tsoil`, `swc`, `ws`, `rh`, `sw_in`, `ppfd`, `sw_out`, `sw_out/sw_in`
- Period: 68 D flags, 2022-01 to 2025-12
- Observed (monthly means, local months): September 2022 ta 9.8 °C, tsoil 10.0 °C against 13.8 to 15.2 and 14.1 to 15.3 in 2023 to 2025; October 2023 ta 5.1 °C, 146 mm rain, swc 0.47 against 7.5 to 8.3 °C, 50 to 86 mm, 0.31 to 0.41; May 2024 ta 13.5 °C, 3 mm rain, rh 57 % against 9.4 to 10.6 °C, 19 to 50 mm, 63 to 66 %; June 2023 tsoil 17.9 °C with 2 mm rain and bare soil after the barley sowing of 2023-05-25; June 2025 ta 14.3 °C, 111 mm rain, sw_in by day 311 and ppfd 631 against 411 to 419 and 837 to 877 (both sensors lower by the same 25 %); March 2022 sw_out/sw_in 0.63 with 47 cm snow; the low ratios 0.09 to 0.17 in April against 0.19 to 0.56 at the other sites are the dark wet clay of Viikki.
- Expected: the reference of check D is the median of only 3 other years, with a MAD floor of 2 × resolution, so a normal cold or warm month is flagged. The tsoil sensor is the same in all years (EC `T1` = pit layer 1 at lag 0).
- Raw rows: not needed; the means come from `db/observations.parquet` and `db/events.parquet`.
- Control: the flagged months move together in ta, tsoil, swc and rain.
- Probable cause: real event (weather and the crop and tillage history of each year).
- Status / Severity: real event / S4
- Effect: none.
- Next action: document only.
- Verify:
  ```sql
  SELECT year(ts_start + INTERVAL 2 HOUR) AS yr, round(avg(ta), 1) AS ta, round(avg(tsoil), 1) AS tsoil, round(sum(precip), 0) AS p_mm FROM 'db/observations.parquet' WHERE site_id = 5 AND month(ts_start + INTERVAL 2 HOUR) = 9 GROUP BY 1 ORDER BY 1;
  ```

#### VII-08 rh, ta: the 2024 file has a coarser resolution

- Source: `rh` ← `RH (%)`, `ta` ← `Tair (?C)`
- Period: 2024-01-01 to 2024-12-31
- Observed: the 2024 file has 268 distinct RH values and 532 distinct Tair values; 2022: 5 335 and 3 633, 2023: 5 550 and 3 610, 2025: 725 and 3 538. The 2024 rows give RH as integers (`85`) and Tair with one decimal (`-16,7`); 2022 gives `92,43` and `-0,95`. Runs of 99 % and 100 % (20 runs, 21 to 37 periods) occur in fog and in winter and last 10 to 18 hours.
- Expected: the HMP110 and Rotronic HC2 give 0.1 % and 0.01 °C. Saturated nights of 10 to 18 hours are normal in Helsinki winters.
- Raw rows: in the raw file. `data/Viikki/EC/2024.csv`: `1.1.2024 0:00` RH 85, Tair −16,7; `0:30` 85, −16,8.
- Control: 2022, 2023 and 2025 have no `rh` run flag.
- Probable cause: source artefact (the 2024 file was rounded before delivery). The runs themselves are real saturation.
- Status / Severity: source artefact / S4
- Effect: `rh` 2024 is in steps of 1 %, `ta` 2024 in steps of 0.1 °C. No effect on the products.
- Next action: document only.
- Verify:
  ```sql
  SELECT count(DISTINCT rh) AS distinct_rh, count(DISTINCT ta) AS distinct_ta FROM 'db/observations.parquet' WHERE site_id = 5 AND year(ts_start + INTERVAL 2 HOUR) = 2024;  -- 268, 532 (local year; the UTC year adds 4 periods of 2023 and gives 271, 535)
  ```

### Maktau

Files: `data/Maktau/Maktau_meteo_30_min_KE-Mkt.csv` (M) and `data/Maktau/Continuous_KE-Mkt.csv` (C). `annual.csv` has no `nee_f` sum for Maktau: the site has measured `FC` only, so no comparison with an article is possible.

#### MKT-01 all meteo columns: the logger stored day-time rows only from 2023-07 to 2024-01

- Source: `ta`, `rh`, `tsoil`, `swc`, `sw_in`, `precip`, `g`, `ws` ← M and C `TA_1_1_1`, `RH_1_1_1`, `TS_1_1_1`, `SWC_1_1_1`, `SW_IN_1_1_1`, `P_RAIN_1_1_1`, `G_1_1_1`, `WS_1_1_1`
- Period: 2023-02-24 to 2024-02-29; night rows missing from 2023-07-01 to 2024-01-31 (local hours 17 to 06)
- Observed: in the meteo file the logger fill rows (`TA_1_1_1` = 0 and `RH_1_1_1` = 0) are 1 256 of 1 488 rows in 2023-03, all rows in 2023-04 to 2023-06, 911 to 1 306 rows per month in 2023-07 to 2024-01 and 187 in 2024-02. From 2023-07 to 2024-01 the valid rows lie between local hours 6 or 7 and 16 or 17 only; 5 569 of the 5 590 night rows (18 to 06) are fill rows, by day 1 410 of 4 730. The continuous file has the same meteo rows. The EC columns are not day-time only: `nee` has 89 to 216 night values per month in 2023-07 to 2023-12 (151 to 673 by day). In 2023-08 the `nee` night coverage is a third of the day coverage; in 2024-05 and 2024-06 `le` and `ustar` have a night coverage below half of the day coverage, while `nee` has full nights (the held values of MKT-03).
- Expected: full days. `docs/harmonised-database.md`: "fill rows mainly from 2023-02-24 to 2024-02".
- Raw rows: in the raw file. Meteo `202310191130` TA 0, RH 0 (14:30 local, a day-time fill row) between `202310191100` 21.57, 97.7 and `202310191200` 22.99, 90.5.
- Control: 2015 to 2022 have 0 to 58 fill rows per month (2017-04 and 2024-02 excepted).
- Probable cause: logger fill (power loss at night; the day-only pattern points to a solar power supply). Alternative tested: the EC system stored night rows in the same months (`nee` at night in 2023-07 to 2023-12), so the night loss is in the meteo logger, not in the whole station. The build sets TA, RH, TS, SWC, PA, WS, G to NULL by the zero rule and `precip`, `sw_in` to NULL in the fill rows.
- Status / Severity: handled in build (the NULL rules); the day-only pattern is new information / S2 (7 months with night values missing)
- Effect: monthly and annual means of Maktau 2023 and 2024-01 are day-time means (ta, rh, tsoil, swc too high, rh too low). `precip` 2023 covers 33 % of the year (69 mm). The `calc.ts` MDS gap filling for Maktau has no night data in these months. The website `monthly` and `coverage` diagrams show it.
- Next action: document only (add the day-only pattern and the months 2023-04 to 2023-06 with no data to `docs/harmonised-database.md`). Do not use Maktau 2023 monthly means.
- Verify:
  ```sql
  SELECT CASE WHEN hour(ts_start + INTERVAL 3 HOUR) BETWEEN 7 AND 17 THEN 'day' ELSE 'night' END AS part, count(ta) AS n_ta, count(*) AS n FROM 'db/observations.parquet' WHERE site_id = 6 AND ts_start >= '2023-07-01' AND ts_start < '2024-02-01' GROUP BY 1;
  ```

#### MKT-02 vpd: values kept in the logger fill rows

- Source: `vpd` ← C `VPD`
- Period: 2023-02-24 to 2024-02-29 (6 396 periods)
- Observed: 6 395 of the 12 830 fill rows of the continuous file have a non-zero `VPD` (median 4.88 hPa). The database keeps 6 396 `vpd` values in periods where `ta` and `rh` are NULL. In the fill row `202310191130` (14:30 local) VPD is 17.982 hPa; the rows before and after (RH 97.7 and 90.5 %) give 0.59 and 2.67 hPa; the Magnus VPD of the fill row (TA 0, RH 0) would be 6.11. The 3 steps outside the fill rows are real showers (`202310161330` VPD 4.15 with RH 89.2 % and 2 mm rain; `202403171500` 39.66 hPa at 36.24 °C and 34 % RH = Magnus 39.66).
- Expected: VPD = Magnus(TA, RH) as in all other rows. A value that is not consistent with the neighbours, in a row where all other sensors are 0, is a held or stale value.
- Raw rows: in the raw file; the build has no fill-row rule for `vpd`. `Continuous_KE-Mkt.csv`, `VPD`, `TA_1_1_1`, `RH_1_1_1`: `202310191100` 0.59, 21.57, 97.7; `202310191130` 17.982, 0, 0; `202310191200` 2.67, 22.99, 90.5.
- Control: outside the fill rows, `VPD` equals the Magnus value of the same row to 0.01 hPa.
- Probable cause: logger fill (held value in the fill rows).
- Status / Severity: new (verified) / S3 (6 396 periods, 2023)
- Effect: `vpd` of Maktau 2023 has values in periods without TA and RH. `calc.ts` uses `vpd` as an MDS driver for Maktau.
- Next action: add build rule (set `vpd` to NULL in the fill rows, `TA_1_1_1 = 0 AND RH_1_1_1 = 0`, like `precip` and `sw_in`).
- Verify:
  ```sql
  SELECT count(*) AS n, count(vpd) AS vpd_present FROM 'db/observations.parquet' WHERE site_id = 6 AND ta IS NULL AND rh IS NULL AND ts_start >= '2023-02-01' AND ts_start < '2024-03-01';
  ```

#### MKT-03 nee: FC repeated for up to 25 periods in 2024

- Source: `nee` ← C `FC`
- Period: 2024-04-01 to 2024-07-31 (64 runs of ≥ 6 equal values, 838 periods, longest 25); also 2018-12 to 2021-12 (44 runs, 329 periods, longest 14)
- Observed: in the run of 2024-06-06 22:00 to 2024-06-07 05:00 local the raw `FC` is 1.8288 in 16 consecutive rows while `FC_SSITC_TEST`, `USTAR`, `LE` and `H` are −9999 and `TA_1_1_1` changes (18.61 to 16.74 °C). The 838 periods are 11 % of the 7 384 FC values of 2024. A measured 30-minute flux repeats to 4 decimals by chance about never.
- Expected: a measured flux without the other EC outputs (quality flag, u*, H, LE) of the same period does not exist in EddyPro output. The value is a held value of the logger or of a gap-filling step in the source.
- Raw rows: in the raw file. `Continuous_KE-Mkt.csv`, `FC`, `FC_SSITC_TEST`, `USTAR`: `202406062130` −1.895, −9999, −9999; `202406062200` 1.8288, −9999, −9999; ... `202406070500` 1.8288, −9999, −9999.
- Control: 2018 to 2021 have runs of 6 to 14 periods only (44 runs in 4 years); 2022-01 to 2024-03 have none. Alternative tested (a real constant flux on a calm night): in the 838 run periods of 2024, `USTAR` is present in 13, `FC_SSITC_TEST` in 13, `H` in 27, and 8 periods are by day; the run value differs from the last value before the run (−1.895, then 1.8288 for 16 periods while `TA` falls by 1.9 °C). A real calm-night value is excluded. In the 2018 to 2019 runs all periods have `USTAR` and the quality flag, so those are a different case. In 2024, 3 166 of the 7 384 `FC` values (43 %) have no `USTAR`, so the file can hold filled values outside the runs too.
- Probable cause: source artefact (held value). The runs are at night, so the known night problem of the sensor in 2023 is not the same thing.
- Status / Severity: new (verified) / S2 (11 % of the 2024 NEE values; the 2024 sums and the MDS gap filling of `calc.ts` use them)
- Effect: `nee` of Maktau 2024-04 to 2024-07. `nee_ssitc` is NULL in these periods, so a flag filter would remove them. The website `timeseries` shows flat night segments.
- Next action: ask provider (what produces the repeated FC values in 2024; is the file gap-filled in part?). A rule could set `nee` to NULL where `FC` equals the previous value and `FC_SSITC_TEST` is −9999.
- Verify:
  ```sql
  WITH r AS (SELECT ts_start, nee, CASE WHEN nee = lag(nee) OVER (ORDER BY ts_start) THEN 0 ELSE 1 END AS brk FROM 'db/observations.parquet' WHERE site_id = 6 AND nee IS NOT NULL), g AS (SELECT ts_start, sum(brk) OVER (ORDER BY ts_start) AS grp FROM r), runs AS (SELECT grp, min(ts_start) AS t0, count(*) AS len FROM g GROUP BY grp HAVING count(*) >= 6) SELECT year(t0) AS yr, count(*) AS runs, sum(len) AS periods, max(len) AS longest FROM runs GROUP BY 1 ORDER BY 1;
  ```

#### MKT-04 tsoil: single-period drops of all three soil temperature depths

- Source: `tsoil` ← M then C `TS_1_1_1` (10 cm)
- Period: 2014-08-23 13:30, 2016-10-29 15:30, 2016-10-30 08:30, 10:30, 12:30, 2016-11-19 14:30, 2016-11-21 09:30, 2017-04-21 11:30, 2017-06-13 09:30, 2024-02-07 11:30, 2024-07-25 16:30 UTC (11 single periods with 0.97 to 8.99 °C) and 2022-12-04 09:30 (10.07 °C)
- Observed: in every flagged period the three depths drop together (`TS_1_1_1`, `TS_1_2_2`, `TS_1_3_3`: 0.984, 0.964, 0.978 on `201610301130`; 10.07, 8.97, 9.11 on `202212041230`) while `TA_1_1_1` is normal (30.39 and 28.52 °C) and `SWC_1_1_1` and `G_1_1_1` do not change. 10 of the 12 periods with TS below 12 °C are the first row after a row with `TS_1_1_1` = 0 (a logger restart); the meteo file has 515 such first rows, 505 of them normal. The 2022-12-04 dip has valid neighbours on both sides.
- Expected: the 10 cm soil temperature changes by less than 2 °C per 30 minutes. The site never has soil below 15 °C (annual night medians 24 to 31 °C).
- Raw rows: in the raw file. Meteo `202212041200` TS 28.8, 26.77, 27.35, TA 28.06; `202212041230` 10.07, 8.97, 9.11, 28.52; `202212041300` 30.2, 26.91, 27.33, 28.5. The open question of `docs/harmonised-database.md` ("values near 1 °C in 2016-2017 and 2024") is this set of 11 single periods, not a stretch.
- Control: the 2019-04-11 and 04-12 step flags are a different case: the continuous file gives `TS_1_1_1` 31.9 at `201904121100` where the meteo file gives 26.13; the continuous row wins by rank. One of the known 490 TA conflicts between the files.
- Probable cause: sensor fault (CS650 reading in the first scan after a logger restart, all three probes at once; 2022-12-04 a glitch in one scan).
- Status / Severity: new (verified); the 2019-04-12 step is known (file conflict) / S3 (12 periods in 10 years)
- Effect: the `tsoil` minimum of Maktau is 0.97 instead of about 15 °C; the website y axis of `tsoil` for Maktau is stretched; the daily mean of 2016-10-30 is 1.7 °C too low.
- Next action: add build rule (set `tsoil` to NULL where `TS_1_1_1` is below 12 °C, or where the previous row has `TS_1_1_1` = 0).
- Verify:
  ```sql
  SELECT ts_start, tsoil, ta FROM 'db/observations.parquet' WHERE site_id = 6 AND tsoil < 12 ORDER BY ts_start;
  ```

#### MKT-05 le: measured latent heat flux without a quality filter

- Source: `le` ← C `LE`
- Period: 2019-02-23 12:30 (486 W m-2 between 160 and 104), 2019-03-17 17:00 (413 at night between −3 and −27), 2022-11-19 00:00 (376 at night), 2019-08-02 20:00 to 21:00 (−155 to −114 at night), 2019-03-11, 2021-11-21 to 11-29 (−104 to −133)
- Observed: the night spike `201903172000` has LE 412.95 with H −59.79 and `SW_IN` 0.028 W m-2. `LE_SSITC_TEST` of the file: flag 0 in 4 488 values, 1 in 25 195, 2 in 4 536, −9999 in 802; the minimum LE of flag 0 is −46 W m-2, of flag 1 −155, of flag 2 −79. The 2019-02-23 spike has flag 2.
- Expected: Räsänen 2026 p. 4 removed Mauder-Foken flag 2 and rain periods before use. A night LE of −155 or +413 W m-2 is not physical.
- Raw rows: in the raw file; the build takes `LE` without the flag. `Continuous_KE-Mkt.csv`, `LE`, `H`, `SW_IN_1_1_1`: `201903171930` −3.15, −8.49, 0.067; `201903172000` 412.95, −59.79, 0.028; `201903172030` −26.83, 9.39, 0.073.
- Control: Anttila, Särkisuo and Qvidja give gap-filled LE with QC applied; their range check gives no `le` flag.
- Probable cause: sensor fault or spike in the open-path EC (rain, dew), not filtered.
- Status / Severity: new (verified) / S3 (8 flagged periods; 4 536 periods with flag 2 in all)
- Effect: `le` of Maktau. `calc.ts` does not use LE. The website `timeseries` and `cumulative` of `le` show spikes.
- Next action: add build rule (set `le` to NULL where `LE_SSITC_TEST` = 2 or −9999; optionally add `le_ssitc`).
- Verify:
  ```sql
  SELECT LE_SSITC_TEST, count(*) AS n, min(try_cast(LE AS DOUBLE)) AS min_le FROM read_csv('data/Maktau/Continuous_KE-Mkt.csv', all_varchar=true) WHERE try_cast(LE AS DOUBLE) <> -9999 GROUP BY 1 ORDER BY 1;
  ```

#### MKT-06 sw_in, netrad: single values above the physical maximum

- Source: `sw_in` ← M `SW_IN_1_1_1`; `netrad` ← M `NETRAD_1_1_1`
- Period: `sw_in` 2018-04-06 11:00 to 11:30 and 2018-04-07 06:00 to 11:30 UTC (11 periods, 1 304 to 1 570 W m-2); `netrad` 2022-11-16, 2022-11-29, 2023-05-12, 2023-05-17, 2023-11-11, 2023-11-14, 2024-03-01, 2024-04-04 (8 single midday periods, 851 to 959 W m-2)
- Observed: on 2018-04-07 the raw `SW_IN_1_1_1` goes 1075 (raw stamp 08:30, UTC+3), 1523, 1515, 1399, 1255, 1171, 1290, 1374, 1304, 1443, 1570 (raw stamp 13:30), 1487, 1376, 973 W m-2 with TA 23 to 29 °C and no rain. The solar constant is 1 361 W m-2; the clear-sky maximum at 1 060 m near the equinox is about 1 100 W m-2. The `netrad` spike `202305121230` (958.9 W m-2) is in a logger fill row between 474 and 386 W m-2.
- Expected: `sw_in` ≤ 1 100; `netrad` ≤ 0.8 × `sw_in` (the Maktau midday ratio is 0.6 to 0.8).
- Raw rows: in the raw file. Meteo `201804070830` 1075; `201804070900` 1523; `201804071330` 1570; `201804071500` 973.
- Control: no other day of 2014 to 2025 has `sw_in` above 1 300 (summary Table 5: 11 values, all 2018). The 2018-04-06 and 04-07 day-time values are 20 to 40 % above the neighbours.
- Probable cause: sensor fault (two days with a scaled pyranometer signal in April 2018, cause unknown) and single `netrad` spikes, one in a fill row.
- Status / Severity: known (range warning in the build report: "sw_in above 1 500 in 4 rows"), verified / S3 (11 and 8 periods)
- Effect: the daily `sw_in` sum of 2018-04-07 is about 25 % too high. `calc.ts` uses `sw_in` as an MDS driver. The website `budget` is not affected.
- Next action: document only (a rule could set `sw_in` to NULL above 1 200 W m-2 and `netrad` to NULL in fill rows).
- Verify:
  ```sql
  SELECT ts_start, sw_in FROM 'db/observations.parquet' WHERE site_id = 6 AND sw_in > 1300 ORDER BY ts_start;
  ```

#### MKT-07 ws, wd: the zero rule removes calm periods at night

- Source: `ws` ← M `WS_1_1_1` (0 → NULL), `wd` ← M `WD_1_1_1` (NULL where WS = 0)
- Period: 2019-03 to 2023-02 (P flags of `ws` in 4 months and `wd` in 1 month: night coverage 0.42 to 0.49, day 0.9 or more)
- Observed: in the valid rows (not fill rows) of 2019 to 2022, `WS_1_1_1` is exact 0 in 16.7 % of the night rows (6 341 of 37 986) and in 4.6 % of the day rows (1 474 of 32 142). The smallest positive value is 0.007 m s-1, so the logger reports values far below the cup-anemometer threshold. An exact 0 in a row where TA, RH and SW_IN are valid is a calm period, not a fill value.
- Expected: calm nights at an inland tropical site with 1 to 1.5 m s-1 mean wind are normal (the `ws` D flag 2019-12: day median 1.16 m s-1 against 2.16, in the wet month after the 2019 short rains).
- Raw rows: made by the build (the `zeroIsNull` rule). The counts come from the meteo file with `TA_1_1_1 <> 0 OR RH_1_1_1 <> 0`.
- Control: the fill rows have WS = 0 in all rows; the zero rule is right for them.
- Probable cause: build artefact (the `zeroIsNull` rule of `ws` also removes real calm periods; `wd` follows).
- Status / Severity: new (verified) / S4 (night means of `ws` are biased high; the removed values are 0)
- Effect: `ws` night coverage 42 to 49 % of the day coverage in 2019 to 2022; monthly mean `ws` too high by about 0.1 to 0.2 m s-1 at night. `wd` of calm periods is not defined, so no effect there.
- Next action: document only (a rule could keep `ws` = 0 in rows that are not fill rows).
- Verify:
  ```sql
  SELECT CASE WHEN hour(try_strptime(TIMESTAMP_START, '%Y%m%d%H%M')) BETWEEN 7 AND 17 THEN 'day' ELSE 'night' END AS part, count(*) FILTER (WHERE try_cast(WS_1_1_1 AS DOUBLE) = 0) AS ws_zero, count(*) AS n FROM read_csv('data/Maktau/Maktau_meteo_30_min_KE-Mkt.csv', all_varchar=true) WHERE NOT (try_cast(TA_1_1_1 AS DOUBLE) = 0 AND try_cast(RH_1_1_1 AS DOUBLE) = 0) AND TIMESTAMP_START BETWEEN '2019' AND '2023' GROUP BY 1;
  ```

#### MKT-08 ta, vpd: day-time air temperature in 2024 is 1.5 to 2.8 °C above the earlier years

- Source: `ta` ← C then M `TA_1_1_1`; `vpd` ← C `VPD`
- Period: 2024-02 to 2024-11
- Observed: day-time (`sw_in` > 20) monthly medians of `ta` in 2024 against the median of 2015 to 2022: May 27.5 against 25.2, June 27.1 against 24.3, July 25.2 against 23.7, August 25.3 against 24.1, September 27.0 against 25.6, November 28.2 against 26.3 °C; the night medians are equal (June 17.6 against 17.6, July 17.3 against 16.7). June 2024 day median 27.06 is above every other year (24.0 to 25.6). The June monthly mean of 2024 (22.4 °C) equals 2022 (22.5). Both files give the same TA values (RMSE 0.10 °C at lag 0 in 2024).
- Expected: a warm year moves day and night together. A day-only warming points to the radiation shield, the fan, or a changed sensor place after the meteo station period (Räsänen 2026 p. 4: the meteo station ran March 2014 to August 2022; the file continues to 2025-01).
- Raw rows: in the raw file. Meteo `202406100900` TA 26.24, RH 57.64, SW_IN 378.8; `202406101000` 28.06, 46.65, 678.9; `202406102100` 19.25, 75.63, 0.059. Values are plausible one by one; the anomaly is a level difference by day.
- Control: April 2024 (26.3 against 26.6) and December (26.3 against 26.9) do not show it. The `vpd` of 2024-06 (18.3 hPa) follows the warmer day-time TA.
- Probable cause: open (sensor exposure or real warm season 2024; the 2024 long rains were wet: 162 mm April to June, swc 0.072). Alternative tested (a real warm 2024): the sonic temperature `T_SONIC` of the EC system, an independent sensor 150 m from the meteo station, shows the same rise. June day-time medians: `TA_1_1_1` 27.8 and `T_SONIC` 28.7 °C in 2024 against 25.0 and 26.8 in 2022, 24.2 and 25.5 in 2019. The day-time difference `TA` − `T_SONIC` is stable (−1.6 in 2024; −1.1 to −1.8 in 2019 to 2022). The alternative holds: the warm 2024 day-time is probably real, and the T/RH sensor is probably not the cause.
- Status / Severity: open question / S2 if the sensor is the cause (one year of day-time TA); S4 if real, as the sonic temperature indicates
- Effect: `ta` and `vpd` 2024 of Maktau, the MDS drivers of `calc.ts`, the website `years` overlay of `ta`.
- Next action: ask provider (was the T/RH sensor, its shield or its place changed between 2022-08 and 2024; is a reference station available?).
- Verify:
  ```sql
  SELECT year(ts_start) AS yr, round(median(ta) FILTER (WHERE sw_in > 20), 2) AS day_median_june FROM 'db/observations.parquet' WHERE site_id = 6 AND month(ts_start + INTERVAL 3 HOUR) = 6 GROUP BY 1 ORDER BY 1;
  ```

#### MKT-09 rh, swc, tsoil, ta, vpd: wet-season level shifts are real

- Source: `rh`, `swc`, `tsoil`, `ta`, `vpd`, `ws`
- Period: 2018-03, 2019-05, 2019-10, 2019-12, 2020-03, 2016-04, 2014-08 and 09, 2023-07 (31 D flags)
- Observed: October 2019 had 186 mm rain (other Octobers 0 to 69 mm), rh 90 %, swc 0.152 m³ m⁻³ (others 0.03 to 0.07), tsoil 24.7 °C (others 28 to 31), ta 20.9 °C, vpd 3.1 hPa. March 2018 had 199 mm (others 0 to 77), rh 83 %, swc 0.138, tsoil 26.4. March 2020 65 mm, rh 84 %, vpd 6.2 hPa. April 2016 154 mm April to June, swc 0.14. December 2019 swc 0.138 after the wet October and November 2019 (annual 608 mm). August and September 2014 are the first weeks of the record. July 2023 is the day-only period of MKT-01.
- Expected: Räsänen 2026 p. 2 and p. 9: bimodal rain, long rains March to May, short rains October to December, 68 to 302 mm per season; p. 10: SWC at 0.1 m 0.03 to 0.18 m³ m⁻³. The 2019 short rains were extreme in East Africa.
- Raw rows: not needed; monthly sums and means from `db/observations.parquet`.
- Control: the flagged months are the months with the highest rain sums of the record. The dry months (October 2016, 2022: 0 mm) are not flagged.
- Probable cause: real event (rain seasons).
- Status / Severity: real event / S4
- Effect: none.
- Next action: document only.
- Verify:
  ```sql
  SELECT year(ts_start) AS yr, round(sum(precip), 0) AS p_oct, round(avg(swc), 3) AS swc_oct, round(avg(rh), 0) AS rh_oct FROM 'db/observations.parquet' WHERE site_id = 6 AND month(ts_start + INTERVAL 3 HOUR) = 10 GROUP BY 1 ORDER BY 1;
  ```

## Cross-site findings

### Time axis

The raw stamps of Anttila, Särkisuo and Viikki are UTC and mark the period start. The registry gives these sites `utcOffsetMin: 120`, so the build subtracts 2 h and `ts_start` is 2 h too early. Haltiala and Qvidja (UTC+2) and Maktau (UTC+3) are correct. Evidence from `data/anomaly-scan/time-axis.md` (June, median local hour of the daily radiation peak on the raw stamp axis) and the findings:

| Site | Raw stamp of the June radiation peak | Expected for the local offset | Convention of the file |
|---|---|---|---|
| Anttila | 10.0 (`SWIN_POT` centroid 9.96) | 12.18 (UTC+2, 27.2 °E) | UTC, period start |
| Särkisuo | 10.0 (`SWIN_POT` centroid 9.97) | 12.18 (UTC+2, 27.2 °E) | UTC, period start |
| Viikki | 10.25 to 10.5 (SWin centroid 10.10 to 10.27) | 12.33 (UTC+2) | UTC, period start |
| Haltiala | 12.0 to 12.25 | 12.34 (UTC+2) | UTC+2, period start (ReadMe) |
| Qvidja | 12.0 to 12.5 | 12.51 (UTC+2) | UTC+2, period start (Heimsch 2021 p. 13) |
| Maktau | 12.0 to 12.5 (centroid 12.17 to 12.31) | 12.46 (UTC+3) | UTC+3, period start |

Before 2026-10-22, `time-axis.md` gave 12.33 for Anttila and Särkisuo because `sites.parquet` had no coordinates for them and the scan used the default longitude 25 °E. Since 2026-10-22 all sites have coordinates, and `time-axis.md` gives the true value 12.18 (27.2 to 27.3 °E). Alternative tested: local standard time with period-end stamps gives a centroid of 12.47 on the raw axis; UTC with period-end stamps 10.47. The observed 9.96 to 10.3 fits UTC with period-start stamps only. All years are affected (Anttila 9.96 and 9.96; Särkisuo 9.97 and 9.79; Viikki June 10.07 to 10.32 and December 9.96 to 10.13).

Effect: every value of the three sites sits 2 h early on the website (`timeseries`, `diurnal`, `fingerprint`, `years`), in `ts_start` and `tl`, in the data export (`ts_start_utc`, `ts_local`), and in the `scripts/calc.ts` night and day logic by local hour. Hourly comparisons with Haltiala, Qvidja and Maktau are offset by 2 h. Daily, monthly and annual sums change little. The scan flags N (night `ppfd`), G (sunrise) and F7 (SAR-06) at these sites are consequences.

Correction idea: after the provider confirms, add a per-source stamp offset of 0 min for the Anttila, Särkisuo and Viikki sources in `scripts/lib/registry.ts` (period start), and keep `utc_offset_min` 120 for the site display. Question to the providers: "Are the time stamps in the files UTC or UTC+2, and do they mark the start of the 30-minute period?"

### Radiometer night offsets

Anttila, Särkisuo, Viikki and Qvidja have negative `sw_in` and `sw_out` at night (thermopile offset, dew or frost on unheated domes): Anttila −5 W m-2 from 2022-10-14 (ANT-02), Särkisuo −6 W m-2 from 2023-08-08 (SAR-02), Viikki −6.5 to −7.7 W m-2 (VII-02). The 30-minute values are within the sensor specification (cosmetic, S4). The winter daily and monthly sums are too low: a −5 W m-2 offset over 48 periods is −0.43 MJ m-2 d-1, about 50 % of a November daily sum at Anttila. The daily ratio `ppfd/sw_in` (check F2) is too high in winter for the same reason; the ratio of the daily maxima is 1.8 to 2.2 at all these sites. A rule could set negative values to 0 at night (`ppfd` ≤ 0 or `SWIN_POT` = 0), but `SWIN_POT` is not in the database.

### Partitioning conventions

Anttila and Särkisuo use the night-time method: GPP = 0 at night and in winter days, Reco = NEE there, and NEE = Reco − GPP in every period (ANT-06). A measured negative night NEE then becomes a negative Reco (ANT-03, SAR-05). Qvidja uses a daytime method: GPP and Reco are both modelled fluxes, GPP > 0 at night in 12 to 21 % of the night periods (103 to 144 g C m-2 per year), and NEE ≠ Reco − GPP in 26 to 48 % of the periods (QVI-07). The `budget` bars of Qvidja do not add up. `scripts/calc.ts` makes its own night-time partitioning from `nee_f` for all sites, so its products do not depend on the source convention.

### Frozen soil

At all Finnish sites the soil temperature at 5 to 14 cm stays within ±1 °C for weeks under snow (zero curtain) with runs of one value at a 0.1 °C resolution (ANT-05, SAR-04, HAL-04, VII-03, Qvidja runs). The soil water content drops by 0.2 to 0.4 when the soil freezes, because ice has a low permittivity (QVI-03, Haltiala 2022-01, Viikki 2024-01). Both are physical. Keep the data. Do not use winter `swc` when `tsoil` is below 0 °C without a check. Checks B, E, F9 and D flag these periods. Change the scan so that it skips months with a `tsoil` range below 2 °C.

### Coverage patterns

Night gaps of `nee` at Haltiala, Qvidja and Viikki (night coverage 1 to 41 % against 23 to 93 % by day in summer) come from the u* filter of the providers (Vira 2025 p. 5; Heimsch 2024 p. 3, 0.15 m s-1; Gao 2026 p. 7, 0.19 m s-1). Anttila and Särkisuo show the same at raw hours 22 to 01 (Shurpali 2025 p. 4). `nee_f` at night is a model. At Maktau the meteo logger stored day-time rows only from 2023-07 to 2024-01 (MKT-01); the EC columns kept night rows, but the `nee` night coverage in 2023-08 and the `le` and `ustar` night coverage in 2024-05 to 2024-06 are below half of the day coverage. Monthly means of the meteo columns in these months are day-time means.

## Known and handled

| Item | Site | Status | Where it is handled or documented |
|---|---|---|---|
| `SM` unit (volts, not m³ m⁻³) | Qvidja | resolved 2026-10-22, converted in the build | `scripts/lib/ml3.ts`; `docs/qvidja-soil-moisture.md`; QVI-01 |
| `swc` drops in frozen soil | Qvidja | known | Heimsch 2021 p. 6; `docs/qvidja-soil-moisture.md`, Sensor notes; QVI-03 |
| RH source change 2021-10-08, Kaarina RH 2018 to 2021 | Qvidja | known (article) | Heimsch 2024 p. 4; QVI-04 |
| `vpd` below 0 in 2 018 rows | Qvidja | known | `docs/harmonised-database.md`, Known range warnings; QVI-05 |
| Daytime partitioning, NEE ≠ Reco − GPP | Qvidja | known | `docs/harmonised-database.md`, optional columns (`gpp_src` × −1); QVI-07 |
| Rain gauge gap 2021-12-29 to 2022-05-24 | Qvidja | known (article), new for the file | Heimsch 2024 p. 4; QVI-08 |
| All meteo lost 2023-02-11 to 2023-03-01 | Qvidja | known | Heimsch 2024 p. 4; QVI-09 |
| EC inlet fault 2019-01-05 to 2019-03-28 | Qvidja | known | Heimsch 2021 p. 4; QVI-10 |
| Duplicate rows 2018 to 2023, `ustar` conflicts in 76 268 periods | Qvidja | handled in build | `docs/harmonised-database.md`, rule 3 and Known range warnings; QVI-15 |
| `ppfd` evening floor of 1 | Haltiala | known | HAL-02 |
| 2024 gap-filled NEE differs from measured NEE; 2025 in 228 periods | Viikki | known | registry note in `scripts/lib/registry.ts`; VII-05 |
| NEE unit factor mg CO2 to µmol; WFPS 2022 to m³ m⁻³ | Viikki | handled in build | `docs/harmonised-database.md`, rule 6 |
| Pit 5-minute stamps are period end; mean of ≥ 3 of 6 values | Viikki | handled in build | `docs/harmonised-database.md`, rule 5 |
| N2O unit assumption µg N2O | Viikki | known, open | `docs/harmonised-database.md`, optional columns (`n2o`); VII-06 |
| `T1` and `WFPS1` from 2022-04-12 only (101-day gap) | Viikki | known | registry note |
| `sw_in` 2022 has 3 234 values only (from 2022-10-25) | Särkisuo | known | `docs/harmonised-database.md`, optional columns (`sw_in`) |
| Biomet gap 2023-05-16 to 2023-08-08 | Särkisuo | known | brief; SAR-02, SAR-06 |
| CH4 and N2O start 2022-05-06 (partial year 2022) | Särkisuo | known | Shurpali 2025 p. 3; SAR-07; `annual.csv` share 0.66 |
| N2O peaks June to July 2022 and July 2023 are measured | Särkisuo | known | brief; SAR-07 |
| Logger fill rows TA = RH = 0 (NULL for ta, rh, tsoil, swc, pa, ws, g, precip, sw_in) | Maktau | handled in build | `docs/harmonised-database.md`, rule 4 and optional columns; MKT-01 |
| `precip` 2023 covers 33 % of the year (69 mm) | Maktau | known | `docs/harmonised-database.md`, logger fill rows |
| NETRAD day-time only 2023-05 to 2024-01 (kept) | Maktau | known | `docs/harmonised-database.md`, net radiation 2023 |
| Wind vane stuck from 2019-06 (daily SD rule) | Maktau | handled in build | `docs/harmonised-database.md`, wind direction |
| `WS_1_1_1` too low 2023-07-01 to 2024-06-30 (NULL) | Maktau | handled in build | `docs/harmonised-database.md`, wind speed |
| High `le` in 2023-11 and 2023-12 is not a fault | Maktau | known | `docs/harmonised-database.md`, latent heat flux |
| Continuous `WS` and `NETRAD_1_1_1` not used; continuous `pa` not used | Maktau | handled in build | `docs/harmonised-database.md`, optional columns |
| Continuous and meteo TA conflicts (about 490 periods) | Maktau | known | `docs/harmonised-database.md`, Sources; MKT-04 control |
| `sw_in` above 1 500 W m-2 in 4 rows | Maktau | known | `docs/harmonised-database.md`, Known range warnings; MKT-06 |
| Soil temperature near 1 °C in 2016-2017 and 2024 | Maktau | known, now explained | `docs/harmonised-database.md`, Open questions; MKT-04 |
| Snow depth, H, longwave not added (fewer than 3 sites) | all | handled in build | `docs/harmonised-database.md`, Not added |

## Checked, not an anomaly

Anttila:

- A: no `sw_in` > 1000, `sw_out` > 600 or `reco_src` > 40. Maxima 2022 / 2023: `SWIN_1_1_1` 925 / 974 W m-2, `SWOUT_1_1_1` 508 / 415, Reco 25.6 / 21.0, GPP 42.7 / 42.8, NEE −37.3 to +25.6.
- I: `nee` = `nee_f` in 100 % of the paired rows, by construction. `nee_f` = `reco_src` in 58 % and `nee` = `reco_src` in 50 to 53 %: the periods with GPP = 0.
- D: `sw_out/sw_in` 0.56 to 0.59 in March and April, `netrad/sw_in` 0.15 to 0.20 in March: snow albedo (February 0.81 and 0.76; `D_SNOW_1_1_1` 0.26 to 0.42 m in March and April 2023).
- E: `precip` 39 distinct values per year: the TR-525M tipping bucket counts 0.1 mm per tip. Annual 455 mm (2022) and 547 mm (2023) against 588 mm in the region: snow undercatch is probable.
- F9: corr(`tsoil`, `ta`) −0.41 in 2023-02: soil at 0.6 to 0.85 °C under 0.4 m of snow (ANT-05).
- P: night coverage of `nee` 0.15 to 0.42 against day 0.73 to 0.98 in April to August: the u* filter of the provider.
- M: daily maximum of `sw_in` below 30 W m-2 on 5 to 14 days in December and early January: polar winter at 63.16 °N (`SWIN_POT` 29 W m-2 at most in December 2023; 203 in December 2022, so the provider's potential radiation differs between the years).
- F2: `ppfd/sw_in` 2.0 to 2.6 in January, February and October: night offset (ANT-02). December 2023 ratio of the daily maxima 0.79: both values below 30 W m-2; cosmetic.
- `sw_in` daytime level against the other sites (October 2023 202 W m-2, Qvidja 284, Viikki 234): plausible for the latitude and the cloud cover.
- G: peak hour 10.75 in September 2022 and 10.25 in February 2023: noise on the 2-hour shift (ANT-01).
- Range warnings of the build for site 1: none.

Särkisuo:

- A: no `swc` > 0.95. `SWC_1_1_1` maximum 0.712 (2022) and 0.801 (2023-10). Peat, article p. 4: 30 to 69 %.
- I: as Anttila (`nee_f` = `reco_src` 56 to 60 %, `nee` = `reco_src` 47 to 53 %).
- D: `sw_out/sw_in` 0.61 in April 2023 and 0.83 in February 2023, `netrad/sw_in` 0.23 in April 2023: snow (daily albedo February 0.84, March 0.77, April 0.61, September 0.20).
- E: `precip` 47 (2022) and 33 (2023) distinct values: tipping bucket 0.1 mm. Annual 530 mm (2022; region 588 mm).
- F9: corr(`tsoil`, `ta`) −0.31 (2023-01) and −0.26 (2023-12): soil constant under snow (SAR-04).
- P: night coverage of `nee` 0.11 to 0.33 against day 0.73 to 0.93 in April to August: u* filter. Särkisuo coverage is lower than Anttila (article: 58 % against 63 % for CO2).
- M: daily maximum of `sw_in` below 30 W m-2 in late November to early January: polar winter at 63.15 °N.
- F2: `ppfd/sw_in` 2.2 to 2.3 in January and October: night offset (SAR-02). December 2023 ratio of the daily maxima 0.81: values below 30 W m-2.
- N: `ppfd` 27.6 (June 2022) and 10.6 (July 2022) at "night": the scan's hours 0 to 2 are 02:00 to 04:30 true local time (SAR-01); in the true night the June median is 1.9 µmol m-2 s-1. G sunrise flags: SAR-01.
- `rh` maximum 100.06 (2022) and 100.01 (2023): within the sensor tolerance. `D_SNOW_1_1_1` 2023 has one value (1.5) and is not in the database.
- Range warnings of the build for site 2: none.

Haltiala:

- B: `tsoil` 65 equal periods −0.29 (2022-02-21) and 54 at 0.93 (2022-12-15): 2-decimal series in frozen soil. `vpd` 56 and 51 equal periods of 0.0: saturation at RH 100 %. `ta` 13 equal periods −2.85 (2023-12-25 10:00 to 16:00 local) with TS also constant: probably a constant fill; S4, no action.
- E: `tsoil` = 0 in 111 periods and `ta` = 0 in 35: zero crossings of a 2-decimal series, not fill values.
- G: raw June diurnal mean of `ppfd` peaks at stamp hour 12 (1 126 µmol m-2 s-1), median peak hour 12.0 in every year; expected 12.34 for UTC+2. The 2021-09 and 2025-10 flags (11.5 h) come from 26 and 11 days near the threshold; the 2021-08 "sunrise" flag uses PPFD / 2 > 10 at a site without `sw_in`. False positives.
- I: `nee` = `nee_f` in 92.8 to 95.0 % of the paired rows: `NEE_F` copies `NEE` where it exists (0 pairs with |difference| > 0.01). By construction.
- P: `nee` day (9 to 15 h) 78 to 93 %, night (0 to 3 h) 22 to 41 % in summer; per year 55 to 71 % measured. u* filter (Vira 2025 p. 5).
- D: `vpd` 2021-07 day median 12.8 against 6.9 hPa: heat wave July 2021 (HAL-05).
- Annual NEE sums and sign: see the Haltiala section.

Qvidja:

- I: `nee` = `nee_f` in 100 % of the paired rows, by construction.
- G: raw `SW_IN_F` June diurnal mean peaks at stamp hour 12 (601 W m-2); median peak hour 12.0 in every year except 2019 (12.5); expected 12.5 for UTC+2 at 22.4 °E. The 2019-10, 2020-10 and 2024-04 flags (11.5 h) come from 17 to 29 days near the threshold; the 2023-07 "clock jump" (median 13.0) is a cloudy month (mean peak hour 12.61 against 12.55 in 2022-07). No jump.
- P: night coverage of `nee` 2024-05 3.2 % against day 40.6 %; night u* median 0.095 m s-1 and 80 % of the night periods below the 0.15 m s-1 threshold of Heimsch 2024 p. 3. Per year night 10.9 to 22.5 %, day 23.9 to 36.2 %. Expected.
- B: `tsoil` runs at −0.03, −0.01, 0.08, 0.2 °C (19 runs, 49 to 427 periods): zero curtain, 2-decimal series. E: `tsoil` = 0 in 477 periods and `ta` = 0 in 38: zero crossings.
- F4: `vpd` against Magnus from `ta` and `rh`: median |difference| 0.001 hPa, p98 0.008, 0 periods above 1 hPa.
- F9: `tsoil` ~ `ta` in 18 winter months (r −0.26 to 0.48): soil flat near 0 °C under snow. `le` ~ `netrad` daytime r 0.38 to 0.50 in September (8 months): `LE_F` is gap-filled (night LE = 0) and September has low radiation; marginal.
- A: `tsoil` > 35 °C in July 2018 (62 periods, maximum 37.87 at 5 cm): real heat wave (QVI-14).
- D `rh` months 2018-12 to 2020-05, N `rh` maximum 93.8 in 2021-04: part of QVI-04. F3 `rh` > 103: part of QVI-05. C `tsoil` step 2025-11-01: part of QVI-12.
- Annual rain: 2019-20 868 mm, 2020-21 638 mm, 2023-24 653 mm, 2024-25 659 mm (coverage 94 to 100 %) within the article range 473 to 855 mm; 2018-19 472 mm = Table 1 473 mm.

Viikki:

- N: `ppfd` night (hour 0 to 2) median of 5.7 to 10.1 µmol m-2 s-1 in June: hours 0 to 2 of the database are UTC (VII-01), that is 2 to 4 real local time, the dawn at 60 °N. Real light.
- F2: `ppfd/sw_in` 20 months outside 1.6 to 2.4, all in October to February: the night offset of `SWin` (VII-02). With `SWin` > 50 W m-2 the median ratio is 2.0 to 2.2 in every month of every year. No sensor change in 2025 (`PPFD` column): June 2025 ratio 2.05.
- F9: `tsoil` ~ `ta` 14 months with corr < 0.5, all in winter, with frozen soil (VII-03) or the June 2023 bare soil. The 14 cm probe lags the air by hours.
- F7: `nee_f` 10.2 % of the night periods of 2024-07 below −1 µmol m-2 s-1 (threshold 10 %). Marginal; the night is defined by radiation, not affected by VII-01.
- P: `nee` 14 months with night coverage below half of the day coverage (2024-05: 33 % by day, 1 % by night). u* filter 0.19 m s-1 (Gao 2026 p. 7).
- I: `ta` = `tsoil` in 1.03 % of the 2024 rows: both near 0 °C in winter with a 0.1 resolution (VII-08). Coincidence.
- E: `ta` exact 0 (265 periods), `ws` exact 0 (285 periods): valid readings at 0.1 resolution; longest `ws` run 15 periods (2022-03-04 21:30 to 2022-03-05 04:30 UTC, possibly ice on the anemometer). `precip` 49 to 64 distinct values per year: gauge resolution 0.1 mm. `tsoil` exact 0 (894 periods): frozen soil (VII-03).
- M: 6 to 8 December days with max(`sw_in`) < 30 W m-2 (2023-12-09 to 12-16, 2024-12-22 to 12-27, 2025-12-06 to 12-11): the PAR maximum is 18 to 74 µmol m-2 s-1 on the 2023 and 2025 days, so both sensors agree; dark December sky. Real.
- A: all 673 `sw_in` and `sw_out` range episodes are night or dawn values between −10 and −19.8 W m-2 (VII-02). D `n2o` 2022-05, 2022-06, 2023-09: real events (VII-06). G sunrise: the same 2-hour shift (VII-01).
- Longest gaps: `tsoil` and `swc` 101 days in 2022 (registry note), `ppfd` 31 days in 2024 (December), `pa` 366 days in 2024 and 2025 (no `Pair` column), `ws` and `wd` 29.5 days in 2025, `swc` 27 days in 2025, `g` 80 days in 2023. Source gaps.

Maktau:

- G: the daily centroid of the raw `SW_IN_1_1_1` on the `TIMESTAMP_START` axis is 12.17 to 12.31 in every year 2014 to 2022 and 2024 (expected 12.20 for UTC+3 period-start stamps). The two files agree at lag 0 (TA RMSE 0.06 to 0.24 °C). The one flag (2021-06, 11.75) is a false positive (June 2021 centroid 11.96). February has a centroid of 12.85 to 13.13 in all years: afternoon clearing in the dry season, not a clock change.
- D: `netrad/sw_in` 12 months with the daily ratio 0.60 to 0.77 against 0.03 to 0.48 at the Finnish sites in the same calendar month (snow at Qvidja). The Maktau ratio is stable in all its months. False positive of the cross-site reference.
- F9: `tsoil` ~ `ta` 20 months with corr < 0.5: the 10 cm soil lags the air (2024-07: 0.25 at lag 0, 0.88 with `ta` lagged by 5 hours). `le` ~ `netrad` 2024-08 (0.31): day-time only EC data with the LE spikes of MKT-05.
- B: `rh` = 100 (20 runs of 25 to 32 periods): night saturation from about 16:00 to 08:00 local in the wet months; `ta` changes during the runs. Real.
- E: `precip` holds integers only (0 to 29 mm per 30 min): 1 mm resolution; the ×1.05 undercatch correction of Räsänen 2026 p. 4 is not in the file. `pa` 14 to 17 distinct values per year (0.1 kPa). `ustar` 75 to 101 distinct values per year (0.01 m s-1). Source properties.
- C: `rh` 2021-11-25 11:00 and 2023-10-16 10:30 UTC (82.5 and 89.2 % between 43 and 54 %): 2 mm rain in the period before. Real showers. The `vpd` steps of the same periods are the same showers (MKT-02).
- P: `le`, `nee`, `ustar` 2023-08, 2024-05, 2024-06: EC night coverage below half of the day coverage (MKT-01). In 2023-08 `nee` has 216 night and 673 day values; in 2024-05 and 2024-06 `nee` has full nights (held values, MKT-03) and `le` has 136 to 176 night values.
- D: `tsoil` 2020-02, 2021-02 (27.3 to 27.8 against 30.6) and 2014-08: wet Februaries and the record start.
- NEE sums: `annual.csv` has no `nee_f` for Maktau (measured FC only, coverage 4 to 98 %). Räsänen 2026 gives no CO2 budget.

## Questions to the data providers

ICOS / Shurpali group (Anttila, Särkisuo):

1. Are the stamps `time` (flux file) and `TIMESTAMP_1` (biomet file) UTC, and do they mark the start of the 30-minute period? (ANT-01, SAR-01)
2. Was the CNR4 or its logger program changed on 2022-10-14 at Anttila and during the gap 2023-05-16 to 2023-08-08 at Särkisuo? Is a night-offset correction applied? (ANT-02, SAR-02)
3. What is the depth of `TS_1_1_1` and `SWC_1_1_1`? Did the HydraProbe at Särkisuo read 0.2 °C for the whole winter 2022-23 in the raw 1-minute data, or is 0.2 °C a sensor floor? (SAR-04, ANT-05)
4. Is the last period before a logger stop a partial mean (TA −39.18 °C, RH 1.07 % on 2023-10-17 09:30 at Särkisuo)? (SAR-03)

Haltiala provider:

5. Was the SWC sensor moved, replaced or recalibrated between the 2021 and 2022 seasons? Was the 2021 `SWC_010_F` gap-filled from another source? (HAL-03)
6. Is a 3-decimal `SWC_010` available? (HAL-01)

FMI (Qvidja, Mika Korkiakoski):

7. Answered 2026-10-22: `SM` is the raw ML3 output (V). Still open: is 0.98 V the sensor maximum, and is there a soil-specific calibration for Qvidja? (QVI-01, QVI-02)
8. Which processing version is `Qvidja_2018-2025.csv`: the Heimsch 2024 XGBoost version, or the Vira 2025 reprocessing? The annual NEE sums are 25 to 109 g C m-2 more negative than Heimsch 2024 Table 1. (QVI-11)
9. What happened on 2025-11-01? Are `TS_1` to `TS_3` and `NETRAD` valid after that date, and why is `SW_OUT` missing from 2025-10-26 to 2025-12-28? (QVI-12)
10. Is `RH_F` from 2018-05 to 2021-10 the Kaarina series or the faulty on-site sensor? Why is 2021-01 to 2021-06 flagged as measured (`RH_F_QC` = 0) with RH below 30 % at −5 to −20 °C? (QVI-04)
11. Can you send the Kaarina rain for 2021-12-29 to 2022-05-24? The file has the gap, the article has the fill. (QVI-08)
12. Which copy of the duplicate rows 2018 to 2023 holds the right `USTAR`? (QVI-15)

Viikki / SMEAR-Agri:

13. Are the `Datetime` column of the EC files and the `TIMESTAMP` column of the pit files UTC or UTC+2, and do they mark the period start? The radiation peak is at stamp hour 10. (VII-01)
14. Is the N2O unit `ug m-2 s-1` µg N2O or µg N2O-N? Which analyser? Was the 2022 emission after the 108 kg N ha-1 fertilisation (16.8 kg N2O ha-1 for the year) real? (VII-06)
15. Why does the 2024 gap-filled NEE not copy the measured values (1 540 of 4 206 periods differ)? Is a newer 2024 file available? Why has the 2024 file RH as integers and Tair with one decimal? (VII-05, VII-08)
16. Was the soil pit disturbed in May, August and September 2025 (layer-1 temperature spikes to 28.9 °C)? (VII-04)

Maktau (Räsänen group):

17. What produces the repeated `FC` values in 2024-04 to 2024-07 (runs of up to 25 equal values without `FC_SSITC_TEST`, `USTAR`, `H`, `LE`)? Is the file gap-filled in part? (MKT-03)
18. Was the T/RH sensor, its shield or its place changed between 2022-08 and 2024? Is a reference station available for the day-time warm bias of 2024? (MKT-08)
19. Are the logger fill rows (TA = RH = 0, day-time only data from 2023-07 to 2024-01) a power problem? Is `VPD` in these rows a held value? (MKT-01, MKT-02)

## Reproduce

Run `npm run scan:anomalies`. It needs `db/*.parquet` from `npm run build:db`. The output goes to `data/anomaly-scan/` (not in git):

- `summary.md`: episodes per site and check (Table 1), per variable and check, longest gaps, annual sums.
- `flags.csv`: the top episodes per check, site and variable, each with a verify query.
- `flags-<site>.md`: the same per site, readable.
- `stats-monthly.csv`: monthly statistics per site and variable.
- `annual.csv`: annual sums and coverage (check L).
- `fill-values.md`: frequent values and distinct counts (check E).
- `time-axis.md`: peak hour and sunrise per site, year and month (check G).
- `checks.json`: thresholds and the SQL of each check.

Run a query with the DuckDB CLI from the repository root (the CLI is not in the repo):

```sh
duckdb -init /dev/null -batch -markdown -c "<sql>"
```

Each finding above has a Verify query. Run it as given. The comment after the query gives the expected result.
