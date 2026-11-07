"""Synthetic store simulator (demo data + end-to-end tests).

Generates shopper / staff trajectories over the store's real camera + zone configuration, renders
CCTV-like frames (floor, wall racks, shelves, door, billing counter, people, phones, timestamp
overlay), feeds them through the *same* :class:`CameraProcessor` used on live video (scripted
detector) and posts everything through the normal spooling client: visitor events, queue, heatmaps,
store-ops with OPENING/CLOSING snapshots, PERIODIC snapshots (Image Directory + recap video) and
AI Manager detections with annotated AI_MANAGER snapshots.

A scenario is one or more *segments* of simulated time:

* **traffic block** — shoppers, groups, a billing queue with a cashier break, plus one incident for
  every AI Manager rule type: phone use, unattended customer, huddle, cleaning sweep, staff-area
  person without uniform, shelf emptying (stock-out) and a long queue;
* **opening** (around the store's opening time) — lights on, staff arrive -> STORE_OPENED +
  OPENING snapshot + STORE_OPEN_CLOSE detection;
* **closing** (around closing time) — last customers and staff leave, a partial (BREACHED) cleaning
  sweep, lights off -> STORE_CLOSED + CLOSING snapshot.

    python -m congruence_eye_ai.simulate --backend http://localhost:3000 --key dev-edge-key-store-1 --once
    python -m congruence_eye_ai.simulate --backend http://localhost:3000 --key dev-edge-key-store-1 --once --date 2026-10-04
    python -m congruence_eye_ai.simulate --backend http://localhost:3000 --key dev-edge-key-store-1 --minutes 60 --speed 60
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import random
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import date as Date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from . import __version__
from .aimanager.rules import RuleSpec, specs_from_config
from .analytics.demographics import HintEstimator
from .annotate import encode_jpeg
from .backend_client import BackendClient
from .config import Settings
from .detector import Track
from .geometry import DIRECTION_VECTORS, Point, point_in_polygon, polygon_centroid
from .processor import CameraProcessor, StoreContext
from .schemas import AGE_BANDS, DEFAULT_AI_PARAMS, CameraHeartbeat, HeartbeatPayload, IngestConfig, Zone
from .sim_render import PHONE_CLASS, SceneRenderer
from .sink import BackendSink, Bundle, ListSink, OutputSink, SnapshotOut, TeeSink

log = logging.getLogger("congruence_eye_ai.simulate")

FRAME_W, FRAME_H = 320, 180
SNAP_W, SNAP_H = 960, 540
WALK_SPEED = 0.18  # normalised units per second
MOP_SPEED = 0.25
ONCE_MINUTES = 15.0  # length of the deterministic traffic block
OPEN_BEFORE, OPEN_AFTER = 14 * 60.0, 6 * 60.0
CLOSE_BEFORE, CLOSE_AFTER = 10 * 60.0, 8 * 60.0

# ----------------------------------------------------------------------------- demo config


def demo_config(store_id: int = 1) -> IngestConfig:
    """A self-contained store layout (used by --dry-run without a backend and by tests)."""
    return IngestConfig.model_validate(
        {
            "store": {"id": store_id, "code": "CHN-TNR", "name": "T Nagar", "timezone": "Asia/Kolkata", "openTime": "10:00", "closeTime": "22:00"},
            "cameras": [
                {"id": 1, "storeId": store_id, "name": "Entrance", "type": "ENTRANCE", "rtspUrl": None, "isActive": True},
                {"id": 2, "storeId": store_id, "name": "Floor", "type": "ZONE", "rtspUrl": None, "isActive": True},
                {"id": 3, "storeId": store_id, "name": "Billing", "type": "BILLING", "rtspUrl": None, "isActive": True},
            ],
            "zones": [
                {"id": 1, "cameraId": 1, "name": "Main door", "type": "ENTRY_LINE", "polygon": [[0.1, 0.6], [0.9, 0.6]], "inDirection": "UP", "engagedDwellSec": 30},
                {"id": 2, "cameraId": 2, "name": "Sarees", "type": "SECTION", "polygon": [[0.05, 0.3], [0.45, 0.3], [0.45, 0.95], [0.05, 0.95]], "engagedDwellSec": 30},
                {"id": 3, "cameraId": 2, "name": "Kurtis", "type": "SECTION", "polygon": [[0.55, 0.3], [0.95, 0.3], [0.95, 0.95], [0.55, 0.95]], "engagedDwellSec": 30},
                {"id": 4, "cameraId": 3, "name": "Counter 1 queue", "type": "QUEUE", "polygon": [[0.3, 0.35], [0.9, 0.35], [0.9, 0.75], [0.3, 0.75]], "engagedDwellSec": 30, "queueAlertLength": 5},
                {"id": 5, "cameraId": 3, "name": "Cashier", "type": "STAFF_ONLY", "polygon": [[0.0, 0.3], [0.22, 0.3], [0.22, 0.8], [0.0, 0.8]], "engagedDwellSec": 30},
            ],
            "settings": {"engagedStoreDwellSec": 300, "bounceSec": 60},
        }
    )


# ----------------------------------------------------------------------------- people


@dataclass
class Person:
    pid: int
    shirt_bgr: tuple[int, int, int]
    pants_bgr: tuple[int, int, int]
    is_staff: bool = False
    gender: str = "U"
    age_band: str = "U"


@dataclass
class Appearance:
    """A person visible on one camera for a time interval (= one tracker track)."""

    camera_id: int
    track_id: int
    person: Person
    keyframes: list[tuple[float, float, float]]  # (t, x, y) foot positions
    queue: _CounterQueue | None = None
    queue_index: int = -1
    phone: tuple[float, float] | None = None  # time window with a phone in hand
    mop: bool = False

    @property
    def t0(self) -> float:
        return self.keyframes[0][0]

    @property
    def t1(self) -> float:
        return self.keyframes[-1][0]

    def pos(self, t: float) -> Point:
        if self.queue is not None:
            return self.queue.slot_position(self.queue_index, t)
        kf = self.keyframes
        if t <= kf[0][0]:
            return kf[0][1], kf[0][2]
        for (ta, xa, ya), (tb, xb, yb) in zip(kf, kf[1:]):
            if ta <= t <= tb:
                if tb == ta:
                    return xb, yb
                f = (t - ta) / (tb - ta)
                x, y = xa + (xb - xa) * f, ya + (yb - ya) * f
                if xa == xb and ya == yb:  # standing: small deterministic sway
                    x += 0.004 * math.sin(t * 1.3 + self.person.pid)
                    y += 0.002 * math.cos(t * 0.9 + self.person.pid)
                return x, y
        return kf[-1][1], kf[-1][2]


def bbox_for_foot(x: float, y: float) -> tuple[float, float, float, float]:
    h = 0.22 + 0.14 * y
    w = h * 0.36
    return (max(0.0, x - w / 2), max(0.0, y - h), min(1.0, x + w / 2), min(1.0, y))


@dataclass
class _CounterQueue:
    """FIFO billing counter: computes queue slots and service end times."""

    zone: Zone
    front: Point
    step: Point
    customers: list[tuple[float, float]] = field(default_factory=list)  # (arrive, leave)
    breaks: list[tuple[float, float]] = field(default_factory=list)

    def add(self, arrive: float, service: float) -> tuple[int, float]:
        start = max(arrive, max((e for a, e in self.customers if a <= arrive), default=arrive))
        for b0, b1 in self.breaks:
            if b0 <= start < b1:
                start = b1
        end = start + service
        for b0, b1 in self.breaks:
            if start < b0 < end:
                end += b1 - b0
        self.customers.append((arrive, end))
        return len(self.customers) - 1, end

    def slot_position(self, idx: int, t: float) -> Point:
        arrive = self.customers[idx][0]
        rank = sum(1 for j, (a, e) in enumerate(self.customers) if j != idx and (a < arrive or (a == arrive and j < idx)) and e > t)
        rank = min(rank, 8)
        return self.front[0] + self.step[0] * rank, self.front[1] + self.step[1] * rank


@dataclass
class Segment:
    t0: float
    t1: float
    fps: float
    label: str


# ----------------------------------------------------------------------------- world


class StoreWorld:
    """All simulated people, lights, shelf stock and AI Manager incident rules."""

    def __init__(self, config: IngestConfig, settings: Settings, seed: int = 7, arrivals_per_hour: float = 120.0) -> None:
        self.settings = settings
        self.rng = random.Random(seed)
        self.arrivals_per_hour = arrivals_per_hour
        self.tz = ZoneInfo(config.store.timezone or "Asia/Kolkata")
        cams = config.active_cameras()
        cam_ids = {c.id for c in cams}
        zones = [z for z in config.zones if z.is_active and z.camera_id in cam_ids]
        self.entry_lines = [z for z in zones if z.type == "ENTRY_LINE" and len(z.polygon) >= 2]
        self.sections = [z for z in zones if z.type == "SECTION"]
        self.queues = [z for z in zones if z.type == "QUEUE"]
        self.staff_zones = [z for z in zones if z.type == "STAFF_ONLY"]
        # the floor camera used for staff incidents: the camera with most SECTION zones
        by_cam = Counter(z.camera_id for z in self.sections)
        self.floor_cam = by_cam.most_common(1)[0][0] if by_cam else next((c.id for c in cams if c.type in ("ZONE", "GENERAL")), cams[0].id)
        shelves = [z for z in zones if z.type == "SHELF"]
        self.virtual_zones: list[Zone] = []
        if not shelves:
            shelves = [Zone(id=-1, camera_id=self.floor_cam, name="Wall shelf", type="SHELF", polygon=[(0.12, 0.02), (0.88, 0.02), (0.88, 0.16), (0.12, 0.16)])]
            self.virtual_zones = list(shelves)
        self.shelves = shelves
        self.config = config.model_copy(update={"zones": list(config.zones) + self.virtual_zones})
        self.appearances: dict[int, list[Appearance]] = {c.id: [] for c in cams}
        self._next_tid: dict[int, int] = {c.id: 0 for c in cams}
        self._pid = 0
        self.people: dict[int, Person] = {}
        self._combo_cycle = self._make_combos()
        self.counters = [self._make_counter(q) for q in self.queues]
        self.stats: dict[str, int] = {"shoppers": 0, "groups": 0, "staff": 0, "queueCustomers": 0}
        self._max_sections = 3
        self._max_dwell = 300.0
        self.lights: list[tuple[float, bool]] = []  # (t, on) change points; default on
        self.shelf_plan: dict[int, list[tuple[float, float]]] = {}  # zone -> [(t, fill)]
        self.segments: list[Segment] = []
        self.sim_rules: list[RuleSpec] = []  # implicit AI Manager rules used for the incidents
        self.incidents: list[tuple[str, float, int]] = []  # (rule type, planned time, camera)
        self.staff_team: list[Person] = []
        self.cashier: Person | None = None

    # ---------------------------------------------------------------- colours / people
    def _make_combos(self) -> list[tuple[tuple[int, int, int], tuple[int, int, int]]]:
        import cv2

        bad_bins = set()
        for lo, hi in self.settings.STAFF_UNIFORM_HSV:
            for h in range(int(lo[0]), int(hi[0]) + 1):
                bad_bins.add(int(h * 16 // 180))
        hues = [b for b in range(16) if b not in bad_bins and b not in {0, 15}]
        pants_hsv = [(110, 160, 90), (0, 0, 60), (0, 0, 140), (20, 110, 170), (12, 160, 90), (40, 140, 90), (170, 170, 90), (105, 90, 170)]
        combos = []
        for hb in hues:
            for p in pants_hsv:
                shirt = np.uint8([[[int(hb * 11.25 + 5), 210, 200]]])
                pant = np.uint8([[list(p)]])
                sb = tuple(int(v) for v in cv2.cvtColor(shirt, cv2.COLOR_HSV2BGR)[0, 0])
                pb = tuple(int(v) for v in cv2.cvtColor(pant, cv2.COLOR_HSV2BGR)[0, 0])
                combos.append((sb, pb))
        self.rng.shuffle(combos)
        return combos  # type: ignore[return-value]

    def _uniform_bgr(self) -> tuple[int, int, int]:
        import cv2

        lo, hi = self.settings.STAFF_UNIFORM_HSV[0]
        hsv = np.uint8([[[(lo[0] + hi[0]) // 2, min(255, max(lo[1] + 60, (lo[1] + hi[1]) // 2)), min(255, max(lo[2] + 60, (lo[2] + hi[2]) // 2))]]])
        return tuple(int(v) for v in cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0, 0])  # type: ignore[return-value]

    def new_person(self, staff: bool = False) -> Person:
        self._pid += 1
        if staff:
            p = Person(self._pid, self._uniform_bgr(), (40, 40, 40), True, self.rng.choice("MF"), "25-34")
            self.stats["staff"] += 1
        else:
            shirt, pants = self._combo_cycle[self._pid % len(self._combo_cycle)]
            gender = self.rng.choices(["M", "F", "U"], [0.45, 0.47, 0.08])[0]
            band = self.rng.choices(list(AGE_BANDS) + ["U"], [0.08, 0.22, 0.3, 0.18, 0.1, 0.07, 0.05])[0]
            p = Person(self._pid, shirt, pants, False, gender, band)
        self.people[p.pid] = p
        return p

    def colours(self, pid: int) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
        p = self.people.get(pid)
        return (p.shirt_bgr, p.pants_bgr) if p else ((128, 128, 128), (60, 60, 60))

    # ---------------------------------------------------------------- building blocks
    def _tid(self, cam: int) -> int:
        self._next_tid[cam] += 1
        return self._next_tid[cam]

    def _add(self, cam: int, person: Person, keyframes: list[tuple[float, float, float]], **kw: Any) -> Appearance:
        a = Appearance(cam, self._tid(cam), person, keyframes, **kw)
        self.appearances[cam].append(a)
        return a

    def _walk_line(self, line: Zone, person: Person, t: float, entering: bool, offset: float = 0.0, u: float | None = None) -> float:
        """Walk across an entry line (entering or exiting). Returns the time when done."""
        (ax, ay), (bx, by) = line.polygon[0], line.polygon[1]
        u = self.rng.uniform(0.3, 0.7) if u is None else u
        u = min(0.9, max(0.1, u + offset))
        mx, my = ax + (bx - ax) * u, ay + (by - ay) * u
        dx, dy = DIRECTION_VECTORS[line.in_direction or "UP"]
        dist = 0.22
        outside = (_clip(mx - dx * dist), _clip(my - dy * dist))
        inside = (_clip(mx + dx * dist), _clip(my + dy * dist))
        p0, p1 = (outside, inside) if entering else (inside, outside)
        dur = _dist(p0, p1) / WALK_SPEED
        self._add(line.camera_id, person, [(t, *p0), (t + dur, *p1)])
        return t + dur

    def _enter(self, person: Person, t: float) -> float:
        return self._walk_line(self.entry_lines[0], person, t, True) if self.entry_lines else t

    def _leave(self, person: Person, t: float) -> float:
        return self._walk_line(self.entry_lines[0], person, t, False) if self.entry_lines else t

    def _visit_section(self, zone: Zone, person: Person, t: float, dwell: float) -> float:
        target = self._random_point_in(zone.polygon)
        edge = (_clip(target[0] + self.rng.uniform(-0.05, 0.05)), 0.99 if target[1] < 0.9 else 0.02)
        walk = _dist(edge, target) / WALK_SPEED
        kf = [(t, *edge), (t + walk, *target), (t + walk + dwell, *target), (t + 2 * walk + dwell, *edge)]
        self._add(zone.camera_id, person, kf)
        return t + 2 * walk + dwell

    def _random_point_in(self, poly: list[Point]) -> Point:
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        c = polygon_centroid(poly)
        for _ in range(200):
            p = (self.rng.uniform(min(xs), max(xs)), self.rng.uniform(min(ys), max(ys)))
            p = (p[0] * 0.7 + c[0] * 0.3, p[1] * 0.7 + c[1] * 0.3)  # away from the boundary
            if point_in_polygon(p, poly):
                return p
        return c

    def _make_counter(self, q: Zone) -> _CounterQueue:
        xs, ys = [p[0] for p in q.polygon], [p[1] for p in q.polygon]
        cx, cy = polygon_centroid(q.polygon)
        horiz = (max(xs) - min(xs)) >= (max(ys) - min(ys))
        staff = next((z for z in self.staff_zones if z.camera_id == q.camera_id), None)
        sc = polygon_centroid(staff.polygon) if staff else (min(xs), cy)
        span = 0.85 * ((max(xs) - min(xs)) if horiz else (max(ys) - min(ys)))
        if horiz:
            near_min = abs(sc[0] - min(xs)) <= abs(sc[0] - max(xs))
            front = (min(xs) + span * 0.05, cy) if near_min else (max(xs) - span * 0.05, cy)
            step = (span / 9 * (1 if near_min else -1), 0.0)
        else:
            near_min = abs(sc[1] - min(ys)) <= abs(sc[1] - max(ys))
            front = (cx, min(ys) + span * 0.05) if near_min else (cx, max(ys) - span * 0.05)
            step = (0.0, span / 9 * (1 if near_min else -1))
        for k in range(9):
            if not point_in_polygon((front[0] + step[0] * k, front[1] + step[1] * k), q.polygon):
                front, step = (cx, cy), (0.0, 0.0)
                break
        return _CounterQueue(q, front, step)

    def _join_queue(self, person: Person, t: float, service: float) -> float:
        if not self.counters:
            return t
        cq = self.counters[0]
        idx, end = cq.add(t, service)
        a = Appearance(cq.zone.camera_id, self._tid(cq.zone.camera_id), person, [(t, 0, 0), (end, 0, 0)], cq, idx)
        self.appearances[cq.zone.camera_id].append(a)
        self.stats["queueCustomers"] += 1
        return end

    def _cashier_shift(self, start: float, end: float, breaks: list[tuple[float, float]]) -> None:
        for cq in self.counters[:1]:
            sz = next((z for z in self.staff_zones if z.camera_id == cq.zone.camera_id), None)
            if sz is None or self.cashier is None:
                continue
            cq.breaks.extend(breaks)
            p = self._cashier_spot(sz)
            cur = start
            for b0, b1 in sorted(breaks) + [(end, end)]:
                if b0 - cur > 1:
                    self._add(cq.zone.camera_id, self.cashier, [(cur, *p), (b0, *p)])
                cur = b1

    def _cashier_spot(self, sz: Zone) -> Point:
        xs, ys = [p[0] for p in sz.polygon], [p[1] for p in sz.polygon]
        c = polygon_centroid(sz.polygon)
        return (min(xs) + (c[0] - min(xs)) * 0.6, c[1])

    def _second_spot(self, sz: Zone, first: Point) -> Point:
        xs, ys = [p[0] for p in sz.polygon], [p[1] for p in sz.polygon]
        best, best_d = polygon_centroid(sz.polygon), -1.0
        for gx in np.linspace(min(xs), max(xs), 9):
            for gy in np.linspace(min(ys), max(ys), 9):
                p = (float(gx), float(gy))
                if all(point_in_polygon((p[0] + dx, p[1] + dy), sz.polygon) for dx, dy in ((-0.04, 0), (0.04, 0), (0, -0.04), (0, 0.04))):
                    d = _dist(p, first)
                    if d > best_d:
                        best, best_d = p, d
        return best

    def _shopper_journey(self, people: list[Person], t: float, bounce: bool, buy: bool, direct_queue: bool = False) -> float:
        line = self.rng.choice(self.entry_lines) if self.entry_lines else None
        u = self.rng.uniform(0.2, 0.45) if len(people) > 1 else self.rng.uniform(0.3, 0.7)
        t_in = t
        for i, p in enumerate(people):
            if line is not None:
                t_in = max(t_in, self._walk_line(line, p, t + i * self.rng.uniform(0.3, 1.0), True, offset=i * 0.14, u=u))
        cur = t_in + self.rng.uniform(4, 10)
        if bounce:
            cur += self.rng.uniform(5, 25)
        elif direct_queue and self.counters:
            cur = self._join_queue(people[0], cur, self.rng.uniform(40, 70)) + self.rng.uniform(5, 15)
        else:
            k = min(len(self.sections), self.rng.randint(1, self._max_sections)) if self.sections else 0
            for z in self.rng.sample(self.sections, k=k):
                dwell = min(self._max_dwell, max(6.0, self.rng.lognormvariate(math.log(45), 0.7)))
                ends = [self._visit_section(z, p, cur + i * 0.8, dwell) for i, p in enumerate(people)]
                cur = max(ends) + self.rng.uniform(5, 20)
            if buy and self.counters:
                cur = self._join_queue(people[0], cur, self.rng.uniform(40, 110)) + self.rng.uniform(5, 15)
        end = cur
        if line is not None:
            for i, p in enumerate(people):
                end = max(end, self._walk_line(line, p, cur + i * self.rng.uniform(0.3, 1.0), False, offset=i * 0.14, u=u))
        return end

    def _party(self, t: float, size: int, bounce: bool, buy: bool, direct_queue: bool = False) -> float:
        people = [self.new_person() for _ in range(size)]
        self.stats["shoppers"] += size
        if size > 1:
            self.stats["groups"] += 1
        return self._shopper_journey(people, t, bounce, buy, direct_queue)

    def _ensure_team(self) -> None:
        if not self.staff_team:
            self.cashier = self.new_person(staff=True)
            self.staff_team = [self.cashier] + [self.new_person(staff=True) for _ in range(3)]

    # ---------------------------------------------------------------- AI Manager helpers
    def _rule(self, type_: str, label: str, start: float | None = None, end: float | None = None, zone_ids: list[int] | None = None, suffix: str = "") -> RuleSpec:
        r = RuleSpec(
            key=f"sim-{type_}{suffix}", rule_id=None, name=f"{label} (simulator)", type=type_, zone_ids=list(zone_ids or []),
            start_sec=_sod(start, self.tz) if start is not None else 0.0, end_sec=_sod(end, self.tz) if end is not None else 86400.0,
            params=dict(DEFAULT_AI_PARAMS.get(type_, {})),
        )
        self.sim_rules.append(r)
        return r

    def _hygiene_rows(self, cam: int, zone_ids: list[int]) -> list[tuple[float, float, float]]:
        """Serpentine sweep rows (y, x_min, x_max) over the 16x9 grid cells of the detection area."""
        polys = [list(z.polygon) for z in self.sections if z.id in zone_ids and z.camera_id == cam]
        rows: dict[int, list[float]] = {}
        for gy in range(9):
            for gx in range(16):
                c = ((gx + 0.5) / 16, (gy + 0.5) / 9)
                if (not polys and 0.35 <= c[1] <= 0.95) or any(point_in_polygon(c, p) for p in polys):
                    rows.setdefault(gy, []).append(c[0])
        return [((gy + 0.5) / 9, min(xs), max(xs)) for gy, xs in sorted(rows.items())]

    def _sweep(self, person: Person, cam: int, t: float, rows: list[tuple[float, float, float]], fraction: float) -> float:
        n = max(1, int(math.ceil(len(rows) * fraction)))
        kf: list[tuple[float, float, float]] = []
        cur = t
        prev: Point | None = None
        for i, (y, x0, x1) in enumerate(rows[:n]):
            a, b = ((x0, y), (x1, y)) if i % 2 == 0 else ((x1, y), (x0, y))
            for p in (a, b):
                if prev is not None:
                    cur += _dist(prev, p) / MOP_SPEED
                kf.append((cur, *p))
                prev = p
        self._add(cam, person, kf, mop=True)
        return cur

    def _set_fill(self, zone_id: int, t: float, fill: float) -> None:
        self.shelf_plan.setdefault(zone_id, []).append((t, fill))
        self.shelf_plan[zone_id].sort()

    def shelf_fill(self, zone_id: int, t: float) -> float:
        plan = self.shelf_plan.get(zone_id)
        if not plan:
            return 1.0
        if t <= plan[0][0]:
            return plan[0][1]
        for (ta, fa), (tb, fb) in zip(plan, plan[1:]):
            if ta <= t <= tb:
                return fa + (fb - fa) * (t - ta) / max(1e-9, tb - ta)
        return plan[-1][1]

    def lights_on(self, t: float) -> bool:
        on = True
        for ts, state in self.lights:
            if ts <= t:
                on = state
        return on

    # ---------------------------------------------------------------- segments
    def add_block(self, s: float, minutes: float, scripted: bool, incidents: bool = True, fps: float = 4.0) -> float:
        """Traffic block starting at ``s``; returns its end time."""
        self._ensure_team()
        end = s + minutes * 60.0
        if scripted:
            self._max_dwell = 90.0 if incidents else 120.0
            breaks = [(s + 240, s + 330)]
        else:
            breaks = [(s + (end - s) * 0.55, s + (end - s) * 0.55 + 150)] if end - s > 900 else []
        self._cashier_shift(s, end + 900, breaks)
        if incidents:
            self._incidents(s)
        if scripted:
            plan = [  # (offset, group size, bounce, buy)
                (15, 1, False, True), (40, 2, False, True), (70, 1, True, False), (95, 1, False, False),
                (120, 3, False, True), (160, 1, False, True), (200, 1, True, False), (230, 2, False, False),
                (250, 1, False, True), (265, 1, False, True), (275, 1, False, True), (285, 1, False, True),
            ]
            last = s
            for off, size, bounce, buy in plan:
                if incidents:
                    self._max_sections = 2
                last = max(last, self._party(s + off, size, bounce, buy))
            if incidents and self.counters:  # extra buyers going straight to the till -> long queue
                for off in (226, 234, 242):
                    last = max(last, self._party(s + off, 1, False, True, direct_queue=True))
            shopper_end = max((a.t1 for lst in self.appearances.values() for a in lst if not a.person.is_staff and a.t0 >= s), default=end)
            end = max(end, shopper_end + 15.0)
        else:
            t = s + self.rng.uniform(5, 30)
            mean_gap = 3600.0 / max(1.0, self.arrivals_per_hour)
            last_arrival = end - 6 * 60
            while t < last_arrival:
                size = self.rng.choices([1, 2, 3, 4], [0.68, 0.2, 0.08, 0.04])[0]
                self._party(t, size, bounce=self.rng.random() < 0.22, buy=self.rng.random() < 0.45)
                t += self.rng.expovariate(1.0 / mean_gap)
        self.segments.append(Segment(s, end, fps, "traffic"))
        return end

    def _incidents(self, s: float) -> None:
        """One incident per AI Manager rule type, at fixed offsets from ``s``."""
        F = self.floor_cam
        floor_sections = [z.id for z in self.sections if z.camera_id == F]
        cashier, floor, s2, s3 = self.staff_team
        # floor staff walks in, mops the floor (hygiene window s+10 .. s+200 -> COMPLIED)
        t = self._enter(floor, s + 2) + 4
        rows = self._hygiene_rows(F, floor_sections)
        self._rule("HYGIENE_CLEANING", "Floor cleaning", s + 10, s + 200, floor_sections, "-day")
        t = self._sweep(floor, F, t, rows, 1.0)
        self.incidents.append(("HYGIENE_CLEANING", s + 200, F))
        # huddle: two more staff join the floor staff for 5.5 min (window s+150 .. s+640 -> COMPLIED)
        self._rule("HUDDLE_MEETING", "Morning huddle", s + 150, s + 640)
        for p, dt in ((s2, 0), (s3, 3)):
            self._enter(p, s + 140 + dt)
        centre = (0.5, 0.62)
        for p, off in ((floor, (-0.07, 0.0)), (s2, (0.07, 0.0)), (s3, (0.0, 0.06))):
            q = (centre[0] + off[0], centre[1] + off[1])
            self._add(F, p, [(s + 170, *q), (s + 500, *q)])
        self.incidents.append(("HUDDLE_MEETING", s + 470, F))
        # phone use: floor staff on the phone for 45 s
        self._rule("MOBILE_USAGE", "Mobile phone usage")
        pp = (0.3, 0.58)
        self._add(F, floor, [(s + 505, *pp), (s + 560, *pp)], phone=(s + 510, s + 555))
        self.incidents.append(("MOBILE_USAGE", s + 530, F))
        # unattended customer: 160 s in a section with no staff around
        if self.sections:
            self._rule("UNATTENDED_CUSTOMER", "Unattended customer", zone_ids=[z.id for z in self.sections])
            z = max(self.sections, key=lambda z: (z.camera_id == F, _dist(polygon_centroid(z.polygon), pp)))
            u = self.new_person()
            self.stats["shoppers"] += 1
            t_in = self._enter(u, s + 560)
            c = self._random_point_in(z.polygon)
            self._add(z.camera_id, u, [(t_in + 5, *c), (t_in + 165, *c)])
            self._leave(u, t_in + 175)
            self.incidents.append(("UNATTENDED_CUSTOMER", t_in + 130, z.camera_id))
        # uniform: a helper without uniform stands in the staff-only area for 90 s
        if self.staff_zones:
            self._rule("UNIFORM_COMPLIANCE", "Uniform compliance")
            sz = self.staff_zones[0]
            helper = self.new_person()
            helper.shirt_bgr, helper.pants_bgr = (235, 235, 235), (120, 60, 30)
            spot = self._second_spot(sz, self._cashier_spot(sz))
            self._add(sz.camera_id, helper, [(s + 340, *spot), (s + 430, *spot)])
            self.incidents.append(("UNIFORM_COMPLIANCE", s + 410, sz.camera_id))
        # long queue while the cashier is on a break
        if self.queues:
            self._rule("QUEUE_BREACH", "Billing queue")
            self.incidents.append(("QUEUE_BREACH", s + 300, self.queues[0].camera_id))
        # shelf empties: stock taken off between s+260 and s+420
        self._rule("STOCK_OUT", "Shelf stock-out")
        for z in self.shelves[:1]:
            self._set_fill(z.id, s + 260, 1.0)
            self._set_fill(z.id, s + 420, 0.1)
            self.incidents.append(("STOCK_OUT", s + 450, z.camera_id))
        # floor staff goes back to work elsewhere (keeps the unattended customer alone)

    def add_opening(self, open_ts: float) -> None:
        """Store opening: dark store, lights on, staff arrive, first customers."""
        self._ensure_team()
        s, e = open_ts - OPEN_BEFORE, open_ts + OPEN_AFTER
        self.lights += [(s - 1, False), (open_ts - 10 * 60, True)]
        for i, p in enumerate(self.staff_team):
            self._enter(p, open_ts - 8 * 60 + i * 20)
        if self.cashier is not None:
            self._cashier_shift(open_ts - 6 * 60, e + 1, [])
        for k, off in enumerate((60, 150, 240)):
            self._party(open_ts + off, 1, bounce=k == 1, buy=False)
        self._rule("STORE_OPEN_CLOSE", "Store open / close")
        self.incidents.append(("STORE_OPEN_CLOSE", open_ts - 8 * 60, self.entry_lines[0].camera_id if self.entry_lines else self.floor_cam))
        self.segments.append(Segment(s, e, 2.0, "opening"))

    def add_closing(self, close_ts: float) -> None:
        """Store closing: last customers leave, partial cleaning (BREACHED), staff leave, lights off."""
        self._ensure_team()
        s, e = close_ts - CLOSE_BEFORE, close_ts + CLOSE_AFTER
        F = self.floor_cam
        floor_sections = [z.id for z in self.sections if z.camera_id == F]
        if self.cashier is not None:
            self._cashier_shift(s, close_ts - 60, [])
        for off in (-560, -500):
            self._party(close_ts + off, 1, bounce=True, buy=False)
        cashier, floor, s2, s3 = self.staff_team
        self._rule("HYGIENE_CLEANING", "Closing cleaning", close_ts - 9 * 60, close_ts - 60, floor_sections, "-close")
        self._sweep(floor, F, close_ts - 8 * 60, self._hygiene_rows(F, floor_sections), 0.34)
        self.incidents.append(("HYGIENE_CLEANING", close_ts - 60, F))
        for i, p in enumerate(self.staff_team):
            self._leave(p, close_ts + 45 + i * 20)
        self.lights.append((close_ts + 3 * 60, False))
        if not any(r.type == "STORE_OPEN_CLOSE" for r in self.sim_rules):
            self._rule("STORE_OPEN_CLOSE", "Store open / close")
        self.segments.append(Segment(s, e, 2.0, "closing"))

    def finalize(self) -> None:
        for lst in self.appearances.values():
            lst.sort(key=lambda a: a.t0)
        self.segments.sort(key=lambda g: g.t0)
        if not self.lights:
            return
        self.lights.sort()

    # ---------------------------------------------------------------- query
    def tracks_at(self, camera_id: int, t: float) -> list[Track]:
        out: list[Track] = []
        for a in self.appearances.get(camera_id, []):
            if a.t0 > t:
                break
            if a.t1 < t:
                continue
            x, y = a.pos(t)
            bb = bbox_for_foot(_clip(x), _clip(y))
            meta = {"gender": a.person.gender, "ageBand": a.person.age_band, "pid": a.person.pid, "staff": a.person.is_staff, "mop": a.mop}
            out.append(Track(a.track_id, bb, 0.9, meta))
            if a.phone and a.phone[0] <= t <= a.phone[1]:
                w, h = bb[2] - bb[0], bb[3] - bb[1]
                pb = (bb[2] - 0.3 * w, bb[1] + 0.3 * h, bb[2] - 0.05 * w, bb[1] + 0.42 * h)
                out.append(Track(50000 + a.track_id, pb, 0.62, {"pid": a.person.pid}, cls=PHONE_CLASS))
        return out

    def active(self, camera_id: int, t: float) -> bool:
        for a in self.appearances.get(camera_id, []):
            if a.t0 > t:
                return False
            if a.t1 >= t:
                return True
        return False

    def prune(self, t: float) -> None:
        for cam, lst in self.appearances.items():
            if lst and lst[0].t1 < t - 5:
                self.appearances[cam] = [a for a in lst if a.t1 >= t - 5]


def _clip(v: float) -> float:
    return min(0.99, max(0.01, v))


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _sod(t: float, tz: ZoneInfo) -> float:
    d = datetime.fromtimestamp(t, tz=tz)
    return d.hour * 3600 + d.minute * 60 + d.second + d.microsecond / 1e6


def _local_ts(day: Date, hhmm: str, tz: ZoneInfo) -> float:
    h, m = (int(x) for x in hhmm.split(":")[:2])
    return datetime.combine(day, dtime(h, m), tzinfo=tz).timestamp()


# ----------------------------------------------------------------------------- planning


def plan_world(
    config: IngestConfig,
    settings: Settings,
    *,
    minutes: float,
    scripted: bool,
    seed: int,
    arrivals_per_hour: float,
    now: float,
    start: float | None = None,
    day: Date | None = None,
    speed: float = 0.0,
    incidents: bool = True,
) -> StoreWorld:
    """Build the world: optional opening segment, traffic block, optional closing segment.

    * ``day`` given (``--date``) or the store already closed today -> a full day: opening, a traffic
      block at 13:00 (or 3 h after opening), closing — only segments that are in the past.
    * otherwise the traffic block ends *now* (back-fill; at ``--speed 1`` it starts now), preceded by
      today's opening segment when that is already over.
    """
    tz = ZoneInfo(config.store.timezone or "Asia/Kolkata")
    st = config.store
    today = datetime.fromtimestamp(now, tz=tz).date()
    block_minutes = ONCE_MINUTES if scripted else minutes

    def build(block_start: float, with_open: float | None, with_close: float | None) -> StoreWorld:
        w = StoreWorld(config, settings, seed=seed, arrivals_per_hour=arrivals_per_hour)
        if with_open is not None:
            w.add_opening(with_open)
        w.add_block(block_start, block_minutes, scripted, incidents=incidents)
        if with_close is not None:
            w.add_closing(with_close)
        w.finalize()
        return w

    close_today = _local_ts(today, st.close_time or "22:00", tz)
    if close_today <= _local_ts(today, st.open_time or "10:00", tz):
        close_today += 86400
    if day is None and start is None and speed != 1 and now >= close_today + CLOSE_AFTER + 120:
        day = today
    if day is not None:
        open_ts = _local_ts(day, st.open_time or "10:00", tz)
        close_ts = _local_ts(day, st.close_time or "22:00", tz)
        if close_ts <= open_ts:
            close_ts += 86400
        if open_ts - OPEN_BEFORE > now:
            raise ValueError(f"{day} is in the future for store {st.id}")
        block_start = max(_local_ts(day, "13:00", tz), open_ts + 3 * 3600)
        if block_start + block_minutes * 60 + 1200 > close_ts - CLOSE_BEFORE:
            block_start = open_ts + OPEN_AFTER + 600
        w = build(block_start, open_ts, close_ts if close_ts + CLOSE_AFTER <= now else None)
        if w.segments[-1].t1 > now:  # today, still trading: keep only what already happened
            w = build(block_start, open_ts, None)
            if w.segments[-1].t1 > now:
                w = build(now - block_minutes * 60 - 30, open_ts if open_ts + OPEN_AFTER < now - block_minutes * 60 - 60 else None, None)
        return w
    open_ts = _local_ts(today, st.open_time or "10:00", tz)
    if start is None and speed == 1:
        return build(now, None, None)
    block_start = start if start is not None else now - block_minutes * 60.0
    w = build(block_start, None, None)
    if start is None and w.segments[-1].t1 > now:  # never produce timestamps in the future
        block_start -= w.segments[-1].t1 - now
    with_open = open_ts if (start is None and open_ts + OPEN_AFTER + 60 <= block_start) else None
    return build(block_start, with_open, None)


# ----------------------------------------------------------------------------- runner


@dataclass
class SimResult:
    counts: dict[str, int]
    world: dict[str, int]
    spool_pending: int
    sent_items: int
    start: str
    end: str
    segments: list[dict[str, Any]] = field(default_factory=list)
    detections: dict[str, int] = field(default_factory=dict)
    dates: list[str] = field(default_factory=list)


def merge_rules(config_rules: list[RuleSpec], world: StoreWorld) -> list[RuleSpec]:
    """Config rules + simulator rules for every incident a config rule would not catch."""
    out = list(config_rules)
    for sim in world.sim_rules:
        planned = [(t, cam) for typ, t, cam in world.incidents if typ == sim.type]
        if sim.type in ("HUDDLE_MEETING", "HYGIENE_CLEANING"):
            out.append(sim)  # window rules: always evaluate the scripted window
            continue
        covered = all(
            any(
                r.type == sim.type and r.active(t, world.tz) and (not r.zone_ids or any(z.id in r.zone_ids and z.camera_id == cam for z in world.config.zones))
                for r in config_rules
            )
            for t, cam in planned
        ) if planned else any(r.type == sim.type for r in config_rules)
        if not covered:
            out.append(sim)
    return out


def run_simulation(
    config: IngestConfig,
    settings: Settings,
    sink: OutputSink,
    *,
    minutes: float = 10.0,
    speed: float = 0.0,
    start: float | None = None,
    fps: float = 4.0,
    seed: int = 7,
    scripted: bool = False,
    arrivals_per_hour: float = 120.0,
    client: BackendClient | None = None,
    send_snapshots: bool = True,
    day: Date | None = None,
    now: float | None = None,
    snapshot_sec: float = 60.0,
    incidents: bool = True,
) -> SimResult:
    """Simulate the planned segments through the real analytics modules."""
    now = time.time() if now is None else now
    world = plan_world(
        config, settings, minutes=minutes, scripted=scripted, seed=seed, arrivals_per_hour=arrivals_per_hour,
        now=now, start=start, day=day, speed=speed, incidents=incidents,
    )
    for seg in world.segments:
        if seg.label == "traffic":
            seg.fps = fps
    cfg = world.config
    collector = ListSink()
    tee = TeeSink(sink, collector)
    rules = merge_rules(specs_from_config(config.ai_manager_rules), world)
    ctx = StoreContext(settings, cfg, tee, session=f"sim{seed}", ai_rules=rules)
    cams = cfg.active_cameras()
    procs = {c.id: CameraProcessor(c, cfg.zones_for(c.id), ctx, HintEstimator()) for c in cams}
    renderer = SceneRenderer(cams, cfg.zones, world.colours, world.shelf_fill, world.lights_on, world.tz, cfg.store.name, seed)
    ctx.frame_source = lambda cam, t: renderer.render(cam, t, world.tracks_at(cam, t), SNAP_W, SNAP_H, overlay=True)

    real_start = time.time()
    sim_elapsed = 0.0
    last_hb_real = last_flush_real = 0.0
    last_snap: dict[int, float] = {}
    last_proc: dict[int, float] = {}
    n_steps = 0
    for seg in world.segments:
        step = 1.0 / seg.fps
        t = seg.t0
        last_ops = t - 1.0
        while t <= seg.t1:
            for c in cams:
                busy = world.active(c.id, t)
                if not busy and t - last_proc.get(c.id, -1e18) < 1.0:
                    continue  # empty camera: analyse at 1 fps (lights, shelves, track loss)
                last_proc[c.id] = t
                tracks = world.tracks_at(c.id, t)
                frame = renderer.render(c.id, t, tracks, FRAME_W, FRAME_H)
                procs[c.id].process(frame, tracks, t)
                if send_snapshots and t - last_snap.get(c.id, -1e18) >= snapshot_sec:
                    last_snap[c.id] = t
                    big = renderer.render(c.id, t, tracks, SNAP_W, SNAP_H, overlay=True)
                    ctx.sink.emit_snapshot(SnapshotOut(c.id, "PERIODIC", t, encode_jpeg(big, 80)))
            if t - last_ops >= 1.0:
                ctx.tick_ops(t)
                last_ops = t
            n_steps += 1
            if n_steps % 400 == 0:
                world.prune(t)
            real_now = time.time()
            if client is not None:
                if real_now - last_hb_real >= settings.HEARTBEAT_SEC:
                    last_hb_real = real_now
                    client.heartbeat(HeartbeatPayload(version=f"{__version__}-sim", cameras=[CameraHeartbeat(camera_id=c.id, status="ONLINE", fps=fps) for c in cams]))
                if real_now - last_flush_real >= (settings.FLUSH_SEC if speed > 0 else 2.0) and callable(getattr(sink, "flush", None)):
                    last_flush_real = real_now
                    sink.flush()
                    client.drain()
            if speed > 0:
                delay = real_start + (sim_elapsed + t - seg.t0) / speed - time.time()
                if delay > 0:
                    time.sleep(delay)
            t += step
        sim_elapsed += seg.t1 - seg.t0
        for p in procs.values():
            p.close(seg.t1)
        ctx.tick_ops(seg.t1 + 1.0)
    end = world.segments[-1].t1 if world.segments else now
    ctx.tick_ops(end + 2.0)
    pending = sent = 0
    # any buffering sink — also a BackendSink wrapped in a TeeSink (--print-events) — must be flushed before the drain
    flush = getattr(sink, "flush", None)
    if callable(flush):
        flush()
    if client is not None:
        client.drain()
        pending = client.spool.pending_items()
        sent = client.sent_items
    det_counts = Counter(f"{d.type}:{d.status}" for d in collector.detections)
    dates = sorted({datetime.fromtimestamp(g.t0, tz=world.tz).strftime("%Y-%m-%d") for g in world.segments})
    return SimResult(
        collector.counts(), world.stats, pending, sent,
        _iso(world.segments[0].t0 if world.segments else now), _iso(end),
        [{"label": g.label, "from": _iso(g.t0), "to": _iso(g.t1)} for g in world.segments],
        dict(sorted(det_counts.items())), dates,
    )


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ----------------------------------------------------------------------------- CLI


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m congruence_eye_ai.simulate", description="Congruence Eye synthetic store simulator")
    p.add_argument("--backend", default=None, help="backend base URL (default: BACKEND_URL env / http://localhost:3000)")
    p.add_argument("--key", default=None, help="edge API key (default: EDGE_API_KEY env / dev-edge-key-store-1)")
    p.add_argument("--minutes", type=float, default=30.0, help="length of the random traffic block in minutes (default 30)")
    p.add_argument("--speed", type=float, default=60.0, help="simulation speed-up; 0 = as fast as possible (default 60)")
    p.add_argument("--start", default=None, help="ISO start of the traffic block (default: back-fill ending now; --speed 1 starts now)")
    p.add_argument("--date", default=None, help="simulate a whole store day YYYY-MM-DD (opening, traffic block, closing)")
    p.add_argument("--fps", type=float, default=4.0, help="processing frames per simulated second in the traffic block (default 4)")
    p.add_argument("--arrivals", type=float, default=120.0, help="shopper arrivals per hour (random block, default 120)")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--snapshot-sec", type=float, default=60.0, help="PERIODIC snapshot interval per camera in simulated seconds (default 60)")
    p.add_argument("--no-incidents", action="store_true", help="do not stage AI Manager incidents")
    p.add_argument("--once", action="store_true", help="deterministic scripted scenario, as fast as possible")
    p.add_argument("--config-file", default=None, help="use a local ingest-config JSON instead of GET /api/ingest/config")
    p.add_argument("--dry-run", action="store_true", help="do not contact the backend; print the summary (demo layout unless --config-file)")
    p.add_argument("--spool-dir", default="./spool-sim", help="offline spool for the simulator (default ./spool-sim)")
    p.add_argument("--print-events", action="store_true", help="print every generated payload as JSON lines")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    if not args.verbose:
        logging.getLogger("httpx").setLevel(logging.WARNING)
    overrides: dict[str, Any] = {"SPOOL_DIR": Path(args.spool_dir)}
    if args.backend:
        overrides["BACKEND_URL"] = args.backend
    if args.key:
        overrides["EDGE_API_KEY"] = args.key
    settings = Settings(**overrides)

    minutes, speed, scripted = args.minutes, args.speed, False
    if args.once:
        minutes, speed, scripted = ONCE_MINUTES, 0.0, True
    start = datetime.fromisoformat(args.start.replace("Z", "+00:00")).timestamp() if args.start else None
    day = Date.fromisoformat(args.date) if args.date else None

    client: BackendClient | None = None
    if args.config_file:
        config = IngestConfig.model_validate(json.loads(Path(args.config_file).read_text()))
    elif args.dry_run:
        config = demo_config()
    else:
        client = BackendClient(settings.BACKEND_URL, settings.EDGE_API_KEY, settings.SPOOL_DIR, retries=2)
        try:
            config = client.get_config()
        except Exception as exc:
            log.error("Cannot fetch %s/api/ingest/config with the given key: %s", settings.BACKEND_URL, exc)
            client.stop(final_drain=False)
            return 1
    if client is None and not args.dry_run:
        client = BackendClient(settings.BACKEND_URL, settings.EDGE_API_KEY, settings.SPOOL_DIR, retries=2)

    log.info(
        "Store %s (%s): %d cameras, %d zones, %d AI Manager rules. %s",
        config.store.id, config.store.name, len(config.active_cameras()), len(config.zones), len(config.ai_manager_rules),
        f"Day scenario {day}" if day else f"{minutes:.0f} min block at {'max' if speed == 0 else speed}x ({'scripted' if scripted else f'seed {args.seed}'})",
    )
    if not any(z.type == "ENTRY_LINE" for z in config.zones):
        log.warning("No ENTRY_LINE zone configured: no ENTRY/EXIT (footfall) events will be produced")

    sink: OutputSink = BackendSink(client) if client is not None else ListSink()
    if args.print_events:
        sink = TeeSink(sink, _PrintSink())
    try:
        res = run_simulation(
            config, settings, sink, minutes=minutes, speed=speed, start=start, fps=args.fps, seed=args.seed,
            scripted=scripted, arrivals_per_hour=args.arrivals, client=client, day=day, snapshot_sec=args.snapshot_sec,
            incidents=not args.no_incidents,
        )
    except ValueError as exc:
        log.error("%s", exc)
        return 2
    except KeyboardInterrupt:
        log.warning("Interrupted")
        return 130
    finally:
        if client is not None:
            client.stop(final_drain=False)
    summary = {
        "store": config.store.id,
        "dates": res.dates,
        "period": [res.start, res.end],
        "segments": res.segments,
        "generated": res.counts,
        "detections": res.detections,
        "world": res.world,
        "deliveredItems": res.sent_items,
        "spoolPendingItems": res.spool_pending,
    }
    print(json.dumps(summary, indent=2))
    if res.spool_pending:
        log.warning("%d items could not be delivered and remain in %s (they will be replayed next run)", res.spool_pending, settings.SPOOL_DIR)
        return 3
    return 0


class _PrintSink:
    def emit_event(self, ev: Any) -> None:
        print(json.dumps({"event": ev.to_payload()}))

    def emit_queue(self, snap: Any) -> None:
        print(json.dumps({"queue": snap.to_payload()}))

    def emit_storeops(self, ev: Any) -> None:
        print(json.dumps({"storeops": ev.to_payload()}))

    def emit_heatmap(self, hm: Any) -> None:
        print(json.dumps({"heatmap": {"cameraId": hm.camera_id, "ts": hm.ts, "total": sum(hm.grid)}}))

    def emit_snapshot(self, snap: Any) -> None:
        print(json.dumps({"snapshot": {"cameraId": snap.camera_id, "kind": snap.kind, "bytes": len(snap.jpeg)}}))

    def emit_bundle(self, b: Bundle) -> None:
        print(json.dumps({"bundle": {"snapshot": b.snapshot.kind if b.snapshot else None, "storeops": [e.to_payload() for e in b.storeops],
                                     "detections": [d.to_payload() for d in b.detections]}}))


if __name__ == "__main__":
    sys.exit(main())
