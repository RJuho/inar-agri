"""Unit tests of the pure functions, the results and the SVG text of the dive net-biome-exchange.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/net-biome-exchange/net-biome-exchange.py \\
    pytest analysis/net-biome-exchange/
"""

from __future__ import annotations

import csv
import importlib.util
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SNAP = REPO / "snapshots" / "db-2026-10-23"
DB = SNAP / "db" if SNAP.is_dir() else REPO / "db"
CALC = SNAP / "calculated" if SNAP.is_dir() else REPO / "data" / "calculated"
SMEAR = REPO / "data" / "smear" / "hyytiala"
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has hyphens)."""
    spec = importlib.util.spec_from_file_location(
        "net_biome_exchange", HERE / "net-biome-exchange.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["net_biome_exchange"] = mod
    spec.loader.exec_module(mod)
    return mod


nb = load_module()


def results() -> dict[str, Any]:
    return json.loads((HERE / "results.json").read_text(encoding="utf-8"))


def have_data() -> bool:
    return not nb.check_inputs(DB, CALC, SMEAR)


needs_data = pytest.mark.skipif(
    not have_data(), reason="database snapshot of INPUTS not present"
)


def have_db_calc() -> bool:
    """The db and calculated inputs only (the NECB test needs no SMEAR files)."""
    return (
        all(e.startswith("smear/") for e in nb.check_inputs(DB, CALC, SMEAR))
        and (CALC / "necb.csv").is_file()
    )


needs_db_calc = pytest.mark.skipif(
    not have_db_calc(), reason="db and calculated inputs of INPUTS not present"
)


# ---------- Pure functions ----------
def test_nbe_of() -> None:
    t = [
        nb.Term("out", "2022-06-01", "cut", 100.0, 80.0, 120.0, "x"),
        nb.Term("in", "2022-05-01", "manure", 30.0, 50.0, 10.0, "y"),
    ]
    nbe, low, high, c_out, c_in = nb.nbe_of(-50.0, t)
    assert (nbe, c_out, c_in) == (20.0, 100.0, 30.0)
    assert low == -50 + 80 - 50 and high == -50 + 120 - 10
    assert nb.nbe_of(-10.0, []) == (-10.0, -10.0, -10.0, 0, 0)


def test_parsers() -> None:
    p = "liquid manure (57.5 kg N/ha) + dry manure (22.5 kg N/ha, 9 Oct) + mineral N"
    assert nb.parse_kg_n(p, "liquid manure") == 57.5
    assert nb.parse_kg_n(p, "dry manure") == 22.5
    assert nb.parse_animals("20 highland cows, 12 days") == ("cattle", 20, 12)
    assert nb.parse_animals("grazing removal, 4 horses, 7 days") == ("horse", 4, 7)
    d = "Manure, 10 m3/ha (could be 45-60 m3/ha), north sector; dry grass crushed"
    assert nb.parse_volume_range(d) == (10.0, 60.0)
    with pytest.raises(nb.InputError):
        nb.parse_animals("no animals")


def test_manure_c_fraction_and_gao() -> None:
    assert math.isclose(nb.manure_c_fraction(), 0.799 * 0.504)
    assert math.isclose(
        nb.lv("gaoManureDm") * nb.manure_c_fraction(), 685, rel_tol=2e-3
    )


def test_round_sig() -> None:
    assert nb.round_sig(1.23456789012345) == 1.23456789
    assert nb.round_sig(float("nan")) is None


def test_prefix_svg_ids() -> None:
    svg = '<svg><title id="t"/><g id="a" clip-path="url(#c)"/><clipPath id="c"/><use xlink:href="#a"/></svg>'
    out = nb.prefix_svg_ids(svg, "nb1-", {"t"})
    assert 'id="t"' in out and 'id="nb1-a"' in out and "url(#nb1-c)" in out


# ---------- Header and constants ----------
def test_docstring_inputs_equal_constant() -> None:
    doc = nb.parse_docstring_inputs(nb.__doc__ or "")
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in nb.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    doc = nb.__doc__ or ""
    assert f"builtAt: {nb.DATABASE['builtAt']}" in doc
    assert f"calcBuiltAt: {nb.DATABASE['calcBuiltAt']}" in doc
    assert f"commit: {nb.DATABASE['commit']}" in doc


def test_literature_rows() -> None:
    keys = [r["key"] for r in nb.LITERATURE]
    assert len(keys) == len(set(keys))
    for r in nb.LITERATURE:
        assert r["page"] and r["page"].startswith("p. ")
        assert r["value"] is not None and r["unit"] and r["ref"]


def test_axis_constants() -> None:
    assert nb.X_LO % nb.X_TICK == 0 and nb.X_HI % nb.X_TICK == 0
    assert nb.Y_LO % nb.Y_TICK == 0 and nb.Y_HI % nb.Y_TICK == 0


# ---------- Results ----------
def test_results_consistent() -> None:
    res = results()
    rows = res["siteYears"]
    for r in rows:
        if r["nbe"] is None:
            assert r["nbeReason"] and r["class"] is None and not r["inFigure"]
            continue
        assert math.isclose(r["nbe"], r["nee"] + r["cOut"] - r["cIn"], abs_tol=1e-6)
        assert r["nbeLow"] <= r["nbe"] + 1e-9 <= r["nbeHigh"] + 2e-9
        if r["class"] == "A":
            assert r["nbeLow"] == r["nbe"] == r["nbeHigh"] and not r["assumptions"]
            assert r["fullYear"]
        else:
            assert r["assumptions"]
        if r["inFigure"]:
            assert r["fullYear"] and r["reliable"] and r["gpp"] is not None
            assert math.isclose(r["carbonOut"] - r["gpp"], r["nbe"], abs_tol=1e-6)
    s = res["summary"]
    assert (
        s["nFigure"]
        == len(res["figureKeys"])
        == s["nFigureSites"] + s["nFigureHyytiala"]
    )
    assert s["nWithNbe"] == s["nClassA"] + s["nClassB"]
    assert all(
        r["site"] == "maktau" or r["nbeReason"] == "no annual NEE sum"
        for r in res["noNbe"]
    )
    hy = res["sy"]["hyytiala-2020"]
    assert math.isclose(hy["nbe"], hy["nee"] + 2310, abs_tol=1e-6)
    assert math.isclose(hy["nbeLow"], hy["nee"] + 1490, abs_tol=1e-6)
    assert math.isclose(hy["nbeHigh"], hy["nee"] + 2440, abs_tol=1e-6)
    for y in (2019, 2021, 2022, 2023, 2024):
        r = res["sy"][f"hyytiala-{y}"]
        assert r["nbe"] == r["nee"] and r["class"] == "A"
    q = res["sy"]["qvidja-2019"]
    assert math.isclose(q["nbe"], -246.7226036 + 173.685624 - 43.0, abs_tol=1e-4)


def test_term_directions() -> None:
    """An input term: valueAtLowNbe >= value >= valueAtHighNbe; an output term: the reverse.
    The grazing pairs (assumption i) are checked on the net of the pair."""
    for r in results()["siteYears"]:
        graze = [t for t in r["terms"] if t["assumption"] == "i-qvidja-grazing-2025"]
        for t in r["terms"]:
            if t in graze:
                continue
            lo, v, hi = t["valueAtLowNbe"], t["value"], t["valueAtHighNbe"]
            if t["kind"] == "in":
                assert lo >= v - 1e-9 and v >= hi - 1e-9, (r["key"], t)
            else:
                assert lo <= v + 1e-9 and v <= hi + 1e-9, (r["key"], t)
        if graze:
            sign = {"out": 1.0, "in": -1.0}
            net = {
                k: sum(sign[t["kind"]] * t[k] for t in graze)
                for k in ("valueAtLowNbe", "value", "valueAtHighNbe")
            }
            assert net["valueAtLowNbe"] <= net["value"] <= net["valueAtHighNbe"]


def test_dry_manure_date() -> None:
    p = "liquid manure (57.5 kg N/ha) + dry manure (22.5 kg N/ha, 9 Oct) + mineral N"
    assert nb.dry_manure_date(p, 2024).isoformat() == "2024-10-09"


def read_necb() -> dict[str, dict[str, str]]:
    with (CALC / "necb.csv").open(encoding="utf-8") as f:
        return {f"{r['site_code']}-{r['year']}": r for r in csv.DictReader(f)}


@needs_db_calc
def test_against_necb() -> None:
    """Class A: NBE = -NECB - CH4-C; all site-years: the file sums = c_harvest and c_exo."""
    necb = read_necb()
    for r in results()["siteYears"]:
        if r["site"] == "hyytiala" or r["nbe"] is None:
            continue
        n = necb[r["key"]]
        assert math.isclose(r["cOutFile"], float(n["c_harvest"] or 0), abs_tol=1e-6), r[
            "key"
        ]
        assert math.isclose(r["cInFile"], float(n["c_exo"] or 0), abs_tol=1e-6), r[
            "key"
        ]
        if r["class"] == "A":
            ch4 = float(n["c_ch4"]) if n["c_ch4"] else 0.0
            assert math.isclose(r["nbe"], -float(n["necb"]) - ch4, abs_tol=1e-6), r[
                "key"
            ]


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"), key=lambda p: int(p.name.split("-")[0]))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name in nb.FIGURES]


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    root = ET.parse(path).getroot()
    tid, did = f"{nb.SLUG}-fig{n}-title", f"{nb.SLUG}-fig{n}-desc"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = [str(e.get("id")) for e in root.iter() if e.get("id")]
    assert len(ids) == len(set(ids))
    assert all(
        i.startswith(f"{nb.SVG_ID_PREFIX}{n}-") for i in ids if i not in {tid, did}
    )
    fig = next(f for f in results()["figures"] if f["n"] == n)
    assert children[0].text == fig["title"]
    assert children[1].text == fig["desc"]
    texts = root.findall(f".//{SVG_NS}text")
    assert texts, "the text must stay text (svg.fonttype none)"
    for t in texts:
        style = t.get("style") or ""
        assert nb.FONT_STACK in style
        assert "font-variant-numeric: tabular-nums" in style
    assert path.stat().st_size < 1_000_000


# ---------- SVG variants ----------
VARIANT_SVGS = sorted((HERE / "figures" / "variants").glob("*.svg"))


def variant_file(n: int, variant: str) -> str:
    return f"figures/variants/{n}-{dict(nb.FIGURES)[n]}-{variant}.svg"


def test_variant_set() -> None:
    """The variant files, the script table FIGURE_VARIANTS and results.json agree."""
    expected = sorted(variant_file(v[0], v[1]) for v in nb.FIGURE_VARIANTS)
    assert sorted(f"figures/variants/{p.name}" for p in VARIANT_SVGS) == expected
    assert sorted(f["file"] for f in results()["figureVariants"]) == expected
    codes = [v[5] for v in nb.FIGURE_VARIANTS]
    assert len(codes) == len(set(codes))


@pytest.mark.parametrize("path", VARIANT_SVGS, ids=[p.name for p in VARIANT_SVGS])
def test_variant_svg_text(path: Path) -> None:
    rel = f"figures/variants/{path.name}"
    entry = next(f for f in results()["figureVariants"] if f["file"] == rel)
    spec = next(v for v in nb.FIGURE_VARIANTS if v[1] == entry["variant"])
    n, variant, layout, shift, labels, code = spec
    root = ET.parse(path).getroot()
    tid, did = nb.svg_aria_ids(n, variant)
    assert tid == f"{nb.SLUG}-fig{n}-{variant}-title"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert children[0].text == entry["title"]
    assert children[1].text == entry["desc"]
    ids = [str(e.get("id")) for e in root.iter() if e.get("id")]
    assert len(ids) == len(set(ids))
    assert all(
        i.startswith(f"{nb.SVG_ID_PREFIX}{n}{code}-")
        for i in ids
        if i not in {tid, did}
    )
    texts = root.findall(f".//{SVG_NS}text")
    assert texts, "the text must stay text (svg.fonttype none)"
    for t in texts:
        style = t.get("style") or ""
        assert nb.FONT_STACK in style
        assert "font-variant-numeric: tabular-nums" in style
    assert path.stat().st_size < 1_000_000
    width = float(str(root.get("width")).removesuffix("pt"))
    height = float(str(root.get("height")).removesuffix("pt"))
    if layout == "wide":
        assert math.isclose(width / height, 16 / 9, rel_tol=1e-3)
    else:
        assert height > width
    drawn = "\n".join("".join(t.itertext()) for t in texts)
    shift_word = nb.SHIFT_LEGEND.split("\n")[0]
    assert (shift_word in drawn) == shift
    assert ("A grey line links each marker" in entry["desc"]) == shift
    label_texts = {
        nb.LABEL_TEXT.get(k, "") for k in nb.LABEL_OFFSETS if k in nb.LABEL_TEXT
    }
    for t in label_texts:
        assert (t in drawn) == labels, t
    assert ("labels give the year" in entry["desc"]) == labels


def all_svgs() -> list[Path]:
    return [*SVGS, *VARIANT_SVGS]


@pytest.mark.parametrize("path", all_svgs(), ids=[p.name for p in all_svgs()])
def test_no_nbe_guides(path: Path) -> None:
    """The guide lines NBE = −200 and −400 are removed (only the 1:1 line stays)."""
    body = path.read_text(encoding="utf-8")
    assert "NBE = −200" not in body and "NBE = −400" not in body
    assert "NBE = -200" not in body


def test_axes_start_equal() -> None:
    """The 1:1 line starts in the lower left corner."""
    assert nb.X_LO == nb.Y_LO
