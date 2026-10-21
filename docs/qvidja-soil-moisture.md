# Qvidja soil moisture (`SM`): unit check

Status: open. We wait for an answer from the data provider (Mika Korkiakoski, FMI). Do not correct the data before the answer. Checked on 2026-10-21.

## Summary

The readme gives `SM` in `data/Qvidja/Qvidja_2018-2025.csv` as soil moisture at 10 cm depth in m3 m-3. The depth and the sensor agree with the articles. The values do not agree: they are 0.37 to 0.98, but the articles give 0.16 to 0.55 m³ m⁻³. The values are probably the raw output voltage (V) of the Delta-T ML3 ThetaProbe sensor. The Delta-T linear conversion with the general mineral-soil calibration gives back the published growing-season means within 0.006 m³ m⁻³.

## What the sources say

| Source | Sensor | Depth | Unit | Values |
|---|---|---|---|---|
| `data/Qvidja/Qvidja-readme.xlsx` | not given | 10 cm | m3 m-3 | "Soil moisture at 10 cm depth, measured good quality" |
| Heimsch et al. 2021, Biogeosciences 18:3467 (`data/articles/Heimsch_2021.pdf` = `data/Qvidja/Qvidja_C-balance.pdf`) | ML3 ThetaProbe, Delta-T Devices (p. 3469, sect. 2.2) | 0.1 m | m³ m⁻³ | 0.16 to 0.55 in 2018–2019 (p. 3472). May–Sep mean 0.26 (2018), 0.30 (2019). Fig. 4c, Table C1 (5-day means 0.20 to 0.37). |
| Heimsch et al. 2024, AGEE 374:109179 (`data/articles/Heimsch_2024.pdf` = `data/Qvidja/Qvidja.pdf`) | ML3 ThetaProbe (sect. 2.3) | 0.1 m | m³ m⁻³ | May–Sep mean 0.23 to 0.34: 0.34 (2021, highest), 0.23 (2022, lowest) (sect. 3.1, 3.3). Fig. 1c: about 0.2 to 0.5. |
| Vira et al. 2025 (`data/articles/Vira_2025_C-Sentinel-2_EC.pdf`) | "ML3 ThetaProbe … or Teros-12", not given per site | "5 or 10 cm" | – | No values. |

The soil is clay loam (all three articles). The articles give no porosity or bulk density for Qvidja. Heimsch 2021 calls 0.4 m³ m⁻³ "close to the saturated values observed in winter".

## What the file shows

`SM` per year (30-min values, all months):

| Year | n | min | 2 % | median | 98 % | max |
|---:|---:|---:|---:|---:|---:|---:|
| 2018 | 22 108 | 0.476 | 0.490 | 0.713 | 0.878 | 0.951 |
| 2019 | 32 912 | 0.422 | 0.495 | 0.845 | 0.953 | 0.965 |
| 2020 | 35 108 | 0.418 | 0.554 | 0.816 | 0.930 | 0.975 |
| 2021 | 33 828 | 0.369 | 0.391 | 0.827 | 0.920 | 0.951 |
| 2022 | 24 092 | 0.444 | 0.447 | 0.588 | 0.873 | 0.980 |
| 2023 | 33 062 | 0.535 | 0.542 | 0.775 | 0.975 | 0.980 |
| 2024 | 17 091 | 0.399 | 0.447 | 0.643 | 0.921 | 0.970 |
| 2025 | 20 802 | 0.509 | 0.559 | 0.831 | 0.966 | 0.978 |

Counts include the duplicate rows of 2018–2023 (see `docs/harmonised-database.md`). The column has only 612 different values. No value is above 1 or below 0.05.

The seasonal pattern is correct for soil moisture: the soil is drier in June and July and wetter from October to April. But the level is too high. Clay loam cannot hold much more than about 0.5 m³ m⁻³ of water. The `swc` of the other sites in `db/observations.parquet`:

| Site | 2 % | median | 98 % | max |
|---|---:|---:|---:|---:|
| Anttila | 0.131 | 0.294 | 0.399 | 0.495 |
| Haltiala | 0.260 | 0.420 | 0.530 | 0.680 |
| Maktau | 0.032 | 0.046 | 0.167 | 0.235 |
| Qvidja (`SM`) | 0.463 | 0.777 | 0.943 | 0.980 |
| Särkisuo | 0.321 | 0.550 | 0.795 | 0.801 |
| Viikki | 0.114 | 0.296 | 0.513 | 0.539 |

## Test of the ML3 conversion

The ML3 output is a DC voltage V (about 0 to 1 V). Delta-T gives two steps:

1. V to the square root of the permittivity √ε:
   - polynomial: `√ε = 1.0 + 6.4·V − 6.4·V² + 4.7·V³`
   - linear: `√ε = 1.1 + 4.44·V`
2. √ε to the volumetric water content θ: `θ = (√ε − a0) / a1`. General calibrations: mineral soil a0 = 1.6, a1 = 8.4; organic soil a0 = 1.3, a1 = 7.7.

The linear mineral variant is `θ = (4.44·V − 0.5) / 8.4`.

May to September means of θ, from `SM` as V:

| Year | Article | Linear, mineral | Polynomial, mineral | Polynomial, organic |
|---:|---:|---:|---:|---:|
| 2018 | 0.26 | **0.266** | 0.242 | 0.303 |
| 2019 | 0.30 | **0.305** | 0.282 | 0.346 |
| 2021 | 0.34 | **0.339** | 0.314 | 0.381 |
| 2022 | 0.23 | **0.230** | 0.210 | 0.268 |

Range in 2018–2019 (Heimsch 2021 period): linear mineral 0.164 to 0.451, article 0.16 to 0.55. The minimum agrees. The maximum does not agree.

Result: the linear mineral conversion gives back all four published means within 0.006 m³ m⁻³. The other two variants have a constant offset of about −0.02 and +0.04. Thus `SM` is very probably the ML3 output in V.

## Sensor notes

- Frozen soil: ice has a low permittivity. The value decreases when the soil freezes, but the water does not go away. Heimsch 2021 tells the same about the winter drops. Do not use winter values when the soil temperature is below 0 °C without a check.
- Accuracy: the general calibration is less accurate than a soil-specific calibration (Delta-T gives about ±0.05 and ±0.01 m³ m⁻³; check this in the ML3 user manual). Clay soils can need a soil-specific calibration (a0 and a1 from one dry and one wet sample).
- The readme says "measured good quality", but the file gives no quality flag for `SM`.

## Questions to the data provider

1. Is `SM` in `Qvidja_2018-2025.csv` the ML3 ThetaProbe output in volts, not m³ m⁻³?
2. Which conversion did you use for Heimsch et al. 2021 and 2024: the linear or the polynomial V-to-√ε step, and which a0 and a1? Is there a soil-specific calibration for Qvidja?
3. Heimsch et al. 2021 gives a maximum of 0.55 m³ m⁻³ for 2018–2019. The linear mineral conversion of the file gives 0.45. What is the cause?
4. Is it the same sensor at the same depth (10 cm) from 2018 to 2025?
5. Can you send a corrected file or a corrected readme?

## Effect on this repository

- `scripts/lib/registry.ts:343` maps `SM` to `swc` with no conversion (`expr: 'num("SM")'`, `depthCm: 10`). Thus the Qvidja `swc` in `db/observations.parquet`, in the data export and on the website is too high.
- `docs/data-dictionary.md:341`, `docs/harmonised-database.md:91` and `CLAUDE.md` copy the unit m3 m-3 from the readme.
- The calculated products (`npm run calc`) do not use `swc`.
- Correction after the answer: change the `expr` of the Qvidja `swc` in the registry (for example `(1.1 + 4.44 * num("SM") - 1.6) / 8.4`), add a `note`, update the docs above, then run `npm run build:db`, `npm run calc` and `npm run site:sync`. Expected result: Qvidja `swc` about 0.14 to 0.46 m³ m⁻³.

## Reproduce

DuckDB CLI, from the repository root:

```sql
CREATE TEMP TABLE q AS
SELECT strptime(TIMESTAMP_START, '%Y%m%d%H%M') AS ts,
       try_cast(SM AS DOUBLE) AS v
FROM read_csv('data/Qvidja/Qvidja_2018-2025.csv', all_varchar = true, nullstr = '')
WHERE try_cast(SM AS DOUBLE) IS NOT NULL;

-- Statistics per year
SELECT year(ts) AS y, count(v) AS n, min(v), quantile_cont(v, 0.02),
       median(v), quantile_cont(v, 0.98), max(v)
FROM q GROUP BY 1 ORDER BY 1;

-- May to September means of the three conversions
WITH p(y, paper) AS (VALUES (2018, 0.26), (2019, 0.30), (2021, 0.34), (2022, 0.23))
SELECT y, paper,
       round(avg(((1.1 + 4.44 * v) - 1.6) / 8.4), 3) AS lin_mineral,
       round(avg(((1 + 6.4 * v - 6.4 * v * v + 4.7 * v * v * v) - 1.6) / 8.4), 3) AS poly_mineral,
       round(avg(((1 + 6.4 * v - 6.4 * v * v + 4.7 * v * v * v) - 1.3) / 7.7), 3) AS poly_organic
FROM q JOIN p ON year(ts) = y
WHERE month(ts) BETWEEN 5 AND 9
GROUP BY ALL ORDER BY y;
```
