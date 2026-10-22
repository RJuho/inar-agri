# Qvidja soil moisture (`SM`): unit and conversion

Status: resolved on 2026-10-22. The data provider (Mika Korkiakoski, FMI) confirmed on 2026-10-22 that `SM` in `data/Qvidja/Qvidja_2018-2025.csv` is "raw": the output of the sensor, not the volumetric water content. The harmonised database build now converts `SM` to m³ m⁻³ with the polynomial of the sensor manual. First check: 2026-10-21. Conversion: 2026-10-22.

## Summary

- Sensor: Delta-T ML3 ThetaProbe at 10 cm (Heimsch et al. 2021 and 2024). Output: DC voltage, 0 to about 1 V.
- `SM` is this voltage in V (0.369 to 0.980 V). The readme gives m3 m-3, which is not correct.
- The build converts `SM` with the Delta-T polynomial for a generalised mineral soil (manual p. 22). Qvidja is clay loam, thus mineral soil.
- Result: `swc` 0.137 to 0.557 m³ m⁻³ (median 0.356). Before: 0.369 to 0.980 (median 0.777).
- The growing-season means agree with Heimsch 2021 and 2024 within 0.011 m³ m⁻³. The 2018–2019 range agrees with Heimsch 2021 (0.16 to 0.55).

## Manual

Delta-T Devices Ltd, "User Manual for the ML3 ThetaProbe Soil Moisture Sensor", ML3-UM-2.1, January 2017. File: `data/manuals/ML3-user-manual-version-2.1.pdf`. The PDF page numbers are the same as the printed page numbers.

| Page | Section | Content used |
|---:|---|---|
| 16 | Operation, Other data loggers | Output 0 to 1.0 V is about 0 to 60 % water content in mineral soils. |
| 17 | HH2 meter | "use Mineral for sand, silt or clay soils or Organic for peaty soils". |
| 19–20 | Soil calibration, General soil calibrations | `√ε = a0 + a1·θ`. Mineral: a0 = 1.6, a1 = 8.4. Organic: a0 = 1.3, a1 = 7.7. Bound water in clay can give a higher a1. |
| 21 | Sensor calibration | `√ε = 1.0 + 6.175V + 6.303V² − 73.578V³ + 183.44V⁴ − 184.78V⁵ + 68.017V⁶`, V in volts. |
| 22 | Soil moisture reading, Polynomial conversion | θ for a generalised mineral soil (formula below). |
| 23 | Linearisation table | V against θ (% vol) for mineral and organic soil. Used to check the formula. |
| 26 | Specifications | Accuracy ±1 % vol over 0 to 50 % vol and 0 to 40 °C with a soil-specific calibration. Measurement range 0 to 100 % vol, with reduced accuracy. |
| 28 | Temperature response | "ML3 soil moisture readings cannot be interpreted reliably when inserted into soil below 0°C." |

## Formula used

Generalised mineral soil, manual p. 22 (V = `SM` in volts, θ in m³ m⁻³):

```
θ = −0.071 + 0.735·V + 0.75·V² − 8.759·V³ + 21.838·V⁴ − 21.998·V⁵ + 8.097·V⁶
```

This is `(√ε − 1.6) / 8.4` with the sensor polynomial of p. 21. Values outside 0 to 1 m³ m⁻³ (the measurement range, p. 26) become NULL. No value of the file is outside this range.

Code: `scripts/lib/ml3.ts` (coefficients, range and SQL expression, one place). `scripts/lib/registry.ts` (Qvidja source, `swc`) uses it. `scripts/build-db.ts` applies the new `validRange` rule and counts the NULL values in `db/report.md` (column "Out of range"). Unit test: `scripts/lib/ml3.test.ts` (16 points of the p. 23 table, all within 0.005 m³ m⁻³; the SQL expression gives the same values as the TypeScript function).

### Check of the formula against the manual

- The formula in the first version of this file (copied by the user) has the same coefficients and signs as the manual, p. 22. No difference.
- The text layer of the PDF loses the minus signs. The signs above are confirmed with the linearisation table, p. 23: for example V = 0.514 gives 0.200 (table 20 %), V = 0.838 gives 0.400 (table 40 %), V = 1.004 gives 0.600 (table 60 %). The p. 21 sensor polynomial with these signs gives back the √ε table of p. 23 (V = 0.48: 3.140, table 3.139).
- Each p. 22 coefficient is the p. 21 coefficient divided by 8.4 (for example 6.175 / 8.4 = 0.735, 68.017 / 8.4 = 8.097). Thus a0 = 1.6 and a1 = 8.4 are correct.
- Difference to the earlier test in this file (2026-10-21): that test used `√ε = 1.0 + 6.4V − 6.4V² + 4.7V³` and `√ε = 1.1 + 4.44V`. These are the conversions of the older ThetaProbe ML2x, not of the ML3. The ML3 manual gives the 6th-order polynomial above and no linear formula. We use the ML3 polynomial.
- Mineral or organic: the manual gives mineral for clay soils (p. 17). Qvidja is clay loam (all three articles). The organic calibration would give about +0.04 m³ m⁻³ (2026-10-21 test).

## Check results

### Before and after, per year

30-min values, duplicate rows of 2018–2023 removed (124 023 values).

| Year | n | `SM` min (V) | `SM` median (V) | `SM` max (V) | θ min | θ 2 % | θ median | θ 98 % | θ max |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2018 | 11 054 | 0.476 | 0.713 | 0.951 | 0.182 | 0.188 | 0.314 | 0.433 | 0.513 |
| 2019 | 16 456 | 0.422 | 0.845 | 0.965 | 0.158 | 0.191 | 0.405 | 0.516 | 0.533 |
| 2020 | 17 554 | 0.418 | 0.816 | 0.975 | 0.157 | 0.220 | 0.383 | 0.487 | 0.549 |
| 2021 | 16 914 | 0.369 | 0.827 | 0.951 | 0.137 | 0.146 | 0.391 | 0.475 | 0.513 |
| 2022 | 12 046 | 0.444 | 0.588 | 0.980 | 0.168 | 0.169 | 0.239 | 0.429 | 0.557 |
| 2023 | 16 531 | 0.535 | 0.775 | 0.980 | 0.210 | 0.214 | 0.354 | 0.549 | 0.557 |
| 2024 | 17 087 | 0.399 | 0.643 | 0.970 | 0.149 | 0.169 | 0.270 | 0.476 | 0.541 |
| 2025 | 16 381 | 0.509 | 0.831 | 0.978 | 0.197 | 0.220 | 0.379 | 0.530 | 0.553 |
| All | 124 023 | 0.369 | 0.777 | 0.980 | 0.137 | 0.176 | 0.356 | 0.503 | 0.557 |

Mean θ: 0.339 m³ m⁻³. Out of range (θ < 0 or θ > 1): 0 values. Values above 0.50: 2 765 (2.2 %); above 0.55: 348 (0.3 %, wet periods of 2022–2023 at the sensor ceiling `SM` = 0.98 V, see QVI-02 in `docs/anomaly-data-report.md`).

Monthly median θ (all years): 0.42 in January, 0.38 in April, 0.24 in June, 0.23 in July, 0.34 in September, 0.44 in November. The soil is dry in summer and wet from October to April, as expected.

### Against the articles

May to September means (m³ m⁻³):

| Year | Article | ML3 polynomial, mineral (used) | Old linear test (ML2x) |
|---:|---:|---:|---:|
| 2018 | 0.26 (Heimsch 2021) | 0.257 | 0.266 |
| 2019 | 0.30 (Heimsch 2021) | 0.305 | 0.305 |
| 2021 | 0.34 (Heimsch 2024) | 0.344 | 0.339 |
| 2022 | 0.23 (Heimsch 2024) | 0.219 | 0.230 |

Range 2018–2019: 0.158 to 0.533 (Heimsch 2021: 0.16 to 0.55). The old linear test gave a maximum of 0.451. Thus the ML3 polynomial agrees better with the published range.

### Against clay loam and the other sites

A clay loam has a porosity of about 0.45 to 0.55 m³ m⁻³. The 98 % value 0.503 and the maximum 0.557 are near saturation, as Heimsch 2021 tells for winter. `swc` of all sites in `db/observations.parquet` after the build of 2026-10-22:

| Site | 2 % | 25 % | median | 75 % | 98 % | max |
|---|---:|---:|---:|---:|---:|---:|
| Anttila | 0.131 | 0.233 | 0.294 | 0.344 | 0.399 | 0.495 |
| Haltiala | 0.260 | 0.340 | 0.420 | 0.450 | 0.530 | 0.680 |
| Maktau | 0.032 | 0.038 | 0.046 | 0.074 | 0.167 | 0.235 |
| Qvidja (before, `SM` in V) | 0.463 | – | 0.777 | – | 0.943 | 0.980 |
| Qvidja (after) | 0.176 | 0.249 | 0.356 | 0.419 | 0.503 | 0.557 |
| Särkisuo | 0.321 | 0.401 | 0.550 | 0.703 | 0.795 | 0.801 |
| Viikki | 0.114 | 0.162 | 0.296 | 0.400 | 0.513 | 0.539 |

Qvidja is now in the range of the other Finnish mineral-soil sites (Anttila, Haltiala, Viikki). Särkisuo (peat) is wetter. Maktau (sandy soil, semi-arid) is drier.

## Open points

- Frozen soil (open, QVI-16 in `docs/anomaly-data-report.md`): the manual (p. 28) says that the readings are not reliable below 0 °C. Ice has a much lower permittivity than liquid water, thus θ reads too low. 17 950 of 124 023 Qvidja `swc` values (14.5 %) have `tsoil` (`TS_1`, 5 cm) ≤ 0 °C (checked on `db/observations.parquet`, 2026-10-22). The build keeps them (QVI-03). Decision pending: set `swc` to NULL where `tsoil` ≤ 0 °C, or keep the values.
- Calibration: the general mineral calibration is used. Clay can need a higher a1 (p. 19). No soil-specific a0 and a1 for Qvidja are known. Accuracy with the general calibration is lower than the ±1 % vol of a soil-specific calibration (p. 26).
- The readme `Qvidja-readme.xlsx` still gives m3 m-3 for `SM`. Ask the provider to correct it.
- Sensor history 2018–2025 (same sensor, same depth): not confirmed.

## Sensor notes

- Frozen soil: ice has a low permittivity. The value decreases when the soil freezes, but the water does not go away. Heimsch 2021 tells the same about the winter drops.
- The readme says "measured good quality", but the file gives no quality flag for `SM`.

## Reproduce

DuckDB CLI, from the repository root:

```sql
CREATE MACRO ml3(v) AS -0.071 + 0.735*v + 0.75*v^2 - 8.759*v^3 + 21.838*v^4 - 21.998*v^5 + 8.097*v^6;
CREATE TEMP TABLE q AS
SELECT DISTINCT strptime(TIMESTAMP_START, '%Y%m%d%H%M') AS ts, try_cast(SM AS DOUBLE) AS v
FROM read_csv('data/Qvidja/Qvidja_2018-2025.csv', all_varchar = true, nullstr = '')
WHERE try_cast(SM AS DOUBLE) IS NOT NULL;

-- Statistics per year, V and θ
SELECT year(ts) AS y, count(v) AS n, min(v), median(v), max(v),
       round(min(ml3(v)), 3), round(median(ml3(v)), 3), round(max(ml3(v)), 3)
FROM q GROUP BY 1 ORDER BY 1;

-- May to September means against the articles
WITH p(y, paper) AS (VALUES (2018, 0.26), (2019, 0.30), (2021, 0.34), (2022, 0.23))
SELECT y, paper, round(avg(ml3(v)), 3) AS ml3_mineral
FROM q JOIN p ON year(ts) = y
WHERE month(ts) BETWEEN 5 AND 9
GROUP BY ALL ORDER BY y;

-- The harmonised value (after npm run build:db)
SELECT min(swc), median(swc), max(swc) FROM 'db/observations.parquet' WHERE site_id = 4;
```

## History of the check (2026-10-21)

The readme gives `SM` as soil moisture at 10 cm in m3 m-3. The values were 0.37 to 0.98, but the articles give 0.16 to 0.55 m³ m⁻³ (Heimsch et al. 2021, Biogeosciences 18:3467, p. 3472; Heimsch et al. 2024, AGEE 374:109179, sect. 3.1 and 3.3). The column has only 612 different values, none above 1 or below 0.05. We sent five questions to the provider: unit of `SM`, conversion used in the articles, cause of the published maximum 0.55, sensor history, corrected file or readme. The answer of 2026-10-22 confirmed question 1 ("raw"). Until the build of 2026-10-22, `scripts/lib/registry.ts` mapped `SM` to `swc` with no conversion, thus the Qvidja `swc` on the website and in the data export was the voltage. The calculated products (`npm run calc`) do not use `swc`.

## Change log

### 2026-10-22: Qvidja soil water content converted from sensor volts to m³ m⁻³

What changed: the Qvidja soil water content (`swc`, 10 cm) was the raw output of the Delta-T ML3 ThetaProbe sensor in volts. The data provider (Mika Korkiakoski, FMI) confirmed this on 2026-10-22. The values are now converted to volumetric water content in m³ m⁻³.

Formula (generalised mineral soil; Qvidja is clay loam), plain text:

θ = −0.071 + 0.735·V + 0.75·V² − 8.759·V³ + 21.838·V⁴ − 21.998·V⁵ + 8.097·V⁶

LaTeX:

```latex
\theta = -0.071 + 0.735\,V + 0.75\,V^{2} - 8.759\,V^{3} + 21.838\,V^{4} - 21.998\,V^{5} + 8.097\,V^{6}
```

V = sensor output in volts (column `SM`), θ = volumetric water content in m³ m⁻³.

| Coefficient | c0 | c1 | c2 | c3 | c4 | c5 | c6 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Value | −0.071 | 0.735 | 0.75 | −8.759 | 21.838 | −21.998 | 8.097 |

Equivalent form: θ = (√ε − a0) / a1 with a0 = 1.6, a1 = 8.4 (general mineral-soil calibration).

Source: Delta-T Devices Ltd, User Manual for the ML3 ThetaProbe Soil Moisture Sensor, ML3-UM-2.1 (January 2017), p. 22, "Polynomial conversion". Valid range: 0 to 1 m³ m⁻³ (p. 26); values outside become empty.

Affected data: all Qvidja `swc` values, 2018-05-09 to 2025-12-31, 124 023 half-hour values. Values set to empty: 0. Other sites: no change.

| Statistic | Before (V) | After (m³ m⁻³) |
|---|---:|---:|
| Minimum | 0.369 | 0.137 |
| 2 % | 0.463 | 0.176 |
| Median | 0.777 | 0.356 |
| Mean | 0.737 | 0.339 |
| 98 % | 0.943 | 0.503 |
| Maximum | 0.980 | 0.557 |

Check: the May to September means 2018, 2019, 2021 and 2022 (0.257, 0.305, 0.344, 0.219) agree with the published values (0.26, 0.30, 0.34, 0.23; Heimsch et al. 2021 and 2024) within 0.011 m³ m⁻³.

Open point: readings in frozen soil (below 0 °C) are not reliable (manual p. 28). 17 950 values have `tsoil` ≤ 0 °C. They are not removed. A NULL rule is not decided (QVI-16).
