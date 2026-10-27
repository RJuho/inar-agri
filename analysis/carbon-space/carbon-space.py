# /// script
# requires-python = "==3.13.*"
# dependencies = [
#     "matplotlib==3.11.2",
#     "numpy==2.5.4",
#     "pandas==3.1.0",
#     "pandera==0.34.1",
#     "pyarrow==26.0.0",
# ]
# ///
"""Site-years in carbon space: annual GPP, Reco and the share of uptake days.

QUESTION
    How do the management and the crop of a site-year show in the annual carbon balance (annual
    GPP against annual Reco) and in the share of days with net uptake?

METHOD
    Sites: Anttila, Sarkisuo, Haltiala, Qvidja, Viikki and Maktau (order of db/sites.parquet;
    the order gives the colour and the marker). A site-year is one site and one calendar year in
    local time (the years of data/calculated/annual.csv).
    1. Inclusion (the same rule in both figures): full_year and reliable are true in annual.csv.
       reliable = measured fraction >= 0.2 and longest gap <= 30 days (docs/calculated.md); the
       script checks that the flag agrees with these two limits. Figure 1 also needs an annual
       GPP and Reco sum (a sum is NULL when one half hour of the year has no value). The script
       derives the reason of each excluded site-year from the flags, in this order: "no flux
       data" (measured fraction 0); else each failed flag: "partial year", "measured fraction <
       0.2", "longest gap > 30 d"; else (Figure 1 only) "no annual GPP or Reco sum".
    2. Annual sums (g C m-2 yr-1) from annual.csv: GPP, Reco and NEE (gap-filled NEE, nee_f_gc).
       Reco/GPP = Reco / GPP. The script checks that each annual sum equals the sum of the daily
       values of data/calculated/daily.parquet over the local days of the year (relative
       difference <= 1e-6), and that a NULL annual sum has a daily gap.
    3. Uptake day = a local day with daily NEE (nee_f_gc) < 0. Share = uptake days / days with a
       daily NEE value, for the whole year and for June to August (JJA, calendar months 6 to 8 in
       local time, also at Maktau, where JJA is not the main growing season).
    3b. Peak-GPP window (Figure 3): 90 consecutive local days inside the calendar year of the
       site-year (the window does not cross the year end). Score = sum of the daily GPP (gpp_gc)
       over the days of the window with a value. A window is valid only when 80 or more of its 90
       days have a GPP value (PEAK_MIN_GPP_DAYS); the valid window with the largest score wins,
       and a tie goes to the earliest start. Share = uptake days / days with a daily NEE value in
       the window. Also stored: start and end date, GPP sum, GPP days, NEE days and the mean
       frac_measured of the window days. Without a valid window the value is null and Figure 3
       shows the whole-year bar only.
    4. Land use (CROPS, typed from the project notes in CLAUDE.md): group "grassland" or "annual
       crop". Haltiala 2023 (sown grass that failed) has the crop label "grass (failed)" and is in
       the group grassland. Events per site-year: the count per type of db/events.parquet in the
       calendar year of the event date.
    5. OLS line Reco = slope x GPP + intercept over the Figure 1 site-years (numpy.polyfit, degree
       1), with Pearson r and n; the same without Maktau. Descriptive only, n is small.
    6. Group summaries (grassland, annual crop): n, mean, SD (n - 1), min and max of NEE and
       Reco/GPP over the Figure 1 site-years, and of the uptake shares over the Figure 2
       site-years (whole year, June to August, peak-GPP window). A third summary gives the annual crops without Maktau (Finnish crops only).
    7. Each step that removes rows logs a count (results.json dataVersion.steps).
    8. Reference site SMEAR II Hyytiala (boreal Scots pine forest, rare management; Figures 4 and
       5): files of the SMEAR API in --smear (data/smear/hyytiala/README.md), 2020 to 2025.
       HYY_EDDY233.NEE (gap-filled, positive = emission) and HYY_EDDY233.GPP (positive) in
       umol CO2 m-2 s-1, Reco = NEE + GPP. The time stamps are local time (UTC+2 all year) and
       mark the start of the half hour (the first stamp of a file is 1 January 00:00, the last
       31 December 23:30). Daily sums use the same factor as the other sites (1800 s x 12.011e-6
       g C umol-1). A daily or annual sum is NULL when a half hour has no value. The measured
       fraction comes from HYY_EDDYMAST.F_c_270 (measured CO2 flux at 27 m; "NaN" or empty =
       missing): daily = measured half hours / 48, annual = measured half hours / all half
       hours; longest gap = the longest run of half hours without a measured value, in days.
       full year = all days of the year have 48 half hours; reliable = the rule of step 1. The
       inclusion rule, the uptake shares and the peak window are the same as for the other
       sites. Hyytiala is not in the groups grassland and annual crop; it is the group forest.
       It has no events.
    9. Open findings of docs/anomaly-data-report.md that touch this dive are printed
       (OPEN_FINDINGS). The script uses no literature value, thus it has no LITERATURE table.

DATABASE
    builtAt: 2026-10-23T19:03:07.928Z (db/report.json and Parquet key/value metadata built_at)
    calcBuiltAt: 2026-10-23T19:03:09.003Z (data/calculated/report.json and Parquet built_at)
    commit: 44ec98f (HEAD at build time; db/report.json does not record a commit)
    url: TODO: release asset db-2026-10-23.zip not yet published

INPUTS
    db/sites.parquet  sha256=9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59  rows=6  columns=site_id, code, name
    db/events.parquet  sha256=b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b  rows=114  columns=site_code, date, type, crop
    calculated/annual.csv  sha256=27bc79419cac31239082a2ea9cf61bfe1c099b891e8792e0d5f7460885a95abe  rows=33  columns=site_code, year, full_year, reliable, frac_measured, longest_gap_days, n_gpp, nee_f_gc, gpp_gc, reco_gc
    calculated/daily.parquet  sha256=fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9  rows=11209  columns=site_code, date_local, nee_f_gc, gpp_gc, reco_gc, frac_measured
    smear/HYY_EDDY233_NEE_GPP_2020.csv  sha256=75ec98c5586b7d3e4282b4cdc5a6c7ce0ae07d9e0b2230240eed33f215eb8d20  rows=17568  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDY233.GPP, HYY_EDDY233.NEE
    smear/HYY_EDDYMAST_F_c_270_2020.csv  sha256=fc377d3b61aefa5764c497ef1a80f27f6e04c9ad6b67efa8e1c543c4a8a1ebc2  rows=17568  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDYMAST.F_c_270
    smear/HYY_EDDY233_NEE_GPP_2021.csv  sha256=468e107389aa93b8d33a7e57623b1f3da6183df7f0eb440ce84204bb63af09a5  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDY233.GPP, HYY_EDDY233.NEE
    smear/HYY_EDDYMAST_F_c_270_2021.csv  sha256=5e8e6b9d11b32115216ab31253815b0a7171c73d9c4cd53e9cdf5b637ea11d8d  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDYMAST.F_c_270
    smear/HYY_EDDY233_NEE_GPP_2022.csv  sha256=4120ef19f3982225b8aab469df3e867c8322eebe8b769c0a6ff32da21edcdedb  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDY233.GPP, HYY_EDDY233.NEE
    smear/HYY_EDDYMAST_F_c_270_2022.csv  sha256=c3b23cd0252fc653c8dd190f0314810810a55888008bd0c3c4ef9625553db762  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDYMAST.F_c_270
    smear/HYY_EDDY233_NEE_GPP_2023.csv  sha256=cf4b22e4d6abe8ccf1a1b5eace6a8f2f7c336985373f5518ff7e17ec88a10914  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDY233.GPP, HYY_EDDY233.NEE
    smear/HYY_EDDYMAST_F_c_270_2023.csv  sha256=95c0784f87f26920b3e8cc65363e1405619804c4f55c9c5cacd9d224c09d440a  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDYMAST.F_c_270
    smear/HYY_EDDY233_NEE_GPP_2024.csv  sha256=2c856524d7c56aec62ff585c602b3065388c27811d18e46e0ddeecf6686aad5a  rows=17568  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDY233.GPP, HYY_EDDY233.NEE
    smear/HYY_EDDYMAST_F_c_270_2024.csv  sha256=b3ee919b973063b611bfe0105ae4b0ab52157a8bd7e19e33d501a8e2910a5af3  rows=17568  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDYMAST.F_c_270
    smear/HYY_EDDY233_NEE_GPP_2025.csv  sha256=55b088461ab9540cc64e639cad794bc841a485f3867409c25246d6e3c1d22508  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDY233.GPP, HYY_EDDY233.NEE
    smear/HYY_EDDYMAST_F_c_270_2025.csv  sha256=39818f87ca29f049156b33fe5936145b415db6b30765edfc1e8e3dc1cc2b4a1b  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDYMAST.F_c_270

OUTPUTS
    results.json                 all result numbers, figure captions and alt texts, dataVersion
    manifest.json                provenance of the run and SHA-256 of the outputs
    figures/1-carbon-space.svg   annual Reco against annual GPP, one marker per site-year
    figures/2-uptake-days.svg    share of uptake days per site-year, whole year and JJA
    figures/3-uptake-days-peak.svg  as Figure 2, second bar = the 90-day window with the largest GPP
    figures/4-carbon-space-forest.svg  Figure 1 plus the Hyytiala forest site-years
    figures/5-uptake-days-peak-forest.svg  Figure 3 plus the Hyytiala forest site-years
    output/run.log               run log (not in git)
    output/site-years.csv        all site-years with the numbers (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/carbon-space/carbon-space.py --db db --calculated data/calculated \
        --smear data/smear/hyytiala

NOTES
    The local days of Anttila, Sarkisuo and Viikki start at 02:00 true local time (open findings
    ANT-01, SAR-01, VII-01). The annual sums do not change much; the daily NEE of a day holds 2
    hours of the previous evening, which can move a day near 0 to the other side.
    GPP and Reco are model values of the night-time partitioning (docs/calculated.md). NEE is not
    the full carbon balance: the harvest is not in NEE (NECB in data/calculated/necb.csv).
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
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pandera.pandas as pa
import pyarrow.parquet as pq
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

SLUG = "carbon-space"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"
SVG_ID_PREFIX = "cs"

DATABASE: dict[str, str | None] = {
    "builtAt": "2026-10-23T19:03:07.928Z",
    "calcBuiltAt": "2026-10-23T19:03:09.003Z",
    "commit": "44ec98f",
    "commitNote": "HEAD at build time; db/report.json does not record a commit",
    "url": None,
    "urlNote": "TODO: release asset db-2026-10-23.zip not yet published",
}


@dataclass(frozen=True)
class InputFile:
    """One input file. `root` is "db", "calculated" or "smear" (--db, --calculated, --smear).
    A CSV file has no built_at (None); its rows are the data lines after the header."""

    root: str
    file: str
    sha256: str
    rows: int
    columns: tuple[str, ...]
    built_at: str | None

    @property
    def key(self) -> str:
        return f"{self.root}/{self.file}"

    @property
    def is_parquet(self) -> bool:
        return self.file.endswith(".parquet")


INPUTS: tuple[InputFile, ...] = (
    InputFile(
        "db",
        "sites.parquet",
        "9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59",
        6,
        ("site_id", "code", "name"),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "db",
        "events.parquet",
        "b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b",
        114,
        ("site_code", "date", "type", "crop"),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "calculated",
        "annual.csv",
        "27bc79419cac31239082a2ea9cf61bfe1c099b891e8792e0d5f7460885a95abe",
        33,
        (
            "site_code",
            "year",
            "full_year",
            "reliable",
            "frac_measured",
            "longest_gap_days",
            "n_gpp",
            "nee_f_gc",
            "gpp_gc",
            "reco_gc",
        ),
        None,
    ),
    InputFile(
        "calculated",
        "daily.parquet",
        "fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9",
        11209,
        ("site_code", "date_local", "nee_f_gc", "gpp_gc", "reco_gc", "frac_measured"),
        "2026-10-23T19:03:09.003Z",
    ),
    InputFile(
        "smear",
        "HYY_EDDY233_NEE_GPP_2020.csv",
        "75ec98c5586b7d3e4282b4cdc5a6c7ce0ae07d9e0b2230240eed33f215eb8d20",
        17568,
        (
            "Year",
            "Month",
            "Day",
            "Hour",
            "Minute",
            "Second",
            "HYY_EDDY233.GPP",
            "HYY_EDDY233.NEE",
        ),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDYMAST_F_c_270_2020.csv",
        "fc377d3b61aefa5764c497ef1a80f27f6e04c9ad6b67efa8e1c543c4a8a1ebc2",
        17568,
        ("Year", "Month", "Day", "Hour", "Minute", "Second", "HYY_EDDYMAST.F_c_270"),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDY233_NEE_GPP_2021.csv",
        "468e107389aa93b8d33a7e57623b1f3da6183df7f0eb440ce84204bb63af09a5",
        17520,
        (
            "Year",
            "Month",
            "Day",
            "Hour",
            "Minute",
            "Second",
            "HYY_EDDY233.GPP",
            "HYY_EDDY233.NEE",
        ),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDYMAST_F_c_270_2021.csv",
        "5e8e6b9d11b32115216ab31253815b0a7171c73d9c4cd53e9cdf5b637ea11d8d",
        17520,
        ("Year", "Month", "Day", "Hour", "Minute", "Second", "HYY_EDDYMAST.F_c_270"),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDY233_NEE_GPP_2022.csv",
        "4120ef19f3982225b8aab469df3e867c8322eebe8b769c0a6ff32da21edcdedb",
        17520,
        (
            "Year",
            "Month",
            "Day",
            "Hour",
            "Minute",
            "Second",
            "HYY_EDDY233.GPP",
            "HYY_EDDY233.NEE",
        ),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDYMAST_F_c_270_2022.csv",
        "c3b23cd0252fc653c8dd190f0314810810a55888008bd0c3c4ef9625553db762",
        17520,
        ("Year", "Month", "Day", "Hour", "Minute", "Second", "HYY_EDDYMAST.F_c_270"),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDY233_NEE_GPP_2023.csv",
        "cf4b22e4d6abe8ccf1a1b5eace6a8f2f7c336985373f5518ff7e17ec88a10914",
        17520,
        (
            "Year",
            "Month",
            "Day",
            "Hour",
            "Minute",
            "Second",
            "HYY_EDDY233.GPP",
            "HYY_EDDY233.NEE",
        ),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDYMAST_F_c_270_2023.csv",
        "95c0784f87f26920b3e8cc65363e1405619804c4f55c9c5cacd9d224c09d440a",
        17520,
        ("Year", "Month", "Day", "Hour", "Minute", "Second", "HYY_EDDYMAST.F_c_270"),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDY233_NEE_GPP_2024.csv",
        "2c856524d7c56aec62ff585c602b3065388c27811d18e46e0ddeecf6686aad5a",
        17568,
        (
            "Year",
            "Month",
            "Day",
            "Hour",
            "Minute",
            "Second",
            "HYY_EDDY233.GPP",
            "HYY_EDDY233.NEE",
        ),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDYMAST_F_c_270_2024.csv",
        "b3ee919b973063b611bfe0105ae4b0ab52157a8bd7e19e33d501a8e2910a5af3",
        17568,
        ("Year", "Month", "Day", "Hour", "Minute", "Second", "HYY_EDDYMAST.F_c_270"),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDY233_NEE_GPP_2025.csv",
        "55b088461ab9540cc64e639cad794bc841a485f3867409c25246d6e3c1d22508",
        17520,
        (
            "Year",
            "Month",
            "Day",
            "Hour",
            "Minute",
            "Second",
            "HYY_EDDY233.GPP",
            "HYY_EDDY233.NEE",
        ),
        None,
    ),
    InputFile(
        "smear",
        "HYY_EDDYMAST_F_c_270_2025.csv",
        "39818f87ca29f049156b33fe5936145b415db6b30765edfc1e8e3dc1cc2b4a1b",
        17520,
        ("Year", "Month", "Day", "Hour", "Minute", "Second", "HYY_EDDYMAST.F_c_270"),
        None,
    ),
)

# Units. daily.parquet and annual.csv have no unit field. The key/value metadata "constants" of
# daily.parquet gives hhToGc, the factor from one 30-min value in umol CO2 m-2 s-1 to g C m-2
# (1800 s x 12.011e-6 g C umol-1). The script checks this factor: then a daily sum is in
# g C m-2 d-1 and an annual sum in g C m-2 yr-1.
DAILY_UNIT = "g C m-2 d-1"
ANNUAL_UNIT = "g C m-2 yr-1"
EXPECTED_UNITS = {"hhToGc": 0.0216198}
HH_TO_GC_RTOL = 1e-6

# ---------- Method constants ----------
ALL_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
EVENT_TYPES = (
    "harvest",
    "cut",
    "grazing",
    "tillage",
    "sowing",
    "fertilisation",
    "spraying",
    "other",
)
MIN_FRAC = 0.2  # reliable: measured fraction >= MIN_FRAC (docs/calculated.md)
MAX_GAP_DAYS = 30.0  # reliable: longest gap <= MAX_GAP_DAYS
JJA = (6, 7, 8)
PEAK_DAYS = 90  # length of the peak-GPP window (local days)
PEAK_MIN_GPP_DAYS = 80  # a valid window has GPP on this many of its days or more
GROUPS = ("grassland", "annual crop")
# Reference site (not in the harmonised database): SMEAR II Hyytiala.
REF_SITE = "hyytiala"
REF_NAME = "Hyytiälä"
REF_SOURCE = "SMEAR II, HYY_EDDY233"
REF_GROUP = "forest"
REF_CROP = ("boreal forest", REF_GROUP, None)
REF_YEARS = tuple(range(2020, 2026))
REF_FLUX_COLS = ("HYY_EDDY233.GPP", "HYY_EDDY233.NEE")
REF_MEAS_COL = "HYY_EDDYMAST.F_c_270"
REF_TIME_COLS = ("Year", "Month", "Day", "Hour", "Minute", "Second")
HH_TO_GC = 1800 * 12.011e-6  # g C m-2 per 30-min value of 1 umol CO2 m-2 s-1
HALF_HOURS_PER_DAY = 48
REASONS = (
    "no flux data",
    "partial year",
    "measured fraction < 0.2",
    "longest gap > 30 d",
    "no annual GPP or Reco sum",
)
SUM_RTOL = 1e-6
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-9

# Land use per site-year, typed from the project notes (CLAUDE.md, list of the sites):
# (crop, group, label crop). "label crop" is the text after the year in the Figure 1 label and
# below the year in Figure 2; None = the year only (a permanent grassland). The unit test
# compares the crop with the crop field of the sowing and harvest events (CROP_EVENT_PATTERNS).
SITE_CROP = {
    "anttila": "legume grassland",
    "sarkisuo": "mixed grasses",
    "qvidja": "forage grassland",
    "maktau": "maize",
}
CROPS: dict[tuple[str, int], tuple[str, str, str | None]] = {
    ("haltiala", 2021): ("barley", "annual crop", "barley"),
    ("haltiala", 2022): ("oats", "annual crop", "oats"),
    ("haltiala", 2023): ("grass (failed)", "grassland", "grass (failed)"),
    ("haltiala", 2024): ("sunflower", "annual crop", "sunflower"),
    ("haltiala", 2025): ("oats", "annual crop", "oats"),
    ("viikki", 2022): ("timothy", "grassland", None),
    ("viikki", 2023): ("barley / mixed grass / red clover", "annual crop", "barley"),
    ("viikki", 2024): ("grassland", "grassland", None),
    ("viikki", 2025): ("faba bean", "annual crop", "faba bean"),
}
for _y in range(2014, 2026):
    CROPS[("maktau", _y)] = ("maize", "annual crop", "maize")
for _s, _years in (
    ("anttila", (2022, 2023)),
    ("sarkisuo", (2022, 2023)),
    ("qvidja", range(2018, 2026)),
):
    for _y in _years:
        CROPS[(_s, _y)] = (SITE_CROP[_s], "grassland", None)
# A sowing or harvest event of the site-year names the crop when its crop field matches.
CROP_EVENT_PATTERNS = {
    "legume grassland": r"legume",
    "mixed grasses": r"mixed grass",
    "forage grassland": r"silage|grass",
    "barley": r"barley",
    "oats": r"oats",
    "grass (failed)": r"grass",
    "sunflower": r"sunflower",
    "timothy": r"timothy",
    "barley / mixed grass / red clover": r"barley",
    "grassland": r"grass",
    "faba bean": r"faba",
    "maize": r"maize",
}

OPEN_FINDINGS = (
    (
        "ANT-01, SAR-01, VII-01 (open, waits for the providers): the raw stamps of Anttila, Sarkisuo and "
        "Viikki are UTC, but the build reads them as UTC+2. A local day of these sites thus holds the "
        "hours 02:00 to 02:00 true local time. The annual sums change by the 2 hours at the ends of "
        "the year only; a daily NEE near 0 can change its sign, so the uptake-day share can change a "
        "little."
    ),
    (
        "QVI-11 (open question): the Qvidja annual NEE of the file is 40 to 110 g C m-2 more negative "
        "than Heimsch 2024 Table 1 (May-to-May years). The Qvidja markers can thus sit a little too far "
        "below the 1:1 line."
    ),
    (
        "VII-05 (open): Viikki 2024 nee_f is not equal to nee in 1 540 periods. The daily NEE of "
        "Viikki 2024 can thus differ from the measured values."
    ),
)

# ---------- Figures ----------
FONT_STACK = (
    "system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', "
    "'Noto Color Emoji'"
)
FONT_SCALE = 1.5  # fonts for slides: 1.5 x the dive default
# Site colour and marker: the slot of the site in db/sites.parquet, as siteColors() and
# siteSymbol() in site/src/scripts/diagrams/common.ts (Okabe-Ito). The pentagon "p" stands for
# roundRect, the "v" triangle for pin (as Deep Dive #8).
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
SITE_MARKERS = ("o", "s", "^", "D", "p", "v")
INK = "#222222"
GUIDE = "#888888"
GUIDE_TEXT = "#555555"
LINE_WIDTH = 2.2
MARKER_SIZE = 13
MARKER_EDGE = 0.8  # white edge line that separates touching markers
# Figure 1 draw order: the Haltiala triangle is on top of the larger Qvidja diamond
# (Haltiala 2025 and Qvidja 2024 touch). Labels have zorder 4.
MARKER_ZORDER = {"haltiala": 3.5}
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
FIG1_HEIGHT_IN = 150 * MM
FIG2_HEIGHT_IN = 100 * MM
FIG5_HEIGHT_IN = 110 * MM
# Figure 2 slots: a crop word longer than SLOT_CHARS widens its slot by SLOT_PER_CHAR per
# character, so that the crop words below the years do not overlap. SITE_GAP = space between sites.
SLOT_CHARS = 5
SLOT_PER_CHAR = 0.2
SITE_GAP = 0.4
FIGURES = (
    (1, "carbon-space"),
    (2, "uptake-days"),
    (3, "uptake-days-peak"),
    (4, "carbon-space-forest"),
    (5, "uptake-days-peak-forest"),
)
# Style of the reference site: Okabe-Ito bluish green and a star (not a slot of sites.parquet).
REF_COLOR = "#009e73"
REF_MARKER = "*"
REF_MARKER_SIZE = 19
REF_LEGEND = "Hyytiälä\n(forest)"
AXIS_STEP = 100.0  # g C m-2 yr-1; the axis range of Figure 1 is a multiple of this
AXIS_PAD = 120.0  # g C m-2 yr-1 of free space around the markers
NEE_GUIDES = (-200.0, -400.0)
X_LABEL_1 = r"Annual GPP (g C m$^{-2}$ yr$^{-1}$)"
Y_LABEL_1 = r"Annual Reco (g C m$^{-2}$ yr$^{-1}$)"
Y_LABEL_2 = "Days with net uptake (%)"
FIG1_TITLE = (
    "Annual ecosystem respiration (Reco) against annual gross primary production (GPP), "
    "one marker per site-year; below the 1:1 line the site-year was a net CO2 sink."
)
FIG4_TITLE = (
    "Annual Reco against annual GPP, one marker per site-year, with the SMEAR II Hyytiälä "
    "forest (rare management) as a reference; below the 1:1 line the site-year was a net CO2 "
    "sink."
)
FIG5_TITLE = (
    "Share of days with net CO2 uptake (daily NEE < 0) per site-year, over the whole year "
    "and over the 90-day window with the largest GPP sum, with the SMEAR II Hyytiälä forest "
    "as a reference."
)
FIG3_TITLE = (
    "Share of days with net CO2 uptake (daily NEE < 0) per site-year, over the whole year "
    "and over the 90-day window with the largest GPP sum of the year."
)
FIG2_TITLE = (
    "Share of days with net CO2 uptake (daily NEE < 0) per site-year, over the whole year "
    "and over June to August."
)
# Offset of the Figure 1 label from its marker, in points (dx, dy), and the horizontal
# alignment. Set by hand after a look at the figure, so that no labels overlap.
LABEL_OFFSETS: dict[str, tuple[float, float, str]] = {
    "anttila-2022": (11, 0, "left"),
    "anttila-2023": (11, 0, "left"),
    "sarkisuo-2022": (11, -7, "left"),
    "haltiala-2022": (11, 0, "left"),
    "haltiala-2023": (-11, 0, "right"),
    "haltiala-2024": (11, 0, "left"),
    "haltiala-2025": (0, -16, "center"),
    "qvidja-2020": (0, 16, "center"),
    "qvidja-2022": (0, -16, "center"),
    "qvidja-2023": (-11, 0, "right"),
    "qvidja-2024": (0, 16, "center"),
    "qvidja-2025": (-11, 0, "right"),
    "viikki-2024": (11, -8, "left"),
    "viikki-2025": (-11, 0, "right"),
    "maktau-2019": (11, 0, "left"),
}
# Figure 4: the Hyytiala markers form a cluster near Anttila. Offsets of Figure 4 that differ
# from LABEL_OFFSETS, and the Hyytiala labels.
# Only 2020 (the source year) and the cluster 2021 to 2025 get a label; the other Hyytiala
# markers have none (the values are in the alt text and in results.json).
LABEL_OFFSETS_FOREST: dict[str, tuple[float, float, str]] = {
    "hyytiala-2020": (-10, 12, "right"),
    "hyytiala-2025": (12, -14, "left"),
}
LABEL_TEXT_FOREST = {"hyytiala-2025": "2021–2025"}
# The Hyytiala stars are drawn below the markers of the six sites (they are the reference).
REF_ZORDER = 2.5
# Labels in two lines (break before the bracket).
WRAP_LABELS = frozenset({"haltiala-2023"})

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


def csv_data_rows(path: Path) -> int:
    """Number of data lines of a CSV file (the lines after the header line)."""
    with path.open("rb") as f:
        return sum(1 for _ in f) - 1


def input_path(inp: InputFile, db: Path, calculated: Path, smear: Path) -> Path:
    return {"db": db, "calculated": calculated, "smear": smear}[inp.root] / inp.file


def check_inputs(db: Path, calculated: Path, smear: Path) -> list[str]:
    """Check each input: exists, SHA-256, Parquet built_at, row count. Returns the error list."""
    errors: list[str] = []
    for inp in INPUTS:
        path = input_path(inp, db, calculated, smear)
        if not path.is_file():
            errors.append(f"{inp.key}: file not found at {path}")
            continue
        digest = sha256_file(path)
        if digest != inp.sha256:
            errors.append(f"{inp.key}: SHA-256 expected {inp.sha256}, actual {digest}")
        if inp.is_parquet:
            meta = pq.read_metadata(path)
            kv = {k.decode(): v.decode() for k, v in (meta.metadata or {}).items()}
            built = kv.get("built_at")
            if built != inp.built_at:
                errors.append(
                    f"{inp.key}: built_at expected {inp.built_at}, actual {built}"
                )
            rows = meta.num_rows
        else:
            rows = csv_data_rows(path)
        if rows != inp.rows:
            errors.append(f"{inp.key}: rows expected {inp.rows}, actual {rows}")
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
        return {k: round_sig(v, digits) for k, v in x.items()}
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


def nice_range(
    lo: float, hi: float, step: float = AXIS_STEP, pad: float = AXIS_PAD
) -> list[float]:
    """[lo - pad, hi + pad] rounded outwards to a multiple of `step`."""
    a = math.floor((lo - pad) / step) * step
    b = math.ceil((hi + pad) / step) * step
    return [float(a), float(b)]


def num_or_none(v: Any) -> float | None:
    if v is None:
        return None
    f = float(v)
    return None if math.isnan(f) else f


def site_year_key(site: str, year: int) -> str:
    return f"{site}-{year}"


def exclusion_reasons(
    frac_measured: float,
    full_year: bool,
    longest_gap_days: float,
    has_sums: bool,
    figure: int,
) -> list[str]:
    """The reasons why a site-year is not in Figure `figure` (empty list = included)."""
    if frac_measured == 0:
        return ["no flux data"]
    out: list[str] = []
    if not full_year:
        out.append("partial year")
    if frac_measured < MIN_FRAC:
        out.append("measured fraction < 0.2")
    if longest_gap_days > MAX_GAP_DAYS:
        out.append("longest gap > 30 d")
    if not out and figure == 1 and not has_sums:
        out.append("no annual GPP or Reco sum")
    return out


def reliable_rule(frac_measured: float, longest_gap_days: float) -> bool:
    """The reliable flag of annual.csv (docs/calculated.md)."""
    return frac_measured >= MIN_FRAC and longest_gap_days <= MAX_GAP_DAYS


def uptake_share(nee: Sequence[float | None]) -> dict[str, Any]:
    """Share of days with NEE < 0 among the days with a value."""
    v = np.array([np.nan if x is None else x for x in nee], dtype=float)
    v = v[np.isfinite(v)]
    n = int(v.size)
    k = int((v < 0).sum())
    return {"days": n, "uptakeDays": k, "share": (k / n) if n else None}


def sum_check(annual: float | None, daily: Sequence[float | None]) -> dict[str, Any]:
    """Compare one annual sum with its daily values. A NULL annual sum must have a daily gap."""
    v = np.array([np.nan if x is None else x for x in daily], dtype=float)
    has_gap = bool(np.isnan(v).any()) or v.size == 0
    if annual is None:
        return {"ok": has_gap, "relDiff": None, "dailyGap": has_gap}
    if has_gap:
        return {"ok": False, "relDiff": None, "dailyGap": True}
    s = float(v.sum())
    rel = abs(s - annual) / max(abs(annual), 1e-12)
    return {"ok": rel <= SUM_RTOL, "relDiff": rel, "dailyGap": False}


def peak_window(
    dates: Sequence[date],
    gpp: Sequence[float | None],
    nee: Sequence[float | None],
    frac: Sequence[float | None],
    window: int = PEAK_DAYS,
    min_days: int = PEAK_MIN_GPP_DAYS,
) -> dict[str, Any] | None:
    """The `window`-day run of consecutive days with the largest GPP sum (days with a value).

    The input is one calendar year, one value per consecutive day. A window is valid when
    `min_days` or more of its days have a GPP value; a tie goes to the earliest start.
    Returns None when no window is valid."""
    g = np.array([np.nan if x is None else x for x in gpp], dtype=float)
    n_days = g.size
    best: tuple[float, int] | None = None
    for i in range(n_days - window + 1):
        w = g[i : i + window]
        ok = np.isfinite(w)
        if int(ok.sum()) < min_days:
            continue
        score = float(w[ok].sum())
        if best is None or score > best[0]:
            best = (score, i)
    if best is None:
        return None
    score, i = best
    sl = slice(i, i + window)
    share = uptake_share(list(nee[sl]))
    fr = np.array([np.nan if x is None else x for x in frac[sl]], dtype=float)
    return {
        **share,
        "start": dates[i].isoformat(),
        "end": dates[i + window - 1].isoformat(),
        "gppSum": score,
        "gppDays": int(np.isfinite(g[sl]).sum()),
        "fracMeasured": float(np.nanmean(fr)) if np.isfinite(fr).any() else None,
    }


def year_days(d: pd.DataFrame, year: int) -> pd.DataFrame:
    """The daily rows of one site-year on all calendar days (a missing day has NaN values)."""
    days = pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D").date
    idx = d.set_index("date_local")
    return frame(idx.reindex(list(days)).rename_axis("date_local").reset_index())


def ols(x: Sequence[float], y: Sequence[float]) -> dict[str, Any]:
    """OLS line y = slope x + intercept, Pearson r and n."""
    xa, ya = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    slope, intercept = np.polyfit(xa, ya, 1)
    r = float(np.corrcoef(xa, ya)[0, 1])
    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "r": r,
        "r2": r * r,
        "n": int(xa.size),
    }


def plain_stats(values: Iterable[float | None]) -> dict[str, Any]:
    v = np.array([x for x in values if x is not None], dtype=float)
    n = int(v.size)
    return {
        "n": n,
        "mean": float(v.mean()) if n else None,
        "sd": float(v.std(ddof=1)) if n >= 2 else None,
        "min": float(v.min()) if n else None,
        "max": float(v.max()) if n else None,
    }


def crop_label(site: str, year: int) -> str | None:
    return CROPS[(site, year)][2]


# ======================================================================================
# Read
# ======================================================================================
EVENTS_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(ALL_SITES)),
        "date": pa.Column(object),
        "type": pa.Column(str, pa.Check.isin(EVENT_TYPES)),
        "crop": pa.Column(object, nullable=True),
    },
    strict=True,
)
ANNUAL_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(ALL_SITES)),
        "year": pa.Column(int, pa.Check.in_range(2014, 2025)),
        "full_year": pa.Column(bool),
        "reliable": pa.Column(bool),
        "frac_measured": pa.Column(float, pa.Check.in_range(0, 1)),
        "longest_gap_days": pa.Column(float, pa.Check.ge(0)),
        "n_gpp": pa.Column(int, pa.Check.ge(0)),
        "nee_f_gc": pa.Column(float, nullable=True),
        "gpp_gc": pa.Column(float, nullable=True),
        "reco_gc": pa.Column(float, nullable=True),
    },
    strict=True,
    unique=["site_code", "year"],
)
DAILY_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(ALL_SITES)),
        "date_local": pa.Column(object),
        "nee_f_gc": pa.Column(float, nullable=True),
        "gpp_gc": pa.Column(float, nullable=True),
        "reco_gc": pa.Column(float, nullable=True),
        "frac_measured": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
    },
    strict=True,
    unique=["site_code", "date_local"],
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


def columns_of(key: str) -> list[str]:
    return list(next(i for i in INPUTS if i.key == key).columns)


@dataclass
class Data:
    names: dict[str, str]
    slots: dict[str, int]
    events: pd.DataFrame
    annual: pd.DataFrame
    daily: pd.DataFrame
    ref_daily: pd.DataFrame
    ref_annual: pd.DataFrame
    steps: dict[str, Any]


def read_sites(db: Path) -> dict[str, str]:
    sites = pd.read_parquet(
        db / "sites.parquet", columns=columns_of("db/sites.parquet"), engine="pyarrow"
    )
    sites = sites.sort_values("site_id").reset_index(drop=True)
    sites["code"] = sites["code"].astype(str)
    if tuple(sites["code"]) != ALL_SITES:
        raise InputError(
            f"sites.parquet: expected the sites {ALL_SITES}, got {tuple(sites['code'])}"
        )
    return dict(zip(sites["code"], sites["name"].astype(str), strict=True))


def read_events(db: Path, steps: dict[str, Any]) -> pd.DataFrame:
    ev = pd.read_parquet(
        db / "events.parquet", columns=columns_of("db/events.parquet"), engine="pyarrow"
    )
    ev["site_code"] = ev["site_code"].astype(str)
    ev["type"] = ev["type"].astype(str)
    ev["date"] = pd.to_datetime(ev["date"]).dt.date
    ev["crop"] = ev["crop"].astype(object).where(ev["crop"].notna(), None)
    ev = pd.DataFrame(EVENTS_SCHEMA.validate(ev))
    ev["year"] = [d.year for d in col(ev, "date")]
    steps["events"] = {
        "rowsRead": len(ev),
        "rule": "all events; counted per site, calendar year of the event date and type",
    }
    log.info("events: %d rows read", len(ev))
    return ev


def read_annual(calculated: Path, steps: dict[str, Any]) -> pd.DataFrame:
    df = pd.read_csv(
        calculated / "annual.csv",
        usecols=columns_of("calculated/annual.csv"),
        encoding="utf-8",
    )
    df["site_code"] = df["site_code"].astype(str)
    df = pd.DataFrame(ANNUAL_SCHEMA.validate(df))
    bad = [
        f"{r['site_code']} {r['year']}"
        for r in df.to_dict("records")
        if bool(r["reliable"])
        != reliable_rule(float(r["frac_measured"]), float(r["longest_gap_days"]))
    ]
    if bad:
        raise InputError(f"annual.csv: reliable flag disagrees with the rule: {bad}")
    steps["annual"] = {
        "rowsRead": len(df),
        "rule": "one row per site and local calendar year; the reliable flag agrees with "
        f"frac_measured >= {MIN_FRAC} and longest_gap_days <= {MAX_GAP_DAYS:g}",
    }
    log.info("annual: %d site-years read; reliable flag agrees with the rule", len(df))
    return df


def read_daily(calculated: Path, steps: dict[str, Any]) -> pd.DataFrame:
    path = calculated / "daily.parquet"
    kv = {
        k.decode(): v.decode()
        for k, v in (pq.read_metadata(path).metadata or {}).items()
    }
    hh = json.loads(kv.get("constants", "{}")).get("hhToGc")
    if hh is None or not math.isclose(
        float(hh), EXPECTED_UNITS["hhToGc"], rel_tol=HH_TO_GC_RTOL
    ):
        raise InputError(
            f"daily.parquet: constants.hhToGc expected {EXPECTED_UNITS['hhToGc']}, actual {hh}"
        )
    daily = pd.read_parquet(
        path, columns=columns_of("calculated/daily.parquet"), engine="pyarrow"
    )
    daily["site_code"] = daily["site_code"].astype(str)
    daily["date_local"] = pd.to_datetime(daily["date_local"]).dt.date
    daily = pd.DataFrame(DAILY_SCHEMA.validate(daily))
    daily["year"] = [d.year for d in col(daily, "date_local")]
    daily["month"] = [d.month for d in col(daily, "date_local")]
    steps["daily"] = {
        "rowsRead": len(daily),
        "rowsWithoutNee": int(col(daily, "nee_f_gc").isna().sum()),
        "rule": "one row per site and local day; a day without daily NEE is not counted in "
        "the uptake share",
    }
    log.info(
        "daily: %d rows read (%d without daily NEE); hhToGc %g: daily sums in %s",
        len(daily),
        steps["daily"]["rowsWithoutNee"],
        float(hh),
        DAILY_UNIT,
    )
    return daily


def longest_run(missing: np.ndarray) -> int:
    """Length of the longest run of True values."""
    best = run = 0
    for m in missing:
        run = run + 1 if m else 0
        best = max(best, run)
    return best


def hyytiala_tables(
    flux: pd.DataFrame, meas: pd.DataFrame, year: int
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Daily table and annual row of one Hyytiala year from the 30-min rows of the two files.

    `flux` has the columns ts, nee, gpp (umol m-2 s-1); `meas` has ts, fc. ts = local period
    start. A daily or annual sum is NaN when a half hour has no value."""
    hh = flux.merge(meas, on="ts", how="outer", validate="one_to_one").sort_values("ts")
    hh["reco"] = hh["nee"] + hh["gpp"]
    hh["date_local"] = hh["ts"].dt.date
    days = pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D").date

    def day_sum(c: pd.Series) -> float:
        return float(c.sum()) * HH_TO_GC if c.notna().all() else math.nan

    g = hh.groupby("date_local")
    daily = pd.DataFrame(
        {
            "nee_f_gc": g["nee"].agg(day_sum),
            "gpp_gc": g["gpp"].agg(day_sum),
            "reco_gc": g["reco"].agg(day_sum),
            "frac_measured": g["fc"].agg(
                lambda c: c.notna().sum() / HALF_HOURS_PER_DAY
            ),
            "n": g["nee"].size(),
        }
    ).reindex(list(days))
    daily = daily.rename_axis("date_local").reset_index()
    daily["site_code"] = REF_SITE
    daily["year"] = year
    daily["month"] = [d.month for d in col(daily, "date_local")]
    full_year = (
        bool((col(daily, "n") == HALF_HOURS_PER_DAY).all())
        and len(hh) == len(days) * HALF_HOURS_PER_DAY
    )

    def year_sum(c: str) -> float | None:
        v = col(daily, c)
        return float(v.sum()) if v.notna().all() else None

    measured = col(hh, "fc").notna().to_numpy()
    frac = float(measured.sum() / len(hh))
    gap = longest_run(~measured) / HALF_HOURS_PER_DAY
    annual = {
        "site_code": REF_SITE,
        "year": year,
        "full_year": full_year,
        "reliable": reliable_rule(frac, gap),
        "frac_measured": frac,
        "longest_gap_days": gap,
        "n_gpp": int(col(hh, "gpp").notna().sum()),
        "nee_f_gc": year_sum("nee_f_gc"),
        "gpp_gc": year_sum("gpp_gc"),
        "reco_gc": year_sum("reco_gc"),
    }
    return frame(daily.drop(columns=["n"])), annual


def read_smear_csv(path: Path, value_cols: tuple[str, ...]) -> pd.DataFrame:
    """One SMEAR API CSV with the local time stamp `ts`. Checks the header and the 30-min axis."""
    df = pd.read_csv(path, na_values=["NaN", ""], keep_default_na=False)
    if tuple(df.columns) != REF_TIME_COLS + value_cols:
        raise InputError(f"{path.name}: header {tuple(df.columns)}")
    t = df[list(REF_TIME_COLS)].to_numpy(dtype=np.int64)
    ymd = t[:, 0] * 10000 + t[:, 1] * 100 + t[:, 2]
    secs = t[:, 3] * 3600 + t[:, 4] * 60 + t[:, 5]
    ts = pd.Series(
        pd.to_datetime(ymd.astype(str), format="%Y%m%d")
        + pd.to_timedelta(secs, unit="s")
    )
    year = int(t[0, 0])
    expected = pd.date_range(f"{year}-01-01 00:00", f"{year}-12-31 23:30", freq="30min")
    if len(ts) != len(expected) or not (ts.to_numpy() == expected.to_numpy()).all():
        raise InputError(
            f"{path.name}: the time axis is not 30-min steps over the year"
        )
    out = pd.DataFrame({"ts": ts})
    for c in value_cols:
        out[c] = pd.Series(pd.to_numeric(col(df, c), errors="raise"), dtype=float)
    return out


def read_hyytiala(
    smear: Path, steps: dict[str, Any]
) -> tuple[pd.DataFrame, pd.DataFrame]:
    dailies: list[pd.DataFrame] = []
    annual: list[dict[str, Any]] = []
    per_year: dict[str, Any] = {}
    for y in REF_YEARS:
        f = read_smear_csv(smear / f"HYY_EDDY233_NEE_GPP_{y}.csv", REF_FLUX_COLS)
        m = read_smear_csv(smear / f"HYY_EDDYMAST_F_c_270_{y}.csv", (REF_MEAS_COL,))
        n_nee = int(col(f, "HYY_EDDY233.NEE").isna().sum())
        n_gpp = int(col(f, "HYY_EDDY233.GPP").isna().sum())
        n_meas = int(col(m, REF_MEAS_COL).notna().sum())
        flux = pd.DataFrame(
            {"ts": f["ts"], "nee": f["HYY_EDDY233.NEE"], "gpp": f["HYY_EDDY233.GPP"]}
        )
        meas = pd.DataFrame({"ts": m["ts"], "fc": m[REF_MEAS_COL]})
        d, a = hyytiala_tables(flux, meas, y)
        dailies.append(d)
        annual.append(a)
        per_year[str(y)] = {
            "halfHours": len(f),
            "neeMissing": n_nee,
            "gppMissing": n_gpp,
            "measuredHalfHours": n_meas,
        }
        log.info(
            "hyytiala %d: %d half hours, NEE missing %d, GPP missing %d, measured F_c %d "
            "(%.3f); GPP %s, NEE %s g C m-2 yr-1",
            y,
            len(f),
            n_nee,
            n_gpp,
            n_meas,
            a["frac_measured"],
            fmt(a["gpp_gc"]),
            fmt(a["nee_f_gc"]),
        )
        if a["nee_f_gc"] is not None and a["nee_f_gc"] > 0:
            log.info(
                "note: Hyytiala %d is a net source (NEE %s g C m-2 yr-1), unusual for this "
                "forest; the script keeps the values of the SMEAR API",
                y,
                fmt(a["nee_f_gc"]),
            )
    steps["hyytiala"] = {
        "source": REF_SOURCE,
        "years": per_year,
        "rule": "no row is removed; a half hour without NEE or GPP makes the daily and annual "
        "sum NULL; NaN or empty F_c_270 = not measured",
    }
    return frame(pd.concat(dailies, ignore_index=True)), pd.DataFrame(annual)


def read_data(db: Path, calculated: Path, smear: Path) -> Data:
    steps: dict[str, Any] = {}
    names = read_sites(db)
    names[REF_SITE] = REF_NAME
    slots = {s: i for i, s in enumerate(ALL_SITES)}
    events = read_events(db, steps)
    annual = read_annual(calculated, steps)
    daily = read_daily(calculated, steps)
    ref_daily, ref_annual = read_hyytiala(smear, steps)
    return Data(names, slots, events, annual, daily, ref_daily, ref_annual, steps)


# ======================================================================================
# Analysis
# ======================================================================================
def nn(x: Any) -> float | None:
    return num_or_none(x)


def peak_share(r: dict[str, Any]) -> float | None:
    p = r["uptake"]["peak"]
    return None if p is None else p["share"]


def site_year_row(
    r: dict[str, Any],
    d: pd.DataFrame,
    name: str,
    crop_info: tuple[str, str, str | None],
    counts: dict[str, int] | None,
) -> tuple[dict[str, Any], list[float]]:
    """One site-year: flags, annual sums, uptake shares; `r` = annual row, `d` = its daily rows.
    `counts` = None for the reference site (no events). Also returns the relative differences
    of the annual-daily sum check."""
    site, year = str(r["site_code"]), int(r["year"])
    rels: list[float] = []
    gpp, reco, nee = nn(r["gpp_gc"]), nn(r["reco_gc"]), nn(r["nee_f_gc"])
    for var, ann, dcol in (
        ("nee", nee, "nee_f_gc"),
        ("gpp", gpp, "gpp_gc"),
        ("reco", reco, "reco_gc"),
    ):
        chk = sum_check(ann, [nn(x) for x in col(d, dcol)])
        if not chk["ok"]:
            raise InputError(
                f"{site} {year} {var}: annual sum {ann} does not agree with the daily values"
            )
        if chk["relDiff"] is not None:
            rels.append(chk["relDiff"])
    frac = float(r["frac_measured"])
    gap = float(r["longest_gap_days"])
    has_sums = gpp is not None and reco is not None
    reasons = {
        f: exclusion_reasons(frac, bool(r["full_year"]), gap, has_sums, f)
        for f in (1, 2)
    }
    whole = uptake_share([nn(x) for x in col(d, "nee_f_gc")])
    jja = uptake_share(
        [
            nn(x)
            for x in col(
                frame(d[col(d, "month").isin(JJA)]),
                "nee_f_gc",
            )
        ]
    )
    full = year_days(d, year)
    peak = peak_window(
        list(col(full, "date_local")),
        [nn(x) for x in col(full, "gpp_gc")],
        [nn(x) for x in col(full, "nee_f_gc")],
        [nn(x) for x in col(full, "frac_measured")],
    )
    crop, group, label = crop_info
    row: dict[str, Any] = {
        "key": site_year_key(site, year),
        "site": site,
        "siteName": name,
        "year": year,
        "crop": crop,
        "group": group,
        "cropLabel": label,
        "inFig1": not reasons[1],
        "inFig2": not reasons[2],
        "exclusionFig1": "; ".join(reasons[1]) or None,
        "exclusionFig2": "; ".join(reasons[2]) or None,
        "fullYear": bool(r["full_year"]),
        "reliable": bool(r["reliable"]),
        "fracMeasured": frac,
        "longestGapDays": gap,
        "gpp": gpp,
        "reco": reco,
        "nee": nee,
        "recoGppRatio": (reco / gpp) if reco is not None and gpp else None,
        "uptake": {
            "year": whole,
            "jja": jja,
            "peak": peak,
        },
    }
    if counts is None:
        row["source"] = REF_SOURCE
    else:
        row["events"] = counts
        row["eventsTotal"] = int(sum(counts.values()))
    return row, rels


def analyse(data: Data) -> dict[str, Any]:
    steps = data.steps
    rows: list[dict[str, Any]] = []
    max_rel = 0.0
    n_sum_checks = 0
    sorted_annual = data.annual.sort_values(
        ["site_code", "year"],
        key=lambda c: c.map(ALL_SITES.index) if c.name == "site_code" else c,
    )
    for r in sorted_annual.to_dict("records"):
        site, year = str(r["site_code"]), int(r["year"])
        d = frame(
            data.daily[
                (col(data.daily, "site_code") == site)
                & (col(data.daily, "year") == year)
            ]
        )
        ev = frame(
            data.events[
                (col(data.events, "site_code") == site)
                & (col(data.events, "year") == year)
            ]
        )
        counts = {t: int((col(ev, "type") == t).sum()) for t in EVENT_TYPES}
        row, rels = site_year_row(r, d, data.names[site], CROPS[(site, year)], counts)
        rows.append(row)
        n_sum_checks += len(rels)
        max_rel = max([max_rel, *rels])
    steps["sumCheck"] = {
        "comparisons": n_sum_checks,
        "maxRelDiff": max_rel,
        "rtol": SUM_RTOL,
        "rule": "annual sum = sum of the daily values of the local year; a NULL annual sum has a daily gap",
    }
    log.info(
        "sum check: %d annual sums equal the daily sums (max relative difference %.3g)",
        n_sum_checks,
        max_rel,
    )
    fig1 = [r for r in rows if r["inFig1"]]
    fig2 = [r for r in rows if r["inFig2"]]
    steps["inclusion"] = {
        "siteYears": len(rows),
        "fig2": len(fig2),
        "fig1": len(fig1),
        "excludedFig2": len(rows) - len(fig2),
        "onlyFig2": [r["key"] for r in fig2 if not r["inFig1"]],
        "reasonCounts": {
            reason: sum(
                1
                for r in rows
                if not r["inFig2"] and reason in (r["exclusionFig2"] or "")
            )
            for reason in REASONS[:4]
        },
        "rule": "full_year and reliable; Figure 1 also needs annual GPP and Reco",
    }
    for r in rows:
        if not r["inFig2"]:
            log.info("excluded %s: %s", r["key"], r["exclusionFig2"])
        elif not r["inFig1"]:
            log.info("Figure 2 only %s: %s", r["key"], r["exclusionFig1"])
    log.info(
        "inclusion: %d site-years; %d in Figure 2, %d in Figure 1",
        len(rows),
        len(fig2),
        len(fig1),
    )

    def fit(sel: list[dict[str, Any]]) -> dict[str, Any]:
        return ols([r["gpp"] for r in sel], [r["reco"] for r in sel])

    regression = {
        "all": fit(fig1),
        "withoutMaktau": fit([r for r in fig1 if r["site"] != "maktau"]),
    }
    groups: dict[str, Any] = {}
    for g in GROUPS:
        g1 = [r for r in fig1 if r["group"] == g]
        g2 = [r for r in fig2 if r["group"] == g]
        groups[g] = {
            "fig1SiteYears": [r["key"] for r in g1],
            "fig2SiteYears": [r["key"] for r in g2],
            "nee": plain_stats(r["nee"] for r in g1),
            "recoGppRatio": plain_stats(r["recoGppRatio"] for r in g1),
            "uptakeYear": plain_stats(r["uptake"]["year"]["share"] for r in g2),
            "uptakeJja": plain_stats(r["uptake"]["jja"]["share"] for r in g2),
            "uptakePeak": plain_stats(peak_share(r) for r in g2),
        }
    # Annual crops without Maktau: the Finnish annual crops only (Maktau is a tropical maize field).
    c1 = [r for r in fig1 if r["group"] == "annual crop" and r["site"] != "maktau"]
    c2 = [r for r in fig2 if r["group"] == "annual crop" and r["site"] != "maktau"]
    groups["annual crop without Maktau"] = {
        "fig1SiteYears": [r["key"] for r in c1],
        "fig2SiteYears": [r["key"] for r in c2],
        "nee": plain_stats(r["nee"] for r in c1),
        "recoGppRatio": plain_stats(r["recoGppRatio"] for r in c1),
        "uptakeYear": plain_stats(r["uptake"]["year"]["share"] for r in c2),
        "uptakeJja": plain_stats(r["uptake"]["jja"]["share"] for r in c2),
        "uptakePeak": plain_stats(peak_share(r) for r in c2),
    }
    finnish = [r for r in fig2 if r["site"] != "maktau"]
    summary = {
        "nFig1": len(fig1),
        "nFig2": len(fig2),
        "nSink": sum(1 for r in fig1 if r["nee"] < 0),
        "nSource": sum(1 for r in fig1 if r["nee"] >= 0),
        "fig1": {
            "gpp": plain_stats(r["gpp"] for r in fig1),
            "reco": plain_stats(r["reco"] for r in fig1),
            "nee": plain_stats(r["nee"] for r in fig1),
            "recoGppRatio": plain_stats(r["recoGppRatio"] for r in fig1),
        },
        "finnishUptakeYear": plain_stats(r["uptake"]["year"]["share"] for r in finnish),
        "finnishUptakeJja": plain_stats(r["uptake"]["jja"]["share"] for r in finnish),
        "finnishUptakePeak": plain_stats(peak_share(r) for r in finnish),
        "minNee": min(fig1, key=lambda r: r["nee"])["key"],
        "maxNee": max(fig1, key=lambda r: r["nee"])["key"],
    }
    # ----- reference site Hyytiala -----
    ref_rows: list[dict[str, Any]] = []
    for r in data.ref_annual.to_dict("records"):
        year = int(r["year"])
        d = frame(data.ref_daily[col(data.ref_daily, "year") == year])
        row, rels = site_year_row(r, d, REF_NAME, REF_CROP, None)
        ref_rows.append(row)
        steps["sumCheck"]["comparisons"] += len(rels)
        steps["sumCheck"]["maxRelDiff"] = max([steps["sumCheck"]["maxRelDiff"], *rels])
    ref4 = [r for r in ref_rows if r["inFig1"]]
    ref5 = [r for r in ref_rows if r["inFig2"]]
    for r in ref_rows:
        if not r["inFig2"]:
            log.info("excluded %s: %s", r["key"], r["exclusionFig2"])
    log.info(
        "hyytiala: %d site-years; %d in Figure 5, %d in Figure 4",
        len(ref_rows),
        len(ref5),
        len(ref4),
    )
    steps["inclusion"]["hyytiala"] = {
        "siteYears": len(ref_rows),
        "fig5": len(ref5),
        "fig4": len(ref4),
    }
    groups[REF_GROUP] = {
        "fig4SiteYears": [r["key"] for r in ref4],
        "fig5SiteYears": [r["key"] for r in ref5],
        "nee": plain_stats(r["nee"] for r in ref4),
        "recoGppRatio": plain_stats(r["recoGppRatio"] for r in ref4),
        "uptakeYear": plain_stats(r["uptake"]["year"]["share"] for r in ref5),
        "uptakeJja": plain_stats(r["uptake"]["jja"]["share"] for r in ref5),
        "uptakePeak": plain_stats(peak_share(r) for r in ref5),
    }
    regression["withHyytiala"] = fit(fig1 + ref4)
    reference = {
        "hyytiala": {
            "site": REF_SITE,
            "siteName": REF_NAME,
            "source": REF_SOURCE,
            "siteYears": ref_rows,
            "fig4Keys": [r["key"] for r in ref4],
            "fig5Keys": [r["key"] for r in ref5],
            "excluded": [
                {
                    "key": r["key"],
                    "site": r["site"],
                    "siteName": r["siteName"],
                    "year": r["year"],
                    "reason": r["exclusionFig1"],
                    "inFig5": r["inFig2"],
                }
                for r in ref_rows
                if not r["inFig1"]
            ],
        }
    }
    summary["fig4"] = {
        "n": len(fig1) + len(ref4),
        "nSink": sum(1 for r in fig1 + ref4 if r["nee"] < 0),
        "nSource": sum(1 for r in fig1 + ref4 if r["nee"] >= 0),
    }
    summary["nFig5"] = len(fig2) + len(ref5)
    return {
        "siteYears": rows,
        "reference": reference,
        "fig1Keys": [r["key"] for r in fig1],
        "fig2Keys": [r["key"] for r in fig2],
        "excluded": [
            {
                "key": r["key"],
                "site": r["site"],
                "siteName": r["siteName"],
                "year": r["year"],
                "reason": r["exclusionFig1"],
                "inFig2": r["inFig2"],
            }
            for r in rows
            if not r["inFig1"]
        ],
        "regression": regression,
        "groups": groups,
        "summary": summary,
    }


# ======================================================================================
# Figures
# ======================================================================================
def fmt(x: float | None, digits: int = 0) -> str:
    """Number for the alt text: fixed decimals, minus sign as U+2212."""
    if x is None:
        return "n/a"
    s = f"{x:.{digits}f}"
    if float(s) == 0:
        s = s.lstrip("-")
    return s.replace("-", "−")


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x * 100:.0f} %"


def share_stat(st: dict[str, Any]) -> str:
    """Alt text of a share summary: mean ± SD in % (range min to max %, n)."""
    return (
        f"{pct(st['mean'])} ± {fmt(None if st['sd'] is None else st['sd'] * 100)} % "
        f"({pct(st['min'])} to {pct(st['max'])}, n = {st['n']})"
    )


def setup_matplotlib() -> None:
    f = FONT_SCALE
    plt.rcParams.update(
        {
            "svg.fonttype": "none",
            "font.family": "sans-serif",
            "font.sans-serif": ["DejaVu Sans"],
            "mathtext.default": "regular",
            "axes.unicode_minus": True,
            "font.size": 8 * f,
            "axes.labelsize": 7.5 * f,
            "xtick.labelsize": 7 * f,
            "ytick.labelsize": 7 * f,
            "legend.fontsize": 7 * f,
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
            "axes.linewidth": 0.9,
            "xtick.major.width": 0.9,
            "ytick.major.width": 0.9,
            "hatch.linewidth": 1.2,
        }
    )


def esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def add_svg_text(path: Path, n: int, title: str, desc: str) -> None:
    """Add role, aria-labelledby, <title> and <desc>, and the site font stack on each text element."""
    svg = path.read_text(encoding="utf-8")
    tid, did = f"{SLUG}-fig{n}-title", f"{SLUG}-fig{n}-desc"
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
    svg = prefix_svg_ids(svg, f"{SVG_ID_PREFIX}{n}-", keep={tid, did})
    path.write_text(svg, encoding="utf-8")


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


def tick_label(r: dict[str, Any]) -> str:
    """Figure 2 tick label: the year, then the crop with one word per line."""
    crop = r["cropLabel"]
    return str(r["year"]) + ("" if not crop else "\n" + crop.replace(" ", "\n"))


def point_label(r: dict[str, Any]) -> str:
    return f"{r['year']} {r['cropLabel']}" if r["cropLabel"] else str(r["year"])


def site_style(site: str, data: Data) -> tuple[str, str, float, float, str]:
    """Colour, marker, marker size, zorder and legend text of a site."""
    if site == REF_SITE:
        return REF_COLOR, REF_MARKER, REF_MARKER_SIZE, REF_ZORDER, REF_LEGEND
    slot = data.slots[site]
    return (
        SITE_COLORS[slot],
        SITE_MARKERS[slot],
        MARKER_SIZE,
        MARKER_ZORDER.get(site, 3),
        data.names[site],
    )


def fig_carbon_space(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    rows = [r for r in res["siteYears"] if r["inFig1"]]
    fig, lo, hi = carbon_space_plot(rows, data, LABEL_OFFSETS, {})
    desc = carbon_space_desc(res, rows, lo, hi)
    return fig, FIG1_TITLE, desc


def carbon_space_plot(
    rows: Sequence[dict[str, Any]],
    data: Data,
    offsets: dict[str, tuple[float, float, str]],
    texts: dict[str, str],
) -> tuple[Any, float, float]:
    """Figures 1 and 4: Reco against GPP. A site-year without an entry in `offsets` has no label."""
    vals = [r["gpp"] for r in rows] + [r["reco"] for r in rows]
    lo, hi = nice_range(min(vals), max(vals))
    fig = plt.figure(figsize=(FIG_WIDTH_IN, FIG1_HEIGHT_IN))
    ax = fig.add_axes((0.12, 0.1, 0.66, 0.88))
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_aspect("equal", adjustable="box")
    ax.plot([lo, hi], [lo, hi], color=INK, lw=1.8, ls=":", zorder=1)
    fs_small = 6 * FONT_SCALE
    for g in NEE_GUIDES:
        # NEE = Reco - GPP = g, thus Reco = GPP + g. The label is at the bottom axis edge.
        ax.plot([lo - g, hi], [lo, hi + g], color=GUIDE, lw=1.1, ls=":", zorder=1)
        ax.annotate(
            f"NEE = {fmt(g)}",
            (lo - g, lo),
            xytext=(9, 13),
            textcoords="offset points",
            ha="left",
            va="bottom",
            rotation=45,
            rotation_mode="anchor",
            fontsize=fs_small,
            color=GUIDE_TEXT,
        )
    ax.text(
        lo + 0.03 * (hi - lo),
        hi - 0.03 * (hi - lo),
        "net source (NEE > 0)",
        ha="left",
        va="top",
        fontsize=7.5 * FONT_SCALE,
        fontweight="bold",
    )
    ax.text(
        hi - 0.03 * (hi - lo),
        lo + 0.03 * (hi - lo),
        "net sink (NEE < 0)",
        ha="right",
        va="bottom",
        fontsize=7.5 * FONT_SCALE,
        fontweight="bold",
    )
    handles: list[Any] = []
    for site in (*ALL_SITES, REF_SITE):
        sr = [r for r in rows if r["site"] == site]
        if not sr:
            continue
        color, marker, ms, zorder, legend = site_style(site, data)
        ax.plot(
            [r["gpp"] for r in sr],
            [r["reco"] for r in sr],
            ls="none",
            marker=marker,
            ms=ms,
            mfc=color,
            mec="white",
            mew=MARKER_EDGE,
            zorder=zorder,
        )
        for r in sr:
            if r["key"] not in offsets:
                continue
            dx, dy, ha = offsets[r["key"]]
            text = texts.get(r["key"], point_label(r))
            if r["key"] in WRAP_LABELS:
                text = text.replace(" (", "\n(")
            ax.annotate(
                text,
                (r["gpp"], r["reco"]),
                xytext=(dx, dy),
                textcoords="offset points",
                ha=ha,
                va="center",
                fontsize=fs_small,
                linespacing=1.0,
                zorder=4,
                bbox={"boxstyle": "square,pad=0.1", "fc": "white", "ec": "none"},
            )
        handles.append(
            Line2D(
                [],
                [],
                ls="none",
                marker=marker,
                ms=ms * 0.85,
                mfc=color,
                mec="white",
                mew=MARKER_EDGE,
                label=legend,
            )
        )
    ax.set_xlabel(X_LABEL_1)
    ax.set_ylabel(Y_LABEL_1)
    ticks = np.arange(lo, hi + 1, 200)
    ax.set_xticks(ticks)
    ax.set_yticks(ticks)
    fig.legend(
        handles=handles,
        loc="lower left",
        bbox_to_anchor=(0.79, 0.1),
        frameon=False,
        title="Site",
        title_fontsize=7 * FONT_SCALE,
        alignment="left",
        handletextpad=0.4,
        labelspacing=0.7,
        borderaxespad=0,
    )
    return fig, lo, hi


def carbon_space_desc(
    res: dict[str, Any], rows: Sequence[dict[str, Any]], lo: float, hi: float
) -> str:
    reg = res["regression"]
    s = res["summary"]
    by_key = {r["key"]: r for r in rows}
    mn, mx = by_key[s["minNee"]], by_key[s["maxNee"]]
    desc = (
        f"Scatter plot of {s['nFig1']} site-years (full and reliable years with annual GPP and "
        f"Reco): x axis {X_AXIS_TEXT_1}, y axis {Y_AXIS_TEXT_1}, both from {fmt(lo)} to "
        f"{fmt(hi)} on the same scale. A dotted 1:1 line divides net source years (above, NEE > 0) "
        f"from net sink years (below, NEE < 0); light dotted lines mark NEE = −200 and −400 g C "
        f"m−2 yr−1. Annual GPP is {fmt(s['fig1']['gpp']['min'])} to {fmt(s['fig1']['gpp']['max'])}, "
        f"Reco {fmt(s['fig1']['reco']['min'])} to {fmt(s['fig1']['reco']['max'])} g C m−2 yr−1. "
        f"{s['nSink']} site-years are below the line and {s['nSource']} above it. NEE is "
        f"{fmt(s['fig1']['nee']['mean'])} ± {fmt(s['fig1']['nee']['sd'])} (mean ± SD, range "
        f"{fmt(s['fig1']['nee']['min'])} to {fmt(s['fig1']['nee']['max'])}, n = "
        f"{s['fig1']['nee']['n']}) g C m−2 yr−1; the strongest sink is {mn['siteName']} {point_label(mn)} with NEE "
        f"{fmt(mn['nee'])}, the strongest source {mx['siteName']} {point_label(mx)} with NEE "
        f"{fmt(mx['nee'])}. OLS line: Reco = {fmt(reg['all']['slope'], 2)} × GPP + "
        f"{fmt(reg['all']['intercept'])}, r = {fmt(reg['all']['r'], 2)} (n = {reg['all']['n']}); "
        f"without Maktau slope {fmt(reg['withoutMaktau']['slope'], 2)}, r = "
        f"{fmt(reg['withoutMaktau']['r'], 2)} (n = {reg['withoutMaktau']['n']}). Each site has its "
        "own colour and marker; labels give the year and, for annual crops and the failed grass, "
        "the crop."
    )
    return desc


def fig_carbon_space_forest(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    ref = res["reference"]["hyytiala"]
    db_rows = [r for r in res["siteYears"] if r["inFig1"]]
    ref_rows = [r for r in ref["siteYears"] if r["inFig1"]]
    rows = db_rows + ref_rows
    fig, lo, hi = carbon_space_plot(
        rows, data, {**LABEL_OFFSETS, **LABEL_OFFSETS_FOREST}, LABEL_TEXT_FOREST
    )
    reg = res["regression"]
    g = res["groups"]
    s4 = res["summary"]["fig4"]
    per = "; ".join(
        f"{r['year']}: GPP {fmt(r['gpp'])}, Reco {fmt(r['reco'])}, NEE {fmt(r['nee'])}"
        for r in ref_rows
    )
    excl = [e for e in ref["excluded"]]
    desc = (
        f"The scatter plot of Figure 1 ({len(db_rows)} site-years of the six sites) with "
        f"{len(ref_rows)} site-years of the SMEAR II Hyytiälä Scots pine forest (green stars, "
        f"a reference with rare management): x axis {X_AXIS_TEXT_1}, y axis {Y_AXIS_TEXT_1}, "
        f"both from {fmt(lo)} to {fmt(hi)} on the same scale, dotted 1:1 line, light dotted "
        "lines at NEE = −200 and −400 g C m−2 yr−1. Labels: Hyytiälä 2020 and the cluster "
        f"2021–2025. Hyytiälä (g C m−2 yr−1) {per}. Hyytiälä NEE "
        f"{fmt(g[REF_GROUP]['nee']['mean'])} ± {fmt(g[REF_GROUP]['nee']['sd'])} (mean ± SD, "
        f"range {fmt(g[REF_GROUP]['nee']['min'])} to {fmt(g[REF_GROUP]['nee']['max'])}, n = "
        f"{g[REF_GROUP]['nee']['n']}); grassland "
        f"{fmt(g['grassland']['nee']['mean'])} ± {fmt(g['grassland']['nee']['sd'])} (range "
        f"{fmt(g['grassland']['nee']['min'])} to {fmt(g['grassland']['nee']['max'])}, n = "
        f"{g['grassland']['nee']['n']}); annual crops {fmt(g['annual crop']['nee']['mean'])} ± "
        f"{fmt(g['annual crop']['nee']['sd'])} (range {fmt(g['annual crop']['nee']['min'])} to "
        f"{fmt(g['annual crop']['nee']['max'])}, n = {g['annual crop']['nee']['n']}). "
        f"{s4['nSink']} of {s4['n']} site-years are below the line. OLS line over all "
        f"{reg['withHyytiala']['n']} site-years: Reco = {fmt(reg['withHyytiala']['slope'], 2)} × "
        f"GPP + {fmt(reg['withHyytiala']['intercept'])}, r = {fmt(reg['withHyytiala']['r'], 2)}."
        + (
            " Hyytiälä years not shown: "
            + ", ".join(f"{e['year']} ({e['reason']})" for e in excl)
            + "."
            if excl
            else ""
        )
    )
    return fig, FIG4_TITLE, desc


X_AXIS_TEXT_1 = "annual GPP (g C m−2 yr−1)"
Y_AXIS_TEXT_1 = "annual Reco (g C m−2 yr−1)"


def crop_lines(r: dict[str, Any]) -> list[str]:
    """Figure 2: the crop below the year, one word per line (empty for a grassland)."""
    return r["cropLabel"].split(" ") if r["cropLabel"] else []


def bar_positions(rows: Sequence[dict[str, Any]]) -> list[float]:
    """x of each site-year in Figure 2. A long crop word gets a wider slot; a gap between sites."""
    widths = [
        1.0
        + SLOT_PER_CHAR
        * max(0, max((len(w) for w in crop_lines(r)), default=0) - SLOT_CHARS)
        for r in rows
    ]
    xs: list[float] = []
    for i, r in enumerate(rows):
        if i == 0:
            xs.append(0.0)
            continue
        step = (widths[i - 1] + widths[i]) / 2
        if r["site"] != rows[i - 1]["site"]:
            step += SITE_GAP
        xs.append(xs[-1] + step)
    return xs


def uptake_bars(
    rows: Sequence[dict[str, Any]],
    data: Data,
    key: str,
    label: str,
    compact: bool = False,
) -> Any:
    """Figures 2, 3 and 5: bar pairs per site-year; the second bar is uptake[key] (hatched).

    compact (Figure 5, 22 site-years): vertical year labels, no crop lines (the crops are in
    the alt text and in Figure 3), site names in two staggered rows."""
    xs = bar_positions([dict(r, cropLabel=None) for r in rows] if compact else rows)
    height = FIG5_HEIGHT_IN if compact else FIG2_HEIGHT_IN
    fig = plt.figure(figsize=(FIG_WIDTH_IN, height))
    ax = fig.add_axes((0.1, 0.22, 0.87, 0.66) if compact else (0.1, 0.2, 0.87, 0.68))
    width = 0.4
    for xi, r in zip(xs, rows, strict=True):
        color = site_style(r["site"], data)[0]
        ax.bar(
            xi - width / 2,
            r["uptake"]["year"]["share"] * 100,
            width,
            color=color,
            edgecolor=INK,
            lw=0.8,
            zorder=2,
        )
        second = r["uptake"][key]
        if second is None:
            continue
        ax.bar(
            xi + width / 2,
            second["share"] * 100,
            width,
            color=lighter(color),
            edgecolor=INK if r["site"] == "viikki" else color,
            hatch="///",
            lw=0.8,
            zorder=2,
        )
    ax.axhline(50, color=INK, lw=1.4, ls=":", zorder=1)
    ax.set_ylim(0, 100)
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.set_xlim(xs[0] - 0.6, xs[-1] + 0.75)
    ax.set_ylabel(Y_LABEL_2)
    ax.set_xticks(xs)
    ax.set_xticklabels(
        [str(r["year"]) for r in rows],
        fontsize=5.25 * FONT_SCALE,
        rotation=90 if compact else 0,
    )
    ax.tick_params(axis="x", length=0, pad=3)
    for xi, r in zip(xs, rows, strict=True):
        lines = [] if compact else crop_lines(r)
        if lines:
            ax.annotate(
                "\n".join(lines),
                (xi, 0),
                xycoords=("data", "axes fraction"),
                xytext=(0, -15),
                textcoords="offset points",
                ha="center",
                va="top",
                fontsize=5 * FONT_SCALE,
                fontstyle="italic",
                linespacing=1.0,
            )
    for i, site in enumerate(dict.fromkeys(r["site"] for r in rows)):
        sx = [xi for xi, r in zip(xs, rows, strict=True) if r["site"] == site]
        ax.annotate(
            data.names[site],
            ((min(sx) + max(sx)) / 2, 0),
            xycoords=("data", "axes fraction"),
            xytext=(0, (-36 - 15 * (i % 2)) if compact else -38),
            textcoords="offset points",
            ha="center",
            va="top",
            fontsize=7 * FONT_SCALE,
            fontweight="bold",
        )
    handles = [
        Patch(facecolor="#888888", edgecolor=INK, lw=0.8, label="Whole year"),
        Patch(
            facecolor=lighter("#888888"),
            edgecolor="#888888",
            hatch="///",
            lw=0.8,
            label=label,
        ),
    ]
    fig.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.52, 1.0),
        ncols=2,
        frameon=False,
        handlelength=2.2,
        handleheight=1.1,
    )

    return fig


def fig_uptake_days(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    rows = [r for r in res["siteYears"] if r["inFig2"]]
    fig = uptake_bars(rows, data, "jja", "June to August")

    s = res["summary"]
    groups = res["groups"]
    mk = [r for r in rows if r["site"] == "maktau"]
    per = "; ".join(
        f"{r['siteName']} {point_label(r)}: {pct(r['uptake']['year']['share'])} and "
        f"{pct(r['uptake']['jja']['share'])}"
        for r in rows
    )
    desc = (
        f"Grouped bar chart of {s['nFig2']} site-years (full and reliable years), grouped by "
        "site. Per site-year, the left bar (full site colour) is the share of days with daily "
        "NEE < 0 over the whole year, the right bar (lighter, hatched) the share over June to "
        "August; y axis days with net uptake (%), 0 to 100, dotted line at 50 %. At the Finnish "
        f"sites the share is {pct(s['finnishUptakeYear']['min'])} to "
        f"{pct(s['finnishUptakeYear']['max'])} of the year (n = {s['finnishUptakeYear']['n']}) "
        f"and {pct(s['finnishUptakeJja']['min'])} to {pct(s['finnishUptakeJja']['max'])} of June "
        "to August"
        + (
            f"; Maktau {mk[0]['year']}: {pct(mk[0]['uptake']['year']['share'])} and "
            f"{pct(mk[0]['uptake']['jja']['share'])}. "
            if mk
            else ". "
        )
        + f"Mean ± SD (range) of the whole year: grassland {share_stat(groups['grassland']['uptakeYear'])}, "
        f"annual crops {share_stat(groups['annual crop']['uptakeYear'])}; of June to August: "
        f"grassland {share_stat(groups['grassland']['uptakeJja'])}, annual crops "
        f"{share_stat(groups['annual crop']['uptakeJja'])}. Whole year and June to August per "
        f"site-year: {per}."
    )
    return fig, FIG2_TITLE, desc


def peak_text(r: dict[str, Any]) -> str:
    """Alt text of one site-year: whole-year share, peak window and its share."""
    p = r["uptake"]["peak"]
    head = f"{r['siteName']} {point_label(r)}: {pct(r['uptake']['year']['share'])} of the year"
    if p is None:
        return head + ", no valid 90-day window (no second bar)"
    return (
        f"{head}, window {p['start']} to {p['end']} {pct(p['share'])} (mean measured "
        f"fraction {fmt(p['fracMeasured'], 2)})"
    )


def fig_uptake_days_peak_forest(
    res: dict[str, Any], data: Data
) -> tuple[Any, str, str]:
    db_rows = [r for r in res["siteYears"] if r["inFig2"]]
    ref_rows = [r for r in res["reference"]["hyytiala"]["siteYears"] if r["inFig2"]]
    rows = db_rows + ref_rows
    fig = uptake_bars(rows, data, "peak", "Peak-GPP 90 days", compact=True)
    s = res["summary"]
    g = res["groups"]
    mk = [r for r in db_rows if r["site"] == "maktau"]
    desc = (
        f"Grouped bar chart of {len(rows)} site-years: the {len(db_rows)} site-years of Figure 3 "
        f"and {len(ref_rows)} site-years of the SMEAR II Hyytiälä forest (reference, last group). "
        "Per site-year, the left bar (full site colour) is the share of days with daily NEE < 0 "
        "over the whole year, the right bar (lighter, hatched) the share inside the "
        f"{PEAK_DAYS} consecutive local days with the largest GPP sum of the year; y axis days "
        "with net uptake (%), 0 to 100, dotted line at 50 %. Mean ± SD (range) of the whole "
        f"year: forest {share_stat(g[REF_GROUP]['uptakeYear'])}, grassland "
        f"{share_stat(g['grassland']['uptakeYear'])}, annual crops "
        f"{share_stat(g['annual crop']['uptakeYear'])}; of the peak window: forest "
        f"{share_stat(g[REF_GROUP]['uptakePeak'])}, grassland "
        f"{share_stat(g['grassland']['uptakePeak'])}, annual crops "
        f"{share_stat(g['annual crop']['uptakePeak'])}, Finnish sites of the database "
        f"{share_stat(s['finnishUptakePeak'])}. "
        + "".join(f"{peak_text(r)}. " for r in mk)
        + "Hyytiälä: "
        + "; ".join(peak_text(r) for r in ref_rows)
        + ". Other site-years: "
        + "; ".join(peak_text(r) for r in db_rows if r["site"] != "maktau")
        + "."
    )
    return fig, FIG5_TITLE, desc


def fig_uptake_days_peak(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    rows = [r for r in res["siteYears"] if r["inFig2"]]
    fig = uptake_bars(rows, data, "peak", "Peak-GPP 90 days")
    s = res["summary"]
    groups = res["groups"]

    def one(r: dict[str, Any]) -> str:
        p = r["uptake"]["peak"]
        head = f"{r['siteName']} {point_label(r)}: {pct(r['uptake']['year']['share'])} of the year"
        if p is None:
            return head + ", no valid 90-day window (no second bar)"
        return (
            f"{head}, window {p['start']} to {p['end']} {pct(p['share'])} (mean measured "
            f"fraction {fmt(p['fracMeasured'], 2)})"
        )

    missing = [r for r in rows if r["uptake"]["peak"] is None]
    desc = (
        f"Grouped bar chart of {s['nFig2']} site-years (full and reliable years), grouped by "
        "site, the same layout as Figure 2. Per site-year, the left bar (full site colour) is the "
        "share of days with daily NEE < 0 over the whole year, the right bar (lighter, hatched) "
        f"the share inside the {PEAK_DAYS} consecutive local days with the largest GPP sum of the "
        f"year ({PEAK_MIN_GPP_DAYS} or more days with GPP); y axis days with net uptake (%), 0 to "
        "100, dotted line at 50 %. "
        + (
            "Site-years without a valid window (whole-year bar only): "
            + ", ".join(f"{r['siteName']} {r['year']}" for r in missing)
            + ". "
            if missing
            else ""
        )
        + f"Mean ± SD (range) of the peak window: Finnish sites {share_stat(s['finnishUptakePeak'])}, "
        f"grassland {share_stat(groups['grassland']['uptakePeak'])}, annual crops "
        f"{share_stat(groups['annual crop']['uptakePeak'])}, annual crops without Maktau "
        f"{share_stat(groups['annual crop without Maktau']['uptakePeak'])}. Per site-year: "
        + "; ".join(one(r) for r in rows)
        + "."
    )
    return fig, FIG3_TITLE, desc


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
        "seeds": {},
        "seedNote": "no random numbers",
        "args": {
            "db": str(args.db),
            "calculated": str(args.calculated),
            "smear": str(args.smear),
            "out": str(args.out) if args.out else None,
            "check": args.check,
        },
        "dbBuiltAt": DATABASE["builtAt"],
        "calcBuiltAt": DATABASE["calcBuiltAt"],
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
        "sites": list(ALL_SITES),
        "minFrac": MIN_FRAC,
        "maxGapDays": MAX_GAP_DAYS,
        "jjaMonths": list(JJA),
        "reference": {
            "site": REF_SITE,
            "name": REF_NAME,
            "group": REF_GROUP,
            "source": (
                "SMEAR II Hyytiälä (station 2), SMEAR API, downloaded 2026-10-27 "
                "(data/smear/hyytiala/README.md): HYY_EDDY233.NEE and HYY_EDDY233.GPP, "
                "HYY_EDDYMAST.F_c_270"
            ),
            "signConvention": (
                "NEE gap-filled, positive = emission; GPP positive = uptake; Reco = NEE + GPP "
                "(umol CO2 m-2 s-1)"
            ),
            "timeBase": (
                "local time UTC+2 all year; the stamp is the start of the half hour (first "
                "stamp 1 January 00:00, last 31 December 23:30); local day = calendar day"
            ),
            "measuredFractionProxy": (
                "share of half hours with a measured HYY_EDDYMAST.F_c_270 value (NaN or empty "
                "= missing); longest gap = longest run without it"
            ),
            "factor": HH_TO_GC,
            "years": list(REF_YEARS),
        },
        "peakDays": PEAK_DAYS,
        "peakMinGppDays": PEAK_MIN_GPP_DAYS,
        "peakRule": (
            f"{PEAK_DAYS} consecutive local days inside the calendar year (no crossing of the "
            "year end); score = sum of daily gpp_gc over the window days with a value; valid when "
            f"{PEAK_MIN_GPP_DAYS} or more days have GPP; largest score wins, a tie goes to the "
            "earliest start; share = uptake days / days with daily NEE in the window; null when "
            "no window is valid"
        ),
        "uptakeDay": "local day with daily NEE (nee_f_gc) < 0",
        "groups": list(GROUPS),
        "reasons": list(REASONS),
        "crops": [
            {
                "site": s,
                "year": y,
                "crop": c[0],
                "group": c[1],
                "cropLabel": c[2],
            }
            for (s, y), c in sorted(
                CROPS.items(), key=lambda kv: (ALL_SITES.index(kv[0][0]), kv[0][1])
            )
        ],
        "failedGrassNote": "Haltiala 2023 (grass sown, failed) is in the group grassland with the crop label 'grass (failed)'",
        "nee_guides": list(NEE_GUIDES),
        "sumRtol": SUM_RTOL,
        "units": {
            "daily": DAILY_UNIT,
            "annual": ANNUAL_UNIT,
            "share": "fraction 0 to 1",
        },
        "axisNames": {
            "fig1x": "Annual GPP (g C m-2 yr-1)",
            "fig1y": "Annual Reco (g C m-2 yr-1)",
            "fig2y": Y_LABEL_2,
        },
        "rules": [
            line.strip()
            for line in (__doc__ or "")
            .split("METHOD", 1)[1]
            .split("DATABASE", 1)[0]
            .splitlines()
            if line.strip()
        ],
        "openFindings": list(OPEN_FINDINGS),
        "literature": "none: the script uses no literature value",
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
        "--calculated",
        type=Path,
        default=Path("data/calculated"),
        help="folder of the calculated products (default: data/calculated)",
    )
    p.add_argument(
        "--smear",
        type=Path,
        default=Path("data/smear/hyytiala"),
        help="folder of the SMEAR II Hyytiala files (default: data/smear/hyytiala)",
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

    errors = check_inputs(args.db, args.calculated, args.smear)
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
        data = read_data(args.db, args.calculated, args.smear)
        res = analyse(data)
    except InputError as e:
        log.error("input check: %s", e)
        return 3

    setup_matplotlib()
    git = git_info(script_dir)
    meta = {
        "source": f"{SCRIPT_PATH} (git {git['commit']}{', dirty' if git['dirty'] else ''})",
        "relation": f"database snapshot {DATABASE['builtAt']}; "
        + "; ".join(f"{i.key} sha256 {i.sha256}" for i in INPUTS),
    }
    figures_json: list[dict[str, Any]] = []
    for n, name in FIGURES:
        if name == "carbon-space":
            fig, title, desc = fig_carbon_space(res, data)
        elif name == "uptake-days":
            fig, title, desc = fig_uptake_days(res, data)
        elif name == "uptake-days-peak":
            fig, title, desc = fig_uptake_days_peak(res, data)
        elif name == "carbon-space-forest":
            fig, title, desc = fig_carbon_space_forest(res, data)
        else:
            fig, title, desc = fig_uptake_days_peak_forest(res, data)
        path = target / "figures" / f"{n}-{name}.svg"
        save_svg(fig, path, n, title, desc, meta)
        size = path.stat().st_size
        if size >= 1_000_000:
            raise RuntimeError(f"{path}: {size} bytes (limit 1 MB)")
        figures_json.append(
            {"n": n, "file": f"figures/{n}-{name}.svg", "title": title, "desc": desc}
        )
        log.info("figure %d: %s (%d bytes)", n, path, size)

    pd.DataFrame(
        [
            {
                "key": r["key"],
                "group": r["group"],
                "crop": r["crop"],
                "inFig1": r["inFig1"],
                "inFig2": r["inFig2"],
                "exclusionFig1": r["exclusionFig1"],
                "gpp": r["gpp"],
                "reco": r["reco"],
                "nee": r["nee"],
                "recoGppRatio": r["recoGppRatio"],
                "uptakeYear": r["uptake"]["year"]["share"],
                "uptakeJja": r["uptake"]["jja"]["share"],
                "uptakePeak": peak_share(r),
                "peakStart": None
                if r["uptake"]["peak"] is None
                else r["uptake"]["peak"]["start"],
                "fracMeasured": r["fracMeasured"],
                "longestGapDays": r["longestGapDays"],
                **{f"n_{t}": r["events"][t] for t in EVENT_TYPES},
            }
            for r in res["siteYears"]
        ]
    ).to_csv(out_dir / "output" / "site-years.csv", index=False, float_format="%.10g")

    dv = data_version(args, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": (
            "How do the management and the crop of a site-year show in the annual carbon "
            "balance (annual GPP against annual Reco) and in the share of days with net uptake?"
        ),
        "method": method_json(),
        **res,
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
                new_h = svg_body_hash(target / f["file"])
                old_h = old.get(f["file"], {}).get("sha256WithoutMetadata")
                if new_h != old_h:
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
