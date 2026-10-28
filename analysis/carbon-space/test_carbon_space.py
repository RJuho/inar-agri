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


def test_round_sig() -> None:
    assert cs.round_sig(1.23456789012345) == 1.23456789
    assert cs.round_sig(float("nan")) is None


def test_axis_constants() -> None:
    assert cs.AXIS_LO_1 < cs.AXIS_HI_1
    assert cs.AXIS_LO_1 % cs.AXIS_TICK_1 == 0 and cs.AXIS_HI_1 % cs.AXIS_TICK_1 == 0
    assert cs.Y_LABEL_2.startswith("Percentage")
    assert cs.Y_AXIS_TEXT_2.startswith("percentage")


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
    # Figure 4 offsets: the Hyytiala labels and the overrides of the site labels
    assert set(cs.LABEL_OFFSETS_FOREST) <= set(ref["fig4Keys"]) | set(res["fig1Keys"])
    assert set(cs.LABEL_TEXT_FOREST) <= set(cs.LABEL_OFFSETS_FOREST) & set(
        ref["fig4Keys"]
    )
    assert cs.THINNING_KEY in ref["fig4Keys"]
    assert cs.REF_YEARS[0] < cs.THINNING_YEAR < cs.REF_YEARS[-1]
    assert "pre-thinning" in cs.LABEL_TEXT_FOREST[cs.PRE_THINNING_KEY]
    assert (
        cs.LABEL_TEXT_FOREST[cs.CLUSTER_KEY]
        == f"{cs.THINNING_YEAR + 1}–{cs.REF_YEARS[-1]}"
    )
    # all markers of Figures 1 and 4 are inside the fixed axis range
    rows = [r for r in res["siteYears"] if r["inFig1"]] + [
        r for r in ref["siteYears"] if r["inFig1"]
    ]
    for r in rows:
        assert cs.AXIS_LO_1 <= r["gpp"] <= cs.AXIS_HI_1
        assert cs.AXIS_LO_1 <= r["reco"] <= cs.AXIS_HI_1
    for f in res["figures"]:
        if f["n"] in (1, 4):
            assert f"both from {cs.AXIS_LO_1:.0f} to {cs.AXIS_HI_1:.0f}" in f["desc"]
        else:
            assert cs.Y_AXIS_TEXT_2 in f["desc"]


def test_literature_rows() -> None:
    keys = [r["key"] for r in cs.LITERATURE]
    assert len(keys) == len(set(keys))
    for r in cs.LITERATURE:
        assert r["ref"] == "dequesada2025"
        assert r["page"] and r["page"].startswith("p. ")
        assert r["value"] is not None and r["unit"]
    assert cs.THINNING_YEAR in cs.REF_YEARS


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


VARIANT_SVGS = sorted((HERE / "figures" / "variants").glob("*.svg"))


def test_variant_svgs_exist() -> None:
    expected = sorted(
        f"figures/variants/{n}-{name}-{variant}.svg"
        for n, name, variant in cs.FIGURE_VARIANTS
    )
    assert [p.relative_to(HERE).as_posix() for p in VARIANT_SVGS] == expected
    declared = sorted(f["file"] for f in results()["figureVariants"])
    assert declared == expected
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    assert set(expected) <= set(manifest["outputs"]["figures"])


def figure_entry(path: Path) -> tuple[dict[str, Any], str]:
    """The results.json entry of an SVG (main figure or variant) and its variant name."""
    res = results()
    rel = path.relative_to(HERE).as_posix()
    for f in res["figureVariants"]:
        if f["file"] == rel:
            return f, f["variant"]
    n = int(path.name.split("-")[0])
    return next(f for f in res["figures"] if f["n"] == n), ""


@pytest.mark.parametrize(
    "path", SVGS + VARIANT_SVGS, ids=[p.name for p in SVGS + VARIANT_SVGS]
)
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    root = ET.parse(path).getroot()
    fig, variant = figure_entry(path)
    tid, did, prefix = cs.svg_ids(n, variant)
    if variant:
        main_ids = {i for m, _ in cs.FIGURES for i in cs.svg_ids(m)}
        assert not {tid, did, prefix} & main_ids
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = [str(e.get("id")) for e in root.iter() if e.get("id")]
    assert len(ids) == len(set(ids))
    keep = {tid, did}
    assert all(i.startswith(prefix) for i in ids if i not in keep)
    assert children[0].text == fig["title"]
    assert children[1].text == fig["desc"]
    texts = root.findall(f".//{SVG_NS}text")
    assert texts, "the text must stay text (svg.fonttype none)"
    for t in texts:
        style = t.get("style") or ""
        assert cs.FONT_STACK in style
        assert "font-variant-numeric: tabular-nums" in style
    assert path.stat().st_size < 1_000_000


def svg_texts(path: Path) -> str:
    """All text of the <text> and <tspan> elements of an SVG, one line per element."""
    root = ET.parse(path).getroot()
    return "\n".join(
        "".join(e.itertext())
        for e in root.iter()
        if e.tag in (f"{SVG_NS}text", f"{SVG_NS}tspan")
    )


def test_no_nee_guide_labels() -> None:
    for path in SVGS + VARIANT_SVGS:
        text = svg_texts(path)
        assert "NEE = −200" not in text and "NEE = −400" not in text, path.name
        assert "NEE = -200" not in text and "NEE = -400" not in text, path.name


def test_variants_have_no_point_labels() -> None:
    res = results()
    rows = {r["key"]: r for r in res["siteYears"]}
    labels = {cs.point_label(rows[k]) for k in cs.LABEL_OFFSETS}
    labels |= set(cs.LABEL_TEXT_FOREST.values())
    # the label text in the SVG can have a line break before the bracket
    parts = {p for t in labels for p in t.replace(" (", "\n(").split("\n")}
    for path in VARIANT_SVGS:
        lines = set(svg_texts(path).splitlines())
        assert not (lines & parts), (path.name, lines & parts)
        assert not any(
            line.startswith(str(y)) for line in lines for y in range(2017, 2026)
        ), path.name
    # the labelled figures have the labels (the test above finds them)
    main = set(svg_texts(HERE / "figures" / "1-carbon-space.svg").splitlines())
    assert main & parts


def test_variant_desc_places_hyytiala_years() -> None:
    f = next(v for v in results()["figureVariants"] if v["n"] == 4)
    assert "have no labels" in f["desc"]
    assert f"{cs.REF_YEARS[0]} (pre-thinning) is the star at GPP" in f["desc"]
    assert f"{cs.THINNING_YEAR} (thinning:" in f["desc"]
    assert "the only star above the 1:1 line" in f["desc"]
    for v in results()["figureVariants"]:
        assert "labels give the year" not in v["desc"]
        assert f"both from {cs.AXIS_LO_1:.0f} to {cs.AXIS_HI_1:.0f}" in v["desc"]
        assert v["title"].endswith(cs.NO_LABELS_NOTE.strip())
