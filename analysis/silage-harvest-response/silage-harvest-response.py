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
"""Silage harvest and grassland CO2 fluxes: GPP, TER and NEE around the cut.

QUESTION
    How do daily GPP, TER (= Reco) and NEE of a grassland develop from 14 days before to 28 days
    after a silage harvest, per site and over all sites?

METHOD
    Sites: Anttila, Sarkisuo, Qvidja and Viikki (order of db/sites.parquet). Haltiala has no silage
    harvest (grain) and gets no panel; Maktau is not in the dive. The rules are those of Deep Dive
    #4 (scripts/deep-dives/disturbance-detail.ts), ported to Python. Day numbers count the days
    since 1970-01-01; all windows include both end days.
    1. Daily GPP, Reco (named TER here) and gap-filled NEE (g C m-2 d-1) and the measured fraction
       of NEE come from data/calculated/daily.parquet (local days). Events come from
       db/events.parquet.
    2. Episodes: the harvest and cut events of each of the five Finnish sites are sorted by date;
       an event that starts not more than 7 days after the last day of the current episode joins
       it. The recorded date is the first event date of the episode. Then the OVERRIDES of Deep
       Dive #4 apply (they change the first or the last day; an override that matches no episode
       stops the script). Group of an event: type cut = cleaning cut; a harvest whose crop or
       detail text matches /thresh|grain|faba|\\boats\\b|barley/i and not /\\bcut\\b|silage|grass/i
       = grain harvest; all other harvests = silage harvest. Group of an episode: grain when one
       event is a grain harvest, else silage when one event is a harvest, else cleaning cut. The
       dive keeps the silage harvest episodes (25).
    3. Windows from the first day (start) and the last day (end) of the episode: before = start-14
       to start-1, after = end+1 to end+14, late = end+15 to end+28. The window mean is the mean
       of the days with a value. The change (delta) = mean after - mean before; null when a side
       has fewer than 12 days with a value. Relative change of GPP, TER and NEE = 100 x delta /
       mean GPP before (null when the mean GPP before is below 0.5 g C m-2 d-1); thus
       NEE % = TER % - GPP %.
    4. An episode is not used (in this order) when (1) another harvest or cut episode, or a
       grazing or tillage event, overlaps the days start-14 to end+14 ("overlap"); (2) GPP, TER
       or NEE has fewer than 12 days in the before or the after window ("too-few-days"); (3) the
       mean measured fraction of NEE is below 0.10 in a window ("low-measured-fraction"). A
       fertilisation in the windows only sets a flag. 20 episodes are used.
    5. Recovery: the next disturbance = the smallest start of a later harvest or cut episode or of
       a grazing event of the site, minus end (tillage does not count). Recovery share = 100 x
       mean GPP of end+15 to end+28 / mean GPP before; null when the next disturbance starts 28
       days or less after end, the window has fewer than 12 days, or the GPP before is below 0.5.
       Days to recover = the first day d (1 to 60 after end) whose centred 5-day running mean of
       GPP (3 or more values) is 80 % or more of the GPP before. Censored when the next
       disturbance comes first (d+2 >= next, "blocked"), when the data end ("data-end"), or after
       day 60 ("max-days").
    6. Change point of the GPP drop: for each candidate day t from start-10 to end+5,
       drop(t) = mean GPP of t-5 to t-1 - mean GPP of t to t+4, each side with 4 or more values.
       The detected day is the t with the largest drop (the first on a tie). The drop is clear
       when the mean before is 1 g C m-2 d-1 or more and the drop is 25 % or more of it. Offset =
       detected day - recorded date (negative = the drop came before the recorded date). An
       episode is not in the timing result when another harvest or cut episode, or a grazing or
       tillage event, overlaps start-15 to end+9, or when no candidate day has enough GPP days.
       Pre-drop = 100 x (mean GPP of days -3 to -1 - mean of days -10 to -4) / mean of days -10 to
       -4 from the recorded date (far window 5 or more values and 1 g C m-2 d-1 or more, near
       window 2 or more values).
    7. Composite curves per site and over all used episodes: offsets -14 to +28 from start; the
       value of an episode is null from the day end + next disturbance on; GPP, TER and NEE in
       percent of the mean GPP before of the episode (null when below 0.5). Per day: mean, sample
       SD and n over the episodes; mean and SD are null when n < 2. The y range of both figures
       is one range over all mean +- SD of all panels, rounded outwards to a multiple of 25 and
       extended to hold 0 and 100.
    8. Summaries per site and over all used episodes: n, mean, SD, median, range of the changes
       (g C m-2 d-1 and %), the recovery share, the days to recover, the GPP drop offset (clear
       drops of the timing result) and the pre-drop; counts of drops before, on and after the
       recorded date. Bootstrap 95 % CI of the mean (10 000 resamples, percentile method, numpy
       PCG64, fixed seeds) when n >= 3. The CIs of Deep Dive #4 come from an other generator
       (mulberry32); the other numbers are equal.
    9. Each step that removes rows or changes values logs a count (results.json dataVersion.steps).
    10. Open findings of docs/anomaly-data-report.md that touch this dive are printed
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
    calculated/daily.parquet  sha256=fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9  rows=11209  columns=site_code, date_local, gpp_gc, reco_gc, nee_f_gc, frac_measured

OUTPUTS
    results.json                 all result numbers, figure captions and alt texts, dataVersion
    manifest.json                provenance of the run and SHA-256 of the outputs
    figures/1-per-site.svg       GPP, TER and NEE around the silage harvest, one panel per site
    figures/2-all-sites.svg      the same for all used episodes together
    output/run.log               run log (not in git)
    output/episodes.csv          all silage harvest episodes with the numbers (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/silage-harvest-response/silage-harvest-response.py --db db --calculated data/calculated

NOTES
    The local days of Anttila, Sarkisuo and Viikki start at 02:00 true local time (open findings
    ANT-01, SAR-01, VII-01). A daily change point can move by not more than 1 day.
    GPP and Reco are model values of the night-time partitioning (docs/calculated.md).
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
from collections.abc import Callable, Iterable, Sequence
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

SLUG = "silage-harvest-response"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"
SVG_ID_PREFIX = "sh"

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
        "calculated",
        "daily.parquet",
        "fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9",
        11209,
        ("site_code", "date_local", "gpp_gc", "reco_gc", "nee_f_gc", "frac_measured"),
        "2026-10-23T19:03:09.003Z",
    ),
)

# Units that the script expects in db/variables.parquet. The daily sums of data/calculated come from
# these 30-min fluxes (g C m-2 d-1, docs/calculated.md). The script does not convert a unit again.
EXPECTED_UNITS = {
    "nee_f": "µmol CO2 m-2 s-1",
    "gpp_src": "µmol CO2 m-2 s-1",
    "reco_src": "µmol CO2 m-2 s-1",
    "ts_start": "UTC",
}
DAILY_UNIT = "g C m-2 d-1"

# ---------- Method constants ----------
ALL_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
# Sites whose harvest and cut events are merged into episodes (as Deep Dive #4).
EPISODE_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki")
# Sites with a panel: the sites with silage harvest episodes.
SITES = ("anttila", "sarkisuo", "qvidja", "viikki")
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
HARVEST_GROUP_LABELS = {
    "silageHarvest": "Silage harvest (grass removed)",
    "cleaningCut": "Cleaning cut (grass left on the field)",
    "grainHarvest": "Grain or bean harvest",
}
GRAIN_RE = re.compile(r"thresh|grain|faba|\boats\b|barley", re.IGNORECASE)
GRASS_RE = re.compile(r"\bcut\b|silage|grass", re.IGNORECASE)
YEAR_YIELD_RE = re.compile(r"yield of the year", re.IGNORECASE)
YEAR_YIELD_VALUE_RE = re.compile(
    r"yield of the year\s+[\d.]+\s*kg\s*D[WM]/ha", re.IGNORECASE
)
PER_CUT_YIELD_RE = re.compile(r"\d\s*kg\s*DW/ha", re.IGNORECASE)

FLUX_VARS = ("gpp", "reco", "nee")
MEAN_VARS = ("nee", "gpp", "reco", "frac")
FLUX_LABELS = {"gpp": "GPP", "reco": "TER", "nee": "NEE"}
EXCLUSIONS = ("overlap", "too-few-days", "low-measured-fraction")
CENSOR_REASONS = ("blocked", "data-end", "max-days")

MERGE_DAYS = 7
BEFORE = (-14, -1)
AFTER = (1, 14)
LATE = (15, 28)
MIN_DAYS = 12
MIN_FRAC = 0.10
MIN_GPP_BEFORE = 0.5
RECOVERY = (15, 28)
RECOVERY_SHARE_PCT = 80
RECOVERY_MAX_DAYS = 60
RECOVERY_RUN_DAYS = 5
RECOVERY_MIN_RUN = 3
SEARCH_FROM = -10
SEARCH_TO = 5
SIDE_DAYS = 5
MIN_SIDE_GPP = 4
MIN_BEFORE_GPP = 1.0
MIN_DROP_PCT = 25.0
PRE_NEAR = (-3, -1)
PRE_FAR = (-10, -4)
PRE_MIN_NEAR = 2
PRE_MIN_FAR = 5
COMPOSITE = (-14, 28)
COMPOSITE_MIN_N = 2
COMPOSITE_EARLY = (1, 14)
COMPOSITE_LATE = (15, 28)
Y_STEP = 25
BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_LEVEL = 0.95
# Open findings ANT-01, SAR-01, VII-01: the stamps of Anttila, Sarkisuo and Viikki are 2 hours early.
UTC_SHIFT_HOURS = 2
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-9
DETAIL_SHORT = 90

# Seeds of the bootstrap: SEED_BASE + 100 * quantity index + site index (the "all" block is index 4).
SEED_BASE = 9000
SUMMARY_QUANTITIES = (
    "deltaGpp",
    "deltaReco",
    "deltaNee",
    "relGpp",
    "relReco",
    "relNee",
    "recoveryShare",
    "daysToRecover",
    "gppOffset",
    "preDropPct",
)

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

# ---------- Reference values ----------
# Book rows: ref "peltokasvien-tuotanto" (Seppanen, Yli-Halla, Stoddard, Makela and Helenius 2016,
# 3rd ed., Opetushallitus), section and printed page ("s."), checked with grep on
# data/Peltokasvien_tuotanto/content.html. Article rows: PDF page, checked with pdftotext.
BOOK = "peltokasvien-tuotanto"
LITERATURE: tuple[dict[str, Any], ...] = (
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


OPEN_FINDINGS = (
    (
        "ANT-01, SAR-01, VII-01 (open, waits for the providers): the raw stamps of Anttila, Sarkisuo and "
        "Viikki are UTC, but the build reads them as UTC+2. A local day of these sites thus starts at "
        "02:00 true local time. A daily window mean changes little; a daily change point can move by "
        "not more than 1 day."
    ),
    (
        "VII-05 (open): Viikki 2024 nee_f is not equal to nee in 1 540 periods. The gap filling around "
        "the 2024 harvests can thus differ from the measured values."
    ),
)

# ---------- Figures ----------
# Body font of site/src/styles/global.css, then the emoji fonts of the Tailwind font-sans stack
# (CLAUDE.md), so that a browser draws the site emojis of the panel titles with a colour emoji font.
# Single quotes around the names: the stack goes into a style="..." attribute of the SVG.
FONT_STACK = (
    "system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', "
    "'Noto Color Emoji'"
)
# Site emojis of the panel titles of Figure 1 (source: SITE_EMOJI in site/src/scripts/sites.ts).
SITE_EMOJI = {
    "anttila": "👱🏻‍♂️🫛",
    "sarkisuo": "🐟🌱",
    "qvidja": "🐂🐝",
    "viikki": "👩🏻‍🔬🎓",
}
# DejaVu Sans has no glyph for the emojis: matplotlib warns "Glyph <code point> ... missing from
# font(s)" at savefig and lays the title out with box glyphs. save_svg() silences only these
# warnings; the browser draws the emojis with a colour emoji font of FONT_STACK.
EMOJI_GLYPH_WARNING = (
    "^Glyph ("
    + "|".join(
        str(cp) for cp in sorted({ord(c) for e in SITE_EMOJI.values() for c in e})
    )
    + r") \(.*\) missing from font"
)
FONT_SCALE = 1.5  # fonts for slides: 1.5 x the dive default
COLORS = {"gpp": "#ADD8E6", "reco": "#FFB6C1", "nee": "#4a708b"}
DASHES: dict[str, tuple[float, ...] | None] = {
    "gpp": None,
    "reco": (6, 3),
    "nee": (8, 3, 2, 3),
}
MARKERS = {"gpp": "o", "reco": "s", "nee": "^"}
LEGEND_LABELS = {"gpp": "GPP", "reco": "TER (= Reco)", "nee": "NEE (< 0 = uptake)"}
HARVEST_LINE = "#FFA500"
INK = "#222222"
GREY = "#8a8a8a"
LINE_WIDTH = 2.2
MARKER_SIZE = 6.5
BAND_ALPHA = 0.25
MARK_EVERY = (0, 7)
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
# The user asked for a wider per-site figure than the 180 mm default of CLAUDE.md: 220 mm
# (about 830 px at 96 px per inch), so that the four panels have room.
FIG1_WIDTH_IN = 220 * MM
FIG1_HEIGHT_IN = 85 * MM
# Y major ticks of Figure 1 every 50 % (the panels are narrow); Figure 2 keeps Y_STEP.
FIG1_Y_TICK_STEP = 50
FIG2_HEIGHT_IN = 100 * MM
FIGURES = ((1, "per-site"), (2, "all-sites"))
X_LABEL = "Days from the first day of the harvest (local days)"
Y_LABEL = "GPP, TER, NEE (% of the mean GPP of days −14 to −1)"
# The same name in three lines (the panels are not high enough for one line).
Y_LABEL_LINES = "GPP, TER, NEE\n(% of the mean GPP\nof days −14 to −1)"

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
# Pure helpers: days, events, episodes
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


def yield_per_event(detail: str) -> bool:
    """True when the dry mass of the event is the yield of this event only (port of yieldPerEvent)."""
    if not YEAR_YIELD_RE.search(detail):
        return True
    rest = YEAR_YIELD_VALUE_RE.sub("", detail)
    return PER_CUT_YIELD_RE.search(rest) is not None


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
# Pure helpers: day tables, windows, change point, recovery
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
class Drop:
    """Result of the change-point search of a drop (port of Drop, change-point.ts)."""

    detected: int | None = None
    offset: int | None = None
    drop: float | None = None
    drop_pct: float | None = None
    before: float | None = None
    clear: bool = False
    reason: str | None = "too-few-days"

    def json(self) -> dict[str, Any]:
        return {
            "detectedDate": None if self.detected is None else iso_day(self.detected),
            "offset": self.offset,
            "drop": self.drop,
            "dropPct": self.drop_pct,
            "before": self.before,
            "clear": self.clear,
            "reason": self.reason,
        }


def detect_drop(
    table: DayTable,
    var: str,
    from_day: int,
    to_day: int,
    *,
    side_days: int = SIDE_DAYS,
    min_side: int = MIN_SIDE_GPP,
    min_before: float = MIN_BEFORE_GPP,
    min_drop_pct: float = MIN_DROP_PCT,
    anchor: int | None = None,
) -> Drop:
    """Largest drop of the daily `var` for t in from_day .. to_day (port of detectDrop).

    drop(t) = mean of t - side .. t - 1 - mean of t .. t + side - 1, each side with min_side or
    more values. The detected day is the first t with the largest drop. The drop is clear when the
    mean before is min_before or more and the drop is min_drop_pct % or more of it.
    """
    anchor_day = from_day if anchor is None else anchor
    best: tuple[int, float, float] | None = None
    for t in range(from_day, to_day + 1):
        nb, mb = table.range_mean(var, t - side_days, t - 1)
        na, ma = table.range_mean(var, t, t + side_days - 1)
        if nb < min_side or na < min_side or mb is None or ma is None:
            continue
        d = mb - ma
        if best is None or d > best[1]:
            best = (t, d, mb)
    if best is None:
        return Drop()
    t, d, mb = best
    drop_pct = 100 * d / mb if mb > 0 else None
    if mb < min_before:
        reason: str | None = "flux-too-small"
    elif drop_pct is None or drop_pct < min_drop_pct:
        reason = "drop-too-small"
    else:
        reason = None
    return Drop(t, t - anchor_day, d, drop_pct, mb, reason is None, reason)


def pre_drop(
    table: DayTable,
    var: str,
    start: int,
    near: tuple[int, int] = PRE_NEAR,
    far: tuple[int, int] = PRE_FAR,
    *,
    min_near: int = PRE_MIN_NEAR,
    min_far: int = PRE_MIN_FAR,
    min_far_mean: float = MIN_BEFORE_GPP,
) -> dict[str, float | None]:
    """Change just before the recorded day in percent of the far window (port of preDrop)."""
    nn, nm = table.range_mean(var, start + near[0], start + near[1])
    fn, fm = table.range_mean(var, start + far[0], start + far[1])
    ok = (
        nn >= min_near
        and fn >= min_far
        and fm is not None
        and nm is not None
        and fm >= min_far_mean
    )
    pct = 100 * (nm - fm) / fm if ok and nm is not None and fm is not None else None
    return {"near": nm, "far": fm, "pct": pct}


def days_to_recover(
    table: DayTable,
    var: str,
    end: int,
    ref: float | None,
    *,
    share_pct: float = RECOVERY_SHARE_PCT,
    max_days: int = RECOVERY_MAX_DAYS,
    run_days: int = RECOVERY_RUN_DAYS,
    min_run: int = RECOVERY_MIN_RUN,
    blocked_from: int | None = None,
) -> dict[str, Any]:
    """Days from `end` until the centred running mean reaches share_pct % of `ref` (port of daysToRecover).

    Censored (days = null) when the next disturbance starts first ("blocked"), the data end
    ("data-end") or day max_days comes first ("max-days"). Not censored and null without a positive
    reference ("no-reference").
    """
    if ref is None or not ref > 0:
        return {"days": None, "censored": False, "reason": "no-reference"}
    share = share_pct / 100
    half = run_days // 2
    for d in range(1, max_days + 1):
        if blocked_from is not None and d + half >= blocked_from:
            return {"days": None, "censored": True, "reason": "blocked"}
        n, m = table.range_mean(var, end + d - half, end + d + half)
        if n >= min_run and m is not None and m >= share * ref:
            return {"days": d, "censored": False, "reason": "recovered"}
        if table.range_mean(var, end + d, end + max_days + half)[0] == 0:
            return {"days": None, "censored": True, "reason": "data-end"}
    return {"days": None, "censored": True, "reason": "max-days"}


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


def nice_range(lo: float, hi: float, step: float = Y_STEP) -> list[float]:
    """[lo, hi] rounded outwards to a multiple of `step`, extended to hold 0 and 100."""
    a = math.floor(min(lo, 0) / step) * step
    b = math.ceil(max(hi, 100) / step) * step
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


@dataclass
class Data:
    names: dict[str, str]
    slots: dict[str, int]
    offsets: dict[str, int]
    site_ids: dict[str, int]
    events: list[Event]
    tables: dict[str, DayTable]
    years: dict[str, list[int]]
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
        "units checked in variables.parquet: %s; daily sums in %s",
        ", ".join(f"{k} [{v}]" for k, v in EXPECTED_UNITS.items()),
        DAILY_UNIT,
    )

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
    slots = {s: i for i, s in enumerate(ALL_SITES)}
    offsets = {
        str(c): int(o)
        for c, o in zip(sites["code"], sites["utc_offset_min"], strict=True)
    }
    site_ids = {
        str(c): int(i) for c, i in zip(sites["code"], sites["site_id"], strict=True)
    }
    steps["sites"] = {"rowsRead": len(sites), "panelSites": list(SITES)}

    # ----- events -----
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

    # ----- daily fluxes -----
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
    tables: dict[str, DayTable] = {}
    years: dict[str, list[int]] = {}
    per_site: dict[str, Any] = {}
    for site in SITES:
        d = frame(daily[col(daily, "site_code") == site])
        dd = col(d, "day").to_numpy()
        t = DayTable(int(dd.min()), int(dd.max()))
        for src, dst in (
            ("gpp_gc", "gpp"),
            ("reco_gc", "reco"),
            ("nee_f_gc", "nee"),
            ("frac_measured", "frac"),
        ):
            t.set(dst, dd, col(d, src).to_numpy(dtype=float))
        tables[site] = t
        years[site] = sorted({int(x.year) for x in col(d, "date_local")})
        per_site[site] = {
            "dailyRows": len(d),
            "firstDay": iso_day(int(dd.min())),
            "lastDay": iso_day(int(dd.max())),
            "daysWithGpp": int(col(d, "gpp_gc").notna().sum()),
            "daysWithNee": int(col(d, "nee_f_gc").notna().sum()),
            "daysLowFrac": int((col(d, "frac_measured") < MIN_FRAC).sum()),
        }
        log.info(
            "%s: %d daily rows %s to %s, %d days with GPP, %d days with NEE, %d days with a "
            "measured fraction < %.2f",
            site,
            len(d),
            per_site[site]["firstDay"],
            per_site[site]["lastDay"],
            per_site[site]["daysWithGpp"],
            per_site[site]["daysWithNee"],
            per_site[site]["daysLowFrac"],
            MIN_FRAC,
        )
    steps["daily"] = {
        "rowsRead": n_daily,
        "rowsPanelSites": len(daily),
        "rowsDropped": n_daily - len(daily),
        "perSite": per_site,
        "rule": "daily rows of the four panel sites; no row is removed, a missing value is a gap",
    }
    return Data(names, slots, offsets, site_ids, events, tables, years, steps)


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
) -> str:
    """ "used" or the reason of the exclusion (text of the table, as Deep Dive #4)."""
    if exclusion is None:
        return "used"
    if exclusion == "overlap":
        return f"excluded: {overlap_text} in the windows"
    if exclusion == "too-few-days":
        return (
            f"excluded: fewer than {MIN_DAYS} days with flux data in a window "
            f"(before {before.n['gpp']}, after {after.n['gpp']})"
        )
    return f"excluded: measured fraction of NEE below {round(MIN_FRAC * 100)} % in a window"


def flux_exclusion(
    before: WindowMeans, after: WindowMeans, n_overlap: int
) -> str | None:
    """Reason why an episode is not used, in the order overlap, too-few-days, low-measured-fraction."""
    if n_overlap:
        return "overlap"
    if not all(before.n[f] >= MIN_DAYS and after.n[f] >= MIN_DAYS for f in FLUX_VARS):
        return "too-few-days"
    if (before.mean["frac"] or 0) < MIN_FRAC or (after.mean["frac"] or 0) < MIN_FRAC:
        return "low-measured-fraction"
    return None


def episode_result(data: Data, ctx: Context, ep: HarvestEpisode) -> dict[str, Any]:
    """All numbers of one silage harvest episode (the rules of Deep Dive #4)."""
    site = ep.site
    t = data.tables[site]
    before = window_means(t, ep.start, BEFORE, MEAN_VARS)
    after = window_means(t, ep.end, AFTER, MEAN_VARS)
    delta = changes(after, before, FLUX_VARS)
    late_free = not ctx.other_harvest(
        ep, ep.end + LATE[0], ep.end + LATE[1]
    ) and not ctx.blocking(ep, ep.end + LATE[0], ep.end + LATE[1])
    late = window_means(t, ep.end, LATE, MEAN_VARS) if late_free else None
    delta_late = changes(late, before, FLUX_VARS) if late is not None else None
    gpp_b = before.mean["gpp"]
    ok_b = gpp_b is not None and gpp_b >= MIN_GPP_BEFORE
    rel_pct: dict[str, float | None] = {}
    for v in FLUX_VARS:
        dv = delta[v]
        rel_pct[v] = 100 * dv / gpp_b if ok_b and dv is not None and gpp_b else None

    # Rules.
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

    # Recovery.
    nxt = ctx.next_disturbance_days(ep)
    rec_blocked = nxt is not None and nxt <= RECOVERY[1]
    rec = window_means(t, ep.end, RECOVERY, ["gpp"])
    rec_mean = rec.mean["gpp"]
    share = (
        100 * rec_mean / gpp_b
        if not rec_blocked
        and ok_b
        and gpp_b
        and rec.n["gpp"] >= MIN_DAYS
        and rec_mean is not None
        else None
    )
    dtr = days_to_recover(t, "gpp", ep.end, gpp_b if ok_b else None, blocked_from=nxt)

    # Timing (change point).
    search_lo, search_hi = ep.start + SEARCH_FROM, ep.end + SEARCH_TO
    span_lo, span_hi = search_lo - SIDE_DAYS, search_hi + SIDE_DAYS - 1
    t_oh = ctx.other_harvest(ep, span_lo, span_hi)
    t_ob = ctx.blocking(ep, span_lo, span_hi)
    timing_exclusion: str | None = None
    if t_oh or t_ob:
        timing_exclusion = "overlap: " + ", ".join(
            [f"harvest or cut {iso_day(o.start)}" for o in t_oh]
            + [f"{e.type} {iso_day(e.date)}" for e in t_ob]
        )
    drop = detect_drop(t, "gpp", search_lo, search_hi, anchor=ep.recorded)
    if timing_exclusion is None and drop.reason == "too-few-days":
        timing_exclusion = (
            f"fewer than {MIN_SIDE_GPP} of {SIDE_DAYS} days with GPP on each side of "
            "every candidate day"
        )
    pre = pre_drop(t, "gpp", ep.recorded)

    crop_order = [c for c in dict.fromkeys(e.crop for e in ep.events) if c is not None]
    per_event = [
        e.dry_mass_kg_ha
        for e in ep.events
        if e.dry_mass_kg_ha is not None and yield_per_event(e.detail)
    ]
    year_yield = [
        e.dry_mass_kg_ha
        for e in ep.events
        if e.dry_mass_kg_ha is not None and not yield_per_event(e.detail)
    ]
    flags = EPISODE_NOTES.get(
        ep.id, {"establishmentYear": False, "partialHarvest": False, "note": None}
    )
    return {
        "id": ep.id,
        "site": site,
        "year": int(iso_day(ep.start)[:4]),
        "cutNo": ctx.cut_number(ep),
        "start": iso_day(ep.start),
        "end": iso_day(ep.end),
        "recorded": iso_day(ep.recorded),
        "durationDays": ep.end - ep.start + 1,
        "events": [e.json() | {"group": e.group} for e in ep.events],
        "coEvents": [
            {"date": iso_day(e.date), "type": e.type, "detail": e.detail}
            for e in ep.co_events
        ],
        "crop": ", ".join(crop_order) if crop_order else None,
        "detailShort": short_text("; ".join(e.detail for e in ep.events if e.detail)),
        "yieldKgHa": sum(per_event) if per_event else None,
        "yearYieldKgHa": year_yield[0] if year_yield else None,
        "overrides": list(ep.overrides),
        "otherEvents": other_events,
        "fertInWindow": fert_in_window,
        "before": before.json(),
        "after": after.json(),
        "late": None if late is None else late.json(),
        "delta": delta,
        "deltaLate": delta_late,
        "relPct": rel_pct,
        "used": exclusion is None,
        "exclusion": exclusion,
        "fluxUse": flux_use_text(exclusion, overlap_text, before, after),
        "recovery": {
            "sharePct": share,
            "days": dtr["days"],
            "censored": dtr["censored"],
            "reason": dtr["reason"],
            "nextDisturbanceDays": nxt,
        },
        "timing": {
            "used": timing_exclusion is None,
            "exclusion": timing_exclusion,
            "gpp": drop.json(),
            "preDrop": pre,
        },
        "flags": dict(flags),
    }


def span_mean(
    offsets: Sequence[int], means: Sequence[float | None], w: tuple[int, int]
) -> float | None:
    """Mean of the daily composite means over the offsets w[0] .. w[1] (days with a mean)."""
    vals = [
        m
        for off, m in zip(offsets, means, strict=True)
        if w[0] <= off <= w[1] and m is not None
    ]
    return float(np.mean(vals)) if vals else None


def composite(data: Data, eps: Sequence[dict[str, Any]], key: str) -> dict[str, Any]:
    """Mean, sample SD and n per offset of GPP, TER and NEE in percent of the GPP before."""
    offsets = list(range(COMPOSITE[0], COMPOSITE[1] + 1))
    out: dict[str, Any] = {"episodes": len(eps), "ids": [e["id"] for e in eps]}
    for v in FLUX_VARS:
        means: list[float | None] = []
        sds: list[float | None] = []
        ns: list[int] = []
        for off in offsets:
            xs: list[float] = []
            for e in eps:
                start, end = day_number(e["start"]), day_number(e["end"])
                nxt = e["recovery"]["nextDisturbanceDays"]
                if nxt is not None and start + off >= end + nxt:
                    continue
                x = data.tables[e["site"]].get(v, start + off)
                ref = e["before"]["mean"]["gpp"]
                if math.isnan(x) or ref is None or ref < MIN_GPP_BEFORE:
                    continue
                xs.append(100 * x / ref)
            a = np.array(xs, dtype=float)
            n = len(a)
            ns.append(n)
            means.append(float(a.mean()) if n >= COMPOSITE_MIN_N else None)
            sds.append(float(a.std(ddof=1)) if n >= COMPOSITE_MIN_N else None)

        out[v] = {
            "mean": means,
            "sd": sds,
            "n": ns,
            "meanDays1to14": span_mean(offsets, means, COMPOSITE_EARLY),
            "meanDays15to28": span_mean(offsets, means, COMPOSITE_LATE),
            "minN": min(ns),
            "maxN": max(ns),
        }
    log.info(
        "composite %s: %d episodes, n per day %d to %d",
        key,
        len(eps),
        min(out["gpp"]["n"]),
        max(out["gpp"]["n"]),
    )
    return out


def y_range(composites: Iterable[dict[str, Any]]) -> list[float]:
    """One nice range over all mean +- SD of all panels (the same in both figures)."""
    lo, hi = math.inf, -math.inf
    for c in composites:
        for v in FLUX_VARS:
            for m, s in zip(c[v]["mean"], c[v]["sd"], strict=True):
                if m is None or s is None:
                    continue
                lo, hi = min(lo, m - s), max(hi, m + s)
    if not math.isfinite(lo):
        lo, hi = 0.0, 100.0
    return nice_range(lo, hi)


def summary_block(
    eps: Sequence[dict[str, Any]], site_index: int, label: str
) -> dict[str, Any]:
    """Summaries of the used episodes of one site (or all): changes, recovery, timing."""

    def seed(q: str) -> int:
        return SEED_BASE + 100 * SUMMARY_QUANTITIES.index(q) + site_index

    timing_used = [e for e in eps if e["timing"]["used"]]
    clear = [e for e in timing_used if e["timing"]["gpp"]["clear"]]
    offs = [int(e["timing"]["gpp"]["offset"]) for e in clear]

    def pick(q: str, f: Callable[[dict[str, Any]], float | None]) -> dict[str, Any]:
        return summarise([f(e) for e in eps], seed(q), f"{label}.{q}")

    censored = [e for e in eps if e["recovery"]["censored"]]
    return {
        "n": len(eps),
        "ids": [e["id"] for e in eps],
        "deltaGpp": pick("deltaGpp", lambda e: e["delta"]["gpp"]),
        "deltaReco": pick("deltaReco", lambda e: e["delta"]["reco"]),
        "deltaNee": pick("deltaNee", lambda e: e["delta"]["nee"]),
        "relGpp": pick("relGpp", lambda e: e["relPct"]["gpp"]),
        "relReco": pick("relReco", lambda e: e["relPct"]["reco"]),
        "relNee": pick("relNee", lambda e: e["relPct"]["nee"]),
        "gppBefore": float(np.mean([e["before"]["mean"]["gpp"] for e in eps]))
        if eps
        else None,
        "recoveryShare": pick("recoveryShare", lambda e: e["recovery"]["sharePct"]),
        "daysToRecover": pick("daysToRecover", lambda e: e["recovery"]["days"]),
        "nRecovered": sum(1 for e in eps if e["recovery"]["days"] is not None),
        "nCensored": len(censored),
        "censored": {
            r: sum(1 for e in censored if e["recovery"]["reason"] == r)
            for r in CENSOR_REASONS
        },
        "nNoReference": sum(
            1 for e in eps if e["recovery"]["reason"] == "no-reference"
        ),
        "gppOffset": summarise(offs, seed("gppOffset"), f"{label}.gppOffset"),
        "timingUsed": len(timing_used),
        "clearDrops": len(clear),
        "notClear": {
            r: sum(1 for e in timing_used if e["timing"]["gpp"]["reason"] == r)
            for r in ("flux-too-small", "drop-too-small")
        },
        "nBefore": sum(1 for o in offs if o < 0),
        "nOn": sum(1 for o in offs if o == 0),
        "nAfter": sum(1 for o in offs if o > 0),
        "shareBeforePct": 100 * sum(1 for o in offs if o < 0) / len(offs)
        if offs
        else None,
        "preDropPct": pick("preDropPct", lambda e: e["timing"]["preDrop"]["pct"]),
        "fertInWindow": sum(1 for e in eps if e["fertInWindow"]),
    }


def analyse(data: Data) -> dict[str, Any]:
    all_eps = merge_harvest_episodes(data.events, OVERRIDES)
    ctx = Context(all_eps, data.events)
    per_group = {g: sum(1 for e in all_eps if e.group == g) for g in HARVEST_GROUPS}
    silage = [e for e in all_eps if e.group == "silageHarvest"]
    not_panel = [e.id for e in silage if e.site not in SITES]
    if not_panel:
        raise RuntimeError(f"silage harvest episodes outside SITES: {not_panel}")
    log.info(
        "episodes: %d harvest or cut episodes (%s); %d silage harvest episodes",
        len(all_eps),
        ", ".join(f"{g} {n}" for g, n in per_group.items()),
        len(silage),
    )

    episodes = [episode_result(data, ctx, ep) for ep in silage]
    used = [e for e in episodes if e["used"]]
    excluded = {x: sum(1 for e in episodes if e["exclusion"] == x) for x in EXCLUSIONS}
    for e in episodes:
        if not e["used"]:
            log.info("episode %s: %s", e["id"], e["fluxUse"])
    log.info(
        "episodes: %d used, %d excluded (%s)",
        len(used),
        len(episodes) - len(used),
        ", ".join(f"{k} {v}" for k, v in excluded.items()),
    )
    data.steps["episodes"] = {
        "harvestCutEpisodes": len(all_eps),
        "perGroup": per_group,
        "silageEpisodes": len(episodes),
        "used": len(used),
        "excluded": excluded,
        "overridesApplied": sum(len(e.overrides) for e in all_eps),
        "rule": "silage harvest episodes; used when no overlap, 12 or more days per window and "
        "measured fraction 0.10 or more",
    }

    per_site_comp = {
        s: composite(data, [e for e in used if e["site"] == s], s) for s in SITES
    }
    all_comp = composite(data, used, "all")
    yr = y_range([*per_site_comp.values(), all_comp])
    log.info("y range of the figures: %s %%", yr)

    summary = {
        "perSite": {
            s: summary_block([e for e in used if e["site"] == s], i, s)
            for i, s in enumerate(SITES)
        },
        "all": summary_block(used, len(SITES), "all"),
    }
    a = summary["all"]
    summary["extra"] = {
        "clearDrops": a["clearDrops"],
        "timingUsed": a["timingUsed"],
        "nBefore": a["nBefore"],
        "nOn": a["nOn"],
        "nAfter": a["nAfter"],
        "censored": a["censored"],
        "nRecovered": a["nRecovered"],
        "nCensored": a["nCensored"],
        "offsetMedian": a["gppOffset"]["median"],
    }

    sites_json = [
        {
            "code": s,
            "name": data.names[s],
            "siteId": data.site_ids[s],
            "slot": data.slots[s],
            "utcOffsetMin": data.offsets[s],
            "dataYears": data.years[s],
            "episodeYears": sorted({e["year"] for e in episodes if e["site"] == s}),
            "episodes": sum(1 for e in episodes if e["site"] == s),
            "used": sum(1 for e in used if e["site"] == s),
            "usedIds": [e["id"] for e in used if e["site"] == s],
        }
        for s in SITES
    ]
    counts = {
        "events": len(data.events),
        "harvestCutEpisodes": len(all_eps),
        "perGroup": per_group,
        "silageEpisodes": len(episodes),
        "used": len(used),
        "excluded": excluded,
        "overrides": len(OVERRIDES),
        "perSite": {
            s: {
                "episodes": sum(1 for e in episodes if e["site"] == s),
                "used": sum(1 for e in used if e["site"] == s),
            }
            for s in SITES
        },
        "timingUsed": a["timingUsed"],
        "clearDrops": a["clearDrops"],
    }
    return {
        "counts": counts,
        "sites": sites_json,
        "episodes": episodes,
        "composite": {
            "offsets": list(range(COMPOSITE[0], COMPOSITE[1] + 1)),
            "yRange": yr,
            "perSite": per_site_comp,
            "all": all_comp,
        },
        "summary": summary,
    }


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


def fmt_sd(stat: dict[str, Any]) -> str:
    """Per-episode statistic for the alt text: mean % (SD, n) of a summary block."""
    return f"{fmt(stat['mean'], 0)} % (SD {fmt(stat['sd'], 0)}, n {stat['n']})"


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
    with warnings.catch_warnings():
        # Only the missing-glyph warnings of the site emojis (see EMOJI_GLYPH_WARNING).
        warnings.filterwarnings(
            "ignore", message=EMOJI_GLYPH_WARNING, category=UserWarning
        )
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


def arr(values: Sequence[float | None]) -> np.ndarray:
    return np.array([np.nan if q is None else q for q in values], dtype=float)


def draw_panel(
    ax: Any,
    comp: dict[str, Any],
    offsets: np.ndarray,
    yr: Sequence[float],
    y_step: float = Y_STEP,
) -> None:
    """Three curves with bands, the harvest line, the 100 %, 80 % and 0 lines, the axis ranges."""
    ax.axvline(0, color=HARVEST_LINE, lw=1.2, alpha=0.5, zorder=1)
    ax.axhline(100, color=INK, lw=0.6, zorder=1)
    ax.axhline(0, color=INK, lw=0.6, zorder=1)
    ax.axhline(RECOVERY_SHARE_PCT, color=GREY, lw=0.8, ls=(0, (1, 2)), zorder=1)
    for v in FLUX_VARS:
        m, s = arr(comp[v]["mean"]), arr(comp[v]["sd"])
        ax.fill_between(
            offsets, m - s, m + s, color=COLORS[v], alpha=BAND_ALPHA, lw=0, zorder=2
        )
        ax.plot(
            offsets,
            m,
            color=COLORS[v],
            lw=LINE_WIDTH,
            marker=MARKERS[v],
            ms=MARKER_SIZE,
            markevery=MARK_EVERY,
            zorder=3 if v != "nee" else 4,
            solid_capstyle="round",
            **line_kw(DASHES[v]),
        )
    ax.set_xlim(COMPOSITE[0] - 0.5, COMPOSITE[1] + 0.5)
    ax.set_ylim(yr[0], yr[1])
    # Ticks on the multiples of y_step inside the range (the range itself is a multiple of 25).
    first_tick = math.ceil(yr[0] / y_step) * y_step
    ax.set_yticks(np.arange(first_tick, yr[1] + 1, y_step))


def legend_handles() -> list[Any]:
    return [
        Line2D(
            [],
            [],
            color=COLORS[v],
            lw=LINE_WIDTH,
            marker=MARKERS[v],
            ms=MARKER_SIZE,
            label=LEGEND_LABELS[v],
            **line_kw(DASHES[v]),
        )
        for v in FLUX_VARS
    ]


def panel_desc(name: str, comp: dict[str, Any], block: dict[str, Any]) -> str:
    """Two sentences per panel: the per-episode changes (mean, SD, n, as the tables) and the
    means of the composite curve in two spans."""
    return (
        f"{name} (n = {comp['episodes']}; {comp['gpp']['minN']} to {comp['gpp']['maxN']} "
        "episodes per day): change of days +1 to +14 against days −14 to −1 per episode, in "
        f"percent of the GPP before: ΔGPP {fmt_sd(block['relGpp'])}, ΔTER {fmt_sd(block['relReco'])}, "
        f"ΔNEE {fmt_sd(block['relNee'])}. Mean of the curve over days +1 to +14: GPP "
        f"{fmt(comp['gpp']['meanDays1to14'], 0)} %, TER {fmt(comp['reco']['meanDays1to14'], 0)} %, "
        f"NEE {fmt(comp['nee']['meanDays1to14'], 0)} %; days +15 to +28: GPP "
        f"{fmt(comp['gpp']['meanDays15to28'], 0)} %, TER {fmt(comp['reco']['meanDays15to28'], 0)} %, "
        f"NEE {fmt(comp['nee']['meanDays15to28'], 0)} %."
    )


def common_desc(yr: Sequence[float]) -> str:
    return (
        f"X axis: days from the first day of the harvest ({fmt(COMPOSITE[0], 0)} to "
        f"+{COMPOSITE[1]}, local days, UTC+{UTC_SHIFT_HOURS}). Y axis: GPP, TER and NEE in percent "
        f"of the mean GPP of the days {fmt(BEFORE[0], 0)} to {fmt(BEFORE[1], 0)} before the "
        f"harvest, from {fmt(yr[0], 0)} to "
        f"{fmt(yr[1], 0)} % (NEE in percent of the GPP before: NEE < 0 = uptake, NEE % = TER % − "
        "GPP %). Lines: GPP light blue solid with circles, TER light pink dashed with squares, NEE "
        "steel blue dash-dotted with triangles; markers every 7 days. The band around each line is "
        f"the mean ± 1 SD over the episodes; line and band are drawn only where {COMPOSITE_MIN_N} or "
        "more episodes have a value. An orange vertical line marks day 0 (the first day of the "
        f"harvest), thin lines mark 100 % and 0, a dotted grey line marks {RECOVERY_SHARE_PCT} % "
        "(the recovery level)."
    )


def fig_per_site(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    comp = res["composite"]
    offsets = np.array(comp["offsets"], dtype=float)
    yr = comp["yRange"]
    fig, axes = plt.subplots(
        1, len(SITES), figsize=(FIG1_WIDTH_IN, FIG1_HEIGHT_IN), sharey=True
    )
    for ax, site in zip(axes, SITES, strict=True):
        c = comp["perSite"][site]
        draw_panel(ax, c, offsets, yr, FIG1_Y_TICK_STEP)
        # The site name as the title and n on a line below it: "Qvidja (n = 10)" does not fit
        # into a panel of about 32 mm.
        # The site emoji and the plain name; the <title>, <desc> and the tables keep the plain name.
        ax.set_title(f"{SITE_EMOJI[site]} {data.names[site]}", loc="left", pad=18)
        ax.text(
            0,
            1.02,
            f"n = {c['episodes']}",
            transform=ax.transAxes,
            ha="left",
            va="bottom",
            fontsize=plt.rcParams["legend.fontsize"],
        )
        ax.set_xticks([-14, 0, 14, 28])
        ax.tick_params(axis="both", length=3, pad=2)
    axes[0].set_ylabel(Y_LABEL_LINES)
    fig.supxlabel(X_LABEL, fontsize=plt.rcParams["axes.labelsize"], y=0.03)
    fig.legend(
        handles=legend_handles(),
        loc="upper center",
        bbox_to_anchor=(0.55, 1.0),
        ncol=3,
        frameon=False,
        handlelength=3.2,
        columnspacing=2.0,
    )
    fig.subplots_adjust(left=0.125, right=0.99, top=0.76, bottom=0.2, wspace=0.3)
    names = ", ".join(
        f"{data.names[s]} (n = {comp['perSite'][s]['episodes']})" for s in SITES[:-1]
    )
    last = SITES[-1]
    title = (
        "Daily GPP, TER and NEE from 14 days before to 28 days after a silage harvest at "
        f"{names} and {data.names[last]} (n = {comp['perSite'][last]['episodes']}), in percent of "
        "the mean GPP of the 14 days before the harvest; mean and ± 1 SD over the episodes."
    )
    parts = [
        f"Four panels side by side, one per site, with the same axes. {common_desc(yr)}"
    ]
    parts += [
        panel_desc(data.names[s], comp["perSite"][s], res["summary"]["perSite"][s])
        for s in SITES
    ]
    return fig, title, " ".join(parts)


def fig_all_sites(res: dict[str, Any]) -> tuple[Any, str, str]:
    comp = res["composite"]
    offsets = np.array(comp["offsets"], dtype=float)
    yr = comp["yRange"]
    c = comp["all"]
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, FIG2_HEIGHT_IN))
    draw_panel(ax, c, offsets, yr)
    ax.set_title(f"All sites (n = {c['episodes']})", loc="left")
    ax.set_xticks(range(COMPOSITE[0], COMPOSITE[1] + 1, 7))
    ax.set_xlabel(X_LABEL)
    ax.set_ylabel(Y_LABEL_LINES)
    ax.legend(
        handles=legend_handles(),
        loc="upper right",
        frameon=False,
        handlelength=3.2,
    )
    fig.subplots_adjust(left=0.13, right=0.99, top=0.92, bottom=0.14)
    title = (
        f"Daily GPP, TER and NEE from 14 days before to 28 days after a silage harvest, all {c['episodes']} "
        "used episodes of the four sites together, in percent of the mean GPP of the 14 days "
        "before the harvest; mean and ± 1 SD over the episodes."
    )
    desc = f"One panel. {common_desc(yr)} {panel_desc('All sites', c, res['summary']['all'])}"
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
        "episodeSites": list(EPISODE_SITES),
        "groups": [{"id": g, "label": HARVEST_GROUP_LABELS[g]} for g in HARVEST_GROUPS],
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
        "minGppBefore": MIN_GPP_BEFORE,
        "exclusionOrder": list(EXCLUSIONS),
        "recoveryDays": list(RECOVERY),
        "recoverySharePct": RECOVERY_SHARE_PCT,
        "recoveryMaxDays": RECOVERY_MAX_DAYS,
        "recoveryRunDays": RECOVERY_RUN_DAYS,
        "recoveryMinRun": RECOVERY_MIN_RUN,
        "censorReasons": list(CENSOR_REASONS),
        "searchFrom": SEARCH_FROM,
        "searchTo": SEARCH_TO,
        "sideDays": SIDE_DAYS,
        "minSideGpp": MIN_SIDE_GPP,
        "minBeforeGpp": MIN_BEFORE_GPP,
        "minDropPct": MIN_DROP_PCT,
        "spanOverlapFrom": SEARCH_FROM - SIDE_DAYS,
        "spanOverlapTo": SEARCH_TO + SIDE_DAYS - 1,
        "preNear": list(PRE_NEAR),
        "preFar": list(PRE_FAR),
        "preMinNear": PRE_MIN_NEAR,
        "preMinFar": PRE_MIN_FAR,
        "compositeFrom": COMPOSITE[0],
        "compositeTo": COMPOSITE[1],
        "compositeMinN": COMPOSITE_MIN_N,
        "compositeEarly": list(COMPOSITE_EARLY),
        "compositeLate": list(COMPOSITE_LATE),
        "yStep": Y_STEP,
        "cutNoRule": "ordinal of the episode among the harvest and cut episodes of the site in that year",
        "bootstrapResamples": BOOTSTRAP_RESAMPLES,
        "bootstrapLevel": BOOTSTRAP_LEVEL,
        "ciLevelPct": round(BOOTSTRAP_LEVEL * 100),
        "utcShiftHours": UTC_SHIFT_HOURS,
        "nSites": len(SITES),
        "units": {
            "daily": DAILY_UNIT,
            "yield": "kg DW/ha",
            "relative": "% of the mean GPP before",
            "offsets": "days",
        },
        "fluxLabels": FLUX_LABELS,
        "axisNames": {"x": X_LABEL, "y": Y_LABEL},
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
        if name == "per-site":
            fig, title, desc = fig_per_site(res, data)
        else:
            fig, title, desc = fig_all_sites(res)
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
                "start": e["start"],
                "end": e["end"],
                "recorded": e["recorded"],
                "used": e["used"],
                "exclusion": e["exclusion"],
                "gppBefore": e["before"]["mean"]["gpp"],
                "dGpp": e["delta"]["gpp"],
                "dReco": e["delta"]["reco"],
                "dNee": e["delta"]["nee"],
                "relGpp": e["relPct"]["gpp"],
                "relReco": e["relPct"]["reco"],
                "relNee": e["relPct"]["nee"],
                "recoveryShare": e["recovery"]["sharePct"],
                "daysToRecover": e["recovery"]["days"],
                "recoveryReason": e["recovery"]["reason"],
                "offset": e["timing"]["gpp"]["offset"],
                "clear": e["timing"]["gpp"]["clear"],
                "preDropPct": e["timing"]["preDrop"]["pct"],
            }
            for e in res["episodes"]
        ]
    ).to_csv(out_dir / "output" / "episodes.csv", index=False, float_format="%.10g")

    dv = data_version(args, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": (
            "How do daily GPP, TER (= Reco) and NEE of a grassland develop from 14 days before to "
            "28 days after a silage harvest, per site and over all sites?"
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
