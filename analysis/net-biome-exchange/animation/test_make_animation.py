"""Unit tests of the NEE to NBE animation script (pure functions, no ffmpeg run).

Run: uv run --with pytest==9.1.1 --with-requirements \\
    analysis/net-biome-exchange/animation/make-animation.py \\
    pytest analysis/net-biome-exchange/animation/
"""

from __future__ import annotations

import importlib.util
import json
import sys
from itertools import pairwise
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SIZES_40 = {
    "__default__": (40.0, 9.0)
}  # text size (width, height in points) for the tests


def load_module() -> ModuleType:
    """Import the script from its file path (the file name has a hyphen)."""
    spec = importlib.util.spec_from_file_location(
        "make_animation", HERE / "make-animation.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["make_animation"] = mod
    spec.loader.exec_module(mod)
    return mod


ma = load_module()


def results(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sizes_for(points: tuple[Any, ...]) -> dict[str, tuple[float, float]]:
    return {p.label: (40.0, 9.0) for p in points}


@pytest.fixture(scope="module")
def nb() -> dict[str, Any]:
    return results(REPO / ma.NB_RESULTS)


@pytest.fixture(scope="module")
def cs() -> dict[str, Any]:
    return results(REPO / ma.CS_RESULTS)


@pytest.fixture(scope="module")
def points(nb: dict[str, Any], cs: dict[str, Any]) -> tuple[Any, ...]:
    return ma.point_table(nb, cs)


@pytest.fixture(scope="module")
def cuts() -> tuple[int, int, int]:
    """The cut frames at 60 fps from the timeline: end of clip 1, 2 and 3."""
    clips = ma.timeline(60)
    return (clips[0].end_frame, clips[1].end_frame, clips[2].end_frame)


# ----------------------------------------------------------------------------------------
# Easing and helpers
# ----------------------------------------------------------------------------------------
def test_smoothstep_endpoints_and_shape() -> None:
    assert ma.smoothstep(0.0) == 0.0
    assert ma.smoothstep(1.0) == 1.0
    assert ma.smoothstep(-0.5) == 0.0
    assert ma.smoothstep(1.5) == 1.0
    assert ma.smoothstep(0.5) == pytest.approx(0.5)
    assert ma.smoothstep(0.25) == pytest.approx(3 * 0.25**2 - 2 * 0.25**3)
    vs = [ma.smoothstep(i / 50) for i in range(51)]
    assert all(b >= a for a, b in pairwise(vs))


def test_fmt_minus_sign() -> None:
    assert ma.fmt(-200.0) == "−200"
    assert ma.fmt(0.0) == "0"
    assert ma.fmt(-0.4) == "0"


def test_lerp_rgb() -> None:
    assert ma.lerp_rgb((0, 0, 0), (1, 1, 1), 0.25) == (0.25, 0.25, 0.25)
    assert ma.hex_rgb("#ffffff") == (1.0, 1.0, 1.0)


def test_centre_offset_values() -> None:
    assert ma.centre_offset(11, "left", 30.0) == 26.0
    assert ma.centre_offset(-11, "right", 30.0) == -26.0
    assert ma.centre_offset(5, "center", 30.0) == 5.0


def test_interp_offset_alignment_change_keeps_place() -> None:
    size = (40.0, 9.0)
    # left (dx 11) and right (dx -11) of a 40 pt wide text: the centre forms are 31 and -31.
    start = ma.interp_offset((11, 0, "left"), (-11, 0, "right"), 0.0, size)
    assert start[0] == pytest.approx(31.0) and start[1] == pytest.approx(0.0, abs=1e-9)
    assert start[2] == "center"
    end = ma.interp_offset((11, 0, "left"), (-11, 0, "right"), 1.0, size)
    assert end[0] == pytest.approx(-31.0) and end[1] == pytest.approx(0.0, abs=1e-9)
    # a side switch goes over the top; the box hugs the marker: gap 11 + half height 4.5
    mid = ma.interp_offset((11, 0, "left"), (-11, 0, "right"), 0.5, size)
    assert mid[0] == pytest.approx(0.0, abs=1e-9) and mid[1] == pytest.approx(15.5)
    assert ma.interp_offset((11, 2, "left"), (11, 6, "left"), 0.5, size) == (
        11.0,
        4.0,
        "left",
    )


def test_interp_offset_path_stays_outside_the_marker() -> None:
    """A wide label (as "2020 (thinning)") stays close to the marker on its arc, but its box
    edge never comes nearer than the smaller of the two gaps."""
    size = (70.0, 9.0)
    start, end = (-10, 12, "right"), (14, 0, "left")
    for i in range(101):
        dx, dy, _ = ma.interp_offset(start, end, i / 100, size)
        th = __import__("math").atan2(dy, dx)
        gap = __import__("math").hypot(dx, dy) - ma.box_reach(th, size)
        assert 9.0 <= gap <= 15.0
        assert __import__("math").hypot(dx, dy) <= 50.0


# ----------------------------------------------------------------------------------------
# Timeline
# ----------------------------------------------------------------------------------------
def test_timeline_cuts() -> None:
    assert ma.CUT1 == 3.0
    assert ma.CUT2 == 7.5
    assert ma.END == 13.5


def test_timeline_frame_counts_60_fps(cuts: tuple[int, int, int]) -> None:
    clips = ma.timeline(60)
    assert [c.frames for c in clips] == [180, 270, 360]
    assert [c.start_frame for c in clips] == [0, 180, 450]
    assert cuts == (180, 450, 810)
    assert ma.total_frames(60) == 810
    assert ma.total_frames(60) == sum(c.frames for c in clips)


def test_timeline_frame_counts_other_fps() -> None:
    clips = ma.timeline(30)
    assert [c.frames for c in clips] == [90, 135, 180]
    assert ma.total_frames(30) == 405


def test_progress_phases() -> None:
    assert ma.progress_at(0.0) == (0.0, 0.0)
    assert ma.progress_at(ma.CUT1) == (0.0, 0.0)
    assert ma.progress_at(ma.CUT1 + 1.0) == (0.0, 0.0)  # hold in
    assert ma.progress_at(ma.CUT1 + 1.0 + 1.25) == (pytest.approx(0.5), 0.0)
    assert ma.progress_at(ma.CUT1 + 3.5) == (1.0, 0.0)  # move done, hold out
    assert ma.progress_at(ma.CUT2) == (1.0, 0.0)
    assert ma.progress_at(ma.CUT2 + 1.0 + 1.5) == (1.0, pytest.approx(0.5))
    assert ma.progress_at(ma.CUT2 + 4.0) == (1.0, 1.0)
    assert ma.progress_at(ma.END) == (1.0, 1.0)


# ----------------------------------------------------------------------------------------
# Point table against the two results.json files
# ----------------------------------------------------------------------------------------
def test_point_table_keys(points: tuple[Any, ...], nb: dict[str, Any]) -> None:
    keys = [p.key for p in points]
    assert keys == [*nb["figureKeys"], ma.MAKTAU_KEY]
    assert len(points) == 21
    assert sum(p.in_nbe for p in points) == 20


def test_point_table_values(
    points: tuple[Any, ...], nb: dict[str, Any], cs: dict[str, Any]
) -> None:
    sy = nb["sy"]
    for p in points:
        if p.key == ma.MAKTAU_KEY:
            continue
        s = sy[p.key]
        assert p.x == s["gpp"]
        assert p.ter == s["ter"]
        assert p.carbon_out == s["carbonOut"]
        assert p.nee == s["nee"]
        assert p.cls == s["class"]
        assert (p.nbe_low, p.nbe_high) == (s["nbeLow"], s["nbeHigh"])
        # carbon out = TER + NBE - NEE
        assert p.carbon_out == pytest.approx(p.ter + s["nbe"] - p.nee, abs=1e-6)
    m = next(p for p in points if p.key == ma.MAKTAU_KEY)
    row = next(r for r in cs["siteYears"] if r["key"] == ma.MAKTAU_KEY)
    assert row["inFig1"] is True
    assert (m.x, m.ter, m.carbon_out) == (row["gpp"], row["reco"], row["reco"])
    assert m.label == "2019 maize"
    assert not m.in_nbe and not m.moves and m.whisker is None


def test_point_table_labels(points: tuple[Any, ...]) -> None:
    by_key = {p.key: p for p in points}
    assert by_key["haltiala-2023"].label == "2023 grass (failed)"
    assert by_key["anttila-2022"].label == "2022"
    assert by_key[ma.THINNING_KEY].label == "2020 (thinning)"
    assert by_key[ma.CLUSTER_KEY].label == "2021–2024"
    # every labelled key of Figure 1 has an offset in all three tables
    for k in ma.LABEL_OFFSETS_END:
        assert k in ma.LABEL_OFFSETS_START and k in ma.LABEL_OFFSETS_FINAL
        assert k in by_key
    # the labels whose alignment changes between the start and the end tables
    changed = {
        k
        for k in ma.LABEL_OFFSETS_END
        if ma.LABEL_OFFSETS_START[k][2] != ma.LABEL_OFFSETS_END[k][2]
    }
    assert {"sarkisuo-2022", "qvidja-2023", "qvidja-2025", ma.THINNING_KEY} <= changed


def test_point_table_whisker_and_moves(points: tuple[Any, ...]) -> None:
    by_key = {p.key: p for p in points}
    h = by_key[ma.THINNING_KEY]
    assert h.cls == "B" and h.moves
    assert h.whisker == pytest.approx((2572.693, 3522.693), abs=0.01)
    assert by_key["haltiala-2024"].moves is False  # zero shift
    for k in (
        "hyytiala-2019",
        "hyytiala-2021",
        "hyytiala-2022",
        "hyytiala-2023",
        "hyytiala-2024",
    ):
        assert by_key[k].moves is False and by_key[k].cls == "A"


def test_point_table_stops_on_a_difference(
    nb: dict[str, Any], cs: dict[str, Any]
) -> None:
    bad = json.loads(json.dumps(nb))
    bad["sy"]["anttila-2022"]["gpp"] += 1e-3
    with pytest.raises(ma.DataError):
        ma.point_table(bad, cs)
    bad = json.loads(json.dumps(nb))
    bad["figureKeys"].append("qvidja-2021")
    with pytest.raises(ma.DataError):
        ma.point_table(bad, cs)


# ----------------------------------------------------------------------------------------
# States at the cuts equal the stills; the step rules
# ----------------------------------------------------------------------------------------
def test_state_at_cuts_equals_stills(
    points: tuple[Any, ...], cuts: tuple[int, int, int]
) -> None:
    fps = 60
    c1, c2, c3 = cuts
    sizes = sizes_for(points)
    s1 = ma.still_state(0.0, points, sizes)
    s2 = ma.still_state(ma.CUT2, points, sizes)
    s3 = ma.still_state(ma.END, points, sizes)
    # last frame of clip 1 = still 1 = first frame of clip 2
    assert ma.still_state((c1 - 1) / fps, points, sizes) == s1
    assert ma.still_state(c1 / fps, points, sizes) == s1
    # last frame of clip 2 = still 2 = first frame of clip 3
    assert ma.still_state((c2 - 1) / fps, points, sizes) == s2
    assert ma.still_state(c2 / fps, points, sizes) == s2
    # last frame of the timeline = still 3
    assert ma.still_state((c3 - 1) / fps, points, sizes) == s3
    # the holds: the first and the last 60 frames of each clip are the same state
    for start, end in ((0, c1), (c1, c2), (c2, c3)):
        first = {
            ma.still_state(i / fps, points, sizes) for i in range(start, start + 60)
        }
        last = {ma.still_state(i / fps, points, sizes) for i in range(end - 60, end)}
        assert len(first) == 1 and len(last) == 1
    assert s1 != s2 != s3


def test_step_rules(points: tuple[Any, ...]) -> None:
    sizes = sizes_for(points)
    s1 = ma.state_at(0.0, points, sizes)
    s2 = ma.state_at(ma.CUT2, points, sizes)
    s3 = ma.state_at(ma.END, points, sizes)
    p1 = {p.key: p for p in s1.points}
    p2 = {p.key: p for p in s2.points}
    p3 = {p.key: p for p in s3.points}
    by_key = {p.key: p for p in points}
    # step 1: all at TER, filled, no whisker, no shift, NEE texts, y top 1600
    assert all(p.y == by_key[k].ter for k, p in p1.items())
    assert all(p.whisker is None and p.shift is None for p in p1.values())
    assert all(p.mec == ma.WHITE and p.mew == ma.MARKER_EDGE for p in p1.values())
    assert (s1.y_top, s1.text_fade, s1.tick_fade) == (1600.0, 0.0, 0.0)
    assert s1.maktau_alpha == 1.0 and s1.class_legend_alpha == 0.0
    # step 2 end: agricultural site-years at carbon out; Hyytiala 2020 and the axes unchanged
    for k, p in p2.items():
        if k == ma.MAKTAU_KEY:
            assert p.alpha == 0.0
        elif k == ma.THINNING_KEY:
            assert p.y == by_key[k].ter and p.shift is None and p.whisker is None
            assert p.mec == ma.WHITE
        else:
            assert p.y == by_key[k].carbon_out
            if by_key[k].cls == "B":
                assert p.mfc == ma.WHITE and p.mew == ma.HOLLOW_EDGE
                assert p.whisker is not None and p.whisker[2] == 1.0
            if by_key[k].moves:
                assert p.shift == (by_key[k].ter, 1.0)
            else:
                assert p.shift is None
    assert (s2.y_top, s2.text_fade, s2.tick_fade) == (1600.0, 1.0, 0.0)
    assert s2.maktau_alpha == 0.0 and s2.class_legend_alpha == 1.0
    # step 3 end: Hyytiala 2020 at carbon out with the whisker; y top 3600
    h = p3[ma.THINNING_KEY]
    assert h.y == pytest.approx(3392.693, abs=0.01)
    assert h.mfc == ma.WHITE and h.whisker is not None and h.whisker[2] == 1.0
    assert h.shift == (by_key[ma.THINNING_KEY].ter, 1.0)
    # the label (14, 0, left) in the centre form of a 40 pt wide text: dx 14 + 20
    assert h.label is not None
    assert h.label.dx == pytest.approx(34.0) and h.label.dy == pytest.approx(
        0.0, abs=1e-9
    )
    assert h.label.ha == "center"
    assert (s3.y_top, s3.tick_fade) == (3600.0, 1.0)
    # the other points do not change in step 3 (only some labels slide)
    for k, q in p2.items():
        if k != ma.THINNING_KEY:
            assert (q.x, q.y, q.mfc, q.whisker) == (
                p3[k].x,
                p3[k].y,
                p3[k].mfc,
                p3[k].whisker,
            )


def test_mid_move_is_between(points: tuple[Any, ...]) -> None:
    sizes = sizes_for(points)
    mid = ma.state_at(ma.CUT1 + ma.STEP2_HOLD_IN + ma.STEP2_MOVE / 2, points, sizes)
    by_key = {p.key: p for p in points}
    q = next(p for p in mid.points if p.key == "qvidja-2023")
    src = by_key["qvidja-2023"]
    assert q.y == pytest.approx((src.ter + src.carbon_out) / 2)
    assert q.mfc == ma.WHITE  # the fill phase is done at half of the move
    assert q.whisker is None  # the whisker starts in the second half
    assert mid.maktau_alpha == 0.0
    assert 0.0 < mid.text_fade < 1.0


def test_thinning_label_follows_the_star(points: tuple[Any, ...]) -> None:
    """The label of Hyytiala 2020 is anchored at the star and stays within 50 pt of it."""
    sizes = sizes_for(points)
    sizes["2020 (thinning)"] = (70.0, 9.0)
    for i in range(61):
        t = ma.CUT2 + ma.STEP3_HOLD_IN + ma.STEP3_MOVE * i / 60
        st = ma.state_at(t, points, sizes)
        h = next(p for p in st.points if p.key == ma.THINNING_KEY)
        assert h.label is not None
        assert (h.label.dx**2 + h.label.dy**2) ** 0.5 <= 50.0


def test_whisker_inside_the_axes(points: tuple[Any, ...]) -> None:
    """Whenever a whisker has alpha > 0, its top is below the current y axis top."""
    sizes = sizes_for(points)
    seen = False
    for i in range(811):
        st = ma.state_at(i / 60, points, sizes)
        for p in st.points:
            if p.whisker is not None and p.whisker[2] > 0.0:
                assert p.whisker[1] <= st.y_top - ma.WHISKER_MARGIN + 1e-6, (i, p.key)
                assert p.whisker[0] >= ma.Y_LO
                seen = True
    assert seen
    h = next(p for p in points if p.key == ma.THINNING_KEY)
    assert h.whisker is not None
    assert 0.85 < ma.whisker_start(h.whisker[1]) < 0.95
    assert ma.whisker_start(1000.0) == ma.WHISKER_START_3_MIN
    with pytest.raises(ValueError):
        ma.whisker_start(4000.0)


def test_y_ticks_crossfade(points: tuple[Any, ...]) -> None:
    sizes = sizes_for(points)
    s1 = ma.state_at(0.0, points, sizes)
    assert ma.y_ticks(s1) == [(float(v), 1.0) for v in range(400, 1601, 200)]
    s3 = ma.state_at(ma.END, points, sizes)
    assert ma.y_ticks(s3) == [(float(v), 1.0) for v in range(400, 3601, 400)]
    mid = ma.state_at(ma.CUT2 + ma.STEP3_HOLD_IN + ma.STEP3_MOVE / 2, points, sizes)
    ticks = dict(ma.y_ticks(mid))
    assert ticks[400.0] == 1.0 and ticks[1600.0] == 1.0
    assert ticks[600.0] == pytest.approx(0.5) and ticks[2000.0] == pytest.approx(0.5)
    assert 1800.0 not in ticks
    assert max(ticks) <= mid.y_top


# ----------------------------------------------------------------------------------------
# Canvas, drawing and the encoder (ffmpeg is not run)
# ----------------------------------------------------------------------------------------
def test_canvas() -> None:
    c = ma.canvas_for(1080)
    assert (c.width, c.height) == (1080, 810)
    assert c.dpi == pytest.approx(152.4)
    assert c.figsize[0] * c.dpi == pytest.approx(1080.01, abs=1e-6)
    with pytest.raises(ValueError):
        ma.canvas_for(1002)


def test_ffmpeg_cmd() -> None:
    cmd = ma.ffmpeg_cmd("/bin/ffmpeg", ma.canvas_for(1080), 60, Path("/x/out.mp4"))
    assert cmd[0] == "/bin/ffmpeg"
    assert cmd[-1] == "/x/out.mp4"
    assert cmd[cmd.index("-s") + 1] == "1080x810"
    assert cmd[cmd.index("-r") + 1] == "60"
    assert cmd[cmd.index("-c:v") + 1] == "libx264"
    assert cmd[cmd.index("-pix_fmt", cmd.index("-i")) + 1] == "yuv420p"
    assert "-an" in cmd
    assert cmd[cmd.index("-i") + 1] == "-"
    assert cmd[cmd.index("-f") + 1] == "rawvideo"
    assert cmd[cmd.index("-movflags") + 1] == "+faststart"
    assert cmd[cmd.index("-crf") + 1] == "14"
    assert ma.DEFAULT_WIDTH == 1440 and ma.canvas_for(ma.DEFAULT_WIDTH).height == 1080


def test_render_stills_tiny(points: tuple[Any, ...], tmp_path: Path) -> None:
    """A 160 px wide render of the stills: the buffer shape, the PNGs and timeline.json."""
    ma.setup_matplotlib()
    canvas = ma.canvas_for(160)
    assert (canvas.width, canvas.height) == (160, 120)
    sizes = ma.label_sizes(points, canvas)
    assert all(w > 0 and h > 0 for w, h in sizes.values())
    buf = ma.draw(ma.still_state(0.0, points, sizes), canvas)
    assert buf.shape == (120, 160, 4) and buf.dtype.name == "uint8"
    assert buf[0, 0].tolist() == [255, 255, 255, 255]  # white background
    code = ma.main(["--stills-only", "--out", str(tmp_path), "--width", "160"])
    assert code == 0
    for name, _ in ma.STILLS:
        assert (tmp_path / f"{name}.png").stat().st_size > 0
    info = json.loads((tmp_path / "timeline.json").read_text(encoding="utf-8"))
    assert {"fps", "width", "height", "stills", "renderSeconds", "timeline_s"} <= set(
        info
    )
    assert info["timeline_s"] == {"cut1": 3.0, "cut2": 7.5, "end": 13.5}
    assert not list(tmp_path.glob("*.mp4"))


def test_main_option_errors(tmp_path: Path) -> None:
    assert ma.main(["--stills-only", "--out", str(tmp_path), "--width", "1002"]) == 2
    assert ma.main(["--stills-only", "--out", str(tmp_path), "--fps", "0"]) == 2


def test_encoder_with_a_shell_sink(tmp_path: Path) -> None:
    enc = ma.Encoder(
        ["sh", "-c", "cat >/dev/null", str(tmp_path / "ok.mp4")], tmp_path / "ok.log"
    )
    enc.write(__import__("numpy").zeros((4, 4, 4), dtype="uint8"))
    enc.close()
    assert enc.proc.returncode == 0
    assert not (tmp_path / "ok.log").exists()  # the empty log is removed
    enc.close()  # a second close does nothing


def test_encoder_failure_gives_the_log_tail(tmp_path: Path) -> None:
    cmd = [
        "sh",
        "-c",
        "cat >/dev/null; echo boom >&2; exit 1",
        str(tmp_path / "bad.mp4"),
    ]
    enc = ma.Encoder(cmd, tmp_path / "bad.log")
    enc.write(__import__("numpy").zeros((4, 4, 4), dtype="uint8"))
    with pytest.raises(RuntimeError, match="code 1") as e:
        enc.close()
    assert "boom" in str(e.value)
    assert (tmp_path / "bad.log").read_text() == "boom\n"
    assert enc.log_file.closed


def test_encoder_abort_closes_the_log(tmp_path: Path) -> None:
    enc = ma.Encoder(
        ["sh", "-c", "sleep 30", str(tmp_path / "x.mp4")], tmp_path / "x.log"
    )
    enc.abort()
    assert enc.proc.returncode is not None and enc.log_file.closed


def test_square_axes_in_steps_1_and_2() -> None:
    """x and y have the same range in steps 1 and 2, and the axes box is square in pixels."""
    assert (ma.X_LO, ma.X_HI) == (400.0, 1600.0)
    assert (ma.Y_LO, ma.Y_TOP_1) == (ma.X_LO, ma.X_HI)
    c = ma.canvas_for(1080)
    _, _, w, h = ma.AXES_RECT
    assert w * c.width == pytest.approx(h * c.height)
    assert ma.LEGEND_X > ma.AXES_RECT[0] + w
    assert not hasattr(ma, "GUIDES")
