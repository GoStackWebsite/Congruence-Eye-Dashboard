"""Settings parsing, and a real YOLO detection test that runs only when weights are available."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from congruence_eye_ai.analytics.demographics import OpenCvAgeGenderEstimator
from congruence_eye_ai.config import Settings


def test_settings_from_env(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("BACKEND_URL", "http://backend:3000")
    monkeypatch.setenv("EDGE_API_KEY", "dev-edge-key-store-2")
    monkeypatch.setenv("CAMERA_SOURCE_OVERRIDES", '{"3": "/videos/entrance.mp4"}')
    monkeypatch.setenv("STAFF_UNIFORM_HSV", "[[[100, 120, 60], [120, 255, 255]]]")
    monkeypatch.setenv("ENABLE_DEMOGRAPHICS", "false")
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.BACKEND_URL == "http://backend:3000" and s.EDGE_API_KEY.endswith("store-2")
    assert s.CAMERA_SOURCE_OVERRIDES == {3: "/videos/entrance.mp4"}
    assert s.STAFF_UNIFORM_HSV == [((100, 120, 60), (120, 255, 255))]
    assert s.ENABLE_DEMOGRAPHICS is False
    monkeypatch.setenv("CAMERA_SOURCE_OVERRIDES", "1=rtsp://a/1, 2=/v/2.mp4")
    assert Settings(_env_file=None).CAMERA_SOURCE_OVERRIDES == {1: "rtsp://a/1", 2: "/v/2.mp4"}  # type: ignore[call-arg]
    monkeypatch.setenv("CAMERA_SOURCE_OVERRIDES", "")
    assert Settings(_env_file=None).CAMERA_SOURCE_OVERRIDES == {}  # type: ignore[call-arg]


def test_defaults() -> None:
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert (s.MODEL_PATH, s.CONF, s.DEVICE, s.HEARTBEAT_SEC, s.FLUSH_SEC, s.SNAPSHOT_SEC, s.HEATMAP_SEC) == ("yolo11n.pt", 0.35, "cpu", 30, 5, 60, 300)


# ----------------------------------------------------------------------------- real model


def _weights() -> Path | None:
    root = Path(__file__).resolve().parents[1]
    for cand in (os.environ.get("MODEL_PATH", ""), root / "models" / "yolo11n.pt", root / "models" / "yolov8n.pt", root / "yolo11n.pt"):
        if cand and Path(cand).is_file():
            return Path(cand)
    return None


def _bus_jpg() -> Path | None:
    try:
        from ultralytics.utils import ASSETS
    except Exception:
        return None
    p = Path(ASSETS) / "bus.jpg"
    return p if p.is_file() else None


requires_yolo = pytest.mark.skipif(_weights() is None or _bus_jpg() is None, reason="YOLO weights or ultralytics bus.jpg asset not available")


@requires_yolo
def test_yolo_detects_people_on_real_image() -> None:
    import cv2

    from congruence_eye_ai.detector import YoloDetector

    det = YoloDetector(str(_weights()), conf=0.35, device="cpu")
    img = cv2.imread(str(_bus_jpg()))
    found = det.detect(img)
    assert len(found) >= 1
    assert all(0.0 <= v <= 1.0 for t in found for v in t.bbox)
    # tracking API (ByteTrack) on consecutive frames keeps ids
    tracks1 = det.track(img, 0.0)
    tracks2 = det.track(img, 0.2)
    assert len(tracks1) >= 1 and {t.track_id for t in tracks1} & {t.track_id for t in tracks2}
    det.reset()


def _models_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "models"


@requires_yolo
@pytest.mark.skipif(
    not OpenCvAgeGenderEstimator.available(_models_dir()),
    reason="demographics models not downloaded (scripts/download_models.sh)",
)
def test_opencv_demographics_on_real_image() -> None:
    import cv2

    from congruence_eye_ai.detector import YoloDetector

    est = OpenCvAgeGenderEstimator(_models_dir())
    img = cv2.imread(str(_bus_jpg()))
    results = [est.estimate(img, t.bbox) for t in YoloDetector(str(_weights())).detect(img)]
    known = [r for r in results if r is not None]
    assert known, "expected at least one face-based estimate on bus.jpg"
    for g, band in known:
        assert g in ("M", "F") and band in ("0-17", "18-24", "25-34", "35-44", "45-54", "55+")
