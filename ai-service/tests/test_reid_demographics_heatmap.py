import numpy as np
import pytest

from congruence_eye_ai.analytics.demographics import (
    DemographicsVoter,
    HintEstimator,
    NullEstimator,
    OpenCvAgeGenderEstimator,
    age_to_band,
    bucket_to_band,
    build_estimator,
)
from congruence_eye_ai.analytics.heatmap import HeatmapAccumulator
from congruence_eye_ai.analytics.reid import ReIdGallery, appearance_embedding, cosine, fallback_visitor_id

from .conftest import paint_person

BBOX = (0.4, 0.2, 0.6, 0.9)


def person_frame(shirt, pants, bg=110) -> np.ndarray:
    f = np.full((360, 640, 3), bg, np.uint8)
    paint_person(f, BBOX, shirt, pants)
    return f


RED, BLUE, GREEN, GREY = (30, 30, 200), (200, 60, 30), (40, 190, 40), (140, 140, 140)

# ----------------------------------------------------------------------------- re-id


def test_embedding_similarity() -> None:
    a = appearance_embedding(person_frame(RED, BLUE), BBOX)
    b = appearance_embedding(person_frame(RED, BLUE, bg=90), BBOX)
    c = appearance_embedding(person_frame(GREEN, GREY), BBOX)
    assert a is not None and b is not None and c is not None
    assert a.shape == (128,)
    assert cosine(a, b) > 0.98
    assert cosine(a, c) < 0.5
    assert appearance_embedding(person_frame(RED, BLUE), (0.5, 0.5, 0.501, 0.501)) is None


def test_gallery_matches_across_cameras() -> None:
    g = ReIdGallery(threshold=0.86, window_sec=3600, reentry_sec=300)
    red = appearance_embedding(person_frame(RED, BLUE), BBOX)
    green = appearance_embedding(person_frame(GREEN, GREY), BBOX)
    v1 = g.match_or_create(1, 5, "s", red, 0.0)
    v2 = g.match_or_create(1, 6, "s", green, 1.0)
    assert v1 != v2
    # same person seen on camera 2 -> same visitorId
    assert g.match_or_create(2, 1, "s", red, 30.0) == v1
    # while v1 is live on camera 1 (track 5) a *different* track on camera 1 cannot take it
    assert g.match_or_create(1, 7, "s", red, 31.0) != v1
    # once track 5 ended, the exit track on camera 1 matches again
    g.release(v1, 1, 5, 40.0)
    assert g.match_or_create(1, 8, "s", red, 60.0) == v1


def test_gallery_closed_and_window() -> None:
    g = ReIdGallery(threshold=0.86, window_sec=100, reentry_sec=10)
    red = appearance_embedding(person_frame(RED, BLUE), BBOX)
    v = g.match_or_create(1, 1, "s", red, 0.0)
    g.release(v, 1, 1, 1.0)
    g.close(v, 2.0)
    assert g.match_or_create(1, 2, "s", red, 5.0) == v  # quick re-entry
    g.release(v, 1, 2, 6.0)
    g.close(v, 6.0)
    assert g.match_or_create(1, 3, "s", red, 50.0) != v  # closed for too long -> new visitor
    assert len(g) == 2


def test_fallback_visitor_id_is_stable() -> None:
    a = fallback_visitor_id(3, "sess", 42)
    assert a == fallback_visitor_id(3, "sess", 42) and a.startswith("v-")
    assert a != fallback_visitor_id(3, "sess2", 42)
    g = ReIdGallery()
    assert g.match_or_create(3, 42, "sess", None, 0.0) == a


# ----------------------------------------------------------------------------- demographics


@pytest.mark.parametrize(
    "age,band",
    [(5, "0-17"), (17.9, "0-17"), (18, "18-24"), (24, "18-24"), (25, "25-34"), (40, "35-44"), (50, "45-54"), (55, "55+"), (90, "55+"), (None, "U"), (-1, "U")],
)
def test_age_to_band(age, band) -> None:
    assert age_to_band(age) == band


def test_levi_hassner_bucket_mapping() -> None:
    assert bucket_to_band("(0-2)") == "0-17"
    assert bucket_to_band("(15-20)") == "18-24"
    assert bucket_to_band("(25-32)") == "25-34"
    assert bucket_to_band("(60-100)") == "55+"
    assert bucket_to_band("???") == "U"


class _SeqEstimator:
    def __init__(self, seq):
        self.seq = list(seq)

    def estimate(self, frame, bbox, meta=None):
        return self.seq.pop(0) if self.seq else None


def test_majority_vote_ignores_unknowns() -> None:
    v = DemographicsVoter(_SeqEstimator([("F", "25-34"), ("M", "25-34"), ("F", "18-24"), ("U", "U"), ("F", "25-34")]), max_samples=5, every_n_frames=1)
    for _ in range(10):
        v.observe(1, None, BBOX)
    assert v.result(1) == ("F", "25-34")
    assert v.result(99) == ("U", "U")
    v.end_track(1)
    assert v.result(1) == ("U", "U")


def test_estimator_failures_do_not_crash() -> None:
    class Boom:
        def estimate(self, *a, **k):
            raise RuntimeError("boom")

    v = DemographicsVoter(Boom(), every_n_frames=1)
    v.observe(1, None, BBOX)
    assert v.result(1) == ("U", "U")


def test_hint_and_null_estimators(tmp_path) -> None:
    assert HintEstimator().estimate(None, BBOX, {"gender": "M", "ageBand": "35-44"}) == ("M", "35-44")
    assert HintEstimator().estimate(None, BBOX, {}) is None
    assert NullEstimator().estimate(None, BBOX) is None
    assert not OpenCvAgeGenderEstimator.available(tmp_path)
    assert isinstance(build_estimator(True, tmp_path), NullEstimator)
    assert isinstance(build_estimator(False, tmp_path), NullEstimator)


# ----------------------------------------------------------------------------- heatmap


def test_heatmap_grid_and_sampling() -> None:
    hm = HeatmapAccumulator(sample_sec=1.0)
    hm.add(1, (0.0, 0.0), 0.0)
    hm.add(1, (0.0, 0.0), 0.5)  # same second -> ignored
    hm.add(1, (0.99, 0.99), 1.0)
    hm.add(2, (1.0, 1.0), 1.0)  # clamped to last cell
    hm.add(3, (0.5, 0.5), 2.0)
    assert hm.total() == 4
    assert hm.grid[0] == 1
    assert hm.grid[32 * 18 - 1] == 2
    assert hm.grid[9 * 32 + 16] == 1
    assert not hm.due(100.0, 300) and hm.due(300.0, 300)
    g = hm.flush()
    assert len(g) == 576 and sum(g) == 4
    assert hm.total() == 0 and hm.window_start is None
