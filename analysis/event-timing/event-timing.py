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
"""Management events on the flux timeline: when do GPP, Reco and NEE change?

QUESTION
    At each site, how do the recorded dates of the management events sit against the change of
    daily GPP, Reco and NEE, and against the crop calendar of field crop production?

METHOD
    Sites: Anttila, Sarkisuo, Haltiala, Qvidja, Viikki and Maktau (order of db/sites.parquet).
    1. Local day = ts_start (UTC) + utc_offset_min. Daily air temperature and soil water content =
       mean of the 30-min values of db/observations.parquet; daily precipitation = sum (null when
       all half hours of the day are null). Daily GPP, Reco and gap-filled NEE (g C m-2 d-1), the
       measured fraction of NEE and the daily mean air temperature for the season come from
       data/calculated/daily.parquet. Days with a measured fraction below 0.10 are drawn lighter;
       they are not removed. The timeline of a site is the period from the first to the last day
       with a gap-filled NEE value.
    2. Episodes: the events of one site form one episode when an event starts not more than 7 days
       after the last day (date_end, else date) of the current episode. The event "EC system
       installed" is not a field operation and is not in an episode. Start = first date, end = last
       date_end (or date). Episode kind = the first type of this list that is in the episode:
       harvest, cut, grazing, tillage, sowing, fertilisation, spraying, other. The anchor is the
       first date of an event of the episode kind.
    3. Before window = days -7 to -1 before the start; after window = days +1 to +7 after the end.
       Change = mean after - mean before of daily GPP, Reco and NEE (g C m-2 d-1); GPP also in
       percent of the GPP before (only when the GPP before is 1 g C m-2 d-1 or more). Each side needs
       5 days with a value. An episode with a day of another episode in its windows is flagged
       "overlap" and is not in the summaries.
    4. Change point (port of detectDrop, scripts/lib/deep-dive/change-point.ts): for each candidate
       day t, step(t) = sign * (mean of days t-5..t-1 - mean of days t..t+4), each side with 4 or
       more values. The detected day is the t with the largest step (the first on a tie). The step
       is clear when the higher side (the side before for a drop, the side after for a rise) has a
       mean of 1 g C m-2 d-1 or more and the step is 25 % or more of it. Tests: harvest, cut,
       grazing and tillage episodes: largest GPP drop for t from start - 10 to end + 5. Episodes
       with a sowing: largest GPP rise for t from the sowing date to the sowing date + 40 days.
       Episodes with a tillage: also the largest Reco rise from start - 10 to end + 5.
       Fertilisation, spraying and other: no change point. Offset = detected day - anchor (days;
       negative = the flux changed before the recorded date). An episode is not in the offset
       summaries when another episode with a change-point test (harvest, cut, grazing, tillage,
       sowing) has a day in the days that the search reads (start - 15 to end + 9).
       Check on measured NEE: daily mean of the measured NEE (nee_qc 0 or null, nee not null) of
       the half hours that start from 10:00 to 15:30 local time, 8 or more half hours per day;
       largest drop of -NEE in the same span (3 or more values per side, higher side 1 umol m-2
       s-1 or more). The two change points agree when they differ by 1 day or less.
    5. Alternative dates (ALTERNATIVE_DATES, typed from the sources): the same change-point search,
       on the candidate days within -10 .. +5 days of the used date and of the other date
       (the other event gets the same duration as the used one). Candidates whose 10 side days
       touch another episode are skipped. The result gives the offset to each date and the date
       that is nearer to the detected day.
    6. Summaries per site and kind and per kind: n, mean, SD, median, range of the offset of the
       clear change points, counts before (< 0), on (0) and after (> 0) the anchor, and the share of
       clear tests. Bootstrap 95 % CI of the mean (10 000 resamples, percentile method, numpy
       PCG64, fixed seeds) when n >= 3, else only the range. The same for the 7-day changes.
    7. Thermal growing season (Finnish sites; the +5 degC rule of Peltokasvien tuotanto, ch.
       2.1.1): start = first day from 1 March on with a daily mean above 5 degC on that day and the
       next 9 days (all 10 days with a value); end = first day from 1 August on with a daily mean
       below 5 degC on 10 such days. No start when the data of the year begin after 1 March.
       Maktau: months with a precipitation sum above 50 mm (our rule) are drawn as bands.
    8. Each step that removes rows or changes values logs a count (results.json dataVersion.steps).
    9. Open findings of docs/anomaly-data-report.md that touch this dive are printed (OPEN_FINDINGS).

DATABASE
    builtAt: 2026-10-23T19:03:07.928Z (db/report.json and Parquet key/value metadata built_at)
    calcBuiltAt: 2026-10-23T19:03:09.003Z (data/calculated/report.json and Parquet built_at)
    commit: 44ec98f (HEAD at build time; db/report.json does not record a commit)
    url: TODO: release asset db-2026-10-23.zip not yet published

INPUTS
    db/events.parquet  sha256=b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b  rows=114  columns=site_code, date, date_end, type, detail, source, crop, dry_mass_kg_ha, n_kg_ha
    db/sites.parquet  sha256=9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59  rows=6  columns=site_id, code, name, utc_offset_min
    db/observations.parquet  sha256=922346b5afe2ec56de128311aa3d8dc8cd0ccc1a57700bd333bbdf95a51d8964  rows=537980  columns=site_id, ts_start, nee, nee_qc, ta, swc, precip
    db/variables.parquet  sha256=06e6a41c727958beb973f2b76adb8182d88b0a5d501be6f11c948c0129fb7c6e  rows=26  columns=column_name, unit
    calculated/daily.parquet  sha256=fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9  rows=11209  columns=site_code, date_local, gpp_gc, reco_gc, nee_f_gc, frac_measured, ta_mean

OUTPUTS
    results.json                         all result numbers, figure captions and alt texts, dataVersion
                                         (generatedAt, git, dbBuiltAt, calcBuiltAt, snapshot, inputs, ...)
    manifest.json                        provenance of the run and SHA-256 of the outputs
    figures/1-anttila.svg .. figures/6-maktau.svg   timeline of each site with the events
    figures/7-offsets.svg                offsets of the change points per site and kind
    figures/8-course.svg                 mean course of GPP, Reco and NEE around the events per kind
    output/run.log                       run log (not in git)
    output/episodes.csv                  all episodes with the change points (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/event-timing/event-timing.py --db db --calculated data/calculated

NOTES
    Maktau has no gap filling by the provider: its gap-filled NEE, GPP and Reco come from the MDS
    gap filling and the partitioning of scripts/calc.ts (data/calculated). Maktau has no NEE
    quality flag (nee_qc is null): all its nee values count as measured in the NEE check.
    Haltiala has no precipitation in the database; its precipitation strip is empty.
    The window of the measured NEE (10:00 to 15:30) is in the local time of the database. For
    Anttila, Sarkisuo and Viikki this is 12:00 to 17:30 true local time (open findings ANT-01,
    SAR-01, VII-01).
    The book Peltokasvien tuotanto (Seppanen et al. 2016) gives the crop calendar; it has no
    statement on GPP, Reco, NEE or the days from an event to a flux change.
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
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pandera.pandas as pa
import pyarrow.parquet as pq
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

SLUG = "event-timing"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"
SVG_ID_PREFIX = "et"

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
    """One input file. `root` is "db" or "calculated" (the folder of --db or --calculated)."""

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
        "events.parquet",
        "b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b",
        114,
        (
            "site_code",
            "date",
            "date_end",
            "type",
            "detail",
            "source",
            "crop",
            "dry_mass_kg_ha",
            "n_kg_ha",
        ),
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
        "observations.parquet",
        "922346b5afe2ec56de128311aa3d8dc8cd0ccc1a57700bd333bbdf95a51d8964",
        537980,
        ("site_id", "ts_start", "nee", "nee_qc", "ta", "swc", "precip"),
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
        "calculated",
        "daily.parquet",
        "fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9",
        11209,
        (
            "site_code",
            "date_local",
            "gpp_gc",
            "reco_gc",
            "nee_f_gc",
            "frac_measured",
            "ta_mean",
        ),
        "2026-10-23T19:03:09.003Z",
    ),
)

# Units that the script expects in db/variables.parquet. The script does not convert a unit again.
EXPECTED_UNITS = {
    "nee": "µmol CO2 m-2 s-1",
    "ta": "°C",
    "swc": "m3 m-3",
    "precip": "mm",
    "ts_start": "UTC",
}

# ---------- Method constants ----------
SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
FINNISH_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki")
# Kind of an episode = the first type of this list that is in the episode.
KIND_PRIORITY = (
    "harvest",
    "cut",
    "grazing",
    "tillage",
    "sowing",
    "fertilisation",
    "spraying",
    "other",
)
DROP_KINDS = ("harvest", "cut", "grazing", "tillage")
CHANGE_POINT_KINDS = ("harvest", "cut", "grazing", "tillage", "sowing")
# Kinds of the offset summaries ("harvestCut" = harvest and cut together).
OFFSET_KINDS = ("harvest", "cut", "harvestCut", "grazing", "tillage", "sowing")
# Kinds of the 7-day change summaries.
CHANGE_KINDS = (
    "harvest",
    "cut",
    "harvestCut",
    "grazing",
    "tillage",
    "sowing",
    "fertilisation",
    "spraying",
    "other",
)
COURSE_GROUPS = ("harvestCut", "grazing", "tillage", "sowing", "fertilisation")
TYPE_LETTERS = {
    "harvest": "H",
    "cut": "C",
    "grazing": "G",
    "fertilisation": "F",
    "sowing": "Sw",
    "tillage": "T",
    "spraying": "Sp",
    "other": "O",
}
# Events that are not field operations. They are listed, but not in an episode.
NON_FIELD_DETAIL = re.compile(r"^EC system installed$")

MERGE_DAYS = 7
BEFORE = (-7, -1)
AFTER = (1, 7)
MIN_DAYS = 5
MIN_FRAC = 0.10
SEARCH_FROM = -10
SEARCH_TO = 5
SOWING_SEARCH = (0, 40)
SIDE_DAYS = 5
MIN_SIDE = 4
MIN_SIDE_NEE = 3
MIN_BEFORE = 1.0  # g C m-2 d-1 (GPP, Reco)
MIN_BEFORE_NEE = 1.0  # umol CO2 m-2 s-1 (-NEE, measured day-time mean)
MIN_STEP_PCT = 25.0
AGREE_DAYS = 1
MIN_MEASURED_HH = 8
DAYTIME_HOURS = (10, 16)  # half hours that start from 10:00 to 15:30 local time
SEASON_RUN_DAYS = 10
SEASON_THRESHOLD_C = 5.0
SEASON_START_MONTH = 3
SEASON_END_MONTH = 8
WET_MONTH_MM = 50.0
COURSE_DAYS = (-14, 14)
COURSE_MIN_EPISODES = 2
COURSE_BAND_MIN = 5
LOW_FRAC_SPAN = (-10, 10)
BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_LEVEL = 0.95
HALF_HOURS_PER_DAY = 48
# Open findings ANT-01, SAR-01, VII-01: the stamps of Anttila, Sarkisuo and Viikki are 2 hours early.
UTC_SHIFT_HOURS = 2
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-9
DETAIL_SHORT = 90

# Seeds of the bootstrap. Offsets per kind: 8000 + kind index; per site and kind: 8100 + 10 *
# site index + kind index; 7-day changes: 8300 + 10 * kind index + statistic index; tests: 8500 + i.
SEED_OFFSET_KIND = 8000
SEED_OFFSET_SITE_KIND = 8100
SEED_CHANGE = 8300
SEED_TEST = 8500

HIGHLIGHTS = (
    "anttila-2022-08-08",
    "qvidja-2020-06-23",
    "qvidja-2021-06-14",
    "qvidja-2022-08-05",
)

# ---------- Reference values ----------
# Book rows: ref "peltokasvien-tuotanto" (Seppanen, Yli-Halla, Stoddard, Makela and Helenius 2016,
# 3rd ed., Opetushallitus), section and printed page ("s."), checked with grep on
# data/Peltokasvien_tuotanto/content.html. Article rows: PDF page, checked with pdftotext.
BOOK = "peltokasvien-tuotanto"
LITERATURE: tuple[dict[str, Any], ...] = (
    {
        "key": "thermalSeason",
        "text": "The thermal growing season starts in spring when the daily mean temperature stays above +5 °C and ends in autumn when it falls below +5 °C.",
        "textFi": "Terminen kasvukausi alkaa keväällä, kun vuorokauden keskilämpötila on ylittänyt pysyvästi +5 °C.",
        "value": 5,
        "unit": "°C",
        "uncertainty": None,
        "ref": BOOK,
        "section": "2.1.1",
        "page": "s. 8",
        "tableFigure": None,
    },
    {
        "key": "thermalSeasonLength",
        "text": "The thermal growing season is 180 days in southern Finland and 110 days in the far north; in the south it starts on average at the end of April and ends in mid-October.",
        "textFi": "Termisen kasvukauden pituus vaihtelee siten eteläisen Suomen 180 päivästä pohjoisimman Suomen 110 päivään.",
        "value": [180, 110],
        "unit": "d",
        "uncertainty": None,
        "ref": BOOK,
        "section": "2.1.1",
        "page": "s. 8",
        "tableFigure": None,
    },
    {
        "key": "barleyGrowingTime",
        "text": "Growing time of a barley variety: 96 days in zone I (thermal season 170 to 180 days) and 83 to 87 days in zone IV.",
        "textFi": "Ohralajikkeen kasvuaika (vrk): I 96, IV 83–87; termisen kasvukauden pituus I 170–180.",
        "value": [96, 83, 87],
        "unit": "d",
        "uncertainty": None,
        "ref": BOOK,
        "section": "2.1.2",
        "page": "s. 9",
        "tableFigure": "Table 2.1",
    },
    {
        "key": "grassStart",
        "text": "Perennial crops use the thermal season better; grasses and winter cereals start to grow in spring when the temperature rises just above zero.",
        "textFi": "nurmikasvit ja syysviljat aloittavat kasvun keväällä lämpötilan kohotessa juuri nollan yläpuolelle",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "2.1.2",
        "page": "s. 8",
        "tableFigure": None,
    },
    {
        "key": "drySpellRegrowth",
        "text": "A dry spell after the first harvest slows or even prevents the regrowth of a forage ley, and the second yield stays small.",
        "textFi": "ensimmäisen sadonkorjuun jälkeen ajoittunut kuivuusjakso hidastaa ja jopa estää jälkikasvun",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "2.1.5",
        "page": "s. 14",
        "tableFigure": None,
    },
    {
        "key": "determinateCereals",
        "text": "Cereals have a determinate growth habit and their yield ripens almost at the same time; pulses and oil crops have an indeterminate habit.",
        "textFi": "Viljoilla, joilla on päätteellinen kasvutapa, sato tuleentuu lähes samanaikaisesti.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "3.2.5",
        "page": "s. 45",
        "tableFigure": None,
    },
    {
        "key": "springCerealCalendar",
        "text": "Spring cereals (spring wheat, spring rye, barley and oats) are sown in April and May; they grow for one season and are harvested in late summer.",
        "textFi": "kevätkylvöiset ... kylvetään keväällä huhti-toukokuussa ... niiden sato korjataan syyskesällä",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "4 (introduction)",
        "page": "s. 47",
        "tableFigure": None,
    },
    {
        "key": "cerealRipening",
        "text": "The earliest cereal varieties start to ripen at the end of July and late varieties can ripen only in September; at ripening the leaves die and dry.",
        "textFi": "Heinäkuun lopulla aikaisimmat lajikkeet alkavat tuleentua. Tuleentumisen yhteydessä lehdet kuolevat ja kuivuvat.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "4.1",
        "page": "s. 50–52",
        "tableFigure": None,
    },
    {
        "key": "springCerealFertilisation",
        "text": "Spring cereals usually get their fertiliser in one application at sowing, as placement fertilisation.",
        "textFi": "Kevätviljojen tarvitsema lannoitus annetaan yleensä yhtenä eränä kylvön yhteydessä sijoituslannoituksena.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "4.3.3",
        "page": "s. 59",
        "tableFigure": None,
    },
    {
        "key": "favaBeanGrowingTime",
        "text": "Growing time of fava bean: 111 days.",
        "textFi": "Härkäpapu: kasvuaika 111 vrk",
        "value": 111,
        "unit": "d",
        "uncertainty": None,
        "ref": BOOK,
        "section": "5 (introduction)",
        "page": "s. 67",
        "tableFigure": "Table 5.1",
    },
    {
        "key": "favaBeanFlowering",
        "text": "In Finland, flowering of pea and fava bean starts in late June and continues to the end of July; the seed weight starts to increase about three weeks after flowering.",
        "textFi": "Suomessa kukinta alkaa kesäkuun loppupuolella ja jatkuu aina heinäkuun loppuun.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "5.1",
        "page": "s. 68–69",
        "tableFigure": None,
    },
    {
        "key": "leyHarvestYears",
        "text": "Forage leys that overwinter well are harvested for three to four years after the establishment year.",
        "textFi": "Satoa hyvin talvehtineista rehunurmista korjataan perustamisvuoden jälkeen kolmen neljän vuoden ajan.",
        "value": [3, 4],
        "unit": "yr",
        "uncertainty": None,
        "ref": BOOK,
        "section": "7 (introduction)",
        "page": "s. 87",
        "tableFigure": None,
    },
    {
        "key": "timothyRegrowth",
        "text": "Timothy regrows slowly, because its regrowth starts from the buds at the base of the shoots; fescues regrow fast.",
        "textFi": "Timotei on jälkikasvultaan hidas, sillä sen jälkikasvu lähtee liikkeelle versojen tyvellä olevista silmuista.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.1.1",
        "page": "s. 91",
        "tableFigure": None,
    },
    {
        "key": "cutRemovesLeafArea",
        "text": "A cut removes the whole stand and with it the whole photosynthesising leaf area; regrowth uses the stored sugars and nitrogen at the base of the shoots.",
        "textFi": "Koko kasvusto korjataan ja samalla menetetään koko yhteyttävä lehtipintaala.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.1.2",
        "page": "s. 91",
        "tableFigure": None,
    },
    {
        "key": "grassHarvestTiming",
        "text": "Forage grass is not harvested ripe like cereals; the harvest date follows the yield quantity and quality targets.",
        "textFi": "Nurmirehua ei korjata viljojen tapaan tuleentuneena, vaan korjuuajankohta päätetään sadon määrällisten ja laadullisten tavoitteiden perusteella.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.2",
        "page": "s. 92",
        "tableFigure": None,
    },
    {
        "key": "silageCuts",
        "text": "Two or three forage yields are harvested from silage leys per season; the first is usually the largest; the regrowth stand is short and leafy and develops more slowly.",
        "textFi": "Säilörehunurmista korjataan kasvukauden aikana kaksi tai kolme rehusatoa.",
        "value": [2, 3],
        "unit": "cuts per season",
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.2.1",
        "page": "s. 93–95",
        "tableFigure": None,
    },
    {
        "key": "leyRenewal",
        "text": "Leys are established (sown) and renewed usually every 3 to 5 years.",
        "textFi": "Nurmien viljelytoimiin kuuluu perustaminen eli kylvö ja uudistaminen yleensä 3–5 vuoden välein.",
        "value": [3, 5],
        "unit": "yr",
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.3",
        "page": "s. 96",
        "tableFigure": None,
    },
    {
        "key": "leyEstablishment",
        "text": "Leys can be established in spring under a cover crop or in summer or autumn without a cover crop.",
        "textFi": "Nurmet voidaan perustaa joko keväällä suojaviljaan tai kesällä tai syksyllä ilman suojaviljaa.",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.3.2",
        "page": "s. 98",
        "tableFigure": None,
    },
    {
        "key": "leyNitrogen",
        "text": "Recommended nitrogen for a silage ley harvested three times on coarse mineral soils: 230 kg N/ha (pasture 190 kg N/ha).",
        "textFi": "typpeä suositellaan karkeilla kivennäismailla kolme kertaa korjattavalle säilörehunurmelle 230 kg/ha",
        "value": 230,
        "unit": "kg N/ha",
        "uncertainty": None,
        "ref": BOOK,
        "section": "7.3.3",
        "page": "s. 101",
        "tableFigure": None,
    },
    {
        "key": "maizeCalendar",
        "text": "In Finland, maize is best sown in the first or second week of May; it germinates only above 10 °C, emergence takes 2 to 4 weeks, and it usually flowers in July.",
        "textFi": "Mikäli mahdollista, maissi kannattaa kylvää toukokuun ensimmäisen ja toisen viikon aikana.",
        "value": [2, 4],
        "unit": "weeks to emergence",
        "uncertainty": None,
        "ref": BOOK,
        "section": "10.2",
        "page": "s. 144–146",
        "tableFigure": None,
    },
    {
        "key": "barleyCarbonFlows",
        "text": "Annual carbon flows of a barley stand (about 4800 kg/ha yield): net photosynthesis 540, yield 300, litter and residues 150 g C m-2 yr-1; decomposer respiration about 230 g C m-2 yr-1. The annual carbon balance of crop production is about zero.",
        "textFi": "Kasvituotannon hiilitase on vuosikierrossa likimäärin nolla",
        "value": [540, 300, 150, 230],
        "unit": "g C m-2 yr-1",
        "uncertainty": "values are indicative (suuntaa-antavia)",
        "ref": BOOK,
        "section": "13.4.3",
        "page": "s. 188–189",
        "tableFigure": "Fig. 13.8",
    },
    {
        "key": "maktauPlanting",
        "text": "Maktau 2019: delayed rains; planting on 12 April after a 24 mm rain in the second week of April. 2020: planting in the third week of March. Harvest 123 and 135 days later, on 13 August 2019 and 30 July 2020.",
        "textFi": None,
        "value": [123, 135],
        "unit": "d",
        "uncertainty": None,
        "ref": "rasanen2026",
        "section": None,
        "page": "PDF p. 3",
        "tableFigure": None,
    },
    {
        "key": "qvidjaGrazing",
        "text": "Qvidja: in August 2021, 8 cows grazed small paddocks in the EC footprint for 6 days; in August 2022, 9 cows grazed.",
        "textFi": None,
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": "heimsch2024",
        "section": None,
        "page": "PDF p. 2",
        "tableFigure": None,
    },
    {
        "key": "anttilaCuts",
        "text": "Anttila 2022 management: fertilisation 23.05.2022 (52 kg N/ha), cut 21.06.2022, fertilisation 22.06.2022 (44 kg N/ha), cut 08.09.2022.",
        "textFi": None,
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": "shurpali2025",
        "section": None,
        "page": "PDF p. 3",
        "tableFigure": "Table 2",
    },
)


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


# ---------- Alternative dates (not in the database; the build keeps one date per event) ----------
SOURCE_SHORT = {
    "qvidja-xlsx": "xlsx",
    "haltiala-xlsx": "xlsx",
    "viikki-docx": "docx",
    "shurpali2025": "article",
    "heimsch2021": "article",
    "heimsch2024": "article",
    "gao2026": "article",
    "rasanen2026": "article",
}
ALTERNATIVE_DATES: tuple[dict[str, Any], ...] = (
    {
        "site": "anttila",
        "dateUsed": "2022-08-08",
        "type": "harvest",
        "dateOther": "2022-09-08",
        "sourceOther": "shurpali2025",
        "page": "PDF p. 3, Table 2",
        "note": "Second cut; the used date is the project file (data/Agri_site_management_events 2018-2025.xlsx).",
    },
    {
        "site": "qvidja",
        "dateUsed": "2018-09-23",
        "type": "harvest",
        "dateOther": "2018-09-25",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx",
        "note": "The used date is Heimsch et al. 2021, Table 1 (PDF p. 4).",
    },
    {
        "site": "qvidja",
        "dateUsed": "2019-06-11",
        "type": "harvest",
        "dateOther": "2019-06-10",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx",
        "note": "",
    },
    {
        "site": "qvidja",
        "dateUsed": "2019-08-20",
        "type": "harvest",
        "dateOther": "2019-08-21",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx",
        "note": "",
    },
    {
        "site": "qvidja",
        "dateUsed": "2019-06-20",
        "type": "fertilisation",
        "dateOther": "2019-06-26",
        "sourceOther": "heimsch2021",
        "page": "PDF p. 3 (text); Table 1 on PDF p. 4 gives 20 June",
        "note": "Mineral fertiliser NPK 23-10-8, 220 kg/ha.",
    },
    {
        "site": "qvidja",
        "dateUsed": "2020-07-27",
        "type": "fertilisation",
        "dateOther": "2020-05-25",
        "detailMatch": "Own NPK mix",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx; Heimsch et al. 2024 PDF p. 7 gives about 26 May",
        "note": "Own NPK mix.",
    },
    {
        "site": "qvidja",
        "dateUsed": "2020-06-23",
        "type": "harvest",
        "dateOther": "2020-06-11",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx",
        "note": "",
    },
    {
        "site": "qvidja",
        "dateUsed": "2020-08-28",
        "type": "harvest",
        "dateOther": "2020-08-27",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx",
        "note": "",
    },
    {
        "site": "qvidja",
        "dateUsed": "2021-06-14",
        "type": "harvest",
        "dateOther": "2021-06-21",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx",
        "note": "",
    },
    {
        "site": "qvidja",
        "dateUsed": "2021-08-23",
        "type": "grazing",
        "dateOther": "2021-06-01",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx (4 horses, 7 days); Heimsch et al. 2024 PDF p. 2: August 2021, 8 cows, 6 days",
        "note": "Used end 2021-08-29.",
    },
    {
        "site": "qvidja",
        "dateUsed": "2022-08-05",
        "type": "grazing",
        "dateOther": "2022-06-01",
        "sourceOther": "qvidja-xlsx",
        "page": "data/Qvidja/Qvidja_management.xlsx (9 cows, 15 days); Heimsch et al. 2024 PDF p. 2: August 2022, 9 cows",
        "note": "Used end 2022-08-19.",
    },
    {
        "site": "viikki",
        "dateUsed": "2022-11-01",
        "type": "tillage",
        "dateOther": "2022-11-02",
        "sourceOther": "viikki-docx",
        "page": "data/Viikki/EC/Management Information.docx; Gao et al. 2026 Table A2 (PDF p. 13) gives 1.11.2022",
        "note": "",
    },
    {
        "site": "haltiala",
        "dateUsed": "2025-06-16",
        "type": "spraying",
        "dateOther": "2025-05-16",
        "sourceOther": "haltiala-xlsx",
        "page": "data/Haltiala/haltiala_smear_management.xlsx",
        "note": "Jett Mn235 Mn fertiliser in a tank mix with a herbicide; the database type is spraying. The used date is the parcel card.",
    },
)
# Differences between the sources that are not a change-point row (typed from the sources).
ALT_NOTES: tuple[dict[str, str], ...] = (
    {
        "site": "viikki",
        "text": "The second cut of 2023-08-24 is in the docx only; the project file and Gao et al. 2026 give 17 August only.",
        "source": "data/Viikki/EC/Management Information.docx; Gao et al. 2026 PDF p. 3",
    },
    {
        "site": "haltiala",
        "text": "Harvest 2021 started on 8 September (xlsx text, at least 5 days); the database rows are 2021-09-10 and 2021-09-15 (threshing).",
        "source": "data/Haltiala/haltiala_smear_management.xlsx",
    },
    {
        "site": "haltiala",
        "text": "Harvest 2022 is a range from 2022-08-15 to 2022-08-24 ('finished 23.08 to 24.08?' in the xlsx).",
        "source": "data/Haltiala/haltiala_smear_management.xlsx",
    },
    {
        "site": "maktau",
        "text": "Sowing 2020 in the 'third week of March' has no day and is not a database row.",
        "source": "Räsänen et al. 2026 PDF p. 3",
    },
    {
        "site": "qvidja",
        "text": "Grazing animals and days differ: xlsx 4 horses for 7 days (2021) and 9 cows for 15 days (2022); Heimsch et al. 2024: 8 cows for 6 days in August 2021 and 9 cows in August 2022.",
        "source": "data/Qvidja/Qvidja_management.xlsx; Heimsch et al. 2024 PDF p. 2",
    },
)

OPEN_FINDINGS = (
    (
        "ANT-01, SAR-01, VII-01 (open, waits for the providers): the raw stamps of Anttila, Sarkisuo and "
        "Viikki are UTC, but the build reads them as UTC+2. A local day of these sites thus starts at "
        "02:00 true local time, and the measured NEE window 10:00 to 15:30 is 12:00 to 17:30 true local "
        "time. A daily change point can move by not more than 1 day."
    ),
    (
        "VII-05 (open): Viikki 2024 nee_f is not equal to nee in 1 540 periods. The gap filling around "
        "the 2024 events can thus differ from the measured values."
    ),
    (
        "QVI-08 (open): the Qvidja rain gauge has a gap from 2021-12-29 to 2022-05-24; the precipitation "
        "strip is empty there."
    ),
    (
        "QVI-09 (known): all Qvidja meteorology is lost from 2023-02-11 to 2023-03-01 (no event in this "
        "period)."
    ),
    (
        "MKT-01, MKT-02, MKT-03 (Maktau): night rows missing 2023-07 to 2024-01, vpd in fill rows, and "
        "repeated FC values 2024-04 to 2024-07. They are outside the Maktau event years (2019, 2020)."
    ),
)

# ---------- Figures ----------
FONT_STACK = "system-ui, sans-serif"  # body font of site/src/styles/global.css
# Okabe-Ito order of site/src/scripts/theme.ts EXPORT_SERIES and the site position in sites.parquet.
SERIES = (
    "#0072b2",
    "#e69f00",
    "#56b4e9",
    "#cc79a7",
    "#000000",
    "#d55e00",
    "#009e73",
    "#6b5a00",
)
# siteDash() and siteSymbol() of site/src/scripts/diagrams/common.ts (dash in px = points here).
SITE_DASHES: tuple[tuple[float, ...] | None, ...] = (
    None,
    (6, 3),
    (2, 2),
    (8, 3, 2, 3),
    (12, 4),
    (2, 5),
)
SITE_MARKERS = ("o", "s", "^", "D", "p", "v")
RECO_COLOR = "#e69f00"
RECO_COLOR_ALT = "#d55e00"  # when the site colour is orange (Sarkisuo)
RECO_DASH = (6, 3)
SWC_COLOR = "#009e73"  # bluish green: not a site colour
INK = "#222222"
GREY = "#8a8a8a"
TA_COLOR = "#6b5a00"  # dark olive: not a site colour of the six sites
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
LABEL_PT = 7.0
FIGURES = (
    (1, "anttila"),
    (2, "sarkisuo"),
    (3, "haltiala"),
    (4, "qvidja"),
    (5, "viikki"),
    (6, "maktau"),
    (7, "offsets"),
    (8, "course"),
)
KIND_STYLE: dict[str, tuple[str, str, tuple[float, ...] | None, str]] = {
    # label, colour, dash, marker
    "harvestCut": ("Harvest or cut", "#0072b2", None, "o"),
    "grazing": ("Grazing", "#cc79a7", (6, 3), "s"),
    "tillage": ("Tillage", "#d55e00", (2, 2), "^"),
    "sowing": ("Sowing", "#009e73", (8, 3, 2, 3), "D"),
    "fertilisation": ("Fertilisation", "#e69f00", (12, 4), "v"),
}
KIND_MARKER = {
    "harvest": "o",
    "cut": "o",
    "grazing": "s",
    "tillage": "^",
    "sowing": "D",
}

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


def input_path(inp: InputFile, db: Path, calculated: Path) -> Path:
    return (db if inp.root == "db" else calculated) / inp.file


def check_inputs(db: Path, calculated: Path) -> list[str]:
    """Check each input: exists, SHA-256, Parquet built_at, row count. Returns the error list."""
    errors: list[str] = []
    for inp in INPUTS:
        path = input_path(inp, db, calculated)
        if not path.is_file():
            errors.append(f"{inp.key}: file not found at {path}")
            continue
        digest = sha256_file(path)
        if digest != inp.sha256:
            errors.append(f"{inp.key}: SHA-256 expected {inp.sha256}, actual {digest}")
        meta = pq.read_metadata(path)
        kv = {k.decode(): v.decode() for k, v in (meta.metadata or {}).items()}
        built = kv.get("built_at")
        if built != inp.built_at:
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
EPOCH = date(1970, 1, 1)


def day_number(d: date | str) -> int:
    """Days since 1970-01-01 (the same number as a matplotlib date)."""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return (d - EPOCH).days


def iso_day(day: int) -> str:
    return (EPOCH + timedelta(days=int(day))).isoformat()


def to_date(day: int) -> date:
    return EPOCH + timedelta(days=int(day))


@dataclass
class Event:
    site: str
    date: int
    date_end: int | None
    type: str
    detail: str = ""
    source: str = ""
    crop: str | None = None
    dry_mass_kg_ha: float | None = None
    n_kg_ha: float | None = None
    field_op: bool = True

    @property
    def hi(self) -> int:
        return self.date if self.date_end is None else self.date_end


@dataclass
class Episode:
    site: str
    start: int
    end: int
    events: list[Event] = field(default_factory=list)
    kind: str = "other"
    types: list[str] = field(default_factory=list)
    anchor: int = 0

    @property
    def id(self) -> str:
        return f"{self.site}-{iso_day(self.start)}"

    def first_of(self, etype: str) -> int | None:
        days = [e.date for e in self.events if e.type == etype]
        return min(days) if days else None


def episode_kind(types: Iterable[str]) -> str:
    """The first type of KIND_PRIORITY that is in `types`."""
    s = set(types)
    for k in KIND_PRIORITY:
        if k in s:
            return k
    raise ValueError(f"no known type in {sorted(s)}")


def merge_episodes(
    events: Sequence[Event], merge_days: int = MERGE_DAYS
) -> list[Episode]:
    """Merge the field events of each site into episodes (gap of `merge_days` or less joins)."""
    ordered = sorted(
        (e for e in events if e.field_op),
        key=lambda e: (e.site, e.date, KIND_PRIORITY.index(e.type)),
    )
    out: list[Episode] = []
    for e in ordered:
        last = out[-1] if out else None
        if last is not None and last.site == e.site and e.date - last.end <= merge_days:
            last.end = max(last.end, e.hi)
            last.events.append(e)
        else:
            out.append(Episode(e.site, e.date, e.hi, [e]))
    for ep in out:
        ep.types = [k for k in KIND_PRIORITY if any(e.type == k for e in ep.events)]
        ep.kind = episode_kind(ep.types)
        anchor = ep.first_of(ep.kind)
        ep.anchor = ep.start if anchor is None else anchor
    return out


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


def window_means(
    table: DayTable, anchor: int, w: tuple[int, int], variables: Sequence[str]
) -> WindowMeans:
    """Count and mean of each variable over the days anchor + w[0] .. anchor + w[1]."""
    n: dict[str, int] = {}
    m: dict[str, float | None] = {}
    for v in variables:
        n[v], m[v] = table.range_mean(v, anchor + w[0], anchor + w[1])
    return WindowMeans(n, m)


def changes(
    after: WindowMeans,
    before: WindowMeans,
    variables: Sequence[str],
    min_days: int = MIN_DAYS,
) -> dict[str, float | None]:
    """after - before per variable; None when a side has fewer than min_days values."""
    out: dict[str, float | None] = {}
    for v in variables:
        a, b = after.mean[v], before.mean[v]
        ok = after.n[v] >= min_days and before.n[v] >= min_days
        out[v] = a - b if ok and a is not None and b is not None else None
    return out


@dataclass
class Step:
    """Result of a change-point search (sign +1 = drop, -1 = rise)."""

    sign: int
    search_from: int
    search_to: int
    anchor: int
    detected: int | None = None
    step: float | None = None
    step_pct: float | None = None
    level: float | None = None
    before: float | None = None
    after: float | None = None
    clear: bool = False
    reason: str | None = "too-few-days"

    @property
    def offset(self) -> int | None:
        return None if self.detected is None else self.detected - self.anchor

    def json(self, start: int | None = None) -> dict[str, Any]:
        return {
            "direction": "drop" if self.sign > 0 else "rise",
            "searchFrom": iso_day(self.search_from),
            "searchTo": iso_day(self.search_to),
            "anchor": iso_day(self.anchor),
            "detected": None if self.detected is None else iso_day(self.detected),
            "offset": self.offset,
            "offsetStart": None
            if self.detected is None or start is None
            else self.detected - start,
            "step": self.step,
            "stepPct": self.step_pct,
            "level": self.level,
            "meanBefore": self.before,
            "meanAfter": self.after,
            "clear": self.clear,
            "reason": self.reason,
        }


def detect_step(
    by_day: DayTable,
    values: str,
    from_day: int,
    to_day: int,
    sign: int,
    *,
    side_days: int = SIDE_DAYS,
    min_side: int = MIN_SIDE,
    min_level: float = MIN_BEFORE,
    min_step_pct: float = MIN_STEP_PCT,
    anchor: int | None = None,
    skip: Callable[[int], bool] | None = None,
) -> Step:
    """Largest drop (sign +1) or rise (sign -1) of the daily `values` for t in from_day .. to_day.

    step(t) = sign * (mean of t - side .. t - 1 - mean of t .. t + side - 1), each side with
    min_side or more values. The detected day is the first t with the largest step. The step is
    clear when the higher side (before for a drop, after for a rise) is min_level or more and the
    step is min_step_pct % or more of it. Port of detectDrop (scripts/lib/deep-dive/change-point.ts)
    with a sign for a rise.
    """
    if sign not in (1, -1):
        raise ValueError("sign must be +1 or -1")
    res = Step(sign, from_day, to_day, from_day if anchor is None else anchor)
    best: tuple[int, float, float, float] | None = None
    for t in range(from_day, to_day + 1):
        if skip is not None and skip(t):
            continue
        nb, mb = by_day.range_mean(values, t - side_days, t - 1)
        na, ma = by_day.range_mean(values, t, t + side_days - 1)
        if nb < min_side or na < min_side or mb is None or ma is None:
            continue
        s = sign * (mb - ma)
        if best is None or s > best[1]:
            best = (t, s, mb, ma)
    if best is None:
        return res
    t, s, mb, ma = best
    level = mb if sign > 0 else ma
    res.detected, res.step, res.before, res.after, res.level = t, s, mb, ma, level
    res.step_pct = 100 * s / level if level > 0 else None
    if level < min_level:
        res.reason = "flux-too-small"
    elif res.step_pct is None or res.step_pct < min_step_pct:
        res.reason = "step-too-small"
    else:
        res.reason = None
    res.clear = res.reason is None
    return res


def thermal_season(
    table: DayTable,
    var: str,
    year: int,
    threshold: float = SEASON_THRESHOLD_C,
    run_days: int = SEASON_RUN_DAYS,
) -> dict[str, Any]:
    """Start and end of the thermal growing season of one year (see METHOD 7)."""

    def run_ok(d: int, above: bool) -> bool:
        xs = table.values(var, d, d + run_days - 1)
        if np.isnan(xs).any():
            return False
        return bool((xs > threshold).all() if above else (xs < threshold).all())

    jan1 = day_number(date(year, 1, 1))
    mar1 = day_number(date(year, SEASON_START_MONTH, 1))
    aug1 = day_number(date(year, SEASON_END_MONTH, 1))
    dec31 = day_number(date(year, 12, 31))
    year_vals = table.values(var, jan1, dec31)
    have = np.flatnonzero(~np.isnan(year_vals))
    out: dict[str, Any] = {
        "year": year,
        "start": None,
        "end": None,
        "length": None,
        "startReason": None,
        "endReason": None,
    }
    if len(have) == 0:
        out["startReason"] = out["endReason"] = "no-data"
        return out
    first = jan1 + int(have[0])
    start = None
    if first > mar1:
        out["startReason"] = "data-start-after-1-march"
    else:
        for d in range(mar1, aug1):
            if run_ok(d, True):
                start = d
                break
        if start is None:
            out["startReason"] = "no-run"
    end = None
    for d in range(aug1, dec31 + 1):
        if run_ok(d, False):
            end = d
            break
    if end is None:
        out["endReason"] = "no-run"
    out["start"] = None if start is None else iso_day(start)
    out["end"] = None if end is None else iso_day(end)
    out["length"] = None if start is None or end is None else end - start
    return out


def label_rows(spans: Sequence[tuple[float, float]], gap: float = 0.0) -> list[int]:
    """Row of each label (0 = top) so that labels in one row do not touch.

    `spans` are (x_start, x_end) of the labels. A label goes to the first row whose last label
    ends at x_start - gap or before. The labels are placed in the order of x_start.
    """
    order = sorted(range(len(spans)), key=lambda i: (spans[i][0], i))
    ends: list[float] = []
    rows = [0] * len(spans)
    for i in order:
        x0, x1 = spans[i]
        for r, e in enumerate(ends):
            if e + gap <= x0:
                rows[i] = r
                ends[r] = x1
                break
        else:
            rows[i] = len(ends)
            ends.append(x1)
    return rows


def finite(values: Iterable[float | None]) -> np.ndarray:
    return np.array(
        [v for v in values if v is not None and math.isfinite(v)], dtype=float
    )


def bootstrap_mean_ci(
    xs: np.ndarray,
    seed: int,
    resamples: int = BOOTSTRAP_RESAMPLES,
    level: float = BOOTSTRAP_LEVEL,
) -> tuple[float, float] | None:
    """Percentile bootstrap CI of the mean (numpy PCG64, quantile type 7). None for n < 3."""
    n = len(xs)
    if n < 3:
        return None
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(resamples, n))
    means = xs[idx].mean(axis=1)
    a = (1 - level) / 2
    lo, hi = np.quantile(means, [a, 1 - a])
    return float(lo), float(hi)


SEEDS_USED: dict[str, int] = {}


def summarise(values: Iterable[float | None], seed: int, name: str) -> dict[str, Any]:
    """n, mean, SD, median, range, bootstrap CI (n >= 3) and the sign counts of the values."""
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
        "nNegative": int((xs < 0).sum()),
        "nZero": int((xs == 0).sum()),
        "nPositive": int((xs > 0).sum()),
    }


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


def event_label(events: Sequence[Event]) -> str:
    """Label of the events of one day: the type letters joined by '+'; a harvest or cut with a
    yield adds the yield in t DW/ha with one decimal."""
    parts: list[str] = []
    for t in KIND_PRIORITY:
        evs = [e for e in events if e.type == t]
        if not evs:
            continue
        txt = TYPE_LETTERS[t]
        ys = [e.dry_mass_kg_ha for e in evs if e.dry_mass_kg_ha is not None]
        if t in ("harvest", "cut") and ys:
            txt += f" {sum(ys) / 1000:.1f} t"
        parts.append(txt)
    return "+".join(parts)


# ======================================================================================
# Read
# ======================================================================================
EVENTS_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(SITES)),
        "date": pa.Column(object),
        "date_end": pa.Column(object, nullable=True),
        "type": pa.Column(str, pa.Check.isin(KIND_PRIORITY)),
        "detail": pa.Column(object),
        "source": pa.Column(object),
        "crop": pa.Column(object, nullable=True),
        "dry_mass_kg_ha": pa.Column(float, pa.Check.ge(0), nullable=True),
        "n_kg_ha": pa.Column(float, pa.Check.ge(0), nullable=True),
    },
    strict=True,
)
DAILY_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(SITES)),
        "date_local": pa.Column(object),
        "gpp_gc": pa.Column(float, nullable=True),
        "reco_gc": pa.Column(float, nullable=True),
        "nee_f_gc": pa.Column(float, nullable=True),
        "frac_measured": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
        "ta_mean": pa.Column(float, pa.Check.in_range(-50, 50), nullable=True),
    },
    strict=True,
)
OBS_DAY_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(SITES)),
        "day": pa.Column(int),
        "n_rows": pa.Column(int, pa.Check.in_range(1, HALF_HOURS_PER_DAY)),
        "ta": pa.Column(float, pa.Check.in_range(-50, 50), nullable=True),
        "swc": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
        "precip": pa.Column(float, pa.Check.ge(0), nullable=True),
        "mneg": pa.Column(float, nullable=True),
    },
    strict=False,
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


def count_true(mask: Any) -> int:
    return int(np.count_nonzero(np.asarray(mask, dtype=bool)))


def columns_of(key: str) -> list[str]:
    return list(next(i for i in INPUTS if i.key == key).columns)


def to_utc(ts: pd.Series) -> pd.Series:
    """ts_start as UTC. The Parquet column has no time zone; the database stores UTC."""
    if getattr(ts.dt, "tz", None) is None:
        return ts.dt.tz_localize("UTC")
    return ts.dt.tz_convert("UTC")


def local_minutes(ts_utc: pd.Series, offset_min: pd.Series) -> np.ndarray:
    """Minutes since 1970-01-01 in local time: ts_start + utc_offset_min (the one place)."""
    minutes = (ts_utc - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta(minutes=1)
    return minutes.to_numpy(dtype=np.int64) + offset_min.to_numpy(dtype=np.int64)


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


@dataclass
class Data:
    sites: pd.DataFrame
    names: dict[str, str]
    slots: dict[str, int]
    offsets: dict[str, int]
    events: list[Event]
    tables: dict[str, DayTable]
    flux: dict[str, tuple[int, int]]
    steps: dict[str, Any]


def read_data(db: Path, calculated: Path) -> Data:
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
        "units checked in variables.parquet: %s",
        ", ".join(f"{k} [{v}]" for k, v in EXPECTED_UNITS.items()),
    )

    sites = pd.read_parquet(
        db / "sites.parquet", columns=columns_of("db/sites.parquet"), engine="pyarrow"
    )
    sites = sites.sort_values("site_id").reset_index(drop=True)
    sites["code"] = sites["code"].astype(str)
    if tuple(sites["code"]) != SITES:
        raise InputError(
            f"sites.parquet: expected the sites {SITES}, got {tuple(sites['code'])}"
        )
    sites["slot"] = np.arange(len(sites))
    names = dict(zip(sites["code"], sites["name"].astype(str), strict=True))
    slots = {s: i for i, s in enumerate(SITES)}
    offsets = {
        str(c): int(o)
        for c, o in zip(sites["code"], sites["utc_offset_min"], strict=True)
    }
    steps["sites"] = {"rowsRead": len(sites), "rowsKept": len(sites)}

    # ----- events -----
    ev = pd.read_parquet(
        db / "events.parquet", columns=columns_of("db/events.parquet"), engine="pyarrow"
    )
    ev["site_code"] = ev["site_code"].astype(str)
    ev["type"] = ev["type"].astype(str)
    ev["date"] = pd.to_datetime(ev["date"]).dt.date
    ev["date_end"] = pd.to_datetime(ev["date_end"]).dt.date.astype(object)
    ev["date_end"] = ev["date_end"].where(ev["date_end"].notna(), None)
    ev["detail"] = ev["detail"].astype(object).where(ev["detail"].notna(), "")
    ev["source"] = ev["source"].astype(object).where(ev["source"].notna(), "")
    ev["crop"] = ev["crop"].astype(object).where(ev["crop"].notna(), None)
    ev["dry_mass_kg_ha"] = ev["dry_mass_kg_ha"].astype(float)
    ev["n_kg_ha"] = ev["n_kg_ha"].astype(float)
    ev = pd.DataFrame(EVENTS_SCHEMA.validate(ev))
    ev = ev.sort_values(
        ["site_code", "date", "type", "detail"], kind="stable"
    ).reset_index(drop=True)
    events: list[Event] = []
    for r in ev.to_dict("records"):
        detail = str(r["detail"] or "")
        events.append(
            Event(
                str(r["site_code"]),
                day_number(r["date"]),
                None if r["date_end"] is None else day_number(r["date_end"]),
                str(r["type"]),
                detail,
                str(r["source"] or ""),
                None if r["crop"] is None else str(r["crop"]),
                num_or_none(r["dry_mass_kg_ha"]),
                num_or_none(r["n_kg_ha"]),
                NON_FIELD_DETAIL.match(detail) is None,
            )
        )
    n_non_field = sum(1 for e in events if not e.field_op)
    steps["events"] = {
        "rowsRead": len(ev),
        "notFieldOperation": n_non_field,
        "rule": "events whose detail is 'EC system installed' are listed, not merged into episodes",
    }
    log.info(
        "events: %d rows read; %d not a field operation (not in an episode)",
        len(ev),
        n_non_field,
    )

    # ----- daily fluxes -----
    daily = pd.read_parquet(
        calculated / "daily.parquet",
        columns=columns_of("calculated/daily.parquet"),
        engine="pyarrow",
    )
    daily["site_code"] = daily["site_code"].astype(str)
    daily["date_local"] = pd.to_datetime(daily["date_local"]).dt.date
    daily = pd.DataFrame(DAILY_SCHEMA.validate(daily))
    daily["day"] = date_days(col(daily, "date_local")).astype(np.int64)

    # ----- observations -> local days -----
    obs = pd.read_parquet(
        db / "observations.parquet",
        columns=columns_of("db/observations.parquet"),
        engine="pyarrow",
    )
    n_obs = len(obs)
    obs["ts_start"] = to_utc(col(obs, "ts_start"))
    obs = obs.merge(
        frame(sites[["site_id", "code", "utc_offset_min"]]), on="site_id", how="left"
    )
    lm = local_minutes(col(obs, "ts_start"), col(obs, "utc_offset_min"))
    obs["day"] = np.floor_divide(lm, 1440)
    hour = np.mod(lm, 1440) / 60
    day_time = (hour >= DAYTIME_HOURS[0]) & (hour < DAYTIME_HOURS[1])
    qc = col(obs, "nee_qc")
    measured = col(obs, "nee").notna() & (qc.isna() | (qc == 0))
    obs["nee_m"] = col(obs, "nee").where(measured & day_time)
    g = obs.groupby(["code", "day"], sort=True)
    agg = pd.DataFrame(
        {
            "n_rows": g.size(),
            "ta": g["ta"].mean(),
            "swc": g["swc"].mean(),
            "precip": g["precip"].sum(min_count=1),
            "n_precip": g["precip"].count(),
            "nee_m_sum": g["nee_m"].sum(min_count=1),
            "n_nee_m": g["nee_m"].count(),
        }
    ).reset_index()
    agg = agg.rename(columns={"code": "site_code"})
    agg["site_code"] = agg["site_code"].astype(str)
    ok_m = agg["n_nee_m"] >= MIN_MEASURED_HH
    agg["mneg"] = np.where(
        ok_m, -agg["nee_m_sum"] / agg["n_nee_m"].clip(lower=1), np.nan
    )
    agg = pd.DataFrame(OBS_DAY_SCHEMA.validate(agg))
    steps["observations"] = {
        "rowsRead": n_obs,
        "localDays": len(agg),
        "precipNullAllHalfHoursNull": count_true(agg["n_precip"] == 0),
        "measuredNeeHalfHoursDayTime": count_true(obs["nee_m"].notna()),
        "measuredNeeDays": count_true(ok_m),
        "measuredNeeDaysFewerThan8": count_true((agg["n_nee_m"] > 0) & ~ok_m),
        "rule": (
            "local day = ts_start + utc_offset_min; ta and swc = mean of the 30-min values; precip = "
            "sum (null when all are null); measured NEE = nee not null and nee_qc 0 or null, half "
            "hours that start from 10:00 to 15:30 local time, 8 or more per day"
        ),
    }
    log.info(
        "observations: %d rows -> %d local days; precip null on %d days (all half hours null); "
        "measured day-time NEE on %d days (%d days with fewer than %d half hours not used)",
        n_obs,
        len(agg),
        steps["observations"]["precipNullAllHalfHoursNull"],
        steps["observations"]["measuredNeeDays"],
        steps["observations"]["measuredNeeDaysFewerThan8"],
        MIN_MEASURED_HH,
    )

    # ----- day tables -----
    tables: dict[str, DayTable] = {}
    flux: dict[str, tuple[int, int]] = {}
    per_site: dict[str, Any] = {}
    for site in SITES:
        d = frame(daily[col(daily, "site_code") == site])
        o = frame(agg[col(agg, "site_code") == site])
        all_days = np.concatenate([col(d, "day").to_numpy(), col(o, "day").to_numpy()])
        t = DayTable(int(all_days.min()), int(all_days.max()))
        dd = col(d, "day").to_numpy()
        for src, dst in (
            ("gpp_gc", "gpp"),
            ("reco_gc", "reco"),
            ("nee_f_gc", "nee"),
            ("frac_measured", "frac"),
            ("ta_mean", "ta_mean"),
        ):
            t.set(dst, dd, col(d, src).to_numpy(dtype=float))
        od = col(o, "day").to_numpy()
        for v in ("ta", "swc", "precip", "mneg"):
            t.set(v, od, col(o, v).to_numpy(dtype=float))
        nee_days = dd[col(d, "nee_f_gc").notna().to_numpy()]
        flux[site] = (int(nee_days.min()), int(nee_days.max()))
        lo, hi = flux[site]
        in_period = (dd >= lo) & (dd <= hi)
        frac = col(d, "frac_measured").to_numpy(dtype=float)
        nee_ok = col(d, "nee_f_gc").notna().to_numpy()
        per_site[site] = {
            "dailyRows": len(d),
            "fluxFirst": iso_day(lo),
            "fluxLast": iso_day(hi),
            "daysInFluxPeriod": hi - lo + 1,
            "daysWithNee": int(nee_ok.sum()),
            "daysOutsideFluxPeriod": int((~in_period).sum()),
            "daysNoNeeInFluxPeriod": int((in_period & ~nee_ok).sum())
            + (hi - lo + 1 - int(in_period.sum())),
            "daysLowFrac": int((nee_ok & (frac < MIN_FRAC)).sum()),
            "daysWithMeasuredNee": int(col(o, "mneg").notna().sum()),
        }
        tables[site] = t
        log.info(
            "%s: flux period %s to %s, %d days with NEE, %d days without NEE in the period, "
            "%d daily rows outside the period (not drawn), %d days with a measured fraction < %.2f "
            "(drawn lighter)",
            site,
            iso_day(lo),
            iso_day(hi),
            per_site[site]["daysWithNee"],
            per_site[site]["daysNoNeeInFluxPeriod"],
            per_site[site]["daysOutsideFluxPeriod"],
            per_site[site]["daysLowFrac"],
            MIN_FRAC,
        )
    steps["daily"] = {
        "rowsRead": len(daily),
        "perSite": per_site,
        "rule": "timeline = first to last day with nee_f_gc; days with frac_measured < 0.10 are drawn lighter",
    }
    return Data(sites, names, slots, offsets, events, tables, flux, steps)


# ======================================================================================
# Analysis
# ======================================================================================
FLUX_VARS = ("gpp", "reco", "nee")


def kind_group(kind: str) -> str:
    return "harvestCut" if kind in ("harvest", "cut") else kind


def in_kind(kind: str, key: str) -> bool:
    """True when an episode of `kind` belongs to the summary key (harvestCut = harvest + cut)."""
    return kind_group(kind) == key if key == "harvestCut" else kind == key


def days_overlap(lo: int, hi: int, ep: Episode) -> bool:
    return ep.start <= hi and ep.end >= lo


def episode_result(data: Data, ep: Episode, eps: Sequence[Episode]) -> dict[str, Any]:
    t = data.tables[ep.site]
    others = [o for o in eps if o is not ep and o.site == ep.site]
    before = window_means(t, ep.start, BEFORE, FLUX_VARS + ("frac",))
    after = window_means(t, ep.end, AFTER, FLUX_VARS + ("frac",))
    delta = changes(after, before, FLUX_VARS)
    b_gpp = before.mean["gpp"]
    gpp_pct = (
        100 * delta["gpp"] / b_gpp
        if delta["gpp"] is not None and b_gpp is not None and b_gpp >= MIN_BEFORE
        else None
    )
    w_lo, w_hi = ep.start + BEFORE[0], ep.end + AFTER[1]
    overlap = [
        o.id
        for o in others
        if days_overlap(w_lo, ep.start - 1, o) or days_overlap(ep.end + 1, w_hi, o)
    ]
    s_lo = ep.start + SEARCH_FROM - SIDE_DAYS
    s_hi = ep.end + SEARCH_TO + SIDE_DAYS - 1
    span_overlap = [
        o.id
        for o in others
        if o.kind in CHANGE_POINT_KINDS and days_overlap(s_lo, s_hi, o)
    ]
    gpp_drop = nee_drop = sowing_rise = reco_rise = None
    if ep.kind in DROP_KINDS:
        gpp_drop = detect_step(
            t,
            "gpp",
            ep.start + SEARCH_FROM,
            ep.end + SEARCH_TO,
            1,
            anchor=ep.anchor,
        )
        nee_drop = detect_step(
            t,
            "mneg",
            ep.start + SEARCH_FROM,
            ep.end + SEARCH_TO,
            1,
            min_side=MIN_SIDE_NEE,
            min_level=MIN_BEFORE_NEE,
            anchor=ep.anchor,
        )
    sow = ep.first_of("sowing")
    if sow is not None:
        sowing_rise = detect_step(
            t, "gpp", sow + SOWING_SEARCH[0], sow + SOWING_SEARCH[1], -1, anchor=sow
        )
    till = ep.first_of("tillage")
    if till is not None:
        reco_rise = detect_step(
            t,
            "reco",
            ep.start + SEARCH_FROM,
            ep.end + SEARCH_TO,
            -1,
            anchor=till,
        )
    primary_name = (
        "gppDrop"
        if ep.kind in DROP_KINDS
        else "sowingRise"
        if ep.kind == "sowing"
        else None
    )
    primary = {"gppDrop": gpp_drop, "sowingRise": sowing_rise}.get(primary_name or "")
    agree = (
        abs((gpp_drop.detected or 0) - (nee_drop.detected or 0)) <= AGREE_DAYS
        if gpp_drop is not None
        and nee_drop is not None
        and gpp_drop.clear
        and nee_drop.clear
        else None
    )
    low_frac = [
        k
        for k in range(LOW_FRAC_SPAN[0], LOW_FRAC_SPAN[1] + 1)
        if t.get("frac", ep.anchor + k) < MIN_FRAC
    ]
    lo, hi = data.flux[ep.site]
    in_flux = ep.end + AFTER[1] >= lo and ep.start + BEFORE[0] <= hi
    used_change = not overlap and all(delta[v] is not None for v in FLUX_VARS)
    searched = primary is not None and primary.reason != "too-few-days"
    used_offset = searched and not overlap and not span_overlap
    return {
        "id": ep.id,
        "site": ep.site,
        "start": iso_day(ep.start),
        "end": iso_day(ep.end),
        "anchor": iso_day(ep.anchor),
        "kind": ep.kind,
        "types": ep.types,
        "events": [
            {
                "date": iso_day(e.date),
                "dateEnd": None if e.date_end is None else iso_day(e.date_end),
                "type": e.type,
            }
            for e in ep.events
        ],
        "inFluxPeriod": in_flux,
        "before": {"n": before.n, "mean": before.mean},
        "after": {"n": after.n, "mean": after.mean},
        "change": {**delta, "gppPct": gpp_pct},
        "overlap": bool(overlap),
        "overlapWith": overlap,
        "spanOverlap": bool(span_overlap),
        "spanOverlapWith": span_overlap,
        "gppDrop": None if gpp_drop is None else gpp_drop.json(ep.start),
        "neeDrop": None if nee_drop is None else nee_drop.json(ep.start),
        "sowingRise": None if sowing_rise is None else sowing_rise.json(ep.start),
        "recoRise": None if reco_rise is None else reco_rise.json(ep.start),
        "agree": agree,
        "primary": primary_name,
        "searched": searched,
        "offset": None if primary is None or not primary.clear else primary.offset,
        "detected": None
        if primary is None or primary.detected is None
        else iso_day(primary.detected),
        "detectedOffset": None if primary is None else primary.offset,
        "clear": None if primary is None else primary.clear,
        "usedForOffset": used_offset,
        "usedForChange": used_change,
        "lowFracDays": low_frac,
    }


def offset_summary(
    eps: Sequence[dict[str, Any]], seed: int, name: str
) -> dict[str, Any]:
    used = [e for e in eps if e["usedForOffset"]]
    clear = [e for e in used if e["clear"]]
    s = summarise((e["offset"] for e in clear), seed, name)
    s["nSearched"] = len(used)
    s["nClear"] = len(clear)
    s["nBefore"] = s.pop("nNegative")
    s["nOn"] = s.pop("nZero")
    s["nAfter"] = s.pop("nPositive")
    s["nEpisodes"] = len(eps)
    s["ids"] = [e["id"] for e in clear]
    s["idsNotClear"] = [e["id"] for e in used if not e["clear"]]
    return s


def alt_search(
    data: Data, row: dict[str, Any], eps: Sequence[Episode]
) -> dict[str, Any]:
    """Change point for one ALTERNATIVE_DATES row (METHOD 5)."""
    site = row["site"]
    used = day_number(row["dateUsed"])
    other = day_number(row["dateOther"])
    match = [
        e
        for e in data.events
        if e.site == site
        and e.date == used
        and e.type == row["type"]
        and row.get("detailMatch", "") in e.detail
    ]
    if len(match) != 1:
        raise RuntimeError(
            f"ALTERNATIVE_DATES {site} {row['dateUsed']}: {len(match)} events"
        )
    ev = match[0]
    ep = next(p for p in eps if p.site == site and ev in p.events)
    duration = ev.hi - ev.date
    out: dict[str, Any] = {
        **row,
        "sourceShort": SOURCE_SHORT[row["sourceOther"]],
        "episodeId": ep.id,
        "dateEndUsed": None if ev.date_end is None else iso_day(ev.date_end),
        "dateEndOther": None if ev.date_end is None else iso_day(other + duration),
        "daysApart": other - used,
        "test": None,
        "detected": None,
        "offsetToUsed": None,
        "offsetToOther": None,
        "clear": None,
        "step": None,
        "stepPct": None,
        "reason": None,
        "nearer": None,
        "nearerBasis": None,
        "recoRise": None,
    }
    if row["type"] not in DROP_KINDS:
        out["reason"] = "no change-point test for this type"
        return out
    t = data.tables[site]
    spans = [
        (used + SEARCH_FROM, ev.hi + SEARCH_TO),
        (other + SEARCH_FROM, other + duration + SEARCH_TO),
    ]
    cand = sorted({d for lo, hi in spans for d in range(lo, hi + 1)})
    others = [p for p in eps if p.site == site and p is not ep]

    def skip(d: int) -> bool:
        if d not in cand_set:
            return True
        return any(days_overlap(d - SIDE_DAYS, d + SIDE_DAYS - 1, p) for p in others)

    cand_set = set(cand)
    lo_c, hi_c = cand[0], cand[-1]
    st = detect_step(t, "gpp", lo_c, hi_c, 1, anchor=used, skip=skip)
    out.update(
        {
            "test": "gppDrop",
            "searchFrom": iso_day(lo_c),
            "searchTo": iso_day(hi_c),
            "nCandidates": sum(1 for d in cand if not skip(d)),
            "detected": None if st.detected is None else iso_day(st.detected),
            "offsetToUsed": None if st.detected is None else st.detected - used,
            "offsetToOther": None if st.detected is None else st.detected - other,
            "clear": st.clear,
            "step": st.step,
            "stepPct": st.step_pct,
            "reason": st.reason,
        }
    )
    basis = st if st.clear else None
    if row["type"] == "tillage":
        rr = detect_step(t, "reco", lo_c, hi_c, -1, anchor=used, skip=skip)
        out["recoRise"] = rr.json()
        out["recoRise"]["offsetToOther"] = (
            None if rr.detected is None else rr.detected - other
        )
        if basis is None and rr.clear:
            basis = rr
            out["nearerBasis"] = "recoRise"
    if basis is not None and basis.detected is not None:
        du, do = abs(basis.detected - used), abs(basis.detected - other)
        out["nearer"] = "used" if du < do else "other" if do < du else "equal"
        out["nearerBasis"] = out["nearerBasis"] or "gppDrop"
        out["nearerDaysUsed"] = du
        out["nearerDaysOther"] = do
    return out


def course(data: Data, eps: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Mean daily GPP, Reco, NEE from day -14 to +14 of the anchor, in % of the before means."""
    days = list(range(COURSE_DAYS[0], COURSE_DAYS[1] + 1))
    out: dict[str, Any] = {
        "days": days,
        "minEpisodes": COURSE_MIN_EPISODES,
        "bandMinEpisodes": COURSE_BAND_MIN,
        "minGppBefore": MIN_BEFORE,
        "groups": {},
    }
    for g in COURSE_GROUPS:
        group = [
            e
            for e in eps
            if in_kind(e["kind"], g)
            and not e["overlap"]
            and e["before"]["n"]["gpp"] >= MIN_DAYS
            and e["before"]["n"]["reco"] >= MIN_DAYS
            and (e["before"]["mean"]["gpp"] or 0) >= MIN_BEFORE
            and (e["before"]["mean"]["reco"] or 0) > 0
        ]
        res: dict[str, Any] = {"episodes": len(group), "ids": [e["id"] for e in group]}
        for v in FLUX_VARS:
            mean_l: list[float | None] = []
            q25: list[float | None] = []
            q75: list[float | None] = []
            n_l: list[int] = []
            for k in days:
                xs = []
                for e in group:
                    x = data.tables[e["site"]].get(v, day_number(e["anchor"]) + k)
                    ref = e["before"]["mean"]["reco" if v == "reco" else "gpp"]
                    if not math.isnan(x):
                        xs.append(100 * x / ref)
                n_l.append(len(xs))
                mean_l.append(
                    float(np.mean(xs)) if len(xs) >= COURSE_MIN_EPISODES else None
                )
                band = len(group) >= COURSE_BAND_MIN and len(xs) >= COURSE_BAND_MIN
                q25.append(float(np.quantile(xs, 0.25)) if band else None)
                q75.append(float(np.quantile(xs, 0.75)) if band else None)
            res[v] = {"mean": mean_l, "q25": q25, "q75": q75, "n": n_l}
        late = [i for i, d in enumerate(days) if 1 <= d <= 7]
        for v in FLUX_VARS:
            vals = [res[v]["mean"][i] for i in late if res[v]["mean"][i] is not None]
            res[v]["meanDays1to7"] = float(np.mean(vals)) if vals else None
        out["groups"][g] = res
    return out


def seasons_and_years(
    data: Data, site: str, eps: Sequence[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    t = data.tables[site]
    lo, hi = data.flux[site]
    years = range(to_date(lo).year, to_date(hi).year + 1)
    seasons: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    wet: list[dict[str, Any]] = []
    for y in years:
        a = max(lo, day_number(date(y, 1, 1)))
        b = min(hi, day_number(date(y, 12, 31)))
        nee = t.values("nee", a, b)
        frac = t.values("frac", a, b)
        s = (
            thermal_season(t, "ta_mean", y)
            if site in FINNISH_SITES
            else {"start": None, "end": None, "length": None}
        )
        if site in FINNISH_SITES:
            seasons.append({"site": site, **s})
        evs = [e for e in data.events if e.site == site and to_date(e.date).year == y]
        rows.append(
            {
                "year": y,
                "nDays": int((~np.isnan(nee)).sum()),
                "nDaysMeasured": int(((~np.isnan(nee)) & (frac >= MIN_FRAC)).sum()),
                "seasonStart": s["start"],
                "seasonEnd": s["end"],
                "seasonLength": s["length"],
                "events": {
                    k: sum(1 for e in evs if e.type == k)
                    for k in KIND_PRIORITY
                    if any(e.type == k for e in evs)
                },
                "episodes": sum(1 for e in eps if e["start"][:4] == str(y)),
            }
        )
    if site not in FINNISH_SITES:
        for y in years:
            for m in range(1, 13):
                a = max(lo, day_number(date(y, m, 1)))
                nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
                b = min(hi, day_number(nxt) - 1)
                if a > b:
                    continue
                p = t.values("precip", a, b)
                n = int((~np.isnan(p)).sum())
                total = float(np.nansum(p)) if n else None
                if total is not None and total > WET_MONTH_MM:
                    wet.append(
                        {
                            "month": f"{y}-{m:02d}",
                            "precipMm": total,
                            "nDays": n,
                            "daysInMonth": b - a + 1,
                        }
                    )
    return seasons, rows, wet


def event_rows(
    data: Data, site: str, eps: Sequence[Episode], res_eps: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    lo, hi = data.flux[site]
    out = []
    for e in data.events:
        if e.site != site:
            continue
        ep = next((p for p in eps if e in p.events), None)
        r = res_eps.get(ep.id) if ep else None
        out.append(
            {
                "date": iso_day(e.date),
                "dateEnd": None if e.date_end is None else iso_day(e.date_end),
                "type": e.type,
                "letter": TYPE_LETTERS[e.type],
                "detail": e.detail,
                "detailShort": short_text(e.detail),
                "source": e.source,
                "crop": e.crop,
                "yieldTHa": None
                if e.dry_mass_kg_ha is None
                else e.dry_mass_kg_ha / 1000,
                "nKgHa": e.n_kg_ha,
                "fieldOperation": e.field_op,
                "inFluxPeriod": lo <= e.date <= hi,
                "episodeId": None if ep is None else ep.id,
                "episodeKind": None if ep is None else ep.kind,
                "offset": None if r is None else r["offset"],
                "clear": None if r is None else r["clear"],
            }
        )
    return out


def analyse(data: Data) -> dict[str, Any]:
    eps = merge_episodes(data.events)
    res_list = [episode_result(data, ep, eps) for ep in eps]
    res_by_id = {r["id"]: r for r in res_list}
    data.steps["episodes"] = {
        "episodes": len(eps),
        "overlap": sum(1 for r in res_list if r["overlap"]),
        "spanOverlap": sum(1 for r in res_list if r["spanOverlap"]),
        "outsideFluxPeriod": sum(1 for r in res_list if not r["inFluxPeriod"]),
        "withChangePointTest": sum(1 for r in res_list if r["primary"] is not None),
        "searched": sum(1 for r in res_list if r["searched"]),
        "usedForOffset": sum(1 for r in res_list if r["usedForOffset"]),
        "clearUsed": sum(1 for r in res_list if r["usedForOffset"] and r["clear"]),
        "usedForChange": sum(1 for r in res_list if r["usedForChange"]),
        "rule": (
            "overlap = a day of another episode in the 7-day windows (not in the summaries); "
            "spanOverlap = another episode with a change-point test in the days that the search reads "
            "(not in the offset summaries); searched = the test has at least one candidate day"
        ),
    }
    log.info("episodes: %s", json.dumps(data.steps["episodes"]))

    # ----- offset summaries -----
    by_kind: dict[str, Any] = {}
    by_site_kind: dict[str, Any] = {}
    for k, key in enumerate(OFFSET_KINDS):
        group = [r for r in res_list if in_kind(r["kind"], key)]
        by_kind[key] = offset_summary(group, SEED_OFFSET_KIND + k, f"offsets.{key}")
    for s, site in enumerate(SITES):
        by_site_kind[site] = {}
        for k, key in enumerate(OFFSET_KINDS):
            group = [
                r for r in res_list if r["site"] == site and in_kind(r["kind"], key)
            ]
            if not group:
                continue
            by_site_kind[site][key] = offset_summary(
                group,
                SEED_OFFSET_SITE_KIND + 10 * s + k,
                f"offsets.{site}.{key}",
            )

    # ----- 7-day changes -----
    change_summary: dict[str, Any] = {}
    for k, key in enumerate(CHANGE_KINDS):
        group = [r for r in res_list if in_kind(r["kind"], key) and r["usedForChange"]]
        out: dict[str, Any] = {"n": len(group), "ids": [r["id"] for r in group]}
        for i, stat in enumerate(("gpp", "reco", "nee", "gppPct")):
            out[stat] = summarise(
                (r["change"][stat] for r in group),
                SEED_CHANGE + 10 * k + i,
                f"changes.{key}.{stat}",
            )
        change_summary[key] = out

    # ----- other tests -----
    def test_summary(
        name: str, i: int, sel: Callable[[dict[str, Any]], bool]
    ) -> dict[str, Any]:
        group = [r for r in res_list if sel(r) and r[name] is not None]
        searched = [r for r in group if r[name]["reason"] != "too-few-days"]
        clear = [r for r in searched if r[name]["clear"]]
        s = summarise(
            (r[name]["offset"] for r in clear), SEED_TEST + i, f"tests.{name}"
        )
        s.update(
            {
                "nEpisodes": len(group),
                "nSearched": len(searched),
                "nClear": len(clear),
                "nBefore": s.pop("nNegative"),
                "nOn": s.pop("nZero"),
                "nAfter": s.pop("nPositive"),
                "ids": [r["id"] for r in clear],
            }
        )
        return s

    tests = {
        "sowingRise": test_summary("sowingRise", 0, lambda r: True),
        "recoRiseTillage": test_summary("recoRise", 1, lambda r: True),
        "gppDrop": test_summary("gppDrop", 2, lambda r: r["usedForOffset"]),
        "neeDrop": test_summary("neeDrop", 3, lambda r: r["usedForOffset"]),
    }
    both = [r for r in res_list if r["usedForOffset"] and r["agree"] is not None]
    tests["neeAgree"] = {
        "nBothClear": len(both),
        "nAgree": sum(1 for r in both if r["agree"]),
        "agreeDays": AGREE_DAYS,
        "ids": [r["id"] for r in both],
        "idsDisagree": [r["id"] for r in both if not r["agree"]],
    }

    # ----- alternative dates -----
    alts = [alt_search(data, row, eps) for row in ALTERNATIVE_DATES]
    for a in alts:
        log.info(
            "alternative %s %s %s / %s: detected %s, offset to used %s, to other %s, clear %s, nearer %s",
            a["site"],
            a["type"],
            a["dateUsed"],
            a["dateOther"],
            a["detected"],
            a["offsetToUsed"],
            a["offsetToOther"],
            a["clear"],
            a["nearer"],
        )

    # ----- per site -----
    sites_out: dict[str, Any] = {}
    seasons_all: list[dict[str, Any]] = []
    for site in SITES:
        site_eps = [r for r in res_list if r["site"] == site]
        seasons, years, wet = seasons_and_years(data, site, site_eps)
        seasons_all += seasons
        lo, hi = data.flux[site]
        sites_out[site] = {
            "name": data.names[site],
            "utcOffsetMin": data.offsets[site],
            "fluxFirst": iso_day(lo),
            "fluxLast": iso_day(hi),
            **{
                k: data.steps["daily"]["perSite"][site][k]
                for k in ("daysWithNee", "daysNoNeeInFluxPeriod", "daysLowFrac")
            },
            "events": event_rows(data, site, eps, res_by_id),
            "episodes": site_eps,
            "years": years,
            "wetMonths": wet if site not in FINNISH_SITES else None,
            "alternativeDates": [a for a in alts if a["site"] == site],
        }

    # ----- counts -----
    counts = {
        "events": len(data.events),
        "eventsPerSiteType": {
            s: {
                k: sum(1 for e in data.events if e.site == s and e.type == k)
                for k in KIND_PRIORITY
                if any(e.site == s and e.type == k for e in data.events)
            }
            for s in SITES
        },
        "eventsPerSite": {s: sum(1 for e in data.events if e.site == s) for s in SITES},
        "eventsOutsideFluxPeriod": {
            s: [
                iso_day(e.date)
                for e in data.events
                if e.site == s and not (data.flux[s][0] <= e.date <= data.flux[s][1])
            ]
            for s in SITES
        },
        "nonFieldEvents": [
            f"{e.site} {iso_day(e.date)} {e.detail}"
            for e in data.events
            if not e.field_op
        ],
        "episodes": len(eps),
        "episodesPerSiteKind": {
            s: {
                k: sum(1 for p in eps if p.site == s and p.kind == k)
                for k in KIND_PRIORITY
                if any(p.site == s and p.kind == k for p in eps)
            }
            for s in SITES
        },
        "episodesPerKind": {
            k: sum(1 for p in eps if p.kind == k)
            for k in KIND_PRIORITY
            if any(p.kind == k for p in eps)
        },
        "nAltDates": len(alts),
        "nAltDatesWithTest": sum(1 for a in alts if a["test"] is not None),
        "nAltDatesClear": sum(1 for a in alts if a["nearer"] is not None),
        "nAltNearerUsed": sum(1 for a in alts if a["nearer"] == "used"),
        "nAltNearerOther": sum(1 for a in alts if a["nearer"] == "other"),
        "nAltNearerEqual": sum(1 for a in alts if a["nearer"] == "equal"),
        "nAltNotes": len(ALT_NOTES),
        **{
            k: v
            for k, v in data.steps["episodes"].items()
            if k != "rule" and k != "episodes"
        },
    }
    log.info("counts: %s", json.dumps(counts, ensure_ascii=False))

    # ----- highlights -----
    highlights: dict[str, Any] = {}
    for hid in HIGHLIGHTS:
        site, d = hid.split("-", 1)
        ev = [e for e in data.events if e.site == site and iso_day(e.date) == d]
        ep = next(p for p in eps if ev and ev[0] in p.events)
        r = res_by_id[ep.id]
        alt = next((a for a in alts if a["site"] == site and a["dateUsed"] == d), None)
        prim = r[r["primary"]] if r["primary"] else None
        highlights[hid] = {
            "episodeId": ep.id,
            "kind": r["kind"],
            "anchor": r["anchor"],
            "detected": r["detected"],
            "offset": r["detectedOffset"],
            "clear": r["clear"],
            "step": None if prim is None else prim["step"],
            "stepPct": None if prim is None else prim["stepPct"],
            "neeDetected": None if r["neeDrop"] is None else r["neeDrop"]["detected"],
            "neeOffset": None if r["neeDrop"] is None else r["neeDrop"]["offset"],
            "neeClear": None if r["neeDrop"] is None else r["neeDrop"]["clear"],
            "agree": r["agree"],
            "dateOther": None if alt is None else alt["dateOther"],
            "altDetected": None if alt is None else alt["detected"],
            "offsetToUsed": None if alt is None else alt["offsetToUsed"],
            "offsetToOther": None if alt is None else alt["offsetToOther"],
            "nearer": None if alt is None else alt["nearer"],
        }

    return {
        "counts": counts,
        "sites": sites_out,
        "byKind": by_kind,
        "bySiteKind": by_site_kind,
        "changes": change_summary,
        "tests": tests,
        "alternativeDates": alts,
        "altNotes": list(ALT_NOTES),
        "seasons": seasons_all,
        "highlights": highlights,
        "course": course(data, res_list),
        "_episodes": res_list,
    }


# ======================================================================================
# Figures
# ======================================================================================
def fmt(x: float | None, digits: int = 2) -> str:
    """Number for the alt text: fixed decimals, minus sign as U+2212."""
    if x is None:
        return "n/a"
    s = f"{x:.{digits}f}"
    return s.replace("-", "−")


def fmt_off(x: int | None) -> str:
    """Signed offset in days for the alt text."""
    if x is None:
        return "n/a"
    return f"+{x} d" if x > 0 else ("0 d" if x == 0 else f"−{-x} d")


def setup_matplotlib() -> None:
    plt.rcParams.update(
        {
            "svg.fonttype": "none",
            "font.family": "sans-serif",
            "font.sans-serif": ["DejaVu Sans"],
            "mathtext.default": "regular",
            "font.size": 8,
            "axes.titlesize": 8,
            "axes.labelsize": 7.5,
            "xtick.labelsize": 7,
            "ytick.labelsize": 7,
            "legend.fontsize": 7,
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


def line_kw(dash: tuple[float, ...] | None) -> dict[str, Any]:
    return {"linestyle": "-" if dash is None else (0, dash)}


def text_width_in(text: str, pt: float = LABEL_PT) -> float:
    """Estimated width of a label in inches (0.6 em per character, DejaVu Sans)."""
    return len(text) * pt * 0.6 / 72


def utc_text(offset_min: int) -> str:
    h = offset_min // 60
    return f"UTC+{h}" if h >= 0 else f"UTC{h}"


def plot_measured(
    ax: Any,
    x: np.ndarray,
    y: np.ndarray,
    low: np.ndarray,
    color: str,
    dash: tuple[float, ...] | None,
    lw: float,
) -> None:
    """The full line lighter (alpha 0.35), and the days with a measured fraction >= 0.10 on top."""
    ax.plot(x, y, color=color, lw=lw, alpha=0.35, **line_kw(dash), zorder=3)
    ax.plot(x, np.where(low, np.nan, y), color=color, lw=lw, **line_kw(dash), zorder=4)


def fig_site(res: dict[str, Any], data: Data, site: str) -> tuple[Any, str, str]:
    t = data.tables[site]
    s_res = res["sites"][site]
    slot = data.slots[site]
    color = SERIES[slot]
    reco_color = RECO_COLOR_ALT if color == RECO_COLOR else RECO_COLOR
    name = data.names[site]
    lo, hi = data.flux[site]
    xmin, xmax = lo - 10, hi + 11
    x = np.arange(lo, hi + 1, dtype=float)
    gpp, reco, nee = (t.values(v, lo, hi) for v in FLUX_VARS)
    frac = t.values("frac", lo, hi)
    low = np.nan_to_num(frac, nan=1.0) < MIN_FRAC
    ta, swc, precip = (t.values(v, lo, hi) for v in ("ta", "swc", "precip"))
    utc = utc_text(data.offsets[site])

    # ----- labels of the events and of the other dates -----
    left_in, right_in = 0.72, 0.72
    ax_w_in = FIG_WIDTH_IN - left_in - right_in
    days_per_in = (xmax - xmin) / ax_w_in
    ev_site = [e for e in data.events if e.site == site and xmin <= e.date <= xmax]
    by_date: dict[int, list[Event]] = {}
    for e in ev_site:
        by_date.setdefault(e.date, []).append(e)
    labels: list[dict[str, Any]] = []
    for d in sorted(by_date):
        txt = event_label(by_date[d])
        w = (text_width_in(txt) + 3 / 72) * days_per_in
        labels.append({"x": d, "text": txt, "span": (d, d + w), "alt": None})
    alts = [a for a in s_res["alternativeDates"]]
    for a in alts:
        xo, xu = day_number(a["dateOther"]), day_number(a["dateUsed"])
        if not xmin <= xo <= xmax:
            continue
        txt = f"{TYPE_LETTERS[a['type']]} {a['sourceShort']}"
        w = (text_width_in(txt) + 3 / 72) * days_per_in
        labels.append(
            {
                "x": xo,
                "text": txt,
                "span": (min(xo, xu), max(xo + w, xu)),
                "alt": xu,
            }
        )
    rows = label_rows([lb["span"] for lb in labels], gap=0.06 * days_per_in)
    nrows = max(rows) + 1 if rows else 1

    # ----- layout in inches -----
    top, strip_h = 0.1, nrows * 0.15 + 0.08
    gap_t = 0.24
    heights = {"a": 1.3, "b": 1.0, "c": 1.05, "d": 0.5}
    gap = 0.26
    bottom_axis, legend_h, pad = 0.42, 0.62, 0.08
    total = (
        top
        + strip_h
        + gap_t
        + sum(heights.values())
        + 3 * gap
        + bottom_axis
        + legend_h
        + pad
    )
    fig = plt.figure(figsize=(FIG_WIDTH_IN, total))

    def box(y_top: float, h: float) -> tuple[float, float, float, float]:
        return (
            left_in / FIG_WIDTH_IN,
            (total - y_top - h) / total,
            ax_w_in / FIG_WIDTH_IN,
            h / total,
        )

    y = top
    ax_s = fig.add_axes(box(y, strip_h))
    y += strip_h + gap_t
    axes: dict[str, Any] = {}
    for i, key in enumerate(("a", "b", "c", "d")):
        axes[key] = fig.add_axes(
            box(y, heights[key]), sharex=ax_s if i == 0 else axes["a"]
        )
        y += heights[key] + (gap if key != "d" else 0)
    ax_a, ax_b, ax_c, ax_d = axes["a"], axes["b"], axes["c"], axes["d"]
    ax_s.set_xlim(xmin, xmax)
    ax_s.set_ylim(nrows - 0.5, -0.5)
    ax_s.axis("off")

    # ----- bands: thermal season (Finland) or wet months (Maktau) -----
    band_label = None
    if site in FINNISH_SITES:
        for srow in res["seasons"]:
            if srow["site"] != site:
                continue
            y0 = day_number(srow["start"]) if srow["start"] else None
            y1 = day_number(srow["end"]) if srow["end"] else None
            if y0 is None and y1 is None:
                continue
            a0 = y0 if y0 is not None else max(lo, day_number(date(srow["year"], 3, 1)))
            a1 = (
                y1
                if y1 is not None
                else min(hi, day_number(date(srow["year"], 12, 31)))
            )
            for ax in (ax_a, ax_b, ax_c, ax_d):
                ax.axvspan(a0, a1, color=GREY, alpha=0.12, lw=0, zorder=0)
        band_label = "Thermal growing season (daily mean > 5 °C)"
    else:
        for wm in s_res["wetMonths"] or []:
            yy, mm = (int(p) for p in wm["month"].split("-"))
            a0 = day_number(date(yy, mm, 1))
            a1 = day_number(date(yy + (mm == 12), mm % 12 + 1, 1))
            for ax in (ax_a, ax_b, ax_c, ax_d):
                ax.axvspan(a0, a1, color=GREY, alpha=0.12, lw=0, zorder=0)
        band_label = f"Month with precipitation > {WET_MONTH_MM:.0f} mm"

    # ----- data -----
    plot_measured(ax_a, x, gpp, low, color, None, 0.8)
    plot_measured(ax_a, x, reco, low, reco_color, RECO_DASH, 0.8)
    ax_a.set_ylabel("GPP, Reco\n(g C m$^{-2}$ d$^{-1}$)")
    ax_a.set_title("(a) GPP and Reco, daily sum", loc="left", fontsize=7.5)
    ax_b.axhline(0, color=INK, lw=0.6, zorder=2)
    plot_measured(ax_b, x, nee, low, color, None, 0.8)
    ax_b.set_ylabel("NEE\n(g C m$^{-2}$ d$^{-1}$)")
    ax_b.set_title("(b) NEE, gap-filled, daily sum", loc="left", fontsize=7.5)
    ax_b.set_title("NEE < 0 = uptake", loc="right", fontsize=7)
    ax_c.plot(x, ta, color=TA_COLOR, lw=0.55, zorder=3)
    ax_c.axhline(0, color=INK, lw=0.5, ls=(0, (1, 2)), zorder=2)
    ax_c.set_ylabel("Tair (°C)")
    ax_c.set_title(
        "(c) Air temperature and soil water content, daily mean",
        loc="left",
        fontsize=7.5,
    )
    ax_c2 = ax_c.twinx()
    ax_c2.spines["right"].set_visible(True)
    ax_c2.plot(x, swc, color=SWC_COLOR, lw=0.9, zorder=3)
    ax_c2.set_ylabel("SWC (m$^{3}$ m$^{-3}$)", color=INK)
    ax_c2.set_ylim(
        0, max(0.05, float(np.nanmax(swc)) * 1.1) if np.isfinite(swc).any() else 1
    )
    if np.isfinite(precip).any():
        ax_d.fill_between(
            x, 0, np.nan_to_num(precip), step="mid", color=GREY, lw=0, zorder=3
        )
        ax_d.set_ylim(0, float(np.nanmax(precip)) * 1.05)
    else:
        ax_d.set_ylim(0, 1)
        ax_d.text(
            0.5,
            0.5,
            "No precipitation data at this site",
            transform=ax_d.transAxes,
            ha="center",
            va="center",
            fontsize=7,
            color=INK,
        )
    ax_d.set_ylabel("Precip.\n(mm d$^{-1}$)")
    ax_d.set_title("(d) Precipitation, daily sum", loc="left", fontsize=7.5)

    # ----- events -----
    for e in ev_site:
        if e.date_end is not None:
            for ax in (ax_a, ax_b, ax_c, ax_d):
                ax.axvspan(
                    e.date, e.date_end + 1, color=color, alpha=0.15, lw=0, zorder=1
                )
    for d in by_date:
        for ax in (ax_a, ax_b, ax_c, ax_d):
            ax.axvline(d, color=color, lw=0.6, alpha=0.7, zorder=2)
    for lb, r in zip(labels, rows, strict=True):
        xo = lb["x"]
        if lb["alt"] is None:
            ax_s.plot(
                [xo, xo],
                [r - 0.45, nrows - 0.5],
                color=color,
                lw=0.6,
                alpha=0.7,
                clip_on=False,
            )
            ax_s.annotate(
                lb["text"],
                (xo, r),
                xytext=(2, 0),
                textcoords="offset points",
                va="center",
                ha="left",
                fontsize=LABEL_PT,
                color=INK,
                bbox={"fc": "white", "ec": "none", "pad": 0.4},
                zorder=5,
            )
        else:
            for ax in (ax_a, ax_b, ax_c, ax_d):
                ax.axvline(xo, color=color, lw=0.7, alpha=0.5, ls=(0, (3, 2)), zorder=2)
            ax_s.plot(
                [xo, xo],
                [r - 0.45, nrows - 0.5],
                color=color,
                lw=0.7,
                alpha=0.5,
                ls=(0, (3, 2)),
                clip_on=False,
            )
            ax_s.plot(
                [min(xo, lb["alt"]), max(xo, lb["alt"])],
                [r + 0.42, r + 0.42],
                color=color,
                lw=0.6,
                alpha=0.6,
            )
            ax_s.annotate(
                lb["text"],
                (xo, r),
                xytext=(2, 0),
                textcoords="offset points",
                va="center",
                ha="left",
                fontsize=LABEL_PT,
                color=INK,
                fontstyle="italic",
                bbox={"fc": "white", "ec": "none", "pad": 0.4},
                zorder=5,
            )

    # ----- axes -----
    for ax in (ax_a, ax_b, ax_c):
        ax.tick_params(labelbottom=False)
    loc = mdates.AutoDateLocator(minticks=4, maxticks=12)
    formatter = mdates.ConciseDateFormatter(loc)
    formatter.offset_formats = [""] * 6
    ax_d.xaxis.set_major_locator(loc)
    ax_d.xaxis.set_major_formatter(formatter)
    ax_d.set_xlabel(f"Date (local time, {utc})")
    ax_d.set_xlim(xmin, xmax)
    for ax in (ax_a, ax_b, ax_c, ax_c2, ax_d):
        ax.yaxis.set_label_coords(-0.07 if ax is not ax_c2 else 1.07, 0.5)

    # ----- legend -----
    handles = [
        Line2D([], [], color=color, lw=1.2, label="GPP"),
        Line2D([], [], color=reco_color, lw=1.2, ls=(0, RECO_DASH), label="Reco"),
        Line2D([], [], color=color, lw=1.2, label="NEE, gap-filled"),
        Line2D(
            [], [], color=color, lw=1.2, alpha=0.35, label="Measured fraction < 10 %"
        ),
        Line2D([], [], color=TA_COLOR, lw=0.8, label="Tair"),
        Line2D([], [], color=SWC_COLOR, lw=1.2, label="SWC"),
        Patch(color=GREY, lw=0, label="Precipitation"),
        Line2D([], [], color=color, lw=0.8, alpha=0.7, label="Recorded event"),
    ]
    if any(e.date_end is not None for e in ev_site):
        handles.append(Patch(color=color, alpha=0.15, lw=0, label="Event period"))
    if any(lb["alt"] is not None for lb in labels):
        handles.append(
            Line2D(
                [],
                [],
                color=color,
                lw=0.8,
                alpha=0.5,
                ls=(0, (3, 2)),
                label="Other date in a source",
            )
        )
    handles.append(Patch(color=GREY, alpha=0.25, lw=0, label=band_label))
    leg_y = (legend_h + pad) / total
    fig.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.5, leg_y),
        ncol=4,
        frameon=False,
        fontsize=6.8,
        handlelength=2.2,
        columnspacing=1.2,
    )
    fig.text(
        0.5,
        pad / total,
        "Labels: H harvest, C cut, G grazing, F fertilisation, Sw sowing, T tillage, Sp spraying, "
        "O other; '3.4 t' = yield in t DW/ha"
        + ("; italic = the other date and its source." if alts else "."),
        ha="center",
        va="bottom",
        fontsize=6.5,
        color=INK,
    )

    # ----- caption and alt text -----
    title = (
        f"{name}: daily GPP, Reco and gap-filled NEE (g C m-2 d-1), air temperature, soil water "
        f"content and precipitation from {s_res['fluxFirst']} to {s_res['fluxLast']}, with the "
        "recorded management events. A dashed line marks a second date of the same event in "
        "another source."
    )
    title = title if alts else title.split(" A dashed line")[0]
    n_days = int(np.isfinite(nee).sum())
    parts = [
        (
            f"Four panels on one date axis (local time, {utc}) from {s_res['fluxFirst']} to {s_res['fluxLast']}. "
            f"{n_days} days with gap-filled NEE; {s_res['daysLowFrac']} days with a measured fraction of NEE below "
            f"10 % are drawn lighter. Daily GPP from {fmt(float(np.nanmin(gpp)), 1)} to {fmt(float(np.nanmax(gpp)), 1)}, "
            f"Reco from {fmt(float(np.nanmin(reco)), 1)} to {fmt(float(np.nanmax(reco)), 1)} and NEE from "
            f"{fmt(float(np.nanmin(nee)), 1)} to {fmt(float(np.nanmax(nee)), 1)} g C m-2 d-1 (NEE < 0 = uptake)."
        )
    ]
    in_p = [e for e in s_res["events"] if e["inFluxPeriod"]]
    out_p = [e for e in s_res["events"] if not e["inFluxPeriod"]]
    type_counts = ", ".join(
        f"{sum(1 for e in in_p if e['type'] == k)} {k}"
        for k in KIND_PRIORITY
        if any(e["type"] == k for e in in_p)
    )
    parts.append(
        f"{len(in_p)} recorded events in the period ({type_counts}), drawn as vertical lines with "
        "a type label above panel (a)."
        + (
            f" {len(out_p)} events lie outside the flux period and are not drawn: "
            + ", ".join(f"{e['type']} {e['date']}" for e in out_p)
            + "."
            if out_p
            else ""
        )
    )
    cps = []
    for ep in s_res["episodes"]:
        if ep["primary"] is None or not ep["inFluxPeriod"]:
            continue
        what = "GPP drop" if ep["primary"] == "gppDrop" else "GPP rise after sowing"
        if ep["detected"] is None:
            cps.append(f"{ep['kind']} {ep['anchor']}: too few days for the search")
        else:
            cps.append(
                f"{ep['kind']} {ep['anchor']}: {what} on {ep['detected']} ({fmt_off(ep['detectedOffset'])}, "
                f"{'clear' if ep['clear'] else 'not clear'})"
            )
    if cps:
        parts.append(
            "Largest change of daily GPP near each event: " + "; ".join(cps) + "."
        )
    for a in alts:
        if a["test"] is None:
            parts.append(
                f"{a['type'].capitalize()} {a['dateUsed']}: the {a['sourceShort']} source gives {a['dateOther']}; "
                "no change-point test for this type."
            )
        else:
            near = {
                "used": "nearer to the used date",
                "other": "nearer to the other date",
                "equal": "at the same distance from both dates",
                None: "not clear",
            }[a["nearer"]]
            parts.append(
                f"{a['type'].capitalize()} {a['dateUsed']}: the {a['sourceShort']} source gives {a['dateOther']}; "
                f"the largest GPP drop is on {a['detected']} ({fmt_off(a['offsetToUsed'])} from the used date, "
                f"{fmt_off(a['offsetToOther'])} from the other date), {near}."
            )
    if site in FINNISH_SITES:
        ss = [
            f"{r['year']}: {r['start'] or 'n/a'} to {r['end'] or 'n/a'}"
            + (f" ({r['length']} d)" if r["length"] is not None else "")
            for r in res["seasons"]
            if r["site"] == site
        ]
        parts.append("Grey bands: thermal growing season, " + "; ".join(ss) + ".")
    else:
        wm = s_res["wetMonths"] or []
        parts.append(
            f"Grey bands: {len(wm)} months with a precipitation sum above {WET_MONTH_MM:.0f} mm"
            + (": " + ", ".join(w["month"] for w in wm) if wm else "")
            + "."
        )
    if not np.isfinite(precip).any():
        parts.append("Panel (d) is empty: the site has no precipitation data.")
    desc = " ".join(parts)
    return fig, title, desc


def fig_offsets(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    xlo, xhi = -15, 45
    alt_rows = {
        site: [
            a
            for a in res["sites"][site]["alternativeDates"]
            if a["offsetToUsed"] is not None
        ]
        for site in SITES
    }
    sub = 0.26
    y_main: dict[str, float] = {}
    y = 0.0
    for site in SITES:
        y_main[site] = y
        y += 0.75 + sub * len(alt_rows[site])
    y_max = y - 0.75 + 0.45
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, 1.55 + 0.42 * y_max))
    ax.axvline(0, color=INK, lw=0.8, zorder=1)
    ax.axvspan(SEARCH_FROM, 0, color=GREY, alpha=0.08, lw=0, zorder=0)
    ylabels = []
    not_drawn: list[str] = []
    for slot, site in enumerate(SITES):
        color = SERIES[slot]
        y0 = y_main[site]
        eps = [r for r in res["sites"][site]["episodes"] if r["primary"] is not None]
        used = [
            r for r in eps if r["usedForOffset"] and r["detectedOffset"] is not None
        ]
        n_clear = sum(1 for r in used if r["clear"])
        ylabels.append(f"{data.names[site]} ({n_clear} of {len(used)})")
        seen: dict[int, int] = {}
        for r in eps:
            if r not in used:
                not_drawn.append(
                    f"{r['id']} ({'overlap' if r['overlap'] or r['spanOverlap'] else 'no data'})"
                )
                continue
            off = int(r["detectedOffset"])
            k = seen.get(off, 0)
            seen[off] = k + 1
            yy = y0 - 0.12 + 0.12 * (k % 3)
            mk = KIND_MARKER[r["kind"]]
            ax.plot(
                [off],
                [yy],
                marker=mk,
                ms=5,
                mec=color,
                mfc=color if r["clear"] else "white",
                mew=1.0,
                ls="none",
                zorder=4,
            )
        for i, a in enumerate(alt_rows[site]):
            yy = y0 + 0.36 + sub * i
            xu, xo = a["offsetToUsed"], a["offsetToOther"]
            xo_c = min(max(xo, xlo + 0.6), xhi - 0.6)
            ax.plot([xu, xo_c], [yy, yy], color=GREY, lw=0.8, zorder=2)
            mk = KIND_MARKER.get(a["type"], "o")
            ax.plot(
                [xu],
                [yy],
                marker=mk,
                ms=3.6,
                mec=color,
                mfc=color if a["clear"] else "white",
                ls="none",
                zorder=4,
            )
            ax.plot(
                [xo_c],
                [yy],
                marker=mk,
                ms=3.6,
                mec=GREY,
                mfc="white",
                ls="none",
                zorder=4,
            )
            tag = f"{TYPE_LETTERS[a['type']]} {a['dateUsed']} / {a['dateOther'][5:]} ({a['sourceShort']})"
            if xo != xo_c:
                tag += f", other {fmt_off(xo)}"
            right = max(xu, xo_c)
            if right < 22:
                ax.annotate(
                    tag,
                    (right, yy),
                    xytext=(5, 0),
                    textcoords="offset points",
                    ha="left",
                    va="center",
                    fontsize=6,
                    color=INK,
                    bbox={"fc": "white", "ec": "none", "pad": 0.3},
                    zorder=5,
                )
            else:
                ax.annotate(
                    tag,
                    (min(xu, xo_c), yy),
                    xytext=(-5, 0),
                    textcoords="offset points",
                    ha="right",
                    va="center",
                    fontsize=6,
                    color=INK,
                    bbox={"fc": "white", "ec": "none", "pad": 0.3},
                    zorder=5,
                )
    ax.set_yticks([y_main[s_] for s_ in SITES])
    ax.set_yticklabels(ylabels)
    ax.set_ylim(y_max, -0.45)
    ax.set_xlim(xlo, xhi)
    ax.set_xticks(range(-15, 46, 5))
    ax.set_xlabel(
        "Offset of the detected day from the recorded date (days; local days)"
    )
    ax.grid(axis="x", color="#e6e6e6", lw=0.5, zorder=0)
    handles = [
        Line2D(
            [],
            [],
            marker="o",
            ms=5,
            mec=INK,
            mfc=INK,
            ls="none",
            label="Harvest or cut",
        ),
        Line2D([], [], marker="s", ms=5, mec=INK, mfc=INK, ls="none", label="Grazing"),
        Line2D([], [], marker="^", ms=5, mec=INK, mfc=INK, ls="none", label="Tillage"),
        Line2D(
            [],
            [],
            marker="D",
            ms=5,
            mec=INK,
            mfc=INK,
            ls="none",
            label="Sowing (GPP rise)",
        ),
        Line2D(
            [], [], marker="o", ms=5, mec=INK, mfc="white", ls="none", label="Not clear"
        ),
        Line2D(
            [],
            [],
            color=GREY,
            lw=0.8,
            marker="o",
            ms=3.6,
            mec=GREY,
            mfc="white",
            label="Same event, offset to the other date",
        ),
    ]
    fig.legend(
        handles=handles,
        loc="lower center",
        bbox_to_anchor=(0.55, 0.0),
        ncol=3,
        frameon=False,
        fontsize=6.8,
    )
    fig.subplots_adjust(
        left=0.2,
        right=0.98,
        top=1 - 0.1 / fig.get_figheight(),
        bottom=0.95 / fig.get_figheight(),
    )
    bk = res["byKind"]
    title = (
        "Offset of the largest daily GPP change from the recorded date of each harvest, cut, grazing, "
        "tillage and sowing episode, per site. Filled markers are clear change points; grey markers "
        "show the offset to the other date of the same event in another source."
    )
    parts = [
        (
            "Strip plot. X axis: detected day minus recorded date (days, -15 to +45; negative = the flux "
            "changed before the recorded date). One row per site; the row label gives the clear and the "
            "searched episodes. Marker shape = episode kind (circle harvest or cut, square grazing, "
            "triangle tillage, diamond sowing with a GPP rise); open = not clear."
        )
    ]
    for key in ("harvestCut", "grazing", "tillage", "sowing"):
        s = bk[key]
        if s["n"] == 0:
            parts.append(f"{key}: no clear change point ({s['nSearched']} searched).")
            continue
        ci = (
            f"95 % CI {fmt(s['ciLo'], 1)} to {fmt(s['ciHi'], 1)}"
            if s["ci"] is not None
            else f"range {fmt(s['min'], 0)} to {fmt(s['max'], 0)}"
        )
        sd = f", SD {fmt(s['sd'], 1)}" if s["sd"] is not None else ""
        parts.append(
            f"{KIND_STYLE[key][0]}: {s['nClear']} clear of {s['nSearched']} searched, mean offset "
            f"{fmt(s['mean'], 1)} d{sd}, median {fmt(s['median'], 1)} d, {ci}; {s['nBefore']} before, "
            f"{s['nOn']} on and {s['nAfter']} after the recorded date."
        )
    alts = [a for a in res["alternativeDates"] if a["offsetToUsed"] is not None]
    parts.append(
        "Grey pairs (other date in a source): "
        + "; ".join(
            f"{data.names[a['site']]} {a['type']} {a['dateUsed']} {fmt_off(a['offsetToUsed'])} / "
            f"{a['dateOther']} {fmt_off(a['offsetToOther'])}"
            for a in alts
        )
        + ". Offsets beyond the axis are drawn at the edge with their value."
    )
    if not_drawn:
        parts.append("Not drawn: " + ", ".join(not_drawn) + ".")
    return fig, title, " ".join(parts)


def fig_course(res: dict[str, Any]) -> tuple[Any, str, str]:
    c = res["course"]
    days = np.array(c["days"])
    fig, axes = plt.subplots(1, 3, figsize=(FIG_WIDTH_IN, 3.0), sharex=True)
    names = {
        "gpp": ("GPP", "GPP (% of GPP before)"),
        "reco": ("Reco", "Reco (% of Reco before)"),
        "nee": ("NEE", "NEE (% of GPP before)"),
    }
    handles = []
    for g in COURSE_GROUPS:
        grp = c["groups"][g]
        label, color, dash, mk = KIND_STYLE[g]
        if grp["episodes"] == 0:
            continue
        for ax, v in zip(axes, FLUX_VARS, strict=True):
            m = np.array(
                [np.nan if q is None else q for q in grp[v]["mean"]], dtype=float
            )
            q25 = np.array(
                [np.nan if q is None else q for q in grp[v]["q25"]], dtype=float
            )
            q75 = np.array(
                [np.nan if q is None else q for q in grp[v]["q75"]], dtype=float
            )
            if np.isfinite(q25).any():
                ax.fill_between(days, q25, q75, color=color, alpha=0.14, lw=0, zorder=2)
            ax.plot(
                days,
                m,
                color=color,
                lw=1.2,
                marker=mk,
                ms=2.6,
                markevery=2,
                zorder=3,
                **line_kw(dash),
            )
        handles.append(
            Line2D(
                [],
                [],
                color=color,
                lw=1.2,
                marker=mk,
                ms=3,
                label=f"{label} (n = {grp['episodes']})",
                **line_kw(dash),
            )
        )
    for ax, v in zip(axes, FLUX_VARS, strict=True):
        ax.axvline(0, color=INK, lw=0.8, ls="--", zorder=1)
        ax.axhline(100 if v != "nee" else 0, color=INK, lw=0.6, zorder=1)
        ax.set_title(names[v][0], loc="left", fontsize=8)
        ax.set_ylabel(names[v][1])
        ax.set_xticks(range(-14, 15, 7))
        ax.set_xlim(days[0] - 0.5, days[-1] + 0.5)
    axes[2].set_title("NEE < 0 = uptake", loc="right", fontsize=7)
    axes[1].set_xlabel("Day relative to the recorded date (local days)")
    fig.legend(
        handles=handles,
        loc="lower center",
        bbox_to_anchor=(0.5, 0.0),
        ncol=5,
        frameon=False,
        fontsize=6.8,
    )
    fig.subplots_adjust(left=0.08, right=0.99, top=0.91, bottom=0.27, wspace=0.42)
    title = (
        "Mean course of daily GPP, Reco and NEE from 14 days before to 14 days after the recorded "
        "date, per episode kind and over all sites, in percent of the mean of the 7 days before the "
        "episode (NEE in percent of the GPP before)."
    )
    parts = [
        (
            "Three panels: GPP, Reco and NEE. X axis: day relative to the recorded date (-14 to +14, local "
            "days). Y axis: percent of the before mean (GPP and Reco: 100 % = no change; NEE: percent of "
            f"the GPP before, 0 = neutral, NEE < 0 = uptake). A day is drawn when {COURSE_MIN_EPISODES} or "
            f"more episodes have a value; the band is the 25 to 75 % range when {COURSE_BAND_MIN} or more "
            f"episodes have a value. Episodes need a GPP before of {fmt(MIN_BEFORE, 0)} g C m-2 d-1 or more."
        )
    ]
    for g in COURSE_GROUPS:
        grp = c["groups"][g]
        if grp["episodes"] == 0:
            parts.append(f"{KIND_STYLE[g][0]}: no episode.")
            continue
        parts.append(
            f"{KIND_STYLE[g][0]} (n = {grp['episodes']}): mean of days +1 to +7: GPP "
            f"{fmt(grp['gpp']['meanDays1to7'], 0)} %, Reco {fmt(grp['reco']['meanDays1to7'], 0)} %, "
            f"NEE {fmt(grp['nee']['meanDays1to7'], 0)} % of the GPP before."
        )
    return fig, title, " ".join(parts)


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
        "bootstrap": {
            "resamples": BOOTSTRAP_RESAMPLES,
            "level": BOOTSTRAP_LEVEL,
            "generator": "numpy.random.default_rng (PCG64)",
        },
        "args": {
            "db": str(args.db),
            "calculated": str(args.calculated),
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
        "finnishSites": list(FINNISH_SITES),
        "kindPriority": list(KIND_PRIORITY),
        "dropKinds": list(DROP_KINDS),
        "typeLetters": TYPE_LETTERS,
        "nonFieldDetail": NON_FIELD_DETAIL.pattern,
        "mergeDays": MERGE_DAYS,
        "beforeDays": list(BEFORE),
        "afterDays": list(AFTER),
        "windowDays": AFTER[1] - AFTER[0] + 1,
        "minDays": MIN_DAYS,
        "minFrac": MIN_FRAC,
        "minFracPct": round(MIN_FRAC * 100),
        "searchFrom": SEARCH_FROM,
        "searchTo": SEARCH_TO,
        "sowingSearchFrom": SOWING_SEARCH[0],
        "sowingSearchTo": SOWING_SEARCH[1],
        "sideDays": SIDE_DAYS,
        "minSide": MIN_SIDE,
        "minSideNee": MIN_SIDE_NEE,
        "minBefore": MIN_BEFORE,
        "minBeforeNee": MIN_BEFORE_NEE,
        "minStepPct": MIN_STEP_PCT,
        "spanOverlapFrom": SEARCH_FROM - SIDE_DAYS,
        "spanOverlapTo": SEARCH_TO + SIDE_DAYS - 1,
        "agreeDays": AGREE_DAYS,
        "minMeasuredHalfHours": MIN_MEASURED_HH,
        "dayTimeFromHour": DAYTIME_HOURS[0],
        "dayTimeToHour": DAYTIME_HOURS[1],
        "seasonRunDays": SEASON_RUN_DAYS,
        "seasonThresholdC": SEASON_THRESHOLD_C,
        "seasonStartMonth": SEASON_START_MONTH,
        "seasonEndMonth": SEASON_END_MONTH,
        "wetMonthMm": WET_MONTH_MM,
        "courseFrom": COURSE_DAYS[0],
        "courseTo": COURSE_DAYS[1],
        "courseMinEpisodes": COURSE_MIN_EPISODES,
        "courseBandMin": COURSE_BAND_MIN,
        "lowFracSpan": list(LOW_FRAC_SPAN),
        "bootstrapResamples": BOOTSTRAP_RESAMPLES,
        "bootstrapLevel": BOOTSTRAP_LEVEL,
        "ciLevelPct": round(BOOTSTRAP_LEVEL * 100),
        "halfHoursPerDay": HALF_HOURS_PER_DAY,
        "utcShiftHours": UTC_SHIFT_HOURS,
        "nSites": len(SITES),
        "nFinnishSites": len(FINNISH_SITES),
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
        "--calculated",
        type=Path,
        default=Path("data/calculated"),
        help="folder of the calculated products (default: data/calculated)",
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

    errors = check_inputs(args.db, args.calculated)
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
        data = read_data(args.db, args.calculated)
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
        if name in SITES:
            fig, title, desc = fig_site(res, data, name)
        elif name == "offsets":
            fig, title, desc = fig_offsets(res, data)
        else:
            fig, title, desc = fig_course(res)
        path = target / "figures" / f"{n}-{name}.svg"
        save_svg(fig, path, n, title, desc, meta)
        size = path.stat().st_size
        if size >= 1_000_000:
            raise RuntimeError(f"{path}: {size} bytes (limit 1 MB)")
        figures_json.append(
            {"n": n, "file": f"figures/{n}-{name}.svg", "title": title, "desc": desc}
        )
        log.info("figure %d: %s (%d bytes)", n, path, size)

    episodes: list[dict[str, Any]] = res.pop("_episodes")
    pd.DataFrame(
        [
            {
                "id": e["id"],
                "site": e["site"],
                "kind": e["kind"],
                "types": "+".join(e["types"]),
                "start": e["start"],
                "end": e["end"],
                "anchor": e["anchor"],
                "overlap": e["overlap"],
                "spanOverlap": e["spanOverlap"],
                "primary": e["primary"],
                "detected": e["detected"],
                "detectedOffset": e["detectedOffset"],
                "clear": e["clear"],
                "dGpp": e["change"]["gpp"],
                "dReco": e["change"]["reco"],
                "dNee": e["change"]["nee"],
                "dGppPct": e["change"]["gppPct"],
                "agree": e["agree"],
            }
            for e in episodes
        ]
    ).to_csv(out_dir / "output" / "episodes.csv", index=False, float_format="%.10g")

    dv = data_version(args, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": (
            "At each site, how do the recorded dates of the management events sit against the change "
            "of daily GPP, Reco and NEE, and against the crop calendar of field crop production?"
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
