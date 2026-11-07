"""Lightweight cross-camera re-identification for a single store.

The embedding is an L2-normalised HSV histogram of the torso and of the legs (128 dims). Identities
are matched by cosine similarity within a time window; when no appearance is available a stable
hash of ``<cameraId>-<session>-<trackId>`` is used instead.
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass

import numpy as np

from ..geometry import BBox
from .staff import bgr_to_hsv, crop

H_BINS = 16
S_BINS = 4
EMBED_DIM = 2 * H_BINS * S_BINS


def _hist(region_bgr: np.ndarray) -> np.ndarray:
    if region_bgr.size == 0:
        return np.zeros(H_BINS * S_BINS, dtype=np.float32)
    hsv = bgr_to_hsv(region_bgr).reshape(-1, 3)
    # ignore near-black / near-white low-saturation pixels for hue (background, shadows)
    h = hsv[:, 0].astype(np.int32) * H_BINS // 180
    s = hsv[:, 1].astype(np.int32) * S_BINS // 256
    v = hsv[:, 2]
    keep = v > 30
    idx = h[keep] * S_BINS + s[keep]
    hist = np.bincount(idx, minlength=H_BINS * S_BINS).astype(np.float32)
    return hist


def appearance_embedding(frame: np.ndarray, bbox: BBox) -> np.ndarray | None:
    """Torso + legs colour histogram embedding (L2 normalised) or None if the crop is too small."""
    torso = crop(frame, bbox, 0.15, 0.5, 0.2, 0.8)
    legs = crop(frame, bbox, 0.55, 0.95, 0.25, 0.75)
    if torso.size < 30 or legs.size < 30:
        return None
    vec = np.concatenate([_hist(torso), _hist(legs)])
    n = float(np.linalg.norm(vec))
    if n == 0:
        return None
    return vec / n


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def fallback_visitor_id(camera_id: int, session: str, track_id: int, prefix: str = "v") -> str:
    h = hashlib.sha1(f"{camera_id}-{session}-{track_id}".encode()).hexdigest()[:16]
    return f"{prefix}-{h}"


@dataclass
class _Identity:
    visitor_id: str
    embedding: np.ndarray
    last_seen: float
    closed_at: float | None = None  # set after an EXIT
    live: set[tuple[int, int]] | None = None  # (cameraId, trackId) currently bound


class ReIdGallery:
    """Thread-safe store-level gallery shared by all camera workers of a store."""

    def __init__(self, threshold: float = 0.86, window_sec: float = 7200.0, reentry_sec: float = 300.0) -> None:
        self.threshold = threshold
        self.window_sec = window_sec
        self.reentry_sec = reentry_sec
        self._ids: dict[str, _Identity] = {}
        self._lock = threading.Lock()

    def match_or_create(self, camera_id: int, track_id: int, session: str, embedding: np.ndarray | None, t: float) -> str:
        """Return a visitorId for this (camera, track), matching existing identities when possible."""
        key = (camera_id, track_id)
        with self._lock:
            if embedding is None:
                return fallback_visitor_id(camera_id, session, track_id)
            best: _Identity | None = None
            best_sim = self.threshold
            for ident in self._ids.values():
                if t - ident.last_seen > self.window_sec:
                    continue
                if ident.closed_at is not None and t - ident.closed_at > self.reentry_sec:
                    continue
                if ident.live and any(cam == camera_id for cam, _ in ident.live):
                    continue  # already visible as another person on this camera
                sim = cosine(ident.embedding, embedding)
                if sim >= best_sim:
                    best, best_sim = ident, sim
            if best is None:
                vid = fallback_visitor_id(camera_id, session, track_id)
                best = _Identity(vid, embedding.copy(), t, live=set())
                self._ids[vid] = best
            else:
                best.embedding = _ema(best.embedding, embedding, 0.3)
                best.last_seen = t
                best.closed_at = None
            assert best.live is not None
            best.live.add(key)
            if len(self._ids) > 20000:
                self._purge(t)
            return best.visitor_id

    def update(self, visitor_id: str, embedding: np.ndarray, t: float) -> None:
        with self._lock:
            ident = self._ids.get(visitor_id)
            if ident is not None:
                ident.embedding = _ema(ident.embedding, embedding, 0.1)
                ident.last_seen = t

    def release(self, visitor_id: str, camera_id: int, track_id: int, t: float) -> None:
        """The track bound to this identity ended."""
        with self._lock:
            ident = self._ids.get(visitor_id)
            if ident is not None and ident.live is not None:
                ident.live.discard((camera_id, track_id))
                ident.last_seen = max(ident.last_seen, t)

    def close(self, visitor_id: str, t: float) -> None:
        """The visitor left the store (EXIT): only re-matchable for ``reentry_sec``."""
        with self._lock:
            ident = self._ids.get(visitor_id)
            if ident is not None:
                ident.closed_at = t

    def __len__(self) -> int:
        return len(self._ids)

    def _purge(self, now: float) -> None:
        for k in [k for k, i in self._ids.items() if now - i.last_seen > self.window_sec and not i.live]:
            del self._ids[k]


def _ema(a: np.ndarray, b: np.ndarray, alpha: float) -> np.ndarray:
    v = (1 - alpha) * a + alpha * b
    n = float(np.linalg.norm(v))
    return v / n if n else v
