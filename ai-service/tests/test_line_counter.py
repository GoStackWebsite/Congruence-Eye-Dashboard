import pytest

from congruence_eye_ai.analytics.line_counter import LineCounter, StoreDwellTracker


def walk(lc: LineCounter, tid: int, ys: list[float], x: float = 0.5, t0: float = 0.0, dt: float = 0.2):
    out = []
    for i, y in enumerate(ys):
        out += lc.update(tid, (x, y), t0 + i * dt)
    return out


def ramp(a: float, b: float, n: int) -> list[float]:
    return [a + (b - a) * i / (n - 1) for i in range(n)]


@pytest.mark.parametrize("direction,entering_ys", [("UP", ramp(0.8, 0.2, 10)), ("DOWN", ramp(0.2, 0.8, 10))])
def test_horizontal_line_entry_and_exit(direction, entering_ys) -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.9, 0.5), direction)], margin=0.02, min_frames=2)
    c = walk(lc, 1, entering_ys)
    assert [x.kind for x in c] == ["ENTRY"]
    c = walk(lc, 2, list(reversed(entering_ys)), t0=10)
    assert [x.kind for x in c] == ["EXIT"]


@pytest.mark.parametrize("direction", ["LEFT", "RIGHT"])
def test_vertical_line(direction) -> None:
    lc = LineCounter([(7, (0.5, 0.0), (0.5, 1.0), direction)], margin=0.02, min_frames=2)
    xs = ramp(0.9, 0.1, 10) if direction == "LEFT" else ramp(0.1, 0.9, 10)
    out = []
    for i, x in enumerate(xs):
        out += lc.update(1, (x, 0.5), i * 0.2)
    assert [(c.zone_id, c.kind) for c in out] == [(7, "ENTRY")]


def test_jitter_around_line_is_ignored() -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.9, 0.5), "UP")], margin=0.02, min_frames=2)
    # starts clearly outside, then jitters inside the hysteresis band and single-frame spikes
    ys = [0.7, 0.7, 0.51, 0.49, 0.515, 0.485, 0.45, 0.6, 0.6, 0.49, 0.6, 0.6]
    assert walk(lc, 1, ys) == []


def test_single_frame_spike_needs_min_frames() -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.9, 0.5), "UP")], margin=0.02, min_frames=3)
    ys = [0.7, 0.7, 0.3, 0.3, 0.7, 0.7]  # only 2 frames on the other side
    assert walk(lc, 1, ys) == []
    ys = [0.3, 0.3, 0.3]  # now three in a row -> confirmed entry
    out = walk(lc, 1, ys, t0=5)
    assert [c.kind for c in out] == ["ENTRY"]


def test_back_and_forth_counts_both_ways_once_each() -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.9, 0.5), "UP")], margin=0.02, min_frames=2)
    ys = [0.8, 0.8, 0.3, 0.3, 0.3, 0.8, 0.8]
    assert [c.kind for c in walk(lc, 1, ys)] == ["ENTRY", "EXIT"]


def test_crossing_outside_line_extent_ignored() -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.4, 0.5), "UP")], margin=0.02, min_frames=2, extent_tolerance=0.05)
    assert walk(lc, 1, ramp(0.8, 0.2, 10), x=0.8) == []
    assert len(walk(lc, 2, ramp(0.8, 0.2, 10), x=0.25)) == 1


def test_first_observation_inside_does_not_count() -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.9, 0.5), "UP")])
    assert walk(lc, 1, [0.3, 0.3, 0.3, 0.2]) == []


def test_timestamp_is_confirmation_frame() -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.9, 0.5), "UP")], margin=0.02, min_frames=2)
    out = walk(lc, 1, [0.8, 0.8, 0.4, 0.4], t0=100.0, dt=1.0)
    assert out[0].t == 103.0


def test_end_track_forgets_state() -> None:
    lc = LineCounter([(1, (0.1, 0.5), (0.9, 0.5), "UP")])
    walk(lc, 1, [0.8, 0.8])
    lc.end_track(1)
    assert walk(lc, 1, [0.3, 0.3]) == []


def test_store_dwell_tracker() -> None:
    d = StoreDwellTracker(max_dwell_sec=3600)
    d.register_entry("v1", 100.0)
    assert d.occupancy() == 1
    assert d.dwell_for_exit("v1", 250.0) == 150.0
    assert d.dwell_for_exit("v1", 260.0) is None  # already closed
    d.register_entry("v2", 0.0)
    assert d.dwell_for_exit("v2", 7200.0) is None  # beyond max dwell
    assert d.dwell_for_exit("unknown", 1.0) is None
