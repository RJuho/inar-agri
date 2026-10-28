# /// script
# requires-python = "==3.13.*"
# dependencies = [
#     "imageio-ffmpeg==0.7.0",
#     "matplotlib==3.11.2",
#     "numpy==2.5.4",
# ]
# ///
"""NEE to NBE animation: carbon-space Figure 4 morphs into NBE Figure 1.

The video for a talk shows, in three steps, how the annual carbon balance of a site-year
changes when the carbon of the management is added to NEE:

1. Still: annual TER against annual GPP (Deep Dive #9, `analysis/carbon-space/figures/
   4-carbon-space-forest.svg`). The vertical distance from the 1:1 line is NEE.
2. The agricultural site-years move to their NBE positions (y = carbon out = TER + C_out
   - C_in). Maktau 2019 (no NBE) fades out. Hyytiala 2020 stays. The axes do not change.
3. Hyytiala 2020 (thinning) moves to its NBE position and the y axis grows to 3600
   (Deep Dive #10, `analysis/net-biome-exchange/figures/1-nbe-carbon-space.svg`).

INPUTS
    analysis/net-biome-exchange/results.json  (figureKeys, sy[key]: gpp, ter, nee, carbonOut,
        class, nbeLow, nbeHigh, cropLabel)
    analysis/carbon-space/results.json        (siteYears[]: inFig1, gpp, reco, cropLabel; Maktau 2019)
    The script stops with exit code 3 when GPP or TER differ between the files.

OUTPUTS (default folder data/NEE-NBE-animation/, 1080 x 810 px, 60 fps, H.264 yuv420p, no audio)
    1-nee.mp4, 2-nee-to-nbe.mp4, 3-thinning.mp4, nee-nbe-animation.mp4 (all three in one),
    1-nee.png, 2-nbe.png, 3-nbe-thinning.png (the still frames), timeline.json.

RUN
    uv run analysis/net-biome-exchange/animation/make-animation.py
    Options: --out, --fps, --width, --stills-only, --frames (every frame as PNG to
    analysis/net-biome-exchange/output/animation/frames/), --repo (repository root, default
    from the script path).
    Exit codes: 0 done, 1 render or ffmpeg error, 2 bad option, 3 data check failed.

The script copies the style constants, `site_style()`, the label offsets and the label texts
from `analysis/carbon-space/carbon-space.py` and
`analysis/net-biome-exchange/net-biome-exchange.py`. It does not import the two dive scripts.
matplotlib (Agg) draws each frame. The script writes it as raw RGBA to four ffmpeg encoders
at the same time (the full timeline and the three clips). Thus the cuts are exact, and no clip
is encoded twice.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.image as mimage
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.lines import Line2D

SLUG = "nee-nbe-animation"
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
NB_RESULTS = Path("analysis/net-biome-exchange/results.json")
CS_RESULTS = Path("analysis/carbon-space/results.json")
DEFAULT_OUT = Path("data/NEE-NBE-animation")
FRAMES_DIR = Path("analysis/net-biome-exchange/output/animation/frames")

log = logging.getLogger(SLUG)

# ======================================================================================
# Timeline (seconds). Each clip starts and ends on a still frame; the clips are cut from
# one timeline, so the last frame of a clip is the first frame of the next.
# ======================================================================================
FPS = 60
STEP1_HOLD = 3.0
STEP2_HOLD_IN, STEP2_MOVE, STEP2_HOLD_OUT = 1.0, 2.5, 1.0
STEP3_HOLD_IN, STEP3_MOVE, STEP3_HOLD_OUT = 1.0, 3.0, 2.0
CUT1 = STEP1_HOLD
CUT2 = CUT1 + STEP2_HOLD_IN + STEP2_MOVE + STEP2_HOLD_OUT
END = CUT2 + STEP3_HOLD_IN + STEP3_MOVE + STEP3_HOLD_OUT
CLIPS: tuple[tuple[str, float, float, str], ...] = (
    ("1-nee", 0.0, CUT1, "Still: TER against GPP (NEE view)"),
    (
        "2-nee-to-nbe",
        CUT1,
        CUT2,
        "The agricultural site-years move to carbon out (NBE view)",
    ),
    (
        "3-thinning",
        CUT2,
        END,
        "Hyytiala 2020 (thinning) moves; the y axis grows to 3600",
    ),
)
FULL_NAME = "nee-nbe-animation"
STILLS: tuple[tuple[str, float], ...] = (
    ("1-nee", 0.0),
    ("2-nbe", CUT2),
    ("3-nbe-thinning", END),
)
# Sub-phases of a move, as fractions of the move (raw progress, before the easing).
FILL_END = 0.5  # class B markers: fill to white and edge to the site colour
WHISKER_START_2 = 0.5  # step 2: the whisker fades in during the second half
# Step 3: the whisker fades in when the growing y axis holds its top, with this margin
# (data units) above the whisker top; see whisker_start(). Not before WHISKER_START_3_MIN.
WHISKER_MARGIN = 40.0
WHISKER_START_3_MIN = 0.7
TICK_START, TICK_END = 0.05, 0.15  # the grey tick at y = TER fades in
FADE_START, FADE_END = 0.2, 0.8  # text crossfades (y label, net source and net sink)
JUMP_FADE = 0.3  # a jumping label fades out in the first 30 % of step 3, in during the last 30 %
ARC_SHORTEST_MAX_DEG = (
    120.0  # label path: the shortest arc up to this angle, else over the top
)
ARC_LINEAR_MAX_DEG = (
    60.0  # same alignment: a straight line up to this turn, else the arc
)
MAKTAU_FADE_END = 0.5  # Maktau 2019 fades out in the first half of step 2
CLASS_LEGEND_START = 0.5  # the Class legend fades in during the second half of step 2

# ======================================================================================
# Canvas. 180 x 135 mm (4:3) at dpi = width / 7.0866 in: 1080 x 810 px, the same point
# sizes as the SVG figures (180 mm wide). The axes box is fixed in figure coordinates.
# ======================================================================================
MM = 1 / 25.4
FIG_WIDTH_MM, FIG_HEIGHT_MM = 180.0, 135.0
DEFAULT_WIDTH = 1080
# The axes box is square (648 x 648 px at 1080 x 810): x and y have the same range in steps
# 1 and 2, thus the same scale, and the 1:1 line is at 45 degrees (user request 2026-10-28).
AXES_RECT = (113 / 1080, 90 / 810, 648 / 1080, 648 / 810)  # left, bottom, width, height
YLABEL_X = -0.115  # y label anchor (axes fraction); the same for both crossfaded texts
LEGEND_X = 0.725  # left edge of the legend column (figure fraction)
LEGEND_TOP = 0.96
CLASS_LEGEND_TOP = 0.46

# ======================================================================================
# Style: copied from analysis/carbon-space/carbon-space.py (lines 560 to 710) and
# analysis/net-biome-exchange/net-biome-exchange.py (lines 766 to 860). Same values.
# ======================================================================================
FONT_SCALE = 1.5
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
SHIFT = "#a6a6a6"
GRID = "#e2e2e2"
GRID_LW = 0.6
MARKER_SIZE = 13
MARKER_EDGE = 0.8
HOLLOW_EDGE = 2.0
MARKER_ZORDER = {"haltiala": 3.5}
REF_SITE = "hyytiala"
REF_NAME = "Hyytiälä"
REF_COLOR = "#009e73"
REF_MARKER = "*"
REF_MARKER_SIZE = 19
REF_ZORDER = 2.5
ALL_SITES = ("anttila", "sarkisuo", "haltiala", "qvidja", "viikki", "maktau")
SITE_NAMES = {
    "anttila": "Anttila",
    "sarkisuo": "Särkisuo",
    "haltiala": "Haltiala",
    "qvidja": "Qvidja",
    "viikki": "Viikki",
    "maktau": "Maktau",
    REF_SITE: REF_NAME,
}
# The slot of the site in db/sites.parquet (siteColors() in site/src/scripts/diagrams/common.ts).
SITE_SLOTS = {s: i for i, s in enumerate(ALL_SITES)}
SITE_EMOJI = {
    "anttila": "👱🏻‍♂️🫛",
    "sarkisuo": "🐟🌱",
    "haltiala": "🧚🌾",
    "qvidja": "🐂🐝",
    "viikki": "👩🏻‍🔬🎓",
    "maktau": "🇰🇪🌽",
    REF_SITE: "🌲🍄",
}
# Legend with the site emojis: not possible. matplotlib 3.11 refuses the Noto Color Emoji
# font (`font_manager.fontManager.addfont()` raises NotImplementedError: "Non-scalable fonts
# are not supported"; it is a CBDT bitmap font), and DejaVu Sans has no emoji glyphs (boxes).
# The video uses the plain site names.
EMOJI = False
EMOJI_FONT = Path("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf")
# x and y 400 to 1600 in steps 1 and 2 (Figures 4 and 1: x from 600). y must reach 400:
# Qvidja 2023 moves to 545 (whisker 451) in step 2. Step 3 grows only the y axis.
X_LO, X_HI, X_TICK = 400.0, 1600.0, 200.0
Y_LO = 400.0
Y_TOP_1 = 1600.0  # y top in steps 1 and 2
Y_TOP_3 = 3600.0  # y top at the end of step 3 (Figure 1)
Y_TICK_1, Y_TICK_3 = 200.0, 400.0
X_LABEL = r"Annual GPP (g C m$^{-2}$ yr$^{-1}$)"
Y_LABEL_NEE = r"Annual TER (g C m$^{-2}$ yr$^{-1}$)"
Y_LABEL_NBE = r"Annual carbon out, TER + C$_{out}$ − C$_{in}$ (g C m$^{-2}$ yr$^{-1}$)"
THINNING_KEY = f"{REF_SITE}-2020"
PRE_THINNING_KEY = f"{REF_SITE}-2019"
CLUSTER_KEY = f"{REF_SITE}-2024"
MAKTAU_KEY = "maktau-2019"
# Label offsets (points: dx, dy, horizontal alignment). Start = Figure 4 (carbon-space
# LABEL_OFFSETS and LABEL_OFFSETS_FOREST), end = Figure 1 (net-biome-exchange LABEL_OFFSETS).
LABEL_OFFSETS_FIG4: dict[str, tuple[float, float, str]] = {
    "anttila-2022": (11, 0, "left"),
    "anttila-2023": (11, 0, "left"),
    "sarkisuo-2022": (11, -7, "left"),
    "haltiala-2022": (11, 0, "left"),
    "haltiala-2023": (-11, 0, "right"),
    "haltiala-2024": (
        11,
        -6,
        "left",
    ),  # LABEL_OFFSETS_FOREST: below the Hyytiala 2021 star
    "haltiala-2025": (0, -16, "center"),
    "qvidja-2020": (0, 16, "center"),
    "qvidja-2022": (0, -16, "center"),
    "qvidja-2023": (-11, 0, "right"),
    "qvidja-2024": (0, 16, "center"),
    "qvidja-2025": (-11, 0, "right"),
    "viikki-2024": (11, -8, "left"),
    "viikki-2025": (-11, 0, "right"),
    "maktau-2019": (11, 0, "left"),
    PRE_THINNING_KEY: (14, -30, "left"),
    THINNING_KEY: (-10, 12, "right"),
    CLUSTER_KEY: (12, -14, "left"),
}
# Changes of the video to the Figure 4 offsets and texts:
# - "2023 grass (failed)" is one line. Figure 4 wraps it in two lines left of the marker, over
#   the y axis. In the start state the one-line text does not fit above the marker (it would
#   touch the Särkisuo 2022 square and the "2025 faba bean" label), so it sits below the
#   marker with a short leader line (the leader fades out during the move to the Figure 1
#   place above the marker).
# - "2019 (pre-thinning)" is one line (Figure 4 wraps it).
# - "2020 (thinning)" 4 points higher, so that it does not touch the Särkisuo 2022 label at
#   the end of step 2 (the Särkisuo label is then at its Figure 1 place, left of the marker).
# - "net sink" sits at axes fraction 0.02 from the bottom (Figure 4: 0.03, Figure 1: 0.01).
# - Axes: x and y 400 to 1600 in a square box in steps 1 and 2 (equal scale, 1:1 line at
#   45 degrees); no guide lines NEE/NBE = -200 and -400 (user request 2026-10-28).
# - Labels changed for this denser scale: anttila-2023 above its marker in steps 2 and 3,
#   haltiala-2023 at dy 17 (Figure 1: 20), and LABEL_OFFSETS_FINAL below.
LABEL_OFFSETS_START: dict[str, tuple[float, float, str]] = {
    **LABEL_OFFSETS_FIG4,
    "haltiala-2023": (-40, -60, "left"),
    THINNING_KEY: (-10, 16, "right"),
}
LABEL_OFFSETS_END: dict[str, tuple[float, float, str]] = {
    "anttila-2022": (11, 0, "left"),
    "anttila-2023": (0, 15, "center"),  # video: above (right of it is Qvidja 2025)
    "sarkisuo-2022": (-11, 0, "right"),
    "haltiala-2022": (11, 0, "left"),
    "haltiala-2023": (-8, 17, "left"),  # video: 17 (Figure 1: 20)
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
# End of step 3: the y axis is 2.67 times denser than at the end of step 2 (and 1.67 times
# denser than Figure 1), so four labels slide to free places during step 3.
LABEL_OFFSETS_FINAL: dict[str, tuple[float, float, str]] = {
    **LABEL_OFFSETS_END,
    "haltiala-2023": (-8, 12, "left"),  # clear of "2025 faba bean"
    "haltiala-2024": (24, -17, "center"),  # clear of the Viikki 2024 label
    "haltiala-2022": (16, -24, "left"),  # below the stars, with a leader line
    "viikki-2024": (11, -5, "left"),  # clear of "2024 sunflower"
    "qvidja-2024": (
        -14,
        14,
        "right",
    ),  # above left, clear of the Haltiala 2022 triangle
}
JUMP_KEYS = frozenset(
    {"qvidja-2024"}
)  # step 3: fade out and in, no slide (see point_state)
LABEL_TEXT = {
    PRE_THINNING_KEY: "2019 (pre-thinning)",
    THINNING_KEY: "2020 (thinning)",
    CLUSTER_KEY: "2021–2024",
}
LEADER_KEYS = frozenset({PRE_THINNING_KEY})  # leader line in both figures
LEADER_START_KEYS = frozenset({"haltiala-2023"})  # leader line in the start state only
LEADER_FINAL_KEYS = frozenset({"haltiala-2022"})  # leader line fades in during step 3
LEADER_STYLE = {
    "arrowstyle": "-",
    "color": GUIDE,
    "lw": 0.8,
    "shrinkA": 0,
    "shrinkB": 6,
}
WHITE = (1.0, 1.0, 1.0)

RGB = tuple[float, float, float]


class DataError(Exception):
    """The two results.json files do not agree, or a key is missing (exit code 3)."""


# ======================================================================================
# Pure helpers
# ======================================================================================
def smoothstep(u: float) -> float:
    """Ease: 3u^2 - 2u^3 on [0, 1], clamped."""
    u = clamp01(u)
    return u * u * (3.0 - 2.0 * u)


def whisker_start(w_hi: float) -> float:
    """Smallest raw step 3 progress at which the y axis top is at least w_hi + WHISKER_MARGIN
    (bisection on the eased top limit), and not less than WHISKER_START_3_MIN."""
    need = w_hi + WHISKER_MARGIN
    if lerp(Y_TOP_1, Y_TOP_3, 1.0) < need:
        raise ValueError(f"whisker top {w_hi} does not fit the final y axis {Y_TOP_3}")
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if lerp(Y_TOP_1, Y_TOP_3, smoothstep(mid)) >= need:
            hi = mid
        else:
            lo = mid
    return max(WHISKER_START_3_MIN, hi)


def clamp01(u: float) -> float:
    return max(0.0, min(1.0, u))


def lerp(p: float, q: float, f: float) -> float:
    return p + (q - p) * f


def hex_rgb(c: str) -> RGB:
    c = c.lstrip("#")
    return (int(c[0:2], 16) / 255, int(c[2:4], 16) / 255, int(c[4:6], 16) / 255)


def lerp_rgb(p: RGB, q: RGB, f: float) -> RGB:
    return (lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f))


def fmt(x: float) -> str:
    """Number for a label: no decimals, minus sign as U+2212."""
    s = f"{x:.0f}"
    if float(s) == 0:
        s = s.lstrip("-")
    return s.replace("-", "−")


def site_style(site: str) -> tuple[str, str, float, float, str]:
    """Colour, marker, marker size, zorder and legend text of a site (as the dive scripts)."""
    if site == REF_SITE:
        legend = (
            f"{SITE_EMOJI[REF_SITE]} {REF_NAME}\n(forest)"
            if EMOJI
            else f"{REF_NAME}\n(forest)"
        )
        return REF_COLOR, REF_MARKER, REF_MARKER_SIZE, REF_ZORDER, legend
    slot = SITE_SLOTS[site]
    name = f"{SITE_EMOJI[site]} {SITE_NAMES[site]}" if EMOJI else SITE_NAMES[site]
    return (
        SITE_COLORS[slot],
        SITE_MARKERS[slot],
        MARKER_SIZE,
        MARKER_ZORDER.get(site, 3),
        name,
    )


def point_label(year: int, crop_label: str | None) -> str:
    return f"{year} {crop_label}" if crop_label else str(year)


# ======================================================================================
# Data
# ======================================================================================
@dataclass(frozen=True)
class Point:
    key: str
    site: str
    year: int
    label: str
    cls: str  # "A" or "B"
    x: float  # annual GPP
    ter: float  # annual TER (y of the NEE view)
    carbon_out: float  # TER + C_out - C_in (y of the NBE view); = ter for Maktau 2019
    nee: float
    nbe_low: float
    nbe_high: float
    in_nbe: bool  # False for Maktau 2019 (fades out in step 2)

    @property
    def whisker(self) -> tuple[float, float] | None:
        """Low and high y of the class B whisker (carbon out at the low and the high NBE)."""
        if self.cls != "B" or self.nbe_high - self.nbe_low <= 1e-9:
            return None
        return (self.ter + self.nbe_low - self.nee, self.ter + self.nbe_high - self.nee)

    @property
    def moves(self) -> bool:
        return self.in_nbe and abs(self.carbon_out - self.ter) > 1e-9


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def point_table(nb: dict[str, Any], cs: dict[str, Any]) -> tuple[Point, ...]:
    """The 20 site-years of NBE Figure 1 plus Maktau 2019 of carbon-space Figure 4.

    Stops (DataError) when a key is missing or GPP or TER differ between the two files.
    """
    cs_rows = {
        r["key"]: r
        for r in (*cs["siteYears"], *cs["reference"][REF_SITE]["siteYears"])
        if r["inFig1"]
    }
    keys: list[str] = list(nb["figureKeys"])
    missing = [k for k in keys if k not in cs_rows]
    extra = [k for k in cs_rows if k not in keys]
    if missing:
        raise DataError(f"keys of NBE Figure 1 not in carbon-space Figure 4: {missing}")
    if extra != [MAKTAU_KEY]:
        raise DataError(
            f"carbon-space Figure 4 has keys not in NBE Figure 1 other than {MAKTAU_KEY}: {extra}"
        )
    points: list[Point] = []
    for k in keys:
        s = nb["sy"][k]
        c = cs_rows[k]
        for a, b, name in ((s["gpp"], c["gpp"], "GPP"), (s["ter"], c["reco"], "TER")):
            if abs(a - b) >= 1e-6:
                raise DataError(
                    f"{k}: {name} differs between the files: {a!r} vs {b!r}"
                )
        if s["cropLabel"] != c["cropLabel"]:
            raise DataError(
                f"{k}: cropLabel differs: {s['cropLabel']!r} vs {c['cropLabel']!r}"
            )
        points.append(
            Point(
                key=k,
                site=s["site"],
                year=int(s["year"]),
                label=LABEL_TEXT.get(k, point_label(int(s["year"]), s["cropLabel"])),
                cls=s["class"],
                x=float(s["gpp"]),
                ter=float(s["ter"]),
                carbon_out=float(s["carbonOut"]),
                nee=float(s["nee"]),
                nbe_low=float(s["nbeLow"]),
                nbe_high=float(s["nbeHigh"]),
                in_nbe=True,
            )
        )
    m = cs_rows[MAKTAU_KEY]
    points.append(
        Point(
            key=MAKTAU_KEY,
            site=m["site"],
            year=int(m["year"]),
            label=point_label(int(m["year"]), m["cropLabel"]),
            cls="A",
            x=float(m["gpp"]),
            ter=float(m["reco"]),
            carbon_out=float(m["reco"]),
            nee=float(m["nee"]),
            nbe_low=math.nan,
            nbe_high=math.nan,
            in_nbe=False,
        )
    )
    return tuple(points)


# ======================================================================================
# State of one frame
# ======================================================================================
@dataclass(frozen=True)
class Label:
    text: str
    dx: float
    dy: float
    ha: str
    alpha: float
    leader_alpha: float


@dataclass(frozen=True)
class PointState:
    key: str
    site: str
    x: float
    y: float
    alpha: float
    mfc: RGB
    mec: RGB
    mew: float
    whisker: tuple[float, float, float] | None  # y low, y high, alpha
    shift: (
        tuple[float, float] | None
    )  # y of the TER tick, tick alpha (line from ter to y)
    label: Label | None


@dataclass(frozen=True)
class State:
    t: float
    a: float  # step 2 progress (raw, 0 to 1)
    b: float  # step 3 progress (raw, 0 to 1)
    y_top: float
    text_fade: float  # 0 = NEE texts, 1 = NBE texts
    tick_fade: float  # 0 = 200 step ticks, 1 = 400 step ticks
    maktau_alpha: float
    class_legend_alpha: float
    points: tuple[PointState, ...]


def progress_at(t: float) -> tuple[float, float]:
    """Raw progress (0 to 1, before the easing) of the step 2 and the step 3 move at time t."""
    a = clamp01((t - CUT1 - STEP2_HOLD_IN) / STEP2_MOVE)
    b = clamp01((t - CUT2 - STEP3_HOLD_IN) / STEP3_MOVE)
    return a, b


def centre_offset(dx: float, ha: str, width_pt: float) -> float:
    """The dx of the same label with ha = center."""
    if ha == "left":
        return dx + width_pt / 2
    if ha == "right":
        return dx - width_pt / 2
    return dx


def box_reach(th: float, size: tuple[float, float]) -> float:
    """Distance from the centre of a text box (width, height in points) to its edge in the
    direction th (radians), for a box that touches the marker: half width and half height
    weighted by the direction."""
    return abs(math.cos(th)) * size[0] / 2 + abs(math.sin(th)) * size[1] / 2


def interp_offset(
    start: tuple[float, float, str],
    end: tuple[float, float, str],
    f: float,
    size: tuple[float, float],
) -> tuple[float, float, str]:
    """Label offset between two tables. A changed alignment goes through the centre form,
    so that the text does not jump, and the box moves on an arc around the marker (polar
    interpolation of the direction and of the gap between the marker and the box edge), so
    that the text does not slide across its own marker. A side switch goes over the top.
    A label with the same alignment moves on a straight line, except when the direction
    from the marker turns by more than ARC_LINEAR_MAX_DEG (then it would cross the marker)."""
    c0 = (centre_offset(start[0], start[2], size[0]), start[1])
    c1 = (centre_offset(end[0], end[2], size[0]), end[1])
    th0, th1 = math.atan2(c0[1], c0[0]), math.atan2(c1[1], c1[0])
    ccw = (math.degrees(th1 - th0)) % 360.0
    dth = ccw if ccw <= 180.0 else ccw - 360.0
    if start[2] == end[2] and abs(dth) <= ARC_LINEAR_MAX_DEG:
        return (lerp(start[0], end[0], f), lerp(start[1], end[1], f), start[2])
    gap0 = math.hypot(*c0) - box_reach(th0, size)
    gap1 = math.hypot(*c1) - box_reach(th1, size)
    if abs(dth) > ARC_SHORTEST_MAX_DEG:
        # a wide swing: take the direction whose arc passes the top (90 degrees)
        dth = ccw if (90.0 - math.degrees(th0)) % 360.0 <= ccw else ccw - 360.0
    th = th0 + math.radians(f * dth)
    r = lerp(gap0, gap1, f) + box_reach(th, size)
    return (r * math.cos(th), r * math.sin(th), "center")


def point_state(
    p: Point, a_raw: float, b_raw: float, sizes: dict[str, tuple[float, float]]
) -> PointState:
    color = hex_rgb(site_style(p.site)[0])
    size = sizes.get(p.label, (0.0, 0.0))
    if not p.in_nbe:
        alpha = 1.0 - smoothstep(a_raw / MAKTAU_FADE_END)
        off = LABEL_OFFSETS_START[p.key]
        return PointState(
            key=p.key,
            site=p.site,
            x=p.x,
            y=p.ter,
            alpha=alpha,
            mfc=color,
            mec=WHITE,
            mew=MARKER_EDGE,
            whisker=None,
            shift=None,
            label=Label(p.label, off[0], off[1], off[2], alpha, 0.0),
        )
    # Hyytiala 2020 moves in step 3; all other site-years in step 2.
    thinning = p.key == THINNING_KEY
    f_raw = b_raw if thinning else a_raw
    f = smoothstep(f_raw)
    y = lerp(p.ter, p.carbon_out, f)
    mfc, mec, mew = color, WHITE, MARKER_EDGE
    whisker: tuple[float, float, float] | None = None
    if p.cls == "B":
        s = smoothstep(f_raw / FILL_END)
        mfc = lerp_rgb(color, WHITE, s)
        mec = lerp_rgb(WHITE, color, s)
        mew = lerp(MARKER_EDGE, HOLLOW_EDGE, s)
        w = p.whisker
        if w is not None:
            w0 = whisker_start(w[1]) if thinning else WHISKER_START_2
            wa = smoothstep((f_raw - w0) / (1.0 - w0))
            if wa > 0.0:
                whisker = (w[0], w[1], wa)
    shift: tuple[float, float] | None = None
    if p.moves and f_raw > 0.0:
        shift = (p.ter, smoothstep((f_raw - TICK_START) / (TICK_END - TICK_START)))
    label: Label | None = None
    if p.key in LABEL_OFFSETS_END:
        start, end, final = (
            LABEL_OFFSETS_START[p.key],
            LABEL_OFFSETS_END[p.key],
            LABEL_OFFSETS_FINAL[p.key],
        )
        label_alpha = 1.0
        if thinning or b_raw <= 0.0:
            dx, dy, ha = interp_offset(start, end, f, size)
        elif p.key in JUMP_KEYS:
            # a long slide in step 3 would cross other markers: fade out, then in
            if b_raw < 0.5:
                dx, dy, ha = end
                label_alpha = 1.0 - smoothstep(b_raw / JUMP_FADE)
            else:
                dx, dy, ha = final
                label_alpha = smoothstep((b_raw - 1.0 + JUMP_FADE) / JUMP_FADE)
        else:
            dx, dy, ha = interp_offset(end, final, smoothstep(b_raw), size)
        leader = (
            1.0
            if p.key in LEADER_KEYS
            else 1.0 - f
            if p.key in LEADER_START_KEYS
            else smoothstep(b_raw)
            if p.key in LEADER_FINAL_KEYS
            else 0.0
        )
        label = Label(p.label, dx, dy, ha, label_alpha, leader)
    return PointState(
        key=p.key,
        site=p.site,
        x=p.x,
        y=y,
        alpha=1.0,
        mfc=mfc,
        mec=mec,
        mew=mew,
        whisker=whisker,
        shift=shift,
        label=label,
    )


def state_at(
    t: float, points: tuple[Point, ...], sizes: dict[str, tuple[float, float]]
) -> State:
    """The state of the frame at time t (seconds from the start of the timeline)."""
    a, b = progress_at(t)
    return State(
        t=t,
        a=a,
        b=b,
        y_top=lerp(Y_TOP_1, Y_TOP_3, smoothstep(b)),
        text_fade=smoothstep((a - FADE_START) / (FADE_END - FADE_START)),
        tick_fade=smoothstep(b),
        maktau_alpha=1.0 - smoothstep(a / MAKTAU_FADE_END),
        class_legend_alpha=smoothstep(
            (a - CLASS_LEGEND_START) / (1.0 - CLASS_LEGEND_START)
        ),
        points=tuple(point_state(p, a, b, sizes) for p in points),
    )


def still_state(
    t: float, points: tuple[Point, ...], sizes: dict[str, tuple[float, float]]
) -> State:
    """The still at a cut: the same state as the frames around the cut, without the time."""
    return replace(state_at(t, points, sizes), t=0.0)


# ======================================================================================
# Drawing
# ======================================================================================
@dataclass(frozen=True)
class Canvas:
    width: int
    height: int
    dpi: float

    @property
    def figsize(self) -> tuple[float, float]:
        # + 0.01 px: matplotlib truncates width * dpi to an integer; this keeps it exact.
        return ((self.width + 0.01) / self.dpi, (self.height + 0.01) / self.dpi)


def canvas_for(width: int) -> Canvas:
    if width % 8 != 0:
        raise ValueError("--width must be a multiple of 8 (yuv420p needs even sizes)")
    height = width * 3 // 4
    return Canvas(width, height, width / (FIG_WIDTH_MM * MM))


def setup_matplotlib() -> None:
    families = ["DejaVu Sans"]
    if EMOJI and EMOJI_FONT.is_file():
        font_manager.fontManager.addfont(str(EMOJI_FONT))
        families.append("Noto Color Emoji")
    f = FONT_SCALE
    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": families,
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
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.linewidth": 0.9,
            "xtick.major.width": 0.9,
            "ytick.major.width": 0.9,
        }
    )


def label_sizes(
    points: tuple[Point, ...], canvas: Canvas
) -> dict[str, tuple[float, float]]:
    """Width and height of each label text in points, from the renderer (for the arc path of
    a label whose alignment changes)."""
    fig = plt.figure(figsize=(2, 2), dpi=canvas.dpi)
    renderer = fig.canvas.get_renderer()  # type: ignore[attr-defined]
    sizes: dict[str, tuple[float, float]] = {}
    for p in points:
        if p.label in sizes:
            continue
        t = fig.text(0.5, 0.5, p.label, fontsize=6 * FONT_SCALE)
        bb = t.get_window_extent(renderer)
        sizes[p.label] = (bb.width * 72.0 / canvas.dpi, bb.height * 72.0 / canvas.dpi)
        t.remove()
    plt.close(fig)
    return sizes


def y_ticks(state: State) -> list[tuple[float, float]]:
    """The y ticks (position, alpha): the 200 step in steps 1 and 2; in step 3 the 200-only
    ticks fade out and the 400 step ticks above 1600 fade in."""
    out: list[tuple[float, float]] = []
    for v in np.arange(Y_LO, Y_TOP_3 + 1, Y_TICK_1):
        v = float(v)
        if v % Y_TICK_3 == 0:
            alpha = 1.0 if v <= Y_TOP_1 else state.tick_fade
        else:
            alpha = 1.0 - state.tick_fade if v <= Y_TOP_1 else 0.0
        if alpha > 0.0 and v <= state.y_top + 1e-9:
            out.append((v, alpha))
    return out


def crossfade_text(draw_text: Any, text_nee: str, text_nbe: str, fade: float) -> None:
    """Two overlapping texts: the NEE text with alpha 1 - fade, the NBE text with alpha fade."""
    if fade < 1.0:
        draw_text(text_nee, 1.0 - fade)
    if fade > 0.0:
        draw_text(text_nbe, fade)


def draw(state: State, canvas: Canvas) -> np.ndarray:
    """Draw one frame. Returns the RGBA buffer (height, width, 4), uint8."""
    fs_small = 6 * FONT_SCALE
    fs_note = 7.5 * FONT_SCALE
    fig = plt.figure(figsize=canvas.figsize, dpi=canvas.dpi)
    ax = fig.add_axes(AXES_RECT)
    ax.set_xlim(X_LO, X_HI)
    ax.set_ylim(Y_LO, state.y_top)
    ax.set_axisbelow(True)
    ax.grid(True, color=GRID, lw=GRID_LW, zorder=0)
    ax.set_xticks(np.arange(X_LO, X_HI + 1, X_TICK))
    ticks = y_ticks(state)
    ax.set_yticks([v for v, _ in ticks])
    for tick, (_, alpha) in zip(ax.yaxis.get_major_ticks(), ticks, strict=True):
        tick.tick1line.set_alpha(alpha)
        tick.label1.set_alpha(alpha)
        tick.gridline.set_alpha(alpha)
    ax.set_xlabel(X_LABEL)

    def y_label(text: str, alpha: float) -> None:
        ax.text(
            YLABEL_X,
            0.5,
            text,
            transform=ax.transAxes,
            rotation=90,
            rotation_mode="anchor",
            ha="center",
            va="bottom",
            fontsize=plt.rcParams["axes.labelsize"],
            alpha=alpha,
        )

    # The two y labels have different lengths and would overlap. Thus the NEE label fades out
    # first. Then the NBE label fades in.
    if state.text_fade < 0.5:
        y_label(Y_LABEL_NEE, 1.0 - 2.0 * state.text_fade)
    else:
        y_label(Y_LABEL_NBE, 2.0 * state.text_fade - 1.0)
    # The 1:1 line, inside the axes. No guide lines NEE/NBE = -200 and -400 (Figures 4 and 1
    # have them; removed on user request 2026-10-28).
    ax.plot(
        [X_LO, min(X_HI, state.y_top)],
        [X_LO, min(X_HI, state.y_top)],
        color=INK,
        lw=1.8,
        ls=":",
        zorder=1,
    )

    def note(x: float, y: float, ha: str, va: str) -> Any:
        def put(text: str, alpha: float) -> None:
            ax.text(
                x,
                y,
                text,
                transform=ax.transAxes,
                ha=ha,
                va=va,
                fontsize=fs_note,
                fontweight="bold",
                alpha=alpha,
            )

        return put

    # "net source" in two lines: one line would reach the Hyytiala 2020 star at the end.
    crossfade_text(
        note(0.03, 0.975, "left", "top"),
        "net source\n(NEE > 0)",
        "net source\n(NBE > 0)",
        state.text_fade,
    )
    crossfade_text(
        note(0.97, 0.02, "right", "bottom"),
        "net sink (NEE < 0)",
        "net sink (NBE < 0)",
        state.text_fade,
    )
    handles: list[Any] = []
    maktau_index = -1
    for site in (*ALL_SITES, REF_SITE):
        sp = [p for p in state.points if p.site == site]
        if not sp:
            continue
        color, marker, ms, zorder, legend = site_style(site)
        for p in sp:
            if p.shift is not None:
                ter, tick_alpha = p.shift
                ax.plot(
                    [p.x, p.x],
                    [ter, p.y],
                    color=SHIFT,
                    lw=1.0,
                    zorder=1.5,
                    solid_capstyle="butt",
                )
                if tick_alpha > 0.0:
                    ax.plot(
                        [p.x],
                        [ter],
                        ls="none",
                        marker="_",
                        ms=9,
                        mew=1.4,
                        color=SHIFT,
                        alpha=tick_alpha,
                        zorder=1.6,
                    )
            if p.whisker is not None:
                lo, hi, wa = p.whisker
                ax.plot(
                    [p.x, p.x],
                    [lo, hi],
                    color=color,
                    lw=1.6,
                    alpha=wa,
                    zorder=zorder - 0.1,
                    solid_capstyle="butt",
                )
                ax.plot(
                    [p.x, p.x],
                    [lo, hi],
                    ls="none",
                    marker="_",
                    ms=10,  # ms 10 = 2 x the errorbar capsize 5 of nbe_plot()
                    mew=1.6,
                    color=color,
                    alpha=wa,
                    zorder=zorder - 0.1,
                )
            if p.alpha > 0.0:
                ax.plot(
                    [p.x],
                    [p.y],
                    ls="none",
                    marker=marker,
                    ms=ms,
                    mfc=p.mfc,
                    mec=p.mec,
                    mew=p.mew,
                    alpha=p.alpha,
                    zorder=zorder,
                    clip_on=False,
                )
            lb = p.label
            if lb is not None and lb.alpha > 0.0:
                leader = (
                    {**LEADER_STYLE, "alpha": lb.leader_alpha}
                    if lb.leader_alpha > 0
                    else None
                )
                ax.annotate(
                    lb.text,
                    (p.x, p.y),
                    xytext=(lb.dx, lb.dy),
                    textcoords="offset points",
                    ha=lb.ha,
                    va="center",
                    fontsize=fs_small,
                    linespacing=1.0,
                    alpha=lb.alpha,
                    zorder=4,
                    bbox={
                        "boxstyle": "square,pad=0.1",
                        "fc": "white",
                        "ec": "none",
                        "alpha": lb.alpha,
                    },
                    arrowprops=leader,
                )
        if site == "maktau":
            maktau_index = len(handles)
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
    leg = fig.legend(
        handles=handles,
        loc="upper left",
        bbox_to_anchor=(LEGEND_X, LEGEND_TOP),
        frameon=False,
        title="Site",
        title_fontsize=7 * FONT_SCALE,
        alignment="left",
        handletextpad=0.4,
        labelspacing=0.7,
        borderaxespad=0,
    )
    if maktau_index >= 0:
        leg.legend_handles[maktau_index].set_alpha(state.maktau_alpha)  # type: ignore[union-attr]
        leg.get_texts()[maktau_index].set_alpha(state.maktau_alpha)
    if state.class_legend_alpha > 0.0:
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
        leg2 = fig.legend(
            handles=key_handles,
            loc="upper left",
            bbox_to_anchor=(LEGEND_X, CLASS_LEGEND_TOP),
            frameon=False,
            title="Class",
            title_fontsize=7 * FONT_SCALE,
            alignment="left",
            handletextpad=0.6,
            labelspacing=1.0,
            borderaxespad=0,
        )
        al = state.class_legend_alpha
        leg2.get_title().set_alpha(al)
        for t in leg2.get_texts():
            t.set_alpha(al)
        for h in leg2.legend_handles:
            h.set_alpha(al)  # type: ignore[union-attr]
    fig.canvas.draw()
    buf = np.asarray(fig.canvas.buffer_rgba()).copy()  # type: ignore[attr-defined]
    plt.close(fig)
    if buf.shape != (canvas.height, canvas.width, 4):
        raise RuntimeError(
            f"frame buffer is {buf.shape}, expected {(canvas.height, canvas.width, 4)}"
        )
    return buf


# ======================================================================================
# Timeline and encoding
# ======================================================================================
@dataclass(frozen=True)
class Clip:
    name: str
    start_s: float
    end_s: float
    start_frame: int
    end_frame: int  # exclusive
    content: str

    @property
    def frames(self) -> int:
        return self.end_frame - self.start_frame


def timeline(fps: int) -> tuple[Clip, ...]:
    """The clips with their frame ranges. Frame i is at t = i / fps."""
    return tuple(
        Clip(name, s, e, round(s * fps), round(e * fps), content)
        for name, s, e, content in CLIPS
    )


def total_frames(fps: int) -> int:
    return round(END * fps)


def ffmpeg_cmd(exe: str, canvas: Canvas, fps: int, out: Path) -> list[str]:
    """ffmpeg command that reads raw RGBA frames on stdin and writes H.264 yuv420p, no audio."""
    return [
        exe,
        "-y",
        "-loglevel", "error",
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "-s", f"{canvas.width}x{canvas.height}",
        "-r", str(fps),
        "-i", "-",
        "-an",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "18",
        "-preset", "slow",
        "-movflags", "+faststart",
        str(out),
    ]  # fmt: skip


def find_ffmpeg() -> str:
    """A system ffmpeg from PATH, else the static binary of the imageio-ffmpeg wheel."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg  # the wheel bundles ffmpeg with libx264

    return imageio_ffmpeg.get_ffmpeg_exe()


def ffmpeg_version(exe: str) -> str:
    r = subprocess.run([exe, "-version"], capture_output=True, text=True, check=True)
    return r.stdout.splitlines()[0]


class Encoder:
    """One ffmpeg process that takes raw frames on stdin."""

    def __init__(self, cmd: list[str], log_path: Path) -> None:
        self.cmd = cmd
        self.out = Path(cmd[-1])
        self.log_path = log_path
        self.log_file = log_path.open("w", encoding="utf-8")
        self.closed = False
        self.proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self.log_file
        )

    def write(self, frame: np.ndarray) -> None:
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.write(frame.tobytes())
        except BrokenPipeError:
            self.close()  # the encoder stopped: raises RuntimeError with its log
            raise RuntimeError(f"ffmpeg closed the pipe early for {self.out}")

    def close(self) -> None:
        """Close stdin, wait, and raise RuntimeError with the log tail on a failure."""
        if self.closed:
            return
        self.closed = True
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.close()
        except BrokenPipeError:
            pass
        code = self.proc.wait()
        self.log_file.close()
        if code != 0:
            tail = "\n".join(
                self.log_path.read_text(
                    encoding="utf-8", errors="replace"
                ).splitlines()[-20:]
            )
            raise RuntimeError(
                f"ffmpeg failed with code {code} for {self.out}: {self.cmd}\n{tail}"
            )
        if self.log_path.stat().st_size == 0:
            self.log_path.unlink()  # ffmpeg wrote no error

    def abort(self) -> None:
        """Kill the process if it runs and close the log file (on an error elsewhere)."""
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        if not self.log_file.closed:
            self.log_file.close()
        self.closed = True


def write_png(path: Path, frame: np.ndarray) -> None:
    mimage.imsave(path, frame[:, :, :3])


def render(
    points: tuple[Point, ...],
    canvas: Canvas,
    fps: int,
    out: Path,
    stills_only: bool,
    frames_dir: Path | None,
) -> dict[str, Any]:
    sizes = label_sizes(points, canvas)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    for name, t in STILLS:
        write_png(out / f"{name}.png", draw(still_state(t, points, sizes), canvas))
        log.info("still %s.png (t = %.1f s)", name, t)
    info: dict[str, Any] = {
        "fps": fps,
        "width": canvas.width,
        "height": canvas.height,
        "stills": [{"file": f"{n}.png", "time_s": t} for n, t in STILLS],
    }
    if stills_only:
        info["renderSeconds"] = round(time.monotonic() - t0, 1)
        return info
    exe = find_ffmpeg()
    version = ffmpeg_version(exe)
    log.info("ffmpeg: %s (%s)", exe, version)
    clips = timeline(fps)
    n_total = total_frames(fps)
    if frames_dir is not None:
        frames_dir.mkdir(parents=True, exist_ok=True)
    full = Encoder(
        ffmpeg_cmd(exe, canvas, fps, out / f"{FULL_NAME}.mp4"),
        out / f"{FULL_NAME}.ffmpeg.log",
    )
    encoders = {
        c.name: Encoder(
            ffmpeg_cmd(exe, canvas, fps, out / f"{c.name}.mp4"),
            out / f"{c.name}.ffmpeg.log",
        )
        for c in clips
    }
    last_state: State | None = None
    buf: np.ndarray | None = None
    unique = 0
    try:
        for i in range(n_total):
            t = i / fps
            st = state_at(t, points, sizes)
            key_state = replace(st, t=0.0)
            if buf is None or key_state != last_state:
                buf = draw(key_state, canvas)
                last_state = key_state
                unique += 1
            full.write(buf)
            clip = next(c for c in clips if c.start_frame <= i < c.end_frame)
            encoders[clip.name].write(buf)
            if frames_dir is not None:
                write_png(frames_dir / f"frame-{i:05d}.png", buf)
            if i + 1 == clip.end_frame:
                encoders[clip.name].close()
                log.info("clip %s.mp4 done (%d frames)", clip.name, clip.frames)
            if i % fps == 0:
                log.info("frame %d of %d (t = %.1f s, drawn %d)", i, n_total, t, unique)
        full.close()
    except BaseException:
        for enc in (full, *encoders.values()):
            enc.abort()
        raise
    seconds = time.monotonic() - t0
    log.info("done: %d frames, %d drawn, %.0f s", n_total, unique, seconds)
    info.update(
        {
            "ffmpeg": {"exe": exe, "version": version},
            "full": {
                "file": f"{FULL_NAME}.mp4",
                "start_s": 0.0,
                "end_s": END,
                "frames": n_total,
                "cuts_s": [c.start_s for c in clips[1:]],
            },
            "clips": [
                {
                    "file": f"{c.name}.mp4",
                    "content": c.content,
                    "start_s": c.start_s,
                    "end_s": c.end_s,
                    "duration_s": round(c.end_s - c.start_s, 6),
                    "start_frame": c.start_frame,
                    "end_frame_exclusive": c.end_frame,
                    "frames": c.frames,
                }
                for c in clips
            ],
            "framesDrawn": unique,
            "renderSeconds": round(seconds, 1),
        }
    )
    return info


# ======================================================================================
# Main
# ======================================================================================
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Render the NEE to NBE animation (MP4 clips and stills)."
    )
    ap.add_argument(
        "--repo",
        type=Path,
        default=REPO,
        help="repository root (default: from the script path)",
    )
    ap.add_argument(
        "--out", type=Path, default=None, help=f"output folder (default: {DEFAULT_OUT})"
    )
    ap.add_argument("--fps", type=int, default=FPS)
    ap.add_argument(
        "--width",
        type=int,
        default=DEFAULT_WIDTH,
        help="frame width in px (4:3; multiple of 8)",
    )
    ap.add_argument(
        "--stills-only", action="store_true", help="write only the three PNG stills"
    )
    ap.add_argument(
        "--frames",
        action="store_true",
        help=f"also write every frame as PNG to {FRAMES_DIR}",
    )
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    args = parse_args(argv)
    repo: Path = args.repo.resolve()
    out: Path = (args.out if args.out is not None else repo / DEFAULT_OUT).resolve()
    try:
        canvas = canvas_for(args.width)
        if args.fps <= 0:
            raise ValueError("--fps must be greater than 0")
    except ValueError as e:
        log.error("%s", e)
        return 2
    try:
        points = point_table(load_json(repo / NB_RESULTS), load_json(repo / CS_RESULTS))
    except (DataError, FileNotFoundError, KeyError) as e:
        log.error("data check failed: %s", e)
        return 3
    log.info(
        "%d points (%d in the NBE view)", len(points), sum(p.in_nbe for p in points)
    )
    setup_matplotlib()
    frames_dir = (repo / FRAMES_DIR) if args.frames else None
    try:
        info = render(points, canvas, args.fps, out, args.stills_only, frames_dir)
    except RuntimeError as e:
        log.error("%s", e)
        return 1
    info["timeline_s"] = {"cut1": CUT1, "cut2": CUT2, "end": END}
    (out / "timeline.json").write_text(
        json.dumps(info, indent=2) + "\n", encoding="utf-8"
    )
    log.info("wrote %s", out / "timeline.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
