"""Unit tests of the pure functions, the results and the SVG text of the dive silage-harvest-response.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/silage-harvest-response/silage-harvest-response.py \\
    pytest analysis/silage-harvest-response/
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
DIVE4_JSON = REPO / "site" / "src" / "deep-dives" / "disturbance-detail.json"
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has a hyphen)."""
    spec = importlib.util.spec_from_file_location(
        "silage_harvest_response", HERE / "silage-harvest-response.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["silage_harvest_response"] = mod
    spec.loader.exec_module(mod)
    return mod


sh = load_module()


def results() -> dict[str, Any]:
    return json.loads((HERE / "results.json").read_text(encoding="utf-8"))


def close(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-9)


# ---------- Harvest groups ----------
def test_harvest_group() -> None:
    assert sh.harvest_group("cut", None, "Cleaning cut") == "cleaningCut"
    assert (
        sh.harvest_group("harvest", "Silage", "Silage, whole crop") == "silageHarvest"
    )
    assert sh.harvest_group("harvest", "Legume grass", "first cut") == "silageHarvest"
    assert sh.harvest_group("harvest", "Oats", "Threshing") == "grainHarvest"
    assert (
        sh.harvest_group("harvest", "Faba beans", "yield of the year") == "grainHarvest"
    )
    # Barley named, but cut green: a silage harvest.
    assert (
        sh.harvest_group("harvest", "Barley, clover and grasses", "first cut")
        == "silageHarvest"
    )
    assert sh.harvest_group("harvest", None, "coats") == "silageHarvest"


def test_yield_per_event() -> None:
    assert sh.yield_per_event("Timothy, first cut")
    assert not sh.yield_per_event("second cut; yield of the year 3673 kg DW/ha")
    assert sh.yield_per_event(
        "second cut, 4140 kg DW/ha; yield of the year 7500 kg DM/ha in the paper"
    )


# ---------- Episodes ----------
def ev(
    d: str,
    etype: str = "harvest",
    d_end: str | None = None,
    site: str = "a",
    crop: str | None = "Silage",
    detail: str = "Silage",
) -> Any:
    return sh.Event(
        site,
        sh.day_number(d),
        None if d_end is None else sh.day_number(d_end),
        etype,
        detail,
        crop,
    )


def test_merge_gap_7_joins_8_does_not() -> None:
    eps = sh.merge_harvest_episodes([ev("2022-06-01"), ev("2022-06-08")])
    assert len(eps) == 1 and sh.iso_day(eps[0].end) == "2022-06-08"
    eps = sh.merge_harvest_episodes([ev("2022-06-01"), ev("2022-06-09")])
    assert len(eps) == 2
    # Other types are ignored; sites are separate.
    eps = sh.merge_harvest_episodes(
        [ev("2022-06-01"), ev("2022-06-03", "grazing"), ev("2022-06-02", site="b")]
    )
    assert [(e.site, sh.iso_day(e.start)) for e in eps] == [
        ("a", "2022-06-01"),
        ("b", "2022-06-02"),
    ]


def test_merge_recorded_before_override_and_groups() -> None:
    events = [
        ev("2023-06-19", "cut", crop=None, detail="Cleaning cut"),
        ev("2023-06-20", "harvest"),
    ]
    o = {"site": "a", "date": "2023-06-20", "start": "2023-06-18", "text": "t"}
    eps = sh.merge_harvest_episodes(events, [o])
    ep = eps[0]
    assert sh.iso_day(ep.start) == "2023-06-18"
    assert sh.iso_day(ep.recorded) == "2023-06-19"
    assert ep.group == "silageHarvest"
    assert [e.type for e in ep.co_events] == ["cut"]
    assert ep.overrides == ["t"]
    assert ep.id == "a-2023-06-18"
    with pytest.raises(ValueError, match="no episode"):
        sh.merge_harvest_episodes(
            events, [{"site": "a", "date": "2023-07-01", "text": "x"}]
        )
    with pytest.raises(ValueError, match="before start"):
        sh.merge_harvest_episodes(
            events,
            [{"site": "a", "date": "2023-06-20", "end": "2023-06-10", "text": "x"}],
        )


def test_episode_group_priority() -> None:
    cut = ev("2022-06-01", "cut", crop=None, detail="cut")
    grain = ev("2022-06-01", crop="Barley", detail="Threshing")
    silage = ev("2022-06-01")
    assert sh.episode_group([cut, silage, grain]) == "grainHarvest"
    assert sh.episode_group([cut, silage]) == "silageHarvest"
    assert sh.episode_group([cut]) == "cleaningCut"


# ---------- Windows ----------
def table_with(var: str, values: dict[int, float]) -> Any:
    t = sh.DayTable(0, 300)
    days = np.array(list(values), dtype=np.int64)
    t.set(var, days, np.array(list(values.values())))
    return t


def test_window_means_12_day_rule() -> None:
    start = 100
    full = {d: 4.0 for d in range(start - 14, start)} | {
        d: 2.0 for d in range(start + 1, start + 15)
    }
    t = table_with("gpp", full)
    b = sh.window_means(t, start, sh.BEFORE, ["gpp"])
    a = sh.window_means(t, start, sh.AFTER, ["gpp"])
    assert b.n["gpp"] == 14 and a.mean["gpp"] == 2.0
    assert sh.changes(a, b, ["gpp"])["gpp"] == pytest.approx(-2.0)
    for missing, ok in ((2, True), (3, False)):
        part = {
            d: v for d, v in full.items() if not (start + 1 <= d <= start + missing)
        }
        t2 = table_with("gpp", part)
        d2 = sh.changes(
            sh.window_means(t2, start, sh.AFTER, ["gpp"]),
            sh.window_means(t2, start, sh.BEFORE, ["gpp"]),
            ["gpp"],
        )
        assert (d2["gpp"] is not None) == ok


def wm(n: dict[str, int], mean: dict[str, float | None]) -> Any:
    return sh.WindowMeans(n, mean)


def test_flux_exclusion_order() -> None:
    good = wm(
        {v: 14 for v in sh.MEAN_VARS},
        {"nee": 1.0, "gpp": 5.0, "reco": 3.0, "frac": 0.5},
    )
    few = wm({"nee": 14, "gpp": 11, "reco": 14, "frac": 14}, dict(good.mean))
    low = wm(dict(good.n), dict(good.mean) | {"frac": 0.05})
    assert sh.flux_exclusion(good, good, 0) is None
    assert sh.flux_exclusion(few, low, 1) == "overlap"
    assert sh.flux_exclusion(few, low, 0) == "too-few-days"
    assert sh.flux_exclusion(good, low, 0) == "low-measured-fraction"
    assert sh.flux_use_text("too-few-days", "", few, good).startswith(
        "excluded: fewer than 12 days"
    )
    assert sh.flux_use_text(None, "", good, good) == "used"


# ---------- Context: next disturbance ----------
def test_next_disturbance_ignores_tillage() -> None:
    h1 = ev("2022-06-01")
    h2 = ev("2022-08-01")
    eps = sh.merge_harvest_episodes([h1, h2])
    events = [
        h1,
        h2,
        ev("2022-06-20", "tillage", crop=None),
        ev("2022-07-10", "grazing", crop=None),
    ]
    ctx = sh.Context(eps, events)
    first = eps[0]
    assert ctx.next_disturbance_days(first) == sh.day_number("2022-07-10") - first.end
    ctx2 = sh.Context(eps, [h1, h2, ev("2022-06-20", "tillage", crop=None)])
    assert ctx2.next_disturbance_days(first) == sh.day_number("2022-08-01") - first.end
    assert ctx2.next_disturbance_days(eps[1]) is None
    assert ctx.cut_number(first) == 1 and ctx.cut_number(eps[1]) == 2


# ---------- Recovery ----------
def test_days_to_recover() -> None:
    end = 100
    vals = {d: 1.0 for d in range(end + 1, end + 10)} | {
        d: 5.0 for d in range(end + 10, end + 80)
    }
    t = table_with("gpp", vals)
    r = sh.days_to_recover(t, "gpp", end, 5.0)
    # Running mean of day 10 = (1, 1, 5, 5, 5) / 5 = 3.4 < 4; day 11 = (1, 5, 5, 5, 5) / 5 = 4.2.
    assert r == {"days": 11, "censored": False, "reason": "recovered"}
    assert (
        sh.days_to_recover(t, "gpp", end, 5.0, blocked_from=13)["reason"] == "blocked"
    )
    assert sh.days_to_recover(t, "gpp", end, 5.0, blocked_from=14)["days"] == 11
    assert sh.days_to_recover(t, "gpp", end, None)["reason"] == "no-reference"
    flat = table_with("gpp", {d: 1.0 for d in range(end + 1, end + 80)})
    assert sh.days_to_recover(flat, "gpp", end, 5.0)["reason"] == "max-days"
    short = table_with("gpp", {d: 1.0 for d in range(end + 1, end + 20)})
    assert sh.days_to_recover(short, "gpp", end, 5.0)["reason"] == "data-end"


# ---------- Change point ----------
def test_detect_drop() -> None:
    vals = {d: 10.0 for d in range(80, 100)} | {d: 4.0 for d in range(100, 120)}
    t = table_with("gpp", vals)
    d = sh.detect_drop(t, "gpp", 90, 110, anchor=98)
    assert d.detected == 100 and d.offset == 2
    assert d.drop == pytest.approx(6.0) and d.drop_pct == pytest.approx(60.0)
    assert d.clear and d.reason is None
    # The first day wins on a tie: two equal steps 100 and 110.
    vals2 = (
        {d: 10.0 for d in range(80, 100)}
        | {d: 7.0 for d in range(100, 110)}
        | {d: 4.0 for d in range(110, 130)}
    )
    assert sh.detect_drop(table_with("gpp", vals2), "gpp", 90, 120).detected == 100
    small = table_with(
        "gpp", {d: 0.8 for d in range(80, 100)} | {d: 0.1 for d in range(100, 120)}
    )
    assert sh.detect_drop(small, "gpp", 90, 110).reason == "flux-too-small"
    flat = table_with(
        "gpp", {d: 10.0 for d in range(80, 100)} | {d: 8.0 for d in range(100, 120)}
    )
    assert sh.detect_drop(flat, "gpp", 90, 110).reason == "drop-too-small"
    few = table_with("gpp", {d: 10.0 for d in range(80, 83)})
    d3 = sh.detect_drop(few, "gpp", 90, 110)
    assert d3.detected is None and d3.reason == "too-few-days"


def test_pre_drop() -> None:
    rec = 100
    vals = {d: 4.0 for d in range(rec - 10, rec - 3)} | {
        d: 3.0 for d in range(rec - 3, rec)
    }
    p = sh.pre_drop(table_with("gpp", vals), "gpp", rec)
    assert p["near"] == 3.0 and p["far"] == 4.0 and p["pct"] == pytest.approx(-25.0)
    low = {d: 0.5 for d in range(rec - 10, rec)}
    assert sh.pre_drop(table_with("gpp", low), "gpp", rec)["pct"] is None
    few = {d: 4.0 for d in range(rec - 7, rec)}
    assert sh.pre_drop(table_with("gpp", few), "gpp", rec)["pct"] is None


# ---------- Composite and y range ----------
def test_nice_range() -> None:
    assert sh.nice_range(-60.0, 130.0) == [-75.0, 150.0]
    assert sh.nice_range(10.0, 90.0) == [0.0, 100.0]
    assert sh.nice_range(-100.0, 225.0) == [-100.0, 225.0]


def test_y_range_skips_null() -> None:
    comp = {
        v: {"mean": [None, 50.0, 120.0], "sd": [None, 10.0, 20.0], "n": [1, 2, 2]}
        for v in sh.FLUX_VARS
    }
    assert sh.y_range([comp]) == [0.0, 150.0]


def test_composite_percent_cutoff_and_min_n() -> None:
    names = dict.fromkeys(sh.ALL_SITES, "")
    tables = {}
    t = sh.DayTable(0, 400)
    days = np.arange(0, 401)
    t.set("gpp", days, np.full(len(days), 2.0))
    t.set("reco", days, np.full(len(days), 1.0))
    t.set("nee", days, np.full(len(days), -1.0))
    tables["anttila"] = t
    data = sh.Data(names, {}, {}, {}, [], tables, {}, {})

    def episode(start: int, nxt: int | None, ref: float) -> dict[str, Any]:
        return {
            "id": f"anttila-{start}",
            "site": "anttila",
            "start": sh.iso_day(start),
            "end": sh.iso_day(start),
            "recovery": {"nextDisturbanceDays": nxt},
            "before": {"mean": {"gpp": ref}},
        }

    c = sh.composite(data, [episode(100, 10, 4.0), episode(200, None, 4.0)], "t")
    i0 = c["gpp"]["n"].index(2)
    assert c["gpp"]["mean"][i0] == pytest.approx(50.0)
    assert c["reco"]["mean"][i0] == pytest.approx(25.0)
    assert c["nee"]["mean"][i0] == pytest.approx(-25.0)
    # The first episode stops at day end + 10: offsets 10 .. 28 have n = 1 and null mean.
    offs = list(range(sh.COMPOSITE[0], sh.COMPOSITE[1] + 1))
    assert c["gpp"]["n"][offs.index(9)] == 2 and c["gpp"]["n"][offs.index(10)] == 1
    assert (
        c["gpp"]["mean"][offs.index(10)] is None
        and c["gpp"]["sd"][offs.index(10)] is None
    )
    # A reference below 0.5 gives no value.
    c2 = sh.composite(data, [episode(100, None, 0.4), episode(200, None, 4.0)], "t")
    assert max(c2["gpp"]["n"]) == 1


# ---------- Statistics ----------
def test_bootstrap_deterministic() -> None:
    xs = np.array([1.0, -2.0, 3.5, 0.2, 4.1])
    a = sh.bootstrap_mean_ci(xs, 123)
    b = sh.bootstrap_mean_ci(xs, 123)
    c = sh.bootstrap_mean_ci(xs, 124)
    assert a == b
    assert a != c
    assert a is not None and a[0] < xs.mean() < a[1]
    assert sh.bootstrap_mean_ci(xs[:2], 1) is None


def test_summarise() -> None:
    s = sh.summarise([0, -2, 3, None, 1], 5, "t")
    assert s["n"] == 4 and s["median"] == pytest.approx(0.5)
    assert (s["nNegative"], s["nZero"], s["nPositive"]) == (1, 1, 2)
    assert s["ci"] is not None
    s2 = sh.summarise([1, 2], 6, "t2")
    assert s2["ci"] is None and s2["min"] == 1 and s2["max"] == 2


def test_round_sig() -> None:
    assert sh.round_sig(1.23456789012345) == 1.23456789
    assert sh.round_sig({"a": float("nan"), "b": [np.float64(2.5)]}) == {
        "a": None,
        "b": [2.5],
    }


# ---------- Constants ----------
def test_docstring_inputs_equal_constant() -> None:
    assert sh.__doc__ is not None
    doc = sh.parse_docstring_inputs(sh.__doc__)
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in sh.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    assert sh.__doc__ is not None
    assert f"builtAt: {sh.DATABASE['builtAt']}" in sh.__doc__
    assert f"calcBuiltAt: {sh.DATABASE['calcBuiltAt']}" in sh.__doc__
    assert f"commit: {sh.DATABASE['commit']}" in sh.__doc__
    assert all(
        i.built_at in (sh.DATABASE["builtAt"], sh.DATABASE["calcBuiltAt"])
        for i in sh.INPUTS
    )


def test_literature_rows() -> None:
    keys = [r["key"] for r in sh.LITERATURE]
    assert len(keys) == len(set(keys))
    for r in sh.LITERATURE:
        assert r["page"] and r["ref"]
        if r["ref"] == sh.BOOK:
            assert r["section"] and r["page"].startswith("s. ")
            assert r["textFi"]
        else:
            assert r["page"].startswith("PDF p. ")


def test_overrides_verbatim() -> None:
    assert len(sh.OVERRIDES) == 5
    assert [o["site"] for o in sh.OVERRIDES] == [
        "haltiala",
        "haltiala",
        "qvidja",
        "qvidja",
        "viikki",
    ]
    for o in sh.OVERRIDES:
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", o["date"]) and o["text"]


# ---------- results.json ----------
def test_counts_25_20() -> None:
    r = results()
    c = r["counts"]
    assert c["silageEpisodes"] == 25 and c["used"] == 20 and len(r["episodes"]) == 25
    assert c["excluded"] == {
        "overlap": 0,
        "too-few-days": 2,
        "low-measured-fraction": 3,
    }
    assert {s: v["used"] for s, v in c["perSite"].items()} == {
        "anttila": 4,
        "sarkisuo": 3,
        "qvidja": 10,
        "viikki": 3,
    }
    excluded = sorted(e["id"] for e in r["episodes"] if not e["used"])
    assert excluded == [
        "anttila-2021-08-02",
        "qvidja-2020-06-23",
        "sarkisuo-2023-06-29",
        "viikki-2022-08-27",
        "viikki-2024-07-31",
    ]
    assert r["composite"]["all"]["episodes"] == 20
    assert r["summary"]["all"]["n"] == 20
    assert r["method"]["overrides"] == list(sh.OVERRIDES)


def test_episode_notes_exist() -> None:
    ids = {e["id"] for e in results()["episodes"]}
    for k, v in sh.EPISODE_NOTES.items():
        assert k in ids
        assert v["note"]
    flagged = {e["id"] for e in results()["episodes"] if e["flags"]["note"]}
    assert flagged == set(sh.EPISODE_NOTES)


def test_scalar_keys() -> None:
    m = results()["method"]
    assert (m["mergeDays"], m["minDays"], m["minGppBefore"], m["minFracPct"]) == (
        7,
        12,
        0.5,
        10,
    )
    assert (m["searchFrom"], m["searchTo"], m["sideDays"], m["minSideGpp"]) == (
        -10,
        5,
        5,
        4,
    )
    assert (m["recoverySharePct"], m["recoveryMaxDays"], m["compositeTo"]) == (
        80,
        60,
        28,
    )
    assert m["axisNames"]["x"] == sh.X_LABEL and m["axisNames"]["y"] == sh.Y_LABEL


@pytest.mark.skipif(not DIVE4_JSON.is_file(), reason="Deep Dive #4 JSON is absent")
def test_results_equal_deep_dive_4() -> None:
    r = results()
    d4 = json.loads(DIVE4_JSON.read_text(encoding="utf-8"))
    old = {e["id"]: e for e in d4["harvestEpisodes"] if e["group"] == "silageHarvest"}
    assert set(old) == {e["id"] for e in r["episodes"]}
    for e in r["episodes"]:
        o = old[e["id"]]
        assert (e["start"], e["end"], e["recorded"]) == (
            o["start"],
            o["end"],
            o["recorded"],
        )
        assert e["used"] == o["fluxUsed"] and e["exclusion"] == o["fluxExclusion"]
        assert e["fluxUse"] == o["fluxUse"]
        assert e["overrides"] == o["override"]
        assert e["recovery"]["reason"] == o["recovery"]["reason"]
        assert e["recovery"]["days"] == o["recovery"]["days"]
        assert (
            e["recovery"]["nextDisturbanceDays"] == o["recovery"]["nextDisturbanceDays"]
        )
        assert close(e["recovery"]["sharePct"], o["recovery"]["sharePct"])
        assert e["timing"]["used"] == o["timing"]["used"]
        assert e["timing"]["gpp"]["offset"] == o["timing"]["gpp"]["offset"]
        assert e["timing"]["gpp"]["clear"] == o["timing"]["gpp"]["clear"]
        assert e["timing"]["gpp"]["reason"] == o["timing"]["gpp"]["reason"]
        assert close(e["timing"]["preDrop"]["pct"], o["timing"]["preDrop"]["pct"])
        for v in ("gpp", "reco", "nee"):
            assert close(e["delta"][v], o["delta"][v]), (e["id"], v)
            for w in ("before", "after"):
                assert e[w]["nDays"][v] == o[w]["nDays"][v]
                assert close(e[w]["mean"][v], o[w]["mean"][v])
        # relPct of Reco is in percent of the GPP before here (Deep Dive #4: of the Reco before).
        for v in ("gpp", "nee"):
            assert close(e["relPct"][v], o["relPct"][v]), (e["id"], v)
    # GPP composite of the used episodes.
    g = d4["composite"]["groups"]["silageHarvest"]["gppSharePct"]
    offs4 = d4["composite"]["offsets"]
    c = r["composite"]["all"]["gpp"]
    for i, off in enumerate(r["composite"]["offsets"]):
        j = offs4.index(off)
        assert c["n"][i] == g["n"][j]
        assert close(c["mean"][i], g["mean"][j]) and close(c["sd"][i], g["sd"][j])
    # Group means of Deep Dive #4 (bootstrap CIs differ by the generator).
    g4 = d4["groups"]["silageHarvest"]
    a = r["summary"]["all"]
    assert close(a["deltaGpp"]["mean"], g4["gpp"]["delta"]["mean"])
    assert close(a["relGpp"]["mean"], g4["gpp"]["relPct"]["mean"])
    assert close(a["recoveryShare"]["mean"], g4["recoveryShare"]["mean"])
    assert close(a["daysToRecover"]["mean"], g4["daysToRecover"]["mean"])


def test_data_version_keys() -> None:
    dv = results()["dataVersion"]
    assert {
        "generatedAt",
        "git",
        "dbBuiltAt",
        "calcBuiltAt",
        "snapshot",
        "seeds",
        "steps",
        "inputs",
    } <= set(dv)
    assert dv["dbBuiltAt"] == dv["snapshot"]["builtAt"] == sh.DATABASE["builtAt"]
    assert (
        dv["calcBuiltAt"] == dv["snapshot"]["calcBuiltAt"] == sh.DATABASE["calcBuiltAt"]
    )
    assert dv["snapshot"]["inputs"] == [
        {"path": i.key, "sha256": i.sha256, "rows": i.rows} for i in sh.INPUTS
    ]
    assert {"commit", "dirty"} <= set(dv["git"])
    assert len(dv["seeds"]) == len(sh.SUMMARY_QUANTITIES) * (len(sh.SITES) + 1)
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    assert {k: v for k, v in manifest.items() if k != "outputs"}.keys() == dv.keys()


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"), key=lambda p: int(p.name.split("-")[0]))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name in sh.FIGURES]


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    text = path.read_text(encoding="utf-8")
    root = ET.fromstring(text)
    tid, did = f"{sh.SLUG}-fig{n}-title", f"{sh.SLUG}-fig{n}-desc"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = re.findall(r'\bid="([^"]+)"', text)
    assert len(ids) == len(set(ids)), "ids are not unique"
    keep = {tid, did}
    assert all(i.startswith(f"{sh.SVG_ID_PREFIX}{n}-") for i in ids if i not in keep)
    refs = re.findall(r"url\(#([^)]+)\)", text) + re.findall(r'href="#([^"]+)"', text)
    assert set(refs) <= set(ids), f"dangling: {set(refs) - set(ids)}"
    # Text is text: no glyph definitions of a font.
    assert not re.search(r'id="[^"]*DejaVu', text)
    texts = root.findall(f".//{SVG_NS}text")
    assert len(texts) > 10
    for el in texts:
        style = el.get("style") or ""
        assert f"font-family: {sh.FONT_STACK}" in style
        assert "font-variant-numeric: tabular-nums" in style
        assert "DejaVu" not in style
    # The three colours of the curves are in the file.
    for c in sh.COLORS.values():
        assert c.lower() in text.lower()
    fig = next(f for f in results()["figures"] if f["n"] == n)
    assert fig["title"] == children[0].text
    assert fig["desc"] == children[1].text
    assert str(int(results()["composite"]["yRange"][1])) in fig["desc"]
    assert path.stat().st_size < 1_000_000


def test_prefix_svg_ids() -> None:
    svg = '<svg><title id="t"/><g id="a" clip-path="url(#c)"/><clipPath id="c"/><use xlink:href="#a" href="#a"/></svg>'
    out = sh.prefix_svg_ids(svg, "sh9-", {"t"})
    assert 'id="t"' in out and 'id="sh9-a"' in out and "url(#sh9-c)" in out
    assert 'xlink:href="#sh9-a"' in out and ' href="#sh9-a"' in out
