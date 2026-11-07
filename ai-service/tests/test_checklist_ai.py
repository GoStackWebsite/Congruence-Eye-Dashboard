"""AI-in-Checklist: reference match + uniform/grooming checks, library and HTTP endpoints."""

from __future__ import annotations

import base64
import json

import cv2
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from congruence_eye_ai.checklist.api import build_router
from congruence_eye_ai.checklist.common import decode_image, parse_hsv_ranges
from congruence_eye_ai.checklist.reference_match import NOT_CLEAR, NOT_FOUND, match_with_boxes, reference_match
from congruence_eye_ai.checklist.uniform_check import ID_ISSUE, UNIFORM_ISSUE, uniform_check
from congruence_eye_ai.config import DEFAULT_UNIFORM_HSV, Settings

from .synthetic import perspective, remove_poster, scene, staff_photo

POSTER = (820, 30, 1150, 250)  # x1, y1, x2, y2 in the 1200x800 reference
TEAL = tuple(int(x) for x in cv2.cvtColor(np.uint8([[[87, 200, 160]]]), cv2.COLOR_HSV2BGR)[0, 0])
RED = (30, 30, 200)


def jpeg(img: np.ndarray, q: int = 85) -> bytes:
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1].tobytes()


def rt(img: np.ndarray) -> np.ndarray:
    """JPEG round trip, like a real upload."""
    return decode_image(jpeg(img))


def annotated(res) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(base64.b64decode(res.annotatedJpegBase64), np.uint8), cv2.IMREAD_COLOR)


@pytest.fixture(scope="module")
def ref() -> np.ndarray:
    return scene()


# ----------------------------------------------------------------------------- reference match


def test_identical_and_reframed_photo_pass(ref) -> None:
    for img in (rt(ref), rt(np.clip(perspective(ref).astype(np.int16) + 15, 0, 255).astype(np.uint8))):
        r = reference_match(img, ref)
        assert r.status == "PASS" and r.score >= 0.75 and r.issues == []
        assert annotated(r).shape[1] == 800


def test_missing_poster_is_boxed(ref) -> None:
    sub = rt(remove_poster(ref))
    r, boxes = match_with_boxes(sub, ref)
    assert r.status == "FAIL" and r.message == NOT_FOUND and r.score <= 0.6
    assert len(r.issues) == 1 and r.issues[0].startswith(NOT_FOUND) and "top-right" in r.issues[0]
    assert reference_match(sub, ref) == r
    # the box covers the poster region (IoU with the true poster rectangle)
    (bx1, by1, bx2, by2), = boxes
    px1, py1, px2, py2 = POSTER[0] / 1200, POSTER[1] / 800, POSTER[2] / 1200, POSTER[3] / 800
    inter = max(0, min(bx2, px2) - max(bx1, px1)) * max(0, min(by2, py2) - max(by1, py1))
    union = (bx2 - bx1) * (by2 - by1) + (px2 - px1) * (py2 - py1) - inter
    assert inter / union > 0.6
    assert annotated(r).shape[:2] == (533, 800)


def test_missing_poster_under_perspective(ref) -> None:
    r = reference_match(rt(perspective(remove_poster(ref))), ref)
    assert r.status == "FAIL" and r.issues and "top-right" in r.issues[0]


def test_blurred_photo_not_clear(ref) -> None:
    r = reference_match(rt(cv2.GaussianBlur(ref, (0, 0), 6)), ref)
    assert (r.status, r.message, r.score) == ("FAIL", NOT_CLEAR, 0.0)
    assert "blurred" in r.issues[0]


def test_zoomed_and_far_photos_not_clear(ref) -> None:
    zoomed = rt(cv2.resize(ref[200:600, 300:900], (1200, 800)))
    r = reference_match(zoomed, ref)
    assert r.status == "FAIL" and r.message == NOT_CLEAR
    far = rt(cv2.copyMakeBorder(cv2.resize(ref, (400, 267)), 266, 267, 400, 400, cv2.BORDER_CONSTANT, value=(90, 90, 90)))
    r = reference_match(far, ref)
    assert r.status == "FAIL" and r.message == NOT_CLEAR and "too far" in r.issues[0]


def test_unrelated_photo_fails(ref) -> None:
    other = np.random.RandomState(3).randint(0, 255, (600, 900, 3)).astype(np.uint8)
    other = cv2.GaussianBlur(other, (3, 3), 0)
    r = reference_match(rt(other), ref)
    assert r.status == "FAIL" and r.score <= 0.6


def test_reference_match_is_deterministic(ref) -> None:
    sub = rt(perspective(remove_poster(ref)))
    a, b = reference_match(sub, ref), reference_match(sub, ref)
    assert a.model_dump() == b.model_dump()


# ----------------------------------------------------------------------------- uniform


def test_groomed_staff_passes() -> None:
    r = uniform_check(staff_photo(TEAL), DEFAULT_UNIFORM_HSV)
    assert (r.status, r.message, r.issues, r.score) == ("PASS", "Groomed", [], 1.0)


def test_wrong_colour_fails() -> None:
    r = uniform_check(staff_photo(RED), DEFAULT_UNIFORM_HSV)
    assert r.status == "FAIL" and r.message == "Not Groomed" and UNIFORM_ISSUE in r.issues
    assert ID_ISSUE not in r.issues  # the card is still found on a non-uniform shirt


def test_missing_id_fails_and_lanyard_counts() -> None:
    r = uniform_check(staff_photo(TEAL, card=False, lanyard=False), DEFAULT_UNIFORM_HSV)
    assert r.status == "FAIL" and r.issues == [ID_ISSUE] and r.score == 0.6
    assert uniform_check(staff_photo(TEAL, card=False, lanyard=True), DEFAULT_UNIFORM_HSV).status == "PASS"
    assert uniform_check(staff_photo(TEAL, card=True, lanyard=False), DEFAULT_UNIFORM_HSV).status == "PASS"


def test_custom_ranges_and_multiple_people() -> None:
    red_ranges = [((0, 120, 80), (8, 255, 255)), ((172, 120, 80), (179, 255, 255))]
    assert uniform_check(staff_photo(RED), red_ranges).status == "PASS"
    two = np.hstack([staff_photo(TEAL), staff_photo(RED)])
    det = lambda img: [(0.0, 0.0, 0.5, 1.0), (0.5, 0.0, 1.0, 1.0)]  # noqa: E731
    r = uniform_check(two, DEFAULT_UNIFORM_HSV, det)
    assert r.status == "FAIL" and r.issues == [f"Person 2: {UNIFORM_ISSUE}"]


def test_parse_hsv_ranges() -> None:
    assert parse_hsv_ranges(None) is None
    assert parse_hsv_ranges("[[80,120,60],[95,255,255]]") == [((80, 120, 60), (95, 255, 255))]
    assert parse_hsv_ranges('[[[0,1,2],[3,4,5]],[[6,7,8],[9,10,11]]]') == [((0, 1, 2), (3, 4, 5)), ((6, 7, 8), (9, 10, 11))]
    assert parse_hsv_ranges('{"lower":[1,2,3],"upper":[4,5,6]}') == [((1, 2, 3), (4, 5, 6))]
    with pytest.raises(ValueError):
        parse_hsv_ranges('"teal"')


# ----------------------------------------------------------------------------- HTTP endpoints


@pytest.fixture
def api(tmp_path) -> TestClient:
    app = FastAPI()
    app.include_router(build_router(Settings(_env_file=None, SPOOL_DIR=tmp_path), person_detector=None))  # type: ignore[call-arg]
    return TestClient(app)


def test_reference_match_endpoint(api: TestClient, ref) -> None:
    r = api.post("/ai/checklist/reference-match", files={"image": ("i.jpg", jpeg(remove_poster(ref)), "image/jpeg"), "reference": ("r.jpg", jpeg(ref), "image/jpeg")})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"status", "score", "message", "issues", "annotatedJpegBase64"}
    assert body["status"] == "FAIL" and body["message"] == NOT_FOUND and 0 <= body["score"] <= 1
    ok = api.post("/ai/checklist/reference-match", files={"image": ("i.png", cv2.imencode(".png", ref)[1].tobytes(), "image/png"), "reference": ("r.jpg", jpeg(ref), "image/jpeg")})
    assert ok.json()["status"] == "PASS"
    bad = api.post("/ai/checklist/reference-match", files={"image": ("i.jpg", b"not an image", "image/jpeg"), "reference": ("r.jpg", jpeg(ref), "image/jpeg")})
    assert bad.status_code == 422
    missing = api.post("/ai/checklist/reference-match", files={"image": ("i.jpg", jpeg(ref), "image/jpeg")})
    assert missing.status_code == 422


def test_uniform_endpoint(api: TestClient) -> None:
    r = api.post("/ai/checklist/uniform", files={"image": ("s.jpg", jpeg(staff_photo(TEAL)), "image/jpeg")})
    assert r.status_code == 200 and r.json()["status"] == "PASS" and r.json()["message"] == "Groomed"
    r = api.post("/ai/checklist/uniform", files={"image": ("s.jpg", jpeg(staff_photo(RED)), "image/jpeg")})
    assert r.json()["status"] == "FAIL" and UNIFORM_ISSUE in r.json()["issues"]
    red = json.dumps([[[0, 120, 80], [8, 255, 255]], [[172, 120, 80], [179, 255, 255]]])
    r = api.post("/ai/checklist/uniform", files={"image": ("s.jpg", jpeg(staff_photo(RED)), "image/jpeg")}, data={"uniformHsv": red})
    assert r.json()["status"] == "PASS"
    r = api.post("/ai/checklist/uniform", files={"image": ("s.jpg", jpeg(staff_photo(RED)), "image/jpeg")}, data={"uniformHsv": "nonsense"})
    assert r.status_code == 422
