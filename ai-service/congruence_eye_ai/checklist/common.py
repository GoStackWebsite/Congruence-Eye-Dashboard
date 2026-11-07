"""Shared helpers for the AI-in-Checklist endpoints."""

from __future__ import annotations

import base64
import json
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field


class AiCheckResult(BaseModel):
    """Contract v2 ``AiCheckResult``."""

    status: Literal["PASS", "FAIL"]
    score: float = Field(ge=0, le=1)
    message: str
    issues: list[str] = Field(default_factory=list)
    annotatedJpegBase64: str | None = None


class ImageDecodeError(ValueError):
    pass


def decode_image(data: bytes) -> np.ndarray:
    """JPEG/PNG/WebP bytes -> BGR uint8 image."""
    import cv2

    if not data:
        raise ImageDecodeError("empty image")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ImageDecodeError("unsupported or corrupt image")
    return img


def resize_max(img: np.ndarray, max_side: int) -> np.ndarray:
    import cv2

    h, w = img.shape[:2]
    s = max_side / max(h, w)
    if s >= 1.0:
        return img
    return cv2.resize(img, (max(1, int(round(w * s))), max(1, int(round(h * s)))), interpolation=cv2.INTER_AREA)


def jpeg_b64(img: np.ndarray, quality: int = 85) -> str:
    import cv2

    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:  # pragma: no cover
        raise RuntimeError("JPEG encoding failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def parse_hsv_ranges(raw: str | None) -> list[tuple[tuple[int, int, int], tuple[int, int, int]]] | None:
    """``[[h,s,v],[h,s,v]]`` (one range) or ``[[[..],[..]], ...]`` (several) -> list of ranges."""
    if not raw:
        return None
    v: Any = json.loads(raw)
    if isinstance(v, dict):
        v = [v.get("lower") or v.get("low"), v.get("upper") or v.get("high")]
    if not isinstance(v, list) or not v:
        raise ValueError("uniformHsv must be a JSON array")
    if isinstance(v[0], list) and v[0] and isinstance(v[0][0], (int, float)):
        v = [v]
    out = []
    for rng in v:
        lo, hi = rng
        out.append((tuple(int(x) for x in lo), tuple(int(x) for x in hi)))
    return out  # type: ignore[return-value]
