"""Unit tests of the pure functions and the SVG text of the dive fertilisation-weather.

Run: uv run --with pytest==9.1.1 --with-requirements analysis/fertilisation-weather/fertilisation-weather.py \
    pytest analysis/fertilisation-weather/
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from types import ModuleType

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
SVG_NS = "{http://www.w3.org/2000/svg}"


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has a hyphen)."""
    spec = importlib.util.spec_from_file_location(
        "fertilisation_weather", HERE / "fertilisation-weather.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["fertilisation_weather"] = mod
    spec.loader.exec_module(mod)
    return mod


fw = load_module()


# ---------- Classification ----------
@pytest.mark.parametrize(
    ("detail", "kind"),
    [
        ("Synthetic N fertiliser, 52 kg N/ha, product not given", "mineral"),
        ("CAN", "mineral"),
        ("YaraBela AXAN 27-0-0", "mineral"),
        ("Typpi 100 kg N/ha", "mineral"),
        ("Kalksalpietari", "mineral"),
        ("mineral fertiliser", "mineral"),
        ("Own NPK mix", "organic"),
        ("N fertiliser, product not given", "organic"),
        ("Cattle slurry", "organic"),
        ("Scandinavian (CANdidate) text", "organic"),
        ("", "organic"),
    ],
)
def test_fertiliser_kind(detail: str, kind: str) -> None:
    assert fw.fertiliser_kind(detail) == kind


def test_classify() -> None:
    assert fw.classify("harvest") == "harvest-cut"
    assert fw.classify("cut") == "harvest-cut"
    assert fw.classify("tillage") == "tillage"
    assert fw.classify("sowing") is None
    assert fw.kind_of(["fertilisation", "tillage"]) == "tillageFert"
    assert fw.kind_of(["fertilisation", "grazing"]) == "other"


# ---------- Episodes ----------
def ev(site: str, d: str, etype: str = "fertilisation", d_end: str | None = None):
    return fw.make_event(
        site,
        fw.day_number(d),
        None if d_end is None else fw.day_number(d_end),
        etype,
        "slurry",
        None,
    )


def test_merge_gap_7_joins_8_does_not() -> None:
    eps = fw.merge_episodes([ev("a", "2022-05-01"), ev("a", "2022-05-08")])
    assert len(eps) == 1 and fw.iso_day(eps[0].end) == "2022-05-08"
    eps = fw.merge_episodes([ev("a", "2022-05-01"), ev("a", "2022-05-09")])
    assert len(eps) == 2


def test_merge_date_end_extends() -> None:
    eps = fw.merge_episodes(
        [ev("a", "2022-05-01", "tillage", "2022-05-05"), ev("a", "2022-05-12")]
    )
    assert len(eps) == 1
    assert eps[0].classes == ["fertilisation", "tillage"]
    assert eps[0].kind == "tillageFert"
    assert eps[0].fert == "organic"
    assert eps[0].id == "a-2022-05-01"


def test_merge_other_site_and_unclassified() -> None:
    eps = fw.merge_episodes(
        [ev("a", "2022-05-01"), ev("a", "2022-05-03", "sowing"), ev("b", "2022-05-02")]
    )
    assert [e.site for e in eps] == ["a", "b"]
    assert len(eps[0].events) == 1


# ---------- Windows ----------
def table_with(values: dict[int, float]) -> object:
    t = fw.DayTable(0, 100)
    days = np.array(list(values), dtype=np.int64)
    t.set("gpp", days, np.array(list(values.values())))
    return t


def test_window_rule_12_days() -> None:
    anchor = 50
    full = {d: 1.0 for d in range(anchor - 14, anchor)} | {
        d: 3.0 for d in range(anchor + 1, anchor + 15)
    }
    t = table_with(full)
    b = fw.window_means(t, anchor, fw.BEFORE, ["gpp"])
    a = fw.window_means(t, anchor, fw.AFTER, ["gpp"])
    assert b.n["gpp"] == 14 and a.mean["gpp"] == 3.0
    assert fw.changes(a, b, ["gpp"])["gpp"] == pytest.approx(2.0)
    # 12 days after: still a change; 11 days: None.
    for missing, ok in ((2, True), (3, False)):
        part = {
            d: v for d, v in full.items() if not (anchor + 1 <= d <= anchor + missing)
        }
        t2 = table_with(part)
        d2 = fw.changes(
            fw.window_means(t2, anchor, fw.AFTER, ["gpp"]),
            fw.window_means(t2, anchor, fw.BEFORE, ["gpp"]),
            ["gpp"],
        )
        assert (d2["gpp"] is not None) == ok


def test_pct() -> None:
    assert fw.pct(110, 100) == pytest.approx(10)
    assert fw.pct(1, 0) is None
    assert fw.pct(None, 1) is None
    assert fw.pct(1, 0.5, 0.5) is None


# ---------- Rank, OLS, bootstrap ----------
def test_rank_strict() -> None:
    assert fw.rank_among([1, 2, 3, 4], 3) == 50
    assert fw.rank_among([1, 2, 3, 4], 0) == 0
    assert fw.rank_among([1, 2, 3, 4], 5) == 100
    with pytest.raises(ValueError):
        fw.rank_among([], 1)


def test_ols_exact() -> None:
    x = np.array([[0, 0], [1, 0], [0, 1], [1, 1], [2, 3], [3, 1]], dtype=float)
    y = 1 + 2 * x[:, 0] - 0.5 * x[:, 1]
    f = fw.ols_multi(x, y)
    assert f is not None
    assert f.coef == pytest.approx([1, 2, -0.5])
    assert f.r2 == pytest.approx(1)
    assert f.resid_sd == pytest.approx(0, abs=1e-12)
    assert f.predict([2, 2]) == pytest.approx(4)


def test_ols_too_few_or_singular() -> None:
    x = np.array([[0, 0], [1, 1], [2, 2], [3, 3]], dtype=float)
    assert fw.ols_multi(x, np.arange(4.0)) is None  # n <= k + 2
    x = np.array([[0, 0], [1, 2], [2, 4], [3, 6], [4, 8]], dtype=float)
    assert fw.ols_multi(x, np.arange(5.0)) is None  # rank deficient


def test_ols_line_and_pearson_p() -> None:
    line = fw.ols_line([1, 2, 3, 4], [2, 4, 6, 8.5])
    assert line["slope"] == pytest.approx(2.15)
    assert line["r"] > 0.99
    assert fw.pearson_p(0.0, 10) == pytest.approx(1)
    # r = 0.5, n = 10: t = 1.633, df = 8, two-sided p = 0.1411.
    assert fw.pearson_p(0.5, 10) == pytest.approx(0.14111, abs=1e-4)


def test_bootstrap_deterministic() -> None:
    xs = np.array([1.0, -2.0, 3.5, 0.2, 4.1])
    a = fw.bootstrap_mean_ci(xs, 123)
    b = fw.bootstrap_mean_ci(xs, 123)
    c = fw.bootstrap_mean_ci(xs, 124)
    assert a == b
    assert a != c
    assert a is not None and a[0] < xs.mean() < a[1]
    assert fw.bootstrap_mean_ci(xs[:2], 1) is None


def test_round_sig() -> None:
    assert fw.round_sig(1.23456789012345) == 1.23456789
    assert fw.round_sig({"a": float("nan"), "b": [np.float64(2.5)]}) == {
        "a": None,
        "b": [2.5],
    }


def test_control_anchors_and_mask() -> None:
    a = fw.control_anchors([2022], 1, 2)
    assert a == [fw.day_number("2021-12-30") + k for k in range(5)]
    m = fw.event_day_mask([ev("a", "2022-05-10", "sowing", "2022-05-11")], 1, 2)
    assert m == {
        fw.day_number(d)
        for d in ("2022-05-09", "2022-05-10", "2022-05-11", "2022-05-12", "2022-05-13")
    }


# ---------- INPUTS ----------
def test_docstring_inputs_equal_constant() -> None:
    assert fw.__doc__ is not None
    doc = fw.parse_docstring_inputs(fw.__doc__)
    const = [
        {"key": i.key, "sha256": i.sha256, "rows": i.rows, "columns": i.columns}
        for i in fw.INPUTS
    ]
    assert doc == const


def test_docstring_database_equal_constant() -> None:
    assert fw.__doc__ is not None
    assert f"builtAt: {fw.DATABASE['builtAt']}" in fw.__doc__
    assert f"calcBuiltAt: {fw.DATABASE['calcBuiltAt']}" in fw.__doc__
    assert all(
        i.built_at in (fw.DATABASE["builtAt"], fw.DATABASE["calcBuiltAt"])
        for i in fw.INPUTS
    )


# ---------- SVG text ----------
SVGS = sorted((HERE / "figures").glob("*.svg"))


def test_svgs_exist() -> None:
    assert [p.name for p in SVGS] == [f"{n}-{name}.svg" for n, name in fw.FIGURES]


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_text(path: Path) -> None:
    n = int(path.name.split("-")[0])
    text = path.read_text(encoding="utf-8")
    root = ET.fromstring(text)
    tid, did = f"{fw.SLUG}-fig{n}-title", f"{fw.SLUG}-fig{n}-desc"
    assert root.get("role") == "img"
    assert root.get("aria-labelledby") == f"{tid} {did}"
    children = list(root)
    assert children[0].tag == f"{SVG_NS}title" and children[0].get("id") == tid
    assert children[1].tag == f"{SVG_NS}desc" and children[1].get("id") == did
    assert len(root.findall(f".//{SVG_NS}title")) == 1
    ids = re.findall(r'\bid="([^"]+)"', text)
    assert len(ids) == len(set(ids)), "ids are not unique"
    # Text is text: no glyph definitions of a font.
    assert not re.search(r'id="DejaVu', text)
    texts = root.findall(f".//{SVG_NS}text")
    assert len(texts) > 10
    for el in texts:
        style = el.get("style") or ""
        assert f"font-family: {fw.FONT_STACK}" in style
        assert "font-variant-numeric: tabular-nums" in style
        assert "DejaVu" not in style
    # results.json has the same caption and alt text.
    results = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
    fig = next(f for f in results["figures"] if f["n"] == n)
    assert fig["title"] == children[0].text
    assert fig["desc"] == children[1].text
    assert path.stat().st_size < 1_000_000


def test_data_version_keys() -> None:
    results = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
    dv = results["dataVersion"]
    assert {
        "generatedAt",
        "git",
        "dbBuiltAt",
        "calcBuiltAt",
        "snapshot",
        "inputs",
    } <= set(dv)
    assert dv["dbBuiltAt"] == dv["snapshot"]["builtAt"] == fw.DATABASE["builtAt"]
    assert (
        dv["calcBuiltAt"] == dv["snapshot"]["calcBuiltAt"] == fw.DATABASE["calcBuiltAt"]
    )
    assert dv["snapshot"]["inputs"] == [
        {"path": i.key, "sha256": i.sha256, "rows": i.rows} for i in fw.INPUTS
    ]
    assert {"commit", "dirty"} <= set(dv["git"])
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    assert {k: v for k, v in manifest.items() if k != "outputs"}.keys() == dv.keys()


def test_scalar_keys() -> None:
    results = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
    m = results["method"]
    assert (
        m["windowDays"],
        m["minFracPct"],
        m["ciLevelPct"],
        m["halfHoursPerDay"],
    ) == (14, 10, 95, 48)
    assert (m["utcShiftHours"], m["utcShiftHalfHours"], m["nSites"]) == (2, 4, 5)
    assert m["nSitesWithFit"] == results["counts"]["nControlSites"]
    par = results["literatureByKey"]["parLowerPct"]
    assert (par["valueMin"], par["valueMax"], par["value"]) == (7, 29, [7, 29, 12])
    assert len(results["literatureByKey"]) == len(results["literature"])


@pytest.mark.parametrize("path", SVGS, ids=[p.name for p in SVGS])
def test_svg_ids_prefixed_and_resolved(path: Path) -> None:
    n = int(path.name.split("-")[0])
    text = path.read_text(encoding="utf-8")
    ids = re.findall(r'\bid="([^"]+)"', text)
    assert len(ids) == len(set(ids))
    keep = {f"{fw.SLUG}-fig{n}-title", f"{fw.SLUG}-fig{n}-desc"}
    assert keep <= set(ids)
    assert all(i.startswith(f"fw{n}-") for i in ids if i not in keep)
    refs = re.findall(r"url\(#([^)]+)\)", text) + re.findall(r'href="#([^"]+)"', text)
    assert refs, "no references found"
    assert set(refs) <= set(ids), f"dangling: {set(refs) - set(ids)}"
    root = ET.fromstring(text)
    assert root.get("aria-labelledby") == " ".join(
        sorted(keep, key=lambda k: k.endswith("desc"))
    )


def test_prefix_svg_ids() -> None:
    svg = '<svg><title id="t"/><g id="a" clip-path="url(#c)"/><clipPath id="c"/><use xlink:href="#a" href="#a"/></svg>'
    out = fw.prefix_svg_ids(svg, "fw9-", {"t"})
    assert 'id="t"' in out and 'id="fw9-a"' in out and "url(#fw9-c)" in out
    assert 'xlink:href="#fw9-a"' in out and ' href="#fw9-a"' in out


def test_course_late_means() -> None:
    results = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
    c = results["course"]
    assert (c["lateFrom"], c["lateTo"]) == (10, 14)
    idx = [i for i, d in enumerate(c["days"]) if 10 <= d <= 14]
    for g in ("fertOnly", "withTillage"):
        vals = [c[g]["mean"][i] for i in idx if c[g]["mean"][i] is not None]
        assert c[g]["lateMeanPct"] == pytest.approx(np.mean(vals), rel=1e-9)
    assert "mean of the daily SDs" in results["figures"][2]["desc"]
    assert "mean SD" not in results["figures"][2]["desc"]
