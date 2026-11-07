"""Billing-queue length, wait-time estimation and counter attendance."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from ..geometry import Point, point_in_polygon


@dataclass(slots=True)
class QueueReading:
    """Point-in-time state of one queue zone (converted to a QueueSnapshot by the processor)."""

    zone_id: int
    t: float
    queue_length: int
    avg_wait_sec: float
    counter_staffed: bool


@dataclass(slots=True)
class UnattendedAlert:
    zone_id: int
    t: float
    queue_length: int
    unattended_sec: float


@dataclass
class _QueueZone:
    zone_id: int
    polygon: list[Point]
    first_in: dict[int, float] = field(default_factory=dict)  # track -> first time inside
    last_in: dict[int, float] = field(default_factory=dict)
    completed: deque[tuple[float, float]] = field(default_factory=lambda: deque(maxlen=50))
    unattended_since: float | None = None
    unattended_alerted: bool = False
    last_snapshot_t: float | None = None
    staffed: bool = False


class QueueMonitor:
    """Monitors QUEUE zones on one camera.

    Per frame call :meth:`update` with all (trackId, foot, isStaff) and whether the counter is
    staffed (a person is in the camera's STAFF_ONLY zone). Staff are never counted in the queue.

    * ``queue_length`` = non-staff people inside the polygon for at least ``min_presence_sec``.
    * ``avg_wait_sec`` = when the queue is non-empty, ``max(rolling average of completed waits in
      the last ``wait_window_sec``, longest current wait)``; 0 when the queue is empty.
    * :meth:`tick` returns a reading every ``snapshot_sec`` and an :class:`UnattendedAlert` once per
      episode when the queue is non-empty and the counter has not been staffed for
      ``unattended_sec``.
    """

    def __init__(
        self,
        zones: list[tuple[int, list[Point]]],
        min_presence_sec: float = 1.0,
        exit_grace_sec: float = 1.5,
        snapshot_sec: float = 30.0,
        unattended_sec: float = 60.0,
        wait_window_sec: float = 900.0,
    ) -> None:
        self.zones = [_QueueZone(zid, list(p)) for zid, p in zones]
        self.min_presence_sec = min_presence_sec
        self.exit_grace_sec = exit_grace_sec
        self.snapshot_sec = snapshot_sec
        self.unattended_sec = unattended_sec
        self.wait_window_sec = wait_window_sec

    def update(self, people: list[tuple[int, Point, bool]], counter_staffed: bool, t: float) -> None:
        for z in self.zones:
            z.staffed = counter_staffed
            for tid, foot, is_staff in people:
                if is_staff:
                    if tid in z.first_in:  # reclassified as staff: drop silently
                        z.first_in.pop(tid, None)
                        z.last_in.pop(tid, None)
                    continue
                if point_in_polygon(foot, z.polygon):
                    z.first_in.setdefault(tid, t)
                    z.last_in[tid] = t
            for tid in [k for k, v in z.last_in.items() if t - v >= self.exit_grace_sec]:
                self._complete(z, tid)
            self._update_unattended(z, t)

    def end_track(self, track_id: int, t: float) -> None:
        for z in self.zones:
            if track_id in z.first_in:
                self._complete(z, track_id)

    def _complete(self, z: _QueueZone, tid: int) -> None:
        t0 = z.first_in.pop(tid)
        t1 = z.last_in.pop(tid, t0)
        wait = t1 - t0
        if wait >= self.min_presence_sec:
            z.completed.append((t1, wait))

    def _length(self, z: _QueueZone, t: float) -> int:
        return sum(1 for tid, t0 in z.first_in.items() if z.last_in[tid] - t0 >= self.min_presence_sec)

    def _avg_wait(self, z: _QueueZone, t: float) -> float:
        length = self._length(z, t)
        if length == 0:
            return 0.0
        recent = [w for (tc, w) in z.completed if t - tc <= self.wait_window_sec]
        rolling = sum(recent) / len(recent) if recent else 0.0
        current_max = max(
            (z.last_in[tid] - t0 for tid, t0 in z.first_in.items() if z.last_in[tid] - t0 >= self.min_presence_sec),
            default=0.0,
        )
        return round(max(rolling, current_max), 1)

    def _update_unattended(self, z: _QueueZone, t: float) -> None:
        if self._length(z, t) > 0 and not z.staffed:
            if z.unattended_since is None:
                z.unattended_since = t
        else:
            z.unattended_since = None
            z.unattended_alerted = False

    def length(self, zone_id: int) -> int:
        """Current queue length of a zone."""
        for z in self.zones:
            if z.zone_id == zone_id:
                return self._length(z, 0.0)
        return 0

    def reading(self, zone_id: int, t: float) -> QueueReading:
        z = next(z for z in self.zones if z.zone_id == zone_id)
        return QueueReading(z.zone_id, t, self._length(z, t), self._avg_wait(z, t), z.staffed)

    def tick(self, t: float) -> tuple[list[QueueReading], list[UnattendedAlert]]:
        readings: list[QueueReading] = []
        alerts: list[UnattendedAlert] = []
        for z in self.zones:
            if z.last_snapshot_t is None or t - z.last_snapshot_t >= self.snapshot_sec:
                z.last_snapshot_t = t
                readings.append(self.reading(z.zone_id, t))
            if (
                z.unattended_since is not None
                and not z.unattended_alerted
                and t - z.unattended_since >= self.unattended_sec
            ):
                z.unattended_alerted = True
                alerts.append(UnattendedAlert(z.zone_id, t, self._length(z, t), round(t - z.unattended_since, 1)))
        return readings, alerts
