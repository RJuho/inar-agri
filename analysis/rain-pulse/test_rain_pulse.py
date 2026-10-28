"""Unit tests of the pure functions, the results and the SVG text of the dive rain-pulse.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/rain-pulse/rain-pulse.py \\
    pytest analysis/rain-pulse/
"""

from __future__ import annotations

import importlib.util
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DB = REPO / "db"
CALC = REPO / "data" / "calculated"
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has a hyphen)."""
    spec = importlib.util.spec_from_file_location("rain_pulse", HERE / "rain-pulse.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["rain_pulse"] = mod
    spec.loader.exec_module(mod)
    return mod


rp = load_module()
LAG0 = rp.LAGS.index(0)


def results() -> dict[str, Any]:
    return json.loads((HERE / "results.json").read_text(encoding="utf-8"))


def series(n: int = 60) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Consecutive days, no rain, all days in the season."""
    return (
        np.arange(1000, 1000 + n, dtype=np.int64),
        np.zeros(n),
        np.ones(n, dtype=bool),
    )


# ---------- find_events ----------
def test_event_and_censoring_at_next_rain() -> None:
    day, rain, season = series()
    rain[10] = 6.0
    rain[16] = 7.0
    evs, c = rp.find_events(day, rain, season, 5.0)
    assert [e.i for e in evs] == [10, 16]
    first = evs[0]
    assert first.day0 == 1010 and first.last_lag == 5 and first.stop == "rain"
    assert first.rain0 == 6.0
    assert c["found"] == len(evs)


def test_pre_pulse_must_be_dry_and_known() -> None:
    day, rain, season = series()
    rain[10] = 6.0
    rain[12] = 5.0  # day -2 of a possible event on day 12 is wet (>= T), day 10 too
    rain[30] = 6.0
    rain[28] = np.nan  # day -2 has no rain value
    rain[45] = 6.0
    rain[42] = 4.9  # day -3 below the threshold: event
    evs, _ = rp.find_events(day, rain, season, 5.0)
    assert [e.i for e in evs] == [10, 45]
    # the event on day 10 stops at day 12 (rain >= T)
    assert evs[0].last_lag == 1 and evs[0].stop == "rain"


def test_censoring_at_missing_day_and_season_end_and_window() -> None:
    day, rain, season = series(80)
    rain[5] = 3.0
    rain[9] = np.nan
    rain[30] = 3.0
    season[36:] = False
    rain[50] = 3.0  # out of season: no event
    evs, _ = rp.find_events(day, rain, season, 2.0)
    assert [(e.i, e.last_lag, e.stop) for e in evs] == [
        (5, 3, "missing"),
        (30, 5, "season"),
    ]
    day, rain, season = series(80)
    rain[5] = 3.0
    evs, _ = rp.find_events(day, rain, season, 2.0)
    assert evs[0].last_lag == rp.LAG_MAX and evs[0].stop == "window"
    day, rain, season = series(12)
    rain[5] = 3.0
    evs, _ = rp.find_events(day, rain, season, 2.0)
    assert evs[0].last_lag == 6 and evs[0].stop == "missing"  # end of the data


def test_management_exclusion_window() -> None:
    day, rain, season = series()
    rain[10] = 6.0
    evs, c = rp.find_events(day, rain, season, 5.0, frozenset({1010 + 15}))
    assert not evs and c["droppedManagement"] == 1 and c["found"] == 1
    evs, c = rp.find_events(day, rain, season, 5.0, frozenset({1010 - 3}))
    assert not evs and c["droppedManagement"] == 1
    evs, c = rp.find_events(day, rain, season, 5.0, frozenset({1010 + 16, 1010 - 4}))
    assert len(evs) == 1 and c["droppedManagement"] == 0
    assert c["dropped"] == []


def test_haltiala_swc_rise_rule() -> None:
    day, rain, season = series()
    rain[10] = 6.0
    swc = np.full(day.size, 0.30)
    swc[11] = 0.3 + rp.SWC_RISE  # day 1 rises by exactly the limit
    evs, c = rp.find_events(day, rain, season, 5.0, swc=swc)
    assert len(evs) == 1 and c["droppedSwcCheck"] == 0
    swc[11] = 0.305
    evs, c = rp.find_events(day, rain, season, 5.0, swc=swc)
    assert not evs and c["droppedSwcCheck"] == 1
    swc[10] = 0.32  # day 0 rises
    evs, _ = rp.find_events(day, rain, season, 5.0, swc=swc)
    assert len(evs) == 1
    swc[9] = np.nan  # no SWC on day -1
    evs, c = rp.find_events(day, rain, season, 5.0, swc=swc)
    assert not evs and c["droppedSwcCheck"] == 1


def test_find_events_needs_consecutive_days() -> None:
    day, rain, season = series()
    day[5] += 1
    with pytest.raises(ValueError):
        rp.find_events(day, rain, season, 5.0)


# ---------- normalise_events, composite, pulse ----------
def make_event(i: int, last: int) -> Any:
    return rp.RainEvent(i, 1000 + i, last, "window", 6.0)


def test_normalise_ratio_and_diff() -> None:
    v = np.full(40, 2.0)
    v[10:13] = [4.0, 3.0, 2.0]
    ev = make_event(10, 2)
    m, pre, c = rp.normalise_events(v, [ev], "ratio")
    assert pre[0] == 2.0
    assert m[0, LAG0] == 2.0 and m[0, LAG0 + 1] == 1.5 and m[0, LAG0 + 2] == 1.0
    assert np.isnan(m[0, LAG0 + 3])  # after the end of the event
    assert np.allclose(m[0, :LAG0], 1.0)
    m, _, _ = rp.normalise_events(v, [ev], "diff")
    assert m[0, LAG0] == 2.0 and m[0, LAG0 + 1] == 1.0
    assert np.allclose(m[0, :LAG0], 0.0)
    assert c == {"noPrePulse": 0, "prePulseNotPositive": 0}


def test_normalise_two_of_three_rule_and_positive_ratio() -> None:
    v = np.full(40, 2.0)
    v[7] = np.nan  # one pre-pulse day missing: still a mean (2 of 3)
    m, pre, _ = rp.normalise_events(v, [make_event(10, 5)], "ratio")
    assert pre[0] == 2.0 and m[0, LAG0] == 1.0
    v[8] = np.nan  # two missing: no pre-pulse mean
    m, pre, c = rp.normalise_events(v, [make_event(10, 5)], "ratio")
    assert np.isnan(pre[0]) and np.isnan(m).all() and c["noPrePulse"] == 1
    assert not rp.event_used(m[0])
    w = np.full(40, -1.0)
    m, _, c = rp.normalise_events(w, [make_event(10, 5)], "ratio")
    assert np.isnan(m).all() and c["prePulseNotPositive"] == 1
    m, _, _ = rp.normalise_events(w, [make_event(10, 5)], "diff")
    assert m[0, LAG0] == 0.0


def test_composite_hides_lags_with_few_events() -> None:
    mat = np.full((6, len(rp.LAGS)), np.nan)
    mat[:, LAG0] = [1, 2, 3, 4, 5, 6]
    mat[:4, LAG0 + 1] = 1.0
    c = rp.composite(mat)
    assert c["lag"] == list(rp.LAGS)
    assert c["n"][LAG0] == 6 and c["shown"][LAG0]
    assert c["n"][LAG0 + 1] == 4 and not c["shown"][LAG0 + 1]
    assert c["mean"][LAG0] == 3.5
    sd = float(np.std([1, 2, 3, 4, 5, 6], ddof=1))
    assert math.isclose(c["sd"][LAG0], sd)
    assert math.isclose(c["se"][LAG0], sd / math.sqrt(6))
    assert c["mean"][0] is None and c["n"][0] == 0


def test_pulse_sizes_two_of_three() -> None:
    mat = np.full((2, len(rp.LAGS)), np.nan)
    mat[0, LAG0 : LAG0 + 3] = [1.0, 2.0, np.nan]
    mat[1, LAG0] = 5.0
    p = rp.pulse_sizes(mat)
    assert p[0] == 1.5 and np.isnan(p[1])


def test_pooled_pre_sd() -> None:
    mat = np.full((3, len(rp.LAGS)), np.nan)
    pre = np.array([[1.0, 2.0, 3.0], [2.0, 2.0, 2.0], [0.0, 1.0, 5.0]])
    mat[:, :LAG0] = pre
    got = rp.pooled_pre_sd(rp.composite(mat))
    assert got is not None and math.isclose(got, float(np.std(pre, ddof=1)))


# ---------- Daily NEE, Lloyd-Taylor, SWC relation ----------
def test_hour_weighted_nee() -> None:
    got = rp.hour_weighted_nee(2.0, -6.0, 20, 48)
    assert math.isclose(got, 20 / 48 * 2.0 + 28 / 48 * -6.0)
    assert math.isnan(rp.hour_weighted_nee(math.nan, -6.0, 20, 48))
    assert math.isnan(rp.hour_weighted_nee(2.0, -6.0, 0, 0))


def test_lloyd_taylor_recovers_parameters() -> None:
    rng = np.random.default_rng(1)
    t = rng.uniform(4, 24, 600)
    r = rp.lt_model(t, 3.0, 250.0) + rng.normal(0, 0.2, t.size)
    f = rp.fit_lloyd_taylor(t, r)
    assert abs(f["rref"] - 3.0) < 0.1
    assert abs(f["e0"] - 250.0) < 25
    assert f["nSample"] == 600 and f["n"] < 600  # the trim drops about 10 %
    assert 0.1 < f["rmse"] < 0.25
    assert not f["e0AtBound"]
    assert f["e0Se"] > 0 and f["rrefSe"] > 0


def test_lloyd_taylor_model_at_reference_temperature() -> None:
    assert math.isclose(float(rp.lt_model(np.array([rp.T_REF]), 2.5, 300.0)[0]), 2.5)


def test_fit_usable() -> None:
    assert rp.fit_usable(np.linspace(5, 10, rp.FIT_MIN_N))
    assert not rp.fit_usable(np.linspace(5, 9.9, rp.FIT_MIN_N))
    assert not rp.fit_usable(np.linspace(5, 20, rp.FIT_MIN_N - 1))


def test_swc_relation() -> None:
    x = [0.0, 0.1, 0.2, 0.3, float("nan")]
    y = [1.0, 1.2, 1.4, 1.6, 2.0]
    rel = rp.swc_relation(x, y)
    assert rel["n"] == 4
    assert math.isclose(rel["slope"], 2.0) and math.isclose(rel["intercept"], 1.0)
    assert math.isclose(rel["r"], 1.0) and math.isclose(rel["rho"], 1.0)
    few = rp.swc_relation([0.0, 0.1], [1.0, 2.0])
    assert few["n"] == 2 and few["slope"] is None and few["r"] is None


def test_round_sig_and_compare() -> None:
    assert rp.round_sig(1.23456789012345) == 1.23456789
    assert rp.round_sig(float("nan")) is None
    assert rp.compare({"a": 1.0}, {"a": 1.0 + 1e-9}) == []
    assert rp.compare({"a": 1.0}, {"a": 1.1})


def test_emoji_warning_covers_all_code_points() -> None:
    for e in rp.SITE_EMOJI.values():
        for ch in e:
            assert re.search(
                rp.EMOJI_GLYPH_WARNING,
                f"Glyph {ord(ch)} (\\N{{X}}) missing from font(s) DejaVu Sans.",
            )
    assert set(rp.SITE_EMOJI) == set(rp.ALL_SITES)


# ---------- Docstring = constants ----------
def test_docstring_inputs_equal_constant() -> None:
    doc = rp.parse_docstring_inputs(rp.__doc__ or "")
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in rp.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    doc = rp.__doc__ or ""
    assert f"builtAt: {rp.DATABASE['builtAt']}" in doc
    assert f"calcBuiltAt: {rp.DATABASE['calcBuiltAt']}" in doc
    assert f"commit: {rp.DATABASE['commit']}" in doc
    assert f"uv run analysis/{rp.SLUG}/{rp.SLUG}.py" in doc


# ---------- Results ----------
def test_results_consistent() -> None:
    res = results()
    assert res["slug"] == rp.SLUG and res["script"] == rp.SCRIPT_PATH
    assert set(res["summary"]) == set(rp.ALL_SITES)
    for s in rp.ALL_SITES:
        su = res["summary"][s]
        for v in rp.VARIABLES:
            comp = res["composite"][v]["t5"][s]
            assert su[v]["day0N"] == comp["n"][LAG0]
            assert su[v]["used"] == len(res["pulses"][v][s])
            assert su[v]["used"] == res["events"][s]["t5"]["used"][v]
            assert res["swc"][v][s]["n"] <= su[v]["used"]
        for t in ("t2", "t5", "t10"):
            e = res["events"][s][t]
            dropped = e["droppedManagement"] + (e["droppedSwcCheck"] or 0)
            assert e["found"] - dropped == e["kept"]
            assert all(n <= e["kept"] for n in e["used"].values())
    assert [f["n"] for f in res["figures"]] == [n for n, *_ in rp.FIGURES]


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"), key=lambda p: int(p.name.split("-")[0]))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name, *_ in rp.FIGURES]


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    root = ET.parse(path).getroot()
    tid, did = f"{rp.SLUG}-fig{n}-title", f"{rp.SLUG}-fig{n}-desc"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = [str(e.get("id")) for e in root.iter() if e.get("id")]
    assert len(ids) == len(set(ids))
    keep = {tid, did}
    assert all(i.startswith(f"{rp.SVG_ID_PREFIX}{n}-") for i in ids if i not in keep)
    fig = next(f for f in results()["figures"] if f["n"] == n)
    assert children[0].text == fig["title"]
    assert children[1].text == fig["desc"]
    for emoji in rp.SITE_EMOJI.values():  # no emojis in the caption and the alt text
        assert emoji not in fig["title"] and emoji not in fig["desc"]
    texts = root.findall(f".//{SVG_NS}text")
    assert texts, "the text must stay text (svg.fonttype none)"
    for t in texts:
        style = t.get("style") or ""
        assert rp.FONT_STACK in style
        assert "font-variant-numeric: tabular-nums" in style
    assert path.stat().st_size < 1_000_000


# ---------- Changes of 2026-10-28 ----------
def test_night_days_assign_morning_to_previous_day() -> None:
    day = np.array([100, 100, 100, 100, 101], dtype=np.int64)
    hour = np.array([0.0, 5.5, 11.5, 22.0, 3.0])
    assert rp.night_days(day, hour).tolist() == [99, 99, 99, 100, 100]
    # local hour 12:00 stays on its own day
    assert rp.night_days(np.array([7]), np.array([12.0])).tolist() == [7]


def test_e0_valid_rule() -> None:
    assert rp.e0_valid(100.0, 20.0)
    assert not rp.e0_valid(45.0, 15.0)  # E0 - SE = 30, not > 30
    assert not rp.e0_valid(540.0, 10.0)  # E0 + SE = 550, not < 550
    assert not rp.e0_valid(-100.0, 10.0)
    assert not rp.e0_valid(200.0, float("nan"))
    assert not rp.e0_valid(None, 10.0)


def test_fit_rref_fixed_closed_form() -> None:
    t = np.linspace(5, 20, 50)
    r = rp.lt_model(t, 2.0, 200.0)
    f = rp.fit_rref_fixed(t, r, 200.0)
    assert math.isclose(f["rref"], 2.0) and f["n"] == 50
    assert f["rrefSe"] < 1e-9
    g = np.exp(200.0 * rp.lt_g(t))
    r2 = r + np.linspace(-0.1, 0.1, 50)
    f2 = rp.fit_rref_fixed(t, r2, 200.0)
    assert math.isclose(f2["rref"], float((r2 * g).sum() / (g * g).sum()))


def test_choose_fit_chain() -> None:
    t = np.linspace(5, 20, 10)
    r = rp.lt_model(t, 2.0, 281.0)
    own_ok = {
        "e0": 300.0,
        "e0Se": 10.0,
        "rref": 3.0,
        "rrefSe": 0.1,
        "n": 9,
        "valid": True,
    }
    own_bad = {**own_ok, "e0": -100.0, "valid": False}
    site_ok = {"e0": 250.0, "e0Se": 9.0, "rref": 2.5, "rrefSe": 0.1, "valid": True}
    site_bad = {**site_ok, "valid": False}
    assert rp.choose_fit(own_ok, site_bad, 281.0, t, r)["method"] == "own"
    f = rp.choose_fit(own_bad, site_ok, 281.0, t, r)
    assert f["method"] == "site" and f["e0Source"] == "site" and f["e0"] == 250.0
    assert f["n"] == 10
    # Rref of the site-year with the site E0 fixed, not the Rref of the site fit
    assert math.isclose(f["rref"], rp.fit_rref_fixed(t, r, 250.0)["rref"])
    assert f["rref"] != site_ok["rref"]
    f = rp.choose_fit(None, site_bad, 281.0, t, r)
    assert f["method"] == "pooled" and f["e0"] == 281.0 and math.isclose(f["rref"], 2.0)
    assert rp.choose_fit(own_bad, None, None, t, r)["method"] == "none"
    assert rp.choose_fit(None, site_ok, 281.0, t[:0], r[:0])["method"] == "none"


def test_normalise_pre_pulse_one_of_three() -> None:
    v = np.full(40, 2.0)
    v[7:9] = np.nan  # only day -1 has a value
    m, pre, _ = rp.normalise_events(v, [make_event(10, 5)], "diff", min_pre=1)
    assert pre[0] == 2.0 and m[0, LAG0] == 0.0
    m, pre, _ = rp.normalise_events(v, [make_event(10, 5)], "diff")
    assert np.isnan(pre[0])


def test_last_drawn_lag() -> None:
    mat = np.full((5, len(rp.LAGS)), np.nan)
    mat[:, : LAG0 + 3] = 1.0
    mat[:3, LAG0 + 6] = 1.0
    assert rp.last_drawn_lag(rp.composite(mat)) == 2
    assert rp.last_drawn_lag(rp.composite(np.full((2, len(rp.LAGS)), 1.0))) is None


def test_gpp_and_nee_are_differences_reco_is_ratio() -> None:
    assert rp.NORM_KIND == {"reco": "ratio", "nee": "diff", "gpp": "diff"}
    res = results()
    for s in rp.ALL_SITES:
        for v in rp.VARIABLES:
            sens = res["sensitivity"]["prePulseMin1"][s][v]
            assert sens["used"] >= res["summary"][s][v]["used"]
        for f in res["fits"][s].values():
            assert f["method"] in rp.FIT_METHODS
            if f["method"] != "none":
                assert f["e0Source"] == f["method"]
            if f["method"] == "own":
                assert rp.e0_valid(f["e0"], f["e0Se"])
    counts = res["fitMethodCounts"]
    assert sum(counts.values()) == sum(len(res["fits"][s]) for s in rp.ALL_SITES)


def test_day_text() -> None:
    assert rp.day_text(7, 1.012, 0.131, 11) == "day 7: 1.01 ± 0.13 (n = 11)"
    assert rp.day_text(7, 3.07, None, 1) == "day 7: 3.07 (single event, not drawn)"
    assert rp.day_text(0, 0.9, 0.2, 3) == "day 0: 0.90 ± 0.20 (n = 3, not drawn)"
    assert rp.day_text(7, None, None, 0) == "day 7: no event"
    for f in results()["figures"]:
        assert not re.search(
            r"day \d+ [−\d]", f["desc"]
        )  # no mean without a colon and SE
