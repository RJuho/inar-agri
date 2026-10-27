"""Unit tests of the pure functions, the results and the SVG text of the dive carbon-space.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/carbon-space/carbon-space.py \\
    pytest analysis/carbon-space/
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
import pandas as pd
import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DB = REPO / "db"
CALC = REPO / "data" / "calculated"
SMEAR = REPO / "data" / "smear" / "hyytiala"
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has a hyphen)."""
    spec = importlib.util.spec_from_file_location(
        "carbon_space", HERE / "carbon-space.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["carbon_space"] = mod
    spec.loader.exec_module(mod)
    return mod


cs = load_module()


def results() -> dict[str, Any]:
    return json.loads((HERE / "results.json").read_text(encoding="utf-8"))


def have_data() -> bool:
    return not cs.check_inputs(DB, CALC, SMEAR)


needs_data = pytest.mark.skipif(
    not have_data(), reason="database snapshot of INPUTS not present"
)


# ---------- Pure functions ----------
def test_exclusion_reasons() -> None:
    assert cs.exclusion_reasons(0.0, False, 130, False, 2) == ["no flux data"]
    assert cs.exclusion_reasons(0.6, False, 4, True, 2) == ["partial year"]
    assert cs.exclusion_reasons(0.19, True, 55, True, 2) == [
        "measured fraction < 0.2",
        "longest gap > 30 d",
    ]
    assert cs.exclusion_reasons(0.2, True, 30, True, 1) == []
    assert cs.exclusion_reasons(0.5, True, 5, False, 2) == []
    assert cs.exclusion_reasons(0.5, True, 5, False, 1) == ["no annual GPP or Reco sum"]


def test_reliable_rule_limits() -> None:
    assert cs.reliable_rule(0.2, 30.0)
    assert not cs.reliable_rule(0.1999, 1.0)
    assert not cs.reliable_rule(0.9, 30.01)


def test_uptake_share() -> None:
    u = cs.uptake_share([-1.0, 0.0, 2.0, None, -0.1])
    assert u == {"days": 4, "uptakeDays": 2, "share": 0.5}
    assert cs.uptake_share([None])["share"] is None


def test_sum_check() -> None:
    assert cs.sum_check(3.0, [1.0, 2.0])["ok"]
    assert not cs.sum_check(3.1, [1.0, 2.0])["ok"]
    assert cs.sum_check(None, [1.0, None])["ok"]
    assert not cs.sum_check(None, [1.0, 2.0])["ok"]
    assert not cs.sum_check(3.0, [1.0, None])["ok"]


def test_peak_window_rule() -> None:
    from datetime import date, timedelta

    days = [date(2022, 1, 1) + timedelta(days=i) for i in range(365)]
    gpp: list[float | None] = [1.0] * 365
    for i in range(100, 190):
        gpp[i] = 5.0  # the peak: days 100 to 189
    for i in range(120, 131):
        gpp[i] = None  # 11 gaps: a window that holds all of them has only 79 GPP days
    nee: list[float | None] = [1.0] * 365
    for i in range(150, 180):
        nee[i] = -1.0
    frac: list[float | None] = [0.5] * 365
    p = cs.peak_window(days, gpp, nee, frac)
    assert p is not None
    # With 80 days required, a window that holds all 11 gaps is not valid. The best window
    # starts after the gaps: index 131 (2022-05-12), 59 peak days x 5 + 31 days x 1 = 326.
    assert p["start"] == "2022-05-12" and p["end"] == "2022-08-09"
    assert p["gppDays"] == 90 and math.isclose(p["gppSum"], 59 * 5 + 31)
    # With 79 days allowed, the window over the gaps wins: index 100, 79 peak days x 5 = 395.
    p79 = cs.peak_window(days, gpp, nee, frac, min_days=79)
    assert (
        p79 is not None and p79["start"] == "2022-04-11" and p79["end"] == "2022-07-09"
    )
    assert p79["gppDays"] == 79 and math.isclose(p79["gppSum"], 79 * 5)
    assert p["days"] == 90 and p["uptakeDays"] == 30
    assert math.isclose(p["share"], 30 / 90) and math.isclose(p["fracMeasured"], 0.5)
    # Ties: a flat series gives the first window.
    flat = cs.peak_window(days, [1.0] * 365, nee, frac)
    assert flat is not None and flat["start"] == "2022-01-01"
    # No valid window: too many gaps.
    assert cs.peak_window(days, [None] * 300 + [1.0] * 65, nee, frac) is None


def test_ols() -> None:
    o = cs.ols([1.0, 2.0, 3.0], [3.0, 5.0, 7.0])
    assert math.isclose(o["slope"], 2.0) and math.isclose(o["intercept"], 1.0)
    assert math.isclose(o["r"], 1.0) and o["n"] == 3


def test_round_sig_and_nice_range() -> None:
    assert cs.round_sig(1.23456789012345) == 1.23456789
    assert cs.round_sig(float("nan")) is None
    assert cs.nice_range(612.2, 1478.7) == [400.0, 1600.0]


def test_prefix_svg_ids() -> None:
    svg = '<svg><title id="t"/><g id="a" clip-path="url(#c)"/><clipPath id="c"/><use xlink:href="#a"/></svg>'
    out = cs.prefix_svg_ids(svg, "cs9-", {"t"})
    assert 'id="t"' in out and 'id="cs9-a"' in out and "url(#cs9-c)" in out
    assert 'xlink:href="#cs9-a"' in out


# ---------- Header and constants ----------
def test_docstring_inputs_equal_constant() -> None:
    doc = cs.parse_docstring_inputs(cs.__doc__ or "")
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in cs.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    doc = cs.__doc__ or ""
    assert f"builtAt: {cs.DATABASE['builtAt']}" in doc
    assert f"calcBuiltAt: {cs.DATABASE['calcBuiltAt']}" in doc
    assert f"commit: {cs.DATABASE['commit']}" in doc


def test_crops_cover_annual_site_years() -> None:
    keys = {(r["site"], r["year"]) for r in results()["siteYears"]}
    assert keys <= set(cs.CROPS)
    for crop, group, label in cs.CROPS.values():
        assert group in cs.GROUPS
        assert crop in cs.CROP_EVENT_PATTERNS
        assert label is None or label.split(" ")[0] in crop or label in crop


def test_label_offsets_cover_figure_1() -> None:
    assert set(cs.LABEL_OFFSETS) == set(results()["fig1Keys"])
    assert all(
        ha in ("left", "right", "center") for _, _, ha in cs.LABEL_OFFSETS.values()
    )


# ---------- Against the snapshot ----------
@needs_data
def test_crops_agree_with_events() -> None:
    """Each sowing or harvest event that names a crop agrees with CROPS of its site-year."""
    ev = pd.read_parquet(
        DB / "events.parquet", columns=["site_code", "date", "type", "crop"]
    )
    ev = ev[ev["type"].isin(["sowing", "harvest"]) & ev["crop"].notna()]
    ev["year"] = [d.year for d in pd.to_datetime(ev["date"])]
    checked = 0
    for key in sorted({(str(a), int(b)) for a, b in zip(ev["site_code"], ev["year"])}):
        if key not in cs.CROPS:
            continue
        g = ev[(ev["site_code"] == key[0]) & (ev["year"] == key[1])]
        crop = cs.CROPS[key][0]
        pattern = re.compile(cs.CROP_EVENT_PATTERNS[crop], re.IGNORECASE)
        crops = [str(c) for c in g["crop"]]
        assert any(pattern.search(c) for c in crops), (key, crop, crops)
        checked += 1
    assert checked >= 15


@needs_data
def test_annual_equals_daily_sums() -> None:
    a = pd.read_csv(CALC / "annual.csv")
    d = pd.read_parquet(
        CALC / "daily.parquet",
        columns=["site_code", "date_local", "nee_f_gc", "gpp_gc", "reco_gc"],
    )
    d["year"] = pd.to_datetime(d["date_local"]).dt.year
    n = 0
    for r in a.to_dict("records"):
        g = d[(d["site_code"] == r["site_code"]) & (d["year"] == r["year"])]
        for c in ("nee_f_gc", "gpp_gc", "reco_gc"):
            ann = None if pd.isna(r[c]) else float(r[c])
            chk = cs.sum_check(ann, [None if pd.isna(x) else float(x) for x in g[c]])
            assert chk["ok"], (r["site_code"], r["year"], c)
            n += chk["relDiff"] is not None
    res = results()
    n_ref = sum(
        r[k] is not None
        for r in res["reference"]["hyytiala"]["siteYears"]
        for k in ("nee", "gpp", "reco")
    )
    assert n + n_ref == res["dataVersion"]["steps"]["sumCheck"]["comparisons"]


@needs_data
def test_inclusion_rule_from_annual_csv() -> None:
    a = pd.read_csv(CALC / "annual.csv")
    fig2 = [
        f"{r['site_code']}-{r['year']}"
        for r in a.to_dict("records")
        if r["full_year"] and r["reliable"]
    ]
    fig1 = [
        f"{r['site_code']}-{r['year']}"
        for r in a.to_dict("records")
        if r["full_year"]
        and r["reliable"]
        and pd.notna(r["gpp_gc"])
        and pd.notna(r["reco_gc"])
    ]
    res = results()
    assert sorted(res["fig2Keys"]) == sorted(fig2)
    assert sorted(res["fig1Keys"]) == sorted(fig1)


@needs_data
def test_hyytiala_sums_independent() -> None:
    """Daily and annual Hyytiala sums of the script against a plain pandas recompute."""
    tables: Any = cs.read_hyytiala(SMEAR, {})
    daily, annual = tables
    res = {r["year"]: r for r in results()["reference"]["hyytiala"]["siteYears"]}
    factor = 1800 * 12.011e-6
    for y in cs.REF_YEARS:
        f: Any = pd.read_csv(SMEAR / f"HYY_EDDY233_NEE_GPP_{y}.csv")
        m: Any = pd.read_csv(SMEAR / f"HYY_EDDYMAST_F_c_270_{y}.csv", na_values=["NaN"])
        day: Any = pd.to_datetime(f[["Year", "Month", "Day"]]).dt.date
        nee = f["HYY_EDDY233.NEE"].groupby(day).sum() * factor
        gpp = f["HYY_EDDY233.GPP"].groupby(day).sum() * factor
        meas = m["HYY_EDDYMAST.F_c_270"].notna()
        d = daily[daily["year"] == y].set_index("date_local")
        assert len(d) == len(nee)
        for k in nee.index:
            assert math.isclose(
                d.loc[k, "nee_f_gc"], nee[k], rel_tol=1e-9, abs_tol=1e-12
            )
            assert math.isclose(d.loc[k, "gpp_gc"], gpp[k], rel_tol=1e-9, abs_tol=1e-12)
            assert math.isclose(
                d.loc[k, "reco_gc"], nee[k] + gpp[k], rel_tol=1e-9, abs_tol=1e-9
            )
        frac_day = meas.groupby(day).sum() / 48
        assert np.allclose(d["frac_measured"].to_numpy(), frac_day.to_numpy())
        a = annual[annual["year"] == y].iloc[0]
        assert math.isclose(a["nee_f_gc"], nee.sum(), rel_tol=1e-9)
        assert math.isclose(a["gpp_gc"], gpp.sum(), rel_tol=1e-9)
        assert math.isclose(a["frac_measured"], meas.mean(), rel_tol=1e-12)
        run = best = 0
        for v in ~meas.to_numpy():
            run = run + 1 if v else 0
            best = max(best, run)
        assert math.isclose(a["longest_gap_days"], best / 48)
        r = res[y]
        assert math.isclose(r["nee"], nee.sum(), rel_tol=1e-8)
        assert math.isclose(r["gpp"], gpp.sum(), rel_tol=1e-8)
        assert math.isclose(r["fracMeasured"], meas.mean(), rel_tol=1e-8)


def test_hyytiala_results() -> None:
    res = results()
    ref = res["reference"]["hyytiala"]
    assert [r["year"] for r in ref["siteYears"]] == list(cs.REF_YEARS)
    for r in ref["siteYears"]:
        assert r["group"] == "forest" and r["source"] == cs.REF_SOURCE
        assert "events" not in r
        if r["inFig1"]:
            assert math.isclose(r["nee"], r["reco"] - r["gpp"], abs_tol=1e-6)
    assert res["groups"]["forest"]["nee"]["n"] == len(ref["fig4Keys"])
    assert res["regression"]["withHyytiala"]["n"] == len(res["fig1Keys"]) + len(
        ref["fig4Keys"]
    )
    assert set(cs.LABEL_OFFSETS_FOREST) <= set(ref["fig4Keys"])


# ---------- Results ----------
def test_results_consistent() -> None:
    res = results()
    rows = {r["key"]: r for r in res["siteYears"]}
    assert len(res["fig2Keys"]) == res["summary"]["nFig2"] == 16
    assert len(res["fig1Keys"]) == res["summary"]["nFig1"] == 15
    assert set(res["fig2Keys"]) - set(res["fig1Keys"]) == {"sarkisuo-2023"}
    assert rows["sarkisuo-2023"]["exclusionFig1"] == "no annual GPP or Reco sum"
    for r in rows.values():
        assert r["inFig1"] == (r["exclusionFig1"] is None)
        assert r["inFig2"] == (r["exclusionFig2"] is None)
        if r["inFig1"]:
            assert math.isclose(r["nee"], r["reco"] - r["gpp"], abs_tol=1e-6)
    assert {e["key"] for e in res["excluded"]} == set(rows) - set(res["fig1Keys"])
    for key in res["fig2Keys"]:
        p = rows[key]["uptake"]["peak"]
        if p is not None:
            assert p["gppDays"] >= cs.PEAK_MIN_GPP_DAYS
            assert p["start"][:4] == p["end"][:4] == str(rows[key]["year"])
    n = sum(res["groups"][g]["nee"]["n"] for g in cs.GROUPS)
    assert n == res["summary"]["nFig1"]


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"), key=lambda p: int(p.name.split("-")[0]))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name in cs.FIGURES]


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    root = ET.parse(path).getroot()
    tid, did = f"{cs.SLUG}-fig{n}-title", f"{cs.SLUG}-fig{n}-desc"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = [str(e.get("id")) for e in root.iter() if e.get("id")]
    assert len(ids) == len(set(ids))
    keep = {tid, did}
    assert all(i.startswith(f"{cs.SVG_ID_PREFIX}{n}-") for i in ids if i not in keep)
    fig = next(f for f in results()["figures"] if f["n"] == n)
    assert children[0].text == fig["title"]
    assert children[1].text == fig["desc"]
    texts = root.findall(f".//{SVG_NS}text")
    assert texts, "the text must stay text (svg.fonttype none)"
    for t in texts:
        style = t.get("style") or ""
        assert cs.FONT_STACK in style
        assert "font-variant-numeric: tabular-nums" in style
    assert path.stat().st_size < 1_000_000
