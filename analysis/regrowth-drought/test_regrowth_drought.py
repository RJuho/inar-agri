"""Unit tests of the pure functions, the results and the SVG text of the dive regrowth-drought.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/regrowth-drought/regrowth-drought.py \\
    pytest analysis/regrowth-drought/
"""

from __future__ import annotations

import importlib.util
import itertools
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np
import pandas as pd
import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DIVE7_JSON = REPO / "analysis" / "silage-harvest-response" / "results.json"
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has a hyphen)."""
    spec = importlib.util.spec_from_file_location(
        "regrowth_drought", HERE / "regrowth-drought.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["regrowth_drought"] = mod
    spec.loader.exec_module(mod)
    return mod


rd = load_module()


def results() -> dict[str, Any]:
    return json.loads((HERE / "results.json").read_text(encoding="utf-8"))


def close(a: float | None, b: float | None, rel: float = 1e-6) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=rel, abs_tol=1e-9)


# ---------- Harvest groups and episodes (as Deep Dive #7) ----------
def test_harvest_group() -> None:
    assert rd.harvest_group("cut", None, "Cleaning cut") == "cleaningCut"
    assert (
        rd.harvest_group("harvest", "Silage", "Silage, whole crop") == "silageHarvest"
    )
    assert rd.harvest_group("harvest", "Oats", "Threshing") == "grainHarvest"
    assert (
        rd.harvest_group("harvest", "Barley, clover and grasses", "first cut")
        == "silageHarvest"
    )


def ev(
    d: str,
    etype: str = "harvest",
    d_end: str | None = None,
    site: str = "a",
    crop: str | None = "Silage",
    detail: str = "Silage",
) -> Any:
    return rd.Event(
        site,
        rd.day_number(d),
        None if d_end is None else rd.day_number(d_end),
        etype,
        detail,
        crop,
    )


def test_merge_gap_7_joins_8_does_not() -> None:
    eps = rd.merge_harvest_episodes([ev("2022-06-01"), ev("2022-06-08")])
    assert len(eps) == 1 and rd.iso_day(eps[0].end) == "2022-06-08"
    eps = rd.merge_harvest_episodes([ev("2022-06-01"), ev("2022-06-09")])
    assert len(eps) == 2


def test_merge_override_and_cut_number() -> None:
    events = [
        ev("2023-06-19", "cut", crop=None, detail="Cleaning cut"),
        ev("2023-06-20", "harvest"),
        ev("2023-08-21", "harvest"),
    ]
    o = {"site": "a", "date": "2023-06-20", "start": "2023-06-18", "text": "t"}
    eps = rd.merge_harvest_episodes(events, [o])
    assert rd.iso_day(eps[0].start) == "2023-06-18"
    assert rd.iso_day(eps[0].recorded) == "2023-06-19"
    assert eps[0].group == "silageHarvest" and eps[0].overrides == ["t"]
    ctx = rd.Context(eps, events)
    assert ctx.cut_number(eps[0]) == 1 and ctx.cut_number(eps[1]) == 2
    assert ctx.next_disturbance_days(eps[0]) == rd.day_number("2023-08-21") - eps[0].end
    with pytest.raises(ValueError, match="no episode"):
        rd.merge_harvest_episodes(
            events, [{"site": "a", "date": "2023-07-01", "text": "x"}]
        )


def test_overrides_verbatim() -> None:
    assert len(rd.OVERRIDES) == 5
    for o in rd.OVERRIDES:
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", o["date"]) and o["text"]


# ---------- Windows ----------
def table_with(values: dict[str, dict[int, float]]) -> Any:
    t = rd.DayTable(0, 300)
    for var, vals in values.items():
        days = np.array(list(vals), dtype=np.int64)
        t.set(var, days, np.array(list(vals.values())))
    return t


def test_window_means_and_flux_exclusion() -> None:
    start = 100
    full = {d: 4.0 for d in range(start - 14, start)} | {
        d: 2.0 for d in range(start + 1, start + 15)
    }
    t = table_with({"gpp": full})
    b = rd.window_means(t, start, rd.BEFORE, ["gpp"])
    a = rd.window_means(t, start, rd.AFTER, ["gpp"])
    assert b.n["gpp"] == 14 and a.mean["gpp"] == 2.0
    good = rd.WindowMeans(
        {v: 14 for v in rd.MEAN_VARS},
        {"nee": 1.0, "gpp": 5.0, "reco": 3.0, "frac": 0.5},
    )
    few = rd.WindowMeans(
        {"nee": 14, "gpp": 11, "reco": 14, "frac": 14}, dict(good.mean)
    )
    low = rd.WindowMeans(dict(good.n), dict(good.mean) | {"frac": 0.05})
    assert rd.flux_exclusion(good, good, 0) is None
    assert rd.flux_exclusion(few, low, 1) == "overlap"
    assert rd.flux_exclusion(few, low, 0) == "too-few-days"
    assert rd.flux_exclusion(good, low, 0) == "low-measured-fraction"


def test_rel_window_identity_and_min_days() -> None:
    end = 100
    gpp = {d: 2.0 + 0.1 * (d % 5) for d in range(end + 1, end + 15)}
    par = {d: 40.0 - (d % 3) for d in range(end + 1, end + 15)}
    lue = {d: gpp[d] / par[d] for d in gpp}
    t = table_with({"gpp": gpp, "par": par, "lue": lue})
    ref = {"gpp": 4.0, "par": 50.0, "lue": 4.0 / 50.0}
    w = rd.rel_window(t, end, rd.AFTER, ref)
    assert w["nDays"] == 14
    assert w["relGpp"] == pytest.approx(np.mean([gpp[d] / 4.0 for d in gpp]))
    assert w["relPar"] == pytest.approx(np.mean([par[d] / 50.0 for d in par]))
    assert w["relLue"] == pytest.approx(np.mean([lue[d] / ref["lue"] for d in lue]))
    # A mean of products is not the product of the means.
    assert w["relLueTimesRelPar"] == pytest.approx(w["relLue"] * w["relPar"])
    # 11 days: null means.
    part = {d: v for d, v in lue.items() if d <= end + 11}
    t2 = table_with({"gpp": gpp, "par": par, "lue": part})
    w2 = rd.rel_window(t2, end, rd.AFTER, ref)
    assert w2["nDays"] == 11 and w2["relLue"] is None and w2["relGpp"] is None


# ---------- Daily PAR, k, LUE ----------
def test_daily_from_half_hours_rule() -> None:
    rows = []
    for hh in range(48):
        rows.append({"site": "a", "day": 1, "ppfd": 1000.0 if hh < 44 else np.nan})
    for hh in range(48):
        rows.append({"site": "a", "day": 2, "ppfd": 500.0 if hh < 39 else np.nan})
    obs = pd.DataFrame(rows)
    d = rd.daily_from_half_hours(obs, "ppfd", factor=rd.DAY_FACTOR)
    assert list(d["n"]) == [44, 39]
    # 1000 umol m-2 s-1 over a day = 86.4 mol m-2 d-1.
    assert d["value"].iloc[0] == pytest.approx(86.4)
    assert np.isnan(d["value"].iloc[1])
    assert rd.DAY_FACTOR == pytest.approx(0.0864)


def test_k_ratio_and_lue_days() -> None:
    par = np.array([10.0, 20.0, 4.0, np.nan, 30.0])
    sw = np.array([5.0, 10.0, 2.0, 4.0, 10.0])
    k = rd.k_ratio(par, sw)
    # The day with PAR 4 (< 5) and the day without PAR are out: ratios 2, 2, 3.
    assert k["nDays"] == 3 and k["median"] == 2.0 and k["max"] == 3.0
    lue, dark = rd.lue_days(
        np.array([1.0, 2.0, 3.0, np.nan]), np.array([10.0, 4.0, np.nan, 5.0])
    )
    assert dark == 1
    assert lue[0] == pytest.approx(0.1) and np.isnan(lue[1]) and np.isnan(lue[2])


def test_local_days_utc_and_offset() -> None:
    ts = pd.Series(pd.to_datetime(["2022-06-01 21:30", "2022-06-01 22:00"]))
    off = pd.Series([120, 120])
    days = rd.local_days(ts, off)
    # 21:30 UTC + 2 h = 23:30 local, 1 June; 22:00 UTC = 00:00 local, 2 June.
    assert list(days) == [rd.day_number("2022-06-01"), rd.day_number("2022-06-02")]
    with pytest.raises(rd.InputError):
        rd.local_days(ts.dt.tz_localize("Europe/Helsinki"), off)


def test_swc_anomaly_same_calendar_dates() -> None:
    t = rd.DayTable(rd.day_number("2020-01-01"), rd.day_number("2023-12-31"))
    for y, v in ((2021, 0.2), (2022, 0.3), (2023, 0.4)):
        lo = rd.day_number(f"{y}-06-15")
        t.set("swc", np.arange(lo, lo + 15), np.full(15, v))
    a = rd.swc_anomaly(t, rd.day_number("2023-06-15"), [2021, 2022, 2023])
    assert a["nDays"] == 15 and a["nYears"] == 3
    assert a["mean"] == pytest.approx(0.4)
    assert a["climatology"] == pytest.approx(0.3)
    assert a["anomaly"] == pytest.approx(0.1)


# ---------- Statistics ----------
def test_exact_permutation_p() -> None:
    dry = np.array([5.0, 6.0, 7.0])
    normal = np.array([1.0, 2.0, 3.0, 4.0])
    p, splits, obs = rd.exact_permutation_p(dry, normal)
    assert splits == math.comb(7, 3) == 35 and obs == pytest.approx(3.5)
    # Only the most extreme split on each side reaches |3.5|: 2 of 35.
    assert p == pytest.approx(2 / 35)
    # Check against a plain enumeration.
    pooled = np.concatenate([dry, normal])
    count = sum(
        1
        for idx in itertools.combinations(range(7), 3)
        if abs(pooled[list(idx)].mean() - np.delete(pooled, list(idx)).mean())
        >= abs(obs) - 1e-12
    )
    assert p == pytest.approx(count / 35)
    assert rd.exact_permutation_p(np.array([1.0]), normal) == (None, 0, None)


def test_bootstrap_deterministic() -> None:
    xs = np.array([1.0, -2.0, 3.5, 0.2, 4.1])
    a = rd.bootstrap_mean_ci(xs, 123)
    assert a == rd.bootstrap_mean_ci(xs, 123) and a != rd.bootstrap_mean_ci(xs, 124)
    assert a is not None and a[0] < xs.mean() < a[1]
    assert rd.bootstrap_mean_ci(xs[:2], 1) is None
    d = rd.bootstrap_diff_ci(xs, xs + 1, 5)
    assert d is not None and d[0] < -1 < d[1]
    assert rd.bootstrap_diff_ci(xs[:2], xs, 5) is None


def test_compare_groups_single() -> None:
    g = rd.compare_groups([2.0], [1.0, 1.5, 0.5], 7, "t")
    assert g["permutationP"] is None and g["ci"] is None
    assert g["single"]["value"] == 2.0 and g["single"]["aboveNormalMax"]
    assert g["single"]["sdUnits"] == pytest.approx(2.0)
    g2 = rd.compare_groups([2.0, 3.0, 4.0], [1.0, 1.5, 0.5], 8, "t2")
    # Observed difference 2; the observed split and its mirror reach |2|: 2 of 20.
    assert g2["nSplits"] == 20 and g2["permutationP"] == pytest.approx(2 / 20)


def test_round_sig_and_nice_range() -> None:
    assert rd.round_sig(1.23456789012345) == 1.23456789
    assert rd.round_sig(
        {"a": float("nan"), "b": [np.float64(2.5)], "c": np.bool_(True)}
    ) == {
        "a": None,
        "b": [2.5],
        "c": True,
    }
    assert rd.nice_range(-0.6, 1.3) == [-0.75, 1.5]
    assert rd.nice_range(0.1, 0.9) == [0.0, 1.0]


# ---------- Constants ----------
def test_docstring_inputs_equal_constant() -> None:
    assert rd.__doc__ is not None
    doc = rd.parse_docstring_inputs(rd.__doc__)
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in rd.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    assert rd.__doc__ is not None
    assert f"builtAt: {rd.DATABASE['builtAt']}" in rd.__doc__
    assert f"calcBuiltAt: {rd.DATABASE['calcBuiltAt']}" in rd.__doc__
    for i in rd.INPUTS:
        if i.is_parquet:
            assert i.built_at in (rd.DATABASE["builtAt"], rd.DATABASE["calcBuiltAt"])
        else:
            assert i.built_at is None


def test_station_map() -> None:
    assert rd.STATION_OF_SITE == {
        "anttila": "Kuopio Maaninka",
        "sarkisuo": "Kuopio Maaninka",
        "qvidja": "Kaarina Yltöinen",
        "viikki": "Vantaa",
    }
    assert set(rd.STATION_OF_SITE) == set(rd.SITES)
    assert rd.SPI_DRY == -1.5 and rd.SPI_DRY_OTHER_DIVE == -1.0


def test_literature_rows() -> None:
    keys = [r["key"] for r in rd.LITERATURE]
    assert len(keys) == len(set(keys)) == 7
    for r in rd.LITERATURE:
        assert r["page"] and r["ref"]
        if r["ref"] == rd.BOOK:
            assert r["section"] and r["page"].startswith("s. ") and r["textFi"]
        else:
            assert r["page"].startswith("PDF p. ")


# ---------- results.json ----------
def test_counts() -> None:
    r = results()
    c = r["counts"]
    assert c["silageEpisodes"] == 25 and c["usedFlux"] == 20 and c["used"] == 19
    assert c["excluded"] == {
        "overlap": 0,
        "too-few-days": 2,
        "low-measured-fraction": 3,
        "too-few-par-days": 1,
    }
    assert c["flagged"] == 2 and c["inGroups"] == 17
    assert c["perCutGroup"]["first"]["dry"] == 3
    assert c["perCutGroup"]["first"]["normal"] == 7
    assert c["perCutGroup"]["later"]["dry"] == 1
    assert c["perCutGroup"]["later"]["normal"] == 6
    g = r["groups"]
    assert g["first"]["ids"]["dry"] == [
        "qvidja-2019-06-11",
        "qvidja-2022-06-21",
        "qvidja-2023-06-19",
    ]
    assert g["later"]["ids"]["dry"] == ["qvidja-2020-08-28"]
    flagged = sorted(e["id"] for e in r["episodes"] if e["flagged"])
    assert flagged == ["viikki-2023-08-17", "viikki-2024-06-14"]
    assert all(not e["inGroup"] for e in r["episodes"] if e["flagged"])
    assert r["method"]["spiDryOtherDive"] == -1
    assert r["summary"]["extra"]["june2018"]["dry"] is False
    assert r["summary"]["extra"]["june2018"]["dryMinus1"] is True


def test_spi3_groups() -> None:
    """The SPI-3 grouping: two dry first cuts, no dry later cut, the same key shape as the
    main groups, and the sensitivity block unchanged."""
    r = results()
    g = r["groups"]["spi3"]
    assert g["first"]["n"] == {"dry": 2, "normal": 8}
    assert g["first"]["ids"]["dry"] == ["qvidja-2019-06-11", "qvidja-2023-06-19"]
    assert g["later"]["n"]["dry"] == 0 and g["later"]["ids"]["dry"] == []
    assert g["later"]["n"]["normal"] == 7
    s = r["sensitivity"]["dryness"]["drySpi3"]
    assert s["first"]["ids"] == g["first"]["ids"] and s["later"]["n"] == g["later"]["n"]
    assert "spi3" in r["composite"] and list(r["composite"]["spi3"]) == ["first"]
    assert r["composite"]["yRangeShared"] == (
        r["composite"]["yRangeSpi3"] == r["composite"]["yRange"]
    )

    def shape(x: Any) -> Any:
        if isinstance(x, dict):
            return {k: shape(v) for k, v in x.items()}
        return None

    main = r["groups"]["first"]
    for cut in rd.CUT_GROUPS:
        assert shape(g[cut]) == shape(main)
        for w in rd.WINDOWS:
            for q in rd.QUANTITIES:
                b = g[cut][w][q]
                assert b["dry"]["ci"] is None and b["diff"]["ci"] is None
                if cut == "first":
                    assert b["dry"]["n"] == 2 and b["normal"]["ci"] is not None
                    assert b["diff"]["nSplits"] == math.comb(
                        b["dry"]["n"] + b["normal"]["n"], 2
                    )
                    assert close(
                        b["diff"]["diff"], b["dry"]["mean"] - b["normal"]["mean"]
                    )
                    assert close(s["first"][w][q]["dry"]["mean"], b["dry"]["mean"])
                else:
                    assert b["dry"]["n"] == 0 and b["diff"]["permutationP"] is None
    assert r["summary"]["spi3"]["first"]["after"]["dryN"] == 2


@pytest.mark.skipif(not DIVE7_JSON.is_file(), reason="Deep Dive #7 JSON is absent")
def test_used_episodes_equal_deep_dive_7() -> None:
    r = results()
    d7 = json.loads(DIVE7_JSON.read_text(encoding="utf-8"))
    used7 = {e["id"]: e for e in d7["episodes"] if e["used"]}
    used = {e["id"]: e for e in r["episodes"] if e["usedFlux"]}
    assert set(used) == set(used7) and len(used) == 20
    for i, e in used.items():
        o = used7[i]
        assert (e["start"], e["end"], e["recorded"], e["cutNo"]) == (
            o["start"],
            o["end"],
            o["recorded"],
            o["cutNo"],
        )
        assert e["flags"] == o["flags"] and e["fertInWindow"] == o["fertInWindow"]
        assert e["nextDisturbanceDays"] == o["recovery"]["nextDisturbanceDays"]
        assert close(e["fluxBefore"]["mean"]["gpp"], o["before"]["mean"]["gpp"])
    assert {e["id"] for e in r["episodes"]} == {e["id"] for e in d7["episodes"]}


def test_per_day_identity() -> None:
    """relGPP_d = relLUE_d x relPAR_d on each day of each episode with a reference."""
    n = 0
    for e in results()["episodes"]:
        for d in e["days"]:
            if d["relLue"] is None:
                assert d["relGpp"] is None and d["relPar"] is None
                continue
            assert close(d["relGpp"], d["relLue"] * d["relPar"], rel=1e-8), e["id"]
            n += 1
    assert n > 500


def test_reference_lue_is_ratio_of_means() -> None:
    for e in results()["episodes"]:
        b = e["before"]
        if b["lue"] is None:
            continue
        assert close(b["lue"], b["gpp"] / b["par"])


def test_sensitivity_k_does_not_change_relative_values() -> None:
    r = results()
    main = r["groups"]["first"]["after"]["relLue"]["normal"]["mean"]
    for v in r["sensitivity"]["k"]["variants"].values():
        assert close(
            v["perCutGroup"]["first"]["after"]["relLue"]["normal"]["mean"], main
        )


def test_data_version_keys() -> None:
    dv = results()["dataVersion"]
    assert {
        "generatedAt",
        "git",
        "script",
        "lock",
        "python",
        "platform",
        "packages",
        "seeds",
        "args",
        "dbBuiltAt",
        "calcBuiltAt",
        "snapshot",
        "inputs",
        "steps",
    } <= set(dv)
    assert dv["dbBuiltAt"] == dv["snapshot"]["builtAt"] == rd.DATABASE["builtAt"]
    assert dv["snapshot"]["inputs"] == [
        {"path": i.key, "sha256": i.sha256, "rows": i.rows} for i in rd.INPUTS
    ]
    assert dv["args"]["spi"]
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    assert {k: v for k, v in manifest.items() if k != "outputs"}.keys() == dv.keys()


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"), key=lambda p: int(p.name.split("-")[0]))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name in rd.FIGURES]


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    text = path.read_text(encoding="utf-8")
    root = ET.fromstring(text)
    tid, did = f"{rd.SLUG}-fig{n}-title", f"{rd.SLUG}-fig{n}-desc"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = re.findall(r'\bid="([^"]+)"', text)
    assert len(ids) == len(set(ids)), "ids are not unique"
    keep = {tid, did}
    assert all(i.startswith(f"{rd.SVG_ID_PREFIX}{n}-") for i in ids if i not in keep)
    refs = re.findall(r"url\(#([^)]+)\)", text) + re.findall(r'href="#([^"]+)"', text)
    assert set(refs) <= set(ids), f"dangling: {set(refs) - set(ids)}"
    assert not re.search(r'id="[^"]*DejaVu', text)
    texts = root.findall(f".//{SVG_NS}text")
    assert len(texts) > 10
    for el in texts:
        style = el.get("style") or ""
        assert f"font-family: {rd.FONT_STACK}" in style
        assert "font-variant-numeric: tabular-nums" in style
        assert "DejaVu" not in style
    for c in (rd.GROUP_STYLE["dry"]["color"], rd.GROUP_STYLE["normal"]["color"]):
        if n in (1, 2, 4):
            assert c.lower() in text.lower()
    fig = next(f for f in results()["figures"] if f["n"] == n)
    assert fig["title"] == children[0].text
    assert fig["desc"] == children[1].text
    assert path.stat().st_size < 1_000_000


def test_prefix_svg_ids() -> None:
    svg = '<svg><title id="t"/><g id="a" clip-path="url(#c)"/><clipPath id="c"/><use xlink:href="#a" href="#a"/></svg>'
    out = rd.prefix_svg_ids(svg, "rd9-", {"t"})
    assert 'id="t"' in out and 'id="rd9-a"' in out and "url(#rd9-c)" in out
