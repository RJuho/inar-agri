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
"""Net biome exchange (NBE): annual NEE plus the carbon that management takes out or brings in.

QUESTION
    How does the annual carbon balance of a site-year change when the carbon of the harvest, the
    grazing, the thinning and the organic inputs is added to NEE?

METHOD
    NBE = NEE + C_out - C_in (g C m-2 yr-1). Positive NBE = carbon loss from the field (the
    ecosystem; the same sign as NEE). CO2-C only; CH4 is not in NBE. One site-year = one site and one local
    calendar year.
    1. Site-years: all rows of data/calculated/annual.csv (sites Anttila, Sarkisuo, Haltiala,
       Qvidja, Viikki and Maktau, order of db/sites.parquet) plus SMEAR II Hyytiala 2019 to 2024
       (step 6). NEE = gap-filled annual NEE (nee_f_gc); GPP and TER (= Reco) = annual sums of
       the night-time partitioning (gpp_gc, reco_gc). A site-year without an annual NEE sum has
       no NBE (reason "no annual NEE sum").
    2. Management carbon per site-year: the rows of data/calculated/management_carbon.csv in the
       calendar year of the event date (column year). action "harvest" (this includes the
       grass that grazing animals eat) = C_out; action "fertilisation" with a carbon value (this
       includes the excreta of grazing animals) = C_in. c_g_m2 is the carbon of the row in
       g C m-2. A row with c_fraction_source "site" is site data. A row with c_fraction_source
       "assumed" or "none", and a row with action "grazing", is replaced by an assumption of
       ASSUMPTIONS (step 4). The script stops when such a row has no assumption.
    3. Class: A = full year (full_year in annual.csv) and all terms are site data. B = one or
       more assumed terms, or a partial year. Low and high NBE: each assumed term gives the value
       that makes NBE lowest and the value that makes NBE highest; low NBE = NEE + the sum of the
       low-NBE values of C_out - the sum of the low-NBE values of C_in (high in the same way).
       All assumptions go to their extremes together (no statistics of the range). For class A,
       and for the site-data terms, low = high = the central value. The uncertainty of NEE is
       not in the range.
    4. Assumptions (values from LITERATURE, each with a page, or from the management files;
       kg ha-1 / 10 = g m-2; Mg ha-1 x 100 = g m-2):
       a. Viikki crop carbon (harvest rows of 2022 to 2025, c_fraction_source "assumed"): dry
          mass x carbon fraction. Central 0.45 (Gao et al. 2026, the C content that they use for
          this field), low-NBE 0.42 (Heimsch et al. 2024, Qvidja grass), high-NBE 0.48 (highest
          grass C of Shurpali et al. 2025, Table 4).
       b. Manure carbon fraction of dry mass f_C = organic fraction of DM x C in organic matter
          (Gao et al. 2026: 0.799 x 0.504 = 0.4027).
       c. Viikki 2023 dry manure (18.4 kg N/ha in the management file): central = 1701 kg DM/ha
          (Gao et al. 2026, same date) x f_C. Low-NBE (larger input) = 43 m3/ha x 280 kg m-3 x
          0.325 DM (Vettikkat et al. 2026, Tables 1 and 2) x f_C. High-NBE = central.
       d. Viikki 2024 manure (dry manure 22.5 kg N/ha on 9 October, liquid manure 57.5 kg N/ha
          on 22 May; numbers parsed from the product text): the management file gives kg N/ha only. The 2023 file value
          (18.4 kg N/ha) agrees with the ammoniacal N of Vettikkat et al. (18.5 kg TAN/ha), so
          the N of the file is taken as TAN. Dry manure: central DM per kg N = 1701 kg DM / 18.4
          kg N (2023 pair), low-NBE = solid fraction 280 x 0.325 / 0.43 kg DM per kg TAN, high-NBE
          = central. Liquid manure 57.5 kg N/ha: central = liquid fraction 1000 x 0.058 / 2.3 kg DM
          per kg TAN, low-NBE = raw manure 1000 x 0.085 / 2.2 kg DM per kg TAN, high-NBE = liquid
          fraction per kg total N, 1000 x 0.058 / 3.6. Carbon = DM x f_C.
       e. Haltiala 2023 manure, 10 m3/ha (type not known): DM per m3 from the three manure forms
          of Vettikkat et al. Table 2: central raw manure 1000 x 0.085 = 85 kg, low 58 (liquid
          fraction), high 91 (solid fraction 280 x 0.325). Volume central 10 m3/ha; the upper
          volume (60 m3/ha) is the text "could be 45-60 m3/ha" of the event detail in
          db/events.parquet. Low-NBE = high volume x high DM per m3; high-NBE = 10 m3/ha x low DM.
          Carbon = DM x f_C. The two sector applications (June and August) count as one
          application of 10 m3/ha on the field, as in the management table.
       f. Qvidja 2020 own NPK mix (DM known, carbon not known): Heimsch et al. 2024 Table 1 gives
          the organic input 110 +- 15 g C m-2 for 4 May 2020 to 3 May 2021 (the liquid fertilisers
          of 2018 to 2020 are in their input, p. 4). The NPK mix = 110 minus the site-data inputs
          of the same window (management_carbon.csv, 101). Low NBE = 110 + 15 - 101; high NBE =
          max(110 - 15 - 101, 0); the central value is not below 0 either.
       g. Qvidja 2021 broiler litter (2640 kg DM/ha): central DM x f_C (dry cattle manure of Gao
          et al.; broiler litter can differ). Low-NBE = DM x 0.504 (all DM organic). High-NBE = 0:
          Heimsch et al. 2024 Table 1 gives 2 +- 0 g C m-2 input for May 2021 to May 2022, thus
          their balance has no carbon from the litter.
       h. Qvidja 2023 compost fibre (c_fraction 0.30, "assumed" in the file): central = the file
          value; range = the carbon fraction of DM of the Qvidja compost rows with site data
          (c_g_m2 x 10 / dry_mass_kg_ha): the larger fraction gives low NBE.
       i. Qvidja 2025 grazing (no carbon values): animal-days from the product text (animals x
          days). Rates per animal-day from the quantified Qvidja grazing rows (removal row:
          action harvest; excreta row: action fertilisation, same date): rate = c_g_m2 /
          (animals x days) of each row; horses = the mean rate of the horse rows (2021); cattle =
          the mean rate of the cattle rows (2022, 2024). Range: the removal and
          excreta rates of the row with the smallest net rate (removal - excreta) per
          animal-day give low NBE, those of the row with the largest net rate give high NBE,
          each on all animal-days of the year. The rows are per field area as in the file.
    5. Maktau: no yield, residue or input data for any year (management_carbon.csv has no
       Maktau row; Rasanen et al. 2026 give only a 2021 yield and a 2022 crop failure, from
       another article, without the residue fate): no NBE.
    6. SMEAR II Hyytiala (reference forest; data/smear/hyytiala, files of the SMEAR API):
       HYY_EDDY233.NEE (gap-filled, positive = emission) and HYY_EDDY233.GPP, umol CO2 m-2 s-1,
       TER = NEE + GPP, local time UTC+2 all year, sum x 1800 s x 12.011e-6 g C umol-1; a sum is
       NULL when a half hour has no value. Measured fraction and longest gap from
       HYY_EDDYMAST.F_c_270: measured fraction = half hours with a value (not NaN or empty) / all
       half hours; longest gap = the longest run of NaN or empty half hours, in days. full_year
       and reliable as for the other sites. C_out 2020 = the commercial removal (logs and
       pulpwood) of the 2020 thinning, 200 m radius mean, 23.1 Mg C ha-1 x 100 = 2310 g C m-2
       (Aalto et al. 2023, Table 3); range 14.9 (all 43 plots) to 24.4 (the 26 thinned plots). The cutting residue stayed on the site (not an output). The thinning was in
       February and March 2020; the about 1 ha thinned in December 2019 and January 2020 also
       goes to 2020. The understorey clearing of spring 2019 left all trees on the ground (no
       output). No other outputs or inputs 2019 to 2024: NBE = NEE in those years.
    7. Figure 1: x = annual GPP, y = annual carbon out = TER + C_out - C_in; y - x = NBE. Rule:
       full_year AND reliable AND annual GPP and TER sums (gpp_gc and reco_gc not NULL) AND an
       NBE value. Class A = filled
       marker; class B = hollow marker with a vertical whisker from low to high NBE. A grey line
       links the NEE position (y = TER) to the NBE position.
    8. Summaries: n, mean, SD (n - 1), min and max of NEE, NBE and C_out - C_in over the
       Figure 1 site-years of the six sites (without Hyytiala), and the count of site-years with
       NEE > 0 and with NBE > 0; the keys of the site-years that change sign (NEE < 0 < NBE and
       NBE < 0 < NEE) and of those among them whose low-to-high NBE range includes 0.
    9. Each step that removes or replaces rows logs a count (results.json dataVersion.steps).
       Open findings of docs/anomaly-data-report.md that touch the dive are printed
       (OPEN_FINDINGS).

DATABASE
    builtAt: 2026-10-23T19:03:07.928Z (db/report.json and Parquet key/value metadata built_at)
    calcBuiltAt: 2026-10-23T19:03:09.003Z (data/calculated/report.json and Parquet built_at)
    commit: 44ec98f (HEAD at build time; db/report.json does not record a commit)
    url: TODO: release asset db-2026-10-23.zip not yet published

INPUTS
    db/sites.parquet  sha256=9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59  rows=6  columns=site_id, code, name
    db/events.parquet  sha256=b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b  rows=114  columns=site_code, date, type, detail
    calculated/annual.csv  sha256=27bc79419cac31239082a2ea9cf61bfe1c099b891e8792e0d5f7460885a95abe  rows=33  columns=site_code, year, full_year, reliable, frac_measured, longest_gap_days, nee_f_gc, gpp_gc, reco_gc
    calculated/management_carbon.csv  sha256=87f481aec6ec5aa7c3779faa93c5a909bd53a8b379fa97c1e0e133281caa7c8a  rows=46  columns=site, date, year, action, product, dry_mass_kg_ha, c_fraction, c_fraction_source, c_g_m2
    smear/HYY_EDDY233_NEE_GPP_2019.csv  sha256=32e13af00db88a7c00f6e0cabbdbcbfe9f08fcda220df8b6e2d0e6e72999ced7  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDY233.GPP, HYY_EDDY233.NEE
    smear/HYY_EDDYMAST_F_c_270_2019.csv  sha256=6535ff06a6c24f85fa7b4dfe23e94b53039085815227366bce1e95da7524f739  rows=17520  columns=Year, Month, Day, Hour, Minute, Second, HYY_EDDYMAST.F_c_270
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

OUTPUTS
    results.json                 all result numbers, figure caption and alt text, dataVersion
    manifest.json                provenance of the run and SHA-256 of the outputs
    figures/1-nbe-carbon-space.svg  annual carbon out (TER + C_out - C_in) against annual GPP
    output/run.log               run log (not in git)
    output/site-years.csv        all site-years with the terms (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/net-biome-exchange/net-biome-exchange.py --db db --calculated data/calculated \
        --smear data/smear/hyytiala

NOTES
    The snapshot of 2026-10-23 is also in snapshots/db-2026-10-23/ (not in git): give
    --db snapshots/db-2026-10-23/db --calculated snapshots/db-2026-10-23/calculated.
    NBE uses the carbon of management_carbon.csv (scripts/lib/calc/management.ts). The check
    NBE = -NECB - CH4-C of data/calculated/necb.csv for the class-A site-years is a unit test.
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

SLUG = "net-biome-exchange"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"
SVG_ID_PREFIX = "nb"

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


_TIME = ("Year", "Month", "Day", "Hour", "Minute", "Second")
_SMEAR_HASHES = {
    2019: (
        "32e13af00db88a7c00f6e0cabbdbcbfe9f08fcda220df8b6e2d0e6e72999ced7",
        "6535ff06a6c24f85fa7b4dfe23e94b53039085815227366bce1e95da7524f739",
        17520,
    ),
    2020: (
        "75ec98c5586b7d3e4282b4cdc5a6c7ce0ae07d9e0b2230240eed33f215eb8d20",
        "fc377d3b61aefa5764c497ef1a80f27f6e04c9ad6b67efa8e1c543c4a8a1ebc2",
        17568,
    ),
    2021: (
        "468e107389aa93b8d33a7e57623b1f3da6183df7f0eb440ce84204bb63af09a5",
        "5e8e6b9d11b32115216ab31253815b0a7171c73d9c4cd53e9cdf5b637ea11d8d",
        17520,
    ),
    2022: (
        "4120ef19f3982225b8aab469df3e867c8322eebe8b769c0a6ff32da21edcdedb",
        "c3b23cd0252fc653c8dd190f0314810810a55888008bd0c3c4ef9625553db762",
        17520,
    ),
    2023: (
        "cf4b22e4d6abe8ccf1a1b5eace6a8f2f7c336985373f5518ff7e17ec88a10914",
        "95c0784f87f26920b3e8cc65363e1405619804c4f55c9c5cacd9d224c09d440a",
        17520,
    ),
    2024: (
        "2c856524d7c56aec62ff585c602b3065388c27811d18e46e0ddeecf6686aad5a",
        "b3ee919b973063b611bfe0105ae4b0ab52157a8bd7e19e33d501a8e2910a5af3",
        17568,
    ),
}

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
        ("site_code", "date", "type", "detail"),
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
            "nee_f_gc",
            "gpp_gc",
            "reco_gc",
        ),
        None,
    ),
    InputFile(
        "calculated",
        "management_carbon.csv",
        "87f481aec6ec5aa7c3779faa93c5a909bd53a8b379fa97c1e0e133281caa7c8a",
        46,
        (
            "site",
            "date",
            "year",
            "action",
            "product",
            "dry_mass_kg_ha",
            "c_fraction",
            "c_fraction_source",
            "c_g_m2",
        ),
        None,
    ),
    *(
        f
        for y, (h_flux, h_meas, n) in _SMEAR_HASHES.items()
        for f in (
            InputFile(
                "smear",
                f"HYY_EDDY233_NEE_GPP_{y}.csv",
                h_flux,
                n,
                (*_TIME, "HYY_EDDY233.GPP", "HYY_EDDY233.NEE"),
                None,
            ),
            InputFile(
                "smear",
                f"HYY_EDDYMAST_F_c_270_{y}.csv",
                h_meas,
                n,
                (*_TIME, "HYY_EDDYMAST.F_c_270"),
                None,
            ),
        )
    ),
)

# Units. annual.csv and management_carbon.csv have no unit field; docs/calculated.md gives
# g C m-2 yr-1 for the annual sums (factor 1800 s x 12.011e-6 g C umol-1) and g C m-2 for c_g_m2.
ANNUAL_UNIT = "g C m-2 yr-1"
KG_HA_TO_G_M2 = 0.1  # 1 kg ha-1 = 0.1 g m-2

# ---------- Method constants ----------
ALL_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
ACTIONS = ("harvest", "fertilisation", "grazing")
C_SOURCES = ("site", "assumed", "none")
MIN_FRAC = 0.2  # reliable: measured fraction >= MIN_FRAC (docs/calculated.md)
MAX_GAP_DAYS = 30.0  # reliable: longest gap <= MAX_GAP_DAYS
REF_SITE = "hyytiala"
REF_NAME = "Hyytiälä"
REF_SOURCE = "SMEAR II, HYY_EDDY233"
REF_YEARS = tuple(range(2019, 2025))
REF_FLUX_COLS = ("HYY_EDDY233.GPP", "HYY_EDDY233.NEE")
REF_MEAS_COL = "HYY_EDDYMAST.F_c_270"
REF_TIME_COLS = _TIME
HH_TO_GC = 1800 * 12.011e-6  # g C m-2 per 30-min value of 1 umol CO2 m-2 s-1
HALF_HOURS_PER_DAY = 48
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-9
# Heimsch et al. 2024 Table 1 uses years from 4 May to 3 May.
HEIMSCH_WINDOW_2020 = (date(2020, 5, 4), date(2021, 5, 3))

# Reference values from articles and documents. Each row: value, unit, uncertainty, reference id,
# page (page of the PDF), table or figure. Pages checked with pdftotext -f N -l N.
LITERATURE: tuple[dict[str, Any], ...] = (
    # --- SMEAR II Hyytiala thinning (Aalto et al. 2023, thinning description) ---
    {
        "key": "thinRemoval200m",
        "text": "Commercial removal (logs and pulpwood) of the 2020 thinning, mean of the plots "
        "in the 200 m radius of the tall tower",
        "value": 23.1,
        "unit": "Mg C ha-1",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 7",
        "tableFigure": "Table 3",
    },
    {
        "key": "thinRemovalAllPlots",
        "text": "Commercial removal, mean of all 43 plots; low end of the range",
        "value": 14.9,
        "unit": "Mg C ha-1",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 7",
        "tableFigure": "Table 3",
    },
    {
        "key": "thinRemovalThinnedPlots",
        "text": "Commercial removal, mean of the thinned plots (n = 26); high end of the range",
        "value": 24.4,
        "unit": "Mg C ha-1",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 7",
        "tableFigure": "Table 3",
    },
    {
        "key": "thinResidue200m",
        "text": "Cutting residue (with the understorey), 200 m radius; it was left at the site "
        "(p. 3) and is not an output",
        "value": 14.5,
        "unit": "Mg C ha-1",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 7; p. 3",
        "tableFigure": "Table 3",
    },
    {
        "key": "thinCarbonFraction",
        "text": "All biomasses converted to carbon with half of the dry mass",
        "value": 0.5,
        "unit": "g C g-1 DM",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 6",
        "tableFigure": None,
    },
    {
        "key": "thinYear",
        "text": "The thinning took place in February and March 2020; about 1 ha in the middle "
        "of the stand was thinned in December 2019 and January 2020 (all assigned to 2020)",
        "value": 2020,
        "unit": "year",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 2",
        "tableFigure": None,
    },
    {
        "key": "thinEarlyAreaHa",
        "text": "Area thinned already in December 2019 and January 2020",
        "value": 1,
        "unit": "ha",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 2",
        "tableFigure": None,
    },
    {
        "key": "thinShare200mPct",
        "text": "About 80 % of the forest area within the 200 m radius of the tall tower was "
        "thinned",
        "value": 80,
        "unit": "%",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 1",
        "tableFigure": None,
    },
    {
        "key": "clearing2019Output",
        "text": "Understorey clearing in spring 2019: all felled understorey trees were left "
        "on the ground (no output)",
        "value": 0,
        "unit": "g C m-2",
        "uncertainty": None,
        "ref": "aalto-thinning2023",
        "page": "p. 2",
        "tableFigure": None,
    },
    {
        "key": "dequesadaRemoval",
        "text": "Carbon removed in the thinning of the upland site (stem and bark); their NEP "
        "does not include the removed biomass (p. 3)",
        "value": 2.2,
        "unit": "kg C m-2",
        "uncertainty": 0.2,
        "ref": "dequesada2025",
        "page": "p. 7, Sect. 3.2",
        "tableFigure": None,
    },
    # --- Crop carbon fraction (Viikki) ---
    {
        "key": "cropCGao",
        "text": "Carbon content of the above-ground biomass used for the harvest carbon of the "
        "Viikki field (assumed)",
        "value": 0.45,
        "unit": "g C g-1 DM",
        "uncertainty": None,
        "ref": "gao2026",
        "page": "p. 7, Sect. 2.3",
        "tableFigure": None,
    },
    {
        "key": "cropCHeimsch",
        "text": "Carbon content of the Qvidja yield biomass (dry weight x 0.42)",
        "value": 0.42,
        "unit": "g C g-1 DM",
        "uncertainty": None,
        "ref": "heimsch2024",
        "page": "p. 4, Sect. 2.3",
        "tableFigure": None,
    },
    {
        "key": "cropCShurpaliMax",
        "text": "Average carbon content of the harvested grass, highest value of the three "
        "sites (Pappilansuo; Anttila and Sarkisuo 0.47)",
        "value": 0.48,
        "unit": "g C g-1 DM",
        "uncertainty": None,
        "ref": "shurpali2025",
        "page": "p. 8",
        "tableFigure": "Table 4",
    },
    # --- Manure (Viikki field; Gao et al. 2026, Vettikkat et al. 2026) ---
    {
        "key": "gaoManureDm",
        "text": "Dry mass of the manure applied to the Viikki field on 27 April 2023",
        "value": 1701,
        "unit": "kg DM ha-1",
        "uncertainty": None,
        "ref": "gao2026",
        "page": "p. 7, Sect. 2.3",
        "tableFigure": None,
    },
    {
        "key": "gaoOrganicFraction",
        "text": "Organic fraction of the dry mass of the manure (after Katterer et al. 2011)",
        "value": 0.799,
        "unit": "g g-1 DM",
        "uncertainty": None,
        "ref": "gao2026",
        "page": "p. 7, Sect. 2.3",
        "tableFigure": None,
    },
    {
        "key": "gaoCOfOrganic",
        "text": "Carbon in the organic fraction of the manure (after Katterer et al. 2011)",
        "value": 0.504,
        "unit": "g C g-1",
        "uncertainty": None,
        "ref": "gao2026",
        "page": "p. 7, Sect. 2.3",
        "tableFigure": None,
    },
    {
        "key": "gaoCManure2023",
        "text": "Carbon input of the manure in 2023 (Viikki field); the script checks that "
        "1701 x 0.799 x 0.504 gives this value",
        "value": 685,
        "unit": "kg C ha-1",
        "uncertainty": None,
        "ref": "gao2026",
        "page": "p. 6",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettVolumeSf",
        "text": "Separated solid fraction of cow manure applied to Alaniitty 1 on 27 April 2023",
        "value": 43,
        "unit": "m3 ha-1",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 2",
        "tableFigure": "Table 1",
    },
    {
        "key": "vettTanApplied",
        "text": "Total ammoniacal N of the applied solid fraction",
        "value": 18.5,
        "unit": "kg TAN ha-1",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 2",
        "tableFigure": "Table 1",
    },
    {
        "key": "vettDmRaw",
        "text": "Dry matter of the raw cow manure",
        "value": 0.085,
        "unit": "g g-1",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettDmSf",
        "text": "Dry matter of the solid fraction",
        "value": 0.325,
        "unit": "g g-1",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettDmLf",
        "text": "Dry matter of the liquid fraction",
        "value": 0.058,
        "unit": "g g-1",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettDensityRaw",
        "text": "Density of the raw manure and of the liquid fraction",
        "value": 1000,
        "unit": "kg m-3",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettDensitySf",
        "text": "Density of the solid fraction",
        "value": 280,
        "unit": "kg m-3",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettTanRaw",
        "text": "TAN of the raw manure (Table 2; the text of p. 3 gives 2.3, the table 2.2)",
        "value": 2.2,
        "unit": "kg m-3",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettTanSf",
        "text": "TAN of the solid fraction",
        "value": 0.43,
        "unit": "kg m-3",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettTanLf",
        "text": "TAN of the liquid fraction (Table 2; the text of p. 3 gives 2.2, the table 2.3)",
        "value": 2.3,
        "unit": "kg m-3",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    {
        "key": "vettNLf",
        "text": "Total N of the liquid fraction",
        "value": 3.6,
        "unit": "kg m-3",
        "uncertainty": None,
        "ref": "vettikkat2026",
        "page": "p. 3",
        "tableFigure": "Table 2",
    },
    # --- Qvidja inputs (Heimsch et al. 2024) ---
    {
        "key": "heimschInput2020",
        "text": "Management input (organic fertilisers) for 4 May 2020 to 3 May 2021; the carbon "
        "of the liquid fertilisers of 2018 to 2020 is in the input (p. 4)",
        "value": 110,
        "unit": "g C m-2 yr-1",
        "uncertainty": 15,
        "ref": "heimsch2024",
        "page": "p. 6",
        "tableFigure": "Table 1",
    },
    {
        "key": "heimschInput2021",
        "text": "Management input for 4 May 2021 to 3 May 2022 (no carbon from the broiler "
        "litter of May 2021)",
        "value": 2,
        "unit": "g C m-2 yr-1",
        "uncertainty": 0,
        "ref": "heimsch2024",
        "page": "p. 6",
        "tableFigure": "Table 1",
    },
    # --- Maktau (no NBE) ---
    {
        "key": "maktauYield2021",
        "text": "Maize yield of the dry long-rains season 2021 (Tuure et al. 2025, cited); "
        "2022 was a complete crop failure; no residue fate is given",
        "value": 0.22,
        "unit": "t ha-1",
        "uncertainty": None,
        "ref": "rasanen2026",
        "page": "p. 11, Sect. 4",
        "tableFigure": None,
    },
)


def literature_by_key() -> dict[str, dict[str, Any]]:
    """LITERATURE as an object keyed by `key`."""
    return {r["key"]: dict(r) for r in LITERATURE}


LIT = literature_by_key()


def lv(key: str) -> float:
    """Value of one LITERATURE row."""
    return float(LIT[key]["value"])


THINNING_YEAR = int(lv("thinYear"))
THINNING_KEY = f"{REF_SITE}-{THINNING_YEAR}"
MG_HA_TO_G_M2 = 100.0  # 1 Mg ha-1 = 100 g m-2

# Land use per site-year, from the project notes (CLAUDE.md, list of the sites); "label crop" =
# the text after the year in the figure label (None = a permanent grassland). Same as Deep
# Dive #9 (carbon-space).
SITE_CROP = {
    "anttila": "legume grassland",
    "sarkisuo": "mixed grasses",
    "qvidja": "forage grassland",
    "maktau": "maize",
}
CROPS: dict[tuple[str, int], tuple[str, str | None]] = {
    ("haltiala", 2021): ("barley", "barley"),
    ("haltiala", 2022): ("oats", "oats"),
    ("haltiala", 2023): ("grass (failed)", "grass (failed)"),
    ("haltiala", 2024): ("sunflower", "sunflower"),
    ("haltiala", 2025): ("oats", "oats"),
    ("viikki", 2022): ("timothy", None),
    ("viikki", 2023): ("barley / mixed grass / red clover", "barley"),
    ("viikki", 2024): ("grassland", None),
    ("viikki", 2025): ("faba bean", "faba bean"),
}
for _y in range(2014, 2026):
    CROPS[("maktau", _y)] = ("maize", "maize")
for _s, _years in (
    ("anttila", (2022, 2023)),
    ("sarkisuo", (2022, 2023)),
    ("qvidja", range(2018, 2026)),
):
    for _y in _years:
        CROPS[(_s, _y)] = (SITE_CROP[_s], None)
for _y in REF_YEARS:
    CROPS[(REF_SITE, _y)] = ("boreal forest", None)

OPEN_FINDINGS = (
    (
        "ANT-01, SAR-01, VII-01 (waits for the providers): the raw stamps of Anttila, Sarkisuo "
        "and Viikki are UTC, but the build reads them as UTC+2. A local calendar year of these "
        "sites thus starts 2 hours late. The annual NEE changes only by the 2 hours at the ends "
        "of the year (winter night values, small); the management terms do not change."
    ),
    (
        "QVI-11 (open question): the Qvidja annual NEE sums of the file are 25 to 109 g C m-2 "
        "more negative than Heimsch 2024 Table 1 (May-to-May years). The Qvidja NBE can thus be too "
        "low by a similar amount."
    ),
    (
        "VII-05 (known, verified): Viikki 2024 nee_f is not equal to nee in 1 540 periods; the "
        "annual NEE is 20.4 instead of 22.5 g C m-2 (2 g C m-2)."
    ),
    (
        "Viikki NEE unit: the file headers give mg CO2 m-2 s-1; the build converts with "
        "1000 / 44.0095 (docs/harmonised-database.md). If the unit were wrong, the Viikki NEE "
        "would scale, but not the management terms."
    ),
)

# ---------- Figure ----------
FONT_STACK = (
    "system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', "
    "'Noto Color Emoji'"
)
FONT_SCALE = 1.5  # fonts for slides: 1.5 x the dive default (as Deep Dive #9)
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
SHIFT = "#a6a6a6"  # the grey line from the NEE position to the NBE position
MARKER_SIZE = 13
MARKER_EDGE = 0.8
HOLLOW_EDGE = 2.0  # edge width of a hollow (class B) marker
MARKER_ZORDER = {"haltiala": 3.5}
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
FIG1_HEIGHT_IN = 210 * MM
FIGURES = ((1, "nbe-carbon-space"),)
REF_COLOR = "#009e73"
REF_MARKER = "*"
REF_MARKER_SIZE = 19
REF_ZORDER = 2.5
SITE_EMOJI = {
    "anttila": "👱🏻‍♂️🫛",
    "sarkisuo": "🐟🌱",
    "haltiala": "🧚🌾",
    "qvidja": "🐂🐝",
    "viikki": "👩🏻‍🔬🎓",
    "maktau": "🇰🇪🌽",
    REF_SITE: "🌲🍄",
}
REF_LEGEND = f"{SITE_EMOJI[REF_SITE]} {REF_NAME}\n(forest)"
# Axis ranges (g C m-2 yr-1). x as Deep Dive #9; y up to the Hyytiala 2020 whisker. The script
# stops when a marker or a whisker end is outside.
X_LO, X_HI, X_TICK = 600.0, 1600.0, 200.0
Y_LO, Y_HI, Y_TICK = 400.0, 3600.0, 400.0
NBE_GUIDES = (-200.0, -400.0)
GUIDE_LABEL_X = 1530.0  # x of the NBE guide labels (empty area of the plot)
X_LABEL = r"Annual GPP (g C m$^{-2}$ yr$^{-1}$)"
Y_LABEL = r"Annual carbon out, TER + C$_{out}$ − C$_{in}$ (g C m$^{-2}$ yr$^{-1}$)"
X_AXIS_TEXT = "annual GPP (g C m−2 yr−1)"
Y_AXIS_TEXT = (
    "annual carbon out = TER + C_out − C_in (total ecosystem respiration plus the carbon "
    "that management takes out, minus the carbon that it brings in; g C m−2 yr−1)"
)
GRID = "#e2e2e2"
GRID_LW = 0.6
# Label offsets from the marker (points: dx, dy, horizontal alignment). Set by hand after a
# look at the figure. A site-year without an entry has no label.
CLUSTER_KEY = f"{REF_SITE}-{REF_YEARS[-1]}"
PRE_THINNING_KEY = f"{REF_SITE}-{REF_YEARS[0]}"
CLUSTER_TEXT = f"{THINNING_YEAR + 1}–{REF_YEARS[-1]}"
LABEL_OFFSETS: dict[str, tuple[float, float, str]] = {
    "anttila-2022": (11, 0, "left"),
    "anttila-2023": (11, 0, "left"),
    "sarkisuo-2022": (-11, 0, "right"),
    "haltiala-2022": (11, 0, "left"),
    "haltiala-2023": (-8, 20, "left"),
    "haltiala-2024": (0, -17, "center"),
    "haltiala-2025": (11, 0, "left"),
    "qvidja-2020": (11, 0, "left"),
    "qvidja-2022": (0, -18, "center"),
    "qvidja-2023": (11, 0, "left"),
    "qvidja-2024": (11, 0, "left"),
    "qvidja-2025": (11, 0, "left"),
    "viikki-2024": (11, 0, "left"),
    "viikki-2025": (-11, 0, "right"),
    PRE_THINNING_KEY: (14, -24, "left"),
    THINNING_KEY: (14, 0, "left"),
    CLUSTER_KEY: (12, -14, "left"),
}
LABEL_TEXT = {
    PRE_THINNING_KEY: f"{REF_YEARS[0]} (pre-thinning)",
    THINNING_KEY: f"{THINNING_YEAR} (thinning)",
    CLUSTER_KEY: CLUSTER_TEXT,
}
LEADER_KEYS = frozenset({PRE_THINNING_KEY})
WRAP_LABELS: frozenset[str] = frozenset()
FIG1_TITLE = (
    "Annual carbon out (total ecosystem respiration TER plus the carbon that management takes "
    "out, minus the carbon that it brings in) against annual gross primary production (GPP), "
    "one marker per site-year, with the SMEAR II Hyytiälä forest as a reference; below the "
    "1:1 line the site-year was a net carbon sink (NBE < 0)."
)

log = logging.getLogger(SLUG)


# ======================================================================================
# Input check
# ======================================================================================
class InputError(Exception):
    """An input file does not agree with INPUTS or DATABASE, or a rule of the method fails."""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def csv_data_rows(path: Path) -> int:
    """Number of data rows of a CSV file (a quoted field can hold a line end)."""
    return len(pd.read_csv(path, dtype=str, keep_default_na=False))


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


def num_or_none(v: Any) -> float | None:
    if v is None:
        return None
    f = float(v)
    return None if math.isnan(f) else f


def site_year_key(site: str, year: int) -> str:
    return f"{site}-{year}"


def reliable_rule(frac_measured: float, longest_gap_days: float) -> bool:
    """The reliable flag of annual.csv (docs/calculated.md)."""
    return frac_measured >= MIN_FRAC and longest_gap_days <= MAX_GAP_DAYS


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


@dataclass(frozen=True)
class Term:
    """One management carbon term of a site-year (g C m-2). `low` and `high` are the values
    that give the lowest and the highest NBE."""

    kind: str  # "out" or "in"
    date: str
    product: str
    value: float
    low: float
    high: float
    assumption: str | None  # key of ASSUMPTION_TEXT, None = site data

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "date": self.date,
            "product": self.product,
            "value": self.value,
            "valueAtLowNbe": self.low,
            "valueAtHighNbe": self.high,
            "assumption": self.assumption,
        }


def nbe_of(
    nee: float, terms: Sequence[Term]
) -> tuple[float, float, float, float, float]:
    """NBE, low NBE, high NBE, C_out and C_in from NEE and the terms."""
    c_out = sum(t.value for t in terms if t.kind == "out")
    c_in = sum(t.value for t in terms if t.kind == "in")
    sign = {"out": 1.0, "in": -1.0}
    low = nee + sum(sign[t.kind] * t.low for t in terms)
    high = nee + sum(sign[t.kind] * t.high for t in terms)
    return nee + c_out - c_in, low, high, c_out, c_in


def manure_c_fraction() -> float:
    """Carbon fraction of manure dry mass: organic fraction x C in organic matter (Gao)."""
    return lv("gaoOrganicFraction") * lv("gaoCOfOrganic")


def parse_kg_n(product: str, kind: str) -> float:
    """kg N/ha of `kind` ("dry manure" or "liquid manure") in a Viikki product text."""
    m = re.search(rf"{kind} \((\d+(?:\.\d+)?) kg N/ha", product)
    if not m:
        raise InputError(f"no '{kind} (... kg N/ha' in product {product!r}")
    return float(m.group(1))


MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


def dry_manure_date(product: str, year: int) -> date:
    """Date of the dry manure in a Viikki product text such as "dry manure (22.5 kg N/ha, 9 Oct)"."""
    m = re.search(
        r"dry manure \([^)]*?, (\d{1,2}) (" + "|".join(MONTHS) + r")\)", product
    )
    if not m:
        raise InputError(f"no dry manure date in product {product!r}")
    return date(year, MONTHS.index(m.group(2)) + 1, int(m.group(1)))


def parse_animals(product: str) -> tuple[str, int, int]:
    """(species, animals, days) of a grazing product text such as "20 highland cows, 12 days"."""
    m = re.search(r"(\d+) (horses|cows|highland cows), (\d+) days?", product)
    if not m:
        raise InputError(f"no animals and days in product {product!r}")
    species = "horse" if m.group(2) == "horses" else "cattle"
    return species, int(m.group(1)), int(m.group(3))


def parse_volume_range(detail: str) -> tuple[float, float]:
    """(stated volume, largest possible volume) in m3/ha of an event detail such as
    "Manure, 10 m3/ha (could be 45-60 m3/ha), ..."."""
    m = re.search(r"(\d+) m3/ha \(could be (\d+)-(\d+) m3/ha\)", detail)
    if not m:
        raise InputError(f"no volume range in event detail {detail!r}")
    return float(m.group(1)), float(m.group(3))


# ======================================================================================
# Read
# ======================================================================================
ANNUAL_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(ALL_SITES)),
        "year": pa.Column(int, pa.Check.in_range(2014, 2025)),
        "full_year": pa.Column(bool),
        "reliable": pa.Column(bool),
        "frac_measured": pa.Column(float, pa.Check.in_range(0, 1)),
        "longest_gap_days": pa.Column(float, pa.Check.ge(0)),
        "nee_f_gc": pa.Column(float, nullable=True),
        "gpp_gc": pa.Column(float, nullable=True),
        "reco_gc": pa.Column(float, nullable=True),
    },
    strict=True,
    unique=["site_code", "year"],
)
MGMT_SCHEMA = pa.DataFrameSchema(
    {
        "site": pa.Column(str, pa.Check.isin(ALL_SITES)),
        "date": pa.Column(object),
        "year": pa.Column(int, pa.Check.in_range(2014, 2025)),
        "action": pa.Column(str, pa.Check.isin(ACTIONS)),
        "product": pa.Column(str),
        "dry_mass_kg_ha": pa.Column(float, pa.Check.ge(0), nullable=True),
        "c_fraction": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
        "c_fraction_source": pa.Column(str, pa.Check.isin(C_SOURCES)),
        "c_g_m2": pa.Column(float, pa.Check.ge(0), nullable=True),
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


def columns_of(key: str) -> list[str]:
    return list(next(i for i in INPUTS if i.key == key).columns)


@dataclass
class Data:
    names: dict[str, str]
    slots: dict[str, int]
    annual: pd.DataFrame
    mgmt: pd.DataFrame
    haltiala_manure_detail: str
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


def read_manure_detail(db: Path, steps: dict[str, Any]) -> str:
    """The detail text of the Haltiala 2023 manure event that gives the volume range."""
    ev = pd.read_parquet(
        db / "events.parquet",
        columns=columns_of("db/events.parquet"),
        filters=[("site_code", "==", "haltiala"), ("type", "==", "fertilisation")],
        engine="pyarrow",
    )
    ev["date"] = pd.to_datetime(ev["date"]).dt.date
    hits = [
        str(r["detail"])
        for r in ev.to_dict("records")
        if r["date"].year == 2023 and "could be" in str(r["detail"])
    ]
    if len(hits) != 1:
        raise InputError(
            f"events.parquet: expected 1 Haltiala 2023 volume range, got {hits}"
        )
    steps["events"] = {
        "rowsRead": len(ev),
        "rule": "Haltiala fertilisation events; only the 2023 detail with the volume range "
        "is used (assumption e)",
    }
    return hits[0]


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
        "rowsWithoutNee": int(col(df, "nee_f_gc").isna().sum()),
        "rule": "one row per site and local calendar year; a row without nee_f_gc has no NBE",
    }
    log.info(
        "annual: %d site-years read (%d without annual NEE)",
        len(df),
        steps["annual"]["rowsWithoutNee"],
    )
    return df


def read_mgmt(calculated: Path, steps: dict[str, Any]) -> pd.DataFrame:
    df = pd.read_csv(
        calculated / "management_carbon.csv",
        usecols=columns_of("calculated/management_carbon.csv"),
        encoding="utf-8",
        dtype={"site": str, "action": str, "product": str, "c_fraction_source": str},
    )
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for c in ("dry_mass_kg_ha", "c_fraction", "c_g_m2"):
        df[c] = df[c].astype(float)
    df = pd.DataFrame(MGMT_SCHEMA.validate(df))
    bad = [r for r in df.to_dict("records") if r["date"].year != r["year"]]
    if bad:
        raise InputError(
            f"management_carbon.csv: year is not the year of the date: {bad}"
        )
    n_site = int(
        ((col(df, "c_fraction_source") == "site") & col(df, "c_g_m2").notna()).sum()
    )
    steps["management"] = {
        "rowsRead": len(df),
        "rowsSiteData": n_site,
        "rowsReplaced": len(df) - n_site,
        "rule": "rows with c_fraction_source 'site' and a c_g_m2 value are used as they are; "
        "the other rows are replaced by the assumption of the row",
    }
    log.info(
        "management_carbon: %d rows read, %d site data, %d replaced by an assumption",
        len(df),
        n_site,
        len(df) - n_site,
    )
    return df


def longest_run(missing: np.ndarray) -> int:
    """Length of the longest run of True values."""
    best = run = 0
    for m in missing:
        run = run + 1 if m else 0
        best = max(best, run)
    return best


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


def hyytiala_annual(
    flux: pd.DataFrame, meas: pd.DataFrame, year: int
) -> dict[str, Any]:
    """Annual row of one Hyytiala year from the 30-min rows. A sum is None when a half hour has
    no value."""
    hh = flux.merge(meas, on="ts", how="outer", validate="one_to_one").sort_values("ts")
    hh["reco"] = hh["nee"] + hh["gpp"]
    n_expected = len(pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D")) * 48

    def year_sum(c: str) -> float | None:
        v = col(hh, c)
        return float(v.sum()) * HH_TO_GC if v.notna().all() else None

    measured = col(hh, "fc").notna().to_numpy()
    frac = float(measured.sum() / len(hh))
    gap = longest_run(~measured) / HALF_HOURS_PER_DAY
    return {
        "site_code": REF_SITE,
        "year": year,
        "full_year": len(hh) == n_expected,
        "reliable": reliable_rule(frac, gap),
        "frac_measured": frac,
        "longest_gap_days": gap,
        "nee_f_gc": year_sum("nee"),
        "gpp_gc": year_sum("gpp"),
        "reco_gc": year_sum("reco"),
    }


def read_hyytiala(smear: Path, steps: dict[str, Any]) -> pd.DataFrame:
    annual: list[dict[str, Any]] = []
    per_year: dict[str, Any] = {}
    for y in REF_YEARS:
        f = read_smear_csv(smear / f"HYY_EDDY233_NEE_GPP_{y}.csv", REF_FLUX_COLS)
        m = read_smear_csv(smear / f"HYY_EDDYMAST_F_c_270_{y}.csv", (REF_MEAS_COL,))
        flux = pd.DataFrame(
            {"ts": f["ts"], "nee": f["HYY_EDDY233.NEE"], "gpp": f["HYY_EDDY233.GPP"]}
        )
        meas = pd.DataFrame({"ts": m["ts"], "fc": m[REF_MEAS_COL]})
        a = hyytiala_annual(flux, meas, y)
        annual.append(a)
        per_year[str(y)] = {
            "halfHours": len(f),
            "neeMissing": int(col(f, "HYY_EDDY233.NEE").isna().sum()),
            "gppMissing": int(col(f, "HYY_EDDY233.GPP").isna().sum()),
            "measuredHalfHours": int(col(m, REF_MEAS_COL).notna().sum()),
        }
        log.info(
            "hyytiala %d: NEE %s, GPP %s, TER %s g C m-2 yr-1, measured fraction %.3f",
            y,
            fmt(a["nee_f_gc"]),
            fmt(a["gpp_gc"]),
            fmt(a["reco_gc"]),
            a["frac_measured"],
        )
    steps["hyytiala"] = {
        "source": REF_SOURCE,
        "years": per_year,
        "rule": "no row is removed; a half hour without NEE or GPP makes the annual sum NULL; "
        "NaN or empty F_c_270 = not measured",
    }
    return pd.DataFrame(annual)


def read_data(db: Path, calculated: Path, smear: Path) -> Data:
    steps: dict[str, Any] = {}
    names = read_sites(db)
    names[REF_SITE] = REF_NAME
    slots = {s: i for i, s in enumerate(ALL_SITES)}
    detail = read_manure_detail(db, steps)
    annual = read_annual(calculated, steps)
    mgmt = read_mgmt(calculated, steps)
    ref_annual = read_hyytiala(smear, steps)
    return Data(names, slots, annual, mgmt, detail, ref_annual, steps)


# ======================================================================================
# Assumptions (METHOD step 4)
# ======================================================================================
ASSUMPTION_TEXT = {
    "a-viikki-crop-c": "Viikki crop carbon: dry mass x 0.45 (Gao et al. 2026); range 0.42 "
    "(Heimsch et al. 2024) to 0.48 (Shurpali et al. 2025)",
    "c-viikki-manure-2023": "Viikki 2023 dry manure: 1701 kg DM/ha (Gao et al. 2026) x 0.4027 "
    "g C/g DM; larger input from 43 m3/ha of solid fraction (Vettikkat et al. 2026)",
    "d-viikki-dry-manure-2024": "Viikki 2024 dry manure: kg N/ha x DM per kg N of 2023 (Gao et "
    "al. 2026) x 0.4027; larger input with the solid-fraction DM per kg TAN (Vettikkat et al. "
    "2026)",
    "d-viikki-liquid-manure-2024": "Viikki 2024 liquid manure: kg N/ha as TAN x DM per kg TAN of "
    "the liquid fraction x 0.4027; range raw manure per TAN to liquid fraction per total N "
    "(Vettikkat et al. 2026)",
    "e-haltiala-manure-2023": "Haltiala 2023 manure: 10 m3/ha x 85 kg DM/m3 (raw cow manure) "
    "x 0.4027; range 10 m3/ha x 58 kg to 60 m3/ha x 91 kg DM/m3 (Vettikkat et al. 2026; "
    "volume note of the management file)",
    "f-qvidja-npk-2020": "Qvidja 2020 NPK mix: 110 ± 15 g C m-2 input of Heimsch et al. 2024 "
    "minus the compost row of the same window",
    "g-qvidja-litter-2021": "Qvidja 2021 broiler litter: 2640 kg DM/ha x 0.4027; range 0 "
    "(Heimsch et al. 2024 input) to DM x 0.504",
    "h-qvidja-compost-2023": "Qvidja 2023 compost fibre: C 0.30 of DM (management file); range "
    "= C fraction of the other Qvidja composts",
    "i-qvidja-grazing-2025": "Qvidja 2025 grazing: rates per animal-day from the quantified "
    "Qvidja grazing rows of 2021, 2022 and 2024",
    "partial-year": "Partial year: NEE covers only part of the calendar year",
    "hyytiala-thinning-2020": "Hyytiälä 2020 thinning: commercial removal 23.1 Mg C/ha (200 m "
    "radius); range 14.9 to 24.4 (Aalto et al. 2023, Table 3)",
}


def site_rows(mgmt: pd.DataFrame, site: str) -> list[dict[str, Any]]:
    return [r for r in mgmt.to_dict("records") if r["site"] == site]


def compost_c_fractions(mgmt: pd.DataFrame) -> list[float]:
    """Carbon fraction of DM of the Qvidja compost rows with site data."""
    return sorted(
        float(r["c_g_m2"]) / KG_HA_TO_G_M2 / float(r["dry_mass_kg_ha"])
        for r in site_rows(mgmt, "qvidja")
        if r["action"] == "fertilisation"
        and "compost" in str(r["product"]).lower()
        and r["c_fraction_source"] == "site"
        and num_or_none(r["c_g_m2"]) is not None
        and (num_or_none(r["dry_mass_kg_ha"]) or 0) > 0
    )


def grazing_rates(mgmt: pd.DataFrame) -> list[dict[str, Any]]:
    """Removal and excreta per animal-day of the quantified Qvidja grazing rows (g C m-2)."""
    out: list[dict[str, Any]] = []
    rows = site_rows(mgmt, "qvidja")
    for r in rows:
        if r["action"] != "harvest" or not str(r["product"]).startswith(
            "grazing removal"
        ):
            continue
        ret = [
            x
            for x in rows
            if x["action"] == "fertilisation"
            and x["date"] == r["date"]
            and str(x["product"]).startswith("grazing excreta")
        ]
        if len(ret) != 1:
            raise InputError(f"Qvidja grazing {r['date']}: no single excreta row")
        species, animals, days = parse_animals(str(r["product"]))
        ad = animals * days
        removal, excreta = float(r["c_g_m2"]), float(ret[0]["c_g_m2"])
        out.append(
            {
                "date": r["date"].isoformat(),
                "species": species,
                "animals": animals,
                "days": days,
                "animalDays": ad,
                "removal": removal,
                "excreta": excreta,
                "removalPerAnimalDay": removal / ad,
                "excretaPerAnimalDay": excreta / ad,
                "netPerAnimalDay": (removal - excreta) / ad,
            }
        )
    return out


def assumption_terms(
    r: dict[str, Any], mgmt: pd.DataFrame, detail: str, derived: dict[str, Any]
) -> list[Term]:
    """The terms that replace one management row without site carbon data. Raises
    InputError when the row has no assumption."""
    site, d, action = str(r["site"]), r["date"], str(r["action"])
    product = str(r["product"])
    iso = d.isoformat()
    f_c = manure_c_fraction()
    if site == "viikki" and action == "harvest" and r["c_fraction_source"] == "assumed":
        dm = float(r["dry_mass_kg_ha"]) * KG_HA_TO_G_M2
        return [
            Term(
                "out",
                iso,
                product,
                dm * lv("cropCGao"),
                dm * lv("cropCHeimsch"),
                dm * lv("cropCShurpaliMax"),
                "a-viikki-crop-c",
            )
        ]
    if site == "viikki" and action == "fertilisation" and d.year == 2023:
        central = lv("gaoManureDm") * f_c * KG_HA_TO_G_M2
        sf = lv("vettVolumeSf") * lv("vettDensitySf") * lv("vettDmSf")
        return [
            Term(
                "in",
                iso,
                "dry manure",
                central,
                sf * f_c * KG_HA_TO_G_M2,
                central,
                "c-viikki-manure-2023",
            )
        ]
    if site == "viikki" and action == "fertilisation" and d.year == 2024:
        n_dry = parse_kg_n(product, "dry manure")
        n_liq = parse_kg_n(product, "liquid manure")
        dm_per_n_dry = lv("gaoManureDm") / derived["viikkiN2023"]
        dm_per_tan_sf = lv("vettDensitySf") * lv("vettDmSf") / lv("vettTanSf")
        dm_per_tan_lf = lv("vettDensityRaw") * lv("vettDmLf") / lv("vettTanLf")
        dm_per_tan_raw = lv("vettDensityRaw") * lv("vettDmRaw") / lv("vettTanRaw")
        dm_per_n_lf = lv("vettDensityRaw") * lv("vettDmLf") / lv("vettNLf")
        k = f_c * KG_HA_TO_G_M2
        return [
            Term(
                "in",
                dry_manure_date(product, d.year).isoformat(),
                "dry manure",
                n_dry * dm_per_n_dry * k,
                n_dry * dm_per_tan_sf * k,
                n_dry * dm_per_n_dry * k,
                "d-viikki-dry-manure-2024",
            ),
            Term(
                "in",
                iso,
                "liquid manure",
                n_liq * dm_per_tan_lf * k,
                n_liq * dm_per_tan_raw * k,
                n_liq * dm_per_n_lf * k,
                "d-viikki-liquid-manure-2024",
            ),
        ]
    if site == "haltiala" and action == "fertilisation" and d.year == 2023:
        m = re.search(r"manure, (\d+) m3/ha", product)
        if not m:
            raise InputError(f"Haltiala 2023: no volume in {product!r}")
        vol = float(m.group(1))
        vol_stated, vol_max = parse_volume_range(detail)
        if vol_stated != vol:
            raise InputError(
                f"Haltiala 2023: volume {vol} != event detail {vol_stated}"
            )
        dm_raw = lv("vettDensityRaw") * lv("vettDmRaw")
        dm_lf = lv("vettDensityRaw") * lv("vettDmLf")
        dm_sf = lv("vettDensitySf") * lv("vettDmSf")
        k = f_c * KG_HA_TO_G_M2
        return [
            Term(
                "in",
                iso,
                product,
                vol * dm_raw * k,
                vol_max * max(dm_raw, dm_lf, dm_sf) * k,
                vol * min(dm_raw, dm_lf, dm_sf) * k,
                "e-haltiala-manure-2023",
            )
        ]
    if site == "qvidja" and action == "fertilisation" and d.year == 2020:
        lo, hi = HEIMSCH_WINDOW_2020
        known = sum(
            float(x["c_g_m2"])
            for x in site_rows(mgmt, "qvidja")
            if x["action"] == "fertilisation"
            and lo <= x["date"] <= hi
            and x["c_fraction_source"] == "site"
            and num_or_none(x["c_g_m2"]) is not None
        )
        total, unc = (
            lv("heimschInput2020"),
            float(LIT["heimschInput2020"]["uncertainty"]),
        )
        derived["qvidjaKnownInput2020"] = known
        return [
            Term(
                "in",
                iso,
                product,
                max(0.0, total - known),
                max(0.0, total + unc - known),
                max(0.0, total - unc - known),
                "f-qvidja-npk-2020",
            )
        ]
    if site == "qvidja" and action == "fertilisation" and d.year == 2021:
        dm = float(r["dry_mass_kg_ha"]) * KG_HA_TO_G_M2
        return [
            Term(
                "in",
                iso,
                product,
                dm * f_c,
                dm * lv("gaoCOfOrganic"),
                0.0,
                "g-qvidja-litter-2021",
            )
        ]
    if site == "qvidja" and action == "fertilisation" and d.year == 2023:
        dm = float(r["dry_mass_kg_ha"]) * KG_HA_TO_G_M2
        fr = compost_c_fractions(mgmt)
        if len(fr) < 2:
            raise InputError("Qvidja compost: fewer than 2 site-data compost rows")
        derived["compostCFractions"] = fr
        return [
            Term(
                "in",
                iso,
                product,
                dm * float(r["c_fraction"]),
                dm * max(fr),
                dm * min(fr),
                "h-qvidja-compost-2023",
            )
        ]
    if site == "qvidja" and action == "grazing" and d.year == 2025:
        rates = derived["grazingRates"]
        species, animals, days = parse_animals(product)
        ad = animals * days
        same = [x for x in rates if x["species"] == species]
        if not same:
            raise InputError(f"Qvidja grazing: no quantified row of {species}")
        rem = float(np.mean([x["removalPerAnimalDay"] for x in same]))
        exc = float(np.mean([x["excretaPerAnimalDay"] for x in same]))
        lo_row = min(rates, key=lambda x: x["netPerAnimalDay"])
        hi_row = max(rates, key=lambda x: x["netPerAnimalDay"])
        return [
            Term(
                "out",
                iso,
                f"grazing removal, {product}",
                ad * rem,
                ad * lo_row["removalPerAnimalDay"],
                ad * hi_row["removalPerAnimalDay"],
                "i-qvidja-grazing-2025",
            ),
            Term(
                "in",
                iso,
                f"grazing excreta return, {product}",
                ad * exc,
                ad * lo_row["excretaPerAnimalDay"],
                ad * hi_row["excretaPerAnimalDay"],
                "i-qvidja-grazing-2025",
            ),
        ]
    raise InputError(f"no assumption for {site} {iso} {action} {product!r}")


# ======================================================================================
# Analysis
# ======================================================================================
def nn(x: Any) -> float | None:
    return num_or_none(x)


def site_year_terms(
    site: str, year: int, mgmt: pd.DataFrame, detail: str, derived: dict[str, Any]
) -> tuple[list[Term], dict[str, float]]:
    """All terms of one site-year, and the sums of the file values (for the NECB test)."""
    terms: list[Term] = []
    file_out = file_in = 0.0
    for r in site_rows(mgmt, site):
        if int(r["year"]) != year:
            continue
        c = nn(r["c_g_m2"])
        if c is not None and r["action"] == "harvest":
            file_out += c
        if c is not None and r["action"] == "fertilisation":
            file_in += c
        if r["c_fraction_source"] == "site" and c is not None:
            kind = "out" if r["action"] == "harvest" else "in"
            if r["action"] not in ("harvest", "fertilisation"):
                raise InputError(
                    f"{site} {r['date']}: site data with action {r['action']}"
                )
            terms.append(
                Term(kind, r["date"].isoformat(), str(r["product"]), c, c, c, None)
            )
        else:
            terms.extend(assumption_terms(r, mgmt, detail, derived))
    return terms, {"cOutFile": file_out, "cInFile": file_in}


def analyse(data: Data) -> dict[str, Any]:
    steps = data.steps
    derived: dict[str, Any] = {
        "manureCFraction": manure_c_fraction(),
        "grazingRates": grazing_rates(data.mgmt),
    }
    gao_c = lv("gaoManureDm") * manure_c_fraction()
    if not math.isclose(gao_c, lv("gaoCManure2023"), rel_tol=2e-3):
        raise InputError(f"Gao et al. 2026: 1701 x 0.799 x 0.504 = {gao_c}, not 685")
    viikki_2023 = [
        r
        for r in site_rows(data.mgmt, "viikki")
        if r["action"] == "fertilisation" and r["date"].year == 2023
    ]
    if len(viikki_2023) != 1:
        raise InputError("Viikki 2023: expected one fertilisation row")
    derived["viikkiN2023"] = parse_kg_n(str(viikki_2023[0]["product"]), "dry manure")
    if abs(derived["viikkiN2023"] - lv("vettTanApplied")) > 0.5:
        raise InputError(
            "Viikki 2023: the file N does not agree with the TAN of Vettikkat"
        )

    sorted_annual = data.annual.sort_values(
        ["site_code", "year"],
        key=lambda c: c.map(ALL_SITES.index) if c.name == "site_code" else c,
    )
    all_rows = [
        *sorted_annual.to_dict("records"),
        *data.ref_annual.to_dict("records"),
    ]
    rows: list[dict[str, Any]] = []
    for r in all_rows:
        site, year = str(r["site_code"]), int(r["year"])
        nee, gpp, ter = nn(r["nee_f_gc"]), nn(r["gpp_gc"]), nn(r["reco_gc"])
        full, reliable = bool(r["full_year"]), bool(r["reliable"])
        crop, label = CROPS[(site, year)]
        if site == REF_SITE:
            file_sums = {"cOutFile": None, "cInFile": None}
            if year == THINNING_YEAR:
                to_g = MG_HA_TO_G_M2
                terms = [
                    Term(
                        "out",
                        f"{THINNING_YEAR}-03-31",
                        "thinning, commercial removal (logs and pulpwood)",
                        lv("thinRemoval200m") * to_g,
                        lv("thinRemovalAllPlots") * to_g,
                        lv("thinRemovalThinnedPlots") * to_g,
                        "hyytiala-thinning-2020",
                    )
                ]
            else:
                terms = []
        else:
            terms, fs = site_year_terms(
                site, year, data.mgmt, data.haltiala_manure_detail, derived
            )
            file_sums = dict(fs)
        reason: str | None = None
        if nee is None:
            reason = "no annual NEE sum"
        elif site == "maktau":
            reason = (
                "no yield, residue or input data (no Maktau row in management_carbon.csv; "
                "Räsänen et al. 2026 give only a 2021 yield and a 2022 crop failure, without "
                "the residue fate)"
            )
        assumptions = sorted({t.assumption for t in terms if t.assumption})
        if reason is None and not full:
            assumptions.append("partial-year")
        if reason is None and nee is not None:
            nbe, low, high, c_out, c_in = nbe_of(nee, terms)
            cls = "A" if not assumptions else "B"
        else:
            nbe = low = high = c_out = c_in = None
            cls = None
        fig_reasons: list[str] = []
        if nbe is None:
            fig_reasons.append("no NBE")
        if not full:
            fig_reasons.append("partial year")
        if not reliable:
            fig_reasons.append(
                "not reliable (measured fraction < 0.2 or longest gap > 30 d)"
            )
        if nbe is not None and (gpp is None or ter is None):
            fig_reasons.append("no annual GPP or TER sum")
        in_fig = not fig_reasons
        rows.append(
            {
                "key": site_year_key(site, year),
                "site": site,
                "siteName": data.names[site],
                "year": year,
                "crop": crop,
                "cropLabel": label,
                "fullYear": full,
                "reliable": reliable,
                "fracMeasured": float(r["frac_measured"]),
                "longestGapDays": float(r["longest_gap_days"]),
                "gpp": gpp,
                "ter": ter,
                "nee": nee,
                "cOut": c_out,
                "cIn": c_in,
                "cNet": None if c_out is None or c_in is None else c_out - c_in,
                "nbe": nbe,
                "nbeLow": low,
                "nbeHigh": high,
                "carbonOut": None
                if ter is None or nbe is None or nee is None
                else ter + nbe - nee,
                "class": cls,
                "assumptions": assumptions,
                "nbeReason": reason,
                "inFigure": in_fig,
                "figureReason": None if in_fig else "; ".join(fig_reasons),
                "terms": [t.to_json() for t in terms],
                **file_sums,
            }
        )
    with_nbe = [r for r in rows if r["nbe"] is not None]
    fig_rows = [r for r in rows if r["inFigure"]]
    agri_fig = [r for r in fig_rows if r["site"] != REF_SITE]
    ref_fig = [r for r in fig_rows if r["site"] == REF_SITE]
    for r in fig_rows:
        for v in (r["gpp"], r["carbonOut"]):
            if v is None:
                raise InputError(f"{r['key']}: in the figure without GPP or carbon out")
        y_lo = r["ter"] + r["nbeLow"] - r["nee"]
        y_hi = r["ter"] + r["nbeHigh"] - r["nee"]
        if not (X_LO <= r["gpp"] <= X_HI and Y_LO <= y_lo and y_hi <= Y_HI):
            raise InputError(
                f"{r['key']}: outside the axis ranges (GPP {r['gpp']:.0f}, y {y_lo:.0f} to "
                f"{y_hi:.0f})"
            )
    steps["nbe"] = {
        "siteYears": len(rows),
        "withNbe": len(with_nbe),
        "withoutNbe": len(rows) - len(with_nbe),
        "inFigure": len(fig_rows),
        "rule": "NBE when the site-year has an annual NEE and management carbon data or an "
        "assumption for each management row (not Maktau); figure: full_year AND reliable AND "
        "GPP and TER sums AND NBE",
    }
    log.info(
        "NBE: %d site-years, %d with NBE (class A %d, B %d), %d in the figure",
        len(rows),
        len(with_nbe),
        sum(1 for r in with_nbe if r["class"] == "A"),
        sum(1 for r in with_nbe if r["class"] == "B"),
        len(fig_rows),
    )
    hy = next(r for r in rows if r["key"] == THINNING_KEY)
    s_nbe = plain_stats(r["nbe"] for r in agri_fig)
    by_nbe = sorted(agri_fig, key=lambda r: r["nbe"])
    by_shift = sorted(agri_fig, key=lambda r: r["cNet"])
    sink_to_source = [r for r in agri_fig if r["nee"] < 0 < r["nbe"]]
    source_to_sink = [r for r in agri_fig if r["nbe"] < 0 < r["nee"]]
    summary = {
        "nSiteYears": len(rows),
        "nWithNbe": len(with_nbe),
        "nWithoutNbe": len(rows) - len(with_nbe),
        "nClassA": sum(1 for r in with_nbe if r["class"] == "A"),
        "nClassB": sum(1 for r in with_nbe if r["class"] == "B"),
        "nFigure": len(fig_rows),
        "nFigureSites": len(agri_fig),
        "nFigureHyytiala": len(ref_fig),
        "nFigureClassA": sum(1 for r in agri_fig if r["class"] == "A"),
        "nFigureClassB": sum(1 for r in agri_fig if r["class"] == "B"),
        "nNotInFigureWithNbe": sum(1 for r in with_nbe if not r["inFigure"]),
        "figureSites": {
            "nee": plain_stats(r["nee"] for r in agri_fig),
            "nbe": s_nbe,
            "cNet": plain_stats(r["cNet"] for r in agri_fig),
            "cOut": plain_stats(r["cOut"] for r in agri_fig),
            "cIn": plain_stats(r["cIn"] for r in agri_fig),
            "nSourceNee": sum(1 for r in agri_fig if r["nee"] > 0),
            "nSourceNbe": sum(1 for r in agri_fig if r["nbe"] > 0),
            "nSinkNeeSourceNbe": len(sink_to_source),
            "nSourceNeeSinkNbe": len(source_to_sink),
            "sinkToSource": [r["key"] for r in sink_to_source],
            "sourceToSink": [r["key"] for r in source_to_sink],
            "sinkToSourceRangeInclZero": [
                r["key"] for r in sink_to_source if r["nbeLow"] <= 0
            ],
            "sourceToSinkRangeInclZero": [
                r["key"] for r in source_to_sink if r["nbeHigh"] >= 0
            ],
            "nSinkToSourceRangeInclZero": sum(
                1 for r in sink_to_source if r["nbeLow"] <= 0
            ),
            "nSourceToSinkRangeInclZero": sum(
                1 for r in source_to_sink if r["nbeHigh"] >= 0
            ),
            "nSinkToSourceRobust": sum(1 for r in sink_to_source if r["nbeLow"] > 0),
            "nSourceToSinkRobust": sum(1 for r in source_to_sink if r["nbeHigh"] < 0),
            "nSinkNbe": sum(1 for r in agri_fig if r["nbe"] < 0),
            "nSourceNbeLow": sum(1 for r in agri_fig if r["nbeLow"] > 0),
            "nSourceNbeHigh": sum(1 for r in agri_fig if r["nbeHigh"] > 0),
            "minNbe": by_nbe[0]["key"],
            "maxNbe": by_nbe[-1]["key"],
            "minCNet": by_shift[0]["key"],
            "maxCNet": by_shift[-1]["key"],
        },
        "hyytiala": {
            "nee": plain_stats(r["nee"] for r in ref_fig),
            "nbe": plain_stats(r["nbe"] for r in ref_fig),
            "neeMaxWithoutThinning": max(
                r["nee"] for r in ref_fig if r["key"] != THINNING_KEY
            ),
            "thinning": {
                "nee": hy["nee"],
                "nbe": hy["nbe"],
                "nbeLow": hy["nbeLow"],
                "nbeHigh": hy["nbeHigh"],
                "cOut": hy["cOut"],
                "ter": hy["ter"],
                "carbonOut": hy["carbonOut"],
            },
        },
    }
    derived_out = {
        "manureCFraction": derived["manureCFraction"],
        "viikkiN2023": derived["viikkiN2023"],
        "viikkiN2024": {
            kind: parse_kg_n(
                str(
                    next(
                        r["product"]
                        for r in site_rows(data.mgmt, "viikki")
                        if r["action"] == "fertilisation" and r["date"].year == 2024
                    )
                ),
                kind,
            )
            for kind in ("dry manure", "liquid manure")
        },
        "qvidjaKnownInput2020": derived.get("qvidjaKnownInput2020"),
        "compostCFractions": derived.get("compostCFractions"),
        "grazingRates": derived["grazingRates"],
        "haltialaVolume": parse_volume_range(data.haltiala_manure_detail)[0],
        "haltialaVolumeMax": parse_volume_range(data.haltiala_manure_detail)[1],
        "compostFibreCFraction": next(
            float(r["c_fraction"])
            for r in site_rows(data.mgmt, "qvidja")
            if r["action"] == "fertilisation" and r["c_fraction_source"] == "assumed"
        ),
    }
    return {
        "siteYears": rows,
        "sy": {r["key"]: r for r in rows},
        "figureKeys": [r["key"] for r in fig_rows],
        "noNbe": [
            {
                "key": r["key"],
                "site": r["site"],
                "year": r["year"],
                "reason": r["nbeReason"],
            }
            for r in rows
            if r["nbe"] is None
        ],
        "notInFigure": [
            {
                "key": r["key"],
                "site": r["site"],
                "year": r["year"],
                "reason": r["figureReason"],
            }
            for r in with_nbe
            if not r["inFigure"]
        ],
        "assumptions": [
            {
                "key": k,
                "text": v,
                "siteYears": [r["key"] for r in rows if k in r["assumptions"]],
            }
            for k, v in ASSUMPTION_TEXT.items()
        ],
        "derived": derived_out,
        "summary": summary,
    }


# ======================================================================================
# Figure
# ======================================================================================
def fmt(x: float | None, digits: int = 0) -> str:
    """Number for the alt text: fixed decimals, minus sign as U+2212."""
    if x is None:
        return "n/a"
    s = f"{x:.{digits}f}"
    if float(s) == 0:
        s = s.lstrip("-")
    return s.replace("-", "−")


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
            f'<{mt.group(1)}{mt.group(2)} style="font-family: {FONT_STACK}; '
            'font-variant-numeric: tabular-nums">'
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


def point_label(r: dict[str, Any]) -> str:
    return f"{r['year']} {r['cropLabel']}" if r["cropLabel"] else str(r["year"])


def site_label(site: str, data: Data) -> str:
    """Figure label of a site: emoji, one space, name (for example "🐂🐝 Qvidja")."""
    return f"{SITE_EMOJI[site]} {data.names[site]}"


def emoji_glyph_filter() -> None:
    """Ignore only the matplotlib warnings "Glyph N (...) missing from font(s) DejaVu Sans" of the
    code points of SITE_EMOJI. The SVG keeps the text; the browser draws the emojis."""
    cps = sorted({ord(c) for e in SITE_EMOJI.values() for c in e})
    pattern = r"Glyph (" + "|".join(str(c) for c in cps) + r") \("
    warnings.filterwarnings("ignore", message=pattern, category=UserWarning)


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
        site_label(site, data),
    )


def screen_angle(ax: Any, p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """Angle in degrees of the line p1-p2 on the page (data coordinates in)."""
    a = ax.transData.transform(p1)
    b = ax.transData.transform(p2)
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def nbe_plot(rows: Sequence[dict[str, Any]], data: Data) -> Any:
    """Figure 1: carbon out (TER + C_out - C_in) against GPP."""
    fig = plt.figure(figsize=(FIG_WIDTH_IN, FIG1_HEIGHT_IN))
    ax = fig.add_axes((0.12, 0.075, 0.83, 0.91))
    ax.set_xlim(X_LO, X_HI)
    ax.set_ylim(Y_LO, Y_HI)
    fs_small = 6 * FONT_SCALE
    # The 1:1 line (NBE = 0) and the guide lines NBE = g (y = x + g), inside the axes.
    for g, color, lw in ((0.0, INK, 1.8), *((g, GUIDE, 1.1) for g in NBE_GUIDES)):
        x1 = max(X_LO, Y_LO - g)
        x2 = min(X_HI, Y_HI - g)
        ax.plot([x1, x2], [x1 + g, x2 + g], color=color, lw=lw, ls=":", zorder=1)
        if g != 0:
            # Label in the empty lower right part, on the line (x = GUIDE_LABEL_X).
            gx = GUIDE_LABEL_X
            ang = screen_angle(ax, (x1, x1 + g), (x2, x2 + g))
            ax.annotate(
                f"NBE = {fmt(g)}",
                (gx, gx + g),
                xytext=(0, 3),
                textcoords="offset points",
                ha="center",
                va="bottom",
                rotation=ang,
                rotation_mode="anchor",
                fontsize=fs_small,
                color=GUIDE_TEXT,
                zorder=1,
            )
    ax.text(
        X_LO + 0.03 * (X_HI - X_LO),
        Y_HI - 0.02 * (Y_HI - Y_LO),
        "net source (NBE > 0)",
        ha="left",
        va="top",
        fontsize=7.5 * FONT_SCALE,
        fontweight="bold",
    )
    ax.text(
        X_HI - 0.03 * (X_HI - X_LO),
        Y_LO + 0.01 * (Y_HI - Y_LO),
        "net sink (NBE < 0)",
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
        for r in sr:
            x, y, ter = r["gpp"], r["carbonOut"], r["ter"]
            # Grey line from the NEE position (y = TER) to the NBE position, and a short tick
            # at the NEE position.
            ax.plot(
                [x, x], [ter, y], color=SHIFT, lw=1.0, zorder=1.5, solid_capstyle="butt"
            )
            ax.plot(
                [x],
                [ter],
                ls="none",
                marker="_",
                ms=9,
                mew=1.4,
                color=SHIFT,
                zorder=1.6,
            )
            hollow = r["class"] == "B"
            if hollow and r["nbeHigh"] - r["nbeLow"] > 1e-9:
                y_lo = ter + r["nbeLow"] - r["nee"]
                y_hi = ter + r["nbeHigh"] - r["nee"]
                ax.errorbar(
                    [x],
                    [y],
                    yerr=[[y - y_lo], [y_hi - y]],
                    fmt="none",
                    ecolor=color,
                    elinewidth=1.6,
                    capsize=5,
                    capthick=1.6,
                    zorder=zorder - 0.1,
                )
            ax.plot(
                [x],
                [y],
                ls="none",
                marker=marker,
                ms=ms,
                mfc="white" if hollow else color,
                mec=color if hollow else "white",
                mew=HOLLOW_EDGE if hollow else MARKER_EDGE,
                zorder=zorder,
                clip_on=False,
            )
            if r["key"] not in LABEL_OFFSETS:
                continue
            dx, dy, ha = LABEL_OFFSETS[r["key"]]
            text = LABEL_TEXT.get(r["key"], point_label(r))
            if r["key"] in WRAP_LABELS:
                text = text.replace(" ", "\n", 1)
            leader = (
                {
                    "arrowstyle": "-",
                    "color": GUIDE,
                    "lw": 0.8,
                    "shrinkA": 0,
                    "shrinkB": 6,
                }
                if r["key"] in LEADER_KEYS
                else None
            )
            ax.annotate(
                text,
                (x, y),
                xytext=(dx, dy),
                textcoords="offset points",
                ha=ha,
                va="center",
                fontsize=fs_small,
                linespacing=1.0,
                zorder=4,
                bbox={"boxstyle": "square,pad=0.1", "fc": "white", "ec": "none"},
                arrowprops=leader,
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
    ax.set_xlabel(X_LABEL)
    ax.set_ylabel(Y_LABEL)
    ax.set_axisbelow(True)
    ax.grid(True, color=GRID, lw=GRID_LW, zorder=0)
    ax.set_xticks(np.arange(X_LO, X_HI + 1, X_TICK))
    ax.set_yticks(np.arange(Y_LO, Y_HI + 1, Y_TICK))
    leg1 = ax.legend(
        handles=handles,
        loc="upper right",
        bbox_to_anchor=(1.0, 1.0),
        frameon=True,
        framealpha=1.0,
        edgecolor="none",
        title="Site",
        title_fontsize=7 * FONT_SCALE,
        alignment="left",
        handletextpad=0.4,
        labelspacing=0.7,
        borderaxespad=0,
    )
    key_handles = [
        Line2D(
            [],
            [],
            ls="none",
            marker="o",
            ms=MARKER_SIZE * 0.8,
            mfc=INK,
            mec="white",
            mew=MARKER_EDGE,
            label="A: all terms\nfrom site data",
        ),
        Line2D(
            [],
            [],
            ls="-",
            lw=1.6,
            marker="o",
            ms=MARKER_SIZE * 0.8,
            mfc="white",
            mec=INK,
            mew=HOLLOW_EDGE,
            color=INK,
            label="B: assumed term;\nbar = low to high",
        ),
        Line2D(
            [],
            [],
            ls="-",
            lw=1.0,
            color=SHIFT,
            marker="_",
            ms=9,
            mew=1.4,
            label="shift from NEE\n(tick at y = TER)",
        ),
    ]
    ax.legend(
        handles=key_handles,
        loc="upper right",
        bbox_to_anchor=(1.0, 0.68),
        frameon=True,
        framealpha=1.0,
        edgecolor="none",
        title="Class",
        title_fontsize=7 * FONT_SCALE,
        alignment="left",
        handletextpad=0.6,
        labelspacing=1.0,
        borderaxespad=0,
    )
    ax.add_artist(leg1)
    return fig


def fig_nbe(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    rows = [r for r in res["siteYears"] if r["inFigure"]]
    fig = nbe_plot(rows, data)
    s = res["summary"]
    fs = s["figureSites"]
    sy = res["sy"]
    mn, mx = sy[fs["minNbe"]], sy[fs["maxNbe"]]
    lo_c, hi_c = sy[fs["minCNet"]], sy[fs["maxCNet"]]
    th = s["hyytiala"]["thinning"]
    b_rows = [r for r in rows if r["class"] == "B" and r["site"] != REF_SITE]
    b_text = "; ".join(
        f"{r['siteName']} {r['year']} {fmt(r['nbe'])} ({fmt(r['nbeLow'])} to {fmt(r['nbeHigh'])})"
        for r in b_rows
    )
    desc = (
        f"Scatter plot of {s['nFigure']} site-years (full and reliable years with annual GPP, "
        f"TER and NBE): {s['nFigureSites']} of the six sites and {s['nFigureHyytiala']} of the "
        f"SMEAR II Hyytiälä forest (green stars). X axis {X_AXIS_TEXT}, from {fmt(X_LO)} to "
        f"{fmt(X_HI)}; y axis {Y_AXIS_TEXT}, from {fmt(Y_LO)} to {fmt(Y_HI)} (the y axis is "
        "longer than the x axis, so the scales differ). The vertical distance from the dotted "
        "1:1 line is NBE: above the line the field lost carbon (NBE > 0), below it gained "
        "carbon. Light dotted lines mark NBE = −200 and −400 g C m−2 yr−1. A grey line links "
        "each marker to a short grey tick at y = TER, the position without management carbon "
        f"(NEE). Filled markers are class A ({s['nFigureClassA']} site-years of the six sites), "
        f"hollow markers with a bar are class B ({s['nFigureClassB']}; the bar spans the low to "
        f"high NBE of the assumptions). For the six sites, NBE was {fmt(fs['nbe']['mean'])} ± "
        f"{fmt(fs['nbe']['sd'])} g C m−2 yr−1 (mean ± SD, range {fmt(fs['nbe']['min'])} to "
        f"{fmt(fs['nbe']['max'])}, n = {fs['nbe']['n']}); NEE was {fmt(fs['nee']['mean'])} ± "
        f"{fmt(fs['nee']['sd'])} (range {fmt(fs['nee']['min'])} to {fmt(fs['nee']['max'])}). "
        f"{fs['nSourceNee']} site-years had NEE > 0 and {fs['nSourceNbe']} had NBE > 0. "
        f"C_out − C_in was {fmt(fs['cNet']['mean'])} ± {fmt(fs['cNet']['sd'])} (range "
        f"{fmt(fs['cNet']['min'])}, {lo_c['siteName']} {lo_c['year']}, to "
        f"{fmt(fs['cNet']['max'])}, {hi_c['siteName']} {hi_c['year']}). Lowest NBE: "
        f"{mn['siteName']} {point_label(mn)}, {fmt(mn['nbe'])}; highest: {mx['siteName']} "
        f"{point_label(mx)}, {fmt(mx['nbe'])}. Class B (NBE, low to high): {b_text}. "
        f"Hyytiälä {THINNING_YEAR} (thinning): NEE {fmt(th['nee'])}, the commercial removal of "
        f"{fmt(th['cOut'])} gives NBE {fmt(th['nbe'])} (range {fmt(th['nbeLow'])} to "
        f"{fmt(th['nbeHigh'])}), carbon out {fmt(th['carbonOut'])}; the other Hyytiälä years "
        f"have NBE = NEE, {fmt(s['hyytiala']['nee']['min'])} to "
        f"{fmt(s['hyytiala']['neeMaxWithoutThinning'])}. "
        "Each site has its own colour and marker; labels give the year and, for annual crops "
        "and the failed grass, the crop."
    )
    return fig, FIG1_TITLE, desc


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
        "formula": "NBE = NEE + C_out - C_in (g C m-2 yr-1); positive = carbon loss from the "
        "field (ecosystem)",
        "sites": list(ALL_SITES),
        "minFrac": MIN_FRAC,
        "maxGapDays": MAX_GAP_DAYS,
        "reference": {
            "site": REF_SITE,
            "name": REF_NAME,
            "source": "SMEAR II Hyytiälä (station 2), SMEAR API (data/smear/hyytiala/README.md): "
            "HYY_EDDY233.NEE and HYY_EDDY233.GPP, HYY_EDDYMAST.F_c_270",
            "years": list(REF_YEARS),
            "factor": HH_TO_GC,
        },
        "heimschWindow2020": [d.isoformat() for d in HEIMSCH_WINDOW_2020],
        "nbeGuides": list(NBE_GUIDES),
        "axes": {"x": [X_LO, X_HI, X_TICK], "y": [Y_LO, Y_HI, Y_TICK]},
        "units": {"annual": ANNUAL_UNIT, "terms": "g C m-2"},
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
        "--db", type=Path, default=Path("db"), help="harmonised database folder"
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
        "--out", type=Path, default=None, help="output folder (default: script folder)"
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
    emoji_glyph_filter()
    git = git_info(script_dir)
    meta = {
        "source": f"{SCRIPT_PATH} (git {git['commit']}{', dirty' if git['dirty'] else ''})",
        "relation": f"database snapshot {DATABASE['builtAt']}; "
        + "; ".join(f"{i.key} sha256 {i.sha256}" for i in INPUTS),
    }
    figures_json: list[dict[str, Any]] = []
    for n, name in FIGURES:
        fig, title, desc = fig_nbe(res, data)
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
                k: r[k]
                for k in (
                    "key",
                    "class",
                    "inFigure",
                    "figureReason",
                    "nbeReason",
                    "gpp",
                    "ter",
                    "nee",
                    "cOut",
                    "cIn",
                    "nbe",
                    "nbeLow",
                    "nbeHigh",
                    "cOutFile",
                    "cInFile",
                )
            }
            | {"assumptions": ";".join(r["assumptions"])}
            for r in res["siteYears"]
        ]
    ).to_csv(out_dir / "output" / "site-years.csv", index=False, float_format="%.10g")

    dv = data_version(args, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": (
            "How does the annual carbon balance of a site-year change when the carbon of the "
            "harvest, the grazing, the thinning and the organic inputs is added to NEE?"
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
