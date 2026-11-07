"""Foot-point occupancy heatmap (32 x 18 grid)."""

from __future__ import annotations

from ..geometry import Point
from ..schemas import HEATMAP_H, HEATMAP_W


class HeatmapAccumulator:
    """Accumulates foot points into a ``width x height`` grid (row-major, row 0 = top).

    Each track contributes at most one count per ``sample_sec`` so the result is roughly
    "person-seconds" and independent of the processing frame rate.
    """

    def __init__(self, width: int = HEATMAP_W, height: int = HEATMAP_H, sample_sec: float = 1.0) -> None:
        self.width = width
        self.height = height
        self.sample_sec = sample_sec
        self.grid = [0] * (width * height)
        self._last: dict[int, float] = {}
        self.window_start: float | None = None

    def add(self, track_id: int, foot: Point, t: float) -> None:
        if self.window_start is None:
            self.window_start = t
        last = self._last.get(track_id)
        if last is not None and t - last < self.sample_sec:
            return
        self._last[track_id] = t
        gx = min(self.width - 1, max(0, int(foot[0] * self.width)))
        gy = min(self.height - 1, max(0, int(foot[1] * self.height)))
        self.grid[gy * self.width + gx] += 1

    def total(self) -> int:
        return sum(self.grid)

    def due(self, t: float, interval_sec: float) -> bool:
        return self.window_start is not None and t - self.window_start >= interval_sec

    def flush(self) -> list[int]:
        """Return the grid and start a new window."""
        g = self.grid
        self.grid = [0] * (self.width * self.height)
        self._last.clear()
        self.window_start = None
        return g

    def end_track(self, track_id: int) -> None:
        self._last.pop(track_id, None)
