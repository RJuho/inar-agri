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
"""Regrowth after a silage harvest in a dry month: light use efficiency, GPP and PAR.

QUESTION
    How does drought (SPI-1 <= -1.5 in the month of the harvest) change the regrowth of a
    grassland after a silage harvest, measured as the light use efficiency LUE = GPP / PAR,
    within the same cut number?

METHOD
    Sites: Anttila, Sarkisuo, Qvidja and Viikki (order of db/sites.parquet). Day numbers count
    the days since 1970-01-01; all windows include both end days. Day 0 = the last day of the
    harvest (end).
    1. Episodes: the silage harvest episodes of Deep Dive #7 (analysis/silage-harvest-response):
       the harvest and cut events of the five Finnish sites are merged (an event that starts not
       more than 7 days after the last day of the current episode joins it), the five OVERRIDES
       apply, and an episode is used when no other harvest or cut episode and no grazing or
       tillage event overlaps the days start-14 to end+14, GPP, TER and NEE have 12 or more days
       in the before (start-14 to start-1) and the after (end+1 to end+14) window, and the mean
       measured fraction of NEE is 0.10 or more in both windows. The 20 used episodes are the
       same as in Deep Dive #7. The two flagged Viikki episodes (establishment year 2023-08-17,
       partial harvest 2024-06-14) stay in the episode table and in Figure 3, but they are not
       in the group statistics and not in the group curves of Figures 1 and 2.
    2. Daily PAR (mol m-2 d-1) per local day (ts_start in UTC + utc_offset_min of the site): the
       mean of the 30-min ppfd (umol m-2 s-1) x 0.0864 (= 86 400 s x 1e-6); a day counts when
       40 or more of its 48 half hours have a value (the mean fills a gap of up to 8 half hours).
       Qvidja has no ppfd: daily SW_in (MJ m-2 d-1) = mean sw_in (W m-2) x 0.0864 with the same
       rule, x k (mol MJ-1). k = the median, over the days with PAR >= 5 mol m-2 d-1 at the
       sites that have both ppfd and sw_in (Anttila, Viikki, and Sarkisuo because it has 100 or
       more such days), of the daily ratio PAR / SW_in. The per-site medians and the 10 to 90 %
       range are logged; the per-site minimum and maximum median give the sensitivity of k.
       k / 4.57 gives the energy fraction of PAR in the global radiation (4.57 umol J-1 is the
       common PAR conversion, stated without a page: an assumption, PAR_CONVERSION_ASSUMPTION),
       for the comparison with the 42 % of Heimsch et al. 2024 (LITERATURE).
    3. LUE_d = GPP_d / PAR_d (g C mol-1), GPP_d from data/calculated/daily.parquet (g C m-2 d-1).
       A day with PAR < 5 mol m-2 d-1 has no LUE (the count is logged). Reference window = the
       days start-14 to start-1 with a LUE value: gppBefore and parBefore are the means over
       these days, and lueBefore = gppBefore / parBefore (the ratio of the window means over the
       same days, so that relGPP_d = relLUE_d x relPAR_d holds on each day; the mean of the daily
       LUE is also stored). An episode with fewer than 12 LUE days in the reference window is
       excluded ("too-few-par-days"). Relative LUE, GPP and PAR of a day = value / reference.
       Window means over the days with a LUE value: after = end+1 to end+14, late = end+15 to
       end+28; a window mean is null with fewer than 12 LUE days, and the late window is null
       when another harvest or cut episode or a grazing or tillage event overlaps it (the rule
       of Deep Dive #7). The product of the window means of relLUE and relPAR is stored next to
       the window mean of relGPP (they differ, because a mean of products is not the product of
       the means).
    4. Dryness: SPI-1 of the station of the site (Vantaa: Viikki; Kaarina Yltoinen: Qvidja;
       Kuopio Maaninka: Anttila and Sarkisuo) in the calendar month that holds end. Dry = SPI-1
       <= -1.5 (SPI_DRY, a project definition). Also stored: SPI-3 of that month, SPI-1 of the
       next month, and the SWC anomaly = mean swc of the local days end to end+14 minus the mean
       swc of the same site on the same calendar dates in all its data years (daily swc with the
       40 of 48 rule; the number of years is logged). Sensitivity groups: SPI-3 <= -1.5 and SWC
       anomaly < 0 (group means only; the main result uses SPI-1), and SPI-1 <= -1 (the rule of
       the TypeScript dive nee-without-harvest-drought). The SPI-3 rule (dry = SPI-3 <= -1.5 of
       the harvest month) is also a second full grouping (groups.spi3, composite.spi3, Figures 4
       and 5) with the same statistics as the main rule where n allows: the bootstrap CI only
       with 3 or more episodes, the exact permutation test with 2 or more per group. With the
       SPI-3 rule, no later cut is dry (groups.spi3.later.n.dry = 0): there is no SPI-3 figure
       of the later cuts.
    5. Groups: first cut (cutNo = 1, the ordinal of the episode among the harvest and cut
       episodes of the site in that year) and later cuts (cutNo >= 2). A fertilisation in the
       days start-14 to end+14 only sets the flag fertInWindow.
    6. Statistics per cut group, dryness and window (after, late) for relLUE, relGPP and relPAR:
       n, mean, SD, bootstrap 95 % CI of the mean (10 000 resamples, percentile method, numpy
       PCG64, fixed seeds, n >= 3), the difference dry - normal with a bootstrap CI (both groups
       resampled, n >= 3 each) and an exact permutation test of the difference of means (all
       C(n, nDry) splits; two-sided p = the share of splits with |difference| >= the observed
       |difference|). With one dry episode (later cuts) there is no test: the single dry value
       is given against the mean, SD and range of the normal group, also in SD units.
       Composite day-by-day curves of the mean relLUE, relGPP and relPAR per group (days -14 to
       +28 from end): the value of an episode is null from the day end + next disturbance on
       (the next harvest, cut or grazing of the site); per day the mean, SD, n and the bootstrap
       CI (n >= 3); mean and SD are null when n < 2, except in a group of one episode (the dry
       later cut), whose curve is the episode itself. The y range of Figures 1 and 2 is one range
       over all drawn means, CI bands and the single curve, rounded outwards to a multiple of
       0.25 and extended to hold 0 and 1. The y range of Figure 4 is the same rule over the
       curves of Figures 1, 2 and 4 together (composite.yRangeSpi3); the result tells whether it
       equals the range of Figures 1 and 2 (composite.yRangeShared).
    7. Each step that removes rows or changes values logs a count (results.json dataVersion.steps).
    8. Open findings of docs/anomaly-data-report.md that touch this dive are printed
       (OPEN_FINDINGS).

DATABASE
    builtAt: 2026-10-23T19:03:07.928Z (db/report.json and Parquet key/value metadata built_at)
    calcBuiltAt: 2026-10-23T19:03:09.003Z (data/calculated/report.json and Parquet built_at)
    commit: 44ec98f (HEAD at build time; db/report.json does not record a commit)
    url: TODO: release asset db-2026-10-23.zip not yet published

INPUTS
    db/events.parquet  sha256=b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b  rows=114  columns=site_code, date, date_end, type, detail, crop, dry_mass_kg_ha
    db/sites.parquet  sha256=9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59  rows=6  columns=site_id, code, name, utc_offset_min
    db/variables.parquet  sha256=06e6a41c727958beb973f2b76adb8182d88b0a5d501be6f11c948c0129fb7c6e  rows=26  columns=column_name, unit
    db/observations.parquet  sha256=922346b5afe2ec56de128311aa3d8dc8cd0ccc1a57700bd333bbdf95a51d8964  rows=537980  columns=site_id, ts_start, ppfd, sw_in, swc
    calculated/daily.parquet  sha256=fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9  rows=11209  columns=site_code, date_local, gpp_gc, reco_gc, nee_f_gc, frac_measured
    spi/SPI_all_stations.csv  sha256=fd61c06114fc3a59a331de89f2cd39464587db2f7df0f33df52df883c72d53b1  rows=1683  columns=Year, Month, SPI1, SPI3, Station

OUTPUTS
    results.json                 all result numbers, figure captions and alt texts, dataVersion
    manifest.json                provenance of the run and SHA-256 of the outputs
    figures/1-first-cut.svg      first cuts: relative LUE, dry and normal group
    figures/2-later-cuts.svg     later cuts: relative LUE, normal group and the one dry episode
    figures/3-late-lue-vs-spi.svg  relative LUE of days 15 to 28 against SPI-1, per episode
    figures/4-first-cut-spi3.svg   first cuts: relative LUE, dry and normal group by SPI-3
    figures/5-late-lue-vs-spi3.svg  relative LUE of days 15 to 28 against SPI-3, per episode
    output/run.log               run log (not in git)
    output/episodes.csv          all silage harvest episodes with the numbers (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/regrowth-drought/regrowth-drought.py --db db --calculated data/calculated --spi data/SPI

NOTES
    The local days of Anttila, Sarkisuo and Viikki start at 02:00 true local time (open findings
    ANT-01, SAR-01, VII-01): the daily PAR and GPP of these sites hold the hours 02:00 to 02:00.
    The daily sums change little; the window means change less.
    GPP is a model value of the night-time partitioning (docs/calculated.md).
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import itertools
import json
import logging
import math
import platform
import re
import subprocess
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
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
from matplotlib.lines import Line2D

SLUG = "regrowth-drought"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"
SVG_ID_PREFIX = "rd"

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
    """One input file. `root` is "db", "calculated" or "spi" (the folder of --db, --calculated
    or --spi). A CSV file has no built_at (None); its rows are the data lines after the header."""

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
        "events.parquet",
        "b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b",
        114,
        ("site_code", "date", "date_end", "type", "detail", "crop", "dry_mass_kg_ha"),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "db",
        "sites.parquet",
        "9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59",
        6,
        ("site_id", "code", "name", "utc_offset_min"),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "db",
        "variables.parquet",
        "06e6a41c727958beb973f2b76adb8182d88b0a5d501be6f11c948c0129fb7c6e",
        26,
        ("column_name", "unit"),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "db",
        "observations.parquet",
        "922346b5afe2ec56de128311aa3d8dc8cd0ccc1a57700bd333bbdf95a51d8964",
        537980,
        ("site_id", "ts_start", "ppfd", "sw_in", "swc"),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "calculated",
        "daily.parquet",
        "fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9",
        11209,
        ("site_code", "date_local", "gpp_gc", "reco_gc", "nee_f_gc", "frac_measured"),
        "2026-10-23T19:03:09.003Z",
    ),
    InputFile(
        "spi",
        "SPI_all_stations.csv",
        "fd61c06114fc3a59a331de89f2cd39464587db2f7df0f33df52df883c72d53b1",
        1683,
        ("Year", "Month", "SPI1", "SPI3", "Station"),
        None,
    ),
)

# Units that the script expects in db/variables.parquet. The script does not convert a unit again,
# except the daily sums of ppfd and sw_in (umol m-2 s-1 x 0.0864 = mol m-2 d-1; W m-2 x 0.0864 =
# MJ m-2 d-1).
EXPECTED_UNITS = {
    "ppfd": "µmol m-2 s-1",
    "sw_in": "W m-2",
    "swc": "m3 m-3",
    "gpp_src": "µmol CO2 m-2 s-1",
    "ts_start": "UTC",
}
DAILY_UNIT = "g C m-2 d-1"
PAR_UNIT = "mol m-2 d-1"
SW_UNIT = "MJ m-2 d-1"
LUE_UNIT = "g C mol-1"
K_UNIT = "mol MJ-1"

# ---------- Method constants ----------
ALL_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
# Sites whose harvest and cut events are merged into episodes (as Deep Dives #4 and #7).
EPISODE_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki")
# The grass sites with silage harvest episodes.
SITES = ("anttila", "sarkisuo", "qvidja", "viikki")
# Sites with ppfd and sw_in: candidates for the PAR / SW_in ratio k.
K_CANDIDATE_SITES = ("anttila", "sarkisuo", "viikki")
K_ALWAYS_SITES = ("anttila", "viikki")
K_MIN_DAYS = 100
# Qvidja has no ppfd: PAR = SW_in x k.
SW_SITES = ("qvidja",)
EVENT_TYPES = (
    "harvest",
    "cut",
    "grazing",
    "fertilisation",
    "sowing",
    "tillage",
    "spraying",
    "other",
)
HARVEST_GROUPS = ("silageHarvest", "cleaningCut", "grainHarvest")
GRAIN_RE = re.compile(r"thresh|grain|faba|\boats\b|barley", re.IGNORECASE)
GRASS_RE = re.compile(r"\bcut\b|silage|grass", re.IGNORECASE)

FLUX_VARS = ("gpp", "reco", "nee")
MEAN_VARS = ("nee", "gpp", "reco", "frac")
EXCLUSIONS = ("overlap", "too-few-days", "low-measured-fraction", "too-few-par-days")
QUANTITIES = ("relLue", "relGpp", "relPar")
QUANTITY_LABELS = {"relLue": "LUE", "relGpp": "GPP", "relPar": "PAR"}
WINDOWS = ("after", "late")
CUT_GROUPS = ("first", "later")
CUT_GROUP_LABELS = {"first": "First cut (cut 1)", "later": "Later cuts (cut 2 or more)"}
DRYNESS = ("dry", "normal")

MERGE_DAYS = 7
BEFORE = (-14, -1)
AFTER = (1, 14)
LATE = (15, 28)
MIN_DAYS = 12
MIN_FRAC = 0.10
MIN_HALF_HOURS = 40
HALF_HOURS_PER_DAY = 48
DAY_FACTOR = 86_400 * 1e-6  # mean rate x 86 400 s x 1e-6: umol -> mol, J -> MJ
MIN_PAR = 5.0  # mol m-2 d-1; a darker day has no LUE
SPI_DRY = -1.5  # project definition of a dry month: SPI-1 <= SPI_DRY
SWC_WINDOW = (0, 14)  # local days from end for the SWC anomaly
COMPOSITE = (-14, 28)
COMPOSITE_MIN_N = 2
Y_STEP = 0.25
BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_LEVEL = 0.95
BOOTSTRAP_MIN_N = 3
# Open findings ANT-01, SAR-01, VII-01: the stamps of Anttila, Sarkisuo and Viikki are 2 hours early.
UTC_SHIFT_HOURS = 2
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-9
IDENTITY_RTOL = 1e-9
DETAIL_SHORT = 90

# Seeds of the bootstrap (numpy PCG64):
#   group statistics: SEED_BASE + 1000 x cut group + 100 x quantity + 10 x window + dryness
#   (dryness 0 dry, 1 normal, 2 difference);
#   composite curves: COMPOSITE_SEED_BASE + 2000 x cut group + 1000 x dryness + 100 x quantity +
#   day index (0 = day -14).
SEED_BASE = 11_000
COMPOSITE_SEED_BASE = 21_000
SPI3_SEED_BASE = 31_000  # the SPI-3 grouping (groups.spi3)
SPI3_COMPOSITE_SEED_BASE = 41_000  # the SPI-3 composite curves (composite.spi3)

# Station of each site in data/SPI/SPI_all_stations.csv (STATION_OF_SITE in
# scripts/lib/deep-dive/spi.ts).
STATION_OF_SITE = {
    "anttila": "Kuopio Maaninka",
    "sarkisuo": "Kuopio Maaninka",
    "qvidja": "Kaarina Yltöinen",
    "viikki": "Vantaa",
}

# ---------- Overrides of Deep Dive #4 (OVERRIDES in scripts/deep-dives/disturbance-detail.ts) ----------
OVERRIDES: tuple[dict[str, str], ...] = (
    {
        "site": "haltiala",
        "date": "2021-09-10",
        "start": "2021-09-08",
        "end": "2021-09-15",
        "text": 'Start 8 Sep 2021 from the file text ("harvest started 8 Sep and lasted at least 5 days"); the rows of 10 Sep and 15 Sep (threshing) are one episode.',
    },
    {
        "site": "haltiala",
        "date": "2022-08-15",
        "start": "2022-08-15",
        "end": "2022-08-24",
        "text": 'End 24 Aug 2022 from date_end ("end 23 or 24 Aug").',
    },
    {
        "site": "qvidja",
        "date": "2023-06-19",
        "text": "Cleaning cut on 19 Jun and silage harvest on 20 Jun 2023 are one episode: start = cut day, group silage harvest, the cut is a co-event.",
    },
    {
        "site": "qvidja",
        "date": "2023-08-21",
        "text": "Cleaning cut on 21 Aug and silage harvest on 22 Aug 2023 are one episode: start = cut day, group silage harvest, the cut is a co-event.",
    },
    {
        "site": "viikki",
        "date": "2023-08-17",
        "text": "First cut on 17 Aug and second cut on 24 Aug 2023 (7 days apart) are one episode.",
    },
)

# Flags of single episodes (typed from data/Viikki/EC/Management Information.docx, see db/events.parquet).
# A flagged episode stays in the episode table and in Figure 3, but it is not in the group
# statistics and not in the group curves (FLAG_REASON).
EPISODE_NOTES: dict[str, dict[str, Any]] = {
    "viikki-2023-08-17": {
        "establishmentYear": True,
        "partialHarvest": False,
        "note": "Establishment year: barley undersown with clover and grasses, cut green on 17 and 24 August.",
    },
    "viikki-2024-06-14": {
        "establishmentYear": False,
        "partialHarvest": True,
        "note": "Partial harvest: only about one hectare of the field was harvested (poor growth).",
    },
}
FLAG_REASON = (
    "flagged: an establishment-year cut or a partial harvest is not a regrowth of an established "
    "grass stand after a full harvest; the episode stays in the table and in Figure 3, but not in "
    "the group statistics and curves"
)

# ---------- Reference values ----------
# Book rows: ref "peltokasvien-tuotanto" (Seppanen, Yli-Halla, Stoddard, Makela and Helenius 2016,
# 3rd ed., Opetushallitus), section and printed page ("s."), checked with grep on
# data/Peltokasvien_tuotanto/content.html. Article rows: PDF page, checked with pdftotext.
BOOK = "peltokasvien-tuotanto"
LITERATURE: tuple[dict[str, Any], ...] = (
    {
        "key": "parFractionOfGlobal",
        "text": "Photosynthetically active radiation (PAR) was empirically estimated to be 42 % of the global radiation.",
        "textFi": None,
        "value": 42,
        "unit": "% of global radiation",
        "uncertainty": None,
        "ref": "heimsch2024",
        "section": None,
        "page": "PDF p. 4",
        "tableFigure": None,
    },
    {
        "key": "speiSeverelyDry",
        "text": 'SPEI categories: − 1.0 to − 1.49: moderately dry; − 1.5 to − 1.99: severely dry; − 2.0 and below: extremely dry. The dry limit of this dive, SPI-1 <= -1.5, equals the lower bound of "severely dry".',
        "textFi": None,
        "value": -1.5,
        "unit": "SPEI",
        "uncertainty": None,
        "ref": "heimsch2024",
        "section": None,
        "page": "PDF p. 4",
        "tableFigure": None,
    },
    {
        "key": "qvidja2018Drought",
        "text": "In terms of SPEI, the first growing season of our study (in 2018) could be mostly classified as severely or extremely dry. May, June and July were extremely dry months with SPEI < − 1.99.",
        "textFi": None,
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": "heimsch2024",
        "section": None,
        "page": "PDF p. 5",
        "tableFigure": None,
    },
    {
        "key": "heimsch2021Par",
        "text": "The mean daily PAR was about 12 % higher in 2018 than in 2019 (460 vs. 410 µmol m−2 s−1), while the precipitation sum was 32 % lower (212 vs. 312 mm) (May to September).",
        "textFi": None,
        "value": 460,
        "unit": "µmol m-2 s-1",
        "uncertainty": None,
        "ref": "heimsch2021",
        "section": None,
        "page": "PDF p. 6",
        "tableFigure": None,
    },
    {
        "key": "heimsch2021Gp1200",
        "text": "The clearly lower leaf-area-based photosynthetic capacity (GP1200) in 2018 compared to 2019 probably indicates drought-related stress on photosynthetic processes.",
        "textFi": None,
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": "heimsch2021",
        "section": None,
        "page": "PDF p. 11",
        "tableFigure": None,
    },
    {
        "key": "regrowthAfterCut",
        "text": "The speed of the regrowth after a cut is a property of the species and the cultivar; the cutting height, the number of cuts and the nutrient supply change it. A large leaf area left in the stubble can speed up the regrowth, especially in dry conditions.",
        "textFi": "Niiton jälkeinen jälkikasvun nopeus on laji- ja lajikeominaisuus, johon voidaan viljelyteknisesti vaikuttaa niittokorkeudella, niittojen lukumäärällä sekä ravinteiden saatavuudella. Sänkeen jäävä suuri lehtipinta-ala voi nopeuttaa jälleenkasvua etenkin kuivissa oloissa.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.1.2 Nurmikasvien kasvutapa",
        "page": "s. 91",
        "tableFigure": None,
    },
    {
        "key": "laterCutSlower",
        "text": "The regrowth yield develops more slowly, and its feed value does not change as fast as in spring.",
        "textFi": "Jälkisato kehittyy hitaammin, eikä sen rehuarvo muutu yhtä nopeasti kuin keväällä.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.2.1 Pää- ja jälkisato",
        "page": "s. 95",
        "tableFigure": None,
    },
)
# The common conversion of PAR energy to photons, 4.57 umol J-1 (= 4.57 mol MJ-1), stated without
# a page: an assumption. It turns k (mol MJ-1 of global radiation) into the energy fraction of
# PAR in the global radiation, k / PAR_UMOL_PER_J, for the comparison with parFractionOfGlobal.
PAR_UMOL_PER_J = 4.57
PAR_CONVERSION_ASSUMPTION = {
    "value": PAR_UMOL_PER_J,
    "unit": "µmol J-1",
    "assumption": True,
    "note": "common PAR conversion (photons per PAR energy), stated without a page",
}
# The TypeScript dive nee-without-harvest-drought uses SPI-1 <= -1 (DRY_THRESHOLD in
# scripts/lib/deep-dive/spi.ts); a sensitivity run uses it.
SPI_DRY_OTHER_DIVE = -1.0


def literature_by_key() -> dict[str, dict[str, Any]]:
    """LITERATURE as an object keyed by `key`. A list value also gets valueMin and valueMax."""
    out: dict[str, dict[str, Any]] = {}
    for row in LITERATURE:
        r = dict(row)
        if isinstance(r["value"], list):
            r["valueMin"] = min(r["value"])
            r["valueMax"] = max(r["value"])
        out[r["key"]] = r
    return out


OPEN_FINDINGS = (
    (
        "ANT-01, SAR-01, VII-01 (open, waits for the providers): the raw stamps of Anttila, Sarkisuo and "
        "Viikki are UTC, but the build reads them as UTC+2. A local day of these sites thus holds the "
        "hours 02:00 to 02:00 true local time, and the daily PAR, GPP and swc of these sites hold 2 "
        "hours of the previous evening instead of the own evening. The effect on a daily sum is small "
        "and on a 14-day window mean smaller."
    ),
    (
        "VII-05 (open): Viikki 2024 nee_f is not equal to nee in 1 540 periods. The GPP of the "
        "partitioning around the 2024 harvests can thus differ from the measured values."
    ),
)

# ---------- Figures ----------
# Body font of site/src/styles/global.css, then the emoji fonts of the Tailwind font-sans stack
# (CLAUDE.md). Single quotes around the names: the stack goes into a style="..." attribute.
FONT_STACK = (
    "system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', "
    "'Noto Color Emoji'"
)
FONT_SCALE = 1.5  # fonts for slides: 1.5 x the dive default
# Group colours and styles (the user's choice): normal = steel blue, dry = vermillion.
GROUP_STYLE = {
    "normal": {"color": "#4a708b", "ls": "-", "marker": "o"},
    "dry": {"color": "#D55E00", "ls": "--", "marker": "s"},
}
# Site colour, marker and dash of Figure 3: the slot of the site in db/sites.parquet, as
# siteColors(), siteSymbol() and siteDash() in site/src/scripts/diagrams/common.ts (Okabe-Ito,
# EXPORT_SERIES in site/src/scripts/theme.ts). matplotlib has no roundRect marker: the pentagon
# "p" stands for it, as in Deep Dive #6.
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
HARVEST_LINE = "#FFA500"
INK = "#222222"
LINE_WIDTH = 2.2
MARKER_SIZE = 6.5
BAND_ALPHA = 0.25
MARK_EVERY = (0, 7)
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
FIG_HEIGHT_IN = 100 * MM
FIG3_HEIGHT_IN = 95 * MM
FIGURES = (
    (1, "first-cut"),
    (2, "later-cuts"),
    (3, "late-lue-vs-spi"),
    (4, "first-cut-spi3"),
    (5, "late-lue-vs-spi3"),
)
FIG1_TITLE = "First cut: light use efficiency after the harvest, dry and normal June"
FIG2_TITLE = "Later cuts: light use efficiency after the harvest, dry and normal month"
FIG4_TITLE = (
    "First cut: light use efficiency after the harvest, dry and normal June by SPI-3"
)
# The panel titles in two lines: the 180 mm panel is too narrow for one line at FONT_SCALE.
FIG_TITLE_BREAK = ", dry and normal"
FIG3_TITLES = {"first": "First cuts", "later": "Later cuts"}
X_LABEL = "Days from the last day of the harvest (local days)"
Y_LABEL = "LUE (fraction of the mean of days −14 to −1)"
X_LABEL_SPI = "SPI-1 of the harvest month"
X_LABEL_SPI3 = "SPI-3 of the harvest month"
# The SPI key of an episode, the axis name and the text name per rule.
SPI_RULES = {
    "spi1": {"key": "spi1", "name": "SPI-1", "xLabel": X_LABEL_SPI},
    "spi3": {"key": "spi3", "name": "SPI-3", "xLabel": X_LABEL_SPI3},
}
Y_LABEL_LATE = "LUE of days 15 to 28\n(fraction of the mean of days −14 to −1)"
DRY_LABEL = "dry"
# Thin reference lines of the panels, also the values that the y range must hold.
REF_LINES = (0.0, 1.0)

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


def input_path(inp: InputFile, db: Path, calculated: Path, spi: Path) -> Path:
    root = {"db": db, "calculated": calculated, "spi": spi}[inp.root]
    return root / inp.file


def check_inputs(db: Path, calculated: Path, spi: Path) -> list[str]:
    """Check each input: exists, SHA-256, Parquet built_at, row count. Returns the error list."""
    errors: list[str] = []
    for inp in INPUTS:
        path = input_path(inp, db, calculated, spi)
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
# Pure helpers: days, events, episodes (as Deep Dive #7)
# ======================================================================================
EPOCH = date(1970, 1, 1)


def day_number(d: date | str) -> int:
    """Days since 1970-01-01 (the same number as a matplotlib date)."""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return (d - EPOCH).days


def iso_day(day: int) -> str:
    return (EPOCH + timedelta(days=int(day))).isoformat()


def overlaps(a_lo: int, a_hi: int, b_lo: int, b_hi: int) -> bool:
    """True when the day ranges a and b share a day (both ranges include their end days)."""
    return a_lo <= b_hi and b_lo <= a_hi


@dataclass
class Event:
    site: str
    date: int
    date_end: int | None
    type: str
    detail: str = ""
    crop: str | None = None
    dry_mass_kg_ha: float | None = None

    @property
    def hi(self) -> int:
        return self.date if self.date_end is None else self.date_end

    @property
    def group(self) -> str:
        return harvest_group(self.type, self.crop, self.detail)

    def json(self) -> dict[str, Any]:
        return {
            "date": iso_day(self.date),
            "dateEnd": None if self.date_end is None else iso_day(self.date_end),
            "type": self.type,
            "crop": self.crop,
            "detail": self.detail,
            "dryMassKgHa": self.dry_mass_kg_ha,
        }


@dataclass
class HarvestEpisode:
    site: str
    start: int
    end: int
    recorded: int
    events: list[Event] = field(default_factory=list)
    group: str = "silageHarvest"
    co_events: list[Event] = field(default_factory=list)
    overrides: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"{self.site}-{iso_day(self.start)}"


def harvest_group(etype: str, crop: str | None, detail: str) -> str:
    """Group of one harvest or cut event (port of harvestGroup, harvest-groups.ts)."""
    if etype == "cut":
        return "cleaningCut"
    text = f"{crop or ''} {detail}"
    if GRAIN_RE.search(text) and not GRASS_RE.search(text):
        return "grainHarvest"
    return "silageHarvest"


def episode_group(events: Sequence[Event]) -> str:
    """Grain when one event is a grain harvest, else silage when one event is a harvest, else cleaning cut."""
    groups = [e.group for e in events]
    if "grainHarvest" in groups:
        return "grainHarvest"
    if "silageHarvest" in groups:
        return "silageHarvest"
    return "cleaningCut"


def merge_harvest_episodes(
    events: Sequence[Event],
    overrides: Sequence[dict[str, str]] = (),
    merge_days: int = MERGE_DAYS,
) -> list[HarvestEpisode]:
    """Harvest and cut events of each site, merged into episodes (port of mergeHarvestEpisodes).

    An event that starts not more than `merge_days` after the end of the current episode joins it.
    `recorded` = the first event date, before the overrides. An override changes the first or the
    last day of the episode that has an event on its `date`; an override without an episode is an
    error (the table is out of date).
    """
    ordered = sorted(
        (e for e in events if e.type in ("harvest", "cut")),
        key=lambda e: (e.site, e.date),
    )
    out: list[HarvestEpisode] = []
    for e in ordered:
        last = out[-1] if out else None
        if last is not None and last.site == e.site and e.date - last.end <= merge_days:
            last.end = max(last.end, e.hi)
            last.events.append(e)
        else:
            out.append(HarvestEpisode(e.site, e.date, e.hi, e.date, [e]))
    for ep in out:
        ep.group = episode_group(ep.events)
        ep.co_events = [e for e in ep.events if e.group != ep.group]
    for o in overrides:
        hit = next(
            (
                ep
                for ep in out
                if ep.site == o["site"]
                and any(iso_day(e.date) == o["date"] for e in ep.events)
            ),
            None,
        )
        if hit is None:
            raise ValueError(
                f"override {o['site']} {o['date']}: no episode has an event on this date"
            )
        if "start" in o:
            hit.start = day_number(o["start"])
        if "end" in o:
            hit.end = day_number(o["end"])
        if hit.end < hit.start:
            raise ValueError(
                f"override {o['site']} {o['date']}: end {iso_day(hit.end)} is before start {iso_day(hit.start)}"
            )
        hit.overrides.append(o["text"])
    return out


# ======================================================================================
# Pure helpers: day tables and windows
# ======================================================================================
class DayTable:
    """Daily values of one site, as arrays indexed by day number (NaN = no value)."""

    def __init__(self, first_day: int, last_day: int, pad: int = 200) -> None:
        self.offset = first_day - pad
        self.size = last_day - first_day + 1 + 2 * pad
        self.vars: dict[str, np.ndarray] = {}

    def array(self, var: str) -> np.ndarray:
        if var not in self.vars:
            self.vars[var] = np.full(self.size, np.nan)
        return self.vars[var]

    def set(self, var: str, days: np.ndarray, values: np.ndarray) -> None:
        self.array(var)[np.asarray(days, dtype=np.int64) - self.offset] = values

    def get(self, var: str, day: int) -> float:
        i = day - self.offset
        return float(self.array(var)[i]) if 0 <= i < self.size else math.nan

    def values(self, var: str, lo: int, hi: int) -> np.ndarray:
        """Values of the days lo .. hi (both included); days outside the table are NaN."""
        out = np.full(hi - lo + 1, np.nan)
        a, b = max(lo, self.offset), min(hi, self.offset + self.size - 1)
        if a <= b:
            out[a - lo : b - lo + 1] = self.array(var)[
                a - self.offset : b - self.offset + 1
            ]
        return out

    def range_mean(self, var: str, lo: int, hi: int) -> tuple[int, float | None]:
        """Number of days with a value and their mean over the days lo .. hi."""
        xs = self.values(var, lo, hi)
        xs = xs[~np.isnan(xs)]
        return len(xs), (float(xs.sum() / len(xs)) if len(xs) else None)


@dataclass
class WindowMeans:
    n: dict[str, int]
    mean: dict[str, float | None]

    def json(self) -> dict[str, Any]:
        return {"nDays": dict(self.n), "mean": dict(self.mean)}


def window_means(
    table: DayTable, anchor: int, w: tuple[int, int], variables: Sequence[str]
) -> WindowMeans:
    """Count and mean of each variable over the days anchor + w[0] .. anchor + w[1]."""
    n: dict[str, int] = {}
    m: dict[str, float | None] = {}
    for v in variables:
        n[v], m[v] = table.range_mean(v, anchor + w[0], anchor + w[1])
    return WindowMeans(n, m)


def flux_exclusion(
    before: WindowMeans, after: WindowMeans, n_overlap: int
) -> str | None:
    """Reason why an episode is not used (Deep Dive #7), in the order overlap, too-few-days,
    low-measured-fraction."""
    if n_overlap:
        return "overlap"
    if not all(before.n[f] >= MIN_DAYS and after.n[f] >= MIN_DAYS for f in FLUX_VARS):
        return "too-few-days"
    if (before.mean["frac"] or 0) < MIN_FRAC or (after.mean["frac"] or 0) < MIN_FRAC:
        return "low-measured-fraction"
    return None


# ======================================================================================
# Pure helpers: daily PAR, k, LUE, SWC anomaly
# ======================================================================================
def daily_from_half_hours(
    obs: pd.DataFrame,
    var: str,
    min_half_hours: int = MIN_HALF_HOURS,
    factor: float = 1.0,
) -> pd.DataFrame:
    """Daily mean x factor of `var` per site and local day; a day counts when `min_half_hours` or
    more of its half hours have a value. Columns: site, day, n, value (NaN when too few)."""
    g = obs.groupby(["site", "day"], sort=True)[var]
    d = g.agg(n="count", mean="mean").reset_index()
    n = col(d, "n").to_numpy(dtype=np.int64)
    mean = col(d, "mean").to_numpy(dtype=float)
    d["value"] = np.where(n >= min_half_hours, mean * factor, np.nan)
    return frame(d[["site", "day", "n", "value"]])


def k_ratio(
    par: np.ndarray, sw: np.ndarray, min_par: float = MIN_PAR
) -> dict[str, Any]:
    """Median and 10 to 90 % range of PAR / SW_in over the days with PAR >= min_par and SW > 0."""
    ok = ~np.isnan(par) & ~np.isnan(sw) & (par >= min_par) & (sw > 0)
    r = par[ok] / sw[ok]
    if len(r) == 0:
        return {"nDays": 0, "median": None, "p10": None, "p90": None}
    p10, p90 = np.quantile(r, [0.1, 0.9])
    return {
        "nDays": len(r),
        "median": float(np.median(r)),
        "p10": float(p10),
        "p90": float(p90),
        "min": float(r.min()),
        "max": float(r.max()),
    }


def lue_days(
    gpp: np.ndarray, par: np.ndarray, min_par: float = MIN_PAR
) -> tuple[np.ndarray, int]:
    """LUE = GPP / PAR per day (NaN without GPP, without PAR or with PAR < min_par); the second
    value is the number of days with GPP and PAR that lose their LUE because PAR < min_par."""
    ok = ~np.isnan(gpp) & ~np.isnan(par)
    dark = ok & (par < min_par)
    lue = np.full(len(gpp), np.nan)
    keep = ok & ~dark
    lue[keep] = gpp[keep] / par[keep]
    return lue, int(dark.sum())


def exact_permutation_p(
    dry: np.ndarray, normal: np.ndarray
) -> tuple[float | None, int, float | None]:
    """Two-sided exact permutation test of the difference of means (dry - normal).

    All C(n, nDry) splits of the pooled values; p = the share of splits whose |difference| is
    >= the observed |difference| (with a small tolerance). None when a group has fewer than 2
    values. Returns (p, number of splits, observed difference).
    """
    n_d, n_n = len(dry), len(normal)
    if n_d < 2 or n_n < 2:
        return None, 0, None
    pooled = np.concatenate([dry, normal])
    obs = float(dry.mean() - normal.mean())
    total = float(pooled.sum())
    n = n_d + n_n
    count = 0
    splits = 0
    tol = 1e-12 * max(1.0, abs(obs))
    for idx in itertools.combinations(range(n), n_d):
        s = float(pooled[list(idx)].sum())
        d = s / n_d - (total - s) / n_n
        splits += 1
        if abs(d) >= abs(obs) - tol:
            count += 1
    return count / splits, splits, obs


# ======================================================================================
# Pure helpers: statistics
# ======================================================================================
def finite(values: Iterable[float | None]) -> np.ndarray:
    return np.array(
        [v for v in values if v is not None and math.isfinite(v)], dtype=float
    )


def bootstrap_mean_ci(
    xs: np.ndarray,
    seed: int,
    resamples: int = BOOTSTRAP_RESAMPLES,
    level: float = BOOTSTRAP_LEVEL,
    min_n: int = BOOTSTRAP_MIN_N,
) -> tuple[float, float] | None:
    """Percentile bootstrap CI of the mean (numpy PCG64, quantile type 7). None for n < min_n."""
    n = len(xs)
    if n < min_n:
        return None
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(resamples, n))
    means = xs[idx].mean(axis=1)
    a = (1 - level) / 2
    lo, hi = np.quantile(means, [a, 1 - a])
    return float(lo), float(hi)


def bootstrap_diff_ci(
    a: np.ndarray,
    b: np.ndarray,
    seed: int,
    resamples: int = BOOTSTRAP_RESAMPLES,
    level: float = BOOTSTRAP_LEVEL,
    min_n: int = BOOTSTRAP_MIN_N,
) -> tuple[float, float] | None:
    """Percentile bootstrap CI of mean(a) - mean(b); both groups resampled with replacement.
    None when a group has fewer than min_n values."""
    if len(a) < min_n or len(b) < min_n:
        return None
    rng = np.random.default_rng(seed)
    ia = rng.integers(0, len(a), size=(resamples, len(a)))
    ib = rng.integers(0, len(b), size=(resamples, len(b)))
    diffs = a[ia].mean(axis=1) - b[ib].mean(axis=1)
    q = (1 - level) / 2
    lo, hi = np.quantile(diffs, [q, 1 - q])
    return float(lo), float(hi)


SEEDS_USED: dict[str, int] = {}


def summarise(values: Iterable[float | None], seed: int, name: str) -> dict[str, Any]:
    """n, mean, SD, median, range and the bootstrap CI (n >= 3) of the values."""
    SEEDS_USED[name] = seed
    xs = finite(values)
    ci = bootstrap_mean_ci(xs, seed)
    n = len(xs)
    return {
        "n": n,
        "mean": float(xs.mean()) if n else None,
        "sd": float(xs.std(ddof=1)) if n >= 2 else None,
        "median": float(np.median(xs)) if n else None,
        "min": float(xs.min()) if n else None,
        "max": float(xs.max()) if n else None,
        "ci": None if ci is None else [ci[0], ci[1]],
        "ciLo": ci[0] if ci else None,
        "ciHi": ci[1] if ci else None,
    }


def compare_groups(
    dry: Iterable[float | None], normal: Iterable[float | None], seed: int, name: str
) -> dict[str, Any]:
    """Difference dry - normal of the means, its bootstrap CI and the exact permutation p.
    With one dry value: the value against the mean, SD and range of the normal group."""
    SEEDS_USED[name] = seed
    d, n = finite(dry), finite(normal)
    out: dict[str, Any] = {
        "nDry": len(d),
        "nNormal": len(n),
        "diff": float(d.mean() - n.mean()) if len(d) and len(n) else None,
        "ci": None,
        "permutationP": None,
        "nSplits": 0,
        "single": None,
    }
    ci = bootstrap_diff_ci(d, n, seed)
    if ci is not None:
        out["ci"] = [ci[0], ci[1]]
    p, splits, _ = exact_permutation_p(d, n)
    out["permutationP"], out["nSplits"] = p, splits
    if len(d) == 1 and len(n) >= 2:
        sd = float(n.std(ddof=1))
        out["single"] = {
            "value": float(d[0]),
            "normalMean": float(n.mean()),
            "normalSd": sd,
            "normalMin": float(n.min()),
            "normalMax": float(n.max()),
            "sdUnits": float((d[0] - n.mean()) / sd) if sd > 0 else None,
            "aboveNormalMax": bool(d[0] > n.max()),
            "belowNormalMin": bool(d[0] < n.min()),
        }
    return out


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


def short_text(s: str, n: int = DETAIL_SHORT) -> str:
    """The text, cut at a word boundary to not more than n characters (with an ellipsis)."""
    s = s.strip()
    if len(s) <= n:
        return s
    cut = s[: n - 1].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "…"


def nice_range(
    lo: float, hi: float, step: float = Y_STEP, hold: tuple[float, ...] = REF_LINES
) -> list[float]:
    """[lo, hi] rounded outwards to a multiple of `step`, extended to hold the values in `hold`."""
    a = math.floor(min(lo, *hold) / step) * step
    b = math.ceil(max(hi, *hold) / step) * step
    return [float(a), float(b)]


# ======================================================================================
# Read
# ======================================================================================
EVENTS_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(ALL_SITES)),
        "date": pa.Column(object),
        "date_end": pa.Column(object, nullable=True),
        "type": pa.Column(str, pa.Check.isin(EVENT_TYPES)),
        "detail": pa.Column(object),
        "crop": pa.Column(object, nullable=True),
        "dry_mass_kg_ha": pa.Column(float, pa.Check.ge(0), nullable=True),
    },
    strict=True,
)
DAILY_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(ALL_SITES)),
        "date_local": pa.Column(object),
        "gpp_gc": pa.Column(float, nullable=True),
        "reco_gc": pa.Column(float, nullable=True),
        "nee_f_gc": pa.Column(float, nullable=True),
        "frac_measured": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
    },
    strict=True,
)
OBS_SCHEMA = pa.DataFrameSchema(
    {
        "site": pa.Column(str, pa.Check.isin(SITES)),
        "day": pa.Column(int),
        "ppfd": pa.Column(float, pa.Check.ge(-50), nullable=True),
        "sw_in": pa.Column(float, pa.Check.ge(-50), nullable=True),
        "swc": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
    },
    strict=True,
)
SPI_SCHEMA = pa.DataFrameSchema(
    {
        "Year": pa.Column(int, pa.Check.in_range(1980, 2026)),
        "Month": pa.Column(int, pa.Check.in_range(1, 12)),
        "SPI1": pa.Column(float, nullable=True),
        "SPI3": pa.Column(float, nullable=True),
        "Station": pa.Column(str, pa.Check.isin(sorted(set(STATION_OF_SITE.values())))),
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


def date_days(c: pd.Series) -> np.ndarray:
    """Day numbers of a date column (NaN for a missing date)."""
    dt = pd.to_datetime(c)
    out = np.full(len(c), np.nan)
    ok = dt.notna().to_numpy()
    out[ok] = ((dt[ok] - pd.Timestamp("1970-01-01")) // pd.Timedelta(days=1)).to_numpy(
        dtype=float
    )
    return out


def num_or_none(v: Any) -> float | None:
    if v is None:
        return None
    f = float(v)
    return None if math.isnan(f) else f


def local_days(ts_utc: pd.Series, offset_min: pd.Series) -> np.ndarray:
    """Local day numbers of UTC period starts: floor((ts + offset) / 1 day)."""
    if ts_utc.dt.tz is None:
        ts_utc = ts_utc.dt.tz_localize("UTC")
    elif str(ts_utc.dt.tz) != "UTC":
        raise InputError(f"ts_start has the time zone {ts_utc.dt.tz}, expected UTC")
    local = ts_utc + pd.to_timedelta(offset_min.to_numpy(dtype=np.int64), unit="m")
    epoch = pd.Timestamp("1970-01-01", tz="UTC")
    return ((local - epoch) // pd.Timedelta(days=1)).to_numpy(dtype=np.int64)


@dataclass
class Data:
    names: dict[str, str]
    slots: dict[str, int]
    offsets: dict[str, int]
    site_ids: dict[str, int]
    events: list[Event]
    tables: dict[str, DayTable]
    years: dict[str, list[int]]
    spi: pd.DataFrame
    par: dict[str, Any]
    steps: dict[str, Any]


def read_sites(db: Path) -> tuple[dict[str, str], dict[str, int], dict[str, int]]:
    sites = pd.read_parquet(
        db / "sites.parquet", columns=columns_of("db/sites.parquet"), engine="pyarrow"
    )
    sites = sites.sort_values("site_id").reset_index(drop=True)
    sites["code"] = sites["code"].astype(str)
    if tuple(sites["code"]) != ALL_SITES:
        raise InputError(
            f"sites.parquet: expected the sites {ALL_SITES}, got {tuple(sites['code'])}"
        )
    names = dict(zip(sites["code"], sites["name"].astype(str), strict=True))
    offsets = {
        str(c): int(o)
        for c, o in zip(sites["code"], sites["utc_offset_min"], strict=True)
    }
    site_ids = {
        str(c): int(i) for c, i in zip(sites["code"], sites["site_id"], strict=True)
    }
    return names, offsets, site_ids


def read_events(db: Path, steps: dict[str, Any]) -> list[Event]:
    ev = pd.read_parquet(
        db / "events.parquet", columns=columns_of("db/events.parquet"), engine="pyarrow"
    )
    n_read = len(ev)
    ev["site_code"] = ev["site_code"].astype(str)
    ev["type"] = ev["type"].astype(str)
    ev["date"] = pd.to_datetime(ev["date"]).dt.date
    ev["date_end"] = pd.to_datetime(ev["date_end"]).dt.date.astype(object)
    ev["date_end"] = ev["date_end"].where(ev["date_end"].notna(), None)
    ev["detail"] = ev["detail"].astype(object).where(ev["detail"].notna(), "")
    ev["crop"] = ev["crop"].astype(object).where(ev["crop"].notna(), None)
    ev["dry_mass_kg_ha"] = ev["dry_mass_kg_ha"].astype(float)
    ev = pd.DataFrame(EVENTS_SCHEMA.validate(ev))
    ev = frame(ev[col(ev, "site_code").isin(EPISODE_SITES)])
    ev = ev.sort_values(["site_code", "date", "type"], kind="stable").reset_index(
        drop=True
    )
    events: list[Event] = []
    for r in ev.to_dict("records"):
        events.append(
            Event(
                str(r["site_code"]),
                day_number(r["date"]),
                None if r["date_end"] is None else day_number(r["date_end"]),
                str(r["type"]),
                str(r["detail"] or ""),
                None if r["crop"] is None else str(r["crop"]),
                num_or_none(r["dry_mass_kg_ha"]),
            )
        )
    n_hc = sum(1 for e in events if e.type in ("harvest", "cut"))
    steps["events"] = {
        "rowsRead": n_read,
        "rowsFinnishSites": len(events),
        "rowsDropped": n_read - len(events),
        "harvestCutEvents": n_hc,
        "rule": "events of the five Finnish sites; harvest and cut events make the episodes",
    }
    log.info(
        "events: %d rows read; %d of the five Finnish sites (%d dropped: Maktau); %d harvest or cut",
        n_read,
        len(events),
        n_read - len(events),
        n_hc,
    )
    return events


def read_observations(
    db: Path, site_ids: dict[str, int], offsets: dict[str, int], steps: dict[str, Any]
) -> pd.DataFrame:
    """The 30-min ppfd, sw_in and swc of the grass sites with the local day number."""
    ids = [site_ids[s] for s in SITES]
    obs = pd.read_parquet(
        db / "observations.parquet",
        columns=columns_of("db/observations.parquet"),
        filters=[("site_id", "in", ids)],
        engine="pyarrow",
    )
    n_read = len(obs)
    code_of = {v: k for k, v in site_ids.items()}
    obs["site"] = col(obs, "site_id").map(code_of).astype(str)
    offs = col(obs, "site").map(offsets)
    obs["day"] = local_days(col(obs, "ts_start"), offs)
    obs = frame(obs[["site", "day", "ppfd", "sw_in", "swc"]])
    for v in ("ppfd", "sw_in", "swc"):
        obs[v] = obs[v].astype(float)
    obs = pd.DataFrame(OBS_SCHEMA.validate(obs))
    per_site = {
        s: {
            "rows": int((col(obs, "site") == s).sum()),
            "ppfdValues": int(col(obs.loc[col(obs, "site") == s], "ppfd").count()),
            "swInValues": int(col(obs.loc[col(obs, "site") == s], "sw_in").count()),
            "swcValues": int(col(obs.loc[col(obs, "site") == s], "swc").count()),
        }
        for s in SITES
    }
    steps["observations"] = {
        "rowsRead": n_read,
        "rowsGrassSites": len(obs),
        "perSite": per_site,
        "rule": "30-min rows of the four grass sites (Parquet filter on site_id); local day = "
        "floor((ts_start + utc_offset_min) / 1 day), ts_start localised to UTC",
    }
    log.info(
        "observations: %d rows of the four grass sites read (%s)",
        n_read,
        ", ".join(
            f"{s} {p['rows']} rows, ppfd {p['ppfdValues']}, sw_in {p['swInValues']}, "
            f"swc {p['swcValues']}"
            for s, p in per_site.items()
        ),
    )
    return obs


def read_daily(calculated: Path, steps: dict[str, Any]) -> pd.DataFrame:
    daily = pd.read_parquet(
        calculated / "daily.parquet",
        columns=columns_of("calculated/daily.parquet"),
        engine="pyarrow",
    )
    n_daily = len(daily)
    daily["site_code"] = daily["site_code"].astype(str)
    daily["date_local"] = pd.to_datetime(daily["date_local"]).dt.date
    daily = pd.DataFrame(DAILY_SCHEMA.validate(daily))
    daily = frame(daily[col(daily, "site_code").isin(SITES)])
    daily["day"] = date_days(col(daily, "date_local")).astype(np.int64)
    steps["daily"] = {
        "rowsRead": n_daily,
        "rowsGrassSites": len(daily),
        "rowsDropped": n_daily - len(daily),
        "rule": "daily rows of the four grass sites; no row is removed, a missing value is a gap",
    }
    log.info("daily: %d rows read, %d of the four grass sites", n_daily, len(daily))
    return daily


def read_spi(spi: Path, steps: dict[str, Any]) -> pd.DataFrame:
    df = pd.read_csv(
        spi / "SPI_all_stations.csv",
        usecols=columns_of("spi/SPI_all_stations.csv"),
        na_values=["NA"],
        encoding="utf-8",
    )
    n_read = len(df)
    df["Station"] = df["Station"].astype(str)
    df["Year"] = df["Year"].astype(int)
    df["Month"] = df["Month"].astype(int)
    df = pd.DataFrame(SPI_SCHEMA.validate(df))
    dup = df.duplicated(["Station", "Year", "Month"]).sum()
    if dup:
        raise InputError(f"SPI_all_stations.csv: {dup} duplicate station months")
    steps["spi"] = {
        "rowsRead": n_read,
        "stations": sorted(set(col(df, "Station"))),
        "spi1Missing": int(col(df, "SPI1").isna().sum()),
        "spi3Missing": int(col(df, "SPI3").isna().sum()),
        "rule": "one row per station and month; no row is removed",
    }
    log.info(
        "spi: %d station months read (%s); SPI-1 missing in %d, SPI-3 in %d",
        n_read,
        ", ".join(steps["spi"]["stations"]),
        steps["spi"]["spi1Missing"],
        steps["spi"]["spi3Missing"],
    )
    return df


def read_data(db: Path, calculated: Path, spi: Path) -> Data:
    steps: dict[str, Any] = {}

    variables = pd.read_parquet(
        db / "variables.parquet",
        columns=columns_of("db/variables.parquet"),
        engine="pyarrow",
    )
    units = dict(zip(variables["column_name"], variables["unit"], strict=True))
    for name, unit in EXPECTED_UNITS.items():
        if units.get(name) != unit:
            raise InputError(
                f"variables.parquet: unit of {name} expected {unit!r}, actual {units.get(name)!r}"
            )
    log.info(
        "units checked in variables.parquet: %s; daily GPP in %s, daily PAR in %s",
        ", ".join(f"{k} [{v}]" for k, v in EXPECTED_UNITS.items()),
        DAILY_UNIT,
        PAR_UNIT,
    )

    names, offsets, site_ids = read_sites(db)
    slots = {s: i for i, s in enumerate(ALL_SITES)}
    steps["sites"] = {"rowsRead": len(ALL_SITES), "grassSites": list(SITES)}
    events = read_events(db, steps)
    obs = read_observations(db, site_ids, offsets, steps)
    daily = read_daily(calculated, steps)
    spi_df = read_spi(spi, steps)

    # ----- daily PAR, SW_in and swc from the half hours -----
    par_d = daily_from_half_hours(obs, "ppfd", factor=DAY_FACTOR)
    sw_d = daily_from_half_hours(obs, "sw_in", factor=DAY_FACTOR)
    swc_d = daily_from_half_hours(obs, "swc")
    days = par_d[["site", "day"]].merge(sw_d[["site", "day"]], how="outer")
    days = days.merge(swc_d[["site", "day"]], how="outer").sort_values(["site", "day"])
    days = days.merge(par_d.rename(columns={"n": "nPpfd", "value": "par"}), how="left")
    days = days.merge(sw_d.rename(columns={"n": "nSw", "value": "sw"}), how="left")
    days = days.merge(swc_d.rename(columns={"n": "nSwc", "value": "swc"}), how="left")
    days = frame(days.reset_index(drop=True))

    # ----- k = PAR / SW_in -----
    k_sites: dict[str, Any] = {}
    for s in K_CANDIDATE_SITES:
        d = frame(days[col(days, "site") == s])
        k_sites[s] = k_ratio(
            col(d, "par").to_numpy(dtype=float), col(d, "sw").to_numpy(dtype=float)
        )
    k_used_sites = [
        s
        for s in K_CANDIDATE_SITES
        if s in K_ALWAYS_SITES or k_sites[s]["nDays"] >= K_MIN_DAYS
    ]
    pooled = frame(days[col(days, "site").isin(k_used_sites)])
    k_pooled = k_ratio(
        col(pooled, "par").to_numpy(dtype=float),
        col(pooled, "sw").to_numpy(dtype=float),
    )
    k = k_pooled["median"]
    if k is None:
        raise InputError("k: no day with PAR and SW_in at the k sites")
    medians = [k_sites[s]["median"] for s in k_used_sites]
    k_min, k_max = min(medians), max(medians)
    for s in K_CANDIDATE_SITES:
        ks = k_sites[s]
        log.info(
            "k %s: %d days with PAR >= %g %s, median %s, 10 to 90 %% %s to %s %s%s",
            s,
            ks["nDays"],
            MIN_PAR,
            PAR_UNIT,
            fmt(ks["median"], 3),
            fmt(ks["p10"], 3),
            fmt(ks["p90"], 3),
            K_UNIT,
            "" if s in k_used_sites else f" (not pooled: fewer than {K_MIN_DAYS} days)",
        )
    log.info(
        "k pooled over %s: %d days, median %.4f %s (10 to 90 %% %.3f to %.3f); used for Qvidja; "
        "sensitivity with the per-site medians %.4f and %.4f; PAR energy fraction k / %.2f = "
        "%.1f %% of the global radiation (assumption: %.2f umol J-1)",
        ", ".join(k_used_sites),
        k_pooled["nDays"],
        k,
        K_UNIT,
        k_pooled["p10"],
        k_pooled["p90"],
        k_min,
        k_max,
        PAR_UMOL_PER_J,
        100 * k / PAR_UMOL_PER_J,
        PAR_UMOL_PER_J,
    )
    par_info = {
        "k": k,
        "kMin": k_min,
        "kMax": k_max,
        "energyFraction": k / PAR_UMOL_PER_J,
        "energyFractionPct": 100 * k / PAR_UMOL_PER_J,
        "parConversion": PAR_CONVERSION_ASSUMPTION,
        "kSites": k_used_sites,
        "perSite": k_sites,
        "pooled": k_pooled,
        "minDaysForSite": K_MIN_DAYS,
        "swSites": list(SW_SITES),
        "unit": K_UNIT,
        "rule": (
            f"k = median of the daily PAR / SW_in over the days with PAR >= {MIN_PAR:g} {PAR_UNIT} "
            f"at the sites with ppfd and sw_in ({', '.join(K_ALWAYS_SITES)} always; a site with "
            f"fewer than {K_MIN_DAYS} such days is not pooled); Qvidja PAR = SW_in x k"
        ),
    }
    is_sw = col(days, "site").isin(SW_SITES).to_numpy()
    par = col(days, "par").to_numpy(dtype=float).copy()
    par[is_sw] = col(days, "sw").to_numpy(dtype=float)[is_sw] * k
    days["par"] = par
    days["parSource"] = np.where(is_sw, "sw_in x k", "ppfd")

    # ----- day tables -----
    tables: dict[str, DayTable] = {}
    years: dict[str, list[int]] = {}
    per_site: dict[str, Any] = {}
    n_dark_total = 0
    for site in SITES:
        d = frame(daily[col(daily, "site_code") == site])
        dd = col(d, "day").to_numpy()
        o = frame(days[col(days, "site") == site])
        od = col(o, "day").to_numpy(dtype=np.int64)
        lo, hi = int(min(dd.min(), od.min())), int(max(dd.max(), od.max()))
        t = DayTable(lo, hi)
        for src, dst in (
            ("gpp_gc", "gpp"),
            ("reco_gc", "reco"),
            ("nee_f_gc", "nee"),
            ("frac_measured", "frac"),
        ):
            t.set(dst, dd, col(d, src).to_numpy(dtype=float))
        t.set("par", od, col(o, "par").to_numpy(dtype=float))
        t.set("swc", od, col(o, "swc").to_numpy(dtype=float))
        all_days = np.arange(lo, hi + 1)
        lue, n_dark = lue_days(t.values("gpp", lo, hi), t.values("par", lo, hi))
        t.set("lue", all_days, lue)
        n_dark_total += n_dark
        tables[site] = t
        years[site] = sorted({int(x.year) for x in col(d, "date_local")})
        per_site[site] = {
            "dailyRows": len(d),
            "firstDay": iso_day(int(dd.min())),
            "lastDay": iso_day(int(dd.max())),
            "daysWithGpp": int(col(d, "gpp_gc").notna().sum()),
            "localDays": len(o),
            "daysWithPar": int(col(o, "par").notna().sum()),
            "daysWithSwc": int(col(o, "swc").notna().sum()),
            "parSource": "sw_in x k" if site in SW_SITES else "ppfd",
            "daysWithGppAndPar": int((~np.isnan(lue)).sum() + n_dark),
            "daysParBelowMin": n_dark,
            "daysWithLue": int((~np.isnan(lue)).sum()),
        }
        log.info(
            "%s: %d daily rows %s to %s, %d days with GPP; %d local days, %d with PAR (%s), "
            "%d with swc; %d days with GPP and PAR, %d of them with PAR < %g %s (no LUE), "
            "%d days with LUE",
            site,
            len(d),
            per_site[site]["firstDay"],
            per_site[site]["lastDay"],
            per_site[site]["daysWithGpp"],
            len(o),
            per_site[site]["daysWithPar"],
            per_site[site]["parSource"],
            per_site[site]["daysWithSwc"],
            per_site[site]["daysWithGppAndPar"],
            n_dark,
            MIN_PAR,
            PAR_UNIT,
            per_site[site]["daysWithLue"],
        )
    steps["dailyPar"] = {
        "minHalfHours": MIN_HALF_HOURS,
        "halfHoursPerDay": HALF_HOURS_PER_DAY,
        "dayFactor": DAY_FACTOR,
        "minPar": MIN_PAR,
        "daysParBelowMin": n_dark_total,
        "perSite": per_site,
        "rule": (
            f"daily PAR = mean ppfd x {DAY_FACTOR:g} ({PAR_UNIT}), daily SW_in = mean sw_in x "
            f"{DAY_FACTOR:g} ({SW_UNIT}), daily swc = mean swc; a day counts with {MIN_HALF_HOURS} "
            f"or more of {HALF_HOURS_PER_DAY} half hours; LUE = GPP / PAR on the days with PAR >= "
            f"{MIN_PAR:g} {PAR_UNIT}"
        ),
    }
    log.info(
        "LUE: %d days with GPP and PAR lose their LUE because PAR < %g %s",
        n_dark_total,
        MIN_PAR,
        PAR_UNIT,
    )
    return Data(
        names, slots, offsets, site_ids, events, tables, years, spi_df, par_info, steps
    )


# ======================================================================================
# Analysis
# ======================================================================================
@dataclass
class Context:
    """All harvest and cut episodes and the blocking events, for the rules of one episode."""

    episodes: list[HarvestEpisode]
    events: list[Event]

    def other_harvest(
        self, ep: HarvestEpisode, lo: int, hi: int
    ) -> list[HarvestEpisode]:
        return [
            o
            for o in self.episodes
            if o is not ep and o.site == ep.site and overlaps(o.start, o.end, lo, hi)
        ]

    def blocking(self, ep: HarvestEpisode, lo: int, hi: int) -> list[Event]:
        """Grazing and tillage events of the site that overlap the days lo .. hi."""
        return [
            e
            for e in self.events
            if e.site == ep.site
            and e.type in ("grazing", "tillage")
            and overlaps(e.date, e.hi, lo, hi)
        ]

    def next_disturbance_days(self, ep: HarvestEpisode) -> int | None:
        """Days after `end` when the next harvest, cut or grazing starts, or None (tillage does not count)."""
        starts = [
            o.start for o in self.episodes if o.site == ep.site and o.start > ep.end
        ]
        starts += [
            e.date
            for e in self.events
            if e.site == ep.site and e.type == "grazing" and e.date > ep.end
        ]
        return min(starts) - ep.end if starts else None

    def cut_number(self, ep: HarvestEpisode) -> int:
        """Ordinal of the episode among the harvest and cut episodes of the site in its year."""
        year = iso_day(ep.start)[:4]
        same = [
            o
            for o in self.episodes
            if o.site == ep.site and iso_day(o.start)[:4] == year
        ]
        return sorted(same, key=lambda o: o.start).index(ep) + 1


def flux_use_text(
    exclusion: str | None,
    overlap_text: str,
    before: WindowMeans,
    after: WindowMeans,
    n_par_before: int,
) -> str:
    """ "used" or the reason of the exclusion (text of the table, as Deep Dive #7)."""
    if exclusion is None:
        return "used"
    if exclusion == "overlap":
        return f"excluded: {overlap_text} in the windows"
    if exclusion == "too-few-days":
        return (
            f"excluded: fewer than {MIN_DAYS} days with flux data in a window "
            f"(before {before.n['gpp']}, after {after.n['gpp']})"
        )
    if exclusion == "too-few-par-days":
        return (
            f"excluded: fewer than {MIN_DAYS} days with LUE (GPP and PAR >= {MIN_PAR:g} "
            f"{PAR_UNIT}) in the reference window ({n_par_before})"
        )
    return f"excluded: measured fraction of NEE below {round(MIN_FRAC * 100)} % in a window"


def spi_of(data: Data, site: str, year: int, month: int) -> dict[str, float | None]:
    """SPI-1 and SPI-3 of the station of the site in a month (None when absent)."""
    df = data.spi
    row = df[
        (col(df, "Station") == STATION_OF_SITE[site])
        & (col(df, "Year") == year)
        & (col(df, "Month") == month)
    ]
    if len(row) == 0:
        return {"spi1": None, "spi3": None}
    r = row.iloc[0]
    return {"spi1": num_or_none(r["SPI1"]), "spi3": num_or_none(r["SPI3"])}


def swc_anomaly(
    table: DayTable, end: int, years: Sequence[int], w: tuple[int, int] = SWC_WINDOW
) -> dict[str, Any]:
    """Mean swc of the days end + w[0] .. end + w[1] minus the mean over the same calendar dates
    of all data years of the site (daily means with a value)."""
    n0, m0 = table.range_mean("swc", end + w[0], end + w[1])
    end_date = EPOCH + timedelta(days=end)
    per_year: dict[int, float | None] = {}
    vals: list[float] = []
    for y in years:
        try:
            d = day_number(end_date.replace(year=y))
        except ValueError:  # 29 February in a year without it
            d = day_number(end_date.replace(year=y, day=28))
        n, m = table.range_mean("swc", d + w[0], d + w[1])
        per_year[y] = m if n >= 1 else None
        if m is not None and n >= 1:
            vals.append(m)
    clim = float(np.mean(vals)) if vals else None
    return {
        "nDays": n0,
        "mean": m0,
        "climatology": clim,
        "years": [y for y in years if per_year[y] is not None],
        "nYears": len(vals),
        "perYear": {str(y): v for y, v in per_year.items()},
        "anomaly": m0 - clim if m0 is not None and clim is not None else None,
    }


def rel_window(
    table: DayTable,
    anchor: int,
    w: tuple[int, int],
    ref: dict[str, float | None],
) -> dict[str, Any]:
    """Window means of the relative LUE, GPP and PAR over the days with a LUE value (null with
    fewer than MIN_DAYS days), and the product of the relLUE and relPAR means."""
    lo, hi = anchor + w[0], anchor + w[1]
    lue = table.values("lue", lo, hi)
    gpp = table.values("gpp", lo, hi)
    par = table.values("par", lo, hi)
    ok = ~np.isnan(lue)
    n = int(ok.sum())
    out: dict[str, Any] = {"nDays": n, "days": [lo, hi]}
    ready = n >= MIN_DAYS and all(ref[q] for q in ("lue", "gpp", "par"))
    for q, arr_, key in (
        ("relLue", lue, "lue"),
        ("relGpp", gpp, "gpp"),
        ("relPar", par, "par"),
    ):
        r = ref[key]
        out[q] = float(np.mean(arr_[ok] / r)) if ready and r else None
    out["relLueTimesRelPar"] = (
        out["relLue"] * out["relPar"]
        if out["relLue"] is not None and out["relPar"] is not None
        else None
    )
    gpp_mean = float(np.mean(gpp[ok])) if n else None
    par_mean = float(np.mean(par[ok])) if n else None
    out["gpp"] = gpp_mean
    out["par"] = par_mean
    out["lue"] = gpp_mean / par_mean if gpp_mean is not None and par_mean else None
    return out


def episode_result(data: Data, ctx: Context, ep: HarvestEpisode) -> dict[str, Any]:
    """All numbers of one silage harvest episode."""
    site = ep.site
    t = data.tables[site]
    before = window_means(t, ep.start, BEFORE, MEAN_VARS)
    after = window_means(t, ep.end, AFTER, MEAN_VARS)
    late_free = not ctx.other_harvest(
        ep, ep.end + LATE[0], ep.end + LATE[1]
    ) and not ctx.blocking(ep, ep.end + LATE[0], ep.end + LATE[1])

    # Rules of Deep Dive #7.
    lo, hi = ep.start + BEFORE[0], ep.end + AFTER[1]
    oh = ctx.other_harvest(ep, lo, hi)
    ob = ctx.blocking(ep, lo, hi)
    exclusion = flux_exclusion(before, after, len(oh) + len(ob))
    overlap_text = ", ".join(
        [f"harvest or cut {iso_day(o.start)}" for o in oh]
        + [
            f"{e.type} {iso_day(e.date)}"
            + (f" to {iso_day(e.date_end)}" if e.date_end is not None else "")
            for e in ob
        ]
    )
    used_flux = exclusion is None
    fert_in_window = any(
        e.site == site and e.type == "fertilisation" and overlaps(e.date, e.hi, lo, hi)
        for e in ctx.events
    )
    own = {id(e) for e in ep.events}
    other_events = [
        {
            "date": iso_day(e.date),
            "dateEnd": None if e.date_end is None else iso_day(e.date_end),
            "type": e.type,
            "detail": e.detail,
        }
        for e in ctx.events
        if e.site == site
        and id(e) not in own
        and overlaps(e.date, e.hi, lo, ep.end + LATE[1])
    ]
    nxt = ctx.next_disturbance_days(ep)

    # Reference window: the days with a LUE value; lueBefore = gppBefore / parBefore.
    b_lo, b_hi = ep.start + BEFORE[0], ep.start + BEFORE[1]
    lue_b = t.values("lue", b_lo, b_hi)
    ok_b = ~np.isnan(lue_b)
    n_b = int(ok_b.sum())
    gpp_b = t.values("gpp", b_lo, b_hi)[ok_b]
    par_b = t.values("par", b_lo, b_hi)[ok_b]
    ref: dict[str, float | None] = {"gpp": None, "par": None, "lue": None}
    if n_b:
        ref["gpp"] = float(gpp_b.mean())
        ref["par"] = float(par_b.mean())
        ref["lue"] = ref["gpp"] / ref["par"] if ref["par"] else None
    lue_daily_mean = float(lue_b[ok_b].mean()) if n_b else None
    if exclusion is None and n_b < MIN_DAYS:
        exclusion = "too-few-par-days"
    windows = {
        "after": rel_window(t, ep.end, AFTER, ref),
        "late": rel_window(t, ep.end, LATE, ref) if late_free else None,
    }

    # Day-by-day relative values (the identity relGPP = relLUE x relPAR is checked per day).
    days_json: list[dict[str, Any]] = []
    if ref["lue"] and ref["gpp"] and ref["par"]:
        for off in range(COMPOSITE[0], COMPOSITE[1] + 1):
            d = ep.end + off
            lue_d, gpp_d, par_d = t.get("lue", d), t.get("gpp", d), t.get("par", d)
            cut = nxt is not None and off >= nxt
            if math.isnan(lue_d) or cut:
                days_json.append(
                    {"offset": off, "relLue": None, "relGpp": None, "relPar": None}
                )
                continue
            rl, rg, rp = lue_d / ref["lue"], gpp_d / ref["gpp"], par_d / ref["par"]
            if not math.isclose(rg, rl * rp, rel_tol=IDENTITY_RTOL):
                raise RuntimeError(
                    f"{ep.id} day {off}: relGPP {rg} != relLUE x relPAR {rl * rp}"
                )
            days_json.append({"offset": off, "relLue": rl, "relGpp": rg, "relPar": rp})

    # Dryness.
    end_date = EPOCH + timedelta(days=ep.end)
    spi = spi_of(data, site, end_date.year, end_date.month)
    nxt_month = (end_date.replace(day=1) + timedelta(days=32)).replace(day=1)
    spi_next = spi_of(data, site, nxt_month.year, nxt_month.month)
    swc = swc_anomaly(t, ep.end, data.years[site])
    dry = spi["spi1"] is not None and spi["spi1"] <= SPI_DRY
    dry_spi3 = spi["spi3"] is not None and spi["spi3"] <= SPI_DRY
    dry_swc = swc["anomaly"] is not None and swc["anomaly"] < 0
    dry_minus1 = spi["spi1"] is not None and spi["spi1"] <= SPI_DRY_OTHER_DIVE

    crop_order = [c for c in dict.fromkeys(e.crop for e in ep.events) if c is not None]
    flags = EPISODE_NOTES.get(
        ep.id, {"establishmentYear": False, "partialHarvest": False, "note": None}
    )
    flagged = bool(flags["establishmentYear"] or flags["partialHarvest"])
    in_group = exclusion is None and not flagged
    cut_no = ctx.cut_number(ep)
    return {
        "id": ep.id,
        "site": site,
        "siteName": data.names[site],
        "year": int(iso_day(ep.start)[:4]),
        "cutNo": cut_no,
        "cutGroup": "first" if cut_no == 1 else "later",
        "start": iso_day(ep.start),
        "end": iso_day(ep.end),
        "recorded": iso_day(ep.recorded),
        "durationDays": ep.end - ep.start + 1,
        "harvestMonth": f"{end_date.year}-{end_date.month:02d}",
        "events": [e.json() | {"group": e.group} for e in ep.events],
        "crop": ", ".join(crop_order) if crop_order else None,
        "detailShort": short_text("; ".join(e.detail for e in ep.events if e.detail)),
        "overrides": list(ep.overrides),
        "otherEvents": other_events,
        "fertInWindow": fert_in_window,
        "nextDisturbanceDays": nxt,
        "usedFlux": used_flux,
        "used": exclusion is None,
        "exclusion": exclusion,
        "fluxUse": flux_use_text(exclusion, overlap_text, before, after, n_b),
        "flags": dict(flags),
        "flagged": flagged,
        "inGroup": in_group,
        "groupUse": "used"
        if in_group
        else (FLAG_REASON if exclusion is None else f"excluded: {exclusion}"),
        "station": STATION_OF_SITE[site],
        "spi1": spi["spi1"],
        "spi3": spi["spi3"],
        "spi1Next": spi_next["spi1"],
        "spi1NextMonth": f"{nxt_month.year}-{nxt_month.month:02d}",
        "dry": dry,
        "drySpi3": dry_spi3,
        "drySwc": dry_swc,
        "drySpiMinus1": dry_minus1,
        "dryness": "dry" if dry else "normal",
        "swcAnomaly": swc,
        "fluxBefore": before.json(),
        "fluxAfter": after.json(),
        "lateFree": late_free,
        "before": {
            "nDays": n_b,
            "days": [b_lo, b_hi],
            "gpp": ref["gpp"],
            "par": ref["par"],
            "lue": ref["lue"],
            "lueDailyMean": lue_daily_mean,
        },
        "windows": windows,
        "days": days_json,
    }


# ----- groups -----
def group_stats(
    eps: Sequence[dict[str, Any]],
    cut: str,
    dryness_key: str = "dry",
    full: bool | None = None,
    seed_base: int = SEED_BASE,
) -> dict[str, Any]:
    """Statistics per window and quantity of the dry and the normal episodes of one cut group.
    `dryness_key` selects the dryness definition (dry, drySpi3, drySwc). With `full` (default:
    only the main definition dry), the result has the bootstrap CI and the permutation test;
    else only the plain group means. `seed_base` is the first seed of the bootstrap."""
    ci_idx = CUT_GROUPS.index(cut)
    main = (dryness_key == "dry") if full is None else full
    dry_eps = [e for e in eps if e[dryness_key]]
    normal_eps = [e for e in eps if not e[dryness_key]]
    out: dict[str, Any] = {
        "label": CUT_GROUP_LABELS[cut],
        "drynessKey": dryness_key,
        "n": {"dry": len(dry_eps), "normal": len(normal_eps)},
        "ids": {
            "dry": [e["id"] for e in dry_eps],
            "normal": [e["id"] for e in normal_eps],
        },
    }
    for wi, w in enumerate(WINDOWS):
        block: dict[str, Any] = {}
        for qi, q in enumerate(QUANTITIES):

            def val(e: dict[str, Any], q: str = q, w: str = w) -> float | None:
                win = e["windows"][w]
                return None if win is None else win[q]

            dv = [val(e) for e in dry_eps]
            nv = [val(e) for e in normal_eps]
            base = seed_base + 1000 * ci_idx + 100 * qi + 10 * wi
            tag = f"{cut}.{dryness_key}.{w}.{q}"
            if main:
                block[q] = {
                    "dry": summarise(dv, base, f"{tag}.dry"),
                    "normal": summarise(nv, base + 1, f"{tag}.normal"),
                    "diff": compare_groups(dv, nv, base + 2, f"{tag}.diff"),
                }
            else:
                block[q] = {
                    "dry": plain_stats(dv),
                    "normal": plain_stats(nv),
                    "diff": (
                        float(finite(dv).mean() - finite(nv).mean())
                        if len(finite(dv)) and len(finite(nv))
                        else None
                    ),
                }
        out[w] = block
    return out


def plain_stats(values: Iterable[float | None]) -> dict[str, Any]:
    xs = finite(values)
    n = len(xs)
    return {
        "n": n,
        "mean": float(xs.mean()) if n else None,
        "sd": float(xs.std(ddof=1)) if n >= 2 else None,
        "min": float(xs.min()) if n else None,
        "max": float(xs.max()) if n else None,
    }


def composite(
    eps: Sequence[dict[str, Any]],
    cut: str,
    dryness: str,
    seed_base: int = COMPOSITE_SEED_BASE,
    rule: str = "spi1",
) -> dict[str, Any]:
    """Mean, SD, n and bootstrap CI per offset from end of relLUE, relGPP and relPAR over the
    episodes; mean and SD null when n < min n (2, or 1 in a group of one episode). `seed_base`
    and `rule` (the name in the seed list) separate the main and the SPI-3 grouping."""
    offsets = list(range(COMPOSITE[0], COMPOSITE[1] + 1))
    min_n = min(COMPOSITE_MIN_N, len(eps)) if eps else COMPOSITE_MIN_N
    out: dict[str, Any] = {
        "episodes": len(eps),
        "ids": [e["id"] for e in eps],
        "minNRule": min_n,
    }
    base = seed_base + 2000 * CUT_GROUPS.index(cut) + 1000 * DRYNESS.index(dryness)
    seed_tag = "composite" if rule == "spi1" else f"composite.{rule}"
    for qi, q in enumerate(QUANTITIES):
        means: list[float | None] = []
        sds: list[float | None] = []
        ns: list[int] = []
        los: list[float | None] = []
        his: list[float | None] = []
        for di, off in enumerate(offsets):
            xs = finite(
                next((d[q] for d in e["days"] if d["offset"] == off), None) for e in eps
            )
            n = len(xs)
            ns.append(n)
            means.append(float(xs.mean()) if n >= min_n else None)
            sds.append(float(xs.std(ddof=1)) if n >= 2 else None)
            seed = base + 100 * qi + di
            ci = bootstrap_mean_ci(xs, seed)
            los.append(None if ci is None else ci[0])
            his.append(None if ci is None else ci[1])
        SEEDS_USED[f"{seed_tag}.{cut}.{dryness}.{q}"] = base + 100 * qi
        out[q] = {
            "mean": means,
            "sd": sds,
            "n": ns,
            "ciLo": los,
            "ciHi": his,
            "minN": min(ns),
            "maxN": max(ns),
        }
    log.info(
        "composite %s %s %s: %d episodes, n per day %d to %d",
        rule,
        cut,
        dryness,
        len(eps),
        out["relLue"]["minN"],
        out["relLue"]["maxN"],
    )
    return out


def y_range_of(curves: Iterable[dict[str, Any]], q: str = "relLue") -> list[float]:
    """One nice range over the drawn means and CI bands of the curves."""
    lo, hi = math.inf, -math.inf
    for c in curves:
        for m, a, b in zip(c[q]["mean"], c[q]["ciLo"], c[q]["ciHi"], strict=True):
            for v in (m, a, b):
                if v is not None:
                    lo, hi = min(lo, v), max(hi, v)
    if not math.isfinite(lo):
        lo, hi = min(REF_LINES), max(REF_LINES)
    return nice_range(lo, hi)


def analyse(data: Data) -> dict[str, Any]:
    all_eps = merge_harvest_episodes(data.events, OVERRIDES)
    ctx = Context(all_eps, data.events)
    per_group = {g: sum(1 for e in all_eps if e.group == g) for g in HARVEST_GROUPS}
    silage = [e for e in all_eps if e.group == "silageHarvest"]
    not_grass = [e.id for e in silage if e.site not in SITES]
    if not_grass:
        raise RuntimeError(f"silage harvest episodes outside SITES: {not_grass}")
    log.info(
        "episodes: %d harvest or cut episodes (%s); %d silage harvest episodes",
        len(all_eps),
        ", ".join(f"{g} {n}" for g, n in per_group.items()),
        len(silage),
    )
    episodes = [episode_result(data, ctx, ep) for ep in silage]
    used_flux = [e for e in episodes if e["usedFlux"]]
    used = [e for e in episodes if e["used"]]
    excluded = {x: sum(1 for e in episodes if e["exclusion"] == x) for x in EXCLUSIONS}
    for e in episodes:
        if not e["used"]:
            log.info("episode %s: %s", e["id"], e["fluxUse"])
        elif e["flagged"]:
            log.info("episode %s: %s", e["id"], e["groupUse"])
    in_group = [e for e in used if e["inGroup"]]
    log.info(
        "episodes: %d used by the flux rules of Deep Dive #7, %d with a LUE reference (%s), "
        "%d flagged, %d in the groups",
        len(used_flux),
        len(used),
        ", ".join(f"{k} {v}" for k, v in excluded.items()),
        len(used) - len(in_group),
        len(in_group),
    )
    for e in used:
        log.info(
            "episode %s: cut %d (%s), %s %s SPI-1 %s SPI-3 %s next SPI-1 %s -> %s; swc anomaly %s "
            "(%d years); LUE before %s %s; relLUE after %s, late %s%s",
            e["id"],
            e["cutNo"],
            e["cutGroup"],
            e["station"],
            e["harvestMonth"],
            fmt(e["spi1"]),
            fmt(e["spi3"]),
            fmt(e["spi1Next"]),
            e["dryness"],
            fmt(e["swcAnomaly"]["anomaly"], 3),
            e["swcAnomaly"]["nYears"],
            fmt(e["before"]["lue"], 3),
            LUE_UNIT,
            fmt(e["windows"]["after"]["relLue"]),
            fmt(
                None if e["windows"]["late"] is None else e["windows"]["late"]["relLue"]
            ),
            "" if e["lateFree"] else " (late window blocked)",
        )
    data.steps["episodes"] = {
        "harvestCutEpisodes": len(all_eps),
        "perGroup": per_group,
        "silageEpisodes": len(episodes),
        "usedFlux": len(used_flux),
        "used": len(used),
        "excluded": excluded,
        "flagged": len(used) - len(in_group),
        "inGroups": len(in_group),
        "overridesApplied": sum(len(e.overrides) for e in all_eps),
        "rule": (
            "silage harvest episodes; used when no overlap, 12 or more days per window, "
            "measured fraction 0.10 or more (Deep Dive #7) and 12 or more LUE days in the "
            "reference window; a flagged episode is not in the groups"
        ),
    }

    groups: dict[str, Any] = {}
    comps: dict[str, Any] = {}
    for cut in CUT_GROUPS:
        eps = [e for e in in_group if e["cutGroup"] == cut]
        groups[cut] = group_stats(eps, cut)
        comps[cut] = {
            d: composite([e for e in eps if e["dryness"] == d], cut, d) for d in DRYNESS
        }
        log.info(
            "group %s: %d episodes, dry %d (%s), normal %d (%s)",
            cut,
            len(eps),
            groups[cut]["n"]["dry"],
            ", ".join(groups[cut]["ids"]["dry"]),
            groups[cut]["n"]["normal"],
            ", ".join(groups[cut]["ids"]["normal"]),
        )
        for w in WINDOWS:
            for q in QUANTITIES:
                g = groups[cut][w][q]
                log.info(
                    "  %s %s: dry %s (SD %s, n %d, CI %s to %s), normal %s (SD %s, n %d, CI %s "
                    "to %s), diff %s (CI %s to %s), p %s (%d splits)",
                    w,
                    q,
                    fmt(g["dry"]["mean"], 3),
                    fmt(g["dry"]["sd"], 3),
                    g["dry"]["n"],
                    fmt(g["dry"]["ciLo"], 3),
                    fmt(g["dry"]["ciHi"], 3),
                    fmt(g["normal"]["mean"], 3),
                    fmt(g["normal"]["sd"], 3),
                    g["normal"]["n"],
                    fmt(g["normal"]["ciLo"], 3),
                    fmt(g["normal"]["ciHi"], 3),
                    fmt(g["diff"]["diff"], 3),
                    fmt(None if g["diff"]["ci"] is None else g["diff"]["ci"][0], 3),
                    fmt(None if g["diff"]["ci"] is None else g["diff"]["ci"][1], 3),
                    fmt(g["diff"]["permutationP"], 3),
                    g["diff"]["nSplits"],
                )
    y_range = nice_range(
        *_min_max(
            [comps[c][d] for c in CUT_GROUPS for d in DRYNESS],
        )
    )
    log.info("y range of Figures 1 and 2: %s", y_range)

    # The SPI-3 grouping: the same statistics as the main rule, where n allows.
    groups_spi3: dict[str, Any] = {}
    comps_spi3: dict[str, Any] = {}
    for cut in CUT_GROUPS:
        eps = [e for e in in_group if e["cutGroup"] == cut]
        groups_spi3[cut] = group_stats(
            eps, cut, "drySpi3", full=True, seed_base=SPI3_SEED_BASE
        )
        log.info(
            "group %s by SPI-3: %d episodes, dry %d (%s), normal %d (%s)",
            cut,
            len(eps),
            groups_spi3[cut]["n"]["dry"],
            ", ".join(groups_spi3[cut]["ids"]["dry"]),
            groups_spi3[cut]["n"]["normal"],
            ", ".join(groups_spi3[cut]["ids"]["normal"]),
        )
        for w in WINDOWS:
            for q in QUANTITIES:
                g = groups_spi3[cut][w][q]
                log.info(
                    "  %s %s: dry %s (SD %s, n %d), normal %s (SD %s, n %d, CI %s to %s), "
                    "diff %s, p %s (%d splits)",
                    w,
                    q,
                    fmt(g["dry"]["mean"], 3),
                    fmt(g["dry"]["sd"], 3),
                    g["dry"]["n"],
                    fmt(g["normal"]["mean"], 3),
                    fmt(g["normal"]["sd"], 3),
                    g["normal"]["n"],
                    fmt(g["normal"]["ciLo"], 3),
                    fmt(g["normal"]["ciHi"], 3),
                    fmt(g["diff"]["diff"], 3),
                    fmt(g["diff"]["permutationP"], 3),
                    g["diff"]["nSplits"],
                )
        if groups_spi3[cut]["n"]["dry"] > 0:
            comps_spi3[cut] = {
                d: composite(
                    [e for e in eps if e["drySpi3"] == (d == "dry")],
                    cut,
                    d,
                    seed_base=SPI3_COMPOSITE_SEED_BASE,
                    rule="spi3",
                )
                for d in DRYNESS
            }
        else:
            log.info(
                "composite spi3 %s: no dry episode by SPI-3, no curves and no figure",
                cut,
            )
    y_range_spi3 = nice_range(
        *_min_max(
            [comps[c][d] for c in CUT_GROUPS for d in DRYNESS]
            + [comps_spi3[c][d] for c in comps_spi3 for d in DRYNESS],
        )
    )
    y_range_shared = y_range_spi3 == y_range
    log.info(
        "y range of Figure 4 (over the curves of Figures 1, 2 and 4): %s (%s the range of "
        "Figures 1 and 2)",
        y_range_spi3,
        "equals" if y_range_shared else "differs from",
    )

    # Sensitivity: the other dryness definitions, and k for the Qvidja episodes.
    sens_dryness = {
        key: {
            cut: group_stats([e for e in in_group if e["cutGroup"] == cut], cut, key)
            for cut in CUT_GROUPS
        }
        for key in ("drySpi3", "drySwc", "drySpiMinus1")
    }
    sens_k = sensitivity_k(data, ctx, silage)
    june_2018 = spi_of(data, "qvidja", 2018, 6)

    sites_json = [
        {
            "code": s,
            "name": data.names[s],
            "siteId": data.site_ids[s],
            "slot": data.slots[s],
            "utcOffsetMin": data.offsets[s],
            "station": STATION_OF_SITE[s],
            "parSource": "sw_in x k" if s in SW_SITES else "ppfd",
            "dataYears": data.years[s],
            "episodeYears": sorted({e["year"] for e in episodes if e["site"] == s}),
            "episodes": sum(1 for e in episodes if e["site"] == s),
            "used": sum(1 for e in used if e["site"] == s),
            "inGroups": sum(1 for e in in_group if e["site"] == s),
            "usedIds": [e["id"] for e in used if e["site"] == s],
        }
        for s in SITES
    ]
    counts = {
        "events": len(data.events),
        "harvestCutEpisodes": len(all_eps),
        "perGroup": per_group,
        "silageEpisodes": len(episodes),
        "usedFlux": len(used_flux),
        "used": len(used),
        "excluded": excluded,
        "flagged": len(used) - len(in_group),
        "inGroups": len(in_group),
        "overrides": len(OVERRIDES),
        "perSite": {
            s: {
                "episodes": sum(1 for e in episodes if e["site"] == s),
                "used": sum(1 for e in used if e["site"] == s),
                "inGroups": sum(1 for e in in_group if e["site"] == s),
            }
            for s in SITES
        },
        "perCutGroup": {
            c: {
                "inGroups": groups[c]["n"]["dry"] + groups[c]["n"]["normal"],
                "dry": groups[c]["n"]["dry"],
                "normal": groups[c]["n"]["normal"],
                "lateWindows": {
                    d: groups[c]["late"]["relLue"][d]["n"] for d in DRYNESS
                },
            }
            for c in CUT_GROUPS
        },
        "daysParBelowMin": data.steps["dailyPar"]["daysParBelowMin"],
    }
    summary = summary_json(groups) | {"spi3": summary_json(groups_spi3)}
    return {
        "counts": counts,
        "sites": sites_json,
        "episodes": episodes,
        "groups": groups
        | {
            "spi3": groups_spi3
            | {
                "rule": f"dry = SPI-3 <= {SPI_DRY} of the harvest month",
                "note": (
                    "the same statistics as the main rule where n allows: bootstrap CI with "
                    f"{BOOTSTRAP_MIN_N} or more episodes, exact permutation test with 2 or "
                    "more per group; with 2 dry episodes the mean and both values are given"
                ),
            }
        },
        "composite": {
            "offsets": list(range(COMPOSITE[0], COMPOSITE[1] + 1)),
            "yRange": y_range,
            "perGroup": comps,
            "yRangeSpi3": y_range_spi3,
            "yRangeShared": y_range_shared,
            "spi3": comps_spi3,
        },
        "par": data.par,
        "sensitivity": {
            "dryness": {k: v for k, v in sens_dryness.items() if k != "drySpiMinus1"},
            "spiMinus1": {
                "threshold": SPI_DRY_OTHER_DIVE,
                "note": "dry = SPI-1 <= -1, the rule of the TypeScript dive nee-without-harvest-drought",
                **sens_dryness["drySpiMinus1"],
            },
            "k": sens_k,
        },
        "summary": summary
        | {
            "extra": {
                "june2018": {
                    "station": STATION_OF_SITE["qvidja"],
                    "month": "2018-06",
                    "spi1": june_2018["spi1"],
                    "spi3": june_2018["spi3"],
                    "dry": june_2018["spi1"] is not None
                    and june_2018["spi1"] <= SPI_DRY,
                    "dryMinus1": june_2018["spi1"] is not None
                    and june_2018["spi1"] <= SPI_DRY_OTHER_DIVE,
                    "note": (
                        "Heimsch et al. 2024 classify June 2018 as extremely dry by SPEI "
                        "(qvidja2018Drought); the SPI-1 of the Kaarina Yltöinen series gives "
                        "this value for June 2018"
                    ),
                },
                "parEnergyFraction": data.par["energyFraction"],
            }
        },
    }


def _min_max(curves: Sequence[dict[str, Any]]) -> tuple[float, float]:
    r = y_range_of(curves)
    return r[0], r[1]


def sensitivity_k(
    data: Data, ctx: Context, silage: Sequence[HarvestEpisode]
) -> dict[str, Any]:
    """The group means with the Qvidja PAR made with the smallest and the largest per-site k.
    The relative quantities do not depend on k (k cancels in value / reference); only the days
    with PAR < MIN_PAR can change."""
    out: dict[str, Any] = {
        "k": data.par["k"],
        "kMin": data.par["kMin"],
        "kMax": data.par["kMax"],
        "note": (
            "relLUE, relGPP and relPAR of a Qvidja episode do not depend on k (k cancels in "
            "value / reference); k changes only which Qvidja days have PAR < MIN_PAR, and the "
            "absolute lueBefore and parBefore"
        ),
        "variants": {},
    }
    saved = {s: dict(data.tables[s].vars) for s in SW_SITES}
    try:
        for name, kk in (("kMin", data.par["kMin"]), ("kMax", data.par["kMax"])):
            for s in SW_SITES:
                t = data.tables[s]
                t.vars = dict(saved[s])
                par_new = saved[s]["par"] * (kk / data.par["k"])
                t.vars["par"] = par_new
                lue, _ = lue_days(t.vars["gpp"], par_new)
                t.vars["lue"] = lue
            eps = [episode_result(data, ctx, ep) for ep in silage]
            in_group = [e for e in eps if e["inGroup"]]
            variant: dict[str, Any] = {"k": kk, "perCutGroup": {}}
            for cut in CUT_GROUPS:
                ce = [e for e in in_group if e["cutGroup"] == cut]
                block: dict[str, Any] = {
                    "n": {d: sum(1 for e in ce if e["dryness"] == d) for d in DRYNESS}
                }
                for w in WINDOWS:
                    block[w] = {}
                    for q in QUANTITIES:
                        block[w][q] = {
                            d: plain_stats(
                                [
                                    None
                                    if e["windows"][w] is None
                                    else e["windows"][w][q]
                                    for e in ce
                                    if e["dryness"] == d
                                ]
                            )
                            for d in DRYNESS
                        }
                variant["perCutGroup"][cut] = block
            variant["qvidjaLueBefore"] = {
                e["id"]: e["before"]["lue"] for e in eps if e["site"] in SW_SITES
            }
            out["variants"][name] = variant
    finally:
        for s in SW_SITES:
            data.tables[s].vars = saved[s]
    return out


def summary_json(groups: dict[str, Any]) -> dict[str, Any]:
    """The headline numbers: relLUE per cut group, dryness and window, with CI, difference and p."""
    out: dict[str, Any] = {}
    for cut in CUT_GROUPS:
        g = groups[cut]
        out[cut] = {
            "n": g["n"],
            "ids": g["ids"],
        }
        for w in WINDOWS:
            r = g[w]["relLue"]
            out[cut][w] = {
                "dryMean": r["dry"]["mean"],
                "dryCi": r["dry"]["ci"],
                "dryN": r["dry"]["n"],
                "normalMean": r["normal"]["mean"],
                "normalCi": r["normal"]["ci"],
                "normalN": r["normal"]["n"],
                "diff": r["diff"]["diff"],
                "diffCi": r["diff"]["ci"],
                "permutationP": r["diff"]["permutationP"],
                "nSplits": r["diff"]["nSplits"],
                "single": r["diff"]["single"],
                "relGppDryMean": g[w]["relGpp"]["dry"]["mean"],
                "relGppNormalMean": g[w]["relGpp"]["normal"]["mean"],
                "relParDryMean": g[w]["relPar"]["dry"]["mean"],
                "relParNormalMean": g[w]["relPar"]["normal"]["mean"],
            }
    return out


# ======================================================================================
# Figures
# ======================================================================================
def fmt(x: float | None, digits: int = 2) -> str:
    """Number for the alt text: fixed decimals, minus sign as U+2212."""
    if x is None:
        return "n/a"
    s = f"{x:.{digits}f}"
    if float(s) == 0:
        s = s.lstrip("-")  # no negative zero ("-0") after the rounding
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
            "axes.titlesize": 8 * f,
            "axes.titleweight": "bold",
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
            "axes.linewidth": 0.6,
            "xtick.major.width": 0.6,
            "ytick.major.width": 0.6,
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
    # A text or tspan element without a style attribute.
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


def arr(values: Sequence[float | None]) -> np.ndarray:
    return np.array([np.nan if q is None else q for q in values], dtype=float)


def two_lines(title: str) -> str:
    """The panel title in two lines, broken before FIG_TITLE_BREAK."""
    return title.replace(FIG_TITLE_BREAK, ",\n" + FIG_TITLE_BREAK[2:], 1)


def panel_base(ax: Any, yr: Sequence[float]) -> None:
    """The harvest line, the thin reference lines, the axes and the ticks of a curve panel."""
    ax.axvline(0, color=HARVEST_LINE, lw=1.2, alpha=0.5, zorder=1)
    for y in REF_LINES:
        ax.axhline(y, color=INK, lw=0.6, zorder=1)
    ax.set_xlim(COMPOSITE[0] - 0.5, COMPOSITE[1] + 0.5)
    ax.set_ylim(yr[0], yr[1])
    first_tick = math.ceil(yr[0] / Y_STEP) * Y_STEP
    ax.set_yticks(np.arange(first_tick, yr[1] + Y_STEP / 2, Y_STEP))
    ax.set_xticks(range(COMPOSITE[0], COMPOSITE[1] + 1, 7))
    ax.set_xlabel(X_LABEL)
    ax.set_ylabel(Y_LABEL)


def draw_curve(
    ax: Any, comp: dict[str, Any], offsets: np.ndarray, dryness: str, band: bool
) -> None:
    st = GROUP_STYLE[dryness]
    m = arr(comp["relLue"]["mean"])
    if band:
        lo, hi = arr(comp["relLue"]["ciLo"]), arr(comp["relLue"]["ciHi"])
        ax.fill_between(
            offsets, lo, hi, color=st["color"], alpha=BAND_ALPHA, lw=0, zorder=2
        )
    ax.plot(
        offsets,
        m,
        color=st["color"],
        lw=LINE_WIDTH,
        ls=st["ls"],
        marker=st["marker"],
        ms=MARKER_SIZE,
        markevery=MARK_EVERY,
        zorder=3 if dryness == "normal" else 4,
        solid_capstyle="round",
    )


def legend_handle(dryness: str, label: str) -> Any:
    st = GROUP_STYLE[dryness]
    return Line2D(
        [],
        [],
        color=st["color"],
        lw=LINE_WIDTH,
        ls=st["ls"],
        marker=st["marker"],
        ms=MARKER_SIZE,
        label=label,
    )


def stat_text(s: dict[str, Any], digits: int = 2) -> str:
    """mean (95 % CI lo to hi, n) or mean (SD, n) for the alt text."""
    if s["ci"] is not None:
        return (
            f"{fmt(s['mean'], digits)} (95 % CI {fmt(s['ciLo'], digits)} to "
            f"{fmt(s['ciHi'], digits)}, n {s['n']})"
        )
    return f"{fmt(s['mean'], digits)} (SD {fmt(s['sd'], digits)}, n {s['n']})"


def window_sentence(g: dict[str, Any], w: str) -> str:
    """One sentence per window with the dry and normal relLUE, the difference and p."""
    r = g[w]["relLue"]
    days = AFTER if w == "after" else LATE
    head = f"Days +{days[0]} to +{days[1]}: relative LUE dry {stat_text(r['dry'])}, normal {stat_text(r['normal'])}"
    d = r["diff"]
    if d["single"] is not None:
        s = d["single"]
        return (
            f"{head}; the dry episode is {fmt(s['value'])} against the normal mean "
            f"{fmt(s['normalMean'])} (SD {fmt(s['normalSd'])}, range {fmt(s['normalMin'])} to "
            f"{fmt(s['normalMax'])}), {fmt(s['sdUnits'], 1)} SD units; no test with one dry "
            "episode."
        )
    if d["ci"] is None:
        # Fewer than 3 episodes in a group: no bootstrap CI; the two dry values are given.
        dry = r["dry"]
        values = (
            f"the dry values are {fmt(dry['min'])} and {fmt(dry['max'])}"
            if dry["n"] == 2
            else f"dry n {dry['n']}"
        )
        test = (
            f"exact permutation p = {fmt(d['permutationP'], 2)} ({d['nSplits']} splits)"
            if d["permutationP"] is not None
            else "no test"
        )
        return (
            f"{head}; difference dry − normal {fmt(d['diff'])} (no bootstrap CI with fewer "
            f"than {BOOTSTRAP_MIN_N} dry episodes; {values}), {test}."
        )
    ci = f"{fmt(d['ci'][0])} to {fmt(d['ci'][1])}"
    return (
        f"{head}; difference dry − normal {fmt(d['diff'])} (95 % CI {ci}), exact permutation "
        f"p = {fmt(d['permutationP'], 2)} ({d['nSplits']} splits)."
    )


def common_desc(yr: Sequence[float]) -> str:
    return (
        f"X axis: days from the last day of the harvest ({fmt(COMPOSITE[0], 0)} to "
        f"+{COMPOSITE[1]}, local days, UTC+{UTC_SHIFT_HOURS}). Y axis: LUE = GPP / PAR as a "
        f"fraction of the LUE of the days {fmt(BEFORE[0], 0)} to {fmt(BEFORE[1], 0)} before the "
        f"first day of the harvest, from {fmt(yr[0], 2)} to {fmt(yr[1], 2)}; thin lines mark 1 "
        "and 0, an orange vertical line marks day 0 (the last day of the harvest). Markers every "
        "7 days."
    )


def _fig_first(
    g: dict[str, Any],
    cd: dict[str, Any],
    cn: dict[str, Any],
    offsets: np.ndarray,
    yr: Sequence[float],
    spi_name: str,
    fig_title: str,
    dry_band: bool,
) -> Any:
    """The panel of Figure 1 or 4: the normal and the dry composite curve of the first cuts."""
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, FIG_HEIGHT_IN))
    panel_base(ax, yr)
    draw_curve(ax, cn, offsets, "normal", band=True)
    draw_curve(ax, cd, offsets, "dry", band=dry_band)
    ax.set_title(two_lines(fig_title), loc="left")
    ax.legend(
        handles=[
            legend_handle(
                "normal",
                f"Normal ({spi_name} > {fmt(SPI_DRY, 1)}, n = {cn['episodes']})",
            ),
            legend_handle(
                "dry", f"Dry ({spi_name} ≤ {fmt(SPI_DRY, 1)}, n = {cd['episodes']})"
            ),
        ],
        loc="upper left",
        frameon=False,
        handlelength=3.2,
    )
    fig.subplots_adjust(left=0.11, right=0.99, top=0.86, bottom=0.14)
    return fig


def fig_first_cut(res: dict[str, Any]) -> tuple[Any, str, str]:
    comp = res["composite"]
    offsets = np.array(comp["offsets"], dtype=float)
    yr = comp["yRange"]
    g = res["groups"]["first"]
    cd, cn = comp["perGroup"]["first"]["dry"], comp["perGroup"]["first"]["normal"]
    fig = _fig_first(g, cd, cn, offsets, yr, "SPI-1", FIG1_TITLE, dry_band=True)
    title = (
        f"Light use efficiency (GPP / PAR) from 14 days before to 28 days after the last day of "
        f"a first silage cut, as a fraction of the LUE of the 14 days before the harvest: "
        f"{cd['episodes']} cuts in a dry month (SPI-1 ≤ {fmt(SPI_DRY, 1)}) and {cn['episodes']} "
        "cuts in a normal month; mean and bootstrap 95 % CI over the episodes."
    )
    desc = (
        f"One panel. {common_desc(yr)} Lines: normal group steel blue, solid, with circles; dry "
        "group vermillion, dashed, with squares. The band around each line is the bootstrap 95 % "
        f"CI of the mean over the episodes, drawn where {BOOTSTRAP_MIN_N} or more episodes have a "
        f"value; the line is drawn where {COMPOSITE_MIN_N} or more have a value. Dry episodes: "
        f"{', '.join(g['ids']['dry'])}. Normal episodes: {', '.join(g['ids']['normal'])}. "
        f"{window_sentence(g, 'after')} {window_sentence(g, 'late')}"
    )
    return fig, title, desc


def fig_first_cut_spi3(res: dict[str, Any]) -> tuple[Any, str, str]:
    """Figure 4: as Figure 1, with the groups from SPI-3 <= SPI_DRY of the harvest month."""
    comp = res["composite"]
    offsets = np.array(comp["offsets"], dtype=float)
    yr = comp["yRangeSpi3"]
    g = res["groups"]["spi3"]["first"]
    cd, cn = comp["spi3"]["first"]["dry"], comp["spi3"]["first"]["normal"]
    dry_band = cd["episodes"] >= BOOTSTRAP_MIN_N
    fig = _fig_first(g, cd, cn, offsets, yr, "SPI-3", FIG4_TITLE, dry_band=dry_band)
    title = (
        f"Light use efficiency (GPP / PAR) from 14 days before to 28 days after the last day of "
        f"a first silage cut, as a fraction of the LUE of the 14 days before the harvest, with "
        f"the groups from SPI-3: {cd['episodes']} cuts in a dry month (SPI-3 ≤ "
        f"{fmt(SPI_DRY, 1)}) and {cn['episodes']} cuts in a normal month; mean over the "
        "episodes, with the bootstrap 95 % CI of the normal group."
    )
    band_text = (
        f"The band around each line is the bootstrap 95 % CI of the mean over the episodes, "
        f"drawn where {BOOTSTRAP_MIN_N} or more episodes have a value"
        if dry_band
        else (
            f"The band around the normal line is the bootstrap 95 % CI of the mean over the "
            f"episodes, drawn where {BOOTSTRAP_MIN_N} or more episodes have a value; the dry "
            f"line has no band ({cd['episodes']} episodes, fewer than {BOOTSTRAP_MIN_N})"
        )
    )
    range_text = (
        "The y range is the range of Figures 1 and 2."
        if comp["yRangeShared"]
        else "The y range differs from the range of Figures 1 and 2."
    )
    desc = (
        f"One panel. {common_desc(yr)} {range_text} Lines: normal group steel blue, solid, with "
        f"circles; dry group vermillion, dashed, with squares. {band_text}; the line is drawn "
        f"where {COMPOSITE_MIN_N} or more have a value. Dry episodes (SPI-3 ≤ {fmt(SPI_DRY, 1)}): "
        f"{', '.join(g['ids']['dry'])}. Normal episodes: {', '.join(g['ids']['normal'])}. "
        f"{window_sentence(g, 'after')} {window_sentence(g, 'late')}"
    )
    return fig, title, desc


def fig_later_cuts(res: dict[str, Any]) -> tuple[Any, str, str]:
    comp = res["composite"]
    offsets = np.array(comp["offsets"], dtype=float)
    yr = comp["yRange"]
    g = res["groups"]["later"]
    cd, cn = comp["perGroup"]["later"]["dry"], comp["perGroup"]["later"]["normal"]
    dry_ep = next(e for e in res["episodes"] if e["id"] in g["ids"]["dry"])
    end = date.fromisoformat(dry_ep["end"])
    dry_label = f"Dry ({dry_ep['siteName']} {end.day} {end.strftime('%b')} {end.year}, n = {cd['episodes']})"
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, FIG_HEIGHT_IN))
    panel_base(ax, yr)
    draw_curve(ax, cn, offsets, "normal", band=True)
    draw_curve(ax, cd, offsets, "dry", band=False)
    ax.set_title(two_lines(FIG2_TITLE), loc="left")
    ax.legend(
        handles=[
            legend_handle(
                "normal", f"Normal (SPI-1 > {fmt(SPI_DRY, 1)}, n = {cn['episodes']})"
            ),
            legend_handle("dry", dry_label),
        ],
        loc="upper left",
        frameon=False,
        handlelength=3.2,
    )
    fig.subplots_adjust(left=0.11, right=0.99, top=0.86, bottom=0.14)
    title = (
        f"Light use efficiency (GPP / PAR) from 14 days before to 28 days after the last day of "
        f"a later silage cut (cut 2 or more), as a fraction of the LUE of the 14 days before the "
        f"harvest: the normal group ({cn['episodes']} cuts, mean and bootstrap 95 % CI) and the "
        f"one cut in a dry month, {dry_ep['siteName']} {end.isoformat()} (SPI-1 "
        f"{fmt(dry_ep['spi1'])})."
    )
    desc = (
        f"One panel. {common_desc(yr)} Lines: normal group steel blue, solid, with circles, "
        f"with the bootstrap 95 % CI band of the mean (drawn where {BOOTSTRAP_MIN_N} or more "
        f"episodes have a value); the dry episode {dry_ep['id']} vermillion, dashed, with "
        f"squares, no band (one episode). Normal episodes: {', '.join(g['ids']['normal'])}. "
        f"{window_sentence(g, 'after')} {window_sentence(g, 'late')}"
    )
    return fig, title, desc


def fig_late_vs_spi(
    res: dict[str, Any], data: Data, rule: str = "spi1"
) -> tuple[Any, str, str]:
    """Two panels: the mean relative LUE of days 15 to 28 against the SPI of the harvest month
    (SPI-1 in Figure 3, SPI-3 in Figure 5), one marker per episode."""
    sr = SPI_RULES[rule]
    key, spi_name = sr["key"], sr["name"]
    eps = [
        e
        for e in res["episodes"]
        if e["used"]
        and e["windows"]["late"] is not None
        and e["windows"]["late"]["relLue"] is not None
        and e[key] is not None
    ]
    fig, axes = plt.subplots(1, 2, figsize=(FIG_WIDTH_IN, FIG3_HEIGHT_IN), sharey=True)
    xs_all = [e[key] for e in eps]
    ys_all = [e["windows"]["late"]["relLue"] for e in eps]
    x_lo = math.floor(min(xs_all + [SPI_DRY]) * 2) / 2 - 0.25
    x_hi = math.ceil(max(xs_all) * 2) / 2 + 0.25
    yr = nice_range(min(ys_all), max(ys_all))
    for ax, cut in zip(axes, CUT_GROUPS, strict=True):
        ax.axhline(1.0, color=INK, lw=0.6, zorder=1)
        ax.axhline(0.0, color=INK, lw=0.6, zorder=1)
        ax.axvline(
            SPI_DRY, color=GROUP_STYLE["dry"]["color"], lw=1.0, ls="--", zorder=1
        )
        ax.text(
            SPI_DRY - 0.08,
            yr[1] - 0.04 * (yr[1] - yr[0]),
            DRY_LABEL,
            ha="right",
            va="top",
            color=GROUP_STYLE["dry"]["color"],
            fontsize=plt.rcParams["legend.fontsize"],
        )
        for e in eps:
            if e["cutGroup"] != cut:
                continue
            slot = data.slots[e["site"]]
            color = SITE_COLORS[slot]
            ax.plot(
                e[key],
                e["windows"]["late"]["relLue"],
                marker=SITE_MARKERS[slot],
                ms=MARKER_SIZE + 1.5,
                mec=color,
                mfc="white" if e["flagged"] else color,
                mew=1.5,
                ls="none",
                zorder=3,
            )
        ax.set_xlim(x_lo, x_hi)
        ax.set_ylim(yr[0], yr[1])
        ax.set_yticks(np.arange(0, yr[1] + Y_STEP / 2, Y_STEP))
        ax.set_title(FIG3_TITLES[cut], loc="left")
        ax.set_xlabel(sr["xLabel"])
    axes[0].set_ylabel(Y_LABEL_LATE)
    handles = [
        Line2D(
            [],
            [],
            marker=SITE_MARKERS[data.slots[s]],
            color=SITE_COLORS[data.slots[s]],
            ms=MARKER_SIZE + 1.5,
            ls="none",
            label=data.names[s],
        )
        for s in SITES
    ]
    handles.append(
        Line2D(
            [],
            [],
            marker=SITE_MARKERS[data.slots["viikki"]],
            mec=SITE_COLORS[data.slots["viikki"]],
            mfc="white",
            mew=1.5,
            ms=MARKER_SIZE + 1.5,
            ls="none",
            label="flagged (not in the groups)",
        )
    )
    fig.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.55, 1.0),
        ncol=5,
        frameon=False,
        handletextpad=0.4,
        columnspacing=1.2,
    )
    fig.subplots_adjust(left=0.15, right=0.99, top=0.80, bottom=0.16, wspace=0.12)
    n_first = sum(1 for e in eps if e["cutGroup"] == "first")
    n_later = sum(1 for e in eps if e["cutGroup"] == "later")
    title = (
        f"Mean light use efficiency of the days 15 to 28 after the last day of a silage harvest, "
        f"as a fraction of the LUE of the 14 days before the harvest, against the {spi_name} of "
        f"the harvest month; one marker per episode, first cuts (n = {n_first}) and later cuts "
        f"(n = {n_later}); a dashed line marks the dry limit {spi_name} = {fmt(SPI_DRY, 1)}."
    )

    def points(cut: str) -> str:
        rows = [e for e in eps if e["cutGroup"] == cut]
        rows.sort(key=lambda e: e[key])
        return "; ".join(
            f"{e['id']} {spi_name} {fmt(e[key])}, LUE {fmt(e['windows']['late']['relLue'])}"
            + (" (flagged, open marker)" if e["flagged"] else "")
            for e in rows
        )

    missing = [
        e["id"]
        for e in res["episodes"]
        if e["used"]
        and (e["windows"]["late"] is None or e["windows"]["late"]["relLue"] is None)
    ]
    dry_text = ""
    if rule != "spi1":
        n_dry = {
            c: sum(1 for e in eps if e["cutGroup"] == c and e[key] <= SPI_DRY)
            for c in CUT_GROUPS
        }
        parts = []
        for c in CUT_GROUPS:
            label = FIG3_TITLES[c].lower()
            if n_dry[c] == 0:
                parts.append(
                    f"no {label[:-1]} has {spi_name} ≤ {fmt(SPI_DRY, 1)}: the {label} panel "
                    "has no point at or left of the dry line"
                )
            else:
                parts.append(f"{n_dry[c]} {label} at or left of the dry line")
        joined = "; ".join(parts)
        dry_text = " " + joined[0].upper() + joined[1:] + "."
    desc = (
        f"Two panels side by side with the same axes: first cuts (left) and later cuts (right). "
        f"X axis: {spi_name} of the harvest month, from {fmt(x_lo, 2)} to {fmt(x_hi, 2)}; a "
        f"dashed vermillion vertical line at {fmt(SPI_DRY, 1)} marks the dry limit (dry = at or "
        f"left of it). Y axis: mean LUE of the days +{LATE[0]} to +{LATE[1]} as a fraction of "
        f"the LUE of the days {fmt(BEFORE[0], 0)} to {fmt(BEFORE[1], 0)}, from {fmt(yr[0], 2)} "
        f"to {fmt(yr[1], 2)}; thin lines mark 1 and 0. Marker per site: Anttila blue circle, "
        "Särkisuo orange square, Qvidja reddish purple diamond, Viikki black pentagon; an open "
        "marker is a flagged Viikki episode (establishment year or partial harvest), not in the "
        f"group statistics.{dry_text} First cuts: {points('first')}. Later cuts: "
        f"{points('later')}. Episodes without a late window (blocked or fewer than {MIN_DAYS} "
        f"LUE days): {', '.join(missing) if missing else 'none'}."
    )
    return fig, title, desc


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
        "seeds": dict(sorted(SEEDS_USED.items())),
        "seedRule": {
            "seedBase": SEED_BASE,
            "groups": "SEED_BASE + 1000 x cut group + 100 x quantity + 10 x window + dryness (0 dry, 1 normal, 2 difference)",
            "compositeSeedBase": COMPOSITE_SEED_BASE,
            "composite": "COMPOSITE_SEED_BASE + 2000 x cut group + 1000 x dryness + 100 x quantity + day index (0 = day -14); the seeds list gives the first seed of each curve",
            "spi3SeedBase": SPI3_SEED_BASE,
            "spi3CompositeSeedBase": SPI3_COMPOSITE_SEED_BASE,
            "spi3": "the SPI-3 grouping uses the same rules with SPI3_SEED_BASE and SPI3_COMPOSITE_SEED_BASE",
        },
        "bootstrap": {
            "resamples": BOOTSTRAP_RESAMPLES,
            "level": BOOTSTRAP_LEVEL,
            "minN": BOOTSTRAP_MIN_N,
            "generator": "numpy.random.default_rng (PCG64)",
        },
        "args": {
            "db": str(args.db),
            "calculated": str(args.calculated),
            "spi": str(args.spi),
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
        "sites": list(SITES),
        "episodeSites": list(EPISODE_SITES),
        "kCandidateSites": list(K_CANDIDATE_SITES),
        "kAlwaysSites": list(K_ALWAYS_SITES),
        "kMinDays": K_MIN_DAYS,
        "swSites": list(SW_SITES),
        "stationOfSite": STATION_OF_SITE,
        "grainRegex": GRAIN_RE.pattern,
        "grassRegex": GRASS_RE.pattern,
        "mergeDays": MERGE_DAYS,
        "overrides": list(OVERRIDES),
        "beforeDays": list(BEFORE),
        "afterDays": list(AFTER),
        "lateDays": list(LATE),
        "windowDays": AFTER[1] - AFTER[0] + 1,
        "minDays": MIN_DAYS,
        "minFrac": MIN_FRAC,
        "minFracPct": round(MIN_FRAC * 100),
        "minHalfHours": MIN_HALF_HOURS,
        "halfHoursPerDay": HALF_HOURS_PER_DAY,
        "dayFactor": DAY_FACTOR,
        "minPar": MIN_PAR,
        "spiDry": SPI_DRY,
        "spiDryOtherDive": SPI_DRY_OTHER_DIVE,
        "parUmolPerJ": PAR_UMOL_PER_J,
        "parConversion": PAR_CONVERSION_ASSUMPTION,
        "swcWindow": list(SWC_WINDOW),
        "exclusionOrder": list(EXCLUSIONS),
        "cutGroups": [{"id": c, "label": CUT_GROUP_LABELS[c]} for c in CUT_GROUPS],
        "cutNoRule": "ordinal of the episode among the harvest and cut episodes of the site in that year",
        "windows": list(WINDOWS),
        "quantities": list(QUANTITIES),
        "quantityLabels": QUANTITY_LABELS,
        "compositeFrom": COMPOSITE[0],
        "compositeTo": COMPOSITE[1],
        "compositeMinN": COMPOSITE_MIN_N,
        "yStep": Y_STEP,
        "bootstrapResamples": BOOTSTRAP_RESAMPLES,
        "bootstrapLevel": BOOTSTRAP_LEVEL,
        "bootstrapMinN": BOOTSTRAP_MIN_N,
        "ciLevelPct": round(BOOTSTRAP_LEVEL * 100),
        "permutationTest": "exact, all C(n, nDry) splits, two-sided: share of splits with |difference of means| >= observed",
        "identityRtol": IDENTITY_RTOL,
        "utcShiftHours": UTC_SHIFT_HOURS,
        "nSites": len(SITES),
        "units": {
            "daily": DAILY_UNIT,
            "par": PAR_UNIT,
            "sw": SW_UNIT,
            "lue": LUE_UNIT,
            "k": K_UNIT,
            "relative": "fraction of the reference window (days -14 to -1 from start)",
            "offsets": "days",
        },
        "axisNames": {
            "x": X_LABEL,
            "y": Y_LABEL,
            "xSpi": X_LABEL_SPI,
            "xSpi3": X_LABEL_SPI3,
            "yLate": Y_LABEL_LATE,
        },
        "figureTitles": {
            "1": FIG1_TITLE,
            "2": FIG2_TITLE,
            "3": FIG3_TITLES,
            "4": FIG4_TITLE,
            "5": FIG3_TITLES,
        },
        "yRangeRule": (
            "Figures 1 and 2: one range over their drawn means, CI bands and the single curve "
            f"(rounded outwards to a multiple of {Y_STEP}, extended to hold 0 and 1). Figure 4: "
            "the same rule over the curves of Figures 1, 2 and 4 together "
            "(composite.yRangeSpi3); composite.yRangeShared says whether it equals the range of "
            "Figures 1 and 2"
        ),
        "spi3Rule": {
            "threshold": SPI_DRY,
            "note": (
                "dry = SPI-3 <= -1.5 of the harvest month; the second full grouping "
                "(groups.spi3, composite.spi3, Figures 4 and 5); no later cut is dry"
            ),
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
        "episodeNotes": EPISODE_NOTES,
        "flagReason": FLAG_REASON,
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
        "--spi",
        type=Path,
        default=Path("data/SPI"),
        help="folder of the SPI tables (default: data/SPI)",
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

    errors = check_inputs(args.db, args.calculated, args.spi)
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

    SEEDS_USED.clear()
    try:
        data = read_data(args.db, args.calculated, args.spi)
    except InputError as e:
        log.error("input check: %s", e)
        return 3
    res = analyse(data)

    setup_matplotlib()
    git = git_info(script_dir)
    meta = {
        "source": f"{SCRIPT_PATH} (git {git['commit']}{', dirty' if git['dirty'] else ''})",
        "relation": f"database snapshot {DATABASE['builtAt']}; "
        + "; ".join(f"{i.key} sha256 {i.sha256}" for i in INPUTS),
    }
    figures_json: list[dict[str, Any]] = []
    for n, name in FIGURES:
        if name == "first-cut":
            fig, title, desc = fig_first_cut(res)
        elif name == "later-cuts":
            fig, title, desc = fig_later_cuts(res)
        elif name == "late-lue-vs-spi":
            fig, title, desc = fig_late_vs_spi(res, data)
        elif name == "first-cut-spi3":
            fig, title, desc = fig_first_cut_spi3(res)
        elif name == "late-lue-vs-spi3":
            fig, title, desc = fig_late_vs_spi(res, data, rule="spi3")
        else:
            raise RuntimeError(f"unknown figure {name}")
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
                "id": e["id"],
                "site": e["site"],
                "year": e["year"],
                "cutNo": e["cutNo"],
                "cutGroup": e["cutGroup"],
                "start": e["start"],
                "end": e["end"],
                "used": e["used"],
                "exclusion": e["exclusion"],
                "flagged": e["flagged"],
                "inGroup": e["inGroup"],
                "spi1": e["spi1"],
                "spi3": e["spi3"],
                "spi1Next": e["spi1Next"],
                "dry": e["dry"],
                "swcAnomaly": e["swcAnomaly"]["anomaly"],
                "gppBefore": e["before"]["gpp"],
                "parBefore": e["before"]["par"],
                "lueBefore": e["before"]["lue"],
                "relLueAfter": e["windows"]["after"]["relLue"],
                "relGppAfter": e["windows"]["after"]["relGpp"],
                "relParAfter": e["windows"]["after"]["relPar"],
                "relLueLate": None
                if e["windows"]["late"] is None
                else e["windows"]["late"]["relLue"],
                "relGppLate": None
                if e["windows"]["late"] is None
                else e["windows"]["late"]["relGpp"],
                "relParLate": None
                if e["windows"]["late"] is None
                else e["windows"]["late"]["relPar"],
                "fertInWindow": e["fertInWindow"],
            }
            for e in res["episodes"]
        ]
    ).to_csv(out_dir / "output" / "episodes.csv", index=False, float_format="%.10g")

    dv = data_version(args, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": (
            "How does drought (SPI-1 ≤ −1.5 in the month of the harvest) change the regrowth of "
            "a grassland after a silage harvest, measured as light use efficiency LUE = GPP / "
            "PAR, within the same cut number?"
        ),
        "method": method_json(),
        **res,
        "literature": list(LITERATURE),
        "literatureByKey": literature_by_key(),
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
