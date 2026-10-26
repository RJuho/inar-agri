"""Unit tests of second_dates.py (the wide second dates) and of its rows in results.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import second_dates as sd

HERE = Path(__file__).parent


class FakeTable:
    """A day table with one value per day from a dict var -> {day: value}."""

    def __init__(self, data: dict[str, dict[int, float]]) -> None:
        self.data = data

    def values(self, var: str, lo: int, hi: int) -> np.ndarray:
        out = np.full(hi - lo + 1, np.nan)
        for d, v in self.data.get(var, {}).items():
            if lo <= d <= hi:
                out[d - lo] = v
        return out


def test_day_number_round_trip() -> None:
    assert sd.day_number("1970-01-01") == 0
    assert sd.day_number("2022-08-08") == 19212
    assert sd.iso_day(sd.day_number("2021-06-01")) == "2021-06-01"


def test_is_wide() -> None:
    assert sd.is_wide({"daysApart": 13})
    assert sd.is_wide({"daysApart": -31})
    assert not sd.is_wide({"daysApart": 12})
    assert not sd.is_wide({"daysApart": -12})


def test_window_and_changes() -> None:
    # Days 0..30: GPP 10 before day 10, 4 after; precip 1 mm per day; Reco 5 then 6.
    gpp = {d: (10.0 if d < 10 else 4.0) for d in range(31)}
    reco = {d: (5.0 if d < 10 else 6.0) for d in range(31)}
    precip = {d: 1.0 for d in range(31)}
    t = FakeTable({"gpp": gpp, "reco": reco, "precip": precip})
    w = sd.date_windows(t, 10, 10)
    assert w["windowBefore"] == [sd.iso_day(3), sd.iso_day(9)]
    assert w["windowAfter"] == [sd.iso_day(11), sd.iso_day(17)]
    assert w["before"]["gpp"] == {"n": 7, "mean": 10.0}
    assert w["after"]["gpp"] == {"n": 7, "mean": 4.0}
    assert w["change"]["gpp"] == -6.0
    assert w["changePct"]["gpp"] == pytest.approx(-60.0)
    assert w["changePct"]["reco"] == pytest.approx(20.0)
    assert w["before"]["precip"] == {"n": 7, "sum": 7.0}
    # No value: n 0, mean None, change None.
    assert w["before"]["ta"] == {"n": 0, "mean": None}
    assert w["change"]["ta"] is None
    assert w["changePct"]["gpp"] is not None


def test_change_needs_min_days() -> None:
    gpp = {d: 10.0 for d in range(7)} | {
        d: 4.0 for d in range(11, 11 + sd.MIN_DAYS - 1)
    }
    t = FakeTable({"gpp": gpp})
    w = sd.date_windows(t, 10, 10)
    assert w["after"]["gpp"]["n"] == sd.MIN_DAYS - 1
    assert w["change"]["gpp"] is None
    assert w["changePct"]["gpp"] is None


def test_date_range_end_day() -> None:
    # A 7-day event (days 10 to 16): the after window starts at day 17.
    t = FakeTable({"gpp": {d: float(d) for d in range(40)}})
    w = sd.date_windows(t, 10, 16)
    assert w["windowAfter"] == [sd.iso_day(17), sd.iso_day(23)]
    assert w["after"]["gpp"]["mean"] == pytest.approx(20.0)


def test_span_facts() -> None:
    t = FakeTable({"gpp": {0: 3.0, 1: 1.0, 2: 5.0}, "precip": {0: 2.0, 2: 3.0}})
    s = sd.span_facts(t, 0, 2)
    assert s["gppMin"] == 1.0 and s["gppMinDay"] == sd.iso_day(1)
    assert s["gppMax"] == 5.0 and s["gppMaxDay"] == sd.iso_day(2)
    assert s["precipMm"] == 5.0 and s["precipDays"] == 2 and s["nGpp"] == 3
    empty = sd.span_facts(FakeTable({}), 0, 2)
    assert empty["gppMin"] is None and empty["precipMm"] is None


def _alt(days_apart: int, **kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "site": "x",
        "type": "harvest",
        "episodeId": "x-2020-01-11",
        "dateUsed": "2020-01-11",
        "dateEndUsed": None,
        "dateOther": sd.iso_day(sd.day_number("2020-01-11") + days_apart),
        "dateEndOther": None,
        "daysApart": days_apart,
        "sourceUsed": "a",
        "sourceOther": "b",
        "sourceShort": "xlsx",
        "detected": None,
        "nearer": None,
    }
    return base | kw


def test_analyse_wide_filters_and_span() -> None:
    t = FakeTable({"gpp": {d: 1.0 for d in range(18000, 18400)}})
    rows = sd.analyse_wide([_alt(5), _alt(20), _alt(-40)], {"x": t})
    assert [r["daysApart"] for r in rows] == [20, -40]
    r = rows[1]
    lo = sd.day_number(r["dateOther"]) - sd.MARGIN_DAYS
    hi = sd.day_number(r["dateUsed"]) + sd.MARGIN_DAYS
    assert r["span"]["from"] == sd.iso_day(lo) and r["span"]["to"] == sd.iso_day(hi)
    assert set(r) >= {"used", "other", "span", "sourceUsed", "sourceOther"}


def test_fmt() -> None:
    assert sd.fmt(None) == "n/a"
    assert sd.fmt(-1.234, 1) == "−1.2"


def test_results_wide_rows() -> None:
    r = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
    alts = r["alternativeDates"]
    wide = r["wideDates"]
    assert [w["dateUsed"] for w in wide] == [
        a["dateUsed"] for a in alts if abs(a["daysApart"]) > sd.WIDE_DAYS
    ]
    assert r["counts"]["nWideDates"] == len(wide)
    assert r["method"]["wideDays"] == sd.WIDE_DAYS
    for w in wide:
        a = next(
            x for x in alts if x["site"] == w["site"] and x["dateUsed"] == w["dateUsed"]
        )
        assert w["sourceUsed"] == a["sourceUsed"]
        assert w["daysApart"] == a["daysApart"]
        for k in ("used", "other"):
            assert w[k]["before"]["gpp"]["n"] >= 0
            assert set(w[k]["change"]) == set(sd.MEAN_VARS)
        assert w["span"]["from"] < w["dateUsed"] and w["span"]["from"] < w["dateOther"]
