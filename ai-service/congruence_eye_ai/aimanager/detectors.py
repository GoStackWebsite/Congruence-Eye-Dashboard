"""Per-camera AI Manager detectors (pure logic; frames only needed for STOCK_OUT).

Every detector is driven by a :class:`RuleSpec` (schedule, detection areas, params). Instant
detectors (MOBILE_USAGE, UNATTENDED_CUSTOMER, UNIFORM_COMPLIANCE, STOCK_OUT, QUEUE_BREACH) emit one
BREACHED finding per incident; window detectors (HYGIENE_CLEANING, HUDDLE_MEETING) report to the
store-level :class:`StoreAiManager`, which emits one COMPLIED/BREACHED per store per window.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from ..geometry import BBox, Point, distance, point_in_polygon
from ..schemas import Zone
from .rules import RuleSpec
from .shelf import ShelfReferenceStore, cell_densities, compare, occluded_cells, shelf_cells

RED = (0, 0, 255)
GREEN = (0, 200, 0)
AMBER = (0, 170, 255)

PHONE_CLASS = 67  # COCO "cell phone"
GAP_SEC = 3.0  # tolerated detection gaps inside one continuous incident
HYGIENE_GRID = (16, 9)


@dataclass(slots=True)
class PersonObs:
    track_id: int
    bbox: BBox
    foot: Point
    is_staff: bool
    uniform: bool | None = None  # True = uniform seen, False = no uniform, None = unknown


@dataclass
class Finding:
    """Something the AI Manager wants reported (a detection and/or a snapshot)."""

    rule: RuleSpec
    camera_id: int
    t: float
    status: str | None  # "BREACHED" | "COMPLIED" | None (snapshot only, e.g. shelf reference)
    details: str
    zone_id: int | None = None
    confidence: float | None = None
    boxes: list[tuple[BBox, str, tuple[int, int, int]]] = field(default_factory=list)
    fills: list[tuple[BBox, tuple[int, int, int]]] = field(default_factory=list)
    snapshot_kind: str = "AI_MANAGER"


def _fmt_dur(sec: float) -> str:
    sec = int(round(sec))
    return f"{sec // 60}m {sec % 60:02d}s" if sec >= 60 else f"{sec}s"


def _inter(a: BBox, b: BBox) -> float:
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def _area(b: BBox) -> float:
    return max(1e-9, (b[2] - b[0]) * (b[3] - b[1]))


def upper_body_region(b: BBox) -> BBox:
    """Region where a hand-held phone appears: full width + 15 % each side, top 75 % of height."""
    w, h = b[2] - b[0], b[3] - b[1]
    return (b[0] - 0.15 * w, b[1], b[2] + 0.15 * w, b[1] + 0.75 * h)


class _Detector:
    instant = True

    def __init__(self, rule: RuleSpec, camera_id: int, areas: list[tuple[int, list[Point]]] | None) -> None:
        self.rule = rule
        self.camera_id = camera_id
        self.areas = areas  # None = whole frame

    def area_of(self, p: Point) -> tuple[bool, int | None]:
        if self.areas is None:
            return True, None
        for zid, poly in self.areas:
            if point_in_polygon(p, poly):
                return True, zid
        return False, None

    def finding(self, t: float, status: str | None, details: str, **kw: Any) -> Finding:
        return Finding(self.rule, self.camera_id, t, status, details, **kw)


# ----------------------------------------------------------------------------- instant detectors


class MobileUsageDetector(_Detector):
    """Phone (COCO class 67) overlapping a person's upper body/hands for >= minDurationSec."""

    def __init__(self, *a: Any) -> None:
        super().__init__(*a)
        self.state: dict[int, list[Any]] = {}  # tid -> [since, last_phone, fired, last_seen]

    def update(self, t: float, people: Sequence[PersonObs], phones: Sequence[Any], **_: Any) -> list[Finding]:
        min_dur = self.rule.pf("minDurationSec", 20)
        staff_only = self.rule.pb("staffOnly", True)
        out: list[Finding] = []
        for p in people:
            if staff_only and not p.is_staff:
                continue
            ok, zid = self.area_of(p.foot)
            if not ok:
                continue
            st = self.state.setdefault(p.track_id, [None, None, False, t])
            st[3] = t
            ph = best_phone(p.bbox, phones)
            if ph is None:
                continue
            if st[0] is None or t - st[1] > GAP_SEC:
                st[0] = t
            st[1] = t
            if not st[2] and t - st[0] >= min_dur:
                st[2] = True
                who = "Staff member" if p.is_staff else "Person"
                out.append(
                    self.finding(
                        t, "BREACHED", f"{who} using a mobile phone for {_fmt_dur(t - st[0])}", zone_id=zid,
                        confidence=round(float(ph.conf), 2),
                        boxes=[(p.bbox, "Mobile phone usage", RED), (ph.bbox, "Phone", AMBER)],
                    )
                )
        for tid in [k for k, v in self.state.items() if t - v[3] > 30]:
            del self.state[tid]
        return out


def best_phone(person: BBox, phones: Sequence[Any]) -> Any | None:
    region = upper_body_region(person)
    best, best_score = None, 0.0
    for ph in phones:
        ov = _inter(region, ph.bbox) / _area(ph.bbox)
        if ov >= 0.5 and ov * ph.conf > best_score:
            best, best_score = ph, ov * ph.conf
    return best


class UnattendedCustomerDetector(_Detector):
    """Non-staff person in the area with no staff within ``staffRadius`` for >= minDurationSec.

    People standing in a QUEUE zone are excluded (billing queues are covered by QUEUE_BREACH).
    """

    def __init__(self, rule: RuleSpec, camera_id: int, areas: list[tuple[int, list[Point]]] | None, queue_polys: Sequence[Sequence[Point]] = ()) -> None:
        super().__init__(rule, camera_id, areas)
        self.queue_polys = [list(q) for q in queue_polys]
        self.state: dict[int, list[Any]] = {}  # tid -> [since, last, fired]

    def update(self, t: float, people: Sequence[PersonObs], **_: Any) -> list[Finding]:
        min_dur = self.rule.pf("minDurationSec", 120)
        radius = self.rule.pf("staffRadius", 0.15)
        staff = [p for p in people if p.is_staff]
        out: list[Finding] = []
        for p in people:
            if p.is_staff:
                continue
            ok, zid = self.area_of(p.foot)
            st = self.state.setdefault(p.track_id, [None, t, False])
            gap = t - st[1]
            st[1] = t
            in_queue = any(point_in_polygon(p.foot, q) for q in self.queue_polys)
            if not ok or in_queue or any(distance(p.foot, s.foot) <= radius for s in staff):
                st[0] = None
                continue
            if st[0] is None or gap > GAP_SEC:
                st[0] = t
            if not st[2] and t - st[0] >= min_dur:
                st[2] = True
                boxes = [(p.bbox, f"Unattended customer {_fmt_dur(t - st[0])}", RED)]
                boxes += [(s.bbox, "Staff", GREEN) for s in staff]
                out.append(self.finding(t, "BREACHED", f"Customer unattended for {_fmt_dur(t - st[0])} (no staff within {radius:g})", zone_id=zid, confidence=0.9, boxes=boxes))
        for tid in [k for k, v in self.state.items() if t - v[1] > 30]:
            del self.state[tid]
        return out


class UniformComplianceDetector(_Detector):
    """Person in a STAFF_ONLY area (or the rule's areas) without uniform for >= minNonCompliantSec."""

    def __init__(self, *a: Any) -> None:
        super().__init__(*a)
        self.state: dict[int, list[Any]] = {}  # tid -> [accum, last, fired, last_seen]

    def update(self, t: float, people: Sequence[PersonObs], **_: Any) -> list[Finding]:
        need = self.rule.pf("minNonCompliantSec", 60)
        out: list[Finding] = []
        for p in people:
            ok, zid = self.area_of(p.foot)
            st = self.state.setdefault(p.track_id, [0.0, None, False, t])
            st[3] = t
            if p.uniform is True:
                st[0], st[1] = 0.0, None  # uniform seen: compliant
                continue
            if not ok or p.uniform is None:
                continue  # brief steps outside the area / unknown: neither count nor reset
            if st[1] is not None and t - st[1] <= GAP_SEC:
                st[0] += t - st[1]
            st[1] = t
            if not st[2] and st[0] >= need:
                st[2] = True
                out.append(
                    self.finding(t, "BREACHED", f"Person in staff area without uniform for {_fmt_dur(st[0])}", zone_id=zid, confidence=0.85,
                                 boxes=[(p.bbox, "Uniform not detected", RED)])
                )
        for tid in [k for k, v in self.state.items() if t - v[3] > 30]:
            del self.state[tid]
        return out


class QueueBreachDetector(_Detector):
    """Queue length above ``maxQueue`` for ``minDurationSec`` (default 10 s) in a QUEUE zone."""

    def __init__(self, rule: RuleSpec, camera_id: int, queues: list[tuple[int, list[Point]]]) -> None:
        super().__init__(rule, camera_id, queues)
        self.state: dict[int, list[Any]] = {}  # zone -> [since, fired]

    def update(self, t: float, people: Sequence[PersonObs], queue_lengths: dict[int, int] | None = None, **_: Any) -> list[Finding]:
        max_q = self.rule.pf("maxQueue", 5)
        min_dur = self.rule.pf("minDurationSec", 10)
        out: list[Finding] = []
        for zid, poly in self.areas or []:
            n = (queue_lengths or {}).get(zid)
            if n is None:
                continue
            st = self.state.setdefault(zid, [None, False])
            if n > max_q:
                st[0] = t if st[0] is None else st[0]
                if not st[1] and t - st[0] >= min_dur:
                    st[1] = True
                    inq = [p for p in people if not p.is_staff and point_in_polygon(p.foot, poly)]
                    boxes = [(p.bbox, f"Queue of {n}" if i == 0 else "", RED) for i, p in enumerate(inq)]
                    out.append(self.finding(t, "BREACHED", f"Queue of {n} people (max {int(max_q)})", zone_id=zid, confidence=0.9, boxes=boxes))
            else:
                st[0], st[1] = None, False
        return out


class StockOutDetector(_Detector):
    """SHELF zones: emptiness % vs the reference; BREACHED when >= emptyPct on 2 consecutive checks."""

    def __init__(
        self,
        rule: RuleSpec,
        camera_id: int,
        shelves: list[Zone],
        refs: ShelfReferenceStore,
        check_sec: float = 30.0,
        grid: tuple[int, int] = (8, 2),
        dark_brightness: float = 40.0,
    ) -> None:
        super().__init__(rule, camera_id, [(z.id, list(z.polygon)) for z in shelves])
        self.refs = refs
        self.check_sec = check_sec
        self.dark = dark_brightness
        self.shelves = [
            (z, shelf_cells(z.polygon, *grid), ShelfReferenceStore.signature(z.polygon, grid[0], grid[1], z.reference_snapshot_id))
            for z in shelves
        ]
        self.state: dict[int, list[Any]] = {}  # zone -> [consecutive, fired]
        self.last_check: float | None = None
        self.last_reading: dict[int, float] = {}

    def update(self, t: float, people: Sequence[PersonObs], frame: np.ndarray | None = None, active: bool = True, **_: Any) -> list[Finding]:
        if frame is None or (self.last_check is not None and t - self.last_check < self.check_sec):
            return []
        self.last_check = t
        if float(frame.mean()) < self.dark:
            return []
        threshold = self.rule.pf("emptyPct", 70)
        boxes_people = [p.bbox for p in people]
        out: list[Finding] = []
        for zone, cells, sig in self.shelves:
            if not cells:
                continue
            occ = occluded_cells(cells, boxes_people)
            dens = cell_densities(frame, cells)
            ref = self.refs.get(zone.id, sig)
            if ref is None:
                if occ.mean() <= 0.1:
                    self.refs.set(zone.id, sig, dens)
                    out.append(self.finding(t, None, f"Shelf reference captured for {zone.name}", zone_id=zone.id,
                                            boxes=[(_poly_bbox(zone.polygon), f"{zone.name} reference", GREEN)], snapshot_kind="REFERENCE"))
                continue
            if not active:
                continue
            r = compare(dens, ref, occ)
            if r.visible_fraction < 0.5:
                continue
            self.last_reading[zone.id] = r.empty_pct
            st = self.state.setdefault(zone.id, [0, False])
            if r.empty_pct >= threshold:
                st[0] += 1
            else:
                st[0] = 0
                if r.empty_pct < threshold - 15:
                    st[1] = False
            if st[0] >= 2 and not st[1]:
                st[1] = True
                fills = [(cells[i].bbox, RED) for i in r.empty_cells]
                out.append(
                    self.finding(t, "BREACHED", f"{zone.name}: {r.empty_pct:.0f}% of shelf empty (threshold {threshold:.0f}%)", zone_id=zone.id,
                                 confidence=round(min(1.0, 0.5 + r.visible_fraction / 2), 2),
                                 boxes=[(_poly_bbox(zone.polygon), f"Stock-out {r.empty_pct:.0f}% empty", RED)], fills=fills)
                )
        return out


def _poly_bbox(poly: Sequence[Point]) -> BBox:
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    return (min(xs), min(ys), max(xs), max(ys))


# ----------------------------------------------------------------------------- window detectors


class HygieneTracker(_Detector):
    """Marks grid cells of the detection area visited by staff during the rule window."""

    instant = False

    def __init__(self, rule: RuleSpec, camera_id: int, areas: list[tuple[int, list[Point]]] | None, store: Any) -> None:
        super().__init__(rule, camera_id, areas)
        self.store = store
        gw, gh = HYGIENE_GRID
        self.cells: dict[int, BBox] = {}
        for gy in range(gh):
            for gx in range(gw):
                b = (gx / gw, gy / gh, (gx + 1) / gw, (gy + 1) / gh)
                c = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
                if self.area_of(c)[0]:
                    self.cells[gy * gw + gx] = b
        self.zone_id = areas[0][0] if areas else None

    def update(self, t: float, people: Sequence[PersonObs], **_: Any) -> list[Finding]:
        win = self.store.window(self.rule, t)
        if win is None or not self.cells:
            return []
        visited = self.store.hygiene_cells(win, self.camera_id, self.cells, self.zone_id)
        gw, gh = HYGIENE_GRID
        for p in people:
            if not p.is_staff:
                continue
            idx = min(gh - 1, int(p.foot[1] * gh)) * gw + min(gw - 1, int(p.foot[0] * gw))
            if idx in self.cells:
                visited.add(idx)
        return []


class HuddleTracker(_Detector):
    """>= minPeople staff within ``radius`` of each other for >= minDurationMin inside the window."""

    instant = False
    gap_sec = 5.0

    def __init__(self, rule: RuleSpec, camera_id: int, areas: list[tuple[int, list[Point]]] | None, store: Any) -> None:
        super().__init__(rule, camera_id, areas)
        self.store = store
        self.since: float | None = None
        self.last: float | None = None

    def update(self, t: float, people: Sequence[PersonObs], **_: Any) -> list[Finding]:
        win = self.store.window(self.rule, t)
        if win is None:
            self.since = self.last = None
            return []
        self.store.observe(win, self.camera_id)
        min_people = int(self.rule.pf("minPeople", 3))
        radius = self.rule.pf("radius", 0.2)
        need = self.rule.pf("minDurationMin", 5) * 60.0
        staff = [p for p in people if p.is_staff and self.area_of(p.foot)[0]]
        cluster = huddle_cluster(staff, min_people, radius)
        if cluster:
            if self.since is None or (self.last is not None and t - self.last > self.gap_sec):
                self.since = t
            self.last = t
            if t - self.since >= need:
                zid = self.area_of(cluster[0].foot)[1]
                self.store.huddle_achieved(
                    win, self.camera_id, t, zid,
                    f"Huddle of {len(cluster)} staff for {_fmt_dur(t - self.since)}",
                    [(p.bbox, f"Huddle ({len(cluster)} staff)" if i == 0 else "", GREEN) for i, p in enumerate(cluster)],
                )
        elif self.last is not None and t - self.last > self.gap_sec:
            self.since = None
        return []


def huddle_cluster(staff: Sequence[PersonObs], min_people: int, radius: float) -> list[PersonObs]:
    """Largest group of staff all within ``radius`` of one member (empty if < min_people)."""
    best: list[PersonObs] = []
    for c in staff:
        grp = [p for p in staff if distance(p.foot, c.foot) <= radius]
        if len(grp) > len(best):
            best = grp
    return best if len(best) >= max(2, min_people) else []


# ----------------------------------------------------------------------------- camera manager


class CameraAiManager:
    """All AI Manager detectors for one camera, built from the store's rules and this camera's zones."""

    def __init__(
        self,
        camera_id: int,
        zones: Sequence[Zone],
        rules: Sequence[RuleSpec],
        tz: ZoneInfo,
        store: Any,
        refs: ShelfReferenceStore,
        cooldown_sec: float = 600.0,
        shelf_check_sec: float = 30.0,
        dark_brightness: float = 40.0,
    ) -> None:
        self.camera_id = camera_id
        self.tz = tz
        self.store = store
        self.cooldown_sec = cooldown_sec
        self._last_breach: dict[str, float] = {}
        self.detectors: list[Any] = []
        zones = [z for z in zones if z.is_active]
        by_type: dict[str, list[Zone]] = {}
        for z in zones:
            by_type.setdefault(z.type, []).append(z)
        for r in rules:
            if r.type == "STORE_OPEN_CLOSE":
                continue  # handled store-wide from the store-ops monitor
            mine = [z for z in zones if z.id in set(r.zone_ids)]
            if r.zone_ids and not mine:
                continue  # detection areas are on other cameras
            areas = [(z.id, list(z.polygon)) for z in mine] if r.zone_ids else None
            if r.type == "MOBILE_USAGE":
                self.detectors.append(MobileUsageDetector(r, camera_id, areas))
            elif r.type == "UNATTENDED_CUSTOMER":
                self.detectors.append(UnattendedCustomerDetector(r, camera_id, areas, [z.polygon for z in by_type.get("QUEUE", [])]))
            elif r.type == "UNIFORM_COMPLIANCE":
                if areas is None:
                    staff = by_type.get("STAFF_ONLY", [])
                    if not staff:
                        continue
                    areas = [(z.id, list(z.polygon)) for z in staff]
                self.detectors.append(UniformComplianceDetector(r, camera_id, areas))
            elif r.type == "QUEUE_BREACH":
                qs = [z for z in (mine if r.zone_ids else by_type.get("QUEUE", [])) if z.type == "QUEUE"]
                if qs:
                    self.detectors.append(QueueBreachDetector(r, camera_id, [(z.id, list(z.polygon)) for z in qs]))
            elif r.type == "STOCK_OUT":
                shelves = mine if r.zone_ids else by_type.get("SHELF", [])
                if shelves:
                    self.detectors.append(StockOutDetector(r, camera_id, shelves, refs, shelf_check_sec, dark_brightness=dark_brightness))
            elif r.type == "HYGIENE_CLEANING":
                self.detectors.append(HygieneTracker(r, camera_id, areas, store))
            elif r.type == "HUDDLE_MEETING":
                self.detectors.append(HuddleTracker(r, camera_id, areas, store))

    @property
    def enabled(self) -> bool:
        return bool(self.detectors)

    @property
    def wants_phones(self) -> bool:
        return any(isinstance(d, MobileUsageDetector) for d in self.detectors)

    def update(
        self,
        t: float,
        people: Sequence[PersonObs],
        phones: Sequence[Any] = (),
        frame: np.ndarray | None = None,
        queue_lengths: dict[int, int] | None = None,
    ) -> list[Finding]:
        out: list[Finding] = []
        for d in self.detectors:
            active = d.rule.active(t, self.tz)
            if isinstance(d, StockOutDetector):
                found = d.update(t, people, frame=frame, active=active)
            elif d.instant and not active:
                continue
            else:
                found = d.update(t, people, phones=phones, frame=frame, queue_lengths=queue_lengths)
            for f in found:
                if f.status == "BREACHED":
                    last = self._last_breach.get(d.rule.key)
                    if last is not None and t - last < self.cooldown_sec:
                        continue
                    self._last_breach[d.rule.key] = t
                out.append(f)
        return out


def local_hhmm(t: float, tz: ZoneInfo) -> str:
    return datetime.fromtimestamp(t, tz=tz).strftime("%H:%M")
