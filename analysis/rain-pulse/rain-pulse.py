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
"""Rain pulse: night respiration, NEE and GPP in the days after a rain day.

QUESTION
    Does a rain day after dry days change the night-time ecosystem respiration (Reco), the net
    ecosystem exchange (NEE) and the gross primary production (GPP) in the next days, and does the
    soil water content (SWC) before the rain change the size of this pulse?

METHOD
    Sites: Anttila, Sarkisuo, Haltiala, Qvidja, Viikki and Maktau (order of db/sites.parquet; the
    order gives the colour, the marker and the line dash). Local day = floor((ts_start UTC +
    utc_offset_min) / 1 day): UTC+2 at the Finnish sites, UTC+3 at Maktau.
    1. Rows. db/observations.parquet (site_id, ts_start, nee, nee_qc, tsoil, swc, precip, ustar,
       sw_in, ppfd) joined one to one on site_id and ts_start with
       data/calculated/fluxes_30min.parquet (night, nee_fill, gpp). Measured = nee_fill is
       "measured". At the Finnish sites this is equal to nee_qc = 0 (the script checks it). At
       Maktau (nee_qc is NULL) it is nee IS NOT NULL after the quality filter of the calculated
       products (SSITC flag <= 1, |NEE| < 50, u* >= 0.10 m s-1, docs/calculated.md section 5).
       Night = the night flag of the calculated products (sw_in < 10 W m-2, else ppfd < 20).
    2. Season. Finnish sites: local days 1 May to 30 September. Maktau: all year. Half hours with
       tsoil <= 0 C are not used for the flux responses (rain and SWC keep them).
    3. Daily rain = sum of precip over the local day. A day with fewer than 40 precip half hours
       has no rain value (record incomplete). Haltiala has no rain gauge: its daily rain is the
       Viikki daily rain of the same local day.
    4. Temperature model (Reco only). Night sample = night, measured, tsoil present, season, and
       u* >= 0.10 m s-1 at Qvidja and Maktau (rows without u* stay), as the calculated
       partitioning. Lloyd-Taylor R = Rref exp(E0 (1/(Tref - T0) - 1/(T - T0))), T = tsoil,
       Tref 15 C, T0 -46.02 C, E0 and Rref free (scipy.optimize.curve_fit, E0 in -100 to 1000 K,
       start E0 = 100 K), fitted per site and local calendar year, then fitted again without the
       residuals outside the 5 to 95 % percentiles of the first fit. An own fit needs 100 or
       more night values and a tsoil range of 5 K or more. E0 is valid when E0 - SE > 30 K and
       E0 + SE < 550 K (the limits for soil temperature of the calculated products,
       docs/calculated.md section 4). The source of E0 per site-year (e0Source and method in
       results.json fits): "own" = the own fit (E0 and Rref), when it exists and is valid; else
       "site" = E0 of the fit over all season nights of the site (same rules), when it is valid;
       else "pooled" = E0 is the median of all valid own site-year E0 of all sites. For "site"
       and "pooled", Rref is fitted for the site-year with this E0 fixed (closed form Rref =
       sum(NEE f) / sum(f^2), f = exp(E0 g(T)), as the calculated products), so each site-year
       has its own Rref. A site-year without a night sample has no model ("none").
    5. Daily responses, one value per site and season day (no value when the minimum is not met):
       reco = mean of the measured night NEE / mean of the model on the same half hours (4 or
       more night half hours of the night sample; the season applies to the night day). Night of
       day d = the night after day d: a night half hour with local hour < 12 belongs to the
       previous local day, so the night of day d runs from the evening of day d to the morning
       of day d + 1. Only reco uses this rule; nee and gpp use the calendar day. gpp = mean of the calculated gpp on the
       measured day half hours (night flag false; 8 or more). nee = f x night mean + (1 - f) x
       day mean, f = night share of the half hours of the day with a night flag (4 or more
       measured night half hours with the u* rule, 8 or more measured day half hours). swc = mean
       of swc (24 or more half hours). light = mean ppfd (sw_in at Qvidja and Maktau) on the
       measured day half hours (8 or more). Measured fraction = measured half hours / 48.
    6. Events per site and threshold T (2, 5, 10 mm): day 0 is a season day with rain >= T; days
       -3, -2 and -1 have a rain value < T. Lags 1 to 15 stay in the event while the day has a
       rain value < T (and, at the Finnish sites, is a season day); the event stops (censored) at
       the next day with rain >= T, at a day without a rain value or at the season end. An event
       is dropped when its days -3 to +15 touch a management event of the site
       (db/events.parquet, types harvest, cut, grazing, tillage, sowing; a multi-day event covers
       date to date_end). Haltiala (Viikki rain, assumption): an event counts only when the daily
       SWC of day 0 or day 1 is 0.01 m3 m-3 or more above the SWC of day -1.
    7. Normalisation per event and variable. Pre-pulse mean = mean of the daily values of days -3
       to -1 (2 or more of the 3 days). reco: value / pre-pulse mean (pre-pulse = 1; the
       pre-pulse mean must be > 0). nee and gpp: value - pre-pulse mean in umol CO2 m-2 s-1
       (pre-pulse = 0). Used events =
       events with a pre-pulse mean and one or more values on days 0 to 15; n differs per
       variable.
    8. Composite per site, threshold, variable and lag -3 to 15: mean, SD (n - 1), SE = SD /
       sqrt(n) and n of the normalised event values. A lag with n < 5 is not drawn (the numbers
       stay in results.json). Pulse per event = mean of the normalised values of days 0 to 2 (2
       or more of the 3 days). Per site (5 mm events): measured fraction of day 0 against the
       mean of days -3 to -1, and light of day 0 relative to the pre-pulse light. The last drawn
       lag per site (5 mm) is in results.json (summary.<site>.<var>.lastDrawnLag) and in the alt
       text. Sensitivity (numbers only, sensitivity.prePulseMin1): the same 5 mm composite when
       the pre-pulse mean needs only 1 of the 3 days.
    9. SWC anomaly per event = daily SWC of day -1 minus the median daily SWC of the site over
       all season days with a SWC value. Figures 2, 4 and 6 (T = 5 mm): per site OLS line
       (statsmodels, slope with SE and p), Pearson r with p and Spearman rho with p (scipy), n;
       3 or more events with a pulse and an anomaly.
    10. Each step that removes rows, days or events logs a count (results.json dataVersion.steps).
    11. Open findings of docs/anomaly-data-report.md that touch this dive are printed
        (OPEN_FINDINGS). LITERATURE holds the model constants and their source.

DATABASE
    builtAt: 2026-10-23T19:03:07.928Z (db/report.json and Parquet key/value metadata built_at)
    calcBuiltAt: 2026-10-23T19:03:09.003Z (data/calculated/report.json and Parquet built_at)
    commit: 44ec98f (HEAD at build time; db/report.json does not record a commit)
    url: TODO: release asset db-2026-10-23.zip not yet published

INPUTS
    db/sites.parquet  sha256=9c59f8e1e499d2af0769d19265ace22a790a82e1a32025af931e00a0ba314a59  rows=6  columns=site_id, code, name, utc_offset_min
    db/variables.parquet  sha256=06e6a41c727958beb973f2b76adb8182d88b0a5d501be6f11c948c0129fb7c6e  rows=26  columns=column_name, unit
    db/observations.parquet  sha256=922346b5afe2ec56de128311aa3d8dc8cd0ccc1a57700bd333bbdf95a51d8964  rows=537980  columns=site_id, ts_start, nee, nee_qc, tsoil, swc, precip, ustar, sw_in, ppfd
    db/events.parquet  sha256=b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b  rows=114  columns=site_id, site_code, date, date_end, type
    calculated/fluxes_30min.parquet  sha256=6149ff22f5c114333a94e293247d6dd6385809a22ea2a7b1105e7ba3a35635ca  rows=537980  columns=site_id, ts_start, night, nee_fill, gpp

OUTPUTS
    results.json              all result numbers, figure captions and alt texts, dataVersion
    manifest.json             provenance of the run and SHA-256 of the outputs
    figures/1-reco-lag.svg    night Reco / model after the rain day, per site, 3 thresholds
    figures/2-reco-swc.svg    Reco pulse against the SWC anomaly of day -1 (5 mm events)
    figures/3-nee-lag.svg     NEE minus the pre-pulse mean after the rain day
    figures/4-nee-swc.svg     NEE pulse against the SWC anomaly (5 mm events)
    figures/5-gpp-lag.svg     GPP relative to the pre-pulse after the rain day
    figures/6-gpp-swc.svg     GPP pulse against the SWC anomaly (5 mm events)
    output/run.log            run log (not in git)
    output/events.csv         all used events with the pulses (not in git)
    With --check, all outputs go to output/ and the script compares them with the committed files.

RUN
    uv run analysis/rain-pulse/rain-pulse.py --db db --calculated data/calculated

NOTES
    Measured flag: the plan said "Maktau: nee IS NOT NULL". The script uses nee_fill = "measured"
    of the calculated products at all sites. At the Finnish sites it is the same as nee_qc = 0.
    At Maktau it removes the half hours that the quality filter of the calculated products
    removes (SSITC, plausibility, u*); the same filter makes the Maktau GPP and Reco.
    Rows with tsoil <= 0 C: the script does not delete these rows, because then a day would lose
    its rain half hours. It removes them from the flux responses only.
    Rules that the plan did not give: daily SWC needs 24 or more half hours; the Reco ratio needs
    a pre-pulse mean > 0; the f of the hour-weighted NEE uses only the half hours with a night
    flag; the u* rule also applies to the night NEE mean; the fits use season nights only.
    Changes after the first review (2026-10-28): night of day d = night after day d (Reco only),
    E0 validity and the own / site / pooled chain for E0 (Rref always of the site-year), GPP as a difference (not a ratio), the
    pre-pulse sensitivity with 1 of 3 days.
    Figures: the lag figures have one style legend above the panels and the n of day 0 for
    2, 5 and 10 mm in each panel, because n differs per site.
    The own fit can stop at a bound of E0_BOUNDS (fits.<site>.<year>.own.e0AtBound). A negative
    E0 (for example Maktau in dry years) shows that the night respiration falls when the soil
    gets warm and dry; the validity rule of METHOD step 4 then replaces the own fit.
    No literature default E0 is used: the pooled E0 comes from the data of this dive.
    The local days of Anttila, Sarkisuo and Viikki start at 02:00 true local time (ANT-01, SAR-01,
    VII-01). The night flag comes from the radiation and does not move.
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
from matplotlib.lines import Line2D
from scipy import stats
from scipy.optimize import OptimizeWarning, curve_fit

SLUG = "rain-pulse"
SCRIPT_PATH = f"analysis/{SLUG}/{SLUG}.py"
ARTICLE_URL = f"https://inar.rjuho.dev/deep-dive/{SLUG}/"
SVG_ID_PREFIX = "rp"

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
    """One input file. `root` is "db" or "calculated" (--db, --calculated)."""

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
        (
            "site_id",
            "ts_start",
            "nee",
            "nee_qc",
            "tsoil",
            "swc",
            "precip",
            "ustar",
            "sw_in",
            "ppfd",
        ),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "db",
        "events.parquet",
        "b2cbe1a7e5de79406bdeb49b14b7b80048990fb432baf346d073ef2443a2cb8b",
        114,
        ("site_id", "site_code", "date", "date_end", "type"),
        "2026-10-23T19:03:07.928Z",
    ),
    InputFile(
        "calculated",
        "fluxes_30min.parquet",
        "6149ff22f5c114333a94e293247d6dd6385809a22ea2a7b1105e7ba3a35635ca",
        537980,
        ("site_id", "ts_start", "night", "nee_fill", "gpp"),
        "2026-10-23T19:03:09.003Z",
    ),
)

# Units that the script expects in db/variables.parquet and in the key/value metadata of
# fluxes_30min.parquet (unit_<column>). The script does not convert a unit.
EXPECTED_UNITS = {
    "ts_start": "UTC",
    "nee": "µmol CO2 m-2 s-1",
    "tsoil": "°C",
    "swc": "m3 m-3",
    "precip": "mm",
    "ustar": "m s-1",
    "sw_in": "W m-2",
    "ppfd": "µmol m-2 s-1",
}
EXPECTED_CALC_UNITS = {"unit_gpp": "µmol CO2 m-2 s-1", "unit_ts_start": "UTC"}

# ---------- Method constants ----------
ALL_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
ALL_YEAR_SITES = frozenset({"maktau"})  # no season limit
SEASON_MONTHS = (5, 6, 7, 8, 9)  # Finnish sites: 1 May to 30 September
RAIN_PROXY = {"haltiala": "viikki"}  # Haltiala has no rain gauge
LIGHT_VAR = {
    "anttila": "ppfd",
    "sarkisuo": "ppfd",
    "haltiala": "ppfd",
    "qvidja": "sw_in",
    "viikki": "ppfd",
    "maktau": "sw_in",
}
USTAR_SITES = frozenset({"qvidja", "maktau"})
USTAR_MIN = 0.10  # m s-1
TSOIL_MIN = (
    0.0  # half hours with tsoil <= TSOIL_MIN are not used for the flux responses
)
HALF_HOURS_PER_DAY = 48
MIN_PRECIP_HH = 40
MIN_SWC_HH = 24
MIN_NIGHT_HH = 4
MIN_DAY_HH = 8
T_REF = 15.0  # C
T0 = -46.02  # C
E0_START = 100.0  # K
E0_BOUNDS = (-100.0, 1000.0)  # K, as fitLloydTaylor in scripts/lib/calc/lloyd-taylor.ts
TRIM_PERCENT = 5.0
FIT_MIN_N = 100
FIT_MIN_RANGE = 5.0  # K
# A fitted E0 is valid when E0 - SE > E0_VALID[0] and E0 + SE < E0_VALID[1] (the limits for soil
# temperature of the calculated products, docs/calculated.md section 4, constants e0.limits).
E0_VALID = (30.0, 550.0)
FIT_METHODS = ("own", "site", "pooled", "none")
NIGHT_SPLIT_HOUR = (
    12  # night half hours with local hour < 12 belong to the previous day
)
THRESHOLDS = (2.0, 5.0, 10.0)  # mm
MAIN_T = 5.0
LAG_MIN = -3
LAG_MAX = 15
LAGS = tuple(range(LAG_MIN, LAG_MAX + 1))
PRE_LAGS = (-3, -2, -1)
PULSE_LAGS = (0, 1, 2)
MIN_PRE_DAYS = 2
MIN_PRE_DAYS_SENSITIVITY = 1
MIN_PULSE_DAYS = 2
MIN_COMPOSITE_N = 5
MIN_RELATION_N = 3
SWC_RISE = 0.01  # m3 m-3, Haltiala check
MGMT_TYPES = ("harvest", "cut", "grazing", "tillage", "sowing")
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
VARIABLES = ("reco", "nee", "gpp")
NORM_KIND = {"reco": "ratio", "nee": "diff", "gpp": "diff"}
VAR_UNIT = {
    "reco": "ratio to the pre-pulse mean (1)",
    "nee": "µmol CO2 m-2 s-1, difference to the pre-pulse mean",
    "gpp": "µmol CO2 m-2 s-1, difference to the pre-pulse mean",
}
SIG_DIGITS = 10
CHECK_RTOL = 1e-6
CHECK_ATOL = 1e-9

# Values from the method description of the calculated products. The script reads the same
# Lloyd-Taylor constants from the metadata of fluxes_30min.parquet and stops when they differ.
LITERATURE: tuple[dict[str, Any], ...] = (
    {
        "key": "lloydTaylorTref",
        "text": "Reco(T) = Rref · exp(E0 · (1/(Tref − T0) − 1/(T − T0))), Tref = 15 °C",
        "value": T_REF,
        "unit": "°C",
        "uncertainty": None,
        "ref": "calculated-doc",
        "section": "4. Night-time partitioning (Reichstein et al. 2005)",
        "page": "docs/calculated.md section 4 (no printed pages)",
        "tableFigure": None,
    },
    {
        "key": "lloydTaylorT0",
        "text": "T0 = −46.02 °C",
        "value": T0,
        "unit": "°C",
        "uncertainty": None,
        "ref": "calculated-doc",
        "section": "4. Night-time partitioning (Reichstein et al. 2005)",
        "page": "docs/calculated.md section 4 (no printed pages)",
        "tableFigure": None,
    },
    {
        "key": "ustarThreshold",
        "text": "At the sites with u* (Qvidja, Maktau), rows with ustar < 0.10 m s-1 are left out",
        "value": USTAR_MIN,
        "unit": "m s-1",
        "uncertainty": None,
        "ref": "calculated-doc",
        "section": "4. Night-time partitioning, step 1",
        "page": "docs/calculated.md section 4 (no printed pages)",
        "tableFigure": None,
    },
)

OPEN_FINDINGS = (
    (
        "ANT-01, SAR-01, VII-01 (verified, waits for the providers): the raw stamps of Anttila, "
        "Sarkisuo and Viikki are UTC, but the build reads them as UTC+2. A local day of these "
        "sites thus holds the hours 02:00 to 02:00 true local time: the day boundary of the rain "
        "sum and of the daily NEE moves by 2 hours. The night flag comes from the radiation and "
        "does not move. Haltiala uses the Viikki rain days, thus its rain days also start at "
        "02:00."
    ),
    (
        "QVI-08 (new, ask the provider): the Qvidja rain gauge has a gap from 2021-12-29 to "
        "2022-05-24. Days with fewer than 40 rain half hours have no rain value; an event "
        "stops there and no event starts there."
    ),
    (
        "QVI-09 (known): all Qvidja meteorology is lost from 2023-02-11 to 2023-03-01. This is "
        "outside the season and does not touch the events."
    ),
    (
        "QVI-16 (open) and QVI-03 (known): the Qvidja swc in frozen soil is not reliable. The "
        "season (May to September) has no frozen soil; the site median of the SWC uses season "
        "days only."
    ),
    (
        "MKT-01 (handled in the build): the Maktau logger stored day-time meteo rows only from "
        "2023-07 to 2024-01; precip and tsoil are NULL in the fill rows (rain 2023 covers 33 % "
        "of the year). Days with fewer than 40 rain half hours have no rain value, thus the "
        "events stop there; without night tsoil there is no night Reco ratio."
    ),
    (
        "MKT-03 (new, ask the provider): the Maktau flux repeats one value for up to 25 half "
        "hours in 2024-04 to 2024-07 (11 % of the 2024 NEE). These values stay in the measured "
        "half hours."
    ),
)

# ---------- Figures ----------
# Body font of site/src/styles/global.css, then the emoji fonts of the Tailwind font-sans stack
# (CLAUDE.md), so that a browser draws the site emojis of the panel titles with a colour emoji
# font. Single quotes around the names: the stack goes into a style="..." attribute of the SVG.
FONT_STACK = (
    "system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', "
    "'Noto Color Emoji'"
)
FONT_SCALE = 1.5  # fonts for slides: 1.5 x the dive default
# Site colour, marker and dash: the slot of the site in db/sites.parquet, as siteColors(),
# siteSymbol() and siteDash() in site/src/scripts/diagrams/common.ts (Okabe-Ito).
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
SITE_DASHES: tuple[tuple[float, ...] | None, ...] = (
    None,
    (6, 3),
    (2, 2),
    (8, 3, 2, 3),
    (12, 4),
    (2, 5),
)
# Site emojis of the panel titles (source: SITE_EMOJI in site/src/scripts/sites.ts). The
# <title> and <desc> keep the plain names, because a screen reader reads emojis aloud.
SITE_EMOJI = {
    "anttila": "👱🏻‍♂️🫛",
    "sarkisuo": "🐟🌱",
    "haltiala": "🧚🌾",
    "qvidja": "🐂🐝",
    "viikki": "👩🏻‍🔬🎓",
    "maktau": "🇰🇪🌽",
}
TITLE_SUFFIX = {"haltiala": " (Viikki rain)"}
# DejaVu Sans has no glyph for the emojis (also not for the zero width joiner, the skin tone,
# the variation selector and the regional indicators): matplotlib warns "Glyph <code point> ...
# missing from font(s)" at savefig. save_svg() silences only these warnings; the browser draws
# the emojis with a colour emoji font of FONT_STACK.
EMOJI_GLYPH_WARNING = (
    "^Glyph ("
    + "|".join(
        str(cp) for cp in sorted({ord(c) for e in SITE_EMOJI.values() for c in e})
    )
    + r") \(.*\) missing from font"
)
INK = "#222222"
GUIDE = "#888888"
GUIDE_TEXT = "#555555"
DAY0_BAND = "#ececec"
LINE_WIDTH = 2.2
THIN_WIDTH = 1.3
LINE_MARKER_SIZE = 5.0
SCATTER_SIZE = 42
BAND_ALPHA = 0.2
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
LAG_HEIGHT_IN = 145 * MM
SWC_HEIGHT_IN = 135 * MM
FIGURES = (
    (1, "reco-lag", "reco", "lag"),
    (2, "reco-swc", "reco", "swc"),
    (3, "nee-lag", "nee", "lag"),
    (4, "nee-swc", "nee", "swc"),
    (5, "gpp-lag", "gpp", "lag"),
    (6, "gpp-swc", "gpp", "swc"),
)
X_LABEL_LAG = "Days since the rain day (local days: Finland UTC+2, Maktau UTC+3)"
X_LABEL_SWC = r"SWC on day −1 minus the site median (m$^3$ m$^{-3}$)"
Y_LABEL_LAG = {
    "reco": "Night Reco / temperature model,\nrelative to days −3 to −1",
    "nee": "NEE − mean of days −3 to −1\n" + r"($\mu$mol CO$_2$ m$^{-2}$ s$^{-1}$)",
    "gpp": "GPP − pre-pulse mean\n" + r"($\mu$mol CO$_2$ m$^{-2}$ s$^{-1}$)",
}
Y_LABEL_SWC = {
    "reco": "Reco pulse: mean of days 0 to 2\n(relative to days −3 to −1)",
    "nee": "NEE pulse\n" + r"($\mu$mol CO$_2$ m$^{-2}$ s$^{-1}$)",
    "gpp": "GPP pulse\n" + r"($\mu$mol CO$_2$ m$^{-2}$ s$^{-1}$)",
}
Y_TEXT = {
    "reco": (
        "night Reco divided by the temperature model, relative to the mean of days −3 to −1 "
        "(the night of day d runs from the evening of day d to the morning of day d + 1)"
    ),
    "nee": "daily NEE minus the mean of days −3 to −1, in µmol CO2 m-2 s-1",
    "gpp": (
        "daily GPP of the measured day half hours minus the mean of days −3 to −1, in "
        "µmol CO2 m-2 s-1"
    ),
}
VAR_NAME = {
    "reco": "night Reco relative to the temperature model",
    "nee": "daily NEE",
    "gpp": "daily GPP",
}
THRESHOLD_STYLE = {
    2.0: {"label": "≥ 2 mm", "ls": ":", "lw": THIN_WIDTH, "fill": True, "light": True},
    5.0: {"label": "≥ 5 mm", "ls": "-", "lw": LINE_WIDTH, "fill": True, "light": False},
    10.0: {
        "label": "≥ 10 mm",
        "ls": "--",
        "lw": THIN_WIDTH,
        "fill": False,
        "light": False,
    },
}
FIG_TITLES = {
    "reco-lag": (
        "Night Reco relative to the soil temperature model, before and after a rain day, mean of "
        "the events per site and threshold (2, 5 and 10 mm)."
    ),
    "reco-swc": (
        "Night Reco pulse (mean of days 0 to 2) against the soil water content anomaly before "
        "the rain, one marker per 5 mm event."
    ),
    "nee-lag": (
        "Daily NEE minus the pre-pulse mean, before and after a rain day, mean of the events per "
        "site and threshold (2, 5 and 10 mm)."
    ),
    "nee-swc": (
        "Daily NEE pulse (mean of days 0 to 2 minus the pre-pulse mean) against the soil water "
        "content anomaly before the rain, one marker per 5 mm event."
    ),
    "gpp-lag": (
        "Daily GPP minus the pre-pulse mean, before and after a rain day, mean of the events per "
        "site and threshold (2, 5 and 10 mm)."
    ),
    "gpp-swc": (
        "Daily GPP pulse (mean of days 0 to 2 minus the pre-pulse mean) against the soil water "
        "content anomaly before the rain, one marker per 5 mm event."
    ),
}

log = logging.getLogger(SLUG)
EPOCH = date(1970, 1, 1)


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
    return {"db": db, "calculated": calculated}[inp.root] / inp.file


def parquet_kv(path: Path) -> dict[str, str]:
    meta = pq.read_metadata(path)
    return {k.decode(): v.decode() for k, v in (meta.metadata or {}).items()}


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
        built = parquet_kv(path).get("built_at")
        if built != inp.built_at:
            errors.append(
                f"{inp.key}: built_at expected {inp.built_at}, actual {built}"
            )
        rows = pq.read_metadata(path).num_rows
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


def tkey(t: float) -> str:
    """Key of a rain threshold in results.json, for example "t5"."""
    return f"t{t:g}"


def day_number(d: date) -> int:
    return (d - EPOCH).days


def day_date(n: int) -> date:
    return EPOCH + timedelta(days=int(n))


def as_date(x: Any) -> date:
    """A date value of a Parquet column as datetime.date."""
    ts = pd.Timestamp(x)
    if not isinstance(ts, pd.Timestamp):
        raise InputError(f"not a date: {x!r}")
    return date(ts.year, ts.month, ts.day)


def masked(df: pd.DataFrame, name: str, m: pd.Series, dtype: Any = float) -> np.ndarray:
    """The values of one column in the rows of the mask, as an array."""
    return np.asarray(col(df, name).loc[m], dtype=dtype)


def finite_mean(v: np.ndarray, min_n: int) -> float:
    """Mean of the finite values; NaN with fewer than `min_n` finite values."""
    ok = np.isfinite(v)
    return float(v[ok].mean()) if int(ok.sum()) >= min_n else math.nan


def lt_g(t: np.ndarray) -> np.ndarray:
    """g(T) = 1/(Tref - T0) - 1/(T - T0) of the Lloyd-Taylor model."""
    return 1.0 / (T_REF - T0) - 1.0 / (t - T0)


def lt_model(t: np.ndarray, rref: float, e0: float) -> np.ndarray:
    return rref * np.exp(e0 * lt_g(t))


def lt_standard_errors(
    t: np.ndarray, r: np.ndarray, rref: float, e0: float
) -> tuple[float, float]:
    """SE of Rref and E0 from the Jacobian at the solution: cov = s2 (J'J)^-1, s2 = SSR/(n-2)."""
    g = lt_g(t)
    f = np.exp(e0 * g)
    j2 = rref * g * f
    a, b, c = float((f * f).sum()), float((f * j2).sum()), float((j2 * j2).sum())
    n = t.size
    det = a * c - b * b
    if n <= 2 or det <= 0:
        return math.nan, math.nan
    s2 = float(((r - rref * f) ** 2).sum()) / (n - 2)
    return math.sqrt(s2 * c / det), math.sqrt(s2 * a / det)


def fit_lt_once(t: np.ndarray, r: np.ndarray, e0_start: float) -> tuple[float, float]:
    """Least-squares fit of Rref and E0 (curve_fit, trust region, E0 within E0_BOUNDS)."""
    e0_start = min(max(e0_start, E0_BOUNDS[0] + 1), E0_BOUNDS[1] - 1)
    f = np.exp(e0_start * lt_g(t))
    rref0 = float((r * f).sum() / (f * f).sum())
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", OptimizeWarning)
        popt, _ = curve_fit(
            lt_model,
            t,
            r,
            p0=[rref0, e0_start],
            bounds=([-np.inf, E0_BOUNDS[0]], [np.inf, E0_BOUNDS[1]]),
            method="trf",
            max_nfev=10000,
        )
    return float(popt[0]), float(popt[1])


def fit_lloyd_taylor(
    t: Sequence[float] | np.ndarray, r: Sequence[float] | np.ndarray
) -> dict[str, Any]:
    """Fit, drop the residuals outside the TRIM_PERCENT to 100 - TRIM_PERCENT percentiles, fit
    again (as fitLloydTaylorTrimmed in scripts/lib/calc/lloyd-taylor.ts). RMSE and the SE are of
    the second fit on the kept values."""
    ta, ra = np.asarray(t, dtype=float), np.asarray(r, dtype=float)
    rref1, e01 = fit_lt_once(ta, ra, E0_START)
    res = ra - lt_model(ta, rref1, e01)
    lo, hi = np.percentile(res, [TRIM_PERCENT, 100 - TRIM_PERCENT])
    keep = (res >= lo) & (res <= hi)
    if int(keep.sum()) < 3:
        tk, rk, rref, e0 = ta, ra, rref1, e01
    else:
        tk, rk = ta[keep], ra[keep]
        rref, e0 = fit_lt_once(tk, rk, e01)
    se_rref, se_e0 = lt_standard_errors(tk, rk, rref, e0)
    rmse = float(np.sqrt(np.mean((rk - lt_model(tk, rref, e0)) ** 2)))
    return {
        "e0": e0,
        "e0AtBound": bool(min(abs(e0 - b) for b in E0_BOUNDS) < 1e-6),
        "e0Se": se_e0,
        "rref": rref,
        "rrefSe": se_rref,
        "n": int(tk.size),
        "nSample": int(ta.size),
        "rmse": rmse,
        "tsoilMin": float(ta.min()),
        "tsoilMax": float(ta.max()),
    }


def e0_valid(e0: float | None, se: float | None) -> bool:
    """E0 is valid when E0 - SE > E0_VALID[0] and E0 + SE < E0_VALID[1] (SE finite)."""
    if e0 is None or se is None or not (math.isfinite(e0) and math.isfinite(se)):
        return False
    return e0 - se > E0_VALID[0] and e0 + se < E0_VALID[1]


def fit_rref_fixed(
    t: Sequence[float] | np.ndarray, r: Sequence[float] | np.ndarray, e0: float
) -> dict[str, Any]:
    """Rref for a fixed E0, closed form as fitRref in scripts/lib/calc/lloyd-taylor.ts:
    Rref = sum(R f) / sum(f^2), f = exp(E0 g(T)); SE = sqrt(s2 / sum(f^2)), s2 = SSR / (n - 1)."""
    ta, ra = np.asarray(t, dtype=float), np.asarray(r, dtype=float)
    f = np.exp(e0 * lt_g(ta))
    sf2 = float((f * f).sum())
    rref = float((ra * f).sum()) / sf2 if sf2 > 0 else math.nan
    ssr = float(((ra - rref * f) ** 2).sum())
    n = int(ta.size)
    se = math.sqrt(ssr / (n - 1) / sf2) if n > 1 and sf2 > 0 else math.nan
    return {"rref": rref, "rrefSe": se, "n": n}


def fit_usable(t: np.ndarray) -> bool:
    """A site-year gets its own fit with FIT_MIN_N or more values and a tsoil range of
    FIT_MIN_RANGE or more."""
    return t.size >= FIT_MIN_N and float(t.max() - t.min()) >= FIT_MIN_RANGE


def hour_weighted_nee(
    night_mean: float, day_mean: float, n_night_flag: float, n_flag: float
) -> float:
    """Daily NEE = f x night mean + (1 - f) x day mean, f = night share of the flagged half
    hours of the day."""
    if not (math.isfinite(night_mean) and math.isfinite(day_mean)) or n_flag <= 0:
        return math.nan
    f = n_night_flag / n_flag
    return f * night_mean + (1 - f) * day_mean


@dataclass(frozen=True)
class RainEvent:
    i: int  # position of day 0 in the day arrays
    day0: int  # local day number of day 0
    last_lag: int  # last lag in the event (0 to LAG_MAX)
    stop: str  # why the event stops: "rain", "missing", "season", "window"
    rain0: float


def find_events(
    day: np.ndarray,
    rain: np.ndarray,
    season: np.ndarray,
    threshold: float,
    mgmt_days: frozenset[int] = frozenset(),
    swc: np.ndarray | None = None,
) -> tuple[list[RainEvent], dict[str, Any]]:
    """Rain events of one site and threshold (METHOD step 6).

    The arrays are one value per consecutive local day. `rain` NaN = no rain value. `swc` is
    given only for the SWC-rise check (Haltiala). Returns the kept events and the counts
    found, droppedManagement, droppedSwcCheck and the dropped day-0 days."""
    if day.size and not np.array_equal(day, np.arange(day[0], day[0] + day.size)):
        raise ValueError("find_events: days are not consecutive")
    n = day.size
    wet = np.isfinite(rain) & (rain >= threshold)
    dry = np.isfinite(rain) & (rain < threshold)
    found: list[RainEvent] = []
    for i in range(-LAG_MIN, n):
        if not (season[i] and wet[i] and dry[i + LAG_MIN : i].all()):
            continue
        last, stop = 0, "window"
        for k in range(1, LAG_MAX + 1):
            j = i + k
            if j >= n or not np.isfinite(rain[j]):
                stop = "missing"
                break
            if not season[j]:
                stop = "season"
                break
            if rain[j] >= threshold:
                stop = "rain"
                break
            last = k
        found.append(RainEvent(i, int(day[i]), last, stop, float(rain[i])))
    kept: list[RainEvent] = []
    dropped: list[dict[str, Any]] = []
    for ev in found:
        window = range(ev.day0 + LAG_MIN, ev.day0 + LAG_MAX + 1)
        if any(d in mgmt_days for d in window):
            dropped.append({"day0": ev.day0, "reason": "management"})
            continue
        if swc is not None:
            i = ev.i
            before = swc[i - 1]
            after = [swc[j] for j in (i, i + 1) if j < n]
            ok = math.isfinite(before) and any(
                math.isfinite(a) and a - before >= SWC_RISE - 1e-12 for a in after
            )
            if not ok:
                dropped.append({"day0": ev.day0, "reason": "swc check"})
                continue
        kept.append(ev)
    counts = {
        "found": len(found),
        "droppedManagement": sum(1 for d in dropped if d["reason"] == "management"),
        "droppedSwcCheck": sum(1 for d in dropped if d["reason"] == "swc check"),
        "kept": len(kept),
        "dropped": dropped,
    }
    return kept, counts


def normalise_events(
    values: np.ndarray,
    events: Sequence[RainEvent],
    kind: str,
    min_pre: int = MIN_PRE_DAYS,
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """Normalised values per event (rows) and lag LAG_MIN..LAG_MAX (columns), METHOD step 7.

    kind "ratio": value / pre-pulse mean (needs a mean > 0); "diff": value - pre-pulse mean.
    Lags after the end of the event are NaN. Returns the matrix, the pre-pulse means and the
    counts of events without a pre-pulse mean."""
    if kind not in ("ratio", "diff"):
        raise ValueError(f"normalise_events: kind {kind}")
    n_lag = len(LAGS)
    out = np.full((len(events), n_lag), np.nan)
    pre = np.full(len(events), np.nan)
    counts = {"noPrePulse": 0, "prePulseNotPositive": 0}
    for e, ev in enumerate(events):
        p = finite_mean(values[ev.i + LAG_MIN : ev.i], min_pre)
        if not math.isfinite(p):
            counts["noPrePulse"] += 1
            continue
        if kind == "ratio" and p <= 0:
            counts["prePulseNotPositive"] += 1
            continue
        pre[e] = p
        for c, lag in enumerate(LAGS):
            if lag > ev.last_lag:
                break
            v = values[ev.i + lag]
            if math.isfinite(v):
                out[e, c] = v / p if kind == "ratio" else v - p
    return out, pre, counts


def event_used(row: np.ndarray) -> bool:
    """An event is used for a variable when it has a pre-pulse mean (row not all NaN) and one or
    more values on days 0 to LAG_MAX."""
    return bool(np.isfinite(row[-LAG_MIN:]).any())


def composite(matrix: np.ndarray) -> dict[str, Any]:
    """Mean, SD (n - 1), SE and n per lag; shown = n >= MIN_COMPOSITE_N."""
    mean: list[float | None] = []
    sd: list[float | None] = []
    se: list[float | None] = []
    ns: list[int] = []
    for c in range(len(LAGS)):
        v = matrix[:, c] if matrix.size else np.array([])
        v = v[np.isfinite(v)]
        n = int(v.size)
        ns.append(n)
        mean.append(float(v.mean()) if n else None)
        s = float(v.std(ddof=1)) if n >= 2 else None
        sd.append(s)
        se.append(None if s is None else s / math.sqrt(n))
    return {
        "lag": list(LAGS),
        "mean": mean,
        "sd": sd,
        "se": se,
        "n": ns,
        "shown": [n >= MIN_COMPOSITE_N for n in ns],
    }


def pulse_sizes(matrix: np.ndarray) -> np.ndarray:
    """Pulse per event = mean of the normalised values of days 0 to 2 (2 or more of 3)."""
    cols = [LAGS.index(k) for k in PULSE_LAGS]
    return np.array(
        [finite_mean(row[cols], MIN_PULSE_DAYS) for row in matrix], dtype=float
    )


def stat_pair(res: Any) -> tuple[float, float]:
    """Statistic and p value of a scipy.stats result (a tuple-like object)."""
    return float(np.asarray(res[0])), float(np.asarray(res[1]))


def swc_relation(x: Sequence[float], y: Sequence[float]) -> dict[str, Any]:
    """OLS y = slope x + intercept (statsmodels), Pearson r and Spearman rho with p, n."""
    xa, ya = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    ok = np.isfinite(xa) & np.isfinite(ya)
    xa, ya = xa[ok], ya[ok]
    n = int(xa.size)
    empty: dict[str, Any] = {
        "n": n,
        "slope": None,
        "slopeSe": None,
        "slopeP": None,
        "intercept": None,
        "r": None,
        "rP": None,
        "rho": None,
        "rhoP": None,
        "xMin": float(xa.min()) if n else None,
        "xMax": float(xa.max()) if n else None,
    }
    if n < MIN_RELATION_N or float(np.ptp(xa)) == 0 or float(np.ptp(ya)) == 0:
        return empty
    fit = sm.OLS(ya, sm.add_constant(xa)).fit()
    params = np.asarray(fit.params, dtype=float)
    bse = np.asarray(fit.bse, dtype=float)
    pvalues = np.asarray(fit.pvalues, dtype=float)
    pr = stats.pearsonr(xa, ya)
    sr = stats.spearmanr(xa, ya)
    return {
        **empty,
        "slope": float(params[1]),
        "slopeSe": float(bse[1]),
        "slopeP": float(pvalues[1]),
        "intercept": float(params[0]),
        "r": stat_pair(pr)[0],
        "rP": stat_pair(pr)[1],
        "rho": stat_pair(sr)[0],
        "rhoP": stat_pair(sr)[1],
    }


def plain_stats(values: np.ndarray) -> dict[str, Any]:
    v = values[np.isfinite(values)]
    n = int(v.size)
    sd = float(v.std(ddof=1)) if n >= 2 else None
    return {
        "mean": float(v.mean()) if n else None,
        "sd": sd,
        "se": None if sd is None else sd / math.sqrt(n),
        "n": n,
    }


# ======================================================================================
# Read
# ======================================================================================
HH_SCHEMA = pa.DataFrameSchema(
    {
        "site_id": pa.Column(int, pa.Check.isin(list(range(1, 7)))),
        "nee": pa.Column(float, nullable=True),
        "tsoil": pa.Column(float, pa.Check.in_range(-40, 70), nullable=True),
        "swc": pa.Column(float, pa.Check.in_range(0, 1), nullable=True),
        "precip": pa.Column(float, pa.Check.ge(0), nullable=True),
        "ustar": pa.Column(float, pa.Check.ge(0), nullable=True),
        "gpp": pa.Column(float, nullable=True),
        "nee_fill": pa.Column(
            object, pa.Check.isin(["measured", "source", "mds"]), nullable=True
        ),
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


def columns_of(key: str) -> list[str]:
    return list(next(i for i in INPUTS if i.key == key).columns)


def local_minutes(ts_utc: pd.Series, offset_min: pd.Series) -> np.ndarray:
    """Minutes since 1970-01-01 00:00 local time of UTC period starts (ts + offset)."""
    if ts_utc.dt.tz is None:
        ts_utc = ts_utc.dt.tz_localize("UTC")
    elif str(ts_utc.dt.tz) != "UTC":
        raise InputError(f"ts_start has the time zone {ts_utc.dt.tz}, expected UTC")
    local = ts_utc + pd.to_timedelta(offset_min.to_numpy(dtype=np.int64), unit="m")
    epoch = pd.Timestamp("1970-01-01", tz="UTC")
    return ((local - epoch) // pd.Timedelta(minutes=1)).to_numpy(dtype=np.int64)


def local_days(ts_utc: pd.Series, offset_min: pd.Series) -> np.ndarray:
    """Local day numbers of UTC period starts: floor((ts + offset) / 1 day)."""
    return local_minutes(ts_utc, offset_min) // 1440


def night_days(day: np.ndarray, hour: np.ndarray) -> np.ndarray:
    """The day of a night half hour (METHOD step 5): a half hour with local hour < 12 belongs
    to the night of the previous local day, so the night of day d runs from the evening of day
    d to the morning of day d + 1."""
    return day - (hour < NIGHT_SPLIT_HOUR).astype(np.int64)


def in_season(site: str, days: np.ndarray) -> np.ndarray:
    """True for the season days of the site (METHOD step 2)."""
    if site in ALL_YEAR_SITES:
        return np.ones(days.size, dtype=bool)
    months = pd.to_datetime(days, unit="D", origin="unix").month.to_numpy(
        dtype=np.int64
    )
    return np.isin(months, SEASON_MONTHS)


@dataclass
class Data:
    names: dict[str, str]
    slots: dict[str, int]
    hh: pd.DataFrame
    mgmt: dict[str, frozenset[int]]
    steps: dict[str, Any]


def check_units(db: Path, calculated: Path, steps: dict[str, Any]) -> None:
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
    kv = parquet_kv(calculated / "fluxes_30min.parquet")
    for name, unit in EXPECTED_CALC_UNITS.items():
        if kv.get(name) != unit:
            raise InputError(
                f"fluxes_30min.parquet: {name} expected {unit!r}, actual {kv.get(name)!r}"
            )
    lt = json.loads(kv.get("constants", "{}")).get("lloydTaylor", {})
    if lt.get("tref") != T_REF or lt.get("t0") != T0:
        raise InputError(
            f"fluxes_30min.parquet: lloydTaylor constants {lt}, expected tref {T_REF}, t0 {T0}"
        )
    steps["units"] = {
        "observations": EXPECTED_UNITS,
        "calculated": EXPECTED_CALC_UNITS,
        "lloydTaylor": lt,
    }
    log.info(
        "units checked: %s; calculated %s; Lloyd-Taylor constants agree",
        ", ".join(f"{k} [{v}]" for k, v in EXPECTED_UNITS.items()),
        ", ".join(f"{k} [{v}]" for k, v in EXPECTED_CALC_UNITS.items()),
    )


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


def read_management(db: Path, steps: dict[str, Any]) -> dict[str, frozenset[int]]:
    """The local days covered by the management events of MGMT_TYPES, per site."""
    ev = pd.read_parquet(
        db / "events.parquet", columns=columns_of("db/events.parquet"), engine="pyarrow"
    )
    n_read = len(ev)
    ev["site_code"] = ev["site_code"].astype(str)
    ev["type"] = ev["type"].astype(str)
    bad = sorted(set(col(ev, "type")) - set(EVENT_TYPES))
    if bad:
        raise InputError(f"events.parquet: unknown types {bad}")
    ev = frame(ev[col(ev, "type").isin(MGMT_TYPES)])
    out: dict[str, set[int]] = {s: set() for s in ALL_SITES}
    per_site: dict[str, dict[str, Any]] = {
        s: {"events": 0, "first": None, "last": None} for s in ALL_SITES
    }
    for r in ev.to_dict("records"):
        site = str(r["site_code"])
        d0 = as_date(r["date"])
        d1 = d0 if pd.isna(r["date_end"]) else as_date(r["date_end"])
        out[site].update(range(day_number(d0), day_number(d1) + 1))
        ps = per_site[site]
        ps["events"] += 1
        ps["first"] = min(filter(None, [ps["first"], d0.isoformat()]))
        ps["last"] = max(filter(None, [ps["last"], d1.isoformat()]))
    steps["management"] = {
        "rowsRead": n_read,
        "rowsUsed": len(ev),
        "types": list(MGMT_TYPES),
        "perSite": per_site,
        "rule": "an event is dropped when its days -3 to +15 touch one of these days",
    }
    log.info(
        "events: %d rows read, %d of the types %s; per site: %s",
        n_read,
        len(ev),
        ", ".join(MGMT_TYPES),
        ", ".join(
            f"{s} {v['events']} ({v['first']} to {v['last']})"
            for s, v in per_site.items()
        ),
    )
    return {s: frozenset(v) for s, v in out.items()}


def read_half_hours(
    db: Path,
    calculated: Path,
    offsets: dict[str, int],
    site_ids: dict[str, int],
    steps: dict[str, Any],
) -> pd.DataFrame:
    obs = pd.read_parquet(
        db / "observations.parquet",
        columns=columns_of("db/observations.parquet"),
        engine="pyarrow",
    )
    flx = pd.read_parquet(
        calculated / "fluxes_30min.parquet",
        columns=columns_of("calculated/fluxes_30min.parquet"),
        engine="pyarrow",
    )
    n_obs, n_flx = len(obs), len(flx)
    hh = obs.merge(flx, on=["site_id", "ts_start"], how="inner", validate="one_to_one")
    if len(hh) != n_obs or len(hh) != n_flx:
        raise InputError(
            f"join: {n_obs} observation rows, {n_flx} flux rows, {len(hh)} joined rows"
        )
    hh["site_id"] = col(hh, "site_id").astype(np.int64)
    hh["nee_fill"] = col(hh, "nee_fill").astype(object)
    hh["nee_fill"] = col(hh, "nee_fill").where(col(hh, "nee_fill").notna(), None)
    for c in ("nee", "tsoil", "swc", "precip", "ustar", "sw_in", "ppfd", "gpp"):
        hh[c] = col(hh, c).astype(float)
    hh = pd.DataFrame(HH_SCHEMA.validate(hh))
    code_of = {v: k for k, v in site_ids.items()}
    hh["site"] = col(hh, "site_id").map(code_of).astype(str)
    minutes = local_minutes(col(hh, "ts_start"), col(hh, "site").map(offsets))
    hh["day"] = minutes // 1440
    hh["hour"] = (minutes % 1440) / 60.0
    night = col(hh, "night").astype("boolean")
    hh["night_t"] = night.fillna(False).astype(bool)
    hh["day_t"] = (~night).fillna(False).astype(bool)
    hh["flag"] = night.notna().astype(bool)
    hh["measured"] = (col(hh, "nee_fill") == "measured").astype(bool)

    # The measured flag against nee_qc (Finnish sites) and against nee (Maktau).
    qc0 = (col(hh, "nee_qc").astype("Float64") == 0).fillna(False).astype(bool)
    has_nee = col(hh, "nee").notna()
    fin = col(hh, "site") != "maktau"
    mismatch = int(((fin & qc0 & has_nee) != (fin & col(hh, "measured"))).sum())
    if mismatch:
        raise InputError(
            f"measured flag: {mismatch} Finnish half hours with nee_fill measured != nee_qc 0"
        )
    mk = ~fin
    if int((mk & col(hh, "measured") & ~has_nee).sum()):
        raise InputError("measured flag: Maktau half hours measured without nee")
    mk_filtered = int((mk & has_nee & ~col(hh, "measured")).sum())

    hh["season"] = False
    for s in ALL_SITES:
        m = col(hh, "site") == s
        hh.loc[m, "season"] = in_season(s, masked(hh, "day", m, np.int64))
    tsoil_cold = (col(hh, "tsoil") <= TSOIL_MIN).fillna(False).astype(bool)
    hh["flux_ok"] = ~tsoil_cold
    ustar = col(hh, "ustar")
    hh["ustar_ok"] = ~(col(hh, "site").isin(USTAR_SITES) & (ustar < USTAR_MIN)).fillna(
        False
    ).astype(bool)

    per_site: dict[str, Any] = {}
    for s in ALL_SITES:
        m = col(hh, "site") == s
        sea = m & col(hh, "season")
        per_site[s] = {
            "rows": int(m.sum()),
            "seasonRows": int(sea.sum()),
            "measured": int((m & col(hh, "measured")).sum()),
            "seasonMeasured": int((sea & col(hh, "measured")).sum()),
            "seasonTsoilLe0": int((sea & tsoil_cold).sum()),
            "seasonTsoilLe0Measured": int(
                (sea & tsoil_cold & col(hh, "measured")).sum()
            ),
            "seasonUstarBelow": int((sea & ~col(hh, "ustar_ok")).sum()),
            "seasonMeasuredNightUstarBelow": int(
                (
                    sea
                    & col(hh, "measured")
                    & col(hh, "night_t")
                    & ~col(hh, "ustar_ok")
                ).sum()
            ),
        }
    steps["halfHours"] = {
        "observationRowsRead": n_obs,
        "fluxRowsRead": n_flx,
        "rowsAfterJoin": len(hh),
        "maktauNeeNotMeasured": mk_filtered,
        "perSite": per_site,
        "rule": (
            "inner join on site_id and ts_start (one to one); measured = nee_fill 'measured' "
            "(Finnish sites: equal to nee_qc = 0, checked); Maktau half hours with nee but not "
            "measured are removed by the quality filter of the calculated products; half hours "
            f"with tsoil <= {TSOIL_MIN:g} C are not used for the flux responses; night half hours "
            f"with u* < {USTAR_MIN} m s-1 at Qvidja and Maktau are not used"
        ),
    }
    log.info(
        "half hours: %d observation rows, %d flux rows, %d after the join; Maktau: %d half hours "
        "with nee are not measured after the quality filter of the calculated products",
        n_obs,
        n_flx,
        len(hh),
        mk_filtered,
    )
    for s, v in per_site.items():
        log.info(
            "  %s: %d rows, %d season rows (%d measured); tsoil <= 0 C in the season: %d rows "
            "(%d measured) not used for fluxes; u* < %.2f: %d season rows (%d measured night)",
            s,
            v["rows"],
            v["seasonRows"],
            v["seasonMeasured"],
            v["seasonTsoilLe0"],
            v["seasonTsoilLe0Measured"],
            USTAR_MIN,
            v["seasonUstarBelow"],
            v["seasonMeasuredNightUstarBelow"],
        )
    return hh


def read_data(db: Path, calculated: Path) -> Data:
    steps: dict[str, Any] = {}
    check_units(db, calculated, steps)
    names, offsets, site_ids = read_sites(db)
    slots = {s: i for i, s in enumerate(ALL_SITES)}
    steps["sites"] = {
        "rowsRead": len(names),
        "utcOffsetMin": offsets,
    }
    mgmt = read_management(db, steps)
    hh = read_half_hours(db, calculated, offsets, site_ids, steps)
    return Data(names, slots, hh, mgmt, steps)


# ======================================================================================
# Analysis
# ======================================================================================
def rmse_of(t: np.ndarray, r: np.ndarray, rref: float, e0: float) -> float | None:
    return float(np.sqrt(np.mean((r - lt_model(t, rref, e0)) ** 2))) if t.size else None


def choose_fit(
    own: dict[str, Any] | None,
    site_fit: dict[str, Any] | None,
    pooled_e0: float | None,
    t: np.ndarray,
    r: np.ndarray,
) -> dict[str, Any]:
    """The fit of one site-year by the chain own -> site -> pooled (METHOD step 4)."""
    if t.size == 0:
        return {"method": "none", "n": 0, "reason": "no night sample"}
    if own is not None and own["valid"]:
        return {
            "method": "own",
            "e0Source": "own",
            "e0": own["e0"],
            "e0Se": own["e0Se"],
            "rref": own["rref"],
            "rrefSe": own["rrefSe"],
            "n": own["n"],
            "reason": "own fit valid",
        }
    why = (
        "too few values or too small tsoil range" if own is None else "own E0 not valid"
    )
    if site_fit is not None and site_fit["valid"]:
        fr = fit_rref_fixed(t, r, site_fit["e0"])
        return {
            "method": "site",
            "e0Source": "site",
            "e0": site_fit["e0"],
            "e0Se": site_fit["e0Se"],
            "rref": fr["rref"],
            "rrefSe": fr["rrefSe"],
            "n": fr["n"],
            "reason": why + "; E0 of the site fit (valid), Rref fitted with E0 fixed",
        }
    if pooled_e0 is None:
        return {"method": "none", "n": int(t.size), "reason": why + "; no pooled E0"}
    fr = fit_rref_fixed(t, r, pooled_e0)
    return {
        "method": "pooled",
        "e0Source": "pooled",
        "e0": pooled_e0,
        "e0Se": None,
        "rref": fr["rref"],
        "rrefSe": fr["rrefSe"],
        "n": fr["n"],
        "reason": why
        + "; site fit "
        + ("not valid" if site_fit is not None else "not possible")
        + "; pooled E0, Rref fitted with E0 fixed",
    }


def fit_models(
    hh: pd.DataFrame, steps: dict[str, Any]
) -> tuple[dict[str, dict[str, Any]], dict[str, Any], float | None, pd.Series]:
    """Lloyd-Taylor fits per site-year (own, site or pooled, METHOD step 4); the model value of
    each half hour."""
    hh["year"] = pd.to_datetime(col(hh, "day"), unit="D", origin="unix").dt.year
    sample = (
        col(hh, "season")
        & col(hh, "measured")
        & col(hh, "flux_ok")
        & col(hh, "night_t")
        & col(hh, "ustar_ok")
        & col(hh, "tsoil").notna()
        & col(hh, "nee").notna()
    )
    hh["sample"] = sample
    counts: dict[str, Any] = {}
    site_fits: dict[str, Any] = {}
    own_fits: dict[str, dict[int, dict[str, Any] | None]] = {}
    arrays: dict[tuple[str, int], tuple[np.ndarray, np.ndarray]] = {}
    for s in ALL_SITES:
        ms = (col(hh, "site") == s) & sample
        t_all = masked(hh, "tsoil", ms)
        r_all = masked(hh, "nee", ms)
        counts[s] = {"nightSample": int(ms.sum())}
        if fit_usable(t_all):
            sf = fit_lloyd_taylor(t_all, r_all)
            sf["valid"] = e0_valid(sf["e0"], sf["e0Se"])
            site_fits[s] = sf
        else:
            site_fits[s] = None
        own_fits[s] = {}
        years = sorted(
            {
                int(y)
                for y in col(hh, "year")[(col(hh, "site") == s) & col(hh, "season")]
            }
        )
        for y in years:
            my = ms & (col(hh, "year") == y)
            t = masked(hh, "tsoil", my)
            r = masked(hh, "nee", my)
            arrays[(s, y)] = (t, r)
            if fit_usable(t):
                of = fit_lloyd_taylor(t, r)
                of["valid"] = e0_valid(of["e0"], of["e0Se"])
                own_fits[s][y] = of
            else:
                own_fits[s][y] = None
    valid_e0 = [
        f["e0"] for s in ALL_SITES for f in own_fits[s].values() if f and f["valid"]
    ]
    pooled_e0 = float(np.median(valid_e0)) if valid_e0 else None
    log.info(
        "pooled E0 = median of %d valid own site-year E0 values: %s K",
        len(valid_e0),
        "n/a" if pooled_e0 is None else f"{pooled_e0:.1f}",
    )
    model = pd.Series(np.nan, index=hh.index, dtype=float)
    fits: dict[str, dict[str, Any]] = {}
    for s in ALL_SITES:
        fits[s] = {}
        for y, own in own_fits[s].items():
            t, r = arrays[(s, y)]
            f = choose_fit(own, site_fits[s], pooled_e0, t, r)
            f["nSample"] = int(t.size)
            f["tsoilMin"] = float(t.min()) if t.size else None
            f["tsoilMax"] = float(t.max()) if t.size else None
            f["rmse"] = (
                rmse_of(t, r, f["rref"], f["e0"]) if f["method"] != "none" else None
            )
            f["own"] = (
                None
                if own is None
                else {
                    k: own[k]
                    for k in (
                        "e0",
                        "e0Se",
                        "e0AtBound",
                        "rref",
                        "rrefSe",
                        "n",
                        "rmse",
                        "valid",
                    )
                }
            )
            fits[s][str(y)] = f
            if f["method"] != "none":
                mrow = (col(hh, "site") == s) & (col(hh, "year") == y)
                model[mrow] = lt_model(masked(hh, "tsoil", mrow), f["rref"], f["e0"])
            log.info(
                "fit %s %d: %s (%s), n %d, E0 %s K, Rref %s; own E0 %s",
                s,
                y,
                f["method"],
                f["reason"],
                f["n"],
                "n/a" if f["method"] == "none" else f"{f['e0']:.1f}",
                "n/a" if f["method"] == "none" else f"{f['rref']:.3f}",
                "n/a"
                if own is None
                else f"{own['e0']:.1f} ± {own['e0Se']:.1f}"
                + (" (at the bound)" if own["e0AtBound"] else ""),
            )
    method_counts = {
        m: sum(1 for s in ALL_SITES for f in fits[s].values() if f["method"] == m)
        for m in FIT_METHODS
    }
    steps["fits"] = {
        "perSite": counts,
        "rule": (
            f"own fit with >= {FIT_MIN_N} night values and a tsoil range >= "
            f"{FIT_MIN_RANGE:g} K; valid when E0 - SE > {E0_VALID[0]:g} K and E0 + SE < "
            f"{E0_VALID[1]:g} K; else E0 of the site fit (all season nights) when valid; else "
            "the pooled E0 (median of the valid own E0); for site and pooled, Rref is fitted "
            "for the site-year with E0 fixed"
        ),
        "methodCounts": method_counts,
        "pooledE0": pooled_e0,
        "validOwnE0": len(valid_e0),
        "siteYears": {
            m: [
                f"{s} {y}"
                for s in ALL_SITES
                for y, f in fits[s].items()
                if f["method"] == m
            ]
            for m in FIT_METHODS
        },
        "siteYearsOwnE0AtBound": [
            f"{s} {y}"
            for s in ALL_SITES
            for y, f in fits[s].items()
            if f["own"] and f["own"]["e0AtBound"]
        ],
    }
    log.info(
        "fit methods: %s",
        ", ".join(f"{m} {n}" for m, n in method_counts.items()),
    )
    return fits, site_fits, pooled_e0, model


def daily_tables(
    hh: pd.DataFrame, model: pd.Series, steps: dict[str, Any]
) -> dict[str, pd.DataFrame]:
    """One row per site and consecutive local day with rain, swc and the responses."""
    meas = col(hh, "measured") & col(hh, "flux_ok")
    nv = meas & col(hh, "night_t") & col(hh, "ustar_ok") & col(hh, "nee").notna()
    # Reco sample: as the fit sample, but the season is applied to the night day (below).
    rs = nv & col(hh, "tsoil").notna() & model.notna()
    dv = meas & col(hh, "day_t") & col(hh, "nee").notna()
    light = pd.Series(np.nan, index=hh.index, dtype=float)
    for s, v in LIGHT_VAR.items():
        m = col(hh, "site") == s
        light[m] = col(hh, v)[m]
    g = pd.DataFrame(
        {
            "site": col(hh, "site"),
            "day": col(hh, "day"),
            "precip": col(hh, "precip"),
            "swc": col(hh, "swc"),
            "night_nee": col(hh, "nee").where(nv),
            "day_nee": col(hh, "nee").where(dv),
            "gpp": col(hh, "gpp").where(dv),
            "light": light.where(dv),
            "meas": meas.astype(float),
            "flag_night": (col(hh, "night_t") & col(hh, "flag")).astype(float),
            "flag": col(hh, "flag").astype(float),
        }
    )
    agg = (
        g.groupby(["site", "day"], sort=True)
        .agg(
            n_precip=("precip", "count"),
            rain=("precip", "sum"),
            n_swc=("swc", "count"),
            swc=("swc", "mean"),
            n_night=("night_nee", "count"),
            night_nee=("night_nee", "mean"),
            n_day=("day_nee", "count"),
            day_nee=("day_nee", "mean"),
            n_gpp=("gpp", "count"),
            gpp=("gpp", "mean"),
            n_light=("light", "count"),
            light=("light", "mean"),
            n_meas=("meas", "sum"),
            n_flag_night=("flag_night", "sum"),
            n_flag=("flag", "sum"),
        )
        .reset_index()
    )
    # Night Reco: night half hours with local hour < 12 belong to the previous day.
    rn = pd.DataFrame(
        {
            "site": masked(hh, "site", rs, object),
            "day": night_days(masked(hh, "day", rs, np.int64), masked(hh, "hour", rs)),
            "reco_obs": masked(hh, "nee", rs),
            "reco_mod": np.asarray(model.loc[rs], dtype=float),
        }
    )
    ragg = (
        rn.groupby(["site", "day"], sort=True)
        .agg(
            n_reco=("reco_obs", "count"),
            reco_obs=("reco_obs", "mean"),
            reco_mod=("reco_mod", "mean"),
        )
        .reset_index()
    )
    tables: dict[str, pd.DataFrame] = {}
    per_site: dict[str, Any] = {}
    for s in ALL_SITES:
        a = frame(agg[col(agg, "site") == s]).set_index("day")
        ra = frame(ragg[col(ragg, "site") == s]).set_index("day")
        a = frame(a.join(ra[["n_reco", "reco_obs", "reco_mod"]], how="outer"))
        days = np.arange(
            int(np.asarray(a.index).min()),
            int(np.asarray(a.index).max()) + 1,
            dtype=np.int64,
        )
        a = frame(a.reindex(days))
        t = pd.DataFrame(index=pd.Index(days, name="day"))
        t["season"] = in_season(s, days)
        n_precip = col(a, "n_precip").fillna(0).to_numpy(dtype=float)
        t["n_precip"] = n_precip
        t["rain"] = np.where(n_precip >= MIN_PRECIP_HH, col(a, "rain"), np.nan)
        t["swc"] = np.where(
            col(a, "n_swc").fillna(0) >= MIN_SWC_HH, col(a, "swc"), np.nan
        )
        reco_ok = (col(a, "n_reco").fillna(0) >= MIN_NIGHT_HH) & (
            col(a, "reco_mod") > 0
        )
        t["reco"] = np.where(reco_ok, col(a, "reco_obs") / col(a, "reco_mod"), np.nan)
        t["gpp"] = np.where(
            col(a, "n_gpp").fillna(0) >= MIN_DAY_HH, col(a, "gpp"), np.nan
        )
        nee_ok = (col(a, "n_night").fillna(0) >= MIN_NIGHT_HH) & (
            col(a, "n_day").fillna(0) >= MIN_DAY_HH
        )
        t["nee"] = [
            hour_weighted_nee(nm, dm, fn, fa) if ok else math.nan
            for nm, dm, fn, fa, ok in zip(
                col(a, "night_nee"),
                col(a, "day_nee"),
                col(a, "n_flag_night").fillna(0),
                col(a, "n_flag").fillna(0),
                nee_ok,
                strict=True,
            )
        ]
        t["light"] = np.where(
            col(a, "n_light").fillna(0) >= MIN_DAY_HH, col(a, "light"), np.nan
        )
        t["meas_frac"] = (
            col(a, "n_meas").fillna(0).to_numpy(dtype=float) / HALF_HOURS_PER_DAY
        )
        not_season = ~col(t, "season")
        n_reco_mod_le0 = int(
            (
                (col(a, "n_reco").fillna(0) >= MIN_NIGHT_HH) & ~(col(a, "reco_mod") > 0)
            ).sum()
        )
        for v in ("reco", "gpp", "nee", "light", "meas_frac"):
            t.loc[not_season, v] = np.nan
        tables[s] = t
        sea = col(t, "season")
        per_site[s] = {
            "days": len(t),
            "seasonDays": int(sea.sum()),
            "seasonDaysRain": int((sea & col(t, "rain").notna()).sum()),
            "seasonDaysSwc": int((sea & col(t, "swc").notna()).sum()),
            "daysReco": int(col(t, "reco").notna().sum()),
            "daysNee": int(col(t, "nee").notna().sum()),
            "daysGpp": int(col(t, "gpp").notna().sum()),
            "daysLight": int(col(t, "light").notna().sum()),
            "daysRecoModelNotPositive": n_reco_mod_le0,
        }
    # Haltiala: rain of Viikki on the same local day.
    for s, proxy in RAIN_PROXY.items():
        t = tables[s]
        p = tables[proxy]
        t["rain"] = col(p, "rain").reindex(t.index).to_numpy(dtype=float)
        t["n_precip"] = col(p, "n_precip").reindex(t.index).to_numpy(dtype=float)
        sea = col(t, "season")
        per_site[s]["seasonDaysRain"] = int((sea & col(t, "rain").notna()).sum())
        per_site[s]["rainSource"] = proxy
    steps["days"] = {
        "perSite": per_site,
        "rule": (
            f"rain needs >= {MIN_PRECIP_HH} precip half hours, swc >= {MIN_SWC_HH}, reco >= "
            f"{MIN_NIGHT_HH} night half hours of the night sample, gpp and light >= {MIN_DAY_HH} "
            f"measured day half hours, nee >= {MIN_NIGHT_HH} measured night and >= {MIN_DAY_HH} "
            "measured day half hours; responses on season days only"
        ),
    }
    for s, v in per_site.items():
        log.info(
            "days %s: %d season days, %d with rain%s, %d with swc; reco %d, nee %d, gpp %d, "
            "light %d days",
            s,
            v["seasonDays"],
            v["seasonDaysRain"],
            f" ({v['rainSource']} rain)" if "rainSource" in v else "",
            v["seasonDaysSwc"],
            v["daysReco"],
            v["daysNee"],
            v["daysGpp"],
            v["daysLight"],
        )
    return tables


def analyse(data: Data) -> tuple[dict[str, Any], pd.DataFrame]:
    steps = data.steps
    fits, site_fits, pooled_e0, model = fit_models(data.hh, steps)
    tables = daily_tables(data.hh, model, steps)

    events_out: dict[str, Any] = {}
    composite_out: dict[str, Any] = {
        v: {tkey(t): {} for t in THRESHOLDS} for v in VARIABLES
    }
    pulses_out: dict[str, Any] = {v: {} for v in VARIABLES}
    swc_out: dict[str, Any] = {v: {} for v in VARIABLES}
    summary: dict[str, Any] = {}
    dropped_out: list[dict[str, Any]] = []
    swc_median: dict[str, float | None] = {}
    hidden: dict[str, Any] = {}
    norm_counts: dict[str, Any] = {}
    event_rows: list[dict[str, Any]] = []
    sensitivity: dict[str, Any] = {}

    for s in ALL_SITES:
        t = tables[s]
        day = t.index.to_numpy(dtype=np.int64)
        rain = col(t, "rain").to_numpy(dtype=float)
        season = col(t, "season").to_numpy(dtype=bool)
        swc = col(t, "swc").to_numpy(dtype=float)
        sea_swc = swc[season & np.isfinite(swc)]
        med = float(np.median(sea_swc)) if sea_swc.size else math.nan
        swc_median[s] = med if math.isfinite(med) else None
        events_out[s] = {}
        for th in THRESHOLDS:
            evs, counts = find_events(
                day,
                rain,
                season,
                th,
                data.mgmt[s],
                swc if s in RAIN_PROXY else None,
            )
            for d in counts["dropped"]:
                dropped_out.append(
                    {
                        "site": s,
                        "threshold": th,
                        "day0": day_date(d["day0"]).isoformat(),
                        "reason": d["reason"],
                    }
                )
            used: dict[str, int] = {}
            for v in VARIABLES:
                vals = col(t, v).to_numpy(dtype=float)
                mat, _, nc = normalise_events(vals, evs, NORM_KIND[v])
                used[v] = int(sum(event_used(row) for row in mat))
                comp = composite(mat)
                composite_out[v][tkey(th)][s] = comp
                n_hidden = sum(1 for n in comp["n"] if 0 < n < MIN_COMPOSITE_N)
                hidden[f"{v} {tkey(th)} {s}"] = n_hidden
                norm_counts[f"{v} {tkey(th)} {s}"] = nc
                if th == MAIN_T:
                    smat, _, snc = normalise_events(
                        vals, evs, NORM_KIND[v], MIN_PRE_DAYS_SENSITIVITY
                    )
                    scomp = composite(smat)
                    sensitivity.setdefault(s, {})[v] = {
                        "used": int(sum(event_used(row) for row in smat)),
                        "day0": lag_value(scomp, 0, "mean"),
                        "day0Se": lag_value(scomp, 0, "se"),
                        "day0N": lag_value(scomp, 0, "n"),
                        "noPrePulse": snc["noPrePulse"],
                        "prePulseNotPositive": snc["prePulseNotPositive"],
                    }
                    pulses = pulse_sizes(mat)
                    rows = []
                    xs: list[float] = []
                    ys: list[float] = []
                    for e, ev in enumerate(evs):
                        if not event_used(mat[e]):
                            continue
                        anomaly = (
                            swc[ev.i - 1] - med if math.isfinite(med) else math.nan
                        )
                        rows.append(
                            {
                                "day0": day_date(ev.day0).isoformat(),
                                "rain": ev.rain0,
                                "lastLag": ev.last_lag,
                                "stop": ev.stop,
                                "pulse": float(pulses[e]),
                                "swcAnomaly": float(anomaly),
                            }
                        )
                        xs.append(float(anomaly))
                        ys.append(float(pulses[e]))
                        event_rows.append({"site": s, "variable": v, **rows[-1]})
                    pulses_out[v][s] = rows
                    swc_out[v][s] = swc_relation(xs, ys)
            events_out[s][tkey(th)] = {
                "found": counts["found"],
                "droppedManagement": counts["droppedManagement"],
                "droppedSwcCheck": counts["droppedSwcCheck"]
                if s in RAIN_PROXY
                else None,
                "kept": counts["kept"],
                "used": used,
                "stops": {
                    k: sum(1 for e in evs if e.stop == k)
                    for k in ("rain", "missing", "season", "window")
                },
            }
            log.info(
                "events %s >= %g mm: %d found, %d dropped (management), %s, %d kept; used: %s",
                s,
                th,
                counts["found"],
                counts["droppedManagement"],
                f"{counts['droppedSwcCheck']} dropped (SWC check)"
                if s in RAIN_PROXY
                else "no SWC check",
                counts["kept"],
                ", ".join(f"{v} {n}" for v, n in used.items()),
            )
            if th == MAIN_T:
                summary[s] = site_summary(t, evs, composite_out, pulses_out, s)

    steps["events"] = {
        "rule": (
            "day 0 in season with rain >= T; days -3 to -1 with rain < T; censored at rain >= T, "
            "a day without rain value or the season end; dropped on a management event in days "
            f"-3 to +15; Haltiala: SWC rise >= {SWC_RISE} m3 m-3 on day 0 or 1"
        ),
        "perSite": {
            s: {
                k: {kk: vv for kk, vv in v.items() if kk != "stops"}
                for k, v in events_out[s].items()
            }
            for s in ALL_SITES
        },
        "normalisation": norm_counts,
        "lagsHiddenNBelow5": hidden,
        "lagsHiddenTotal": sum(hidden.values()),
    }
    log.info(
        "composite: %d lags with 0 < n < %d are not drawn",
        sum(hidden.values()),
        MIN_COMPOSITE_N,
    )
    res = {
        "fits": fits,
        "siteFits": site_fits,
        "pooledE0": pooled_e0,
        "fitMethodCounts": steps["fits"]["methodCounts"],
        "swcMedian": swc_median,
        "events": events_out,
        "droppedEvents": dropped_out,
        "composite": composite_out,
        "pulses": pulses_out,
        "swc": swc_out,
        "summary": summary,
        "sensitivity": {
            "prePulseMin1": {
                "rule": (
                    f"as the main result ({tkey(MAIN_T)}), but the pre-pulse mean needs "
                    f"{MIN_PRE_DAYS_SENSITIVITY} or more of the 3 days"
                ),
                **sensitivity,
            }
        },
    }
    return res, pd.DataFrame(event_rows)


def lag_value(comp: dict[str, Any], lag: int, key: str) -> Any:
    return comp[key][LAGS.index(lag)]


def site_summary(
    t: pd.DataFrame,
    evs: Sequence[RainEvent],
    composite_out: dict[str, Any],
    pulses_out: dict[str, Any],
    s: str,
) -> dict[str, Any]:
    """Headline numbers of one site for the 5 mm events (results.json summary.<site>)."""
    out: dict[str, Any] = {"events": len(evs)}
    for v in VARIABLES:
        comp = composite_out[v][tkey(MAIN_T)][s]
        pre_cols = [LAGS.index(k) for k in PRE_LAGS]
        pre_n = sum(comp["n"][c] for c in pre_cols)
        pulses = np.array([r["pulse"] for r in pulses_out[v][s]], dtype=float)
        pst = plain_stats(pulses)
        out[v] = {
            "day0": lag_value(comp, 0, "mean"),
            "day0Se": lag_value(comp, 0, "se"),
            "day0N": lag_value(comp, 0, "n"),
            "day7": lag_value(comp, 7, "mean"),
            "day7Se": lag_value(comp, 7, "se"),
            "day7N": lag_value(comp, 7, "n"),
            "lastDrawnLag": last_drawn_lag(comp),
            "pulse": pst["mean"],
            "pulseSd": pst["sd"],
            "pulseSe": pst["se"],
            "pulseN": pst["n"],
            "preSd": pooled_pre_sd(comp) if pre_n else None,
            "used": len(pulses_out[v][s]),
        }
    frac = col(t, "meas_frac").to_numpy(dtype=float)
    light = col(t, "light").to_numpy(dtype=float)
    f0, fpre, lratio = [], [], []
    for ev in evs:
        a = frac[ev.i]
        b = finite_mean(frac[ev.i + LAG_MIN : ev.i], MIN_PRE_DAYS)
        if math.isfinite(a) and math.isfinite(b):
            f0.append(a)
            fpre.append(b)
        lp = finite_mean(light[ev.i + LAG_MIN : ev.i], MIN_PRE_DAYS)
        if math.isfinite(light[ev.i]) and math.isfinite(lp) and lp > 0:
            lratio.append(light[ev.i] / lp)
    f0a, fprea = np.array(f0, dtype=float), np.array(fpre, dtype=float)
    lst = plain_stats(np.array(lratio, dtype=float))
    out["measuredFracDay0"] = float(f0a.mean()) if f0a.size else None
    out["measuredFracPre"] = float(fprea.mean()) if fprea.size else None
    out["measuredFracRatio"] = (
        float(f0a.mean() / fprea.mean()) if f0a.size and fprea.mean() > 0 else None
    )
    out["measuredFracN"] = int(f0a.size)
    out["lightRatioDay0"] = lst["mean"]
    out["lightRatioSd"] = lst["sd"]
    out["lightRatioN"] = lst["n"]
    out["lightVariable"] = LIGHT_VAR[s]
    return out


def last_drawn_lag(comp: dict[str, Any]) -> int | None:
    """The largest lag with n >= MIN_COMPOSITE_N (None when no lag is drawn)."""
    drawn = [lag for lag, ok in zip(comp["lag"], comp["shown"], strict=True) if ok]
    return max(drawn) if drawn else None


def pooled_pre_sd(comp: dict[str, Any]) -> float | None:
    """SD of the normalised event values of days -3 to -1, from the per-lag mean, SD and n
    (pooled over the three lags, n - 1)."""
    ns, ms, ss = [], [], []
    for k in PRE_LAGS:
        c = LAGS.index(k)
        n = comp["n"][c]
        if n >= 1:
            ns.append(n)
            ms.append(comp["mean"][c])
            ss.append(comp["sd"][c] if comp["sd"][c] is not None else 0.0)
    total = sum(ns)
    if total < 2:
        return None
    grand = sum(n * m for n, m in zip(ns, ms, strict=True)) / total
    ss_total = sum(
        (n - 1) * s * s + n * (m - grand) ** 2
        for n, m, s in zip(ns, ms, ss, strict=True)
    )
    return math.sqrt(ss_total / (total - 1))


# ======================================================================================
# Figures
# ======================================================================================
def fmt(x: float | None, digits: int = 2) -> str:
    """Number for the alt text: fixed decimals, minus sign as U+2212."""
    if x is None:
        return "n/a"
    s = f"{x:.{digits}f}"
    if float(s) == 0:
        s = s.lstrip("-")
    return s.replace("-", "−")


def fmt_p(p: float | None) -> str:
    if p is None:
        return "n/a"
    return "< 0.001" if p < 0.001 else f"{p:.3f}"


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
            "axes.titlesize": 7.5 * f,
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


def lighter(hex_color: str, f: float = 0.5) -> str:
    """The colour mixed with white (f = share of white)."""
    h = hex_color.lstrip("#")
    rgb = [int(h[i : i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(c + (255 - c) * f):02x}" for c in rgb)


def panel_title(site: str, data: Data) -> str:
    """Panel title: emoji, one space, name (Haltiala adds "(Viikki rain)")."""
    return f"{SITE_EMOJI[site]} {data.names[site]}{TITLE_SUFFIX.get(site, '')}"


def plain_name(site: str, data: Data) -> str:
    return f"{data.names[site]}{TITLE_SUFFIX.get(site, '')}"


def panel_head(ax: Any, site: str, data: Data, line2: str) -> None:
    """Panel title (emoji and name) and a second, smaller line above the axes."""
    ax.set_title(panel_title(site, data), loc="left", fontsize=7 * FONT_SCALE, pad=20)
    ax.text(
        0.0,
        1.03,
        line2,
        transform=ax.transAxes,
        ha="left",
        va="bottom",
        fontsize=6 * FONT_SCALE,
        color=GUIDE_TEXT,
    )


def guide_value(v: str) -> float:
    return 0.0 if NORM_KIND[v] == "diff" else 1.0


def site_axes(fig: Any) -> list[Any]:
    axes = fig.subplots(2, 3, sharex=True, sharey=True)
    return [axes[r][c] for r in range(2) for c in range(3)]


def padded(lo: float, hi: float, frac: float = 0.08) -> tuple[float, float]:
    span = hi - lo if hi > lo else 1.0
    return lo - frac * span, hi + frac * span


def lag_range(res: dict[str, Any], v: str) -> tuple[float, float]:
    vals: list[float] = [guide_value(v)]
    for th in THRESHOLDS:
        for s in ALL_SITES:
            comp = res["composite"][v][tkey(th)][s]
            for m, se, ok in zip(comp["mean"], comp["se"], comp["shown"], strict=True):
                if not ok or m is None:
                    continue
                vals.append(m)
                if th == MAIN_T and se is not None:
                    vals += [m - se, m + se]
    return padded(min(vals), max(vals))


def fig_lag(res: dict[str, Any], data: Data, v: str) -> tuple[Any, str, str]:
    fig = plt.figure(figsize=(FIG_WIDTH_IN, LAG_HEIGHT_IN))
    axes = site_axes(fig)
    fig.subplots_adjust(
        left=0.14, right=0.985, top=0.775, bottom=0.12, hspace=0.62, wspace=0.10
    )
    lo, hi = lag_range(res, v)
    lags = np.array(LAGS, dtype=float)
    for s, ax in zip(ALL_SITES, axes, strict=True):
        slot = data.slots[s]
        color = SITE_COLORS[slot]
        marker = SITE_MARKERS[slot]
        ax.axvspan(-0.5, 0.5, color=DAY0_BAND, lw=0, zorder=0)
        ax.axvline(-0.5, color=GUIDE, lw=0.9, ls=(0, (3, 2)), zorder=1)
        ax.axhline(guide_value(v), color=GUIDE, lw=0.9, zorder=1)
        drawn = 0
        for th in (2.0, 10.0, 5.0):  # the main line on top
            comp = res["composite"][v][tkey(th)][s]
            st = THRESHOLD_STYLE[th]
            mean = np.array(
                [
                    m if (m is not None and ok) else np.nan
                    for m, ok in zip(comp["mean"], comp["shown"], strict=True)
                ],
                dtype=float,
            )
            if not np.isfinite(mean).any():
                continue
            drawn += 1
            c = lighter(color) if st["light"] else color
            if th == MAIN_T:
                se = np.array(
                    [x if x is not None else np.nan for x in comp["se"]], dtype=float
                )
                ax.fill_between(
                    lags,
                    mean - se,
                    mean + se,
                    color=color,
                    alpha=BAND_ALPHA,
                    lw=0,
                    zorder=2,
                )
            ax.plot(
                lags,
                mean,
                color=c,
                ls=st["ls"],
                lw=st["lw"],
                marker=marker,
                ms=LINE_MARKER_SIZE if th == MAIN_T else LINE_MARKER_SIZE * 0.8,
                mfc=c if st["fill"] else "white",
                mec=c,
                mew=1.0,
                zorder=4 if th == MAIN_T else 3,
            )
        n0 = [res["composite"][v][tkey(th)][s]["n"][LAGS.index(0)] for th in THRESHOLDS]
        panel_head(ax, s, data, "n = " + " · ".join(str(n) for n in n0))
        if not drawn:
            ax.text(
                0.5,
                0.5,
                f"no day with\n{MIN_COMPOSITE_N} or more events",
                transform=ax.transAxes,
                ha="center",
                va="center",
                fontsize=6.5 * FONT_SCALE,
                color=GUIDE_TEXT,
            )
        ax.set_xlim(LAG_MIN - 0.6, LAG_MAX + 0.6)
        ax.set_ylim(lo, hi)
        ax.set_xticks([-3, 0, 5, 10, 15])
    fig.supxlabel(X_LABEL_LAG, fontsize=7.5 * FONT_SCALE, y=0.015)
    fig.supylabel(Y_LABEL_LAG[v], fontsize=7.5 * FONT_SCALE, x=0.01)
    handles = []
    for th in THRESHOLDS:
        st = THRESHOLD_STYLE[th]
        c = lighter(INK) if st["light"] else INK
        handles.append(
            Line2D(
                [],
                [],
                color=c,
                ls=st["ls"],
                lw=st["lw"],
                marker="o",
                ms=LINE_MARKER_SIZE,
                mfc=c if st["fill"] else "white",
                mec=c,
                label=st["label"] + (" (band ± SE)" if th == MAIN_T else ""),
            )
        )
    fig.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.56, 0.995),
        ncol=3,
        frameon=False,
        handlelength=2.6,
        columnspacing=1.2,
    )
    note = (
        "Rain on day 0; days −3 to −1 below the threshold. n = events on day 0 for ≥ 2 · 5 · "
        f"10 mm;\na day with fewer than {MIN_COMPOSITE_N} events is not drawn."
    )
    if v == "nee":
        note = note.rstrip(".") + "; NEE < 0 = uptake."
    fig.text(
        0.56,
        0.925,
        note,
        ha="center",
        va="top",
        fontsize=6 * FONT_SCALE,
        color=GUIDE_TEXT,
        linespacing=1.4,
    )
    name = f"{v}-lag"
    return fig, FIG_TITLES[name], lag_desc(res, data, v)


def day_text(lag: int, mean: float | None, se: float | None, n: int) -> str:
    """Alt text of one composite day: mean ± SE (n); "single event" when n = 1; "not drawn"
    when n < MIN_COMPOSITE_N."""
    if n == 0 or mean is None:
        return f"day {lag}: no event"
    drawn = "" if n >= MIN_COMPOSITE_N else ", not drawn"
    if n == 1 or se is None:
        return f"day {lag}: {fmt(mean)} (single event{drawn})"
    return f"day {lag}: {fmt(mean)} ± {fmt(se)} (n = {n}{drawn})"


def lag_desc(res: dict[str, Any], data: Data, v: str) -> str:
    parts = [
        f"Six panels, one per site. X axis: days since the rain day, {LAG_MIN} to {LAG_MAX} "
        "(local days). Y axis: "
        + Y_TEXT[v]
        + f". Lines: events with at least 2, 5 and 10 mm of rain on day 0; the 5 mm line has a "
        f"band of ± 1 standard error (SE); a day with fewer than {MIN_COMPOSITE_N} events is not "
        "drawn. Values for the 5 mm events (mean ± SE, n events):"
    ]
    for s in ALL_SITES:
        su = res["summary"][s][v]
        name = plain_name(s, data)
        if not su["used"]:
            parts.append(f"{name}: no used event.")
            continue
        d0 = day_text(0, su["day0"], su["day0Se"], su["day0N"])
        d7 = day_text(7, su["day7"], su["day7Se"], su["day7N"])
        last = (
            "no drawn day"
            if su["lastDrawnLag"] is None
            else f"last drawn day {su['lastDrawnLag']}"
        )
        parts.append(f"{name}: {su['used']} events; {d0}; {d7}; {last}.")
    parts.append(
        "Pre-pulse value: "
        + ("0" if NORM_KIND[v] == "diff" else "1")
        + " (horizontal line)."
    )
    return " ".join(parts)


def swc_ranges(
    res: dict[str, Any], v: str
) -> tuple[tuple[float, float], tuple[float, float]]:
    xs: list[float] = [0.0]
    ys: list[float] = [guide_value(v)]
    for s in ALL_SITES:
        for r in res["pulses"][v][s]:
            if (
                r["pulse"] is not None
                and r["swcAnomaly"] is not None
                and math.isfinite(r["pulse"])
                and math.isfinite(r["swcAnomaly"])
            ):
                xs.append(r["swcAnomaly"])
                ys.append(r["pulse"])
    return padded(min(xs), max(xs)), padded(min(ys), max(ys))


def fig_swc(res: dict[str, Any], data: Data, v: str) -> tuple[Any, str, str]:
    fig = plt.figure(figsize=(FIG_WIDTH_IN, SWC_HEIGHT_IN))
    axes = site_axes(fig)
    fig.subplots_adjust(
        left=0.14, right=0.985, top=0.85, bottom=0.13, hspace=0.62, wspace=0.10
    )
    (xlo, xhi), (ylo, yhi) = swc_ranges(res, v)
    for s, ax in zip(ALL_SITES, axes, strict=True):
        slot = data.slots[s]
        color = SITE_COLORS[slot]
        ax.axhline(guide_value(v), color=GUIDE, lw=0.9, zorder=1)
        ax.axvline(0.0, color=GUIDE, lw=0.9, ls=(0, (3, 2)), zorder=1)
        pts = [
            (r["swcAnomaly"], r["pulse"])
            for r in res["pulses"][v][s]
            if r["pulse"] is not None
            and r["swcAnomaly"] is not None
            and math.isfinite(r["pulse"])
            and math.isfinite(r["swcAnomaly"])
        ]
        if pts:
            x, y = zip(*pts, strict=True)
            ax.scatter(
                x,
                y,
                s=SCATTER_SIZE,
                marker=SITE_MARKERS[slot],
                facecolor=color,
                edgecolor="white",
                linewidth=0.7,
                alpha=0.85,
                zorder=3,
            )
        rel = res["swc"][v][s]
        if rel["slope"] is not None:
            xx = np.array([rel["xMin"], rel["xMax"]], dtype=float)
            ax.plot(
                xx,
                rel["intercept"] + rel["slope"] * xx,
                color=color if slot != 4 else INK,
                lw=LINE_WIDTH,
                zorder=4,
            )
            text = f"r = {fmt(rel['r'])}, ρ = {fmt(rel['rho'])}, n = {rel['n']}"
        else:
            text = f"n = {rel['n']} (too few events)"
        panel_head(ax, s, data, text)
        ax.set_xlim(xlo, xhi)
        ax.set_ylim(ylo, yhi)
    fig.supxlabel(X_LABEL_SWC, fontsize=7.5 * FONT_SCALE, y=0.015)
    fig.supylabel(Y_LABEL_SWC[v], fontsize=7.5 * FONT_SCALE, x=0.01)
    fig.text(
        0.56,
        0.985,
        "One marker per ≥ 5 mm event; line = OLS fit; r = Pearson, ρ = Spearman"
        + ("; NEE < 0 = uptake" if v == "nee" else ""),
        ha="center",
        va="top",
        fontsize=6 * FONT_SCALE,
        color=GUIDE_TEXT,
    )
    name = f"{v}-swc"
    return fig, FIG_TITLES[name], swc_desc(res, data, v)


def swc_desc(res: dict[str, Any], data: Data, v: str) -> str:
    parts = [
        "Six panels, one per site. X axis: soil water content (SWC) of the day before the rain "
        "minus the site median of the season, in m3 m-3. Y axis: pulse = mean of days 0 to 2 of "
        + VAR_NAME[v]
        + (
            ", minus the pre-pulse mean, in µmol CO2 m-2 s-1."
            if NORM_KIND[v] == "diff"
            else ", relative to the pre-pulse mean."
        )
        + " One marker per event with at least 5 mm of rain; line = ordinary least squares "
        "(OLS) fit. Per site:"
    ]
    for s in ALL_SITES:
        rel = res["swc"][v][s]
        name = plain_name(s, data)
        if rel["slope"] is None:
            parts.append(f"{name}: n = {rel['n']}, too few events for a fit.")
            continue
        unit = "µmol CO2 m-2 s-1" if NORM_KIND[v] == "diff" else "(ratio)"
        parts.append(
            f"{name}: Pearson r = {fmt(rel['r'])} (p = {fmt_p(rel['rP'])}), Spearman ρ = "
            f"{fmt(rel['rho'])} (p = {fmt_p(rel['rhoP'])}), slope {fmt(rel['slope'], 1)} "
            f"{unit} per m3 m-3, n = {rel['n']}."
        )
    return " ".join(parts)


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
        "seasonMonths": list(SEASON_MONTHS),
        "allYearSites": sorted(ALL_YEAR_SITES),
        "rainProxy": RAIN_PROXY,
        "lightVariable": LIGHT_VAR,
        "ustarSites": sorted(USTAR_SITES),
        "ustarMin": USTAR_MIN,
        "tsoilMin": TSOIL_MIN,
        "minPrecipHalfHours": MIN_PRECIP_HH,
        "minSwcHalfHours": MIN_SWC_HH,
        "minNightHalfHours": MIN_NIGHT_HH,
        "minDayHalfHours": MIN_DAY_HH,
        "lloydTaylor": {
            "tref": T_REF,
            "t0": T0,
            "e0Start": E0_START,
            "e0Bounds": list(E0_BOUNDS),
            "trimPercent": TRIM_PERCENT,
            "minN": FIT_MIN_N,
            "minRange": FIT_MIN_RANGE,
            "temperature": "tsoil",
        },
        "thresholds": list(THRESHOLDS),
        "mainThreshold": MAIN_T,
        "lags": [LAG_MIN, LAG_MAX],
        "preLags": list(PRE_LAGS),
        "pulseLags": list(PULSE_LAGS),
        "minPreDays": MIN_PRE_DAYS,
        "minPulseDays": MIN_PULSE_DAYS,
        "minCompositeN": MIN_COMPOSITE_N,
        "minRelationN": MIN_RELATION_N,
        "swcRise": SWC_RISE,
        "managementTypes": list(MGMT_TYPES),
        "normalisation": NORM_KIND,
        "units": VAR_UNIT,
        "rules": [
            line.strip()
            for line in (__doc__ or "")
            .split("METHOD", 1)[1]
            .split("DATABASE", 1)[0]
            .splitlines()
            if line.strip()
        ],
        "openFindings": list(OPEN_FINDINGS),
        "literature": list(LITERATURE),
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

    try:
        data = read_data(args.db, args.calculated)
        res, event_rows = analyse(data)
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
    for n, name, v, kind in FIGURES:
        fig, title, desc = (
            fig_lag(res, data, v) if kind == "lag" else fig_swc(res, data, v)
        )
        path = target / "figures" / f"{n}-{name}.svg"
        save_svg(fig, path, n, title, desc, meta)
        size = path.stat().st_size
        if size >= 1_000_000:
            raise RuntimeError(f"{path}: {size} bytes (limit 1 MB)")
        figures_json.append(
            {"n": n, "file": f"figures/{n}-{name}.svg", "title": title, "desc": desc}
        )
        log.info("figure %d: %s (%d bytes)", n, path, size)

    event_rows.to_csv(
        out_dir / "output" / "events.csv", index=False, float_format="%.10g"
    )

    dv = data_version(args, data.steps, script_dir)
    results = {
        "slug": SLUG,
        "script": SCRIPT_PATH,
        "question": (
            "Does a rain day after dry days change the night-time ecosystem respiration, the "
            "net ecosystem exchange and the gross primary production in the next days, and does "
            "the soil water content before the rain change the size of this pulse?"
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
