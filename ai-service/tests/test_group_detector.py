from congruence_eye_ai.analytics.group_detector import GroupDetector


def bbox(x: float) -> tuple[float, float, float, float]:
    return (x - 0.04, 0.3, x + 0.04, 0.6)


def test_people_entering_together_share_group() -> None:
    g = GroupDetector(window_sec=3.0, max_distance=0.2)
    g.add("a", 10.0, bbox(0.40))
    g.add("b", 11.0, bbox(0.48))
    g.add("c", 12.5, bbox(0.55))
    assert g.release(12.9) == []  # nothing old enough yet
    out = dict(g.release(16.0))
    assert out["a"] is not None and out["a"] == out["b"] == out["c"]
    assert out["a"].startswith("g-")


def test_far_apart_or_late_are_individuals() -> None:
    g = GroupDetector(window_sec=3.0, max_distance=0.2)
    g.add("a", 0.0, bbox(0.1))
    g.add("b", 1.0, bbox(0.9))  # too far
    g.add("c", 10.0, bbox(0.1))  # too late
    out = dict(g.release(20.0))
    assert out == {"a": None, "b": None, "c": None}


def test_two_separate_groups_get_different_ids() -> None:
    g = GroupDetector(window_sec=3.0, max_distance=0.2)
    g.add("a", 0.0, bbox(0.2))
    g.add("b", 0.5, bbox(0.25))
    g.add("c", 30.0, bbox(0.2))
    g.add("d", 30.5, bbox(0.25))
    out = dict(g.release(100.0))
    assert out["a"] == out["b"] and out["c"] == out["d"] and out["a"] != out["c"]


def test_force_release_and_pending() -> None:
    g = GroupDetector(window_sec=3.0)
    g.add("a", 0.0, bbox(0.2))
    assert g.pending("a")
    assert g.release(0.5, force_key="a") == [("a", None)]
    assert not g.pending("a")
    assert g.release(10.0) == []
