# /// script
# requires-python = "==3.13.*"
# dependencies = [
#     "matplotlib==3.11.2",
#     "numpy==2.5.4",
#     "pandas==3.1.0",
#     "pandera==0.34.1",
#     "pyarrow==26.0.0",
#     "scipy==1.18.1",
#     "statsmodels==0.15.0",
# ]
# ///
"""Soil temperature, soil water and soil type as drivers of CH4 and N2O.

QUESTION
    How do soil temperature, soil water content and soil type (peat or mineral) relate to the
    CH4 and N2O fluxes at Anttila, Sarkisuo and Viikki?

METHOD
    Sites: Anttila (mineral soil), Sarkisuo (drained peat) and Viikki (clay loam, mineral). CH4
    is only at Anttila and Sarkisuo (2022 to 2023), N2O at all three (Anttila and Sarkisuo 2022 to
    2023, Viikki 2022 to 2025). The fluxes are the gap-filled values of the providers (the
    database has no measured CH4 or N2O). The gap-fill models use soil drivers, thus a part of
    each relation below comes from the models (circularity). Soil drivers: tsoil (degC) and swc
    (m3 m-3) of the shallowest sensor (Anttila and Sarkisuo 5 cm, Shurpali et al. 2025 p. 4;
    Viikki 14 cm). The soil type is static per site (LITERATURE). Units are the harmonised units:
    ch4 umol CH4 m-2 s-1, n2o nmol N2O m-2 s-1 (positive = emission).
    1. Local day = calendar day of ts_start + utc_offset_min. Daily mean of each variable; a day
       keeps the mean of a variable when the variable has MIN_VALUES_PER_DAY (40) or more of the
       48 half hours, else the daily value is missing. Each analysis uses the days where all its
       variables have a daily value. For the text only, daily CH4 is also given in
       mg CH4 m-2 d-1 and daily N2O in mg N2O m-2 d-1.
    2. Temperature response, per site and gas: daily tsoil in 1 degC bins (bin = floor(tsoil));
       a bin needs MIN_BIN_DAYS (10) days. Per bin: median and 25 and 75 % quantiles of the daily
       flux. Spearman rho (scipy.stats.spearmanr) over all days. Exponential fit
       F = F10 x Q10^((T - 10) / 10) to the bin medians that are > 0, at the bin centres. The
       fit is in log space: ln F = ln F10 + k (T - 10) (scipy.optimize.curve_fit), Q10 =
       exp(10 k). Thus each bin has the same relative weight; a fit in linear space lets one
       warm bin with a fertilisation peak set the curve. The fit needs 5 or more such bins, and
       they must be 75 % or more of the bins; else the fit is null with the reason. 95 % CI of
       Q10 = exp(10 (k +/- t(0.975, n - 2) x SE(k))), n = number of bins. R2 is in log space.
       "The bins" = the bins with MIN_BIN_DAYS or more days; bin centre = (floor(x / width) +
       0.5) x width.
    3. Water response: the same with swc in 0.02 m3 m-3 bins (bin = floor(swc / 0.02)), and
       Spearman rho. No fit.
    4. Joint effect, per site and gas: OLS of the daily flux on z(tsoil), z(swc) and
       z(tsoil) x z(swc) (z = (x - mean) / SD of the days of the site and gas, SD with n - 1),
       with a constant; the mean and SD come from the OLS days (days with flux, tsoil and swc).
       Standard errors: Newey-West HAC with 7 lags (statsmodels: Bartlett kernel, no small-sample
       correction; CI and p-values from the normal distribution). Reported: coefficients in flux
       units per 1 SD, 95 % CI, p-values and R2.
    5. Soil type, Sarkisuo (peat) against Anttila (mineral): (a) annual sums per site, local
       year and gas = sum of the 30-min values x 1800 s, in kg CH4 ha-1 yr-1 and kg N2O ha-1
       yr-1 (molar mass CH4 16.043, N2O 44.013 g mol-1), with the coverage (values / half hours
       of the year); a year with coverage < 0.9 is partial. The 2022 sums are compared with
       Shurpali et al. 2025 Table 3 (LITERATURE). (b) Paired days: the local days in 2022 and
       2023 where both sites have a daily value of the gas. Daily distributions (median, 25 and
       75 %) and the mean daily difference Sarkisuo - Anttila, with a 95 % CI from a block
       bootstrap: the paired days in date order are cut into blocks of 7 days (BLOCK_DAYS); the
       last, shorter block is kept. Each replicate draws as many blocks as there are, with
       replacement (numpy.random.default_rng(BOOT_SEED), BOOT_REPS 5000); the statistic is the
       mean of all days in the drawn blocks; percentile interval. Viikki gets annual sums too
       (N2O). kg ha-1 = sum x 1800 s x 1e-6 (CH4) or 1e-9 (N2O) mol x molar mass g mol-1 x 10.
    6. Sensitivity for N2O: steps 2 to 4 again without the days of fertilisation effect: the
       local days 0 to 29 after each fertilisation event of db/events.parquet (the event day is
       day 0; FERT_DAYS 30). Events: rows with type == 'fertilisation'. Also: the share of the
       N2O sum of each site-year that is on these days = sum of the daily N2O means of the days
       in the windows / sum of all daily N2O means of the year.
    7. Heat map (Figure 3): mean daily flux per cell of 2 degC tsoil x 0.04 m3 m-3 swc
       (cell = floor(tsoil / 2), floor(swc / 0.04)); a cell needs MIN_CELL_DAYS (5) days.
    8. Each step that removes rows or days logs a count (results.json dataVersion.steps).
    9. Open findings of docs/anomaly-data-report.md that touch this dive are printed
       (OPEN_FINDINGS).

DATABASE
    builtAt: 2026-10-28T10:44:08.475Z (db/report.json and Parquet key/value metadata built_at)
    commit: 72e41ab (the build ran on the working tree that this commit recorded; HEAD at build time was eab1555)
    url: TODO: release asset db-2026-10-28.zip not yet published

INPUTS
    db/observations.parquet  sha256=5c934e8cb1a138e92ced776651ec9703d1722321c2406b75e88d8de31aff585a  rows=553762  columns=site_id, ts_start, ch4, n2o, tsoil, swc
    db/sites.parquet  sha256=4314b30c3aa8f57c0eefdfa5cceabe95b5c49b7c4641aeab9bc4c8ff6a17f4a8  rows=6  columns=site_id, code, name, utc_offset_min
    db/variables.parquet  sha256=4053e99aa6a88f9d5f9c290ad8f7b3772e5750675fc33a659204339ac4159283  rows=26  columns=column_name, unit
    db/events.parquet  sha256=f27df617c335881361166a3c7074ab95ed712cf8e5665ec929760131d9b2f306  rows=114  columns=site_code, date, type

OUTPUTS
    results.json                          all result numbers, figure captions and alt texts, dataVersion
    manifest.json                         provenance of the run and SHA-256 of the outputs
    figures/1-temperature-response.svg    daily CH4 and N2O flux against tsoil (binned), with Q10 fits
    figures/2-water-response.svg          daily CH4 and N2O flux against swc (binned)
    figures/3-temperature-water-map.svg   mean daily flux per tsoil x swc cell, five panels
    figures/4-peat-vs-mineral.svg         annual CH4 and N2O sums per site-year, with Shurpali 2025
    output/run.log                        run log (not in git)
    output/daily.csv                      the daily table (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/soil-ghg-drivers/soil-ghg-drivers.py --db db

LIBRARIES
    scipy: Spearman rho, curve_fit of the Q10 model, t quantile. statsmodels: OLS with HAC
    standard errors.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import logging
import math
import platform
import re
import subprocess
import sys
import warnings
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pandera.pandas as pa
import pyarrow.parquet as pq
import statsmodels.api as sm
from matplotlib.colors import TwoSlopeNorm
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from matplotlib.ticker import NullLocator
from scipy import optimize, stats

SLUG = "soil-ghg-drivers"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"
SVG_ID_PREFIX = "sg"

DATABASE: dict[str, str | None] = {
    "builtAt": "2026-10-28T10:44:08.475Z",
    "commit": "72e41ab",
    "commitNote": "the build ran on the working tree that this commit recorded; HEAD at build "
    "time was eab1555",
    "url": None,
    "urlNote": "TODO: release asset db-2026-10-28.zip not yet published",
}


@dataclass(frozen=True)
class InputFile:
    """One input file of the database folder (--db)."""

    root: str
    file: str
    sha256: str
    rows: int
    columns: tuple[str, ...]
    built_at: str

    @property
    def key(self) -> str:
        return f"{self.root}/{self.file}"


INPUTS: tuple[InputFile, ...] = (
    InputFile(
        "db",
        "observations.parquet",
        "5c934e8cb1a138e92ced776651ec9703d1722321c2406b75e88d8de31aff585a",
        553762,
        ("site_id", "ts_start", "ch4", "n2o", "tsoil", "swc"),
        "2026-10-28T10:44:08.475Z",
    ),
    InputFile(
        "db",
        "sites.parquet",
        "4314b30c3aa8f57c0eefdfa5cceabe95b5c49b7c4641aeab9bc4c8ff6a17f4a8",
        6,
        ("site_id", "code", "name", "utc_offset_min"),
        "2026-10-28T10:44:08.475Z",
    ),
    InputFile(
        "db",
        "variables.parquet",
        "4053e99aa6a88f9d5f9c290ad8f7b3772e5750675fc33a659204339ac4159283",
        26,
        ("column_name", "unit"),
        "2026-10-28T10:44:08.475Z",
    ),
    InputFile(
        "db",
        "events.parquet",
        "f27df617c335881361166a3c7074ab95ed712cf8e5665ec929760131d9b2f306",
        114,
        ("site_code", "date", "type"),
        "2026-10-28T10:44:08.475Z",
    ),
)

# ---------- Units ----------
# The script reads the unit of each column from variables.parquet and stops when it is not the
# expected unit. It does not convert the units of the analysis; the conversions below are only
# for the annual sums and the text.
EXPECTED_UNITS = {
    "ch4": "µmol CH4 m-2 s-1",
    "n2o": "nmol N2O m-2 s-1",
    "tsoil": "°C",
    "swc": "m3 m-3",
}
GASES = ("ch4", "n2o")
GAS_LABEL = {"ch4": "CH4", "n2o": "N2O"}
GAS_MATH = {"ch4": r"CH$_4$", "n2o": r"N$_2$O"}
FLUX_AXIS = {
    "ch4": r"CH$_4$ flux ($\mu$mol m$^{-2}$ s$^{-1}$)",
    "n2o": r"N$_2$O flux (nmol m$^{-2}$ s$^{-1}$)",
}
FLUX_UNIT_TEXT = {"ch4": "umol CH4 m-2 s-1", "n2o": "nmol N2O m-2 s-1"}
MOLAR_MASS = {"ch4": 16.043, "n2o": 44.013}  # g mol-1
TO_MOL = {"ch4": 1e-6, "n2o": 1e-9}  # flux unit to mol m-2 s-1
SECONDS_PER_HALF_HOUR = 1800
SECONDS_PER_DAY = 86400
# Viikki N2O (open finding VII-06): if the raw unit is ug N2O-N, the N2O mass is larger by
# M(N2O) / M(N2) = 44.013 / 28.013.
N2O_N_FACTOR = 44.013 / 28.013

# ---------- Method constants ----------
SITES = ("anttila", "sarkisuo", "viikki")
ALL_SITE_CODES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
GAS_SITES = {"ch4": ("anttila", "sarkisuo"), "n2o": ("anttila", "sarkisuo", "viikki")}
YEARS = {
    "anttila": (2022, 2023),
    "sarkisuo": (2022, 2023),
    "viikki": (2022, 2023, 2024, 2025),
}
PEAT = "sarkisuo"
MINERAL = "anttila"
HALF_HOURS_PER_DAY = 48
MIN_VALUES_PER_DAY = 40
T_BIN = 1.0  # degC
W_BIN = 0.02  # m3 m-3
MIN_BIN_DAYS = 10
FIT_MIN_BINS = 5
FIT_MIN_POSITIVE_SHARE = 0.75
T_REF = 10.0  # degC, reference temperature of F10
HAC_LAGS = 7
PARTIAL_COVERAGE = 0.9
BLOCK_DAYS = 7
BOOT_REPS = 5000
BOOT_SEED = 20261029
FERT_DAYS = 30
MAP_T_BIN = 2.0
MAP_W_BIN = 0.04
MIN_CELL_DAYS = 5
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-12

# Reference values from articles. Each row: value, unit, uncertainty, reference id, page, table
# or figure. Shurpali et al. 2025, Agriculture, Ecosystems and Environment 393, 109841
# (data/articles/Shurpali_2025.pdf); Vettikkat et al. 2026, Agricultural and Forest Meteorology
# 383, 111121 (data/articles/Vettikkat_2026_NH3-flux_SMEAR-Agri_mass-spec_EC.pdf); Gao et al.
# 2026, Int. J. Life Cycle Assess. 31:4 (data/articles/Gao_2026_Cfootprint_milk-DNDC.pdf).
# page = printed page of the article.
LITERATURE: tuple[dict[str, Any], ...] = (
    {
        "key": "anttilaCh4_2022",
        "text": "Anttila annual CH4 flux 2022 (range of the gap-filling algorithms)",
        "value": 2,
        "unit": "kg CH4 ha-1 yr-1",
        "uncertainty": {
            "lo": 2,
            "hi": 3,
            "kind": "range of three gap-filling algorithms",
        },
        "ref": "shurpali2025",
        "page": "p. 6",
        "tableFigure": "Table 3",
    },
    {
        "key": "sarkisuoCh4_2022",
        "text": "Sarkisuo annual CH4 flux 2022; the gap before 6 May is filled with the median "
        "flux of December 2022 (p. 3)",
        "value": 110,
        "unit": "kg CH4 ha-1 yr-1",
        "uncertainty": {
            "lo": 110,
            "hi": 120,
            "kind": "range of three gap-filling algorithms",
        },
        "ref": "shurpali2025",
        "page": "p. 6",
        "tableFigure": "Table 3",
    },
    {
        "key": "anttilaN2o_2022",
        "text": "Anttila annual N2O flux 2022",
        "value": 3.8,
        "unit": "kg N2O ha-1 yr-1",
        "uncertainty": {
            "lo": 3.7,
            "hi": 4.0,
            "kind": "range of three gap-filling algorithms",
        },
        "ref": "shurpali2025",
        "page": "p. 6",
        "tableFigure": "Table 3",
    },
    {
        "key": "sarkisuoN2o_2022",
        "text": "Sarkisuo annual N2O flux 2022",
        "value": 16,
        "unit": "kg N2O ha-1 yr-1",
        "uncertainty": {
            "lo": 16,
            "hi": 17,
            "kind": "range of three gap-filling algorithms",
        },
        "ref": "shurpali2025",
        "page": "p. 6",
        "tableFigure": "Table 3",
    },
    {
        "key": "anttilaSoil",
        "text": "Anttila: mineral soil, Eutric Gleysol to Luvic Planosol/Stagnosol, silt loam",
        "value": "mineral",
        "unit": "soil type",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 2, Sect. 2.1; p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "sarkisuoSoil",
        "text": "Sarkisuo: drained organic soil, mainly sedge peat",
        "value": "drained peat",
        "unit": "soil type",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 2, Sect. 2.1; p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "sarkisuoPeatDepthMinCm",
        "text": "Sarkisuo peat depth, minimum (maximum > 100 cm)",
        "value": 63,
        "unit": "cm",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 2",
        "tableFigure": "Table 1",
    },
    {
        "key": "anttilaSocPct",
        "text": "Anttila soil organic carbon, 0 to 10 cm (mean, SD 0.82)",
        "value": 3.36,
        "unit": "%",
        "uncertainty": {"sd": 0.82},
        "ref": "shurpali2025",
        "page": "p. 2",
        "tableFigure": "Table 1",
    },
    {
        "key": "sarkisuoSocPct",
        "text": "Sarkisuo soil organic carbon, 0 to 10 cm (mean, SD 11.1)",
        "value": 38.9,
        "unit": "%",
        "uncertainty": {"sd": 11.1},
        "ref": "shurpali2025",
        "page": "p. 2",
        "tableFigure": "Table 1",
    },
    {
        "key": "sensorDepthCm",
        "text": "Anttila and Sarkisuo: soil temperature and soil water content at 5 cm depth",
        "value": 5,
        "unit": "cm",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 4, Sect. 3.1",
        "tableFigure": "Fig. 1",
    },
    {
        "key": "sarkisuoSwcRangePct",
        "text": "Sarkisuo soil water content at 5 cm in 2022: 30 to 69 %",
        "value": "30 to 69",
        "unit": "% (volumetric)",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 4, Sect. 3.1",
        "tableFigure": "Fig. 1",
    },
    {
        "key": "anttilaSwcRangePct",
        "text": "Anttila soil water content at 5 cm in 2022: 10 to 39 %",
        "value": "10 to 39",
        "unit": "% (volumetric)",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 4, Sect. 3.1",
        "tableFigure": "Fig. 1",
    },
    {
        "key": "measuredCoverageCh4N2o",
        "text": "Share of measured 30-min values after the quality filter in 2022: Anttila 67 % "
        "(CH4) and 67 % (N2O), Sarkisuo 28 % (CH4) and 30 % (N2O)",
        "value": "Anttila 67/67, Sarkisuo 28/30",
        "unit": "%",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 3, Sect. 2.3.2",
        "tableFigure": None,
    },
    {
        "key": "viikkiSoil",
        "text": "Viikki field Alaniitty 1 (A1): clay loam soil",
        "value": "clay loam",
        "unit": "soil type",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 2, Sect. 2.1; p. 3",
        "tableFigure": None,
    },
    {
        "key": "viikkiSoilClass",
        "text": "Viikki SMEAR-Agri field: clay texture, artificially drained Stagnosols and "
        "Planosols",
        "value": "clay, Stagnosols and Planosols",
        "unit": "soil type",
        "uncertainty": None,
        "ref": "gao2026",
        "page": "p. 3 (Page 3 of 15)",
        "tableFigure": None,
    },
)


def literature_by_key() -> dict[str, dict[str, Any]]:
    """LITERATURE as an object keyed by `key`."""
    return {r["key"]: dict(r) for r in LITERATURE}


LIT = literature_by_key()
# Soil type and sensor depth per site (from LITERATURE and docs/harmonised-database.md).
SOIL = {
    "anttila": {"type": "mineral", "litKey": "anttilaSoil", "depthCm": 5},
    "sarkisuo": {"type": "peat", "litKey": "sarkisuoSoil", "depthCm": 5},
    "viikki": {"type": "mineral (clay loam)", "litKey": "viikkiSoil", "depthCm": 14},
}
LIT_ANNUAL = {
    ("anttila", "ch4"): "anttilaCh4_2022",
    ("sarkisuo", "ch4"): "sarkisuoCh4_2022",
    ("anttila", "n2o"): "anttilaN2o_2022",
    ("sarkisuo", "n2o"): "sarkisuoN2o_2022",
}
LIT_YEAR = 2022

OPEN_FINDINGS = (
    (
        "Gap-filled fluxes (limit of the method): the database has only the gap-filled CH4 and N2O "
        "values. In 2022, 28 to 67 % of the 30-min values were measured (Shurpali 2025 p. 3). The "
        "gap-fill models use soil drivers, thus a part of each relation comes from the models."
    ),
    (
        "ANT-01, SAR-01, VII-01 (open, waits for the providers): the raw stamps of Anttila, "
        "Sarkisuo and Viikki are UTC, but the build reads them as UTC+2. A local day of these "
        "sites thus holds the hours 02:00 to 02:00 true local time. Daily means change little; the "
        "annual sums change by the 2 hours at the ends of the year only."
    ),
    (
        "VII-06 (open question): the Viikki N2O unit can be ug N2O or ug N2O-N. The build assumes "
        "ug N2O. If it is N2O-N, all Viikki N2O values are 1.57 times too small. The relations "
        "(rho) do not change; the Viikki slopes, sums and medians change by this factor."
    ),
    (
        "SAR-07 (known): Sarkisuo CH4 and N2O start on 2022-05-06. The 2022 sums are partial "
        "years (coverage 0.66); the paired days of Sarkisuo and Anttila start on that day."
    ),
    (
        "VII-04 (open, waits for the provider): the Viikki tsoil at 14 cm has spikes up to "
        "28.9 degC after field work in May, August and September 2025. On 34 days the daily mean "
        "can be 2 to 5 degC too high; some of these days are in the 30 days after the "
        "fertilisation of 2025-05-10. The dive does not remove them."
    ),
    (
        "SAR-04, ANT-05, VII-03 (zero curtain): in winter, tsoil stays near 0 degC for weeks "
        "(Sarkisuo 0.2 degC for most of the winter 2022-23; a sensor floor is an open question). "
        "The 0 degC bins thus hold many winter days with different fluxes."
    ),
)

# Numbers of the open findings that the article gives (docs/anomaly-data-report.md). Not results
# of this script; they are here so that the article reads all numbers from results.json.
FINDING_NUMBERS = {
    "VII-04": {"maxTsoil": 28.9, "days": 34, "dailyBiasLo": 2.0, "dailyBiasHi": 5.0},
}

# ---------- Figures ----------
FONT_STACK = (
    "system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', "
    "'Noto Color Emoji'"
)
FONT_SCALE = 1.2
# Site colour, line dash and marker: the slot of the site in db/sites.parquet, as siteColors(),
# siteDash() and siteSymbol() in site/src/scripts/diagrams/common.ts (Okabe-Ito). The pentagon
# "p" stands for roundRect, the "v" triangle for pin (as the other dives).
SITE_COLORS = (
    "#0072b2",
    "#e69f00",
    "#56b4e9",
    "#cc79a7",
    "#000000",
    "#d55e00",
    "#009e73",
    "#6b5a00",
)
SITE_DASHES: tuple[tuple[float, ...] | None, ...] = (
    None,
    (6, 3),
    (2, 2),
    (8, 3, 2, 3),
    (12, 4),
    (2, 5),
)
SITE_MARKERS = ("o", "s", "^", "D", "p", "v")
SITE_EMOJI = {
    "anttila": "👱🏻‍♂️🫛",
    "sarkisuo": "🐟🌱",
    "haltiala": "🧚🌾",
    "qvidja": "🐂🐝",
    "viikki": "👩🏻‍🔬🎓",
    "maktau": "🇰🇪🌽",
}
INK = "#222222"
GUIDE = "#888888"
LIT_COLOR = "#222222"
LINE_WIDTH = 1.8
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
FIG_RESPONSE_HEIGHT_IN = 150 * MM
FIG_MAP_HEIGHT_IN = 140 * MM
FIG_BARS_HEIGHT_IN = 105 * MM
N2O_LINTHRESH = (
    0.1  # nmol m-2 s-1: the N2O axis of Figures 1 and 2 is linear below, log above
)
N2O_TICKS = (0.0, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0)
CMAP = "PuOr_r"  # purple = uptake (< 0), orange = emission (> 0)
FIGURES = (
    (1, "temperature-response"),
    (2, "water-response"),
    (3, "temperature-water-map"),
    (4, "peat-vs-mineral"),
)
TSOIL_AXIS = r"Soil temperature, daily mean ($\degree$C)"
SWC_AXIS = r"Soil water content, daily mean (m$^3$ m$^{-3}$)"
SIGN_NOTE = "Flux > 0 = emission to the atmosphere."
FIG1_TITLE = (
    "Daily CH4 and N2O flux against the daily soil temperature at Anttila (mineral soil), "
    "Särkisuo (drained peat) and Viikki (clay loam): median per 1 °C bin with the 25 to 75 % "
    "band, and the Q10 fit."
)
FIG2_TITLE = (
    "Daily CH4 and N2O flux against the daily soil water content at Anttila (mineral soil), "
    "Särkisuo (drained peat) and Viikki (clay loam): median per 0.02 m3 m-3 bin with the 25 to "
    "75 % band."
)
FIG3_TITLE = (
    "Mean daily CH4 and N2O flux per cell of soil temperature and soil water content, one "
    "panel per site and gas."
)
FIG4_TITLE = (
    "Annual CH4 and N2O sums per site-year at the peat site Särkisuo and the mineral sites "
    "Anttila and Viikki, with the 2022 values of Shurpali et al. (2025)."
)

log = logging.getLogger(SLUG)


# ======================================================================================
# Input check
# ======================================================================================
class InputError(Exception):
    """An input file does not agree with INPUTS or DATABASE."""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_inputs(db: Path) -> list[str]:
    """Check each input: exists, SHA-256, Parquet built_at, row count. Returns the error list."""
    errors: list[str] = []
    for inp in INPUTS:
        path = db / inp.file
        if not path.is_file():
            errors.append(f"{inp.key}: file not found at {path}")
            continue
        digest = sha256_file(path)
        if digest != inp.sha256:
            errors.append(f"{inp.key}: SHA-256 expected {inp.sha256}, actual {digest}")
        meta = pq.read_metadata(path)
        kv = {k.decode(): v.decode() for k, v in (meta.metadata or {}).items()}
        built = kv.get("built_at")
        if built != inp.built_at or built != DATABASE["builtAt"]:
            errors.append(
                f"{inp.key}: built_at expected {inp.built_at}, actual {built}"
            )
        if meta.num_rows != inp.rows:
            errors.append(
                f"{inp.key}: rows expected {inp.rows}, actual {meta.num_rows}"
            )
    return errors


def parse_docstring_inputs(doc: str) -> list[dict[str, Any]]:
    """The INPUTS lines of the module docstring (for the unit test)."""
    lines = doc.splitlines()
    start = lines.index("INPUTS") + 1
    out: list[dict[str, Any]] = []
    for line in lines[start:]:
        if not line.strip():
            break
        m = re.match(
            r"^\s+(\S+)\s+sha256=([0-9a-f]{64})\s+rows=(\d+)\s+columns=(.+)$", line
        )
        if not m:
            raise ValueError(f"bad INPUTS line: {line!r}")
        out.append(
            {
                "key": m.group(1),
                "sha256": m.group(2),
                "rows": int(m.group(3)),
                "columns": tuple(c.strip() for c in m.group(4).split(",")),
            }
        )
    return out


# ======================================================================================
# Pure helpers
# ======================================================================================
def round_sig(x: Any, digits: int = SIG_DIGITS) -> Any:
    """Round all floats to `digits` significant digits; NaN and infinity become None."""
    if isinstance(x, bool) or x is None or isinstance(x, (int, str)):
        return x
    if isinstance(x, (float, np.floating)):
        f = float(x)
        if not math.isfinite(f):
            return None
        return 0.0 if f == 0 else float(f"{f:.{digits}g}")
    if isinstance(x, np.integer):
        return int(x)
    if isinstance(x, np.bool_):
        return bool(x)
    if isinstance(x, dict):
        return {str(k): round_sig(v, digits) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [round_sig(v, digits) for v in x]
    raise TypeError(f"round_sig: type {type(x)}")


def compare(new: Any, old: Any, path: str = "$") -> list[str]:
    """Differences between two result objects (numbers with a relative tolerance)."""
    if isinstance(new, dict) and isinstance(old, dict):
        out: list[str] = []
        for k in sorted(set(new) | set(old)):
            if k == "dataVersion":
                continue
            if k not in new or k not in old:
                out.append(
                    f"{path}.{k}: only in {'new' if k in new else 'committed'} result"
                )
            else:
                out += compare(new[k], old[k], f"{path}.{k}")
        return out
    if isinstance(new, list) and isinstance(old, list):
        if len(new) != len(old):
            return [f"{path}: length {len(new)} != {len(old)}"]
        return [
            d
            for i, (a, b) in enumerate(zip(new, old, strict=True))
            for d in compare(a, b, f"{path}[{i}]")
        ]
    num = (int, float)
    if (
        isinstance(new, num)
        and isinstance(old, num)
        and not isinstance(new, bool)
        and not isinstance(old, bool)
    ):
        if not math.isclose(new, old, rel_tol=CHECK_RTOL, abs_tol=CHECK_ATOL):
            return [f"{path}: {new} != {old}"]
        return []
    return [] if new == old else [f"{path}: {new!r} != {old!r}"]


def bin_index(x: np.ndarray, width: float) -> np.ndarray:
    """Bin number floor(x / width); a small epsilon keeps exact edges in the upper bin."""
    return np.floor(np.asarray(x, dtype=float) / width + 1e-9).astype(int)


def binned(
    x: np.ndarray, y: np.ndarray, width: float, min_n: int = MIN_BIN_DAYS
) -> list[dict[str, Any]]:
    """Bins of x with `min_n` or more values: centre, n, median and quantiles 25 and 75 of y."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    idx = bin_index(x, width)
    out: list[dict[str, Any]] = []
    for b in sorted(set(idx.tolist())):
        v = y[idx == b]
        if len(v) < min_n:
            continue
        out.append(
            {
                "lo": b * width,
                "centre": (b + 0.5) * width,
                "n": len(v),
                "median": float(np.median(v)),
                "q25": float(np.quantile(v, 0.25)),
                "q75": float(np.quantile(v, 0.75)),
                "mean": float(np.mean(v)),
            }
        )
    return out


def spearman(x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    r = stats.spearmanr(x, y)
    return {"rho": float(r.statistic), "p": float(r.pvalue), "n": len(x)}  # type: ignore[attr-defined]


def q10_model(t: np.ndarray, f10: float, k: float) -> np.ndarray:
    return f10 * np.exp(k * (t - T_REF))


def log_q10_model(t: np.ndarray, ln_f10: float, k: float) -> np.ndarray:
    return ln_f10 + k * (t - T_REF)


def q10_fit(bins: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Fit ln F = ln F10 + k (T - 10) to the positive bin medians. Q10 = exp(10 k), 95 % CI."""
    pos = [b for b in bins if b["median"] > 0]
    n_all = len(bins)
    base = {"nBins": len(pos), "nBinsAll": n_all}
    if len(pos) < FIT_MIN_BINS:
        return {
            **base,
            "ok": False,
            "reason": f"fewer than {FIT_MIN_BINS} bins with median > 0",
        }
    if len(pos) < FIT_MIN_POSITIVE_SHARE * n_all:
        return {
            **base,
            "ok": False,
            "reason": f"bins with median > 0 are less than {FIT_MIN_POSITIVE_SHARE:.0%} of the bins",
        }
    t = np.array([b["centre"] for b in pos])
    f = np.array([b["median"] for b in pos])
    lf = np.log(f)
    popt, pcov = optimize.curve_fit(log_q10_model, t, lf, p0=(float(lf.mean()), 0.0))
    ln_f10, k = float(popt[0]), float(popt[1])
    se = np.sqrt(np.diag(pcov))
    dof = len(pos) - 2
    tq = float(stats.t.ppf(0.975, dof))
    pred = log_q10_model(t, ln_f10, k)
    ss_res = float(np.sum((lf - pred) ** 2))
    ss_tot = float(np.sum((lf - lf.mean()) ** 2))
    q10_lo = math.exp(10 * (k - tq * se[1]))
    q10_hi = math.exp(10 * (k + tq * se[1]))
    return {
        **base,
        "ok": True,
        "reason": None,
        "f10": math.exp(ln_f10),
        "lnF10Se": float(se[0]),
        "k": k,
        "kSe": float(se[1]),
        "q10": math.exp(10 * k),
        "q10Lo": q10_lo,
        "q10Hi": q10_hi,
        "ciExcludes1": q10_lo > 1 or q10_hi < 1,
        "r2Log": 1 - ss_res / ss_tot if ss_tot > 0 else None,
        "tMin": float(t.min() - T_BIN / 2),
        "tMax": float(t.max() + T_BIN / 2),
    }


def zscore(x: np.ndarray) -> tuple[np.ndarray, float, float]:
    m = float(np.mean(x))
    s = float(np.std(x, ddof=1))
    return (x - m) / s, m, s


OLS_TERMS = ("const", "tsoil", "swc", "tsoilXswc")


def ols_hac(y: np.ndarray, tsoil: np.ndarray, swc: np.ndarray) -> dict[str, Any]:
    """OLS of y on z(tsoil), z(swc) and their product; Newey-West HAC SE with HAC_LAGS lags."""
    zt, mt, st = zscore(tsoil)
    zw, mw, sw = zscore(swc)
    x = np.column_stack([np.ones_like(zt), zt, zw, zt * zw])
    fit = sm.OLS(y, x).fit(cov_type="HAC", cov_kwds={"maxlags": HAC_LAGS})
    ci = np.asarray(fit.conf_int(0.05))
    params = np.asarray(fit.params)
    bse = np.asarray(fit.bse)
    pv = np.asarray(fit.pvalues)
    return {
        "n": len(y),
        "r2": float(fit.rsquared),
        "coef": {
            term: {
                "est": float(params[i]),
                "se": float(bse[i]),
                "lo": float(ci[i, 0]),
                "hi": float(ci[i, 1]),
                "p": float(pv[i]),
            }
            for i, term in enumerate(OLS_TERMS)
        },
        "drivers": {
            "tsoil": {"mean": mt, "sd": st},
            "swc": {"mean": mw, "sd": sw},
        },
    }


def block_bootstrap_mean(
    diff: np.ndarray,
    block: int = BLOCK_DAYS,
    reps: int = BOOT_REPS,
    seed: int = BOOT_SEED,
) -> dict[str, Any]:
    """Mean of `diff` with a 95 % percentile CI: blocks of `block` consecutive values, drawn with
    replacement (as many blocks as the data has)."""
    diff = np.asarray(diff, dtype=float)
    blocks = [diff[i : i + block] for i in range(0, len(diff), block)]
    rng = np.random.default_rng(seed)
    means = np.empty(reps)
    for r in range(reps):
        pick = rng.integers(0, len(blocks), size=len(blocks))
        means[r] = np.concatenate([blocks[i] for i in pick]).mean()
    return {
        "mean": float(diff.mean()),
        "lo": float(np.quantile(means, 0.025)),
        "hi": float(np.quantile(means, 0.975)),
        "nBlocks": len(blocks),
        "nDays": len(diff),
        "lastBlockDays": len(blocks[-1]),
    }


def annual_kg_ha(flux_sum: float, gas: str) -> float:
    """Sum of 30-min values (flux unit) to kg gas ha-1: x 1800 s x mol x g mol-1, g m-2 x 10."""
    return flux_sum * SECONDS_PER_HALF_HOUR * TO_MOL[gas] * MOLAR_MASS[gas] * 10


def daily_mg(flux_mean: float, gas: str) -> float:
    """Daily mean flux (flux unit) to mg gas m-2 d-1."""
    return flux_mean * SECONDS_PER_DAY * TO_MOL[gas] * MOLAR_MASS[gas] * 1000


def half_hours_in_year(year: int) -> int:
    return (date(year + 1, 1, 1) - date(year, 1, 1)).days * HALF_HOURS_PER_DAY


def fert_days(events: Sequence[date], days: int = FERT_DAYS) -> set[date]:
    """The local days 0 to days - 1 after each event (event day = day 0)."""
    return {e + timedelta(days=i) for e in events for i in range(days)}


# ======================================================================================
# Read
# ======================================================================================
OBS_SCHEMA = pa.DataFrameSchema(
    {
        "site_id": pa.Column(int),
        "ts_start": pa.Column("datetime64[us, UTC]"),
        "ch4": pa.Column(float, pa.Check.in_range(-5, 5), nullable=True),
        "n2o": pa.Column(float, pa.Check.in_range(-1000, 1000), nullable=True),
        "tsoil": pa.Column(float, pa.Check.in_range(-30, 45), nullable=True),
        "swc": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
    },
    strict=True,
)
EVENTS_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(ALL_SITE_CODES)),
        "date": pa.Column(object),
        "type": pa.Column(str),
    },
    strict=True,
)


def col(df: Any, name: str) -> pd.Series:
    """One column of a DataFrame as a Series (helps the type checker)."""
    s = df[name]
    if not isinstance(s, pd.Series):
        raise TypeError(f"column {name} is not a Series")
    return s


def frame(x: Any) -> pd.DataFrame:
    if not isinstance(x, pd.DataFrame):
        raise TypeError("not a DataFrame")
    return x


def columns_of(file: str) -> list[str]:
    return list(next(i for i in INPUTS if i.file == file).columns)


@dataclass
class Data:
    names: dict[str, str]
    slots: dict[str, int]
    offsets: dict[str, int]
    daily: pd.DataFrame  # one row per site and local day; NaN = no daily value
    halfhour: pd.DataFrame  # site, local year, ch4, n2o (for the annual sums)
    fert: dict[str, list[date]]
    steps: dict[str, Any]


def read_sites(db: Path) -> pd.DataFrame:
    sites = pd.read_parquet(
        db / "sites.parquet", columns=columns_of("sites.parquet"), engine="pyarrow"
    )
    sites = sites.sort_values("site_id").reset_index(drop=True)
    sites["code"] = sites["code"].astype(str)
    if tuple(sites["code"]) != ALL_SITE_CODES:
        raise InputError(
            f"sites.parquet: expected {ALL_SITE_CODES}, got {tuple(sites['code'])}"
        )
    return sites


def check_units(db: Path) -> dict[str, str]:
    v = pd.read_parquet(
        db / "variables.parquet",
        columns=columns_of("variables.parquet"),
        engine="pyarrow",
    )
    units = dict(zip(v["column_name"].astype(str), v["unit"].astype(str), strict=True))
    for name, unit in EXPECTED_UNITS.items():
        if units.get(name) != unit:
            raise InputError(
                f"variables.parquet: unit of {name} expected {unit!r}, actual {units.get(name)!r}"
            )
    return {k: units[k] for k in EXPECTED_UNITS}


def local_time(ts_start: pd.Series, offset_min: pd.Series) -> pd.Series:
    """Local time = ts_start (UTC) + utc_offset_min of the site, without a time zone."""
    if ts_start.dt.tz is None:
        ts_start = ts_start.dt.tz_localize("UTC")
    utc = ts_start.dt.tz_convert("UTC").dt.tz_localize(None)
    return utc + pd.to_timedelta(offset_min, unit="min")


def read_observations(
    db: Path, sites: pd.DataFrame, steps: dict[str, Any]
) -> pd.DataFrame:
    ids = {str(c): int(i) for c, i in zip(sites["code"], sites["site_id"], strict=True)}
    want = [ids[s] for s in SITES]
    obs = pd.read_parquet(
        db / "observations.parquet",
        columns=columns_of("observations.parquet"),
        filters=[("site_id", "in", want)],
        engine="pyarrow",
    )
    obs["site_id"] = obs["site_id"].astype(int)
    ts = col(obs, "ts_start")
    if ts.dt.tz is None:
        obs["ts_start"] = ts.dt.tz_localize("UTC")
    obs["ts_start"] = col(obs, "ts_start").astype("datetime64[us, UTC]")
    for c in ("ch4", "n2o", "tsoil", "swc"):
        obs[c] = col(obs, c).astype(float)
    obs = pd.DataFrame(OBS_SCHEMA.validate(obs))
    code = {v: k for k, v in ids.items()}
    obs["site"] = col(obs, "site_id").map(code)
    off = {
        str(c): int(o)
        for c, o in zip(sites["code"], sites["utc_offset_min"], strict=True)
    }
    obs["ts_local"] = local_time(col(obs, "ts_start"), col(obs, "site").map(off))
    obs["date"] = col(obs, "ts_local").dt.date
    obs["year"] = col(obs, "ts_local").dt.year
    n_read = len(obs)
    keep = np.zeros(len(obs), dtype=bool)
    for s in SITES:
        keep |= (col(obs, "site") == s).to_numpy() & col(obs, "year").isin(
            YEARS[s]
        ).to_numpy()
    obs = obs.loc[keep].reset_index(drop=True)
    steps["observations"] = {
        "rowsRead": n_read,
        "rowsOutsideYears": int(n_read - len(obs)),
        "rowsKept": len(obs),
        "rule": "sites anttila, sarkisuo, viikki; local years "
        + ", ".join(f"{s} {YEARS[s][0]}-{YEARS[s][-1]}" for s in SITES),
        "perSite": {
            s: {
                "rows": int((col(obs, "site") == s).sum()),
                **{
                    f"values_{c}": int(obs.loc[col(obs, "site") == s, c].notna().sum())
                    for c in ("ch4", "n2o", "tsoil", "swc")
                },
            }
            for s in SITES
        },
    }
    log.info(
        "observations: %d rows read, %d outside the local years removed, %d kept",
        n_read,
        n_read - len(obs),
        len(obs),
    )
    for s in SITES:
        for y in YEARS[s]:
            n = int(((col(obs, "site") == s) & (col(obs, "year") == y)).sum())
            if n != half_hours_in_year(y):
                raise InputError(
                    f"observations: {s} {y} has {n} rows, expected {half_hours_in_year(y)}"
                )
    return obs


def daily_table(obs: pd.DataFrame, steps: dict[str, Any]) -> pd.DataFrame:
    g = obs.groupby(["site", "date"], sort=True)
    means = frame(g[["ch4", "n2o", "tsoil", "swc"]].mean())
    counts = frame(g[["ch4", "n2o", "tsoil", "swc"]].count())
    rows = g.size()
    daily = means.where(counts >= MIN_VALUES_PER_DAY)
    daily = daily.reset_index()
    daily["rows"] = rows.to_numpy()
    daily["year"] = [d.year for d in col(daily, "date")]
    st: dict[str, Any] = {
        "rule": f"daily mean of a variable when it has {MIN_VALUES_PER_DAY} or more of the "
        f"{HALF_HOURS_PER_DAY} half hours of the local day",
        "days": len(daily),
        "perSite": {},
    }
    for s in SITES:
        m = col(daily, "site") == s
        cnt = counts.reset_index().loc[m.to_numpy()]
        st["perSite"][s] = {
            "days": int(m.sum()),
            **{
                v: {
                    "daysWithValue": int(daily.loc[m, v].notna().sum()),
                    "daysRemovedTooFew": int(
                        ((cnt[v] > 0) & (cnt[v] < MIN_VALUES_PER_DAY)).sum()
                    ),
                    "daysWithoutValues": int((cnt[v] == 0).sum()),
                }
                for v in ("ch4", "n2o", "tsoil", "swc")
            },
        }
    steps["daily"] = st
    log.info(
        "daily: %d site-days; per site: %s",
        len(daily),
        {s: st["perSite"][s]["days"] for s in SITES},
    )
    return daily


def read_fert_events(db: Path, steps: dict[str, Any]) -> dict[str, list[date]]:
    ev = pd.read_parquet(
        db / "events.parquet", columns=columns_of("events.parquet"), engine="pyarrow"
    )
    ev["site_code"] = ev["site_code"].astype(str)
    ev["type"] = ev["type"].astype(str)
    ev["date"] = pd.to_datetime(ev["date"]).dt.date
    ev = pd.DataFrame(EVENTS_SCHEMA.validate(ev))
    fert = {
        s: sorted(
            d
            for d, t, c in zip(ev["date"], ev["type"], ev["site_code"], strict=True)
            if t == "fertilisation" and c == s and d.year in YEARS[s]
        )
        for s in SITES
    }
    steps["events"] = {
        "rowsRead": len(ev),
        "fertilisationEvents": {s: [d.isoformat() for d in fert[s]] for s in SITES},
        "rule": "type fertilisation, site in the dive, year in the data years",
    }
    log.info(
        "events: %d rows read; fertilisation events %s",
        len(ev),
        {s: len(fert[s]) for s in SITES},
    )
    return fert


def read_data(db: Path) -> Data:
    steps: dict[str, Any] = {}
    sites = read_sites(db)
    steps["units"] = check_units(db)
    log.info("units agree with variables.parquet: %s", steps["units"])
    obs = read_observations(db, sites, steps)
    daily = daily_table(obs, steps)
    fert = read_fert_events(db, steps)
    codes = [str(c) for c in sites["code"]]
    return Data(
        names=dict(zip(codes, sites["name"].astype(str), strict=True)),
        slots={c: i for i, c in enumerate(codes)},
        offsets=dict(zip(codes, sites["utc_offset_min"].astype(int), strict=True)),
        daily=daily,
        halfhour=frame(obs[["site", "year", "ch4", "n2o"]]).copy(),
        fert=fert,
        steps=steps,
    )


# ======================================================================================
# Analysis
# ======================================================================================
def days_for(daily: pd.DataFrame, site: str, cols: Sequence[str]) -> pd.DataFrame:
    d = daily.loc[col(daily, "site") == site, ["date", "year", *cols]]
    return d.dropna(subset=list(cols)).sort_values("date").reset_index(drop=True)


def response(
    daily: pd.DataFrame, gas: str, site: str, driver: str, width: float, fit: bool
) -> dict[str, Any]:
    d = days_for(daily, site, [gas, driver])
    x = d[driver].to_numpy(dtype=float)
    y = d[gas].to_numpy(dtype=float)
    bins = binned(x, y, width)
    out: dict[str, Any] = {
        "n": len(d),
        "spearman": spearman(x, y),
        "driverMin": float(x.min()),
        "driverMax": float(x.max()),
        "nInBins": int(sum(b["n"] for b in bins)),
        "bins": bins,
        "fluxMedian": float(np.median(y)),
        "fluxMean": float(np.mean(y)),
    }
    if fit:
        out["fit"] = q10_fit(bins)
    return out


def drivers_block(
    daily: pd.DataFrame,
    steps_key: str,
    steps: dict[str, Any],
    gases: Sequence[str] = GASES,
) -> dict[str, Any]:
    """Steps 2 to 4 on one daily table."""
    out: dict[str, Any] = {"temperature": {}, "water": {}, "ols": {}}
    counts: dict[str, Any] = {}
    for gas in gases:
        out["temperature"][gas] = {}
        out["water"][gas] = {}
        out["ols"][gas] = {}
        for site in GAS_SITES[gas]:
            t = response(daily, gas, site, "tsoil", T_BIN, fit=True)
            w = response(daily, gas, site, "swc", W_BIN, fit=False)
            d = days_for(daily, site, [gas, "tsoil", "swc"])
            o = ols_hac(
                d[gas].to_numpy(dtype=float),
                d["tsoil"].to_numpy(dtype=float),
                d["swc"].to_numpy(dtype=float),
            )
            out["temperature"][gas][site] = t
            out["water"][gas][site] = w
            out["ols"][gas][site] = o
            counts[f"{gas}.{site}"] = {
                "daysTemperature": t["n"],
                "daysTemperatureInBins": t["nInBins"],
                "daysWater": w["n"],
                "daysWaterInBins": w["nInBins"],
                "daysOls": o["n"],
            }
            log.info(
                "%s %s %s: tsoil n %d rho %.3f%s; swc n %d rho %.3f; OLS n %d R2 %.3f",
                steps_key,
                gas,
                site,
                t["n"],
                t["spearman"]["rho"],
                f" Q10 {t['fit']['q10']:.2f}"
                if t["fit"]["ok"]
                else f" no fit ({t['fit']['reason']})",
                w["n"],
                w["spearman"]["rho"],
                o["n"],
                o["r2"],
            )
    steps[steps_key] = {
        "rule": f"days with a daily value of the gas and the driver; bins with {MIN_BIN_DAYS} or more days",
        "counts": counts,
    }
    return out


def annual_sums(data: Data) -> dict[str, Any]:
    hh = data.halfhour
    out: dict[str, Any] = {}
    for site in SITES:
        out[site] = {}
        for year in YEARS[site]:
            m = (col(hh, "site") == site) & (col(hh, "year") == year)
            out[site][str(year)] = {}
            for gas in GASES:
                if site not in GAS_SITES[gas]:
                    continue
                v = hh.loc[m, gas]
                n = int(v.notna().sum())
                expected = half_hours_in_year(year)
                total = float(v.sum())
                kg = annual_kg_ha(total, gas)
                row = {
                    "kgHa": kg,
                    "gM2": kg / 10,
                    "values": n,
                    "halfHours": expected,
                    "coverage": n / expected,
                    "partial": n / expected < PARTIAL_COVERAGE,
                }
                if site == "viikki" and gas == "n2o":
                    row["kgHaIfN2oN"] = kg * N2O_N_FACTOR
                out[site][str(year)][gas] = row
    return out


def literature_compare(annual: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for (site, gas), key in LIT_ANNUAL.items():
        lit = LIT[key]
        ours = annual[site][str(LIT_YEAR)][gas]
        out[f"{site}_{gas}"] = {
            "site": site,
            "gas": gas,
            "year": LIT_YEAR,
            "ours": ours["kgHa"],
            "coverage": ours["coverage"],
            "partial": ours["partial"],
            "literature": lit["value"],
            "literatureLo": lit["uncertainty"]["lo"],
            "literatureHi": lit["uncertainty"]["hi"],
            "unit": lit["unit"],
            "ratio": ours["kgHa"] / lit["value"],
            "litKey": key,
        }
    return out


def soil_type(daily: pd.DataFrame) -> dict[str, Any]:
    """Step 5b: paired days of Sarkisuo (peat) and Anttila (mineral)."""
    out: dict[str, Any] = {
        "peat": PEAT,
        "mineral": MINERAL,
        "blockDays": BLOCK_DAYS,
        "reps": BOOT_REPS,
        "seed": BOOT_SEED,
    }
    for gas in GASES:
        a = col(days_for(daily, MINERAL, [gas]).set_index("date"), gas)
        p = col(days_for(daily, PEAT, [gas]).set_index("date"), gas)
        both = pd.concat({"peat": p, "mineral": a}, axis=1, join="inner").sort_index()
        diff = (both["peat"] - both["mineral"]).to_numpy(dtype=float)
        boot = block_bootstrap_mean(diff)
        r: dict[str, Any] = {
            "nDays": len(both),
            "first": both.index[0].isoformat(),
            "last": both.index[-1].isoformat(),
            "diff": boot,
            "diffMgPerDay": {k: daily_mg(boot[k], gas) for k in ("mean", "lo", "hi")},
            "daysPeatHigher": int((diff > 0).sum()),
        }
        for role, s in (("peatStats", both["peat"]), ("mineralStats", both["mineral"])):
            v = s.to_numpy(dtype=float)
            r[role] = {
                "mean": float(v.mean()),
                "sd": float(np.std(v, ddof=1)),
                "median": float(np.median(v)),
                "q25": float(np.quantile(v, 0.25)),
                "q75": float(np.quantile(v, 0.75)),
                "meanMgPerDay": daily_mg(float(v.mean()), gas),
                "medianMgPerDay": daily_mg(float(np.median(v)), gas),
            }
        r["ratioOfMeans"] = (
            r["peatStats"]["mean"] / r["mineralStats"]["mean"]
            if r["mineralStats"]["mean"] != 0
            else None
        )
        out[gas] = r
        log.info(
            "soil type %s: %d paired days, mean difference peat - mineral %.4g (95 %% CI %.4g to %.4g) %s",
            gas,
            len(both),
            boot["mean"],
            boot["lo"],
            boot["hi"],
            FLUX_UNIT_TEXT[gas],
        )
    return out


def sensitivity(data: Data, steps: dict[str, Any]) -> dict[str, Any]:
    """Step 6: N2O without the days 0 to FERT_DAYS - 1 after each fertilisation event."""
    daily = data.daily
    drop = np.zeros(len(daily), dtype=bool)
    removed: dict[str, int] = {}
    for s in SITES:
        days = fert_days(data.fert[s])
        m = (col(daily, "site") == s).to_numpy() & col(daily, "date").isin(
            days
        ).to_numpy()
        removed[s] = int((m & daily["n2o"].notna().to_numpy()).sum())
        drop |= m
    reduced = daily.loc[~drop].reset_index(drop=True)
    inner_steps: dict[str, Any] = {}
    block = drivers_block(reduced, "sensitivityN2o", inner_steps, gases=("n2o",))
    share: dict[str, Any] = {}
    for s in SITES:
        days = fert_days(data.fert[s])
        share[s] = {}
        for y in YEARS[s]:
            sel = daily.loc[(col(daily, "site") == s) & (col(daily, "year") == y)]
            tot = float(sel["n2o"].sum())
            in_w = float(sel.loc[col(sel, "date").isin(days), "n2o"].sum())
            has = sel["n2o"].notna()
            n_val = int(has.sum())
            n_win = int((has & col(sel, "date").isin(days)).sum())
            share[s][str(y)] = {
                "shareOfDailySum": in_w / tot if tot != 0 else None,
                "daysInWindows": int(col(sel, "date").isin(days).sum()),
                # Reference: the share of the days with a daily N2O value that are in the windows.
                "daysWithValue": n_val,
                "windowDaysWithValue": n_win,
                "shareOfDays": n_win / n_val if n_val else None,
            }
    steps["sensitivityN2o"] = {
        "rule": f"remove the local days 0 to {FERT_DAYS - 1} after each fertilisation event",
        "daysWithN2oRemoved": removed,
        "counts": inner_steps["sensitivityN2o"]["counts"],
    }
    log.info("sensitivity N2O: days with N2O removed %s", removed)
    return {
        "fertDays": FERT_DAYS,
        "daysRemoved": removed,
        "temperature": {"n2o": block["temperature"]["n2o"]},
        "water": {"n2o": block["water"]["n2o"]},
        "ols": {"n2o": block["ols"]["n2o"]},
        "shareInWindows": share,
    }


def heat_map(daily: pd.DataFrame) -> dict[str, Any]:
    out: dict[str, Any] = {
        "tBin": MAP_T_BIN,
        "wBin": MAP_W_BIN,
        "minDays": MIN_CELL_DAYS,
    }
    for gas in GASES:
        out[gas] = {}
        for site in GAS_SITES[gas]:
            d = days_for(daily, site, [gas, "tsoil", "swc"])
            ti = bin_index(d["tsoil"].to_numpy(), MAP_T_BIN)
            wi = bin_index(d["swc"].to_numpy(), MAP_W_BIN)
            y = d[gas].to_numpy(dtype=float)
            cells = []
            for a, b in sorted(set(zip(ti.tolist(), wi.tolist(), strict=True))):
                v = y[(ti == a) & (wi == b)]
                if len(v) < MIN_CELL_DAYS:
                    continue
                cells.append(
                    {
                        "t": a * MAP_T_BIN,
                        "w": b * MAP_W_BIN,
                        "n": len(v),
                        "mean": float(v.mean()),
                    }
                )
            best = max(cells, key=lambda c: c["mean"])
            out[gas][site] = {
                "nDays": len(d),
                "nCells": len(cells),
                "nDaysInCells": int(sum(c["n"] for c in cells)),
                "cells": cells,
                "maxCell": best,
            }
    return out


def analyse(data: Data) -> dict[str, Any]:
    steps = data.steps
    main = drivers_block(data.daily, "drivers", steps)
    annual = annual_sums(data)
    res: dict[str, Any] = {
        "sites": {
            s: {
                "name": data.names[s],
                "slot": data.slots[s],
                "soilType": SOIL[s]["type"],
                "soilLitKey": SOIL[s]["litKey"],
                "sensorDepthCm": SOIL[s]["depthCm"],
                "years": list(YEARS[s]),
                "gases": [g for g in GASES if s in GAS_SITES[g]],
                "fertilisationEvents": [d.isoformat() for d in data.fert[s]],
            }
            for s in SITES
        },
        **main,
        "annual": annual,
        "literatureCompare": literature_compare(annual),
        "soilTypeCompare": soil_type(data.daily),
        "sensitivity": sensitivity(data, steps),
        "heatMap": heat_map(data.daily),
    }
    # Short keys for the article.
    res["summary"] = summary(res)
    return res


def summary(res: dict[str, Any]) -> dict[str, Any]:
    t = res["temperature"]
    s: dict[str, Any] = {}
    for gas in GASES:
        for site in GAS_SITES[gas]:
            k = f"{site}_{gas}"
            f = t[gas][site]["fit"]
            s[k] = {
                "rhoT": t[gas][site]["spearman"]["rho"],
                "rhoW": res["water"][gas][site]["spearman"]["rho"],
                "q10": f["q10"] if f["ok"] else None,
                "q10Lo": f["q10Lo"] if f["ok"] else None,
                "q10Hi": f["q10Hi"] if f["ok"] else None,
                "olsR2": res["ols"][gas][site]["r2"],
                "nDays": t[gas][site]["n"],
            }
            if gas == "n2o":
                st = res["sensitivity"]["temperature"]["n2o"][site]
                s[k]["rhoTNoFert"] = st["spearman"]["rho"]
                s[k]["rhoWNoFert"] = res["sensitivity"]["water"]["n2o"][site][
                    "spearman"
                ]["rho"]
                s[k]["q10NoFert"] = st["fit"]["q10"] if st["fit"]["ok"] else None
                s[k]["olsR2NoFert"] = res["sensitivity"]["ols"]["n2o"][site]["r2"]
    return s


# ======================================================================================
# Figures
# ======================================================================================
def fmt(x: float | None, digits: int = 2) -> str:
    if x is None:
        return "n/a"
    return f"{x:.{digits}f}".replace("-", "−")


def sig(x: float | None, n: int = 3) -> str:
    if x is None:
        return "n/a"
    if x == 0:
        return "0"
    d = max(0, n - 1 - math.floor(math.log10(abs(x))))
    return f"{x:.{d}f}".replace("-", "−")


def setup_matplotlib() -> None:
    f = FONT_SCALE
    plt.rcParams.update(
        {
            "svg.fonttype": "none",
            "font.family": "sans-serif",
            "font.sans-serif": ["DejaVu Sans"],
            "mathtext.default": "regular",
            "axes.unicode_minus": True,
            "font.size": 7 * f,
            "axes.labelsize": 7 * f,
            "axes.titlesize": 7.5 * f,
            "xtick.labelsize": 6.5 * f,
            "ytick.labelsize": 6.5 * f,
            "legend.fontsize": 6.5 * f,
            "axes.edgecolor": INK,
            "axes.labelcolor": INK,
            "text.color": INK,
            "xtick.color": INK,
            "ytick.color": INK,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "savefig.facecolor": "white",
            "savefig.transparent": False,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.linewidth": 0.8,
            "hatch.linewidth": 1.0,
        }
    )


def esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


SUPERSCRIPT = str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹")
PLAIN_WORDS = (
    (r"\bumol\b", "µmol"),
    (r"\bm3\b", "m³"),
    (r"\bCH4\b", "CH₄"),
    (r"\bN2O\b", "N₂O"),
    (r"\bQ10\b", "Q₁₀"),
    (r"\brho\b", "ρ"),
    (r"\bSarkisuo\b", "Särkisuo"),
)


def plain_unicode(text: str) -> str:
    """Caption and alt text: Unicode units and symbols (µmol m⁻² s⁻¹, m³ m⁻³, CH₄, N₂O, ρ, Q₁₀)."""
    for pat, new in PLAIN_WORDS:
        text = re.sub(pat, new, text)
    return re.sub(
        r"\b(m|s|ha|yr|d)(-[1-3])(?!\d|\.\d)",
        lambda m: m[1] + m[2].translate(SUPERSCRIPT),
        text,
    )


def svg_ids(n: int) -> tuple[str, str, str]:
    """The ids of <title> and <desc> and the id prefix of a figure."""
    return f"{SLUG}-fig{n}-title", f"{SLUG}-fig{n}-desc", f"{SVG_ID_PREFIX}{n}-"


def add_svg_text(path: Path, n: int, title: str, desc: str) -> None:
    """Add role, aria-labelledby, <title> and <desc>, and the site font stack on each text element."""
    svg = path.read_text(encoding="utf-8")
    tid, did, prefix = svg_ids(n)
    m = re.search(r"<svg\b[^>]*>", svg)
    if not m:
        raise RuntimeError(f"{path}: no <svg> element")
    tag = m.group(0)
    # matplotlib writes the metadata Title also as a <title> element; the script writes its own.
    rest = re.sub(
        r"\s*<title>.*?</title>", "", svg[m.end() :], count=1, flags=re.DOTALL
    )
    svg = svg[: m.end()] + rest
    new_tag = tag[:-1].rstrip() + f' role="img" aria-labelledby="{tid} {did}">'
    head = f'\n <title id="{tid}">{esc(title)}</title>\n <desc id="{did}">{esc(desc)}</desc>'
    svg = svg[: m.start()] + new_tag + head + svg[m.end() :]

    def fix_style(mt: re.Match[str]) -> str:
        style = mt.group(2)
        style = re.sub(r"font-family:\s*[^;\"]+", f"font-family: {FONT_STACK}", style)
        style = re.sub(
            r"('DejaVu Sans[^']*'|\"DejaVu Sans[^\"]*\"|DejaVu Sans)", FONT_STACK, style
        )
        if "font-family" not in style and "font:" not in style:
            style = f"font-family: {FONT_STACK}; " + style
        if "font-variant-numeric" not in style:
            style = style.rstrip().rstrip(";") + "; font-variant-numeric: tabular-nums"
        return f'{mt.group(1)}style="{style}"'

    svg = re.sub(r'(<(?:text|tspan)\b[^>]*?)style="([^"]*)"', fix_style, svg)
    svg = re.sub(
        r"<(text|tspan)\b(?![^>]*\bstyle=)([^>]*)>",
        lambda mt: (
            f'<{mt.group(1)}{mt.group(2)} style="font-family: {FONT_STACK}; font-variant-numeric: tabular-nums">'
        ),
        svg,
    )
    svg = prefix_svg_ids(svg, prefix, keep={tid, did})
    svg = unique_ids(svg)
    path.write_text(svg, encoding="utf-8")


def unique_ids(svg: str) -> str:
    """matplotlib gives equal colour bar images the same id. A second (third, ...) element with
    the same id gets the suffix -2 (-3, ...). The script stops if such an id has a reference."""
    seen: dict[str, int] = {}

    def fix(m: re.Match[str]) -> str:
        i = m.group(1)
        seen[i] = seen.get(i, 0) + 1
        return m.group(0) if seen[i] == 1 else f'id="{i}-{seen[i]}"'

    out = re.sub(r'\bid="([^"]+)"', fix, svg)
    for i, n in seen.items():
        if n > 1 and (f"#{i})" in svg or f'#{i}"' in svg):
            raise RuntimeError(f"duplicate SVG id {i} has a reference")
    return out


def prefix_svg_ids(svg: str, prefix: str, keep: set[str]) -> str:
    """Prefix each id (except `keep`) and each reference to it, so that ids are unique in one page."""
    ids = set(re.findall(r'\bid="([^"]+)"', svg)) - keep
    svg = re.sub(
        r'\bid="([^"]+)"',
        lambda m: f'id="{prefix}{m.group(1)}"' if m.group(1) in ids else m.group(0),
        svg,
    )
    svg = re.sub(
        r"url\(#([^)]+)\)",
        lambda m: f"url(#{prefix}{m.group(1)})" if m.group(1) in ids else m.group(0),
        svg,
    )
    return re.sub(
        r'((?:xlink:)?href)="#([^"]+)"',
        lambda m: (
            f'{m.group(1)}="#{prefix}{m.group(2)}"' if m.group(2) in ids else m.group(0)
        ),
        svg,
    )


def save_svg(
    fig: Any, path: Path, n: int, title: str, desc: str, meta: dict[str, str]
) -> None:
    plt.rcParams["svg.hashsalt"] = f"{SLUG}-{n}"
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        path,
        format="svg",
        metadata={
            "Date": None,
            "Title": title,
            "Description": desc,
            "Source": meta["source"],
            "Creator": f"matplotlib {matplotlib.__version__}",
            "Relation": meta["relation"],
        },
    )
    plt.close(fig)
    add_svg_text(path, n, title, desc)


def lighter(hex_color: str, f: float = 0.55) -> str:
    """The colour mixed with white (f = share of white)."""
    h = hex_color.lstrip("#")
    rgb = [int(h[i : i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(c + (255 - c) * f):02x}" for c in rgb)


def site_label(site: str, data: Data) -> str:
    """Figure label of a site: emoji, one space, name."""
    return f"{SITE_EMOJI[site]} {data.names[site]}"


def emoji_glyph_filter() -> None:
    """Ignore only the matplotlib warnings "Glyph N (...) missing from font(s) DejaVu Sans" of the
    code points of SITE_EMOJI. The SVG keeps the text; the browser draws the emojis."""
    cps = sorted({ord(c) for e in SITE_EMOJI.values() for c in e})
    pattern = r"Glyph (" + "|".join(str(c) for c in cps) + r") \("
    warnings.filterwarnings("ignore", message=pattern, category=UserWarning)


def site_style(site: str, data: Data) -> tuple[str, tuple[float, ...] | None, str]:
    slot = data.slots[site]
    return SITE_COLORS[slot], SITE_DASHES[slot], SITE_MARKERS[slot]


def site_handles(sites: Sequence[str], data: Data) -> list[Line2D]:
    out = []
    for s in sites:
        c, dash, mk = site_style(s, data)
        h = Line2D(
            [],
            [],
            color=c,
            lw=LINE_WIDTH,
            marker=mk,
            ms=5,
            mec="white",
            mew=0.6,
            label=site_label(s, data),
        )
        if dash:
            h.set_dashes(dash)
        out.append(h)
    return out


def response_figure(
    res: dict[str, Any], data: Data, key: str, xlabel: str, with_fit: bool
) -> Any:
    """Figures 1 and 2: rows CH4 and N2O; median line, IQR band, optional Q10 fit."""
    fig, axes = plt.subplots(
        2, 1, figsize=(FIG_WIDTH_IN, FIG_RESPONSE_HEIGHT_IN), sharex=True
    )
    fig.subplots_adjust(left=0.11, right=0.97, top=0.86, bottom=0.15, hspace=0.22)
    for ax, gas in zip(axes, GASES, strict=True):
        for site in GAS_SITES[gas]:
            r = res[key][gas][site]
            c, dash, mk = site_style(site, data)
            x = np.array([b["centre"] for b in r["bins"]])
            ax.fill_between(
                x,
                [b["q25"] for b in r["bins"]],
                [b["q75"] for b in r["bins"]],
                color=c,
                alpha=0.16,
                lw=0,
                zorder=1,
            )
            (line,) = ax.plot(
                x,
                [b["median"] for b in r["bins"]],
                color=c,
                lw=LINE_WIDTH,
                marker=mk,
                ms=4,
                mec="white",
                mew=0.5,
                zorder=3,
            )
            if dash:
                line.set_dashes(dash)
            f = r.get("fit")
            if with_fit and f and f["ok"]:
                tt = np.linspace(f["tMin"], f["tMax"], 100)
                ax.plot(
                    tt,
                    q10_model(tt, f["f10"], f["k"]),
                    color=c,
                    lw=1.0,
                    ls=(0, (1, 1.5)),
                    zorder=4,
                )
        ax.axhline(0, color=GUIDE, lw=0.8, zorder=0.5)
        ax.set_ylabel(FLUX_AXIS[gas])
        ax.set_title(f"{GAS_MATH[gas]}", loc="left", fontweight="bold", pad=6)
        if gas == "n2o":
            # The N2O medians are near 0.1 and the warm bins of the peat site go up to 5: a
            # symmetric log axis shows both. The zero line stays.
            ax.set_yscale("symlog", linthresh=N2O_LINTHRESH, linscale=0.8)
            top = max(
                b["q75"] for s in GAS_SITES[gas] for b in res[key][gas][s]["bins"]
            )
            ticks = [t for t in N2O_TICKS if t <= top * 1.2]
            ax.set_yticks(ticks, [f"{t:g}" for t in ticks])
            ax.yaxis.set_minor_locator(NullLocator())
            ax.set_ylim(-0.02, top * 1.3)
            ax.set_title(
                f"y axis: linear below {N2O_LINTHRESH:g}, logarithmic above",
                loc="right",
                fontsize=6 * FONT_SCALE,
                pad=6,
            )
        ax.margins(x=0.03)
    axes[1].set_xlabel(xlabel)
    handles: list[Any] = site_handles(SITES, data)
    handles.append(Patch(facecolor=GUIDE, alpha=0.3, label="25 to 75 % of the days"))
    if with_fit:
        handles.append(
            Line2D([], [], color=INK, lw=1.0, ls=(0, (1, 1.5)), label=r"Q$_{10}$ fit")
        )
    # matplotlib fills the legend column by column: reorder so that the sites form the first row.
    ncols = 3
    rows = [handles[i : i + ncols] for i in range(0, len(handles), ncols)]
    ordered = [r[c] for c in range(ncols) for r in rows if c < len(r)]
    fig.legend(
        handles=ordered,
        loc="upper center",
        bbox_to_anchor=(0.54, 0.995),
        ncols=ncols,
        frameon=False,
    )
    fig.text(
        0.11,
        0.025,
        f"{SIGN_NOTE} Line: median of the daily means per bin (bins with {MIN_BIN_DAYS} or more\n"
        "days). Daily means of local days (UTC+2).",
        fontsize=6 * FONT_SCALE,
        color=INK,
    )
    return fig


def trend_word(rho: float) -> str:
    """Words for a Spearman rho: strength (|rho| < 0.1 none, < 0.3 weak, < 0.5 moderate, else
    strong) and direction."""
    a = abs(rho)
    if a < 0.1:
        return "no clear monotonic relation"
    strength = "weak" if a < 0.3 else "moderate" if a < 0.5 else "strong"
    return f"a {strength} {'positive' if rho > 0 else 'negative'} relation"


def pattern_text(res: dict[str, Any], key: str, data: Data, driver: str) -> str:
    """One sentence per gas: the relation words of each site (from rho)."""
    out = []
    for gas in GASES:
        items = [
            f"{data.names[s]} {trend_word(res[key][gas][s]['spearman']['rho'])}"
            for s in GAS_SITES[gas]
        ]
        out.append(f"{GAS_LABEL[gas]} against {driver}: " + "; ".join(items) + ".")
    return " ".join(out)


def rho_text(r: dict[str, Any]) -> str:
    return f"rho {fmt(r['spearman']['rho'])} (n = {r['n']} days)"


def fig_temperature(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    fig = response_figure(res, data, "temperature", TSOIL_AXIS, with_fit=True)
    parts = [
        (
            "Two panels, one above the other: CH4 flux (umol m-2 s-1, top) and N2O flux "
            "(nmol m-2 s-1, bottom) against the daily mean soil temperature (°C, shared x axis; "
            "Anttila and Särkisuo at 5 cm, Viikki at 14 cm). Each line is the median of the daily "
            "means per 1 °C bin with the 25 to 75 % band; the dotted lines are Q10 fits."
        )
    ]
    for gas in GASES:
        items = []
        for site in GAS_SITES[gas]:
            r = res["temperature"][gas][site]
            f = r["fit"]
            ftxt = (
                f", Q10 {fmt(f['q10'])} (95 % CI {fmt(f['q10Lo'])} to {fmt(f['q10Hi'])})"
                if f["ok"]
                else f", no Q10 fit ({f['reason']})"
            )
            hi = max(r["bins"], key=lambda b: b["median"])
            items.append(
                f"{data.names[site]}: {rho_text(r)}, tsoil {fmt(r['driverMin'], 1)} to "
                f"{fmt(r['driverMax'], 1)} °C, largest bin median {sig(hi['median'])} "
                f"{FLUX_UNIT_TEXT[gas]} at "
                f"{fmt(hi['centre'], 1)} °C{ftxt}"
            )
        parts.append(f"{GAS_LABEL[gas]}: " + "; ".join(items) + ".")
    parts.append(pattern_text(res, "temperature", data, "soil temperature"))
    parts.append("The fluxes are gap-filled values. Flux > 0 = emission.")
    return fig, FIG1_TITLE, " ".join(parts)


def fig_water(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    fig = response_figure(res, data, "water", SWC_AXIS, with_fit=False)
    parts = [
        (
            "Two panels, one above the other: CH4 flux (umol m-2 s-1, top) and N2O flux "
            "(nmol m-2 s-1, bottom) against the daily mean soil water content (m3 m-3, shared x "
            "axis). Each line is the median of the daily means per 0.02 m3 m-3 bin with the 25 to "
            "75 % band."
        )
    ]
    for gas in GASES:
        items = []
        for site in GAS_SITES[gas]:
            r = res["water"][gas][site]
            items.append(
                f"{data.names[site]}: {rho_text(r)}, swc {fmt(r['driverMin'])} to "
                f"{fmt(r['driverMax'])} m3 m-3"
            )
        parts.append(f"{GAS_LABEL[gas]}: " + "; ".join(items) + ".")
    parts.append(pattern_text(res, "water", data, "soil water content"))
    parts.append("The fluxes are gap-filled values. Flux > 0 = emission.")
    return fig, FIG2_TITLE, " ".join(parts)


def fig_map(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    hm = res["heatMap"]
    fig = plt.figure(figsize=(FIG_WIDTH_IN, FIG_MAP_HEIGHT_IN))
    gs = fig.add_gridspec(
        2, 3, left=0.08, right=0.92, top=0.9, bottom=0.1, wspace=0.62, hspace=0.42
    )
    panels = [
        ("ch4", "anttila", gs[0, 0]),
        ("ch4", "sarkisuo", gs[0, 1]),
        ("n2o", "anttila", gs[1, 0]),
        ("n2o", "sarkisuo", gs[1, 1]),
        ("n2o", "viikki", gs[1, 2]),
    ]
    all_cells = [c for g in GASES for s in GAS_SITES[g] for c in hm[g][s]["cells"]]
    t_lo = min(c["t"] for c in all_cells)
    t_hi = max(c["t"] for c in all_cells) + MAP_T_BIN
    w_lo = min(c["w"] for c in all_cells)
    w_hi = max(c["w"] for c in all_cells) + MAP_W_BIN
    nt = round((t_hi - t_lo) / MAP_T_BIN)
    nw = round((w_hi - w_lo) / MAP_W_BIN)
    te = t_lo + MAP_T_BIN * np.arange(nt + 1)
    we = w_lo + MAP_W_BIN * np.arange(nw + 1)
    axes = []
    for gas, site, spec in panels:
        ax = fig.add_subplot(spec)
        axes.append(ax)
        grid = np.full((nw, nt), np.nan)
        for c in hm[gas][site]["cells"]:
            i = round((c["w"] - w_lo) / MAP_W_BIN)
            j = round((c["t"] - t_lo) / MAP_T_BIN)
            grid[i, j] = c["mean"]
        vmax = float(np.nanmax(np.abs(grid)))
        norm = TwoSlopeNorm(vmin=-vmax, vcenter=0.0, vmax=vmax)
        mesh = ax.pcolormesh(
            te,
            we,
            np.ma.masked_invalid(grid),
            cmap=CMAP,
            norm=norm,
            edgecolors="white",
            linewidth=0.3,
        )
        cb = fig.colorbar(mesh, ax=ax, fraction=0.08, pad=0.04)
        cb.set_label(
            FLUX_AXIS[gas].replace(" flux", ""), fontsize=5.5 * FONT_SCALE, labelpad=3
        )
        cb.ax.tick_params(labelsize=5.5 * FONT_SCALE)
        cb.formatter.set_powerlimits((-6, 6))  # type: ignore[attr-defined]
        cb.update_ticks()
        ax.set_facecolor("#f2f2f2")
        # Two titles: the emoji text must not be in a mathtext string.
        ax.set_title(
            site_label(site, data), loc="left", fontsize=6.5 * FONT_SCALE, pad=5
        )
        ax.set_title(
            GAS_MATH[gas],
            loc="right",
            fontsize=6.5 * FONT_SCALE,
            pad=5,
            fontweight="bold",
        )
        ax.set_xlim(te[0], te[-1])
        ax.set_ylim(we[0], we[-1])
        ax.tick_params(labelsize=5.5 * FONT_SCALE)
        ax.set_xlabel(r"Soil temperature ($\degree$C)", fontsize=6 * FONT_SCALE)
        if spec.colspan.start == 0:
            ax.set_ylabel(
                r"Soil water content (m$^3$ m$^{-3}$)", fontsize=6 * FONT_SCALE
            )
    fig.text(
        0.70,
        0.82,
        "Colour: mean of the daily\nmeans in the cell; orange =\nemission, purple = uptake.\n"
        f"Cell: {MAP_T_BIN:g} °C × {MAP_W_BIN:g} m$^3$ m$^{{-3}}$,\n"
        f"{MIN_CELL_DAYS} or more days.\nGrey: no data.\nEach panel has its own scale.",
        fontsize=6 * FONT_SCALE,
        va="top",
        linespacing=1.4,
    )
    parts = [
        (
            "Five heat maps: x axis daily mean soil temperature (°C, "
            f"{fmt(te[0], 0)} to {fmt(te[-1], 0)}), y axis daily mean soil water content "
            f"(m3 m-3, {fmt(we[0])} to {fmt(we[-1])}), the same axes in all panels. Top row CH4 at "
            "Anttila and Särkisuo (umol m-2 s-1); bottom row N2O at Anttila, Särkisuo and Viikki "
            f"(nmol m-2 s-1). Cells of {MAP_T_BIN:g} °C by {MAP_W_BIN:g} m3 m-3 with {MIN_CELL_DAYS} "
            "or more days; colour = mean daily flux, diverging around 0, each panel with its own "
            "colour scale."
        )
    ]
    for gas, site, _ in panels:
        h = hm[gas][site]
        b = h["maxCell"]
        parts.append(
            f"{data.names[site]} {GAS_LABEL[gas]}: {h['nCells']} cells, {h['nDaysInCells']} of "
            f"{h['nDays']} days; largest mean {sig(b['mean'])} {FLUX_UNIT_TEXT[gas]} at "
            f"{fmt(b['t'], 0)} to {fmt(b['t'] + MAP_T_BIN, 0)} °C and {fmt(b['w'])} to "
            f"{fmt(b['w'] + MAP_W_BIN)} m3 m-3 (n = {b['n']})."
        )
    wr = {s: res["water"]["n2o"][s] for s in SITES}
    parts.append(
        "Soil water ranges (m3 m-3): "
        + "; ".join(
            f"{data.names[s]} {fmt(wr[s]['driverMin'])} to {fmt(wr[s]['driverMax'])}"
            for s in SITES
        )
        + ". Grey = no cell. The flux values are gap-filled. Flux > 0 = emission."
    )
    return fig, FIG3_TITLE, " ".join(parts)


def fig_bars(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    fig, axes = plt.subplots(
        1,
        2,
        figsize=(FIG_WIDTH_IN, FIG_BARS_HEIGHT_IN),
        gridspec_kw={"width_ratios": [4, 8]},
    )
    fig.subplots_adjust(left=0.09, right=0.98, top=0.8, bottom=0.24, wspace=0.28)
    ann = res["annual"]
    lit_handle = None
    desc_parts = [
        (
            "Two bar charts of annual sums per site-year: CH4 in kg CH4 ha-1 yr-1 (left; Anttila "
            "and Särkisuo 2022 and 2023) and N2O in kg N2O ha-1 yr-1 (right; also Viikki 2022 to "
            "2025). A lighter, hatched bar with an asterisk is a partial year (coverage below "
            f"{PARTIAL_COVERAGE:.0%}). Black diamonds with a bar are the 2022 values and ranges of "
            "Shurpali et al. (2025) Table 3."
        )
    ]
    for ax, gas in zip(axes, GASES, strict=True):
        xs: list[float] = []
        labels: list[str] = []
        x = 0.0
        items = []
        for site in GAS_SITES[gas]:
            c, _, _ = site_style(site, data)
            for y in YEARS[site]:
                r = ann[site][str(y)][gas]
                part = r["partial"]
                ax.bar(
                    x,
                    r["kgHa"],
                    0.75,
                    color=lighter(c) if part else c,
                    edgecolor=c if part else INK,
                    hatch="///" if part else None,
                    lw=0.8,
                    zorder=2,
                )
                key = LIT_ANNUAL.get((site, gas))
                has_lit = key is not None and y == LIT_YEAR
                # With a literature marker at the right edge of the bar, the value label moves left.
                ax.annotate(
                    sig(r["kgHa"], 2 if r["kgHa"] < 10 else 3),
                    (x - 0.12 if has_lit else x, r["kgHa"]),
                    xytext=(0, 3),
                    textcoords="offset points",
                    ha="center",
                    va="bottom",
                    fontsize=5.5 * FONT_SCALE,
                )
                if key is not None and has_lit:
                    lit = LIT[key]
                    lo, hi = lit["uncertainty"]["lo"], lit["uncertainty"]["hi"]
                    xl = x + 0.45
                    ax.errorbar(
                        xl,
                        lit["value"],
                        yerr=[[lit["value"] - lo], [hi - lit["value"]]],
                        fmt="D",
                        color=LIT_COLOR,
                        ms=4.5,
                        mec="white",
                        mew=0.6,
                        capsize=2.5,
                        lw=1.0,
                        zorder=4,
                    )
                    lit_handle = True
                xs.append(x)
                labels.append(f"{y}{'*' if part else ''}")
                items.append(
                    f"{data.names[site]} {y} {sig(r['kgHa'], 3)}"
                    + (f" (partial, coverage {fmt(r['coverage'])})" if part else "")
                )
                x += 1.0
            # site name below the group
            n = len(YEARS[site])
            ax.annotate(
                site_label(site, data),
                (x - 1.0 - (n - 1) / 2, 0),
                xycoords=("data", "axes fraction"),
                xytext=(0, -20),
                textcoords="offset points",
                ha="center",
                va="top",
                fontsize=6.5 * FONT_SCALE,
                fontweight="bold",
            )
            x += 0.6
        ax.set_xticks(xs)
        ax.set_xticklabels(labels, fontsize=5.5 * FONT_SCALE)
        ax.tick_params(axis="x", length=0)
        ax.set_xlim(xs[0] - 0.7, xs[-1] + 0.7)
        ax.set_ylim(0, ax.get_ylim()[1] * 1.12)
        unit = "CH$_4$" if gas == "ch4" else "N$_2$O"
        ax.set_ylabel(f"Annual {GAS_MATH[gas]} sum (kg {unit} ha$^{{-1}}$ yr$^{{-1}}$)")
        ax.set_title(GAS_MATH[gas], loc="left", fontweight="bold", pad=6)
        desc_parts.append(f"{GAS_LABEL[gas]}: " + "; ".join(items) + ".")
    for k, v in res["literatureCompare"].items():
        site, gas = k.split("_")
        desc_parts.append(
            f"Shurpali 2022 {data.names[site]} {GAS_LABEL[gas]}: {sig(v['literature'], 2)} "
            f"({sig(v['literatureLo'], 2)} to {sig(v['literatureHi'], 2)}); this dive "
            f"{sig(v['ours'], 3)}."
        )
    handles: list[Any] = []
    if lit_handle:
        handles.append(
            Line2D(
                [],
                [],
                color=LIT_COLOR,
                marker="D",
                ls="none",
                ms=4.5,
                label="Shurpali et al. 2025, Table 3 (2022, range)",
            )
        )
    handles.append(
        Patch(
            facecolor="#dddddd",
            edgecolor=GUIDE,
            hatch="///",
            label=f"* partial year (coverage < {PARTIAL_COVERAGE:.0%})",
        )
    )
    fig.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.53, 0.99),
        ncols=2,
        frameon=False,
    )
    fig.text(
        0.09,
        0.025,
        f"{SIGN_NOTE} Sum of the gap-filled 30-min values of the local calendar year (UTC+2).\n"
        "Viikki N$_2$O: the unit is an open question (finding VII-06).",
        fontsize=6 * FONT_SCALE,
    )
    vk = ann["viikki"]
    for gas in GASES:
        ratios = [
            ann[PEAT][str(y)][gas]["kgHa"] / ann[MINERAL][str(y)][gas]["kgHa"]
            for y in YEARS[PEAT]
        ]
        desc_parts.append(
            f"Ratio Särkisuo / Anttila of the annual {GAS_LABEL[gas]} sum: "
            + ", ".join(
                f"{y} {sig(r, 2)}" for y, r in zip(YEARS[PEAT], ratios, strict=True)
            )
            + " (Särkisuo 2022 is a partial year)."
        )
    desc_parts.append(
        "If the Viikki N2O unit is N2O-N (open finding VII-06, status: waits for provider), "
        "the Viikki bars are "
        f"{fmt(N2O_N_FACTOR)} times higher (2022: {sig(vk['2022']['n2o']['kgHaIfN2oN'], 3)})."
    )
    return fig, FIG4_TITLE, " ".join(desc_parts)


# ======================================================================================
# Provenance
# ======================================================================================
def git_info(cwd: Path) -> dict[str, Any]:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        return {"commit": commit, "dirty": bool(status.strip())}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": None, "dirty": None}


def svg_body_hash(path: Path) -> str:
    """SHA-256 of an SVG without its <metadata> block (the block holds the git commit)."""
    text = re.sub(
        r"<metadata>.*?</metadata>",
        "",
        path.read_text(encoding="utf-8"),
        flags=re.DOTALL,
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def data_version(
    args: argparse.Namespace, steps: dict[str, Any], script_dir: Path
) -> dict[str, Any]:
    script = script_dir / f"{SLUG}.py"
    lock = script_dir / f"{SLUG}.py.lock"
    packages = sorted(
        {
            (d.metadata["Name"] or "").lower(): d.version
            for d in importlib.metadata.distributions()
            if d.metadata["Name"]
        }.items()
    )
    return {
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "git": git_info(script_dir),
        "script": {"path": SCRIPT_PATH, "sha256": sha256_file(script)},
        "lock": {
            "path": f"analysis/{SLUG}/{SLUG}.py.lock",
            "sha256": sha256_file(lock) if lock.is_file() else None,
        },
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": dict(packages),
        "seeds": {"bootstrap": BOOT_SEED},
        "args": {
            "db": str(args.db),
            "out": str(args.out) if args.out else None,
            "check": args.check,
        },
        "dbBuiltAt": DATABASE["builtAt"],
        "calcBuiltAt": None,
        "snapshot": {
            **DATABASE,
            "inputs": [
                {"path": inp.key, "sha256": inp.sha256, "rows": inp.rows}
                for inp in INPUTS
            ],
        },
        "inputs": [
            {
                "path": inp.key,
                "sha256": inp.sha256,
                "rows": inp.rows,
                "builtAt": inp.built_at,
                "columns": list(inp.columns),
            }
            for inp in INPUTS
        ],
        "steps": steps,
    }


def method_json() -> dict[str, Any]:
    return {
        "sites": list(SITES),
        "gasSites": {g: list(s) for g, s in GAS_SITES.items()},
        "years": {s: list(y) for s, y in YEARS.items()},
        "units": {
            **EXPECTED_UNITS,
            "annual": {"ch4": "kg CH4 ha-1 yr-1", "n2o": "kg N2O ha-1 yr-1"},
            "dailyText": {"ch4": "mg CH4 m-2 d-1", "n2o": "mg N2O m-2 d-1"},
        },
        "molarMass": MOLAR_MASS,
        "n2oNFactor": N2O_N_FACTOR,
        "minValuesPerDay": MIN_VALUES_PER_DAY,
        "tBin": T_BIN,
        "wBin": W_BIN,
        "minBinDays": MIN_BIN_DAYS,
        "fitMinBins": FIT_MIN_BINS,
        "fitMinPositiveShare": FIT_MIN_POSITIVE_SHARE,
        "tRef": T_REF,
        "hacLags": HAC_LAGS,
        "partialCoverage": PARTIAL_COVERAGE,
        "blockDays": BLOCK_DAYS,
        "bootReps": BOOT_REPS,
        "bootSeed": BOOT_SEED,
        "findingNumbers": FINDING_NUMBERS,
        "fertDays": FERT_DAYS,
        "mapTBin": MAP_T_BIN,
        "mapWBin": MAP_W_BIN,
        "minCellDays": MIN_CELL_DAYS,
        "soil": SOIL,
        "timeBase": "local day = calendar day of ts_start + utc_offset_min (UTC+2); open finding "
        "ANT-01, SAR-01, VII-01: the true local day starts 2 h earlier",
        "signConvention": "flux > 0 = emission to the atmosphere",
        "rules": [
            line.strip()
            for line in (__doc__ or "")
            .split("METHOD", 1)[1]
            .split("DATABASE", 1)[0]
            .splitlines()
            if line.strip()
        ],
        "openFindings": list(OPEN_FINDINGS),
    }


# ======================================================================================
# Main
# ======================================================================================
def main(argv: Sequence[str] | None = None) -> int:
    script_dir = Path(__file__).resolve().parent
    p = argparse.ArgumentParser(
        description=__doc__.splitlines()[0] if __doc__ else SLUG
    )
    p.add_argument(
        "--db",
        type=Path,
        default=Path("db"),
        help="folder of the harmonised database (default: db)",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output folder (default: the folder of the script)",
    )
    p.add_argument(
        "--check",
        action="store_true",
        help="run, write to output/ and compare with the committed results.json",
    )
    args = p.parse_args(argv)
    out_dir = args.out if args.out else script_dir
    target = out_dir / "output" if args.check else out_dir
    (out_dir / "output").mkdir(parents=True, exist_ok=True)

    log.setLevel(logging.INFO)
    log.handlers.clear()
    fmt_ = logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s", "%Y-%m-%dT%H:%M:%S"
    )
    for h in (
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(out_dir / "output" / "run.log", mode="w", encoding="utf-8"),
    ):
        h.setFormatter(fmt_)
        log.addHandler(h)

    errors = check_inputs(args.db)
    if errors:
        for e in errors:
            log.error("input check: %s", e)
        return 3
    log.info(
        "inputs checked: %d files, SHA-256, built_at and row counts agree with INPUTS",
        len(INPUTS),
    )
    for note in OPEN_FINDINGS:
        log.info("note: %s", note)

    try:
        data = read_data(args.db)
        res = analyse(data)
    except InputError as e:
        log.error("input check: %s", e)
        return 3

    setup_matplotlib()
    emoji_glyph_filter()
    git = git_info(script_dir)
    meta = {
        "source": f"{SCRIPT_PATH} (git {git['commit']}{', dirty' if git['dirty'] else ''})",
        "relation": f"database snapshot {DATABASE['builtAt']}; "
        + "; ".join(f"{i.key} sha256 {i.sha256}" for i in INPUTS),
    }
    builders = {
        "temperature-response": fig_temperature,
        "water-response": fig_water,
        "temperature-water-map": fig_map,
        "peat-vs-mineral": fig_bars,
    }
    figures_json: list[dict[str, Any]] = []
    for n, name in FIGURES:
        fig, title, desc = builders[name](res, data)
        title, desc = plain_unicode(title), plain_unicode(desc)
        path = target / "figures" / f"{n}-{name}.svg"
        save_svg(fig, path, n, title, desc, meta)
        size = path.stat().st_size
        if size >= 1_000_000:
            raise RuntimeError(f"{path}: {size} bytes (limit 1 MB)")
        figures_json.append(
            {"n": n, "file": f"figures/{n}-{name}.svg", "title": title, "desc": desc}
        )
        log.info("figure %d: %s (%d bytes)", n, path, size)

    data.daily.to_csv(
        out_dir / "output" / "daily.csv", index=False, float_format="%.10g"
    )

    dv = data_version(args, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": (
            "How do soil temperature, soil water content and soil type (peat or mineral) relate "
            "to the CH4 and N2O fluxes at Anttila, Särkisuo and Viikki?"
        ),
        "method": method_json(),
        **res,
        "literature": list(LITERATURE),
        "literatureByKey": LIT,
        "figures": figures_json,
        "dataVersion": dv,
    }
    results = round_sig(results)
    res_path = target / "results.json"
    res_path.write_text(
        json.dumps(results, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    manifest = {
        **dv,
        "outputs": {
            "results.json": hashlib.sha256(res_path.read_bytes()).hexdigest(),
            "figures": {
                f["file"]: {
                    "sha256": sha256_file(target / f["file"]),
                    "sha256WithoutMetadata": svg_body_hash(target / f["file"]),
                }
                for f in figures_json
            },
        },
    }
    (target / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    log.info("wrote %s and %s", res_path, target / "manifest.json")

    if args.check:
        committed = out_dir / "results.json"
        if not committed.is_file():
            log.error("check: %s not found", committed)
            return 1
        diffs = compare(results, json.loads(committed.read_text(encoding="utf-8")))
        man_path = out_dir / "manifest.json"
        if man_path.is_file():
            old = json.loads(man_path.read_text(encoding="utf-8"))["outputs"]["figures"]
            for f in figures_json:
                if svg_body_hash(target / f["file"]) != old.get(f["file"], {}).get(
                    "sha256WithoutMetadata"
                ):
                    log.warning(
                        "check: %s differs from manifest.json (SHA-256 without <metadata>)",
                        f["file"],
                    )
        if diffs:
            for d in diffs[:50]:
                log.error("check: %s", d)
            log.error("check: %d differences", len(diffs))
            return 1
        log.info(
            "check: results agree with %s (rtol %g, atol %g)",
            committed,
            CHECK_RTOL,
            CHECK_ATOL,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
