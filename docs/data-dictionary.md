# Data dictionary

This file lists the columns of all data files in `data/`. Each table gives the column name, the unit (when the file or a readme gives one) and one example value per file. The example is the first data row of the file. Do not edit the files in `data/`.

Generated from the first three lines of each file. Row counts include the header lines.

## 👱🏻‍♂️🫛 Anttila (FI-Ant) and 🐟🌱 Särkisuo (FI-Sar)

Both sites use the same file layouts. Line 1 is the header. Line 2 is a unit row. Data starts on line 3. Missing value: `-9999`. Half-hour time step. Timestamps are local time (UTC+2). Coordinates are not in the data files. Anttila 63.1453 N, 27.3128 E; Särkisuo 63.15142822 N, 27.19906425 E (project team, 2026-10-22).

| File | Rows | Columns | Period (first to last timestamp) |
|---|---|---|---|
| `data/Anttila/EC_flux_L3_final_FI-Ant_2022.csv` | 17522 | 197 | 2022-01-01 00:00:00 to 2022-12-31 23:30:00 |
| `data/Anttila/EC_flux_L3_final_FI-Ant_2023.csv` | 17522 | 197 | 2023-01-01 00:00:00 to 2023-12-31 23:30:00 |
| `data/Anttila/biomet_final_30min_FI-Ant_2022.csv` | 17522 | 32 | 2022-01-01 00:00:00 to 2022-12-31 23:30:00 |
| `data/Anttila/biomet_final_30min_FI-Ant_2023.csv` | 17522 | 26 | 2023-01-01 00:00:00 to 2023-12-31 23:30:00 |
| `data/Särkisuo/EC_flux_L3_final_FI-Sar_2022.csv` | 17522 | 197 | 2022-01-01 00:00:00 to 2022-12-31 23:30:00 |
| `data/Särkisuo/EC_flux_L3_final_FI-Sar_2023.csv` | 17522 | 197 | 2023-01-01 00:00:00 to 2023-12-31 23:30:00 |
| `data/Särkisuo/biomet_final_30min_FI-Sar_2022.csv` | 17522 | 29 | 2022-01-01 00:00:00 to 2022-12-31 23:30:00 |
| `data/Särkisuo/biomet_final_30min_FI-Sar_2023.csv` | 17522 | 29 | 2023-01-01 00:00:00 to 2023-12-31 23:30:00 |

### EC flux L3 files (197 columns, identical header in all four files)

Column name pattern:

- `{gas}_flux_final_gap`: gap flag, 1 = value was gap-filled, 0 = measured. Gas is `co2`, `LE`, `ch4` or `n2o`.
- `{gas}_flux_final_gf_{METHOD}`: gap-filled flux. METHOD is `RF`, `XGB`, `kNN`, `MDS`, `MDSss` or `ensemble`. Suffix `_rand_err` is the random error. Suffix `_sys_err` is the systematic error. Unit µmol m-2 s-1, LE in W m-2.
- `{Reco|GPP|Rref|Rref_unc|alpha|alpha_unc|beta|beta_unc|E0|E0_unc}_gf_{METHOD}_{DT|NT}`: flux partitioning. `DT` is the daytime method. `NT` is the night-time method.

| Column | Unit | Example Ant 2022 | Example Ant 2023 | Example Sar 2022 | Example Sar 2023 |
|---|---|---|---|---|---|
| `time` | yyyy-mm-dd HH:MM:SS | 2022-01-01 00:00:00 | 2023-01-01 00:00:00 | 2022-01-01 00:00:00 | 2023-01-01 00:00:00 |
| `co2_flux_final_gap` | - | 1.00000000 | 1 | 1 | 1 |
| `co2_flux_final_gf_RF` | µmol+1s-1m-2 | 0.44701907 | 0.63925317 | 0.42954824 | 0.45002009 |
| `co2_flux_final_gf_RF_rand_err` | µmol+1s-1m-2 | 0.11020924 | 0.10048892 | 0.07641483 | 0.32222836 |
| `co2_flux_final_gf_RF_sys_err` | µmol+1s-1m-2 | 0.03857309 | 0.06881710 | 0.00000000 | 0.00000000 |
| `co2_flux_final_gf_XGB` | µmol+1s-1m-2 | 0.46175605 | 0.81009364 | 0.48365289 | 0.78573650 |
| `co2_flux_final_gf_XGB_rand_err` | µmol+1s-1m-2 | 0.08245511 | 1.08238267 | 0.03414818 | 0.11386806 |
| `co2_flux_final_gf_XGB_sys_err` | µmol+1s-1m-2 | 0.05696918 | 0.28515503 | 0.00000000 | 0.00000000 |
| `co2_flux_final_gf_kNN` | µmol+1s-1m-2 | 0.42010942 | 0.48615528 | 0.42088898 | 0.46048282 |
| `co2_flux_final_gf_kNN_rand_err` | µmol+1s-1m-2 | 0.10437964 | 0.35588729 | 0.16502925 | 0.06257193 |
| `co2_flux_final_gf_kNN_sys_err` | µmol+1s-1m-2 | 0.06344041 | 0.07066526 | 0.02396993 | 0.00000000 |
| `co2_flux_final_gf_MDS` | µmol+1s-1m-2 | 0.5270187088645 | 0.580240197 | 0.42681278563398695 | 0.5076280133 |
| `co2_flux_final_gf_MDS_rand_err` | µmol+1s-1m-2 | 0.22045892270266076 | 0.14680091216813532 | 0.10219372573294756 | 0.07416671590823344 |
| `co2_flux_final_gf_MDS_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.05460270 | 0.00000000 | 0.00000000 |
| `co2_flux_final_gf_MDSss` | µmol+1s-1m-2 | 0.52750093 | 0.58024020 | 0.42742934 | 0.50762801 |
| `co2_flux_final_gf_MDSss_rand_err` | µmol+1s-1m-2 | 0.23514922 | 0.14680091 | 0.09843083 | 0.07416672 |
| `co2_flux_final_gf_MDSss_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.06587598 | 0.00000000 | 0.00000000 |
| `co2_flux_final_gf_ensemble_rand_err` | µmol+1s-1m-2 | 0.09568692 | 0.25183903 | 0.08619282 | 0.13409235 |
| `co2_flux_final_gf_ensemble_sys_err` | µmol+1s-1m-2 | 0.05252554 | 0.08308984 | 0.00000000 | 0.00000000 |
| `co2_flux_final_gf_ensemble` | µmol+1s-1m-2 | 0.44701907 | 0.63925317 | 0.44469670 | 0.46048282 |
| `LE_final_gap` | - | 1.00000000 | 1 | 1 | 1 |
| `LE_final_gf_RF` | W+1m-2 | -0.12058561 | -3.19442784 | 0.08834658 | -4.80229375 |
| `LE_final_gf_RF_rand_err` | W+1m-2 | 0.72419224 | 1.25965971 | 0.40186995 | 2.54978836 |
| `LE_final_gf_RF_sys_err` | W+1m-2 | 0.20809914 | 0.00000000 | 0.00000000 | 1.37083594 |
| `LE_final_gf_XGB` | W+1m-2 | -1.20728195 | -1.31681728 | -0.45985848 | -2.30407882 |
| `LE_final_gf_XGB_rand_err` | W+1m-2 | 0.74867087 | 7.44467014 | 0.35850128 | 2.12972826 |
| `LE_final_gf_XGB_sys_err` | W+1m-2 | 0.22621733 | 1.93258709 | 0.37776357 | 1.59837868 |
| `LE_final_gf_kNN` | W+1m-2 | -0.53086621 | -3.21226504 | -0.35368462 | -4.49952570 |
| `LE_final_gf_kNN_rand_err` | W+1m-2 | 1.34211348 | 1.71257427 | 1.58052286 | 1.36416416 |
| `LE_final_gf_kNN_sys_err` | W+1m-2 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 |
| `LE_final_gf_MDS` | W+1m-2 | -0.35761034094000005 | -2.5391151066666664 | -0.37523905714569533 | -2.7210909 |
| `LE_final_gf_MDS_rand_err` | W+1m-2 | 1.2740428651397089 | 1.959276238704605 | 0.8983491572475694 | 2.89148821895567 |
| `LE_final_gf_MDS_sys_err` | W+1m-2 | 0.00000000 | 0.00000000 | 0.42180291 | 0.00000000 |
| `LE_final_gf_MDSss` | W+1m-2 | -0.27656845 | -2.53911511 | -0.29204191 | -2.72109090 |
| `LE_final_gf_MDSss_rand_err` | W+1m-2 | 1.13739620 | 1.95927624 | 0.74505148 | 2.89148822 |
| `LE_final_gf_MDSss_sys_err` | W+1m-2 | 0.00000000 | 0.00000000 | 0.41776253 | 0.00000000 |
| `LE_final_gf_ensemble_rand_err` | W+1m-2 | 0.69917152 | 2.11588303 | 0.54457927 | 1.65455954 |
| `LE_final_gf_ensemble_sys_err` | W+1m-2 | 0.00000000 | 0.00000000 | 0.00000000 | 1.19892778 |
| `LE_final_gf_ensemble` | W+1m-2 | -0.53086621 | -3.19442784 | -0.24173217 | -4.49952570 |
| `ch4_flux_final_gap` | - | 1.00000000 | 1 | -9999.00000000 | 1 |
| `ch4_flux_final_gf_RF` | µmol+1s-1m-2 | -0.00021485 | -0.00041760 | -9999.00000000 | 0.00837382 |
| `ch4_flux_final_gf_RF_rand_err` | µmol+1s-1m-2 | 0.00009732 | 0.00038602 | -9999.00000000 | 0.00176732 |
| `ch4_flux_final_gf_RF_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | -9999.00000000 | 0.00000000 |
| `ch4_flux_final_gf_XGB` | µmol+1s-1m-2 | -0.00033240 | 0.00172974 | -9999.00000000 | 0.00703493 |
| `ch4_flux_final_gf_XGB_rand_err` | µmol+1s-1m-2 | 0.00011896 | 0.00167493 | -9999.00000000 | 0.00100054 |
| `ch4_flux_final_gf_XGB_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.00133798 | -9999.00000000 | 0.00084264 |
| `ch4_flux_final_gf_kNN` | µmol+1s-1m-2 | -0.00044492 | -0.00053966 | -9999.00000000 | 0.00269894 |
| `ch4_flux_final_gf_kNN_rand_err` | µmol+1s-1m-2 | 0.00018309 | 0.00056787 | -9999.00000000 | 0.00066769 |
| `ch4_flux_final_gf_kNN_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | -9999.00000000 | 0.00000000 |
| `ch4_flux_final_gf_MDS` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `ch4_flux_final_gf_MDS_rand_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `ch4_flux_final_gf_MDS_sys_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `ch4_flux_final_gf_MDSss` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `ch4_flux_final_gf_MDSss_rand_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `ch4_flux_final_gf_MDSss_sys_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `ch4_flux_final_gf_ensemble_rand_err` | µmol+1s-1m-2 | 0.00008183 | 0.00062950 | -9999.00000000 | 0.00086546 |
| `ch4_flux_final_gf_ensemble_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | -9999.00000000 | 0.00000000 |
| `ch4_flux_final_gf_ensemble` | µmol+1s-1m-2 | -0.00033240 | -0.00041760 | -9999.00000000 | 0.00703493 |
| `n2o_flux_final_gap` | - | 1.00000000 | 1 | -9999.00000000 | 1 |
| `n2o_flux_final_gf_RF` | µmol+1s-1m-2 | 0.00053844 | 0.00005540 | -9999.00000000 | 0.00007078 |
| `n2o_flux_final_gf_RF_rand_err` | µmol+1s-1m-2 | 0.00005444 | 0.00005054 | -9999.00000000 | 0.00001721 |
| `n2o_flux_final_gf_RF_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | -9999.00000000 | 0.00000000 |
| `n2o_flux_final_gf_XGB` | µmol+1s-1m-2 | 0.00037272 | 0.00003893 | -9999.00000000 | 0.00005634 |
| `n2o_flux_final_gf_XGB_rand_err` | µmol+1s-1m-2 | 0.00004245 | 0.00004613 | -9999.00000000 | 0.00000815 |
| `n2o_flux_final_gf_XGB_sys_err` | µmol+1s-1m-2 | 0.00008926 | 0.00000000 | -9999.00000000 | 0.00000000 |
| `n2o_flux_final_gf_kNN` | µmol+1s-1m-2 | 0.00047142 | 0.00002779 | -9999.00000000 | 0.00010972 |
| `n2o_flux_final_gf_kNN_rand_err` | µmol+1s-1m-2 | 0.00010181 | 0.00005951 | -9999.00000000 | 0.00001813 |
| `n2o_flux_final_gf_kNN_sys_err` | µmol+1s-1m-2 | 0.00001690 | 0.00000000 | -9999.00000000 | 0.00003803 |
| `n2o_flux_final_gf_MDS` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `n2o_flux_final_gf_MDS_rand_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `n2o_flux_final_gf_MDS_sys_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `n2o_flux_final_gf_MDSss` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `n2o_flux_final_gf_MDSss_rand_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `n2o_flux_final_gf_MDSss_sys_err` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `n2o_flux_final_gf_ensemble_rand_err` | µmol+1s-1m-2 | 0.00003937 | 0.00003790 | -9999.00000000 | 0.00001079 |
| `n2o_flux_final_gf_ensemble_sys_err` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | -9999.00000000 | 0.00000000 |
| `n2o_flux_final_gf_ensemble` | µmol+1s-1m-2 | 0.00047142 | 0.00003893 | -9999.00000000 | 0.00007078 |
| `Reco_gf_RF_DT` | µmol+1s-1m-2 | 0.17477528 | 0.73905444 | 0.17241734 | 1.12031566 |
| `GPP_gf_RF_DT` | µmol+1s-1m-2 | -0.00000464 | -0.00000400 | -0.00000302 | -0.00015318 |
| `Rref_gf_RF_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_RF_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_RF_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_RF_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_RF_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_RF_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_RF_DT` | C | -9999.00000000 | 150.97527610 | 182.70229476 | 107.95643864 |
| `E0_unc_gf_RF_DT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_XGB_DT` | µmol+1s-1m-2 | 0.24773833 | 0.70574387 | 0.15897202 | 1.04858003 |
| `GPP_gf_XGB_DT` | µmol+1s-1m-2 | -0.00000579 | -0.00000369 | -0.00000337 | -0.00011924 |
| `Rref_gf_XGB_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_XGB_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_XGB_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_XGB_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_XGB_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_XGB_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_XGB_DT` | C | -9999.00000000 | 151.34492184 | 169.11878843 | 123.33198159 |
| `E0_unc_gf_XGB_DT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_kNN_DT` | µmol+1s-1m-2 | 0.22319180 | 0.57379826 | 0.14314538 | 0.82324748 |
| `GPP_gf_kNN_DT` | µmol+1s-1m-2 | -0.00000517 | -0.00000379 | -0.00000920 | -0.00005332 |
| `Rref_gf_kNN_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_kNN_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_kNN_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_kNN_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_kNN_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_kNN_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_kNN_DT` | C | -9999.00000000 | 150.52894630 | 235.01657135 | 154.81873353 |
| `E0_unc_gf_kNN_DT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_MDS_DT` | µmol+1s-1m-2 | 0.14462041 | 0.68049404 | 0.15982607 | 0.49984792 |
| `GPP_gf_MDS_DT` | µmol+1s-1m-2 | -0.00000400 | -0.00000354 | -0.00000586 | -0.00003784 |
| `Rref_gf_MDS_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_MDS_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_MDS_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_MDS_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_MDS_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_MDS_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_MDS_DT` | C | -9999.00000000 | 233.38954315 | 219.21458549 | 167.42766102 |
| `E0_unc_gf_MDS_DT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_MDSss_DT` | µmol+1s-1m-2 | 0.11269238 | 0.40031143 | 0.10923256 | 0.23523124 |
| `GPP_gf_MDSss_DT` | µmol+1s-1m-2 | -0.00004044 | -0.00007080 | -0.00009264 | -0.00045302 |
| `Rref_gf_MDSss_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | 0.46496118 |
| `Rref_unc_gf_MDSss_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | inf |
| `alpha_gf_MDSss_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | 0.06000000 |
| `alpha_unc_gf_MDSss_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | inf |
| `beta_gf_MDSss_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_MDSss_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_MDSss_DT` | C | -9999.00000000 | 145.67087680 | 192.66657444 | 167.48198606 |
| `E0_unc_gf_MDSss_DT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_ensemble_DT` | µmol+1s-1m-2 | 0.16267256 | 0.72510690 | 0.15744867 | 1.23870835 |
| `GPP_gf_ensemble_DT` | µmol+1s-1m-2 | -0.00000429 | -0.00000386 | -0.00000212 | -0.00020848 |
| `Rref_gf_ensemble_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_ensemble_DT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_ensemble_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_ensemble_DT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_ensemble_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_ensemble_DT` | (empty) | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_ensemble_DT` | C | -9999.00000000 | 153.77836956 | 169.23380424 | 97.05159619 |
| `E0_unc_gf_ensemble_DT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_RF_NT` | µmol+1s-1m-2 | 0.44701907 | 0.63925317 | 0.42954824 | 0.45002009 |
| `GPP_gf_RF_NT` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 |
| `Rref_gf_RF_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_RF_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_RF_NT` | C | 76.50623823 | 88.42654981 | 59.35697635 | 46.08198396 |
| `E0_unc_gf_RF_NT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_RF_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_RF_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_RF_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_RF_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_XGB_NT` | µmol+1s-1m-2 | 0.46175605 | 0.81009364 | 0.48365289 | 0.78573650 |
| `GPP_gf_XGB_NT` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 |
| `Rref_gf_XGB_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_XGB_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_XGB_NT` | C | 37.98572846 | 195.63435400 | 57.26432656 | 81.31958285 |
| `E0_unc_gf_XGB_NT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_XGB_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_XGB_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_XGB_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_XGB_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_kNN_NT` | µmol+1s-1m-2 | 0.42010942 | 0.48615528 | 0.42088898 | 0.46048282 |
| `GPP_gf_kNN_NT` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 |
| `Rref_gf_kNN_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_kNN_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_kNN_NT` | C | 42.57077016 | 53.08378099 | 46.21300492 | 98.00004674 |
| `E0_unc_gf_kNN_NT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_kNN_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_kNN_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_kNN_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_kNN_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_MDS_NT` | µmol+1s-1m-2 | 0.5270187088645 | 0.580240197 | 0.42681278563398695 | 0.5076280133 |
| `GPP_gf_MDS_NT` | µmol+1s-1m-2 | 0.0 | 0.0 | 0.0 | 0.0 |
| `Rref_gf_MDS_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_MDS_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_MDS_NT` | C | 37.08030652 | 36.07330376 | 54.16251778 | 35.36151898 |
| `E0_unc_gf_MDS_NT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_MDS_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_MDS_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_MDS_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_MDS_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_MDSss_NT` | µmol+1s-1m-2 | 0.52750093 | 0.58024020 | 0.42742934 | 0.50762801 |
| `GPP_gf_MDSss_NT` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 |
| `Rref_gf_MDSss_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_MDSss_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_MDSss_NT` | C | 68.59132078 | 32.78056182 | 77.58121107 | 34.83815153 |
| `E0_unc_gf_MDSss_NT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_MDSss_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_MDSss_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_MDSss_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_MDSss_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Reco_gf_ensemble_NT` | µmol+1s-1m-2 | 0.44701907 | 0.63925317 | 0.44469670 | 0.46048282 |
| `GPP_gf_ensemble_NT` | µmol+1s-1m-2 | 0.00000000 | 0.00000000 | 0.00000000 | 0.00000000 |
| `Rref_gf_ensemble_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `Rref_unc_gf_ensemble_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `E0_gf_ensemble_NT` | C | 36.65023464 | 85.38044607 | 56.13536150 | 97.78527816 |
| `E0_unc_gf_ensemble_NT` | C | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_gf_ensemble_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `alpha_unc_gf_ensemble_NT` | - | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_gf_ensemble_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |
| `beta_unc_gf_ensemble_NT` | µmol+1s-1m-2 | -9999.00000000 | -9999.00000000 | -9999.00000000 | -9999.00000000 |

### Biomet files (30 min)

Column suffix `_1_1_1` follows the AmeriFlux position code (horizontal, vertical, replicate). `SHF_2_1_1` is the second soil heat flux plate. `SWC_2_1_1` and `TS_2_1_1` are the second soil water content and soil temperature sensors.

Anttila 2022 has 32 columns. Anttila 2023 has 26 columns (no `SO411O2_*` and no `WTD_1_1_1`). Särkisuo has 29 columns in both years (no `BF5_*`).

| Column | Unit | Example Ant 2022 | Example Ant 2023 | Example Sar 2022 | Example Sar 2023 |
|---|---|---|---|---|---|
| `TIMESTAMP_1` | yyyy-mm-dd HH:MM:00 | 2022-01-01 00:00:00 | 2023-01-01 00:00:00 | 2022-01-01 00:00:00 | 2023-01-01 00:00:00 |
| `ALB_1_1_1` | other | -9999.0000 | -9999.0000 | -9999.0000 | -9999.0000 |
| `D_SNOW_1_1_1` | m / (empty) / other | -9999.0000 | 0.2640 | -9999.0000 | -9999.0000 |
| `LWIN_1_1_1` | W/m^2 | 285.2602 | 308.7732 | -9999.0000 | 312.1405 |
| `LWOUT_1_1_1` | W/m^2 | 285.0906 | 318.1724 | -9999.0000 | 318.5814 |
| `PPFD_1_1_1` | umol/m^2/s^1 | -0.0007 | -0.0012 | -0.0015 | -0.0075 |
| `P_RAIN_1_1_1` | mm | 0.0000 | 0.2000 | 0.0000 | 0.0000 |
| `RH_1_1_1` | % | 84.6626 | 92.5513 | 87.7359 | 98.8817 |
| `RN_1_1_1` | W/m^2 | -1.3226 | -12.6829 | -9999.0000 | -8.5699 |
| `SHF_1_1_1` | W/m^2 | -1.7700 | -1.8794 | -2.4817 | -2.3269 |
| `SHF_2_1_1` | W/m^2 | -2.0306 | -1.1926 | -2.0927 | -2.2790 |
| `SHF_3_1_1` | W/m^2 | -1.7212 | -2.9889 | -2.7451 | -2.6315 |
| `SO411O2_1_1_1` | (empty) / kPa | -9999.0000 | n/a | -9999.0000 | -9999.0000 |
| `SO411O2_1_2_1` | (empty) / kPa | -9999.0000 | n/a | -9999.0000 | -9999.0000 |
| `SO411O2_1_3_1` | (empty) / kPa | -9999.0000 | n/a | -9999.0000 | -9999.0000 |
| `SO411O2_1_4_1` | (empty) / kPa | -9999.0000 | n/a | -9999.0000 | -9999.0000 |
| `SO411O2_1_5_1` | (empty) / kPa | -9999.0000 | n/a | -9999.0000 | -9999.0000 |
| `SWC_1_1_1` | m^3/m^3 | 0.1599 | 0.2775 | 0.3539 | 0.4257 |
| `SWC_2_1_1` | m^3/m^3 | 0.3073 | 0.2851 | 0.5595 | 0.6583 |
| `SWC_3_1_1` | m^3/m^3 | 0.2267 | 0.2989 | 0.6564 | 0.7515 |
| `SWIN_1_1_1` | W/m^2 | -0.9960 | -7.1805 | -9999.0000 | -1.5891 |
| `SWIN_POT` | W/m^2 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| `SWOUT_1_1_1` | W/m^2 | 0.4962 | -3.8968 | -9999.0000 | 0.5048 |
| `TA_1_1_1` | C | -6.5222 | 2.8269 | -6.4806 | 2.8643 |
| `TS_1_1_1` | C | 0.4000 | 0.4733 | 0.4100 | 0.2433 |
| `TS_2_1_1` | C | 1.0767 | 0.9033 | 1.0000 | 0.8000 |
| `TS_3_1_1` | C | 1.5000 | 1.4000 | 1.6000 | 1.2000 |
| `WTD_1_1_1` | (empty) / m | -9999.0000 | n/a | -9999.0000 | -9999.0000 |
| `PA_1_1_1` | kPa | 98.9632 | 97.3250 | 98.8673 | -9999.0000 |
| `BF5_PARdiff_1_1_1` | umol/m^2/s^1 | -9999.0000 | 2.9525 | n/a | n/a |
| `BF5_PARtot_1_1_1` | umol/m^2/s^1 | -9999.0000 | 2.6357 | n/a | n/a |
| `BF5_Sunshine_1_1_1` | other | -9999.0000 | 1.0000 | n/a | n/a |

## 🧚🌾 Haltiala

EC tower: 60.271671 N, 24.944509 E (WGS84, from `geodata/haltiala_ec_tower_coords.txt`). Cropland. Crops: 2021 barley, 2022 oats, 2023 grass (failure), 2024 sunflowers, 2025 oats.

`data/Haltiala/haltiala.csv`: 81601 rows, 19 columns, comma delimiter, half-hour step. Timestamp format `yyyy-mm-dd HH:MM` (UTC+2). Missing value: `NA`. Period 2021-05-07 00:00 to 2025-12-31 23:30. Gap-filled with XGBoost, 10 models. See `data/Haltiala/ReadMe.md`.

| Column | Unit | Description | Example 2021-2025 |
|---|---|---|---|
| `TIMESTAMP_START` | yyyy-mm-dd HH:MM | Start of the half-hour period | 2021-05-07 00:00 |
| `NEE` | µmol m-2 s-1 | Measured CO2 flux | NA |
| `NEE_F` | µmol m-2 s-1 | Gap-filled CO2 flux, ensemble mean | 0.559385 |
| `NEE_F_UNC` | µmol m-2 s-1 | 95 % CI of the 10 models | 0.538254 |
| `TA_F` | deg C | Air temperature | 4.05 |
| `PPFD_IN_F` | µmol photon m-2 s-1 | Photosynthetically active radiation | 0 |
| `VPD_F` | hPa | Vapour pressure deficit | 1.10 |
| `TS_010_F` | deg C | Soil temperature at 10 cm | 7.87 |
| `SWC_010_F` | m3 m-3 | Soil water content at 10 cm | 0.52 |
| `NEE_F1` | µmol m-2 s-1 | Gap-filled CO2 flux, model 1 | 1.315681 |
| `NEE_F2` | µmol m-2 s-1 | Gap-filled CO2 flux, model 2 | 0.496509 |
| `NEE_F3` | µmol m-2 s-1 | Gap-filled CO2 flux, model 3 | 0.484872 |
| `NEE_F4` | µmol m-2 s-1 | Gap-filled CO2 flux, model 4 | 0.496509 |
| `NEE_F5` | µmol m-2 s-1 | Gap-filled CO2 flux, model 5 | 0.496509 |
| `NEE_F6` | µmol m-2 s-1 | Gap-filled CO2 flux, model 6 | 0.484872 |
| `NEE_F7` | µmol m-2 s-1 | Gap-filled CO2 flux, model 7 | 0.289772 |
| `NEE_F8` | µmol m-2 s-1 | Gap-filled CO2 flux, model 8 | 0.484872 |
| `NEE_F9` | µmol m-2 s-1 | Gap-filled CO2 flux, model 9 | 0.484872 |
| `NEE_F10` | µmol m-2 s-1 | Gap-filled CO2 flux, model 10 | 0.523530 |

Other Haltiala files:

- `haltiala_smear_management.xlsx`, sheet `Sheet1`. Columns: Year, Date (Excel serial), Action, Value, Units, Description. Example: 2021, 44323, EC system installed. Actions: Spraying, Seeding, Fertilisation, Harvest, Tillage, Sowing, Maintenance. The rows are typed by hand into `scripts/lib/events.ts` (`db/events.parquet`).
- `haltiala_smear_Lohkokortit_2025.pdf`: field parcel cards of 2025 (in Finnish). Not read by a script. The dates are typed by hand into `scripts/lib/events.ts`. The card gives 2025-06-16 for Jett Mn235 (the xlsx gives 2025-05-16).
- `geodata/haltiala.shp` (+ `.shx`, `.dbf`, `.prj`, `.cpg`, `.qmd`) and `geodata/haltiala.gpkg`: field geometry. CRS EUREF-FIN / TM35FIN (EPSG:3067).
- `geodata/haltiala_ec_tower_coords.txt`: `60.271671, 24.944509`.

## 🐂🐝 Qvidja

Location: N 60°17'43.20", E 22°23'30.60" (about 60.2953 N, 22.3918 E), 7 m a.s.l. Ecosystem type CRO. Clay loam. Forage grassland, fertilised and harvested twice per season, cow grazing in some years. EC height 2.3 m. Contact: Mika Korkiakoski (FMI). Source: `Qvidja-readme.xlsx`, sheet `HIKET_EC_variables`.

`data/Qvidja/Qvidja_2018-2025.csv`: 237556 rows, 28 columns, comma delimiter, half-hour step. Timestamp format `YYYYMMDDHHMM`. Missing value: empty field. Period 201805090200 to 202512312330. `_QC` columns: 0 = measured good quality, 1 = gap-filled.

| Column | Unit | Description | Example 2018-2025 |
|---|---|---|---|
| `TIMESTAMP_START` | YYYYMMDDHHMM | Start of averaging period | 201805090200 |
| `TIMESTAMP_END` | YYYYMMDDHHMM | End of averaging period | 201805090230 |
| `USTAR` | m s-1 | Friction velocity | 0.0241228 |
| `WS` | m s-1 | Wind speed | 0.302515 |
| `WD` | degrees from north | Wind direction | 335.385 |
| `NEE` | µmol CO2 m-2 s-1 | Net ecosystem exchange, gap-filled | 2.614237745630011 |
| `NEE_QC` |  | Quality flag for NEE | 1.0 |
| `GPP` | µmol CO2 m-2 s-1 | Gross primary production, daytime partitioning | 0.0 |
| `RECO` | µmol CO2 m-2 s-1 | Ecosystem respiration | 2.4175277853356123 |
| `H` | W m-2 | Sensible heat flux, measured | (empty) |
| `LE_F` | W m-2 | Latent heat flux, gap-filled | -4.534908490223289 |
| `LE_F_QC` |  | Quality flag for LE_F | 1.0 |
| `NETRAD` | W m-2 | Net radiation | -51.38 |
| `SW_IN_F` | W m-2 | Incoming shortwave radiation, gap-filled | 0.0 |
| `SW_IN_F_QC` |  | Quality flag for SW_IN_F | 0.0 |
| `SW_OUT` | W m-2 | Outgoing shortwave radiation | 0.25 |
| `TA_F` | deg C | Air temperature at EC height, gap-filled | 5.44 |
| `TA_F_QC` |  | Quality flag for TA_F | 0.0 |
| `P` | mm | Precipitation | 0.0 |
| `CO2` | ppm | CO2 mole fraction at EC height | 459.874 |
| `RH_F` | % | Relative humidity, gap-filled | 84.6 |
| `RH_F_QC` |  | Quality flag for RH_F | 0.0 |
| `VPD_F` | hPa | Vapour pressure deficit, gap-filled | 1.3842940056951691 |
| `VPD_F_QC` |  | Quality flag for VPD_F | 0.0 |
| `TS_1` | deg C | Soil temperature at 5 cm | 9.07 |
| `TS_2` | deg C | Soil temperature at 15 cm | (empty) |
| `TS_3` | deg C | Soil temperature at 30 cm | 10.64 |
| `SM` | V (readme: m3 m-3, not correct) | Soil moisture at 10 cm, raw output of the ML3 ThetaProbe in volts (provider, 2026-10-22). The build converts it to m3 m-3, see `docs/qvidja-soil-moisture.md` | 0.822 |

Other Qvidja files:

- `Qvidja_management.xlsx`, sheet `Taul1`. Columns: Date (Excel serial), Area of kasvulohko (ha), Management action, Name (Species/product), Amount, Unit, DM fraction, Harvest type, Duration (days), Straws removed (yes/no), Comment. Example: 45822, 4.42, grazing, horse, 4, (empty), (empty), (empty), 5. Actions: grazing, harvest, cultivation, fertilisation. The rows are typed by hand into `scripts/lib/events.ts` (`db/events.parquet`).
- `Qvidja-readme.xlsx`: variable descriptions and site metadata (used above).
- `Qvidja.pdf`, `Qvidja_C-balance.pdf`: reports. Not read by a script. Table 1 of `Qvidja_C-balance.pdf` (Heimsch et al. 2021) gives the 2018 and 2019 events; they are typed by hand into `scripts/lib/events.ts`.

## 👩🏻‍🔬🎓 Viikki

Field Alaniitty 1. Crops: 2022 timothy, 2023 barley / mixed grass / red clover, 2024 grassland, 2025 fava bean. Coordinates are not in the data files: 60.21845 N, 25.01986 E (project team, 2026-10-22). Timestamps are UTC+2.

### EC files `data/Viikki/EC/{2022,2023,2024,2025}.csv`

Version of 2026-10-20. Semicolon delimiter. Comma decimal mark (`0,13`). Datetime format `d.m.yyyy H:MM`. Missing value: empty field. Half-hour step, full calendar years. Encoding ISO-8859-1 (Latin-1): read with `encoding='latin-1'`. CRLF line ends. Units are in the column names. The degree sign is a literal `?` (`Tair (?C)`). Column names change a little by year (spaces, `PAR` / `PPFD`, `WL` / `Water level`). The soil columns `RD`, `T`, `EC`, `MP` and `WFPS` come from the same sensors as layers 1 and 2 of the soil pit; `WFPS1 / 100 × 0,509433962` = pit `WC1`.

| File | Rows | Columns | First datetime | Last datetime |
|---|---|---|---|---|
| `data/Viikki/EC/2022.csv` | 17521 | 35 | 1.1.2022 0:00 | 31.12.2022 23:30 |
| `data/Viikki/EC/2023.csv` | 17521 | 34 | 1.1.2023 0:00 | 31.12.2023 23:30 |
| `data/Viikki/EC/2024.csv` | 17569 | 30 | 1.1.2024 0:00 | 31.12.2024 23:30 |
| `data/Viikki/EC/2025.csv` | 17521 | 30 | 1.1.2025 0:00 | 31.12.2025 23:30 |

#### 2022 and 2023 (same layout; `n/a` = column not in that file)

| Column | Unit | Example 2022 | Example 2023 |
|---|---|---|---|
| `Datetime` | local time UTC+2 | 1.1.2022 0:00 | 1.1.2023 0:00 |
| `PAR (umol/m2s)` | µmol m-2 s-1 | -0,13 | -0,17 |
| `Pair` | kPa | 100,22 | 99,39 |
| `WS (m/s)` | m s-1 | 1,1 | 4,7 |
| `WD (deg)` | degrees | 329 | 242 |
| `P (mm)` | mm | 0 | 0 |
| `Snow Depth` | cm | 9 | 9 |
| `NEE (mg CO2 m-2 s-1)` | mg CO2 m-2 s-1, measured | (empty) | (empty) |
| `NEE_gapfilled (mg CO2 m-2 s-1)` | mg CO2 m-2 s-1 | 0,006168531 | 0,023166791 |
| `N2O (ug m-2 s-1)` | µg m-2 s-1, measured | (empty) | 0,010170237 |
| `N2O_gapfilled (ug m-2 s-1)` | µg m-2 s-1 | 0,004809073 | 0,010170237 |
| `RH(%)` | % | 92,43 | 89,54 |
| `SWin (W/m2)` | W m-2 | -4,87 | -9,34 |
| `Swout (W/m2)` | W m-2 | -3,47 | -6,17 |
| `LWin (W/m2)` | W m-2 | -25,51 | -97,06 |
| `LWout  (W/m2)` (two spaces) | W m-2 | -15,21 | -24,92 |
| `Tair  (?C)` (two spaces) | °C | -0,95 | 4,47 |
| `RD1 (mV)` | mV | (empty) | 603,4 |
| `RD2 (mV)` | mV | (empty) | 687,3166667 |
| `T1 (?C)` | °C, 14 cm | (empty) | 0,4 |
| `T2 (?C)` | °C, 37 cm | (empty) | 1,5 |
| `EC1 (µS/cm)` | µS cm-1 | (empty) | 111,65 |
| `EC2 (µS/cm)` | µS cm-1 | (empty) | 505,5166667 |
| `MP1 (kPa)` | kPa | (empty) | -0,1 |
| `MP2 (kPa)` | kPa | (empty) | -0,1 |
| `MP3 (kPa)` | kPa | (empty) | n/a |
| `Soil Bulk density` | g cm-3 | 1,3 | 1,3 |
| `Soil Particle Density` | g cm-3 | 2,65 | 2,65 |
| `Total Porosity` | - | 0,509433962 | 0,509433962 |
| `WFPS1 (%)` | % | (empty) | 104,716448 |
| `WFPS2 (%)` | % | (empty) | 83,98008019 |
| `HF (W/m2)` | W m-2 | (empty) | (empty) |
| `WL (m)` | m | (empty) | -0,1225 |
| `rainfall` | mm | 0 | 0 |
| `snowfall` | mm | 0 | 0 |

In 2022 the columns are in the order `rainfall`, `snowfall`; in 2023 `snowfall`, `rainfall`. The soil columns of 2022 start on 12.4.2022.

#### 2024 and 2025 (same layout; names differ as shown)

| Column 2024 | Column 2025 | Unit | Example 2024 | Example 2025 |
|---|---|---|---|---|
| `Datetime` | `Datetime` | local time UTC+2 | 1.1.2024 0:00 | 1.1.2025 0:00 |
| `PAR (umol/m2s)` | `PPFD (umol/m2s)` | µmol m-2 s-1 | -0,11 | -0,05 |
| `WS (m/s)` | `WS (m/s)` | m s-1 | 2 | 1,2 |
| `WD (deg)` | `WD (deg)` | degrees | 359 | 143 |
| `P(mm)` | `P (mm)` | mm | 0 | 0 |
| `Snow Depth` | `Snow Depth` | cm | 30 | 2 |
| `NEE (mg CO2 m-2 s-1)` | `NEE (mg CO2 m-2 s-1)` | mg CO2 m-2 s-1, measured | (empty) | (empty) |
| `NEE _gapfilled (mg CO2 m-2 s-1)` | `NEE_gapfilled (mg CO2 m-2 s-1)` | mg CO2 m-2 s-1 | -0,003480355 | 0,042526907 |
| `N2O (ug m-2 s-1)` | `N2O (ug m-2 s-1)` | µg m-2 s-1, measured | (empty) | (empty) |
| `N2O_gapfilled (ug m-2 s-1)` | `N2O_gapfilled (ug m-2 s-1)` | µg m-2 s-1 | 0,038725614 | 0,001741306 |
| `RH (%)` | `RH (%)` | % | 85 | 81,2 |
| `SWin (W/m2)` | `SWin (W/m2)` | W m-2 | -8,02 | -5,61 |
| `SWout (W/m2)` | `SWout (W/m2)` | W m-2 | -5,39 | -3,23 |
| `LWin (W/m2)` | `LWin (W/m2)` | W m-2 | -76,87 | -38,98 |
| `LWout (W/m2)` | `LWout (W/m2)` | W m-2 | -22,53 | -10,7 |
| `Tair (?C)` | `Tair (?C)` | °C | -16,7 | -2,44 |
| `RD1 (mV)` | `RD1 (mV)` | mV | 767,9 | -132,7 |
| `RD2 (mV)` | `RD2 (mV)` | mV | 728 | 464,7 |
| `T1 (?C)` | `T1 (?C)` | °C, 14 cm | 0,1 | 1,3 |
| `T2 (?C)` | `T2 (?C)` | °C, 37 cm | 1,1 | 2,7 |
| `EC1  (µS/cm)` (two spaces) | `EC1 (µS/cm)` | µS cm-1 | 29,2 | 390,5 |
| `EC2  (µS/cm)` (two spaces) | `EC2 (µS/cm)` | µS cm-1 | 442,4 | 435,4 |
| `MP1 (kPa)` | `MP1 (kPa)` | kPa | 0 | 0 |
| `MP2 (kPa)` | `MP2 (kPa)` | kPa | -0,1 | -0,1 |
| `WFPS1 (%)` | `WFPS1 (%)` | % | 55,39841096 | 97,95491996 |
| `WFPS2 (%)` | `WFPS2 (%)` | % | 76,33782763 | 76,87083096 |
| `HF(W/m2)` | `HF (W/m2)` | W m-2 | (empty) | (empty) |
| `WL(m)` | `Water level (m)` | m | -0,4 | -0,1 |
| `snowfall` | `Snowfall` | mm | 0 | 0 |
| `rainfall` | `Rainfall` | mm | 0 | 0 |

Units of `Pair`, `Snow Depth`, `rainfall`, `snowfall` and the bulk densities are not in the files; the values given here follow the usual units of the station. The gap-filled NEE of 2025 equals the former `NEE_F_XGB` column divided by 22,7224.

- `EC/Management Information.docx`: one table, one row per year 2022 to 2025. Columns: Year, Crop, N source, N input (kg N ha-1), Application date, Harvest dates, Tillage date, Yield (kg DW/ha). Dates are day and month, for example `27 Apr; 25 May`. Example: 2022, Timothy, CAN (mineral fertilizer), 108.0, 10 May, 1 Jul; 27 Aug, 2 Nov, 3673. Not read by a script. The rows are typed by hand into `scripts/lib/events.ts` (events) and `scripts/lib/calc/management.ts` (yields).

### Soil pit files `data/Viikki/pit1_cleaned_{2023,2024,2025}.csv`

Comma delimiter. 5-minute step. Timestamp format `yyyy-mm-dd HH:MM:SS`. Missing value: empty field. Each file starts on 31 December of the previous year. Campbell CR800 logger. Layer index 1 to 5 = depth 14, 37, 54, 95, 120 cm. Redox values need a +200 mV correction. Source: `pit1_metadata.txt`.

| Column | Unit | Example 2023 | Example 2024 | Example 2025 |
|---|---|---|---|---|
| `TIMESTAMP` | yyyy-mm-dd HH:MM:SS | 2022-12-31 00:05:00 | 2023-12-31 00:05:00 | 2024-12-31 00:05:00 |
| `RECORD` | count | 107207 | 211823 | 317231 |
| `Redox_Avg_1` | mV (uncorrected) | 471.4 | 557.2 | -406.2 |
| `Redox_Avg_2` | mV (uncorrected) | 489.6 | 527.4 | 261.5 |
| `Redox_Avg_3` | mV (uncorrected) | 500.8 | 509.5 | 281.2 |
| `Redox_Avg_4` | mV (uncorrected) | 489.2 | 157.9 | 223 |
| `Redox_Avg_5` | mV (uncorrected) | 479.7 | 190.8 | 123.6 |
| `Temp_T12_Avg_1` | deg C | 0.4 | 0.2 | 2.2 |
| `EC_Avg_1` | µS cm-1 | 60 | 36 | 397 |
| `Temp_T12_Avg_2` | deg C | 1.5 | 1.1 | 3.2 |
| `EC_Avg_2` | µS cm-1 | 540.1 | 441.9 | 435 |
| `Temp_T12_Avg_3` | deg C | 2.4 | 1.8 | 3.4 |
| `EC_Avg_3` | µS cm-1 | 382 | 296.1 | 279 |
| `Temp_T12_Avg_4` | deg C | 3.3 | 2.7 | 4 |
| `EC_Avg_4` | µS cm-1 | 424.8 | 347 | 365 |
| `Temp_T12_Avg_5` | deg C | 4.5 | 3.8 | 5 |
| `EC_Avg_5` | µS cm-1 | 563.5 | 524 | 511 |
| `Matric_potential_Avg_1` | kPa | -0.1 | 0 | 0 |
| `Temp_T21_Avg_1` | deg C | 0.5 | 0.3 | 2.2 |
| `Matric_potential_Avg_2` | kPa | -0.1 | -0.1 | -0.1 |
| `Temp_T21_Avg_2` | deg C | 1.6 | 1.2 | 3.3 |
| `Matric_potential_Avg_3` | kPa | 0 | 0 | 0 |
| `Temp_T21_Avg_3` | deg C | 2.5 | 2 | 3.6 |
| `Matric_potential_Avg_4` | kPa | 0 | 0 | 0 |
| `Temp_T21_Avg_4` | deg C | 3.2 | 2.6 | 3.9 |
| `Matric_potential_Avg_5` | kPa | -0.1 | -0.1 | -0.1 |
| `Temp_T21_Avg_5` | deg C | 4.6 | 4 | 5.1 |
| `Water_level_Avg` | m of water | 1.777 | 1.628 | 1.989 |
| `Temp_ottpls_Avg` | deg C | 6.8 | 6.5 | 7.4 |
| `shf_plate_Avg` | W m-2 | (empty) | (empty) | (empty) |
| `WC1` | m3 m-3 | 0.4490929 | 0.293545 | 0.4999078 |
| `WC2` | m3 m-3 | 0.4273705 | 0.386641 | 0.3924595 |
| `WC3` | m3 m-3 | 0.4250431 | 0.421552 | 0.4456018 |
| `WC4` | m3 m-3 | 0.4374559 | 0.4339648 | 0.4296979 |
| `WC5` | m3 m-3 | 0.4960288 | 0.4995199 | 0.4983562 |
| `PTemp_C_Avg` | deg C | n/a | -7.404 | n/a |
| `Temp_corrected_oxygen` | % | n/a | n/a | (empty) |
| `Temp_PT100_Avg` | deg C | n/a | n/a | (empty) |

## 🇰🇪🌽 Maktau (KE-Mkt)

Taita region, Kenya. Latitude -3.425859, longitude 38.140663. UTC+3. Ecosystem CRO. Maize 80 %, vegetables 20 %. EC height 3.3 m, LI-7500DS and Gill Windmaster Pro. PI: Matti Räsänen. Source: `Ancillary_KE-Mkt.csv` (Windows-1252 encoding, CRLF).

All three data files use comma delimiter, AmeriFlux/FLUXNET variable names, timestamps `YYYYMMDDHHMM` and `-9999` for missing values. Units are not in the files. Many columns in `Continuous_KE-Mkt.csv` contain only `-9999`.

| File | Rows | Columns | Period (TIMESTAMP_START first to last) |
|---|---|---|---|
| `data/Maktau/Continuous_KE-Mkt.csv` | 99501 | 165 | 201812171200 to 202409041100 |
| `data/Maktau/Maktau_meteo_30_min_KE-Mkt.csv` | 182065 | 44 | 201408231630 to 202501101600 |
| `data/Maktau/Maktau_meteo_1_hour_KE-Mkt.csv` | 53380 | 25 | 201811011300 to 202412031500 |

### `Continuous_KE-Mkt.csv` (EC and biomet, 30 min)

| Column | Example first row |
|---|---|
| `TIMESTAMP_END` | 201812171230 |
| `TIMESTAMP_START` | 201812171200 |
| `CH4` | -9999 |
| `CH4_MIXING_RATIO` | -9999 |
| `CO` | -9999 |
| `CO2` | 395.027 |
| `CO2_MIXING_RATIO` | 403.619 |
| `CO2_SIGMA` | 0.112200267 |
| `CO2C13` | -9999 |
| `FC` | -8.2375 |
| `FCH4` | -9999 |
| `FN2O` | -9999 |
| `FNO` | -9999 |
| `FNO2` | -9999 |
| `FO3` | -9999 |
| `H2O` | 21.2876 |
| `H2O_MIXING_RATIO` | 21.7506 |
| `H2O_SIGMA` | 17.70802078 |
| `N2O` | -9999 |
| `N2O_MIXING_RATIO` | -9999 |
| `NO` | -9999 |
| `NO2` | -9999 |
| `O3` | -9999 |
| `SC` | -9999 |
| `SCH4` | -9999 |
| `SN2O` | -9999 |
| `SNO` | -9999 |
| `SNO2` | -9999 |
| `SO2` | -9999 |
| `SO3` | -9999 |
| `G_1_1_1` | 19.85 |
| `G_1_2_2` | 30.29 |
| `G_1_3_3` | 44.37 |
| `H` | 254.98 |
| `LE` | -9999 |
| `SB` | -9999 |
| `SG` | -9999 |
| `SH` | -9999 |
| `SLE` | -9999 |
| `Quality Check Flags` | 0 |
| `FC_SSITC_TEST` | 1 |
| `FCH4_SSITC_TEST` | -9999 |
| `FN2O_SSITC_TEST` | -9999 |
| `FNO_SSITC_TEST` | -9999 |
| `FNO2_SSITC_TEST` | -9999 |
| `FO3_SSITC_TEST` | -9999 |
| `H_SSITC_TEST` | 1 |
| `LE_SSITC_TEST` | 1 |
| `TAU_SSITC_TEST` | 1 |
| `FETCH_70` | 31.0746 |
| `FETCH_80` | -9999 |
| `FETCH_90` | 46.5554 |
| `FETCH_FILTER` | 0 |
| `FETCH_MAX` | 16.9963 |
| `PA_1_1_1` | 89.7 |
| `PBLH` | -9999 |
| `RH_1_1_1` | 59.79 |
| `T_SONIC` | 29.278 |
| `T_SONIC_SIGMA` | 1.02855 |
| `TA_1_1_1` | 27.43 |
| `VPD` | 14.7 |
| `D_SNOW` | -9999 |
| `P_1_1_1` | 0 |
| `P_RAIN_1_1_1` | 0 |
| `P_SNOW` | -9999 |
| `RUNOFF` | -9999 |
| `STEMFLOW` | -9999 |
| `THROUGHFALL` | -9999 |
| `TSN` | -9999 |
| `ALB` | -9999 |
| `APAR` | -9999 |
| `EVI` | -9999 |
| `FAPAR` | -9999 |
| `FIPAR` | -9999 |
| `LW_BC_IN` | -9999 |
| `LW_BC_OUT` | -9999 |
| `LW_IN` | -9999 |
| `LW_OUT` | -9999 |
| `MCRI` | -9999 |
| `MTCI` | -9999 |
| `NDVI_1_1_1` | 0.36467737 |
| `NDVI_2_1_1` | 0.562978821 |
| `NETRAD_1_1_1` | 754.7 |
| `NIRV` | -9999 |
| `PPFD_BC_IN` | -9999 |
| `PPFD_BC_OUT` | -9999 |
| `PPFD_DIF` | -9999 |
| `PPFD_DIR` | -9999 |
| `PPFD_IN` | -9999 |
| `PPFD_OUT` | -9999 |
| `PRI` | -9999 |
| `R_UVA` | -9999 |
| `R_UVB` | -9999 |
| `REDCI` | -9999 |
| `REP` | -9999 |
| `SPEC_NIR_IN_1_1_1` | 1.679 |
| `SPEC_NIR_IN_1_2_2` | 1.471 |
| `SPEC_NIR_IN_1_3_3` | 2 |
| `SPEC_NIR_OUT_1_1_1` | 0.05 |
| `SPEC_NIR_OUT_1_2_2` | 0.078 |
| `SPEC_NIR_OUT_1_3_3` | 1 |
| `SPEC_NIR_OUT_2_1_1` | 0.037 |
| `SPEC_NIR_OUT_2_2_2` | 0.097 |
| `SPEC_NIR_OUT_2_3_3` | 1 |
| `SPEC_NIR_REFL` | -9999 |
| `SPEC_PRI_REF_IN` | -9999 |
| `SPEC_PRI_REF_OUT` | -9999 |
| `SPEC_PRI_REF_REFL` | -9999 |
| `SPEC_PRI_TGT_IN` | -9999 |
| `SPEC_PRI_TGT_OUT` | -9999 |
| `SPEC_PRI_TGT_REFL` | -9999 |
| `SPEC_RED_IN` | -9999 |
| `SPEC_RED_OUT` | -9999 |
| `SPEC_RED_REFL` | -9999 |
| `SR` | -9999 |
| `SW_BC_IN` | -9999 |
| `SW_BC_OUT` | -9999 |
| `SW_DIF` | -9999 |
| `SW_DIR` | -9999 |
| `SW_IN_1_1_1` | 754.7 |
| `SW_OUT` | -9999 |
| `TCARI` | -9999 |
| `SWC_1_1_1` | 0.084476105 |
| `SWC_1_2_2` | 0.090507168 |
| `SWC_1_3_3` | 0.093522699 |
| `SWP_2_1_1` | -933.4 |
| `SWP_2_2_2` | -1875.7 |
| `SWP_2_3_3` | -1282.6 |
| `SWP_3_1_1` | -383 |
| `SWP_3_2_2` | -1151.5 |
| `SWP_3_3_3` | -1472.6 |
| `TS_1_1_1` | 26.49 |
| `TS_1_2_2` | 25.01 |
| `TS_1_3_3` | 26.21 |
| `TS_2_1_1` | 26.9 |
| `TS_2_2_2` | 26.2 |
| `TS_2_3_3` | 27.1 |
| `TS_3_1_1` | 25 |
| `TS_3_2_2` | 26.2 |
| `TS_3_3_3` | 26.9 |
| `TS_4_1_1` | -4.427283 |
| `WTD` | 100 |
| `TW` | -9999 |
| `PPFD_UW_IN` | -9999 |
| `COND_WATER` | -9999 |
| `PCO2` | -9999 |
| `PCH4` | -9999 |
| `PN2O` | -9999 |
| `DO` | -9999 |
| `MO_LENGTH` | -63.4883 |
| `TAU` | -0.352707 |
| `U_SIGMA` | 1.14390122 |
| `USTAR` | 0.58 |
| `V_SIGMA` | 1.622467257 |
| `W_SIGMA` | 0.789476409 |
| `WD` | 48.3091 |
| `WS` | -1.66456 |
| `WS_MAX` | 9.24592 |
| `ZL` | -0.0277216 |
| `DBH` | -9999 |
| `LEAF_WET` | -9999 |
| `SAP_DT` | -9999 |
| `SAP_FLOW` | -9999 |
| `T_BOLE` | -9999 |
| `T_CANOPY_1_1_1` | -1.645455 |

### `Maktau_meteo_30_min_KE-Mkt.csv`

| Column | Example first row |
|---|---|
| `TIMESTAMP_END` | 201408231700 |
| `TIMESTAMP_START` | 201408231630 |
| `TA_1_1_1` | 28.17 |
| `RH_1_1_1` | 43.39 |
| `P_RAIN_1_1_1` | 0 |
| `WS_1_1_1` | 1.285 |
| `WD_1_1_1` | 166.6 |
| `SW_IN_1_1_1` | 272.3 |
| `TS_1_1_1` | 8.99 |
| `TS_1_2_2` | 7.071 |
| `TS_1_3_3` | 6.813 |
| `G_1_1_1` | 36.69 |
| `G_1_2_2` | 35.38 |
| `G_1_3_3` | 37.97 |
| `PA_1_1_1` | 89.2 |
| `SWP_2_1_1` | -9999 |
| `SWP_2_2_2` | -9999 |
| `SWP_2_3_3` | -9999 |
| `TS_2_1_1` | -9999 |
| `TS_2_2_2` | -9999 |
| `TS_2_3_3` | -9999 |
| `SWP_3_1_1` | -9999 |
| `SWP_3_2_2` | -9999 |
| `SWP_3_3_3` | -9999 |
| `TS_3_1_1` | -9999 |
| `TS_3_2_2` | -9999 |
| `TS_3_3_3` | -9999 |
| `SPEC_NIR_IN_1_1_1` | -9999 |
| `SPEC_NIR_IN_1_2_2` | -9999 |
| `SPEC_NIR_IN_1_3_3` | -9999 |
| `SPEC_NIR_OUT_1_1_1` | -9999 |
| `SPEC_NIR_OUT_1_2_2` | -9999 |
| `SPEC_NIR_OUT_1_3_3` | -9999 |
| `SPEC_NIR_OUT_2_1_1` | -9999 |
| `SPEC_NIR_OUT_2_2_2` | -9999 |
| `SPEC_NIR_OUT_2_3_3` | -9999 |
| `TS_4_1_1` | -9999 |
| `T_CANOPY_1_1_1` | -9999 |
| `NDVI_1_1_1` | -9999 |
| `NDVI_2_1_1` | -9999 |
| `SWC_1_1_1` | 0.04343137 |
| `SWC_1_2_2` | 0.070236094 |
| `SWC_1_3_3` | 0.080622925 |
| `NETRAD_1_1_1` | -9999 |

### `Maktau_meteo_1_hour_KE-Mkt.csv`

The last column has an empty header name.

| Column | Example first row |
|---|---|
| `TIMESTAMP_END` | 201811011400 |
| `TIMESTAMP_START` | 201811011300 |
| `TA_2_1_1` | 28.45 |
| `RH_2_1_1` | 47.48 |
| `SW_IN_2_1_1` | 1034 |
| `SW_OUT_2_2_1` | 125.2 |
| `ALB_1_1_1` | 0.121 |
| `UpTot_Avg_s` | 932 |
| `DnTot_Avg_s` | 239.6 |
| `NETRAD_2_1_1` | 692.6 |
| `LW_IN_2_3_1` | 366.3 |
| `LW_OUT_2_4_1` | 582.8 |
| `SWC_4_1_1` | 0.229 |
| `TS_4_1_1` | 28.53 |
| `SWC_4_2_2` | 0.23 |
| `TS_4_2_2` | 28.14 |
| `SWC_4_3_3` | 0.214 |
| `TS_4_3_3` | 27.83 |
| `PPFD_IN_1_1_1` | 2221 |
| `PA_2_1_1` | 894 |
| `G_2_1_1` | 0 |
| `SPEC_NIR_OUT_2_1_1` | -9999 |
| `SPEC_NIR_OUT_2_2_2` | -9999 |
| `SPEC_NIR_OUT_2_3_3` | -9999 |
| `(unnamed col 24)` | (empty) |

### `Ancillary_KE-Mkt.csv` (site metadata, key/value)

| Variable | Description |
|---|---|
| Metadata about the site |  |
| COORDINATES | Latitude: -3.425859, Longitude: 38.140663 |
| PI CONTACT | Name: Matti Räsänen, Email: matti.rasanen@helsinki.fi |
| SITE MEMBERS | 1.Name: Julius Omondi Email: julius.omondi@helsinki.fi<br>2.Name: Petri Pellikka, Email: petri.pellikka@helsinki.fi <br>3.Name: Timo Vesala, Email: timo.vesala@helsinki.fi |
| UTC OFFSET | UTC+03:00 |
| EC SYSTEM HEIGHT | 3.3 m |
| IRGA MODEL | LI-7500DS Open Path CO2/H2O Analyzer |
| SONIC MODEL | Gill Windmaster Pro-3D |
| ECOSYSTEM | CRO |
| SITE NAME | Maktau |
| SENSORS HEIGHT | 1. TA: 2 m<br>2. RH: 2 m<br>3. NETRAD: 4 m<br>4. SWC: 10 cm, 30 cm, 50 cm<br>5. TS: 10 cm, 30 cm, 50 cm<br>6. G:  5 cm, 10 cm, 30 cm, 50 cm<br>7. PAR: 4.0 m<br>8. PA: 2 m, <br>9. P_RAIN: 0 m and 1.5 m<br>10. SWP: 10 cm, 30 cm, 50 cm<br>11. SW_IN: 4 m<br>12. SW_OUT: 4 m <br>13. ALB: 4 m <br>14. LW_IN: 4 m <br>15. LW_OUT: 4 m |
| Ancillary data |  |
| CANOPY HEIGHT | cm : [0, 5, 6, 6, 6, 23, 23, 65, 66, 85, 128, 132, 226, 242, 245, 247, 247, 253] |
| LAI | [0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 3, 1, 8, 5, 2, 6, 4, 5] |
| SPECIES | 1.Maize (Zea mays L.): 80%<br>2.Vegetables: 20% |
| AGE | - |
| DISTURBANCES | 1.Maize Stover Burning: Residual stover is burned after-harvest—in June/July after the Long Rains (March–May) and in January/February after the Short Rains (October–December).<br>2.Pre Season weed control: Weed growth peaks just before sowing—with active weeding and burning in March/April before the Long Rains and in September/October before the Short Rains.<br>3.Conventional land preparation: land is prepared by completely opening and turning the soil using ox-driven ploughs before sowing. <br>4. Solar power outages during cloudy days |

- `BADM-Site-General-Info-KE-Mkt.xlsx`: AmeriFlux BADM site template. Sheets `Site_General_Info` (Variable, Description, Units, value), `LIST(VOCABULARY)`, `Explanations`. Example: SITE_ID = KE-Mkt, SUBMISSION_DATE = 20250429.

