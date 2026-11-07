"""ENTRY / EXIT counting on ENTRY_LINE zones, plus store dwell bookkeeping."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

from ..geometry import Point, in_side_sign, line_param, signed_distance


@dataclass(slots=True)
class Crossing:
    """A confirmed line crossing."""

    zone_id: int
    track_id: int
    kind: str  # "ENTRY" | "EXIT"
    t: float


@dataclass(slots=True)
class _TrackLineState:
    confirmed_side: int = 0  # -1 / +1 / 0 = unknown
    confirmed_point: Point | None = None
    candidate_side: int = 0
    candidate_frames: int = 0


@dataclass
class _Line:
    zone_id: int
    a: Point
    b: Point
    in_sign: int
    states: dict[int, _TrackLineState] = field(default_factory=dict)


class LineCounter:
    """Counts ENTRY/EXIT crossings with hysteresis and debounce.

    A point only counts as being on one side of a line once it is more than ``margin`` (normalised
    units) away from it, and the side is only *confirmed* after ``min_frames`` consecutive frames.
    A crossing is emitted when the confirmed side flips and the movement passes within the line
    segment's extent (with ``extent_tolerance``). Jitter around the line therefore produces nothing.
    """

    def __init__(
        self,
        lines: list[tuple[int, Point, Point, str]],
        margin: float = 0.015,
        min_frames: int = 2,
        extent_tolerance: float = 0.1,
    ) -> None:
        """``lines``: (zoneId, pointA, pointB, inDirection)."""
        self.margin = margin
        self.min_frames = max(1, min_frames)
        self.extent_tolerance = extent_tolerance
        self.lines = [_Line(zid, a, b, in_side_sign(a, b, d or "UP")) for zid, a, b, d in lines]

    def update(self, track_id: int, foot: Point, t: float) -> list[Crossing]:
        out: list[Crossing] = []
        for line in self.lines:
            st = line.states.setdefault(track_id, _TrackLineState())
            d = signed_distance(line.a, line.b, foot)
            if abs(d) <= self.margin:
                continue  # inside the hysteresis band: no information
            side = 1 if d > 0 else -1
            if st.confirmed_side == 0:
                # first clear observation: just learn which side the track starts on
                st.confirmed_side, st.confirmed_point = side, foot
                continue
            if st.confirmed_side == side:
                st.confirmed_point = foot
                st.candidate_side, st.candidate_frames = 0, 0
                continue
            if st.candidate_side == side:
                st.candidate_frames += 1
            else:
                st.candidate_side, st.candidate_frames = side, 1
            if st.candidate_frames < self.min_frames:
                continue
            prev_side, prev_point = st.confirmed_side, st.confirmed_point
            st.confirmed_side, st.confirmed_point = side, foot
            st.candidate_side, st.candidate_frames = 0, 0
            if prev_side == 0 or prev_point is None:
                continue  # first observation: just learn which side it is on
            u = line_param(line.a, line.b, prev_point, foot)
            if u is None or u < -self.extent_tolerance or u > 1 + self.extent_tolerance:
                continue  # walked past the end of the line
            kind = "ENTRY" if side == line.in_sign else "EXIT"
            out.append(Crossing(line.zone_id, track_id, kind, t))
        return out

    def end_track(self, track_id: int) -> None:
        for line in self.lines:
            line.states.pop(track_id, None)


class StoreDwellTracker:
    """Store-wide ENTRY->EXIT dwell per visitorId (shared across entrance cameras)."""

    def __init__(self, max_dwell_sec: float = 12 * 3600) -> None:
        self.max_dwell_sec = max_dwell_sec
        self._entries: dict[str, float] = {}
        self._lock = threading.Lock()

    def register_entry(self, visitor_id: str, t: float) -> None:
        with self._lock:
            self._entries[visitor_id] = t
            if len(self._entries) > 10000:
                self._purge(t)

    def dwell_for_exit(self, visitor_id: str, t: float) -> float | None:
        """Return dwell seconds for this visitor's open visit (and close it), else None."""
        with self._lock:
            t0 = self._entries.pop(visitor_id, None)
        if t0 is None or t < t0 or t - t0 > self.max_dwell_sec:
            return None
        return round(t - t0, 1)

    def occupancy(self) -> int:
        with self._lock:
            return len(self._entries)

    def _purge(self, now: float) -> None:
        for k in [k for k, v in self._entries.items() if now - v > self.max_dwell_sec]:
            del self._entries[k]
