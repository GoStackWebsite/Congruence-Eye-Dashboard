"""ZONE_ENTER / ZONE_EXIT for polygon zones with presence debounce and dwell."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..geometry import Point, point_in_polygon


@dataclass(slots=True)
class ZoneTransition:
    zone_id: int
    track_id: int
    kind: str  # "ZONE_ENTER" | "ZONE_EXIT"
    t: float
    dwell_sec: float | None = None


@dataclass(slots=True)
class _Presence:
    first_in: float
    last_in: float
    confirmed: bool = False


@dataclass
class _Zone:
    zone_id: int
    polygon: list[Point]
    present: dict[int, _Presence] = field(default_factory=dict)


class ZoneTracker:
    """Tracks people inside polygon zones.

    * ZONE_ENTER is emitted once a track has been inside for ``min_presence_sec``; its timestamp is
      back-dated to the first frame inside.
    * ZONE_EXIT is emitted once the track has been outside for ``exit_grace_sec`` (or is lost);
      its timestamp is the last frame seen inside and ``dwell_sec`` = last_in - first_in.
    * Short visits below ``min_presence_sec`` emit nothing.
    """

    def __init__(
        self,
        zones: list[tuple[int, list[Point]]],
        min_presence_sec: float = 2.0,
        exit_grace_sec: float = 1.0,
    ) -> None:
        self.zones = [_Zone(zid, list(poly)) for zid, poly in zones]
        self.min_presence_sec = min_presence_sec
        self.exit_grace_sec = exit_grace_sec

    def update(self, track_id: int, foot: Point, t: float) -> list[ZoneTransition]:
        out: list[ZoneTransition] = []
        for z in self.zones:
            pres = z.present.get(track_id)
            if point_in_polygon(foot, z.polygon):
                if pres is None:
                    z.present[track_id] = pres = _Presence(first_in=t, last_in=t)
                pres.last_in = t
                if not pres.confirmed and t - pres.first_in >= self.min_presence_sec:
                    pres.confirmed = True
                    out.append(ZoneTransition(z.zone_id, track_id, "ZONE_ENTER", pres.first_in))
            elif pres is not None and t - pres.last_in >= self.exit_grace_sec:
                out.extend(self._close(z, track_id))
        return out

    def end_track(self, track_id: int, t: float) -> list[ZoneTransition]:
        out: list[ZoneTransition] = []
        for z in self.zones:
            if track_id in z.present:
                out.extend(self._close(z, track_id))
        return out

    def inside(self, zone_id: int) -> list[int]:
        """Track ids currently (confirmed or not) inside the zone."""
        for z in self.zones:
            if z.zone_id == zone_id:
                return list(z.present)
        return []

    @staticmethod
    def _close(z: _Zone, track_id: int) -> list[ZoneTransition]:
        pres = z.present.pop(track_id)
        if not pres.confirmed:
            return []
        dwell = round(max(0.0, pres.last_in - pres.first_in), 1)
        return [ZoneTransition(z.zone_id, track_id, "ZONE_EXIT", pres.last_in, dwell)]
