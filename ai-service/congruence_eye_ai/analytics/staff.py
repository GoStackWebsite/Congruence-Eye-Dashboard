"""Staff identification: uniform colour on the torso and/or presence in STAFF_ONLY zones."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from ..geometry import BBox

HsvRange = tuple[tuple[int, int, int], tuple[int, int, int]]


def bgr_to_hsv(img: np.ndarray) -> np.ndarray:
    """BGR uint8 -> HSV uint8 in OpenCV convention (H 0..179). Uses cv2 when available."""
    try:
        import cv2

        return cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    except Exception:  # pragma: no cover - numpy fallback
        f = img.astype(np.float32) / 255.0
        b, g, r = f[..., 0], f[..., 1], f[..., 2]
        v = f.max(axis=-1)
        mn = f.min(axis=-1)
        d = v - mn
        s = np.where(v > 0, d / np.maximum(v, 1e-9), 0)
        h = np.zeros_like(v)
        dd = np.maximum(d, 1e-9)
        h = np.where(v == r, (60 * (g - b) / dd) % 360, h)
        h = np.where(v == g, 60 * (b - r) / dd + 120, h)
        h = np.where(v == b, 60 * (r - g) / dd + 240, h)
        h = np.where(d == 0, 0, h)
        return np.stack([(h / 2) % 180, s * 255, v * 255], axis=-1).astype(np.uint8)


def crop(frame: np.ndarray, bbox: BBox, y0: float = 0.0, y1: float = 1.0, x0: float = 0.0, x1: float = 1.0) -> np.ndarray:
    """Crop a sub-region of a normalised bbox (fractions relative to the bbox)."""
    h, w = frame.shape[:2]
    bx1, by1, bx2, by2 = bbox
    bw, bh = bx2 - bx1, by2 - by1
    px1 = int(max(0, (bx1 + bw * x0) * w))
    px2 = int(min(w, (bx1 + bw * x1) * w))
    py1 = int(max(0, (by1 + bh * y0) * h))
    py2 = int(min(h, (by1 + bh * y1) * h))
    if px2 <= px1 or py2 <= py1:
        return frame[0:0, 0:0]
    return frame[py1:py2, px1:px2]


def torso_crop(frame: np.ndarray, bbox: BBox) -> np.ndarray:
    return crop(frame, bbox, 0.2, 0.55, 0.2, 0.8)


def uniform_ratio(torso_bgr: np.ndarray, ranges: Sequence[HsvRange]) -> float:
    """Fraction of torso pixels inside any configured HSV range."""
    if torso_bgr.size == 0:
        return 0.0
    hsv = bgr_to_hsv(torso_bgr).reshape(-1, 3).astype(np.int16)
    mask = np.zeros(hsv.shape[0], dtype=bool)
    for lo, hi in ranges:
        lo_a, hi_a = np.array(lo, dtype=np.int16), np.array(hi, dtype=np.int16)
        mask |= np.all((hsv >= lo_a) & (hsv <= hi_a), axis=1)
    return float(mask.mean())


@dataclass(slots=True)
class _StaffState:
    votes_yes: int = 0
    votes_total: int = 0
    zone_time: float = 0.0
    last_zone_t: float | None = None
    is_staff: bool = False


class StaffClassifier:
    """Sticky per-track staff decision.

    * Uniform: each frame with a usable torso crop is a vote; a track becomes staff once it has at
      least ``min_votes`` positive votes and positives are >= 50 % of its votes.
    * Zone (when ``zone_marks_staff``): cumulative time in a STAFF_ONLY zone >= ``zone_confirm_sec``.

    Once staff, always staff for the lifetime of the track.
    """

    def __init__(
        self,
        uniform_ranges: Sequence[HsvRange],
        min_ratio: float = 0.35,
        min_votes: int = 3,
        zone_marks_staff: bool = True,
        zone_confirm_sec: float = 5.0,
    ) -> None:
        self.uniform_ranges = list(uniform_ranges)
        self.min_ratio = min_ratio
        self.min_votes = min_votes
        self.zone_marks_staff = zone_marks_staff
        self.zone_confirm_sec = zone_confirm_sec
        self._states: dict[int, _StaffState] = {}

    def observe(self, track_id: int, frame: np.ndarray | None, bbox: BBox, in_staff_zone: bool, t: float) -> bool:
        st = self._states.setdefault(track_id, _StaffState())
        if st.is_staff:
            return True
        if frame is not None and self.uniform_ranges:
            torso = torso_crop(frame, bbox)
            if torso.size >= 30:
                st.votes_total += 1
                if uniform_ratio(torso, self.uniform_ranges) >= self.min_ratio:
                    st.votes_yes += 1
                if st.votes_yes >= self.min_votes and st.votes_yes * 2 >= st.votes_total:
                    st.is_staff = True
        if in_staff_zone:
            if st.last_zone_t is not None:
                st.zone_time += max(0.0, t - st.last_zone_t)
            st.last_zone_t = t
            if self.zone_marks_staff and st.zone_time >= self.zone_confirm_sec:
                st.is_staff = True
        else:
            st.last_zone_t = None
        return st.is_staff

    def is_staff(self, track_id: int) -> bool:
        st = self._states.get(track_id)
        return bool(st and st.is_staff)

    def uniform_state(self, track_id: int) -> bool | None:
        """True = wears the uniform, False = enough frames seen without it, None = not enough evidence."""
        st = self._states.get(track_id)
        if st is None or st.votes_total < self.min_votes:
            return None
        return st.votes_yes * 2 >= st.votes_total

    def zone_time(self, track_id: int) -> float:
        st = self._states.get(track_id)
        return st.zone_time if st else 0.0

    def end_track(self, track_id: int) -> None:
        self._states.pop(track_id, None)
