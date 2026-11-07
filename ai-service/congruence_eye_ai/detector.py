"""Person detection + multi-object tracking.

``Detector`` is a Protocol so the YOLO implementation can be swapped for ``FakeDetector`` /
``ScriptedDetector`` in tests and in the simulator.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import numpy as np

from .geometry import BBox, Point, foot_point, normalize_bbox

log = logging.getLogger(__name__)


@dataclass(slots=True)
class Track:
    """One tracked person in one frame. ``bbox`` is normalised (0..1)."""

    track_id: int
    bbox: BBox
    conf: float = 1.0
    meta: dict[str, Any] = field(default_factory=dict)
    cls: int = 0  # COCO class: 0 = person, 67 = cell phone

    @property
    def foot(self) -> Point:
        return foot_point(self.bbox)

    def pixel_bbox(self, width: int, height: int) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = self.bbox
        return (
            int(max(0, min(width - 1, x1 * width))),
            int(max(0, min(height - 1, y1 * height))),
            int(max(0, min(width, x2 * width))),
            int(max(0, min(height, y2 * height))),
        )


@runtime_checkable
class Detector(Protocol):
    """Detect and track people in a frame."""

    def track(self, frame: np.ndarray | None, t: float) -> list[Track]:
        """Return the tracks visible in ``frame`` captured at epoch time ``t``."""
        ...

    def reset(self) -> None:
        """Forget tracker state (e.g. after a stream reconnect)."""
        ...


class YoloDetector:
    """Ultralytics YOLO (v8/11) + ByteTrack, restricted to the COCO ``person`` class."""

    def __init__(
        self,
        model_path: str = "yolo11n.pt",
        conf: float = 0.35,
        iou: float = 0.5,
        device: str = "cpu",
        imgsz: int = 640,
        tracker: str = "bytetrack.yaml",
        extra_classes: Sequence[int] = (),
        extra_conf: float = 0.25,
    ) -> None:
        from ultralytics import YOLO  # heavy import, deferred

        self.model_path = model_path
        self.model = YOLO(model_path)
        self.conf = conf
        self.iou = iou
        self.device = device
        self.imgsz = imgsz
        self.tracker = tracker
        self.classes = [0, *[c for c in extra_classes if c != 0]]
        self.extra_conf = extra_conf

    def track(self, frame: np.ndarray | None, t: float) -> list[Track]:
        if frame is None:
            return []
        h, w = frame.shape[:2]
        results = self.model.track(
            frame,
            persist=True,
            tracker=self.tracker,
            classes=self.classes,
            conf=min(self.conf, self.extra_conf) if len(self.classes) > 1 else self.conf,
            iou=self.iou,
            device=self.device,
            imgsz=self.imgsz,
            verbose=False,
        )
        return [t for t in self._to_tracks(results, w, h) if t.cls != 0 or t.conf >= self.conf]

    def detect(self, frame: np.ndarray) -> list[Track]:
        """Plain detection without tracking (track ids are indexes)."""
        h, w = frame.shape[:2]
        results = self.model.predict(
            frame, classes=[0], conf=self.conf, device=self.device, imgsz=self.imgsz, verbose=False
        )
        out: list[Track] = []
        if not results or results[0].boxes is None:
            return out
        boxes = results[0].boxes
        for i, (xyxy, c) in enumerate(zip(boxes.xyxy.cpu().numpy(), boxes.conf.cpu().numpy())):
            out.append(Track(track_id=i, bbox=normalize_bbox(xyxy, w, h), conf=float(c)))
        return out

    @staticmethod
    def _to_tracks(results: Sequence[Any], w: int, h: int) -> list[Track]:
        if not results:
            return []
        boxes = results[0].boxes
        if boxes is None or boxes.id is None:
            return []
        xyxy = boxes.xyxy.cpu().numpy()
        ids = boxes.id.int().cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.int().cpu().numpy() if boxes.cls is not None else [0] * len(ids)
        return [
            Track(track_id=int(i), bbox=normalize_bbox(b, w, h), conf=float(c), cls=int(k))
            for b, i, c, k in zip(xyxy, ids, confs, clss)
        ]

    def detect_objects(self, frame: np.ndarray, classes: Sequence[int], conf: float | None = None) -> list[Track]:
        """Detection of arbitrary COCO classes (no tracking)."""
        h, w = frame.shape[:2]
        results = self.model.predict(frame, classes=list(classes), conf=conf or self.conf, device=self.device, imgsz=self.imgsz, verbose=False)
        out: list[Track] = []
        if not results or results[0].boxes is None:
            return out
        b = results[0].boxes
        for i, (xyxy, c, k) in enumerate(zip(b.xyxy.cpu().numpy(), b.conf.cpu().numpy(), b.cls.int().cpu().numpy())):
            out.append(Track(track_id=i, bbox=normalize_bbox(xyxy, w, h), conf=float(c), cls=int(k)))
        return out

    def reset(self) -> None:
        predictor = getattr(self.model, "predictor", None)
        if predictor is not None and getattr(predictor, "trackers", None):
            for tr in predictor.trackers:
                tr.reset()


class FakeDetector:
    """Replays a pre-scripted list of per-frame track lists (for unit tests)."""

    def __init__(self, frames: Iterable[list[Track]]) -> None:
        self._frames = iter(frames)

    def track(self, frame: np.ndarray | None, t: float) -> list[Track]:
        return next(self._frames, [])

    def reset(self) -> None:
        pass


class ScriptedDetector:
    """Calls ``fn(t)`` to obtain ground-truth tracks (used by the simulator)."""

    def __init__(self, fn: Callable[[float], list[Track]]) -> None:
        self.fn = fn

    def track(self, frame: np.ndarray | None, t: float) -> list[Track]:
        return self.fn(t)

    def reset(self) -> None:
        pass


def build_detector(settings: Any, extra_classes: Sequence[int] = ()) -> Detector:
    """Create the production detector from settings (``extra_classes`` e.g. [67] for phones)."""
    return YoloDetector(
        extra_classes=extra_classes,
        extra_conf=getattr(settings, "PHONE_CONF", 0.25),
        model_path=settings.MODEL_PATH,
        conf=settings.CONF,
        iou=settings.IOU,
        device=settings.DEVICE,
        imgsz=settings.IMGSZ,
        tracker=settings.TRACKER,
    )
