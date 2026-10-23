# /// script
# requires-python = "==3.13.*"
# dependencies = [
#     "matplotlib==3.11.2",
#     "numpy==2.5.4",
#     "pandas==3.1.0",
#     "pandera==0.34.1",
#     "pyarrow==26.0.0",
#     "scipy==1.18.1",
# ]
# ///
"""Fertilisation or weather: GPP change after a fertilisation.

QUESTION
    Does GPP change more after a fertilisation than the weather of the same days explains?

METHOD
    Sites: Anttila, Sarkisuo, Haltiala, Qvidja and Viikki (the five Finnish sites).
    1. Management events of db/events.parquet get a class: harvest and cut = harvest-cut;
       grazing, fertilisation and tillage keep their name; other types get no class. A
       fertilisation is "mineral" when its detail text names a mineral product, else "organic".
    2. Events of one site that start not more than 7 days after the end of the current episode
       join that episode. A fertilisation episode is an episode with a fertilisation event.
    3. Daily values per local day: GPP, Reco, NEE (g C m-2 d-1), the measured fraction of NEE and
       the mean air temperature come from data/calculated/daily.parquet. Soil water content,
       soil temperature, rain and the daily light sum come from db/observations.parquet
       (local day = ts_start + utc_offset_min). Haltiala has no rain gauge: it uses the Viikki rain.
    4. Before window = days -14 to -1 before the episode start. After window = days +1 to +14
       after the episode end. Change = mean after - mean before; it needs 12 days with a value on
       each side. The light change is in percent of the light before.
    5. Flux rules: no other episode of the site starts in the windows (overlap), 12 flux days on
       each side, and a mean measured fraction of NEE of 0.1 or more on each side.
    6. Control pairs: windows of the same size at anchor days within +-21 days of the day of year
       of each fertilisation of the site, in all years with data. A pair is not used when a day of
       its windows is within 14 days of a management event of the site.
    7. Per site, an OLS fit of the control pairs gives the GPP change that the weather gives:
       dGPP = c0 + c1 * dTa + c2 * dLight%. Expected = the fit at the weather change of the
       episode. Residual = observed - expected. The rank of the residual among the control
       residuals of the site (percent of the control values below) shows how unusual it is.
    8. Checks: controls with nearly the same weather change (|dTa| difference <= 1 degC, light
       difference <= 10 percentage points), light-normalised GPP, a fit with soil water, a fit
       with +-10-day anchors, and a pooled fit of the relative GPP change.
    9. Summaries: episodes with a used flux, no harvest or cut in the episode, and a residual.
       Bootstrap 95 % CI of the mean (10 000 resamples, percentile method, fixed seeds).
    This is a port of part C of scripts/deep-dives/disturbance-detail.ts (git commit 44ec98f).

DATABASE
    builtAt: 2026-10-23T19:03:07.928Z (db/report.json and Parquet key/value metadata built_at)
    calcBuiltAt: 2026-10-23T19:03:09.003Z (data/calculated/report.json and Parquet built_at)
    commit: 44ec98f (HEAD at build time; db/report.json does not record a commit)
    url: TODO: release asset db-2026-10-23.zip not yet published

INPUTS
    db/events.parquet  sha256=b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b  rows=114  columns=site_code, date, date_end, type, detail, n_kg_ha
    db/sites.parquet  sha256=9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59  rows=6  columns=site_id, code, name, utc_offset_min
    db/observations.parquet  sha256=922346b5afe2ec56de128311aa3d8dc8cd0ccc1a57700bd333bbdf95a51d8964  rows=537980  columns=site_id, ts_start, ppfd, sw_in, precip, swc, tsoil
    db/variables.parquet  sha256=06e6a41c727958beb973f2b76adb8182d88b0a5d501be6f11c948c0129fb7c6e  rows=26  columns=column_name, unit
    calculated/daily.parquet  sha256=fcae1d28c3761bd8b9da5f8aa3c821435254018a9959cba2598b13cb038bded9  rows=11209  columns=site_code, date_local, gpp_gc, reco_gc, nee_f_gc, frac_measured, ta_mean

OUTPUTS
    results.json                         all result numbers, figure captions and alt texts, dataVersion
                                         (generatedAt, git, dbBuiltAt, calcBuiltAt, snapshot, inputs, ...)
    manifest.json                        provenance of the run and SHA-256 of the outputs
    figures/1-gpp-change-vs-temperature.svg
    figures/2-residuals.svg
    figures/3-gpp-course.svg
    output/run.log                       run log (not in git)
    output/pairs.csv                     control pairs of all sites (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/fertilisation-weather/fertilisation-weather.py --db db --calculated data/calculated

NOTES
    scipy is used only for the two-sided p-value of a Pearson r (scipy.special.betainc).
    The database Parquet files have no column of air temperature per day; the daily mean air
    temperature comes from data/calculated/daily.parquet (ta_mean), as in the TypeScript dive.
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

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pandera.pandas as pa
import pyarrow.parquet as pq
from matplotlib.lines import Line2D
from scipy.special import betainc

SLUG = "fertilisation-weather"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"

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
        ("site_code", "date", "date_end", "type", "detail", "n_kg_ha"),
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
        ("site_id", "ts_start", "ppfd", "sw_in", "precip", "swc", "tsoil"),
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
    "ppfd": "µmol m-2 s-1",
    "sw_in": "W m-2",
    "precip": "mm",
    "swc": "m3 m-3",
    "tsoil": "°C",
    "ts_start": "UTC",
}

# ---------- Method constants (from scripts/deep-dives/disturbance-detail.ts) ----------
SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki")
LIGHT_VAR = {
    "anttila": "ppfd",
    "sarkisuo": "ppfd",
    "haltiala": "ppfd",
    "qvidja": "sw_in",
    "viikki": "ppfd",
}
LIGHT_UNIT = {"ppfd": "mol m-2 d-1", "sw_in": "MJ m-2 d-1"}
MIN_LIGHT_FOR_LUE = {"ppfd": 1.0, "sw_in": 0.5}
RAIN_SOURCE = {
    "anttila": "own",
    "sarkisuo": "own",
    "haltiala": "viikki-proxy",
    "qvidja": "own",
    "viikki": "own",
}
BEFORE = (-14, -1)
AFTER = (1, 14)
AFTER_DAYS = AFTER[1] - AFTER[0] + 1
MIN_DAYS = 12
MIN_FRAC = 0.1
MIN_GPP_BEFORE = 0.5
MERGE_DAYS = 7
MIN_SWC_ROWS = 36
MIN_RAIN_ROWS = 44
MIN_LIGHT_ROWS = 44
CONTROL_HALF_WIDTH = 21
CONTROL_HALF_WIDTH_SENS = 10
MASK_BEFORE = 14
MASK_AFTER = 14
TOL_TA = 1.0
TOL_LIGHT_PCT = 10.0
MIN_MATCHED = 3
COLLINEAR_R = 0.7
MIN_CONTROL_YEARS = 3
RANK_HIGH = 90.0
RANK_LOW = 10.0
BOOTSTRAP_RESAMPLES = 10_000
HALF_HOURS_PER_DAY = 48
# Open findings ANT-01, SAR-01, VII-01: the stamps of Anttila, Sarkisuo and Viikki are 2 hours early.
UTC_SHIFT_HOURS = 2
BOOTSTRAP_LEVEL = 0.95
COURSE_DAYS = (-14, 14)
COURSE_MIN_EPISODES = 2
COURSE_LATE = (10, 14)
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-9

MINERAL_RE = re.compile(
    r"\bmineral\b|\bsynthetic\b|saltpetre|salpietari|\bAXAN\b|\bTyppi\b|\bCAN\b",
    re.IGNORECASE,
)
KINDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("harvestCut", ("harvest-cut",)),
    ("harvestCutFert", ("fertilisation", "harvest-cut")),
    ("grazing", ("grazing",)),
    ("fertilisation", ("fertilisation",)),
    ("tillage", ("tillage",)),
    ("tillageFert", ("fertilisation", "tillage")),
)
HIGHLIGHTS = (
    "viikki-2022-05-10",
    "anttila-2022-05-23",
    "haltiala-2023-08-01",
    "qvidja-2019-05-08",
    "qvidja-2020-07-27",
    "qvidja-2021-05-12",
)
SPLITS = ("all", "fertOnly", "withTillage", "mineral", "organic")
SUMMARY_STATS = (
    "observed",
    "expected",
    "residual",
    "residualRank",
    "relGppPct",
    "reco",
    "nee",
    "ta",
    "lightPct",
    "rain",
    "swc",
    "matchedDiff",
    "lightNormPct",
    "residualSwc",
    "residual10",
    "pooledResidualPct",
)
# Seeds: the same numbers as the TypeScript dive (7000 + 20 * (split + 1) + statistic; controls
# 6000/6100/6200 + site position). The random generator is numpy PCG64, thus the CIs differ from
# the TypeScript CIs in the last digits.
SEED_SUMMARY_BASE = 7000
SEED_CONTROL = {"dGpp": 6000, "dTa": 6100, "dLightPct": 6200}

# Reference values from articles. Each row: value, unit, uncertainty, reference id, page, table or figure.
LITERATURE: tuple[dict[str, Any], ...] = (
    {
        "key": "windowDays",
        "text": "Mean fluxes 5 days before and after the management dates",
        "value": 5,
        "unit": "d",
        "uncertainty": None,
        "ref": "heimsch2021",
        "page": "PDF p. 7 (journal p. 3473), Sect. 3.2",
        "tableFigure": "Table C1",
    },
    {
        "key": "parLowerPct",
        "text": "Mean PAR after the fertilisations of July 2018, August 2018 and May 2019 was lower than the 5-day mean before",
        "value": [7, 29, 12],
        "unit": "%",
        "uncertainty": None,
        "ref": "heimsch2021",
        "page": "PDF p. 7 (journal p. 3473), Sect. 3.2",
        "tableFigure": None,
    },
    {
        "key": "rainWithinDays",
        "text": "Rain fell within 5 days after each fertilisation",
        "value": 5,
        "unit": "d",
        "uncertainty": None,
        "ref": "heimsch2021",
        "page": "PDF p. 7 (journal p. 3473), Sect. 3.2",
        "tableFigure": "Fig. 4, Table C1",
    },
    {
        "key": "organicNeeIncrease",
        "text": "The first and second organic fertilisations of 2018 increased NEE (smaller CO2 sink)",
        "value": [0.27, 0.08],
        "unit": "mg CO2 m-2 s-1",
        "uncertainty": None,
        "ref": "heimsch2021",
        "page": "PDF p. 7 (journal p. 3473), Sect. 3.2",
        "tableFigure": "Fig. 3, Table C1",
    },
    {
        "key": "organicRespiration",
        "text": "Respiration increased after each organic fertilisation; mineral fertilisation had no immediate effect on the CO2 fluxes",
        "value": None,
        "unit": None,
        "uncertainty": None,
        "ref": "heimsch2021",
        "page": "PDF p. 11 (journal p. 3477), Sect. 4.1",
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


# ---------- Figures ----------
FONT_STACK = "system-ui, sans-serif"  # body font of site/src/styles/global.css
# Okabe-Ito order of site/src/styles/global.css --series-1..8 (light) and the site position in sites.parquet.
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
CONTROL_GREY = "#9a9a9a"
INK = "#222222"
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
FIGURES = (
    (1, "gpp-change-vs-temperature"),
    (2, "residuals"),
    (3, "gpp-course"),
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
    """Days since 1970-01-01."""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return (d - EPOCH).days


def iso_day(day: int) -> str:
    return (EPOCH + timedelta(days=int(day))).isoformat()


def day_of_year(day: int) -> int:
    d = EPOCH + timedelta(days=int(day))
    return day - day_number(date(d.year, 1, 1)) + 1


def classify(event_type: str) -> str | None:
    """Class of an event type, or None when the dive does not analyse the type."""
    if event_type in ("harvest", "cut"):
        return "harvest-cut"
    if event_type in ("grazing", "fertilisation", "tillage"):
        return event_type
    return None


def fertiliser_kind(detail: str) -> str:
    """Mineral when the detail text names a mineral product, else organic."""
    return "mineral" if MINERAL_RE.search(detail or "") else "organic"


def kind_of(classes: Iterable[str]) -> str:
    s = tuple(sorted(set(classes)))
    for kid, kc in KINDS:
        if tuple(sorted(kc)) == s:
            return kid
    return "other"


@dataclass
class Event:
    site: str
    date: int
    date_end: int | None
    type: str
    detail: str
    n_kg_ha: float | None
    cls: str | None = None
    fert: str | None = None

    @property
    def lo(self) -> int:
        return self.date

    @property
    def hi(self) -> int:
        return self.date if self.date_end is None else self.date_end


def make_event(
    site: str, d: int, d_end: int | None, etype: str, detail: str, n: float | None
) -> Event:
    cls = classify(etype)
    return Event(
        site,
        d,
        d_end,
        etype,
        detail,
        n,
        cls,
        fertiliser_kind(detail) if cls == "fertilisation" else None,
    )


@dataclass
class Episode:
    site: str
    start: int
    end: int
    events: list[Event] = field(default_factory=list)
    classes: list[str] = field(default_factory=list)
    kind: str = "other"
    fert: str | None = None

    @property
    def id(self) -> str:
        return f"{self.site}-{iso_day(self.start)}"


def merge_episodes(
    events: Sequence[Event], merge_days: int = MERGE_DAYS
) -> list[Episode]:
    """Merge the events with a class into episodes. The input order must be (site, date, type)."""
    ordered = sorted(
        (e for e in events if e.cls is not None), key=lambda e: (e.site, e.date)
    )
    out: list[Episode] = []
    for e in ordered:
        start = e.date
        end = e.date_end if e.date_end is not None else start
        last = out[-1] if out else None
        if last is not None and last.site == e.site and start - last.end <= merge_days:
            last.end = max(last.end, end)
            last.events.append(e)
        else:
            out.append(Episode(e.site, start, end, [e]))
    for ep in out:
        ep.classes = sorted({e.cls for e in ep.events if e.cls is not None})
        ep.kind = kind_of(ep.classes)
        ferts = {e.fert for e in ep.events if e.fert is not None}
        ep.fert = (
            None if not ferts else (next(iter(ferts)) if len(ferts) == 1 else "mixed")
        )
    return out


class DayTable:
    """Daily values of one site, as arrays indexed by day number (NaN = no value)."""

    def __init__(self, first_day: int, last_day: int, pad: int = 120) -> None:
        self.offset = first_day - pad
        self.size = last_day - first_day + 1 + 2 * pad
        self.vars: dict[str, np.ndarray] = {}

    def array(self, var: str) -> np.ndarray:
        if var not in self.vars:
            self.vars[var] = np.full(self.size, np.nan)
        return self.vars[var]

    def set(self, var: str, days: np.ndarray, values: np.ndarray) -> None:
        self.array(var)[days - self.offset] = values

    def get(self, var: str, day: int) -> float:
        i = day - self.offset
        return float(self.array(var)[i]) if 0 <= i < self.size else math.nan

    def window(
        self, var: str, anchor: int, w: tuple[int, int]
    ) -> tuple[int, float | None]:
        """Number of days with a value and the mean over the days anchor + w[0] .. anchor + w[1]."""
        lo = anchor + w[0] - self.offset
        hi = anchor + w[1] - self.offset + 1
        if lo < 0 or hi > self.size:
            raise IndexError(f"window {anchor}{w} outside the day table")
        xs = self.array(var)[lo:hi]
        xs = xs[~np.isnan(xs)]
        return len(xs), (float(xs.sum() / len(xs)) if len(xs) else None)


@dataclass
class WindowMeans:
    n: dict[str, int]
    mean: dict[str, float | None]


def window_means(
    table: DayTable, anchor: int, w: tuple[int, int], variables: Sequence[str]
) -> WindowMeans:
    n: dict[str, int] = {}
    m: dict[str, float | None] = {}
    for v in variables:
        n[v], m[v] = table.window(v, anchor, w)
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
        ok = (
            a is not None
            and b is not None
            and after.n[v] >= min_days
            and before.n[v] >= min_days
        )
        out[v] = (a - b) if ok and a is not None and b is not None else None
    return out


def pct(a: float | None, b: float | None, min_ref: float = 0.0) -> float | None:
    """100 * (a - b) / b, or None when a value is missing or b <= min_ref."""
    if a is None or b is None or not (b > min_ref):
        return None
    return 100 * (a - b) / b


def rank_among(values: Sequence[float], x: float) -> float:
    """Percent of the reference values strictly below x (0 to 100)."""
    if len(values) == 0:
        raise ValueError("rank in an empty list")
    return 100.0 * sum(1 for v in values if v < x) / len(values)


@dataclass
class Fit:
    coef: list[float]
    residuals: np.ndarray
    resid_sd: float
    r2: float
    n: int

    def predict(self, x: Sequence[float]) -> float:
        return float(
            self.coef[0] + sum(c * xi for c, xi in zip(self.coef[1:], x, strict=True))
        )

    def json(self) -> dict[str, Any]:
        return {
            "coef": list(self.coef),
            "residSd": self.resid_sd,
            "r2": self.r2,
            "n": self.n,
        }


def ols_multi(x: np.ndarray, y: np.ndarray) -> Fit | None:
    """OLS y = b0 + b1 x1 + ... + bk xk. None when n <= k + 2 or the design is rank deficient."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n == 0:
        return None
    if x.ndim == 1:
        x = x[:, None]
    k = x.shape[1]
    if n <= k + 2:
        return None
    z = np.column_stack([np.ones(n), x])
    coef, _, rank, _ = np.linalg.lstsq(z, y, rcond=None)
    if rank < k + 1 or not np.all(np.isfinite(coef)):
        return None
    resid = y - z @ coef
    sse = float(resid @ resid)
    sst = float(((y - y.mean()) ** 2).sum())
    return Fit(
        [float(c) for c in coef],
        resid,
        math.sqrt(sse / (n - k - 1)),
        0.0 if sst == 0 else 1 - sse / sst,
        n,
    )


def pearson(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    if len(xs) != len(ys):
        raise ValueError("pearson: lists have different lengths")
    if len(xs) < 3:
        return None
    x = np.asarray(xs, dtype=float)
    y = np.asarray(ys, dtype=float)
    dx = x - x.mean()
    dy = y - y.mean()
    sxx = float(dx @ dx)
    syy = float(dy @ dy)
    if sxx == 0 or syy == 0:
        return None
    return float(dx @ dy) / math.sqrt(sxx * syy)


def pearson_p(r: float | None, n: int) -> float | None:
    """Two-sided p-value of a Pearson r (t = r sqrt((n - 2) / (1 - r^2)), df = n - 2)."""
    if r is None or n < 3:
        return None
    if abs(r) >= 1:
        return 0.0
    df = n - 2
    t = r * math.sqrt(df / (1 - r * r))
    return float(betainc(df / 2, 0.5, df / (df + t * t)))


def ols_line(xs: Sequence[float], ys: Sequence[float]) -> dict[str, Any]:
    """Simple OLS line with Pearson r and its p-value (as line() of the TypeScript dive)."""
    n = len(xs)
    slope = intercept = None
    if n >= 3:
        x = np.asarray(xs, dtype=float)
        y = np.asarray(ys, dtype=float)
        sxx = float(((x - x.mean()) ** 2).sum())
        if sxx != 0:
            slope = float(((x - x.mean()) * (y - y.mean())).sum()) / sxx
            intercept = float(y.mean()) - slope * float(x.mean())
    r = pearson(xs, ys) if n >= 3 else None
    return {
        "n": n,
        "slope": slope,
        "intercept": intercept,
        "r": r,
        "p": pearson_p(r, n),
    }


def finite(values: Iterable[float | None]) -> np.ndarray:
    xs = np.array(
        [v for v in values if v is not None and math.isfinite(v)], dtype=float
    )
    return xs


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
    SEEDS_USED[name] = seed
    xs = finite(values)
    ci = bootstrap_mean_ci(xs, seed)
    n = len(xs)
    return {
        "n": n,
        "mean": float(xs.mean()) if n else None,
        "sd": float(xs.std(ddof=1)) if n >= 2 else None,
        "min": float(xs.min()) if n else None,
        "max": float(xs.max()) if n else None,
        "ciLo": ci[0] if ci else None,
        "ciHi": ci[1] if ci else None,
        "nPositive": int((xs > 0).sum()),
    }


def control_anchors(years: Iterable[int], doy: int, half_width: int) -> list[int]:
    out: set[int] = set()
    for y in years:
        jan1 = day_number(date(y, 1, 1))
        for k in range(-half_width, half_width + 1):
            out.add(jan1 + doy - 1 + k)
    return sorted(out)


def event_day_mask(
    events: Iterable[Event], before: int = MASK_BEFORE, after: int = MASK_AFTER
) -> set[int]:
    out: set[int] = set()
    for e in events:
        out.update(range(e.lo - before, e.hi + after + 1))
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


# ======================================================================================
# Read
# ======================================================================================
EVENTS_SCHEMA = pa.DataFrameSchema(
    {
        "site_code": pa.Column(str, pa.Check.isin(SITES)),
        "date": pa.Column(object),
        "date_end": pa.Column(object, nullable=True),
        "type": pa.Column(str),
        "detail": pa.Column(object, nullable=True),
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
        "n_rows": pa.Column(int, pa.Check.in_range(1, 48)),
        "swc": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
        "tsoil": pa.Column(float, pa.Check.in_range(-30, 40), nullable=True),
        "rain": pa.Column(float, pa.Check.ge(0), nullable=True),
        "light": pa.Column(float, pa.Check.ge(0), nullable=True),
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


def local_day(ts_utc: pd.Series, offset_min: pd.Series) -> np.ndarray:
    """Day number of the local day of each period start: ts_start + utc_offset_min (one place)."""
    minutes = (ts_utc - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta(minutes=1)
    local = minutes.to_numpy(dtype=np.int64) + offset_min.to_numpy(dtype=np.int64)
    return np.floor_divide(local, 1440)


def date_days(col: pd.Series) -> np.ndarray:
    """Day numbers of a date column (NaN for a missing date)."""
    dt = pd.to_datetime(col)
    out = np.full(len(col), np.nan)
    ok = dt.notna().to_numpy()
    out[ok] = ((dt[ok] - pd.Timestamp("1970-01-01")) // pd.Timedelta(days=1)).to_numpy(
        dtype=float
    )
    return out


@dataclass
class Data:
    sites: pd.DataFrame
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
        "units checked in variables.parquet: %s",
        ", ".join(f"{k} [{v}]" for k, v in EXPECTED_UNITS.items()),
    )

    sites_all = pd.read_parquet(
        db / "sites.parquet", columns=columns_of("db/sites.parquet"), engine="pyarrow"
    )
    sites_all = sites_all.sort_values("site_id").reset_index(drop=True)
    sites_all["slot"] = np.arange(len(sites_all))
    sites = frame(sites_all[col(sites_all, "code").isin(SITES)]).reset_index(drop=True)
    if len(sites) != len(SITES):
        raise InputError(
            f"expected {len(SITES)} sites in sites.parquet, got {len(sites)}"
        )
    steps["sites"] = {
        "rowsRead": len(sites_all),
        "rowsKept": len(sites),
        "rule": "the five Finnish sites",
    }

    # ----- events -----
    ev = pd.read_parquet(
        db / "events.parquet",
        columns=columns_of("db/events.parquet"),
        filters=[("site_code", "in", list(SITES))],
        engine="pyarrow",
    )
    ev["site_code"] = ev["site_code"].astype(str)
    ev["type"] = ev["type"].astype(str)
    ev["date"] = pd.to_datetime(ev["date"]).dt.date
    ev["date_end"] = pd.to_datetime(ev["date_end"]).dt.date.astype(object)
    ev["date_end"] = ev["date_end"].where(ev["date_end"].notna(), None)
    ev["detail"] = ev["detail"].astype(object).where(ev["detail"].notna(), "")
    ev["n_kg_ha"] = ev["n_kg_ha"].astype(float)
    ev = pd.DataFrame(EVENTS_SCHEMA.validate(ev))
    ev = ev.sort_values(
        ["site_code", "date", "type", "detail"], kind="stable"
    ).reset_index(drop=True)
    steps["events"] = {
        "rowsRead": len(ev),
        "rule": "site_code in the five Finnish sites (Parquet filter)",
    }
    events: list[Event] = []
    for r in ev.to_dict("records"):
        nv = r["n_kg_ha"]
        n = (
            None
            if nv is None or (isinstance(nv, float) and math.isnan(nv))
            else float(nv)
        )
        d_end = None if r["date_end"] is None else day_number(r["date_end"])
        events.append(
            make_event(
                str(r["site_code"]),
                day_number(r["date"]),
                d_end,
                str(r["type"]),
                str(r["detail"] or ""),
                n,
            )
        )

    # ----- daily fluxes -----
    daily = pd.read_parquet(
        calculated / "daily.parquet",
        columns=columns_of("calculated/daily.parquet"),
        filters=[("site_code", "in", list(SITES))],
        engine="pyarrow",
    )
    daily["site_code"] = daily["site_code"].astype(str)
    daily["date_local"] = pd.to_datetime(daily["date_local"]).dt.date
    daily = pd.DataFrame(DAILY_SCHEMA.validate(daily))
    daily["day"] = date_days(col(daily, "date_local")).astype(np.int64)
    steps["daily"] = {
        "rowsRead": len(daily),
        "rule": "site_code in the five Finnish sites (Parquet filter)",
    }

    # ----- observations -> local days -----
    ids = [int(x) for x in sites["site_id"]]
    obs = pd.read_parquet(
        db / "observations.parquet",
        columns=columns_of("db/observations.parquet"),
        filters=[("site_id", "in", ids)],
        engine="pyarrow",
    )
    steps["observations"] = {
        "rowsRead": len(obs),
        "rule": "site_id of the five Finnish sites (Parquet filter)",
    }
    obs["ts_start"] = to_utc(col(obs, "ts_start"))
    obs = obs.merge(
        frame(sites[["site_id", "code", "utc_offset_min"]]), on="site_id", how="left"
    )
    obs["day"] = local_day(col(obs, "ts_start"), col(obs, "utc_offset_min"))
    ppfd_sites = [s for s, lv in LIGHT_VAR.items() if lv == "ppfd"]
    obs["light_src"] = np.where(
        col(obs, "code").isin(ppfd_sites), col(obs, "ppfd"), col(obs, "sw_in")
    )
    # The TypeScript dive computes avg(greatest(x, 0)) in DuckDB. greatest() ignores NULL, thus a
    # missing half hour counts as 0 in the mean (sum of the values / all rows of the day).
    obs["light_pos"] = obs["light_src"].clip(lower=0)
    g = obs.groupby(["code", "day"], sort=True)
    agg = pd.DataFrame(
        {
            "n_rows": g.size(),
            "swc": g["swc"].mean(),
            "n_swc": g["swc"].count(),
            "tsoil": g["tsoil"].mean(),
            "n_tsoil": g["tsoil"].count(),
            "rain": g["precip"].sum(min_count=1),
            "n_rain": g["precip"].count(),
            "light_sum": g["light_pos"].sum(min_count=1),
            "n_light": g["light_src"].count(),
        }
    ).reset_index()
    agg = agg.rename(columns={"code": "site_code"})
    n_days = len(agg)
    tsoil_drop = count_true((agg["n_tsoil"] < MIN_SWC_ROWS) & agg["tsoil"].notna())
    agg.loc[agg["n_tsoil"] < MIN_SWC_ROWS, "tsoil"] = np.nan
    swc_drop = count_true((agg["n_swc"] < MIN_SWC_ROWS) & agg["swc"].notna())
    agg.loc[agg["n_swc"] < MIN_SWC_ROWS, "swc"] = np.nan
    frozen = agg["swc"].notna() & agg["tsoil"].notna() & (agg["tsoil"] <= 0)
    n_frozen = count_true(frozen)
    agg.loc[frozen, "swc"] = np.nan
    rain_drop = count_true((agg["n_rain"] < MIN_RAIN_ROWS) & agg["rain"].notna())
    agg.loc[agg["n_rain"] < MIN_RAIN_ROWS, "rain"] = np.nan
    light_mean = agg["light_sum"].fillna(0) / agg["n_rows"]
    # umol m-2 s-1 x 86 400 s / 1e6 = mol m-2 d-1; W m-2 x 86 400 s / 1e6 = MJ m-2 d-1.
    agg["light"] = np.where(
        agg["n_light"] >= MIN_LIGHT_ROWS, light_mean * 86_400 / 1e6, np.nan
    )
    light_drop = count_true(agg["n_light"] < MIN_LIGHT_ROWS)
    agg = pd.DataFrame(OBS_DAY_SCHEMA.validate(agg))
    steps["observationDays"] = {
        "localDays": n_days,
        "tsoilNullFewerThan36Rows": tsoil_drop,
        "swcNullFewerThan36Rows": swc_drop,
        "swcNullFrozenSoil": n_frozen,
        "rainNullFewerThan44Rows": rain_drop,
        "lightNullFewerThan44Rows": light_drop,
    }
    log.info(
        "observations: %d rows -> %d local days; swc null: %d days (< %d rows), %d days (tsoil <= 0, frozen soil); "
        "tsoil null: %d; rain null: %d (< %d rows); light null: %d (< %d rows)",
        len(obs),
        n_days,
        swc_drop,
        MIN_SWC_ROWS,
        n_frozen,
        tsoil_drop,
        rain_drop,
        MIN_RAIN_ROWS,
        light_drop,
        MIN_LIGHT_ROWS,
    )

    # ----- day tables -----
    tables: dict[str, DayTable] = {}
    years: dict[str, list[int]] = {}
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
            ("ta_mean", "ta"),
        ):
            t.set(dst, dd, col(d, src).to_numpy(dtype=float))
        od = col(o, "day").to_numpy()
        for v in ("swc", "tsoil", "rain", "light"):
            t.set(v, od, col(o, v).to_numpy(dtype=float))
        tables[site] = t
        years[site] = sorted({int(x.year) for x in col(d, "date_local")})
    # Haltiala: rain of Viikki on the same day (the days of the Haltiala table).
    h, v = tables["haltiala"], tables["viikki"]
    h_days = np.arange(h.offset, h.offset + h.size)
    h_rain = np.array([v.get("rain", int(x)) for x in h_days])
    h.vars["rain"] = h_rain
    # Light-normalised GPP.
    for site in SITES:
        t = tables[site]
        gpp, light = t.array("gpp"), t.array("light")
        min_l = MIN_LIGHT_FOR_LUE[LIGHT_VAR[site]]
        with np.errstate(divide="ignore", invalid="ignore"):
            t.vars["lue"] = np.where(
                ~np.isnan(gpp) & ~np.isnan(light) & (light >= min_l),
                gpp / light,
                np.nan,
            )
    return Data(sites, events, tables, years, steps)


# ======================================================================================
# Analysis
# ======================================================================================
MEAN_VARS = ("nee", "gpp", "reco", "frac", "ta", "swc", "rain", "light", "lue")
PAIR_VARS = ("gpp", "reco", "nee", "ta", "light", "frac")
EXTRA_VARS = ("rain", "swc", "lue")


@dataclass
class Pair:
    site: str
    anchor: int
    d_gpp: float
    d_reco: float
    d_nee: float
    d_ta: float
    d_light_pct: float
    d_rain: float | None
    d_swc: float | None
    d_lue: float | None
    rel_gpp_pct: float | None


def build_pairs(
    data: Data, site: str, fert_eps: Sequence[Episode], half_width: int
) -> list[Pair]:
    t = data.tables[site]
    blocked = event_day_mask([e for e in data.events if e.site == site])
    anchors: set[int] = set()
    for ep in fert_eps:
        if ep.site == site:
            anchors.update(
                control_anchors(data.years[site], day_of_year(ep.start), half_width)
            )
    out: list[Pair] = []
    all_vars = PAIR_VARS + EXTRA_VARS
    for a in sorted(anchors):
        if any(d in blocked for d in range(a + BEFORE[0], a + AFTER[1] + 1)):
            continue
        b = window_means(t, a, BEFORE, all_vars)
        f = window_means(t, a, AFTER, all_vars)
        delta = changes(f, b, all_vars)
        if any(delta[v] is None for v in PAIR_VARS):
            continue
        bf, af, bl = b.mean["frac"], f.mean["frac"], b.mean["light"]
        if not ((bf or 0) >= MIN_FRAC and (af or 0) >= MIN_FRAC and (bl or 0) > 0):
            continue
        d_light = pct(f.mean["light"], bl)
        d_rain = delta["rain"]
        out.append(
            Pair(
                site,
                a,
                float(delta["gpp"] or 0),
                float(delta["reco"] or 0),
                float(delta["nee"] or 0),
                float(delta["ta"] or 0),
                float(d_light or 0),
                None if d_rain is None else d_rain * AFTER_DAYS,
                delta["swc"],
                delta["lue"],
                pct(f.mean["gpp"], b.mean["gpp"], MIN_GPP_BEFORE - 1e-12),
            )
        )
    return out


@dataclass
class SiteFit:
    pairs: list[Pair]
    fit: Fit | None
    fit_swc: Fit | None
    fit_ta: dict[str, Any]
    pairs10: list[Pair]
    fit10: Fit | None


def fit_pairs(pairs: Sequence[Pair], with_swc: bool = False) -> Fit | None:
    if with_swc:
        pairs = [p for p in pairs if p.d_swc is not None]
        x = np.array(
            [[p.d_ta, p.d_light_pct, p.d_swc] for p in pairs], dtype=float
        ).reshape(-1, 3)
    else:
        x = np.array([[p.d_ta, p.d_light_pct] for p in pairs], dtype=float).reshape(
            -1, 2
        )
    return ols_multi(x, np.array([p.d_gpp for p in pairs], dtype=float))


def episode_result(
    data: Data,
    ep: Episode,
    class_eps: Sequence[Episode],
    fits: dict[str, SiteFit],
    pooled: Fit | None,
) -> dict[str, Any]:
    site = ep.site
    t = data.tables[site]
    before = window_means(t, ep.start, BEFORE, MEAN_VARS)
    after = window_means(t, ep.end, AFTER, MEAN_VARS)
    delta = changes(after, before, MEAN_VARS)
    lo, hi = ep.start + BEFORE[0], ep.end + AFTER[1]
    others = [
        o for o in class_eps if o is not ep and o.site == site and lo <= o.start <= hi
    ]
    flux_days = all(
        before.n[f] >= MIN_DAYS and after.n[f] >= MIN_DAYS
        for f in ("nee", "gpp", "reco")
    )
    frac_ok = (before.mean["frac"] or 0) >= MIN_FRAC and (
        after.mean["frac"] or 0
    ) >= MIN_FRAC
    exclusion = (
        "overlap"
        if others
        else "too-few-days"
        if not flux_days
        else "low-measured-fraction"
        if not frac_ok
        else None
    )
    sowing = [
        e
        for e in data.events
        if e.site == site and e.type == "sowing" and e.lo <= ep.end and ep.start <= e.hi
    ]
    with_tillage = "tillage" in ep.classes or len(sowing) > 0
    with_harvest = "harvest-cut" in ep.classes
    fert_events = [e for e in ep.events if e.cls == "fertilisation"]
    n_in = [
        e.n_kg_ha
        for e in fert_events
        if e.n_kg_ha is not None and math.isfinite(e.n_kg_ha)
    ]
    light_ok = before.n["light"] >= MIN_DAYS and after.n["light"] >= MIN_DAYS
    w_ta = delta["ta"]
    w_light = pct(after.mean["light"], before.mean["light"]) if light_ok else None
    w_rain = None if delta["rain"] is None else delta["rain"] * AFTER_DAYS
    w_swc = delta["swc"]
    sf = fits[site]
    obs = delta["gpp"]
    can_fit = obs is not None and w_ta is not None and w_light is not None
    x2 = [w_ta or 0.0, w_light or 0.0]
    expected = sf.fit.predict(x2) if can_fit and sf.fit else None
    residual = None if expected is None or obs is None else obs - expected
    expected_swc = (
        sf.fit_swc.predict([*x2, w_swc])
        if can_fit and sf.fit_swc and w_swc is not None
        else None
    )
    expected10 = sf.fit10.predict(x2) if can_fit and sf.fit10 else None
    gpp_b = before.mean["gpp"]
    rel = (
        100 * obs / gpp_b
        if obs is not None and gpp_b is not None and gpp_b >= MIN_GPP_BEFORE
        else None
    )
    pooled_pred = pooled.predict(x2) if rel is not None and can_fit and pooled else None
    matches = (
        [
            p
            for p in sf.pairs
            if abs(p.d_ta - x2[0]) <= TOL_TA
            and abs(p.d_light_pct - x2[1]) <= TOL_LIGHT_PCT
        ]
        if can_fit
        else []
    )
    control_delta = (
        float(np.mean([p.d_gpp for p in matches]))
        if len(matches) >= MIN_MATCHED
        else None
    )
    lb = before.mean["lue"] if before.n["lue"] >= MIN_DAYS else None
    la = after.mean["lue"] if after.n["lue"] >= MIN_DAYS else None
    resid_ctrl = list(sf.fit.residuals) if sf.fit else []
    resid10_ctrl = list(sf.fit10.residuals) if sf.fit10 else []
    gpp_ctrl = [p.d_gpp for p in sf.pairs]
    residual10 = None if expected10 is None or obs is None else obs - expected10
    flux_used = exclusion is None
    keys = ("gpp", "reco", "nee", "ta", "light", "rain", "swc", "frac", "lue")
    return {
        "id": ep.id,
        "site": site,
        "siteName": str(data.sites.loc[data.sites["code"] == site, "name"].iloc[0]),
        "start": iso_day(ep.start),
        "end": iso_day(ep.end),
        "doy": day_of_year(ep.start),
        "kind": ep.kind,
        "classes": list(ep.classes),
        "fert": ep.fert,
        "product": "; ".join(e.detail for e in fert_events),
        "events": [
            {"date": iso_day(e.date), "type": e.type, "detail": e.detail}
            for e in ep.events
        ],
        "coEvents": [
            {"date": iso_day(e.date), "type": e.type, "detail": e.detail}
            for e in sowing
        ],
        "withHarvest": with_harvest,
        "withTillage": with_tillage,
        "nKgHa": float(sum(n_in)) if n_in else None,
        "before": {
            "nDays": {k: before.n[k] for k in keys},
            "mean": {k: before.mean[k] for k in keys},
        },
        "after": {
            "nDays": {k: after.n[k] for k in keys},
            "mean": {k: after.mean[k] for k in keys},
        },
        "delta": {
            k: delta[k]
            for k in ("gpp", "reco", "nee", "ta", "light", "rain", "swc", "frac")
        },
        "rain14": w_rain,
        "lightPct": w_light,
        "observed": obs,
        "expected": expected,
        "residual": residual,
        "residualRank": rank_among(resid_ctrl, residual)
        if residual is not None and resid_ctrl
        else None,
        "rawRank": rank_among(gpp_ctrl, obs) if obs is not None and gpp_ctrl else None,
        "nControls": len(sf.pairs),
        "matched": {
            "n": len(matches),
            "controlDelta": control_delta,
            "diff": None
            if control_delta is None or obs is None
            else obs - control_delta,
        },
        "lightNorm": {
            "before": lb,
            "after": la,
            "delta": None if lb is None or la is None else la - lb,
            "pct": pct(la, lb),
        },
        "expectedSwc": expected_swc,
        "residualSwc": None
        if expected_swc is None or obs is None
        else obs - expected_swc,
        "residual10": residual10,
        "residualRank10": rank_among(resid10_ctrl, residual10)
        if residual10 is not None and resid10_ctrl
        else None,
        "relGppPct": rel,
        "pooledResidualPct": None
        if pooled_pred is None or rel is None
        else rel - pooled_pred,
        "fluxUsed": flux_used,
        "fluxExclusion": exclusion,
        "overlapWith": [f"{'+'.join(o.classes)} {iso_day(o.start)}" for o in others],
        "inSummary": flux_used and not with_harvest and residual is not None,
    }


STAT_GETTERS: dict[str, Callable[[dict[str, Any]], float | None]] = {
    "observed": lambda e: e["observed"],
    "expected": lambda e: e["expected"],
    "residual": lambda e: e["residual"],
    "residualRank": lambda e: e["residualRank"],
    "relGppPct": lambda e: e["relGppPct"],
    "reco": lambda e: e["delta"]["reco"],
    "nee": lambda e: e["delta"]["nee"],
    "ta": lambda e: e["delta"]["ta"],
    "lightPct": lambda e: e["lightPct"],
    "rain": lambda e: e["rain14"],
    "swc": lambda e: e["delta"]["swc"],
    "matchedDiff": lambda e: e["matched"]["diff"],
    "lightNormPct": lambda e: e["lightNorm"]["pct"],
    "residualSwc": lambda e: e["residualSwc"],
    "residual10": lambda e: e["residual10"],
    "pooledResidualPct": lambda e: e["pooledResidualPct"],
}


def split_summary(
    name: str, index: int, eps: Sequence[dict[str, Any]]
) -> dict[str, Any]:
    base = SEED_SUMMARY_BASE + 20 * (index + 1)
    ranks = [e["residualRank"] for e in eps if e["residualRank"] is not None]
    raw = [e["rawRank"] for e in eps if e["rawRank"] is not None]
    out: dict[str, Any] = {
        "n": len(eps),
        "sites": {s: sum(1 for e in eps if e["site"] == s) for s in SITES},
    }
    for i, stat in enumerate(SUMMARY_STATS):
        out[stat] = summarise(
            (STAT_GETTERS[stat](e) for e in eps), base + i, f"summary.{name}.{stat}"
        )
    out["nResidualAbove90"] = sum(1 for r in ranks if r > RANK_HIGH)
    out["nResidualBelow10"] = sum(1 for r in ranks if r < RANK_LOW)
    out["nRawAbove90"] = sum(1 for r in raw if r > RANK_HIGH)
    out["nMatched"] = sum(1 for e in eps if e["matched"]["diff"] is not None)
    out["ids"] = [e["id"] for e in eps]
    return out


def gpp_course(data: Data, eps: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Mean daily GPP from day -14 to +14 of the episode start, in % of the before-window mean."""
    days = list(range(COURSE_DAYS[0], COURSE_DAYS[1] + 1))
    out: dict[str, Any] = {
        "days": days,
        "minEpisodes": COURSE_MIN_EPISODES,
        "minGppBefore": MIN_GPP_BEFORE,
        "lateFrom": COURSE_LATE[0],
        "lateTo": COURSE_LATE[1],
    }
    late = [i for i, d in enumerate(days) if COURSE_LATE[0] <= d <= COURSE_LATE[1]]

    def late_mean(xs: list[float | None]) -> float | None:
        vals = [v for v in (xs[i] for i in late) if v is not None]
        return float(np.mean(vals)) if vals else None

    for name, sel in (
        ("fertOnly", lambda e: not e["withTillage"]),
        ("withTillage", lambda e: e["withTillage"]),
    ):
        group = [
            e
            for e in eps
            if sel(e) and (e["before"]["mean"]["gpp"] or 0) >= MIN_GPP_BEFORE
        ]
        mean_l: list[float | None] = []
        sd_l: list[float | None] = []
        n_l: list[int] = []
        for k in days:
            xs = []
            for e in group:
                g = data.tables[e["site"]].get("gpp", day_number(e["start"]) + k)
                if not math.isnan(g):
                    xs.append(100 * g / e["before"]["mean"]["gpp"])
            n_l.append(len(xs))
            ok = len(xs) >= COURSE_MIN_EPISODES
            mean_l.append(float(np.mean(xs)) if ok else None)
            sd_l.append(float(np.std(xs, ddof=1)) if ok else None)
        out[name] = {
            "episodes": len(group),
            "ids": [e["id"] for e in group],
            "mean": mean_l,
            "sd": sd_l,
            "n": n_l,
            "lateMeanPct": late_mean(mean_l),
            "lateMeanSdPct": late_mean(sd_l),
        }
    return out


def analyse(data: Data) -> dict[str, Any]:
    class_eps = merge_episodes(data.events)
    fert_eps = [
        ep for ep in class_eps if "fertilisation" in ep.classes and ep.site in SITES
    ]
    log.info(
        "events: %d; class episodes: %d; fertilisation episodes: %d",
        len(data.events),
        len(class_eps),
        len(fert_eps),
    )
    slots = dict(zip(data.sites["code"], data.sites["slot"], strict=True))

    fits: dict[str, SiteFit] = {}
    controls: dict[str, Any] = {}
    for site in SITES:
        if not any(ep.site == site for ep in fert_eps):
            continue
        pairs = build_pairs(data, site, fert_eps, CONTROL_HALF_WIDTH)
        pairs10 = build_pairs(data, site, fert_eps, CONTROL_HALF_WIDTH_SENS)
        fit = fit_pairs(pairs)
        fit_swc = fit_pairs(pairs, with_swc=True)
        fit10 = fit_pairs(pairs10)
        d_ta = [p.d_ta for p in pairs]
        d_l = [p.d_light_pct for p in pairs]
        d_g = [p.d_gpp for p in pairs]
        fit_ta = ols_line(d_ta, d_g)
        fits[site] = SiteFit(pairs, fit, fit_swc, fit_ta, pairs10, fit10)
        yrs = sorted({int(iso_day(p.anchor)[:4]) for p in pairs})
        r = pearson(d_ta, d_l)
        slot = int(slots[site])
        controls[site] = {
            "nPairs": len(pairs),
            "nYears": len(yrs),
            "years": yrs,
            "fewYears": len(yrs) < MIN_CONTROL_YEARS,
            "rTaLight": r,
            "collinear": r is not None and abs(r) > COLLINEAR_R,
            "fit": fit.json() if fit else None,
            "fitSwc": fit_swc.json() if fit_swc else None,
            "fitTa": fit_ta,
            "fitLight": ols_line(d_l, d_g),
            "sensitivity10": {
                "nPairs": len(pairs10),
                "fit": fit10.json() if fit10 else None,
            },
            "dGpp": summarise(
                d_g, SEED_CONTROL["dGpp"] + slot, f"controls.{site}.dGpp"
            ),
            "dTa": summarise(d_ta, SEED_CONTROL["dTa"] + slot, f"controls.{site}.dTa"),
            "dLightPct": summarise(
                d_l, SEED_CONTROL["dLightPct"] + slot, f"controls.{site}.dLightPct"
            ),
            "residualQuantiles": (
                {
                    "p10": float(np.quantile(fit.residuals, 0.1)),
                    "p90": float(np.quantile(fit.residuals, 0.9)),
                }
                if fit
                else None
            ),
        }
        log.info(
            "controls %s: %d pairs (%d years), fit %s; +-10-day anchors: %d pairs",
            site,
            len(pairs),
            len(yrs),
            "none"
            if fit is None
            else f"coef {[round(c, 4) for c in fit.coef]} r2 {fit.r2:.3f}",
            len(pairs10),
        )
    pooled_pairs = [
        p for f in fits.values() for p in f.pairs if p.rel_gpp_pct is not None
    ]
    pooled = ols_multi(
        np.array([[p.d_ta, p.d_light_pct] for p in pooled_pairs], dtype=float).reshape(
            -1, 2
        ),
        np.array([p.rel_gpp_pct for p in pooled_pairs], dtype=float),
    )

    episodes = [episode_result(data, ep, class_eps, fits, pooled) for ep in fert_eps]
    in_sum = [e for e in episodes if e["inSummary"]]
    selectors: dict[str, Callable[[dict[str, Any]], bool]] = {
        "all": lambda e: True,
        "fertOnly": lambda e: not e["withTillage"],
        "withTillage": lambda e: e["withTillage"],
        "mineral": lambda e: e["fert"] == "mineral",
        "organic": lambda e: e["fert"] == "organic",
    }
    summary = {
        name: split_summary(name, i, [e for e in in_sum if selectors[name](e)])
        for i, name in enumerate(SPLITS)
    }
    exclusions = {
        k: sum(1 for e in episodes if e["fluxExclusion"] == k)
        for k in ("overlap", "too-few-days", "low-measured-fraction")
    }
    counts = {
        "events": len(data.events),
        "classEpisodes": len(class_eps),
        "fertEpisodes": len(episodes),
        "fertFluxUsed": sum(1 for e in episodes if e["fluxUsed"]),
        "fertWithHarvest": sum(1 for e in episodes if e["withHarvest"]),
        "fertInSummary": len(in_sum),
        "fertExclusions": exclusions,
        "controlPairs": sum(len(f.pairs) for f in fits.values()),
        "nControlSites": sum(1 for f in fits.values() if f.pairs and f.fit is not None),
        "fertNoFit": sum(
            1
            for e in episodes
            if e["fluxUsed"] and not e["withHarvest"] and e["residual"] is None
        ),
        "controlPairsPerSite": {s: len(f.pairs) for s, f in fits.items()},
        "perSite": {
            s: {
                "fertEpisodes": sum(1 for e in episodes if e["site"] == s),
                "fertInSummary": sum(1 for e in in_sum if e["site"] == s),
            }
            for s in SITES
        },
    }
    log.info("counts: %s", json.dumps(counts))
    highlights: dict[str, Any] = {}
    for hid in HIGHLIGHTS:
        hit = [e for e in episodes if e["id"] == hid]
        if len(hit) != 1:
            raise RuntimeError(f"highlight {hid}: {len(hit)} episodes")
        highlights[hid] = hit[0]
    return {
        "counts": counts,
        "controls": controls,
        "pooledRelative": {
            "nPairs": len(pooled_pairs),
            "fit": pooled.json() if pooled else None,
        },
        "summary": summary,
        "episodes": episodes,
        "highlights": highlights,
        "course": gpp_course(data, in_sum),
        "_fits": fits,
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


def setup_matplotlib() -> None:
    plt.rcParams.update(
        {
            "svg.fonttype": "none",
            "font.family": "sans-serif",
            "font.sans-serif": ["DejaVu Sans"],
            "mathtext.default": "regular",
            "font.size": 8,
            "axes.titlesize": 8.5,
            "axes.labelsize": 8,
            "xtick.labelsize": 7.5,
            "ytick.labelsize": 7.5,
            "legend.fontsize": 7.5,
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
        }
    )


def site_color(slot: int) -> str:
    return SERIES[slot % len(SERIES)]


def episode_marker(e: dict[str, Any]) -> str:
    return "D" if e["withTillage"] else "o"


def episode_face(e: dict[str, Any], color: str) -> str:
    return color if e["fert"] == "mineral" else "white"


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
    svg = prefix_svg_ids(svg, f"fw{n}-", keep={tid, did})
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


def figure_sites(res: dict[str, Any]) -> list[str]:
    return [
        s
        for s in SITES
        if s in res["controls"] and res["controls"][s]["fit"] is not None
    ]


def fig1(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    fits: dict[str, SiteFit] = res["_fits"]
    sites = figure_sites(res)
    slots = dict(zip(data.sites["code"], data.sites["slot"], strict=True))
    names = dict(zip(data.sites["code"], data.sites["name"], strict=True))
    in_sum = [e for e in res["episodes"] if e["inSummary"]]
    xs_all = [p.d_ta for s in sites for p in fits[s].pairs] + [
        e["delta"]["ta"] for e in in_sum
    ]
    ys_all = [p.d_gpp for s in sites for p in fits[s].pairs] + [
        e["observed"] for e in in_sum
    ]
    pad_x = 0.06 * (max(xs_all) - min(xs_all))
    pad_y = 0.06 * (max(ys_all) - min(ys_all))
    xlim = (min(xs_all) - pad_x, max(xs_all) + pad_x)
    ylim = (min(ys_all) - pad_y, max(ys_all) + pad_y)
    fig, axes = plt.subplots(
        1, len(sites), figsize=(FIG_WIDTH_IN, 3.3), sharex=True, sharey=True
    )
    axes = np.atleast_1d(axes)
    for ax, site in zip(axes, sites, strict=True):
        f = fits[site]
        c = res["controls"][site]
        color = site_color(int(slots[site]))
        ax.axhline(0, color=INK, lw=0.6, zorder=1)
        ax.axvline(0, color=INK, lw=0.6, ls=":", zorder=1)
        ax.scatter(
            [p.d_ta for p in f.pairs],
            [p.d_gpp for p in f.pairs],
            s=7,
            color=CONTROL_GREY,
            alpha=0.55,
            lw=0,
            zorder=2,
        )
        ft = c["fitTa"]
        if ft["slope"] is not None:
            x0, x1 = min(p.d_ta for p in f.pairs), max(p.d_ta for p in f.pairs)
            ax.plot(
                [x0, x1],
                [
                    ft["intercept"] + ft["slope"] * x0,
                    ft["intercept"] + ft["slope"] * x1,
                ],
                color=INK,
                lw=1.1,
                ls="--",
                zorder=3,
            )
        for e in (e for e in in_sum if e["site"] == site):
            ax.scatter(
                [e["delta"]["ta"]],
                [e["observed"]],
                s=34,
                marker=episode_marker(e),
                facecolors=episode_face(e, color),
                edgecolors=color,
                linewidths=1.4,
                zorder=4,
            )
        ax.set_title(
            f"{names[site]}\n(n = {c['nPairs']} control pairs, {c['nYears']} years)",
            pad=6,
        )
        ax.set_xlim(xlim)
        ax.set_ylim(ylim)
        ax.set_xlabel(r"$\Delta T_{air}$, after $-$ before (°C)")
    axes[0].set_ylabel(r"$\Delta$GPP, after $-$ before (g C m$^{-2}$ d$^{-1}$)")
    handles = [
        Line2D(
            [],
            [],
            ls="",
            marker="o",
            ms=4,
            mfc=CONTROL_GREY,
            mec=CONTROL_GREY,
            label="Control pair (no management)",
        ),
        Line2D(
            [],
            [],
            color=INK,
            ls="--",
            lw=1.1,
            label=r"OLS fit of control pairs, $\Delta$GPP ~ $\Delta T_{air}$",
        ),
        Line2D(
            [],
            [],
            ls="",
            marker="o",
            ms=6,
            mfc="#555555",
            mec="#555555",
            mew=1.4,
            label="Fertilisation, mineral",
        ),
        Line2D(
            [],
            [],
            ls="",
            marker="o",
            ms=6,
            mfc="white",
            mec="#555555",
            mew=1.4,
            label="Fertilisation, organic",
        ),
        Line2D(
            [],
            [],
            ls="",
            marker="D",
            ms=5.5,
            mfc="white",
            mec="#555555",
            mew=1.4,
            label="With tillage or sowing (diamond)",
        ),
    ]
    fig.legend(
        handles=handles,
        loc="lower center",
        ncol=3,
        frameon=False,
        bbox_to_anchor=(0.5, 0.0),
        columnspacing=1.6,
        handletextpad=0.5,
    )
    fig.text(
        0.5,
        0.155,
        r"Colour = site. $\Delta$ = mean of days +1 to +14 after the episode $-$ mean of days $-$14 to $-$1 before (local days). "
        r"$\Delta$GPP > 0: more uptake after.",
        ha="center",
        va="center",
        fontsize=7,
    )
    fig.subplots_adjust(left=0.08, right=0.985, top=0.86, bottom=0.33, wspace=0.12)

    title = (
        "Change of daily GPP against the change of air temperature from the 14 days before to the 14 days after, "
        "for control pairs without management (grey) and for fertilisation episodes (colour), per site."
    )
    parts = []
    below = 0
    for e in in_sum:
        ft = res["controls"][e["site"]]["fitTa"]
        if (
            ft["slope"] is not None
            and e["observed"] < ft["intercept"] + ft["slope"] * e["delta"]["ta"]
        ):
            below += 1
    slopes_pos = all((res["controls"][s]["fitTa"]["slope"] or 0) > 0 for s in sites)
    for site in sites:
        c = res["controls"][site]
        k = sum(1 for e in in_sum if e["site"] == site)
        parts.append(
            f"{names[site]}: {c['nPairs']} control pairs from {c['nYears']} years, slope of the temperature-only fit "
            f"{fmt(c['fitTa']['slope'])} g C m-2 d-1 per °C (r = {fmt(c['fitTa']['r'])}), {k} fertilisation episodes."
        )
    s_all = res["summary"]["all"]
    desc = (
        "Three scatter panels with the same axes. X axis: change of the mean air temperature, after minus before (°C). "
        "Y axis: change of the mean daily GPP, after minus before (g C m-2 d-1). "
        + " ".join(parts)
        + f" Over all {s_all['n']} fertilisation episodes, the observed GPP change has a mean of {fmt(s_all['observed']['mean'])} "
        f"(SD {fmt(s_all['observed']['sd'])}) and the change that the weather fit (temperature and light) gives has a mean of "
        f"{fmt(s_all['expected']['mean'])} g C m-2 d-1. "
        + (
            "In all panels, the GPP change of the control pairs increases with the temperature change. "
            if slopes_pos
            else "The slope of the temperature-only fit is not positive in all panels. "
        )
        + f"{below} of the {len(in_sum)} fertilisation episodes are below the temperature-only fit line of their site."
    )
    return fig, title, desc


def fig2(res: dict[str, Any], data: Data) -> tuple[Any, str, str]:
    sites = [
        s
        for s in SITES
        if any(e["inSummary"] and e["site"] == s for e in res["episodes"])
    ]
    slots = dict(zip(data.sites["code"], data.sites["slot"], strict=True))
    names = dict(zip(data.sites["code"], data.sites["name"], strict=True))
    rows: list[tuple[str, Any]] = []
    for site in sites:
        rows.append(("head", site))
        for e in sorted(
            (e for e in res["episodes"] if e["inSummary"] and e["site"] == site),
            key=lambda e: e["start"],
        ):
            rows.append(("ep", e))
    height = 0.9 + 0.19 * len(rows)
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, height))
    y_ticks: list[float] = []
    y_labels: list[str] = []
    n_rows = len(rows)
    y_of = {i: n_rows - 1 - i for i in range(n_rows)}
    for site in sites:
        idx = [i for i, (k, v) in enumerate(rows) if k == "ep" and v["site"] == site]
        q = res["controls"][site]["residualQuantiles"]
        if q:
            ys = [y_of[i] for i in idx]
            ax.fill_betweenx(
                [min(ys) - 0.42, max(ys) + 0.42],
                q["p10"],
                q["p90"],
                color="#e4e4e4",
                lw=0,
                zorder=1,
            )
    ax.axvline(0, color=INK, lw=0.7, zorder=2)
    for i, (k, v) in enumerate(rows):
        y = y_of[i]
        y_ticks.append(y)
        if k == "head":
            y_labels.append(
                f"{names[v]} ({sum(1 for kk, vv in rows if kk == 'ep' and vv['site'] == v)})"
            )
            continue
        e = v
        color = site_color(int(slots[e["site"]]))
        ax.scatter(
            [e["residual"]],
            [y],
            s=38,
            marker=episode_marker(e),
            facecolors=episode_face(e, color),
            edgecolors=color,
            linewidths=1.5,
            zorder=3,
        )
        y_labels.append(e["start"])
    ax.set_yticks(y_ticks, y_labels)
    for lbl, (k, _) in zip(ax.get_yticklabels(), rows, strict=True):
        if k == "head":
            lbl.set_fontweight("bold")
    ax.tick_params(axis="y", length=0)
    ax.set_ylim(-0.8, n_rows - 0.2)
    xs = [e["residual"] for e in res["episodes"] if e["inSummary"]]
    qs = [
        res["controls"][s]["residualQuantiles"]
        for s in sites
        if res["controls"][s]["residualQuantiles"]
    ]
    lo = min(xs + [q["p10"] for q in qs])
    hi = max(xs + [q["p90"] for q in qs])
    pad = 0.08 * (hi - lo)
    ax.set_xlim(lo - pad, hi + pad)
    ax.set_xlabel(
        r"Residual $\Delta$GPP = observed $-$ expected from the weather fit (g C m$^{-2}$ d$^{-1}$)"
    )
    ax.grid(axis="x", color="#eeeeee", lw=0.6, zorder=0)
    handles = [
        Line2D(
            [],
            [],
            ls="",
            marker="s",
            ms=8,
            mfc="#e4e4e4",
            mec="#e4e4e4",
            label="10 to 90 % of the control residuals",
        ),
        Line2D(
            [],
            [],
            ls="",
            marker="o",
            ms=6,
            mfc="#555555",
            mec="#555555",
            mew=1.4,
            label="Mineral",
        ),
        Line2D(
            [],
            [],
            ls="",
            marker="o",
            ms=6,
            mfc="white",
            mec="#555555",
            mew=1.4,
            label="Organic",
        ),
        Line2D(
            [],
            [],
            ls="",
            marker="D",
            ms=5.5,
            mfc="white",
            mec="#555555",
            mew=1.4,
            label="With tillage or sowing",
        ),
    ]
    fig.legend(
        handles=handles,
        loc="lower center",
        bbox_to_anchor=(0.5, 0.06 / height),
        ncol=4,
        frameon=False,
    )
    fig.subplots_adjust(
        left=0.17, right=0.97, top=1 - 0.12 / height, bottom=0.95 / height
    )

    s = res["summary"]
    n_inside = 0
    for e in res["episodes"]:
        q = res["controls"][e["site"]]["residualQuantiles"]
        if e["inSummary"] and q and q["p10"] <= e["residual"] <= q["p90"]:
            n_inside += 1
    title = (
        "Residual GPP change (observed minus the change that the weather fit of the control pairs gives) of each "
        "fertilisation episode, per site, with the 10 to 90 % range of the control residuals of the site."
    )
    site_txt = "; ".join(
        f"{names[x]} {s['all']['sites'][x]} episodes, control residuals 10 to 90 % from "
        f"{fmt(res['controls'][x]['residualQuantiles']['p10'])} to {fmt(res['controls'][x]['residualQuantiles']['p90'])}"
        for x in sites
    )
    desc = (
        "Dot plot. X axis: residual of the daily GPP change, observed minus expected (g C m-2 d-1). "
        "Y axis: episodes grouped by site, labelled with the start date. "
        f"{site_txt}. "
        f"Mean residual of all {s['all']['n']} episodes {fmt(s['all']['residual']['mean'])} "
        f"(SD {fmt(s['all']['residual']['sd'])}, 95 % CI {fmt(s['all']['residual']['ciLo'])} to {fmt(s['all']['residual']['ciHi'])}); "
        f"fertilisation only {fmt(s['fertOnly']['residual']['mean'])} (n = {s['fertOnly']['n']}); "
        f"with tillage or sowing {fmt(s['withTillage']['residual']['mean'])} (n = {s['withTillage']['n']}). "
        f"{s['all']['nResidualAbove90']} episodes rank above 90 % and {s['all']['nResidualBelow10']} below 10 % of the control residuals of their site. "
        f"{n_inside} of the {s['all']['n']} residuals are inside the 10 to 90 % range of the control residuals of their site; "
        f"{s['withTillage']['residual']['n'] - s['withTillage']['residual']['nPositive']} of the {s['withTillage']['residual']['n']} "
        "episodes with tillage or sowing have a residual of zero or less."
    )
    return fig, title, desc


def fig3(res: dict[str, Any]) -> tuple[Any, str, str]:
    c = res["course"]
    days = np.array(c["days"])
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, 2.9))
    styles = {
        "fertOnly": ("Fertilisation only", SERIES[0], "-", "o"),
        "withTillage": ("With tillage or sowing", SERIES[5], "--", "D"),
    }
    ax.axhline(100, color=INK, lw=0.6, zorder=1)
    ax.axvline(0, color=INK, lw=0.9, ls="--", zorder=1)
    for key, (label, color, ls, mk) in styles.items():
        g = c[key]
        m = np.array([np.nan if v is None else v for v in g["mean"]], dtype=float)
        sd = np.array([np.nan if v is None else v for v in g["sd"]], dtype=float)
        ax.fill_between(days, m - sd, m + sd, color=color, alpha=0.16, lw=0, zorder=2)
        ax.plot(
            days,
            m,
            color=color,
            ls=ls,
            lw=1.5,
            marker=mk,
            ms=3.2,
            label=f"{label} (n = {g['episodes']} episodes)",
            zorder=3,
        )
    ax.set_xlim(days[0] - 0.5, days[-1] + 0.5)
    ax.set_xticks(range(-14, 15, 2))
    ax.set_xlabel("Day relative to the first day of the episode (local days, UTC+2)")
    ax.set_ylabel("Daily GPP (% of the mean of days $-$14 to $-$1)")
    ax.legend(loc="upper left", frameon=False)
    fig.subplots_adjust(left=0.09, right=0.98, top=0.95, bottom=0.17)
    title = (
        "Mean course of daily GPP from 14 days before to 14 days after the start of the fertilisation episodes, "
        "in percent of the mean of the 14 days before, for episodes with fertilisation only and with tillage or sowing."
    )
    fo, wt = c["fertOnly"], c["withTillage"]

    def last(g: dict[str, Any]) -> float | None:
        return g["lateMeanPct"]

    def last_sd(g: dict[str, Any]) -> float | None:
        return g["lateMeanSdPct"]

    desc = (
        "Two lines with a band of plus or minus one SD. X axis: day relative to the first day of the episode (-14 to +14, local days). "
        "Y axis: daily GPP in percent of the mean of days -14 to -1. "
        f"Fertilisation only: {fo['episodes']} episodes; mean of days +{c['lateFrom']} to +{c['lateTo']} {fmt(last(fo), 0)} % (mean of the daily SDs {fmt(last_sd(fo), 0)} %). "
        f"With tillage or sowing: {wt['episodes']} episodes; mean of days +{c['lateFrom']} to +{c['lateTo']} {fmt(last(wt), 0)} % (mean of the daily SDs {fmt(last_sd(wt), 0)} %). "
        f"Days with fewer than {COURSE_MIN_EPISODES} episodes are not shown. Episodes with a mean GPP before of less than "
        f"{MIN_GPP_BEFORE} g C m-2 d-1 are not used. The spread between the episodes is large."
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
    args: argparse.Namespace,
    db: Path,
    calculated: Path,
    steps: dict[str, Any],
    script_dir: Path,
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


OPEN_FINDINGS = (
    (
        "ANT-01, SAR-01, VII-01 (open): the raw stamps of Anttila, Sarkisuo and Viikki are UTC, but the build reads them as "
        "UTC+2. The local day of these sites is thus 2 hours early. The effect on 14-day window means is small "
        "(2 of 48 half hours per day move to the next day)."
    ),
    (
        "QVI-16 (open): Qvidja swc in frozen soil is not reliable. This script sets the daily swc to null when the daily soil "
        "temperature is 0 degC or less (all sites)."
    ),
    (
        "QVI-11 and QVI-07 (open): Qvidja NEE is probably a different processing version, and the provider GPP and Reco do "
        "not close with NEE. This dive uses the calculated GPP of data/calculated/daily.parquet."
    ),
)


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
    builders = {
        1: lambda: fig1(res, data),
        2: lambda: fig2(res, data),
        3: lambda: fig3(res),
    }
    for n, name in FIGURES:
        fig, title, desc = builders[n]()
        path = target / "figures" / f"{n}-{name}.svg"
        save_svg(fig, path, n, title, desc, meta)
        size = path.stat().st_size
        if size >= 1_000_000:
            raise RuntimeError(f"{path}: {size} bytes (limit 1 MB)")
        figures_json.append(
            {"n": n, "file": f"figures/{n}-{name}.svg", "title": title, "desc": desc}
        )
        log.info("figure %d: %s (%d bytes)", n, path, size)

    # Control pairs as CSV (not in results.json).
    fits: dict[str, SiteFit] = res.pop("_fits")
    rows = []
    for site, f in fits.items():
        for hw, plist in (
            (CONTROL_HALF_WIDTH, f.pairs),
            (CONTROL_HALF_WIDTH_SENS, f.pairs10),
        ):
            for q in plist:
                rows.append(
                    {
                        "site": site,
                        "halfWidth": hw,
                        "anchor": iso_day(q.anchor),
                        "dGpp": q.d_gpp,
                        "dReco": q.d_reco,
                        "dNee": q.d_nee,
                        "dTa": q.d_ta,
                        "dLightPct": q.d_light_pct,
                        "dRain": q.d_rain,
                        "dSwc": q.d_swc,
                        "dLue": q.d_lue,
                        "relGppPct": q.rel_gpp_pct,
                    }
                )
    pd.DataFrame(rows).to_csv(
        out_dir / "output" / "pairs.csv", index=False, float_format="%.10g"
    )

    dv = data_version(args, args.db, args.calculated, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": "Does GPP change more after a fertilisation than the weather of the same days explains?",
        "method": {
            "sites": list(SITES),
            "light": {
                s: {
                    "lightVar": LIGHT_VAR[s],
                    "lightUnit": LIGHT_UNIT[LIGHT_VAR[s]],
                    "rainSource": RAIN_SOURCE[s],
                }
                for s in SITES
            },
            "minLightForLue": MIN_LIGHT_FOR_LUE,
            "beforeDays": list(BEFORE),
            "afterDays": list(AFTER),
            "minDays": MIN_DAYS,
            "minFrac": MIN_FRAC,
            "minGppBefore": MIN_GPP_BEFORE,
            "mergeDays": MERGE_DAYS,
            "minSwcRows": MIN_SWC_ROWS,
            "minRainRows": MIN_RAIN_ROWS,
            "minLightRows": MIN_LIGHT_ROWS,
            "controlHalfWidth": CONTROL_HALF_WIDTH,
            "controlHalfWidthSens": CONTROL_HALF_WIDTH_SENS,
            "maskBefore": MASK_BEFORE,
            "maskAfter": MASK_AFTER,
            "tolTa": TOL_TA,
            "tolLightPct": TOL_LIGHT_PCT,
            "minMatched": MIN_MATCHED,
            "collinearR": COLLINEAR_R,
            "minControlYears": MIN_CONTROL_YEARS,
            "rankHigh": RANK_HIGH,
            "rankLow": RANK_LOW,
            "bootstrapResamples": BOOTSTRAP_RESAMPLES,
            "bootstrapLevel": BOOTSTRAP_LEVEL,
            "mineralRegex": MINERAL_RE.pattern,
            "windowDays": AFTER_DAYS,
            "minFracPct": round(MIN_FRAC * 100),
            "ciLevelPct": round(BOOTSTRAP_LEVEL * 100),
            "halfHoursPerDay": HALF_HOURS_PER_DAY,
            "utcShiftHours": UTC_SHIFT_HOURS,
            "utcShiftHalfHours": UTC_SHIFT_HOURS * 2,
            "minLueLightPpfd": MIN_LIGHT_FOR_LUE["ppfd"],
            "minLueLightSwIn": MIN_LIGHT_FOR_LUE["sw_in"],
            "nSitesWithFit": sum(
                1 for c in res["controls"].values() if c["fit"] is not None
            ),
            "nSites": len(SITES),
            "openFindings": list(OPEN_FINDINGS),
        },
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
