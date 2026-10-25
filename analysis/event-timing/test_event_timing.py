"""Unit tests of the pure functions and the SVG text of the dive event-timing.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/event-timing/event-timing.py \
    pytest analysis/event-timing/
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has a hyphen)."""
    spec = importlib.util.spec_from_file_location(
        "event_timing", HERE / "event-timing.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["event_timing"] = mod
    spec.loader.exec_module(mod)
    return mod


et = load_module()


def results() -> dict[str, Any]:
    return json.loads((HERE / "results.json").read_text(encoding="utf-8"))


# ---------- Episodes ----------
def ev(
    d: str, etype: str = "harvest", d_end: str | None = None, site: str = "a"
) -> Any:
    return et.Event(
        site, et.day_number(d), None if d_end is None else et.day_number(d_end), etype
    )


def test_merge_gap_7_joins_8_does_not() -> None:
    eps = et.merge_episodes([ev("2022-05-01"), ev("2022-05-08", "fertilisation")])
    assert len(eps) == 1 and et.iso_day(eps[0].end) == "2022-05-08"
    eps = et.merge_episodes([ev("2022-05-01"), ev("2022-05-09", "fertilisation")])
    assert len(eps) == 2


def test_merge_date_end_extends_and_kind() -> None:
    eps = et.merge_episodes(
        [
            ev("2022-08-03", "other", "2022-08-15"),
            ev("2022-08-20", "harvest"),
            ev("2022-08-24", "fertilisation"),
        ]
    )
    assert len(eps) == 1
    ep = eps[0]
    assert ep.kind == "harvest"
    assert ep.types == ["harvest", "fertilisation", "other"]
    assert et.iso_day(ep.start) == "2022-08-03"
    assert et.iso_day(ep.anchor) == "2022-08-20"
    assert ep.id == "a-2022-08-03"


def test_merge_sites_and_non_field() -> None:
    e0 = ev("2021-05-07", "other")
    e0.field_op = False
    eps = et.merge_episodes(
        [e0, ev("2021-05-13", "sowing"), ev("2021-05-10", site="b")]
    )
    assert [e.site for e in eps] == ["a", "b"]
    assert et.iso_day(eps[0].start) == "2021-05-13"
    assert eps[0].kind == "sowing"


def test_kind_priority() -> None:
    assert et.episode_kind(["fertilisation", "tillage", "sowing"]) == "tillage"
    assert et.episode_kind(["cut", "harvest"]) == "harvest"
    assert et.episode_kind(["spraying", "other"]) == "spraying"


# ---------- Windows ----------
def table_with(var: str, values: dict[int, float]) -> Any:
    t = et.DayTable(0, 200)
    days = np.array(list(values), dtype=np.int64)
    t.set(var, days, np.array(list(values.values())))
    return t


def test_window_means_min_days() -> None:
    anchor = 100
    full = {d: 2.0 for d in range(anchor - 7, anchor)} | {
        d: 5.0 for d in range(anchor + 1, anchor + 8)
    }
    t = table_with("gpp", full)
    b = et.window_means(t, anchor, et.BEFORE, ["gpp"])
    a = et.window_means(t, anchor, et.AFTER, ["gpp"])
    assert b.n["gpp"] == 7 and a.mean["gpp"] == 5.0
    assert et.changes(a, b, ["gpp"])["gpp"] == pytest.approx(3.0)
    for missing, ok in ((2, True), (3, False)):
        part = {
            d: v for d, v in full.items() if not (anchor + 1 <= d <= anchor + missing)
        }
        t2 = table_with("gpp", part)
        d2 = et.changes(
            et.window_means(t2, anchor, et.AFTER, ["gpp"]),
            et.window_means(t2, anchor, et.BEFORE, ["gpp"]),
            ["gpp"],
        )
        assert (d2["gpp"] is not None) == ok


# ---------- Change point ----------
def test_detect_step_drop() -> None:
    vals = {d: 10.0 for d in range(80, 100)} | {d: 4.0 for d in range(100, 120)}
    t = table_with("gpp", vals)
    s = et.detect_step(t, "gpp", 90, 110, 1, anchor=98)
    assert s.detected == 100 and s.offset == 2
    assert s.step == pytest.approx(6.0)
    assert s.step_pct == pytest.approx(60.0)
    assert s.clear and s.reason is None


def test_detect_step_rise() -> None:
    vals = {d: 0.5 for d in range(80, 100)} | {d: 6.0 for d in range(100, 140)}
    t = table_with("gpp", vals)
    s = et.detect_step(t, "gpp", 90, 130, -1, anchor=90)
    assert s.detected == 100 and s.offset == 10
    assert s.level == pytest.approx(6.0)
    assert s.clear
    # A drop search on the same series finds no positive step.
    d = et.detect_step(t, "gpp", 90, 130, 1)
    assert not d.clear


def test_detect_step_rules() -> None:
    small = table_with(
        "gpp", {d: 0.8 for d in range(80, 100)} | {d: 0.1 for d in range(100, 120)}
    )
    assert et.detect_step(small, "gpp", 90, 110, 1).reason == "flux-too-small"
    flat = table_with(
        "gpp", {d: 10.0 for d in range(80, 100)} | {d: 8.0 for d in range(100, 120)}
    )
    assert et.detect_step(flat, "gpp", 90, 110, 1).reason == "step-too-small"
    few = table_with("gpp", {d: 10.0 for d in range(80, 83)})
    s = et.detect_step(few, "gpp", 90, 110, 1)
    assert s.detected is None and s.reason == "too-few-days"
    # The first day wins on a tie; skip removes candidate days.
    vals = {d: 10.0 for d in range(80, 100)} | {d: 4.0 for d in range(100, 120)}
    t = table_with("gpp", vals)
    s = et.detect_step(t, "gpp", 90, 110, 1, skip=lambda d: d == 100)
    assert s.detected != 100


# ---------- Thermal season ----------
def season_table(ta: dict[str, float], default: float) -> Any:
    first, last = et.day_number("2022-01-01"), et.day_number("2022-12-31")
    t = et.DayTable(first, last)
    days = np.arange(first, last + 1)
    vals = np.full(len(days), default)
    for d, v in ta.items():
        vals[et.day_number(d) - first] = v
    t.set("ta", days, vals)
    return t


def test_thermal_season_start_end() -> None:
    first = et.day_number("2022-01-01")
    t = et.DayTable(first, et.day_number("2022-12-31"))
    days = np.arange(first, et.day_number("2022-12-31") + 1)
    start, end = et.day_number("2022-05-02"), et.day_number("2022-10-20")
    vals = np.where((days >= start) & (days < end), 12.0, 0.0)
    # A short warm spell in April (5 days) is not a start.
    vals[
        (days >= et.day_number("2022-04-10")) & (days < et.day_number("2022-04-15"))
    ] = 8.0
    t.set("ta", days, vals)
    s = et.thermal_season(t, "ta", 2022)
    assert s["start"] == "2022-05-02"
    assert s["end"] == "2022-10-20"
    assert s["length"] == end - start


def test_thermal_season_none() -> None:
    t = season_table({}, 0.0)
    s = et.thermal_season(t, "ta", 2022)
    assert s["start"] is None and s["startReason"] == "no-run"
    assert s["end"] == "2022-08-01"
    first = et.day_number("2022-05-01")
    t2 = et.DayTable(first, et.day_number("2022-12-31"))
    days = np.arange(first, et.day_number("2022-12-31") + 1)
    t2.set("ta", days, np.full(len(days), 10.0))
    s2 = et.thermal_season(t2, "ta", 2022)
    assert s2["start"] is None and s2["startReason"] == "data-start-after-1-march"
    assert s2["end"] is None and s2["endReason"] == "no-run"


# ---------- Labels ----------
def test_label_rows() -> None:
    assert et.label_rows([(0, 10), (5, 12), (11, 20), (13, 15)]) == [0, 1, 0, 1]
    assert et.label_rows([(0, 10), (10, 12)]) == [0, 0]
    assert et.label_rows([(0, 10), (10, 12)], gap=1) == [0, 1]
    assert et.label_rows([]) == []


def test_event_label() -> None:
    a = et.Event("a", 1, None, "harvest", dry_mass_kg_ha=3360.0)
    b = et.Event("a", 1, None, "fertilisation")
    assert et.event_label([b, a]) == "H 3.4 t+F"
    assert et.event_label([et.Event("a", 1, None, "sowing")]) == "Sw"


def test_short_text() -> None:
    assert et.short_text("abc") == "abc"
    s = et.short_text("word " * 40, 20)
    assert len(s) <= 20 and s.endswith("…")


# ---------- Statistics ----------
def test_bootstrap_deterministic() -> None:
    xs = np.array([1.0, -2.0, 3.5, 0.2, 4.1])
    a = et.bootstrap_mean_ci(xs, 123)
    b = et.bootstrap_mean_ci(xs, 123)
    c = et.bootstrap_mean_ci(xs, 124)
    assert a == b
    assert a != c
    assert a is not None and a[0] < xs.mean() < a[1]
    assert et.bootstrap_mean_ci(xs[:2], 1) is None


def test_summarise() -> None:
    s = et.summarise([0, -2, 3, None, 1], 5, "t")
    assert s["n"] == 4 and s["median"] == pytest.approx(0.5)
    assert (s["nNegative"], s["nZero"], s["nPositive"]) == (1, 1, 2)
    assert s["ci"] is not None
    s2 = et.summarise([1, 2], 6, "t2")
    assert s2["ci"] is None and s2["min"] == 1 and s2["max"] == 2


def test_round_sig() -> None:
    assert et.round_sig(1.23456789012345) == 1.23456789
    assert et.round_sig({"a": float("nan"), "b": [np.float64(2.5)]}) == {
        "a": None,
        "b": [2.5],
    }


# ---------- Constants ----------
def test_docstring_inputs_equal_constant() -> None:
    assert et.__doc__ is not None
    doc = et.parse_docstring_inputs(et.__doc__)
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in et.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    assert et.__doc__ is not None
    assert f"builtAt: {et.DATABASE['builtAt']}" in et.__doc__
    assert f"calcBuiltAt: {et.DATABASE['calcBuiltAt']}" in et.__doc__
    assert f"commit: {et.DATABASE['commit']}" in et.__doc__
    assert all(
        i.built_at in (et.DATABASE["builtAt"], et.DATABASE["calcBuiltAt"])
        for i in et.INPUTS
    )


def test_alternative_dates_rows() -> None:
    for row in et.ALTERNATIVE_DATES:
        assert row["sourceOther"] in et.SOURCE_SHORT
        assert row["page"].strip()
        assert row["site"] in et.SITES
        assert row["type"] in et.KIND_PRIORITY
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", row["dateUsed"])
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", row["dateOther"])
        assert row["dateUsed"] != row["dateOther"]
    for note in et.ALT_NOTES:
        assert note["source"].strip() and note["text"].strip()


def test_literature_rows() -> None:
    keys = [r["key"] for r in et.LITERATURE]
    assert len(keys) == len(set(keys))
    for r in et.LITERATURE:
        assert r["page"] and r["ref"]
        if r["ref"] == et.BOOK:
            assert r["section"] and r["page"].startswith("s. ")
            assert r["textFi"]
        else:
            assert r["page"].startswith("PDF p. ")


# ---------- results.json ----------
def test_scalar_keys() -> None:
    m = results()["method"]
    assert (m["mergeDays"], m["minDays"], m["searchFrom"], m["searchTo"]) == (
        7,
        5,
        -10,
        5,
    )
    assert (m["sideDays"], m["minSide"], m["minBefore"], m["minStepPct"]) == (
        5,
        4,
        1,
        25,
    )
    assert (m["sowingSearchTo"], m["seasonRunDays"], m["seasonThresholdC"]) == (
        40,
        10,
        5,
    )
    assert (m["wetMonthMm"], m["utcShiftHours"], m["nSites"]) == (50, 2, 6)


def test_highlights_present() -> None:
    r = results()
    assert set(r["highlights"]) == set(et.HIGHLIGHTS)
    for h in r["highlights"].values():
        assert {"detected", "offset", "nearer", "offsetToUsed", "offsetToOther"} <= set(
            h
        )
    assert len(r["alternativeDates"]) == len(et.ALTERNATIVE_DATES)
    assert len(r["literatureByKey"]) == len(r["literature"])


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
    assert dv["dbBuiltAt"] == dv["snapshot"]["builtAt"] == et.DATABASE["builtAt"]
    assert (
        dv["calcBuiltAt"] == dv["snapshot"]["calcBuiltAt"] == et.DATABASE["calcBuiltAt"]
    )
    assert dv["snapshot"]["inputs"] == [
        {"path": i.key, "sha256": i.sha256, "rows": i.rows} for i in et.INPUTS
    ]
    assert {"commit", "dirty"} <= set(dv["git"])
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    assert {k: v for k, v in manifest.items() if k != "outputs"}.keys() == dv.keys()


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"), key=lambda p: int(p.name.split("-")[0]))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name in et.FIGURES]


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    text = path.read_text(encoding="utf-8")
    root = ET.fromstring(text)
    tid, did = f"{et.SLUG}-fig{n}-title", f"{et.SLUG}-fig{n}-desc"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = re.findall(r'\bid="([^"]+)"', text)
    assert len(ids) == len(set(ids)), "ids are not unique"
    keep = {tid, did}
    assert all(i.startswith(f"{et.SVG_ID_PREFIX}{n}-") for i in ids if i not in keep)
    refs = re.findall(r"url\(#([^)]+)\)", text) + re.findall(r'href="#([^"]+)"', text)
    assert set(refs) <= set(ids), f"dangling: {set(refs) - set(ids)}"
    # Text is text: no glyph definitions of a font.
    assert not re.search(r'id="[^"]*DejaVu', text)
    texts = root.findall(f".//{SVG_NS}text")
    assert len(texts) > 10
    for el in texts:
        style = el.get("style") or ""
        assert f"font-family: {et.FONT_STACK}" in style
        assert "font-variant-numeric: tabular-nums" in style
        assert "DejaVu" not in style
    fig = next(f for f in results()["figures"] if f["n"] == n)
    assert fig["title"] == children[0].text
    assert fig["desc"] == children[1].text
    assert path.stat().st_size < 1_000_000


def test_prefix_svg_ids() -> None:
    svg = '<svg><title id="t"/><g id="a" clip-path="url(#c)"/><clipPath id="c"/><use xlink:href="#a" href="#a"/></svg>'
    out = et.prefix_svg_ids(svg, "et9-", {"t"})
    assert 'id="t"' in out and 'id="et9-a"' in out and "url(#et9-c)" in out
    assert 'xlink:href="#et9-a"' in out and ' href="#et9-a"' in out
