from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from congruence_eye_ai.config import Settings
from congruence_eye_ai.schemas import IngestConfig


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, SPOOL_DIR=tmp_path / "spool", ENABLE_DEMOGRAPHICS=True)  # type: ignore[call-arg]


@pytest.fixture
def store_config() -> IngestConfig:
    """One camera with every zone type (normalised coordinates)."""
    return IngestConfig.model_validate(
        {
            "store": {"id": 1, "code": "TNR", "name": "T Nagar", "timezone": "Asia/Kolkata", "openTime": "00:00", "closeTime": "23:59"},
            "cameras": [{"id": 10, "storeId": 1, "name": "Entrance", "type": "ENTRANCE", "rtspUrl": None, "isActive": True}],
            "zones": [
                {"id": 100, "cameraId": 10, "name": "Door", "type": "ENTRY_LINE", "polygon": [[0.0, 0.5], [0.5, 0.5]], "inDirection": "UP", "engagedDwellSec": 30},
                {"id": 101, "cameraId": 10, "name": "Promo", "type": "SECTION", "polygon": [[0.6, 0.1], [0.9, 0.1], [0.9, 0.4], [0.6, 0.4]], "engagedDwellSec": 30},
                {"id": 102, "cameraId": 10, "name": "Queue", "type": "QUEUE", "polygon": [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9], [0.6, 0.9]], "engagedDwellSec": 30},
                {"id": 103, "cameraId": 10, "name": "Cashier", "type": "STAFF_ONLY", "polygon": [[0.92, 0.6], [1.0, 0.6], [1.0, 0.9], [0.92, 0.9]], "engagedDwellSec": 30},
            ],
            "settings": {"engagedStoreDwellSec": 300, "bounceSec": 60},
        }
    )


def paint_person(frame: np.ndarray, bbox: tuple[float, float, float, float], shirt: tuple[int, int, int], pants: tuple[int, int, int]) -> None:
    """Paint a flat-coloured person into a BGR frame at a normalised bbox."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = int(bbox[0] * w), int(bbox[1] * h), int(bbox[2] * w), int(bbox[3] * h)
    ph = y2 - y1
    frame[y1 : y1 + int(ph * 0.15), x1:x2] = (90, 130, 190)
    frame[y1 + int(ph * 0.15) : y1 + int(ph * 0.55), x1:x2] = shirt
    frame[y1 + int(ph * 0.55) : y2, x1:x2] = pants
