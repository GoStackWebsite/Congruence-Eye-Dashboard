"""Optional age-band / gender estimation (plugin interface + OpenCV DNN implementation)."""

from __future__ import annotations

import logging
from collections import Counter
from pathlib import Path
from typing import Protocol, runtime_checkable

import numpy as np

from ..geometry import BBox
from .staff import crop

log = logging.getLogger(__name__)

UNKNOWN: tuple[str, str] = ("U", "U")

#: Levi & Hassner (2015) age buckets -> contract age bands.
LEVI_HASSNER_BUCKETS = ["(0-2)", "(4-6)", "(8-12)", "(15-20)", "(25-32)", "(38-43)", "(48-53)", "(60-100)"]
_BUCKET_TO_BAND = {
    "(0-2)": "0-17",
    "(4-6)": "0-17",
    "(8-12)": "0-17",
    "(15-20)": "18-24",
    "(25-32)": "25-34",
    "(38-43)": "35-44",
    "(48-53)": "45-54",
    "(60-100)": "55+",
}


def age_to_band(age: float | None) -> str:
    """Numeric age -> contract age band."""
    if age is None or age < 0:
        return "U"
    if age < 18:
        return "0-17"
    if age < 25:
        return "18-24"
    if age < 35:
        return "25-34"
    if age < 45:
        return "35-44"
    if age < 55:
        return "45-54"
    return "55+"


def bucket_to_band(bucket: str) -> str:
    return _BUCKET_TO_BAND.get(bucket, "U")


@runtime_checkable
class AgeGenderEstimator(Protocol):
    """Estimate (gender "M"/"F"/"U", ageBand) for a person crop. Return None if not estimable."""

    def estimate(self, frame: np.ndarray | None, bbox: BBox, meta: dict | None = None) -> tuple[str, str] | None: ...


class NullEstimator:
    """Always unknown."""

    def estimate(self, frame: np.ndarray | None, bbox: BBox, meta: dict | None = None) -> tuple[str, str] | None:
        return None


class HintEstimator:
    """Reads ``meta['gender']`` / ``meta['ageBand']`` set by the simulator's scripted detector."""

    def estimate(self, frame: np.ndarray | None, bbox: BBox, meta: dict | None = None) -> tuple[str, str] | None:
        if not meta or "gender" not in meta:
            return None
        return meta.get("gender", "U"), meta.get("ageBand", "U")


class OpenCvAgeGenderEstimator:
    """Levi-Hassner Caffe age/gender nets + OpenCV SSD face detector (CPU friendly).

    Expected files in ``models_dir`` (fetched by ``scripts/download_models.sh``):
    ``opencv_face_detector.pbtxt``, ``opencv_face_detector_uint8.pb``, ``age_deploy.prototxt``,
    ``age_net.caffemodel``, ``gender_deploy.prototxt``, ``gender_net.caffemodel``.
    """

    MEAN = (78.4263377603, 87.7689143744, 114.895847746)
    FILES = (
        "opencv_face_detector.pbtxt",
        "opencv_face_detector_uint8.pb",
        "age_deploy.prototxt",
        "age_net.caffemodel",
        "gender_deploy.prototxt",
        "gender_net.caffemodel",
    )

    def __init__(self, models_dir: Path, face_conf: float = 0.6) -> None:
        import cv2

        self.cv2 = cv2
        d = Path(models_dir)
        self.face_net = cv2.dnn.readNet(str(d / "opencv_face_detector_uint8.pb"), str(d / "opencv_face_detector.pbtxt"))
        self.age_net = cv2.dnn.readNet(str(d / "age_net.caffemodel"), str(d / "age_deploy.prototxt"))
        self.gender_net = cv2.dnn.readNet(str(d / "gender_net.caffemodel"), str(d / "gender_deploy.prototxt"))
        self.face_conf = face_conf

    @classmethod
    def available(cls, models_dir: Path) -> bool:
        return all((Path(models_dir) / f).is_file() and (Path(models_dir) / f).stat().st_size > 0 for f in cls.FILES)

    def estimate(self, frame: np.ndarray | None, bbox: BBox, meta: dict | None = None) -> tuple[str, str] | None:
        if frame is None:
            return None
        cv2 = self.cv2
        head = crop(frame, bbox, 0.0, 0.45, 0.0, 1.0)
        if head.shape[0] < 40 or head.shape[1] < 30:
            return None
        hh, hw = head.shape[:2]
        blob = cv2.dnn.blobFromImage(head, 1.0, (300, 300), (104, 117, 123), swapRB=False)
        self.face_net.setInput(blob)
        det = self.face_net.forward()
        best = None
        for i in range(det.shape[2]):
            c = float(det[0, 0, i, 2])
            if c >= self.face_conf and (best is None or c > best[0]):
                best = (c, det[0, 0, i, 3:7])
        if best is None:
            return None
        x1, y1, x2, y2 = (best[1] * np.array([hw, hh, hw, hh])).astype(int)
        pad = 10
        face = head[max(0, y1 - pad) : min(hh, y2 + pad), max(0, x1 - pad) : min(hw, x2 + pad)]
        if face.size == 0 or face.shape[0] < 20 or face.shape[1] < 20:
            return None
        fb = cv2.dnn.blobFromImage(face, 1.0, (227, 227), self.MEAN, swapRB=False)
        self.gender_net.setInput(fb)
        g = self.gender_net.forward()[0]
        self.age_net.setInput(fb)
        a = self.age_net.forward()[0]
        gender = "M" if g[0] >= g[1] else "F"
        return gender, bucket_to_band(LEVI_HASSNER_BUCKETS[int(np.argmax(a))])


class DemographicsVoter:
    """Majority vote of per-frame estimates for each track (bounded number of samples)."""

    def __init__(self, estimator: AgeGenderEstimator, max_samples: int = 5, every_n_frames: int = 3) -> None:
        self.estimator = estimator
        self.max_samples = max_samples
        self.every_n_frames = every_n_frames
        self._g: dict[int, Counter[str]] = {}
        self._a: dict[int, Counter[str]] = {}
        self._frames: dict[int, int] = {}

    def observe(self, track_id: int, frame: np.ndarray | None, bbox: BBox, meta: dict | None = None) -> None:
        n = self._frames.get(track_id, 0)
        self._frames[track_id] = n + 1
        g = self._g.setdefault(track_id, Counter())
        if sum(g.values()) >= self.max_samples or n % self.every_n_frames:
            return
        try:
            res = self.estimator.estimate(frame, bbox, meta)
        except Exception as exc:  # never let a plugin crash the pipeline
            log.debug("demographics estimator failed: %s", exc)
            return
        if res is None:
            return
        gender, band = res
        g[gender] += 1
        self._a.setdefault(track_id, Counter())[band] += 1

    def result(self, track_id: int) -> tuple[str, str]:
        g = self._g.get(track_id)
        a = self._a.get(track_id)
        gender = _majority(g) if g else "U"
        band = _majority(a) if a else "U"
        return gender, band

    def end_track(self, track_id: int) -> None:
        self._g.pop(track_id, None)
        self._a.pop(track_id, None)
        self._frames.pop(track_id, None)


def _majority(c: Counter[str]) -> str:
    known = Counter({k: v for k, v in c.items() if k != "U"})
    if not known:
        return "U"
    return known.most_common(1)[0][0]


def build_estimator(enabled: bool, models_dir: Path) -> AgeGenderEstimator:
    """OpenCV DNN estimator when enabled and model files exist, else NullEstimator."""
    if not enabled:
        return NullEstimator()
    if OpenCvAgeGenderEstimator.available(models_dir):
        try:
            est = OpenCvAgeGenderEstimator(models_dir)
            log.info("Demographics: OpenCV DNN age/gender models loaded from %s", models_dir)
            return est
        except Exception as exc:
            log.warning("Demographics models failed to load (%s); using unknown", exc)
    else:
        log.info("Demographics models not found in %s; age/gender will be 'U'", models_dir)
    return NullEstimator()
