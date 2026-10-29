"""Unit tests of the pure functions, the results and the SVG text of the dive soil-ghg-drivers.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/soil-ghg-drivers/soil-ghg-drivers.py \\
    pytest analysis/soil-ghg-drivers/
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DB = REPO / "db"
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has hyphens)."""
    spec = importlib.util.spec_from_file_location(
        "soil_ghg_drivers", HERE / "soil-ghg-drivers.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["soil_ghg_drivers"] = mod
    spec.loader.exec_module(mod)
    return mod


sg = load_module()


def results() -> dict[str, Any]:
    return json.loads((HERE / "results.json").read_text(encoding="utf-8"))


# ---------- Pure functions ----------
def test_bin_index_edges() -> None:
    assert sg.bin_index(np.array([-0.5, 0.0, 0.99, 1.0]), 1.0).tolist() == [-1, 0, 0, 1]
    assert sg.bin_index(np.array([0.3, 0.32, 0.339]), 0.02).tolist() == [15, 16, 16]


def test_binned_min_days() -> None:
    x = np.array([0.1] * 10 + [1.5] * 9)
    y = np.arange(19, dtype=float)
    b = sg.binned(x, y, 1.0, min_n=10)
    assert len(b) == 1 and b[0]["n"] == 10 and b[0]["centre"] == 0.5
    assert b[0]["median"] == 4.5 and b[0]["q25"] == 2.25


def test_q10_fit_recovers_q10() -> None:
    t = np.arange(0.5, 20.5, 1.0)
    bins = [{"centre": float(v), "median": 0.5 * 3.0 ** ((v - 10) / 10)} for v in t]
    f = sg.q10_fit(bins)
    assert f["ok"] and math.isclose(f["q10"], 3.0, rel_tol=1e-6)
    assert math.isclose(f["f10"], 0.5, rel_tol=1e-6)
    assert f["q10Lo"] <= f["q10"] <= f["q10Hi"]


def test_q10_fit_rules() -> None:
    few = [{"centre": float(i), "median": 1.0} for i in range(4)]
    assert not sg.q10_fit(few)["ok"]
    mixed = [{"centre": float(i), "median": 1.0 if i % 2 else -1.0} for i in range(12)]
    r = sg.q10_fit(mixed)
    assert not r["ok"] and "75" in r["reason"]


def test_ols_hac_recovers_coefficients() -> None:
    rng = np.random.default_rng(1)
    t = rng.normal(10, 5, 500)
    w = rng.normal(0.4, 0.1, 500)
    zt = (t - t.mean()) / t.std(ddof=1)
    zw = (w - w.mean()) / w.std(ddof=1)
    y = 1.0 + 2.0 * zt - 0.5 * zw + 0.3 * zt * zw
    r = sg.ols_hac(y, t, w)
    for k, v in (("const", 1.0), ("tsoil", 2.0), ("swc", -0.5), ("tsoilXswc", 0.3)):
        assert math.isclose(r["coef"][k]["est"], v, abs_tol=1e-9)
    assert math.isclose(r["r2"], 1.0)


def test_block_bootstrap() -> None:
    d = np.ones(30)
    b = sg.block_bootstrap_mean(d, block=7, reps=100, seed=1)
    assert b["mean"] == b["lo"] == b["hi"] == 1.0 and b["nBlocks"] == 5
    a = sg.block_bootstrap_mean(np.arange(50.0), reps=200, seed=3)
    assert a == sg.block_bootstrap_mean(np.arange(50.0), reps=200, seed=3)
    assert a["lo"] < a["mean"] < a["hi"]


def test_unit_conversions() -> None:
    # 1 nmol N2O m-2 s-1 for a full year (17 520 half hours) = 0.0315 g N2O m-2 x 44.013 ...
    kg = sg.annual_kg_ha(17520 * 1.0, "n2o")
    assert math.isclose(kg, 17520 * 1800 * 1e-9 * 44.013 * 10)
    assert math.isclose(sg.daily_mg(1.0, "ch4"), 86400 * 16.043e-3)
    assert sg.half_hours_in_year(2024) == 17568 and sg.half_hours_in_year(2023) == 17520


def test_fert_days() -> None:
    d = sg.fert_days([date(2022, 5, 30)], days=3)
    assert d == {date(2022, 5, 30), date(2022, 5, 31), date(2022, 6, 1)}


def test_trend_word() -> None:
    assert sg.trend_word(0.05) == "no clear monotonic relation"
    assert sg.trend_word(-0.2) == "a weak negative relation"
    assert sg.trend_word(0.8) == "a strong positive relation"


def test_round_sig() -> None:
    assert sg.round_sig(1.23456789012345) == 1.23456789
    assert sg.round_sig({"a": float("nan")}) == {"a": None}


def test_prefix_svg_ids() -> None:
    svg = '<svg><g id="a"/><use href="#a"/><path clip-path="url(#a)"/><title id="t"/></svg>'
    out = sg.prefix_svg_ids(svg, "sg1-", keep={"t"})
    assert 'id="sg1-a"' in out and 'href="#sg1-a"' in out and "url(#sg1-a)" in out
    assert 'id="t"' in out


# ---------- Header and constants ----------
def test_docstring_inputs_equal_constant() -> None:
    doc = sg.parse_docstring_inputs(sg.__doc__ or "")
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in sg.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    doc = sg.__doc__ or ""
    assert f"builtAt: {sg.DATABASE['builtAt']}" in doc
    assert f"commit: {sg.DATABASE['commit']}" in doc
    for i in sg.INPUTS:
        assert i.built_at == sg.DATABASE["builtAt"]


def test_literature_rows() -> None:
    keys = [r["key"] for r in sg.LITERATURE]
    assert len(keys) == len(set(keys))
    for r in sg.LITERATURE:
        assert r["ref"] in {"shurpali2025", "vettikkat2026", "gao2026"}
        assert r["page"] and r["page"].startswith("p. ")
        assert r["value"] is not None and r["unit"]
    for key in sg.LIT_ANNUAL.values():
        u = sg.LIT[key]["uncertainty"]
        assert u["lo"] <= sg.LIT[key]["value"] <= u["hi"]
    for s in sg.SITES:
        assert sg.SOIL[s]["litKey"] in sg.LIT


# ---------- Results ----------
def test_annual_sums_agree_with_anomaly_report() -> None:
    """ANT-08 and SAR-07 of docs/anomaly-data-report.md."""
    a = results()["annual"]
    expected = {
        ("anttila", "2022", "n2o"): 3.85,
        ("anttila", "2023", "n2o"): 1.70,
        ("anttila", "2022", "ch4"): 2.3,
        ("anttila", "2023", "ch4"): 2.7,
        ("sarkisuo", "2022", "ch4"): 103.5,
        ("sarkisuo", "2023", "ch4"): 128,
        ("sarkisuo", "2022", "n2o"): 16.01,
        ("sarkisuo", "2023", "n2o"): 11.32,
    }
    for (s, y, g), v in expected.items():
        assert math.isclose(a[s][y][g]["kgHa"], v, rel_tol=0.02), (s, y, g)
    assert a["sarkisuo"]["2022"]["ch4"]["partial"]
    assert not a["anttila"]["2022"]["ch4"]["partial"]


def test_results_consistent() -> None:
    res = results()
    for gas in sg.GASES:
        for site in sg.GAS_SITES[gas]:
            t = res["temperature"][gas][site]
            assert -1 <= t["spearman"]["rho"] <= 1
            assert all(b["n"] >= sg.MIN_BIN_DAYS for b in t["bins"])
            assert t["nInBins"] <= t["n"]
            assert res["ols"][gas][site]["n"] <= t["n"]
    st = res["soilTypeCompare"]
    for gas in sg.GASES:
        d = st[gas]["diff"]
        assert d["lo"] <= d["mean"] <= d["hi"]
        assert st[gas]["first"] >= "2022-05-06"
    for site in sg.SITES:
        assert (
            res["sensitivity"]["temperature"]["n2o"][site]["n"]
            < res["temperature"]["n2o"][site]["n"]
        )


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"), key=lambda p: int(p.name.split("-")[0]))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name in sg.FIGURES]
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    assert {f"figures/{p.name}" for p in SVGS} == set(manifest["outputs"]["figures"])


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    root = ET.parse(path).getroot()
    fig = next(f for f in results()["figures"] if f["n"] == n)
    tid, did, prefix = sg.svg_ids(n)
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = [str(e.get("id")) for e in root.iter() if e.get("id")]
    assert len(ids) == len(set(ids))
    assert all(i.startswith(prefix) for i in ids if i not in {tid, did})
    assert children[0].text == fig["title"]
    assert children[1].text == fig["desc"]
    texts = root.findall(f".//{SVG_NS}text")
    assert texts, "the text must stay text (svg.fonttype none)"
    for t in texts:
        style = t.get("style") or ""
        assert sg.FONT_STACK in style
        assert "font-variant-numeric: tabular-nums" in style
    assert path.stat().st_size < 1_000_000


def test_desc_has_no_nan() -> None:
    for f in results()["figures"]:
        assert "nan" not in f["desc"].lower().split()
        assert "n/a" not in f["desc"]


def test_unique_ids() -> None:
    svg = '<svg><image id="a"/><image id="a"/><image id="a"/><g id="b"/></svg>'
    out = sg.unique_ids(svg)
    assert 'id="a"' in out and 'id="a-2"' in out and 'id="a-3"' in out
    with pytest.raises(RuntimeError):
        sg.unique_ids('<svg><g id="a"/><g id="a"/><use href="#a"/></svg>')


def test_plain_unicode() -> None:
    s = "CH4 flux (umol m-2 s-1), N2O in kg N2O ha-1 yr-1, swc 0.10 to 0.53 m3 m-3. rho 0.82, Q10 4.65, Sarkisuo"
    assert sg.plain_unicode(s) == (
        "CH₄ flux (µmol m⁻² s⁻¹), N₂O in kg N₂O ha⁻¹ yr⁻¹, swc 0.10 to 0.53 m³ m⁻³. ρ 0.82, Q₁₀ 4.65, Särkisuo"
    )
    assert sg.plain_unicode("2022-05-06, N2O-N") == "2022-05-06, N₂O-N"


def test_figure_text_is_unicode() -> None:
    for f in results()["figures"]:
        for text in (f["title"], f["desc"]):
            for ascii_form in ("umol", "m-2", "m3", "CH4", "N2O", "Sarkisuo", " rho "):
                assert ascii_form not in text, (f["n"], ascii_form)
