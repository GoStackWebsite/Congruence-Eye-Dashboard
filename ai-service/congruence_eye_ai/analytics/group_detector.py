"""Groups: people entering together within a short time window and close to each other."""

from __future__ import annotations

import hashlib
import itertools
from dataclasses import dataclass, field

from ..geometry import BBox, bbox_center, distance


@dataclass
class _Entry:
    key: str
    t: float
    bbox: BBox
    released: bool = False
    group_id: str | None = None
    neighbours: set[str] = field(default_factory=set)


class GroupDetector:
    """Assigns a shared ``groupId`` to entries within ``window_sec`` whose bbox centres are within
    ``max_distance`` (normalised).

    Entries are held back for ``window_sec`` so that the *first* member of a group also receives
    the group id: call :meth:`add` when a (non-staff) ENTRY happens and :meth:`release` each frame;
    released entries come back as ``(key, groupId | None)``.
    """

    def __init__(self, window_sec: float = 3.0, max_distance: float = 0.2, prefix: str = "g") -> None:
        self.window_sec = window_sec
        self.max_distance = max_distance
        self.prefix = prefix
        self._entries: dict[str, _Entry] = {}
        self._counter = itertools.count(1)

    def add(self, key: str, t: float, bbox: BBox) -> None:
        e = _Entry(key, t, bbox)
        c = bbox_center(bbox)
        for other in self._entries.values():
            if abs(other.t - t) <= self.window_sec and distance(c, bbox_center(other.bbox)) <= self.max_distance:
                e.neighbours.add(other.key)
                other.neighbours.add(key)
        self._entries[key] = e

    def pending(self, key: str) -> bool:
        e = self._entries.get(key)
        return e is not None and not e.released

    def release(self, now: float, force_key: str | None = None) -> list[tuple[str, str | None]]:
        """Release entries older than the window (or ``force_key`` immediately)."""
        out: list[tuple[str, str | None]] = []
        for e in sorted(self._entries.values(), key=lambda e: e.t):
            if e.released or not (now - e.t >= self.window_sec or e.key == force_key):
                continue
            e.released = True
            if e.neighbours:
                gid = next(
                    (self._entries[n].group_id for n in e.neighbours if n in self._entries and self._entries[n].group_id),
                    None,
                )
                if gid is None:
                    gid = self._new_id(e)
                e.group_id = gid
                for n in e.neighbours:
                    if n in self._entries and self._entries[n].group_id is None:
                        self._entries[n].group_id = gid
            out.append((e.key, e.group_id))
        # garbage-collect entries that can no longer influence anyone
        for k in [k for k, e in self._entries.items() if e.released and now - e.t > 3 * self.window_sec]:
            del self._entries[k]
        return out

    def _new_id(self, e: _Entry) -> str:
        h = hashlib.sha1(f"{e.key}:{e.t}:{next(self._counter)}".encode()).hexdigest()[:10]
        return f"{self.prefix}-{h}"
