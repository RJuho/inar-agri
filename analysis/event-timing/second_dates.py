"""Second dates far from the database date: the fluxes and the weather around both dates.

Imported by event-timing.py (method step 5b). The module has no own data read; the script
gives it the alternative-date rows (ALTERNATIVE_DATES with the test results) and the day
tables of the sites.

Method
    A second date is "wide" when the other date is more than WIDE_DAYS days from the date in
    the database (|days apart| > WIDE_DAYS). For each wide row and each of the two dates (the
    database date and the other date, each from its first day to its end day), the module gives
    the mean of the daily GPP, Reco and gap-filled NEE (g C m-2 d-1), the measured day-time -NEE
    (umol CO2 m-2 s-1), the air temperature (degC) and the soil water content (m3 m-3) over the
    7 days before the first day (BEFORE) and the 7 days after the end day (AFTER), the change
    (after - before, only when both sides have MIN_DAYS or more values), the change in percent
    of the before mean for GPP and Reco, and the sum of the precipitation (mm) in the same
    windows. The span of the figure runs from MARGIN_DAYS before the earlier date to
    MARGIN_DAYS after the later end day; the module gives the lowest and the highest daily GPP
    of the span with their days, and the precipitation sum of the span.

Figure
    One panel per wide row: daily GPP, Reco and NEE over the span, the precipitation as bars on a
    second y axis, the database date as a solid vertical line (with a grey band over its days)
    and the other date as a dashed line (with a light band).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, timedelta
from typing import Any, Protocol

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

WIDE_DAYS = 12
BEFORE = (-7, -1)
AFTER = (1, 7)
MIN_DAYS = 5
MARGIN_DAYS = 10
MEAN_VARS = ("gpp", "reco", "nee", "mneg", "ta", "swc")
PRECIP = "precip"
UNITS = {
    "gpp": "g C m-2 d-1",
    "reco": "g C m-2 d-1",
    "nee": "g C m-2 d-1",
    "mneg": "umol CO2 m-2 s-1",
    "ta": "degC",
    "swc": "m3 m-3",
    "precip": "mm",
}
GPP_COLOR = "#0072b2"
RECO_COLOR = "#e69f00"
NEE_COLOR = "#000000"
PRECIP_COLOR = "#56b4e9"
BAND_USED = "#777777"
BAND_OTHER = "#cc79a7"
INK = "#222222"
MM = 1 / 25.4
FIG_WIDTH_IN = 180 * MM
PANEL_HEIGHT_IN = 1.55
EPOCH = date(1970, 1, 1)


class DayValues(Protocol):
    """A day table: values of a variable over a day range (NaN = no value)."""

    def values(self, var: str, lo: int, hi: int) -> np.ndarray: ...


def day_number(s: str) -> int:
    """Days since 1970-01-01 of an ISO date (the same number as a matplotlib date)."""
    return (date.fromisoformat(s[:10]) - EPOCH).days


def iso_day(n: int) -> str:
    return (EPOCH + timedelta(days=n)).isoformat()


def fmt(x: float | None, digits: int = 2) -> str:
    """Number for the alt text: fixed decimals, minus sign as U+2212; n/a for None."""
    if x is None:
        return "n/a"
    return f"{x:.{digits}f}".replace("-", "−")


def mean_n(xs: np.ndarray) -> tuple[int, float | None]:
    v = xs[~np.isnan(xs)]
    return len(v), (float(v.mean()) if len(v) else None)


def sum_n(xs: np.ndarray) -> tuple[int, float | None]:
    v = xs[~np.isnan(xs)]
    return len(v), (float(v.sum()) if len(v) else None)


def window(table: DayValues, lo: int, hi: int) -> dict[str, dict[str, Any]]:
    """Count and mean (precip: count and sum) of each variable over the days lo .. hi."""
    out: dict[str, dict[str, Any]] = {}
    for v in MEAN_VARS:
        n, m = mean_n(table.values(v, lo, hi))
        out[v] = {"n": n, "mean": m}
    n, s = sum_n(table.values(PRECIP, lo, hi))
    out[PRECIP] = {"n": n, "sum": s}
    return out


def is_wide(row: dict[str, Any]) -> bool:
    return abs(int(row["daysApart"])) > WIDE_DAYS


def date_windows(table: DayValues, start: int, end: int) -> dict[str, Any]:
    """Before and after windows of one date range, the changes and the percent changes."""
    before = window(table, start + BEFORE[0], start + BEFORE[1])
    after = window(table, end + AFTER[0], end + AFTER[1])
    change: dict[str, float | None] = {}
    pct: dict[str, float | None] = {}
    for v in MEAN_VARS:
        a, b = after[v]["mean"], before[v]["mean"]
        ok = after[v]["n"] >= MIN_DAYS and before[v]["n"] >= MIN_DAYS
        change[v] = a - b if ok and a is not None and b is not None else None
    for v in ("gpp", "reco"):
        c, b = change[v], before[v]["mean"]
        pct[v] = 100.0 * c / b if c is not None and b is not None and b > 0 else None
    return {
        "start": iso_day(start),
        "end": iso_day(end),
        "windowBefore": [iso_day(start + BEFORE[0]), iso_day(start + BEFORE[1])],
        "windowAfter": [iso_day(end + AFTER[0]), iso_day(end + AFTER[1])],
        "before": before,
        "after": after,
        "change": change,
        "changePct": pct,
    }


def span_facts(table: DayValues, lo: int, hi: int) -> dict[str, Any]:
    gpp = table.values("gpp", lo, hi)
    ok = ~np.isnan(gpp)
    out: dict[str, Any] = {
        "from": iso_day(lo),
        "to": iso_day(hi),
        "nGpp": int(ok.sum()),
    }
    if ok.any():
        i_min = int(np.nanargmin(gpp))
        i_max = int(np.nanargmax(gpp))
        out.update(
            {
                "gppMin": float(gpp[i_min]),
                "gppMinDay": iso_day(lo + i_min),
                "gppMax": float(gpp[i_max]),
                "gppMaxDay": iso_day(lo + i_max),
            }
        )
    else:
        out.update(
            {"gppMin": None, "gppMinDay": None, "gppMax": None, "gppMaxDay": None}
        )
    n, s = sum_n(table.values(PRECIP, lo, hi))
    out["precipDays"] = n
    out["precipMm"] = s
    return out


def analyse_wide(
    alts: list[dict[str, Any]], tables: Mapping[str, DayValues]
) -> list[dict[str, Any]]:
    """One result per wide alternative-date row, in the order of the rows."""
    out = []
    for a in alts:
        if not is_wide(a):
            continue
        t = tables[a["site"]]
        used = (
            day_number(a["dateUsed"]),
            day_number(a["dateEndUsed"] or a["dateUsed"]),
        )
        other = (
            day_number(a["dateOther"]),
            day_number(a["dateEndOther"] or a["dateOther"]),
        )
        lo = min(used[0], other[0]) - MARGIN_DAYS
        hi = max(used[1], other[1]) + MARGIN_DAYS
        out.append(
            {
                "site": a["site"],
                "type": a["type"],
                "episodeId": a["episodeId"],
                "dateUsed": a["dateUsed"],
                "dateEndUsed": a["dateEndUsed"],
                "dateOther": a["dateOther"],
                "dateEndOther": a["dateEndOther"],
                "daysApart": a["daysApart"],
                "sourceUsed": a["sourceUsed"],
                "sourceOther": a["sourceOther"],
                "sourceShort": a["sourceShort"],
                "detected": a["detected"],
                "nearer": a["nearer"],
                "used": date_windows(t, *used),
                "other": date_windows(t, *other),
                "span": span_facts(t, lo, hi),
            }
        )
    return out


def _utc_text(offset_min: int) -> str:
    h = offset_min // 60
    return f"UTC+{h}" if h >= 0 else f"UTC{h}"


def _mark(
    ax: Any,
    start: int,
    end: int,
    color: str,
    dash: Any,
    band: str,
    label: str,
    y: float,
) -> None:
    if end > start:
        ax.axvspan(start, end + 1, color=band, alpha=0.15, lw=0, zorder=1)
    ax.axvline(start, color=color, lw=1.0, linestyle=dash, zorder=5)
    ax.text(
        start,
        y,
        label,
        ha="center",
        va="bottom",
        fontsize=6.5,
        color=INK,
        transform=ax.get_xaxis_transform(),
        clip_on=False,
    )


def _win_text(w: dict[str, Any], what: str) -> str:
    c = w["change"]
    p = w["changePct"]
    gpp_pct = f" ({fmt(p['gpp'], 0)} %)" if p["gpp"] is not None else ""
    reco_pct = f" ({fmt(p['reco'], 0)} %)" if p["reco"] is not None else ""
    return (
        f"Around the {what} ({w['start']}"
        + (f" to {w['end']}" if w["end"] != w["start"] else "")
        + f"): GPP {fmt(w['before']['gpp']['mean'])} before and {fmt(w['after']['gpp']['mean'])} after"
        + (f", change {fmt(c['gpp'])}{gpp_pct}" if c["gpp"] is not None else "")
        + f"; Reco {fmt(w['before']['reco']['mean'])} and {fmt(w['after']['reco']['mean'])}"
        + (f", change {fmt(c['reco'])}{reco_pct}" if c["reco"] is not None else "")
        + f"; NEE {fmt(w['before']['nee']['mean'])} and {fmt(w['after']['nee']['mean'])} g C m-2 d-1"
        + f"; air temperature {fmt(w['before']['ta']['mean'], 1)} and {fmt(w['after']['ta']['mean'], 1)} degC"
        + (
            f"; precipitation {fmt(w['before']['precip']['sum'], 0)} and {fmt(w['after']['precip']['sum'], 0)} mm"
            if w["before"]["precip"]["n"] or w["after"]["precip"]["n"]
            else "; no precipitation data"
        )
        + f" (7 days before the first day and 7 days after the end day, {MIN_DAYS} or more values per side for a change)."
    )


def fig_wide(
    rows: list[dict[str, Any]],
    tables: Mapping[str, DayValues],
    site_names: dict[str, str],
    utc_offsets: dict[str, int],
    source_text: dict[str, str],
) -> tuple[Any, str, str]:
    """One panel per wide row: daily GPP, Reco, NEE and precipitation over the span, both dates marked."""
    n = len(rows)
    fig, axes = plt.subplots(
        n, 1, figsize=(FIG_WIDTH_IN, PANEL_HEIGHT_IN * n + 1.0), squeeze=False
    )
    parts = []
    for ax, r in zip(axes[:, 0], rows, strict=True):
        t = tables[r["site"]]
        lo, hi = day_number(r["span"]["from"]), day_number(r["span"]["to"])
        x = np.arange(lo, hi + 1)
        precip = t.values(PRECIP, lo, hi)
        if np.isfinite(precip).any():
            ax2 = ax.twinx()
            ax2.bar(
                x + 0.5,
                np.nan_to_num(precip),
                width=1.0,
                color=PRECIP_COLOR,
                alpha=0.45,
                lw=0,
                zorder=2,
            )
            ax2.set_ylim(0, max(float(np.nanmax(precip)) * 2.5, 5.0))
            ax2.set_ylabel("Precip. (mm d$^{-1}$)", fontsize=7, color=INK)
            ax2.tick_params(labelsize=6.5, colors=INK)
            ax2.spines[["top"]].set_visible(False)
        ax.axhline(0, color=INK, lw=0.5, zorder=2)
        ax.plot(x + 0.5, t.values("gpp", lo, hi), color=GPP_COLOR, lw=1.2, zorder=4)
        ax.plot(
            x + 0.5,
            t.values("reco", lo, hi),
            color=RECO_COLOR,
            lw=1.2,
            linestyle=(0, (6, 3)),
            zorder=4,
        )
        ax.plot(
            x + 0.5,
            t.values("nee", lo, hi),
            color=NEE_COLOR,
            lw=1.0,
            linestyle=(0, (2, 2)),
            zorder=4,
        )
        used = (day_number(r["used"]["start"]), day_number(r["used"]["end"]))
        other = (day_number(r["other"]["start"]), day_number(r["other"]["end"]))
        _mark(
            ax,
            used[0],
            used[1],
            NEE_COLOR,
            "-",
            BAND_USED,
            f"database {r['dateUsed']}",
            1.02,
        )
        _mark(
            ax,
            other[0],
            other[1],
            NEE_COLOR,
            (0, (4, 2)),
            BAND_OTHER,
            f"other {r['dateOther']}",
            1.02,
        )
        ax.set_xlim(lo, hi + 1)
        ax.xaxis_date()
        ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4, maxticks=9))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b %Y"))
        ax.tick_params(labelsize=6.5, colors=INK)
        ax.set_ylabel("g C m$^{-2}$ d$^{-1}$", fontsize=7, color=INK)
        ax.set_title(
            f"{site_names[r['site']]}: {r['type']}, {r['daysApart']:+d} days apart "
            f"(other date from the {source_text.get(r['sourceOther'], r['sourceOther'])})",
            loc="left",
            fontsize=7.5,
            color=INK,
            pad=12,
        )
        ax.set_zorder(2)
        ax.patch.set_visible(False)
        ax.spines[["top"]].set_visible(False)
        parts.append(
            f"{site_names[r['site']]} {r['type']}, database date {r['dateUsed']}"
            + (f" to {r['dateEndUsed']}" if r["dateEndUsed"] else "")
            + f" and other date {r['dateOther']}"
            + (f" to {r['dateEndOther']}" if r["dateEndOther"] else "")
            + f" ({r['daysApart']:+d} days). "
            + _win_text(r["used"], "database date")
            + " "
            + _win_text(r["other"], "other date")
            + f" Lowest daily GPP of the span: {fmt(r['span']['gppMin'])} on {r['span']['gppMinDay']}; "
            f"highest: {fmt(r['span']['gppMax'])} on {r['span']['gppMaxDay']}; "
            + (
                f"precipitation of the span {fmt(r['span']['precipMm'], 0)} mm."
                if r["span"]["precipDays"]
                else "no precipitation data."
            )
        )
    offsets = sorted({utc_offsets[r["site"]] for r in rows})
    axes[-1, 0].set_xlabel(
        "Date (local time, " + ", ".join(_utc_text(o) for o in offsets) + ")",
        fontsize=7,
        color=INK,
    )
    axes[0, 0].set_title("NEE < 0 = uptake", loc="right", fontsize=7, color=INK, pad=12)
    handles = [
        Line2D([], [], color=GPP_COLOR, lw=1.2, label="GPP"),
        Line2D([], [], color=RECO_COLOR, lw=1.2, linestyle=(0, (6, 3)), label="Reco"),
        Line2D(
            [],
            [],
            color=NEE_COLOR,
            lw=1.0,
            linestyle=(0, (2, 2)),
            label="NEE (gap-filled)",
        ),
        Patch(facecolor=PRECIP_COLOR, alpha=0.45, label="Precipitation"),
        Line2D([], [], color=NEE_COLOR, lw=1.0, label="Database date"),
        Line2D(
            [], [], color=NEE_COLOR, lw=1.0, linestyle=(0, (4, 2)), label="Other date"
        ),
        Patch(facecolor=BAND_USED, alpha=0.15, label="Days of the database date"),
        Patch(facecolor=BAND_OTHER, alpha=0.15, label="Days of the other date"),
    ]
    fig.legend(
        handles=handles,
        loc="lower center",
        bbox_to_anchor=(0.5, 0.0),
        ncol=4,
        frameon=False,
        fontsize=6.8,
    )
    fig.subplots_adjust(
        left=0.07,
        right=0.93,
        top=0.95,
        bottom=0.95 / (PANEL_HEIGHT_IN * n + 1.0),
        hspace=0.75,
    )
    title = (
        f"Daily GPP, Reco, gap-filled NEE and precipitation around the {n} events whose second date is "
        f"more than {WIDE_DAYS} days from the date in the database. The solid line marks the database "
        "date, the dashed line the other date; the bands are the days of each."
    )
    desc = (
        f"{n} panels, one per event. X axis: date (local time). Left y axis: g C m-2 d-1 (GPP solid blue, "
        "Reco dashed orange, NEE dotted black; NEE < 0 = uptake). Right y axis: precipitation in mm per day "
        f"(bars). The span runs from {MARGIN_DAYS} days before the earlier date to {MARGIN_DAYS} days after "
        "the later end day. " + " ".join(parts)
    )
    return fig, title, desc
