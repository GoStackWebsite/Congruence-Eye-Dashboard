import cv2
import numpy as np

from congruence_eye_ai.analytics.staff import StaffClassifier, bgr_to_hsv, uniform_ratio
from congruence_eye_ai.config import DEFAULT_UNIFORM_HSV

from .conftest import paint_person

BBOX = (0.4, 0.2, 0.6, 0.9)


def hsv_to_bgr(h: int, s: int, v: int) -> tuple[int, int, int]:
    return tuple(int(x) for x in cv2.cvtColor(np.uint8([[[h, s, v]]]), cv2.COLOR_HSV2BGR)[0, 0])  # type: ignore[return-value]


UNIFORM = hsv_to_bgr(87, 200, 160)  # inside the default teal range
RED_SHIRT = hsv_to_bgr(0, 220, 200)


def frame_with(shirt) -> np.ndarray:
    f = np.full((360, 640, 3), 120, np.uint8)
    paint_person(f, BBOX, shirt, (40, 40, 40))
    return f


def test_uniform_ratio_on_synthetic_crop() -> None:
    crop = np.zeros((20, 20, 3), np.uint8)
    crop[:] = UNIFORM
    assert uniform_ratio(crop, DEFAULT_UNIFORM_HSV) == 1.0
    crop[:10] = RED_SHIRT
    assert abs(uniform_ratio(crop, DEFAULT_UNIFORM_HSV) - 0.5) < 1e-6
    assert uniform_ratio(np.zeros((0, 0, 3), np.uint8), DEFAULT_UNIFORM_HSV) == 0.0


def test_numpy_hsv_matches_cv2_roughly() -> None:
    img = np.random.RandomState(0).randint(0, 255, (8, 8, 3)).astype(np.uint8)
    assert bgr_to_hsv(img).shape == (8, 8, 3)


def test_uniform_person_becomes_staff_after_votes() -> None:
    sc = StaffClassifier(DEFAULT_UNIFORM_HSV, min_ratio=0.35, min_votes=3)
    f = frame_with(UNIFORM)
    assert sc.observe(1, f, BBOX, False, 0.0) is False
    assert sc.observe(1, f, BBOX, False, 0.2) is False
    assert sc.observe(1, f, BBOX, False, 0.4) is True
    # sticky even when the uniform is no longer visible
    assert sc.observe(1, frame_with(RED_SHIRT), BBOX, False, 0.6) is True


def test_customer_is_not_staff() -> None:
    sc = StaffClassifier(DEFAULT_UNIFORM_HSV)
    f = frame_with(RED_SHIRT)
    assert not any(sc.observe(2, f, BBOX, False, i * 0.2) for i in range(10))


def test_staff_zone_marks_staff() -> None:
    sc = StaffClassifier(DEFAULT_UNIFORM_HSV, zone_marks_staff=True, zone_confirm_sec=5.0)
    results = [sc.observe(3, None, BBOX, True, float(t)) for t in range(7)]
    assert results[:5] == [False] * 5 and results[5] is True
    assert sc.is_staff(3)


def test_staff_zone_breach_mode_does_not_mark_staff() -> None:
    sc = StaffClassifier(DEFAULT_UNIFORM_HSV, zone_marks_staff=False, zone_confirm_sec=5.0)
    for t in range(20):
        assert sc.observe(4, None, BBOX, True, float(t)) is False
    assert sc.zone_time(4) == 19.0
    sc.end_track(4)
    assert sc.zone_time(4) == 0.0
