"""Per-camera analytics pipeline core (no I/O): tracks in -> contract payloads out.

``CameraProcessor.process(frame, tracks, t)`` is called once per processed frame by the camera
worker (real video) or by the simulator (synthetic frames + scripted tracks); both therefore
exercise exactly the same analytics code.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from .analytics import (
    DemographicsVoter,
    GroupDetector,
    HeatmapAccumulator,
    LineCounter,
    NullEstimator,
    QueueMonitor,
    ReIdGallery,
    StaffClassifier,
    StoreDwellTracker,
    StoreOpsConfig,
    StoreOpsMonitor,
    ZoneTracker,
    appearance_embedding,
    fallback_visitor_id,
    frame_stats,
)
from .aimanager.detectors import PHONE_CLASS, CameraAiManager, Finding, PersonObs
from .aimanager.rules import RuleSpec, specs_from_config
from .aimanager.shelf import ShelfReferenceStore
from .aimanager.store import StoreAiManager
from .analytics.demographics import AgeGenderEstimator
from .annotate import draw_annotations, encode_jpeg
from .config import Settings
from .detector import Track
from .geometry import BBox, Point, point_in_polygon
from .schemas import Camera, Detection, HeatmapPayload, IngestConfig, QueueSnapshot, StoreOpsEvent, VisitorEvent, Zone, iso
from .sink import Bundle, OutputSink, SnapshotOut

log = logging.getLogger(__name__)


def new_session_id(t: float | None = None) -> str:
    """Short base-36 id derived from the start time, so restarted trackers never reuse ids."""
    n = int((t or time.time()) * 1000)
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = chars[r] + s
    return s or "0"


class StoreContext:
    """Objects shared by all camera processors of one store."""

    def __init__(
        self,
        settings: Settings,
        config: IngestConfig,
        sink: OutputSink,
        session: str | None = None,
        ai_rules: list[RuleSpec] | None = None,
    ) -> None:
        self.settings = settings
        self.config = config
        self.sink = sink
        self.session = session or new_session_id()
        self.reid = ReIdGallery(settings.REID_THRESHOLD, settings.REID_WINDOW_SEC, settings.REID_REENTRY_SEC)
        self.dwell = StoreDwellTracker()
        self.visitor_groups: dict[str, str] = {}  # visitorId -> groupId of the open visit
        st = config.store
        self.ops = StoreOpsMonitor(
            StoreOpsConfig(
                timezone=st.timezone or "Asia/Kolkata",
                open_time=st.open_time or "10:00",
                close_time=st.close_time or "22:00",
                lights_off_brightness=settings.LIGHTS_OFF_BRIGHTNESS,
                lights_persist_sec=settings.LIGHTS_PERSIST_SEC,
                tamper_std=settings.TAMPER_STD,
                tamper_blur_ratio=settings.TAMPER_BLUR_RATIO,
                tamper_persist_sec=settings.TAMPER_PERSIST_SEC,
                staff_absent_sec=settings.STAFF_ABSENT_SEC,
                closed_idle_sec=settings.STORE_CLOSED_IDLE_SEC,
            )
        )
        self._ops_lock = threading.Lock()
        self.tz = ZoneInfo(st.timezone or "Asia/Kolkata")
        # AI Manager (contract v2)
        self.ai_rules: list[RuleSpec] = specs_from_config(config.ai_manager_rules) if ai_rules is None else list(ai_rules)
        self.store_ai = StoreAiManager(self.ai_rules, self.tz)
        self.shelf_refs = ShelfReferenceStore(settings.SPOOL_DIR)
        self.latest_frames: dict[int, np.ndarray] = {}
        self.latest_lit: dict[int, np.ndarray] = {}
        #: optional hook returning a (high-resolution) frame for snapshots, used by the simulator
        self.frame_source: Callable[[int, float], np.ndarray | None] | None = None
        self.ai_counts: dict[str, int] = {}

    def tick_ops(self, t: float) -> None:
        """Run store-level ops + AI Manager window rules and forward results to the sink."""
        with self._ops_lock:
            for e in self.ops.tick(t):
                ev = StoreOpsEvent(type=e.type, ts=iso(e.t), camera_id=e.camera_id, details=e.details)
                if e.type in ("STORE_OPENED", "STORE_CLOSED"):
                    cam = e.camera_id or self.default_camera_id()
                    kind = "OPENING" if e.type == "STORE_OPENED" else "CLOSING"
                    st = self.config.store
                    title = f"{st.name} - {'Store opened' if kind == 'OPENING' else 'Store closed'}"
                    snap = self.make_snapshot(cam, e.t, kind, title=title, prefer_lit=True) if cam is not None else None
                    dets: list[Detection] = []
                    if cam is not None:
                        sched = (st.open_time if kind == "OPENING" else st.close_time) or "10:00"
                        for f in self.store_ai.open_close_findings(e.type, e.t, cam, sched):
                            dets.append(self._detection(f))
                    self.sink.emit_bundle(Bundle(snap, [ev], dets))
                else:
                    self.sink.emit_storeops(ev)
            for f in self.store_ai.tick(t):
                self.emit_finding(f)

    def default_camera_id(self) -> int | None:
        cams = self.config.active_cameras()
        ent = next((c.id for c in cams if c.type == "ENTRANCE"), None)
        return ent if ent is not None else (cams[0].id if cams else None)

    # ------------------------------------------------------------------ AI Manager outputs
    def make_snapshot(
        self,
        camera_id: int,
        t: float,
        kind: str,
        boxes: list[tuple[BBox, str, tuple[int, int, int]]] | None = None,
        fills: list[tuple[BBox, tuple[int, int, int]]] | None = None,
        title: str | None = None,
        prefer_lit: bool = False,
    ) -> SnapshotOut | None:
        img = self.frame_source(camera_id, t) if self.frame_source else None
        if img is None and prefer_lit:
            img = self.latest_lit.get(camera_id)
        if img is None:
            img = self.latest_frames.get(camera_id)
        if img is None:
            # every detection (COMPLIED as well as BREACHED) should carry evidence: fall back to the last lit
            # frame of that camera when no current frame is available (e.g. a window rule closing at night)
            img = self.latest_lit.get(camera_id)
        if img is None:
            return None
        if boxes or fills or title:
            img = draw_annotations(img, boxes or [], fills or [], title)
        return SnapshotOut(camera_id, kind, t, encode_jpeg(img))

    def _detection(self, f: Finding) -> Detection:
        key = f"{f.rule.type}:{f.status}"
        self.ai_counts[key] = self.ai_counts.get(key, 0) + 1
        return Detection(
            rule_id=f.rule.rule_id,
            type=f.rule.type,  # type: ignore[arg-type]
            camera_id=f.camera_id,
            zone_id=f.zone_id if f.zone_id is not None and f.zone_id > 0 else None,
            ts=iso(f.t),
            status=f.status,  # type: ignore[arg-type]
            details=f.details[:1000],
            confidence=f.confidence,
        )

    def emit_finding(self, f: Finding) -> None:
        """Upload an annotated snapshot and the detection that references it."""
        title = f"{f.rule.name} - {f.status}" if f.status else f.details
        snap = self.make_snapshot(f.camera_id, f.t, f.snapshot_kind, f.boxes, f.fills, title)
        if f.status is None:
            if snap is not None:
                self.sink.emit_snapshot(snap)
            return
        self.sink.emit_bundle(Bundle(snap, [], [self._detection(f)]))


@dataclass
class _TrackState:
    first_seen: float
    last_seen: float
    bbox: tuple[float, float, float, float]
    foot: Point
    frames: int = 0
    visitor_id: str | None = None
    embedding: np.ndarray | None = None
    is_staff: bool = False
    in_staff_zone: bool = False
    meta: dict[str, Any] = field(default_factory=dict)


class CameraProcessor:
    """All analytics for one camera."""

    def __init__(
        self,
        camera: Camera,
        zones: list[Zone],
        ctx: StoreContext,
        estimator: AgeGenderEstimator | None = None,
    ) -> None:
        s = ctx.settings
        self.camera = camera
        self.camera_id = camera.id
        self.ctx = ctx
        self.zones = [z for z in zones if z.is_active]
        lines = [
            (z.id, tuple(z.polygon[0]), tuple(z.polygon[1]), z.in_direction or "UP")
            for z in self.zones
            if z.type == "ENTRY_LINE" and len(z.polygon) >= 2
        ]
        self.lines = LineCounter(lines, margin=s.LINE_MARGIN, min_frames=s.LINE_MIN_FRAMES)  # type: ignore[arg-type]
        self.sections = ZoneTracker(
            [(z.id, list(z.polygon)) for z in self.zones if z.type == "SECTION"],
            min_presence_sec=s.ZONE_MIN_PRESENCE_SEC,
            exit_grace_sec=s.ZONE_EXIT_GRACE_SEC,
        )
        self.staff_zones: list[list[Point]] = [list(z.polygon) for z in self.zones if z.type == "STAFF_ONLY"]
        self.queue_polys: list[list[Point]] = [list(z.polygon) for z in self.zones if z.type == "QUEUE"]
        self.queue = QueueMonitor(
            [(z.id, list(z.polygon)) for z in self.zones if z.type == "QUEUE"],
            min_presence_sec=s.QUEUE_MIN_PRESENCE_SEC,
            snapshot_sec=s.QUEUE_SNAPSHOT_SEC,
            unattended_sec=s.COUNTER_UNATTENDED_SEC,
        )
        self.groups = GroupDetector(s.GROUP_WINDOW_SEC, s.GROUP_MAX_DISTANCE)
        self.staff = StaffClassifier(
            s.STAFF_UNIFORM_HSV,
            min_ratio=s.STAFF_UNIFORM_MIN_RATIO,
            min_votes=s.STAFF_MIN_VOTES,
            zone_marks_staff=s.STAFF_ZONE_MODE == "mark_staff",
            zone_confirm_sec=s.STAFF_ZONE_CONFIRM_SEC,
        )
        self.demo = DemographicsVoter(estimator or NullEstimator(), max_samples=s.DEMOGRAPHICS_MAX_SAMPLES)
        self.heatmap = HeatmapAccumulator()
        self.tracks: dict[int, _TrackState] = {}
        self._pending_entries: dict[int, float] = {}
        self._last_stats_t: float | None = None
        self.counts: dict[str, int] = {"ENTRY": 0, "EXIT": 0, "ZONE_ENTER": 0, "ZONE_EXIT": 0}
        self.current_people = 0
        self.current_staff = 0
        self.last_t: float | None = None
        self._lock = threading.RLock()
        self.ai = CameraAiManager(
            camera.id,
            self.zones,
            ctx.ai_rules,
            ctx.tz,
            ctx.store_ai,
            ctx.shelf_refs,
            cooldown_sec=s.AI_COOLDOWN_SEC,
            shelf_check_sec=s.SHELF_CHECK_SEC,
            dark_brightness=s.LIGHTS_OFF_BRIGHTNESS,
        )

    # ------------------------------------------------------------------ main entry point
    def process(self, frame: np.ndarray | None, tracks: list[Track], t: float) -> None:
        """Feed one processed frame (``frame`` may be None when only tracks are known)."""
        with self._lock:
            self._process(frame, tracks, t)

    def _process(self, frame: np.ndarray | None, tracks: list[Track], t: float) -> None:
        s = self.ctx.settings
        self.last_t = t
        objects = [tr for tr in tracks if tr.cls != 0]
        if objects:
            tracks = [tr for tr in tracks if tr.cls == 0]
        if frame is not None:
            self.ctx.latest_frames[self.camera_id] = frame
        people: list[tuple[int, Point, bool]] = []
        staffed_by_zone = False
        any_staff = False

        for tr in tracks:
            st = self.tracks.get(tr.track_id)
            if st is None:
                st = self.tracks[tr.track_id] = _TrackState(t, t, tr.bbox, tr.foot, meta=dict(tr.meta))
            st.last_seen, st.bbox, st.foot = t, tr.bbox, tr.foot
            st.frames += 1
            if tr.meta:
                st.meta.update(tr.meta)
            # A STAFF_ONLY polygon that overlaps a QUEUE polygon must not turn queuing customers into
            # staff: positions inside a queue zone never count as staff-area presence.
            in_queue = any(point_in_polygon(tr.foot, p) for p in self.queue_polys)
            st.in_staff_zone = not in_queue and any(point_in_polygon(tr.foot, p) for p in self.staff_zones)
            st.is_staff = self.staff.observe(tr.track_id, frame, tr.bbox, st.in_staff_zone, t)
            if frame is not None and (st.frames <= 10 or st.frames % 5 == 0):
                emb = appearance_embedding(frame, tr.bbox)
                if emb is not None:
                    st.embedding = emb if st.embedding is None else _norm(0.8 * st.embedding + 0.2 * emb)
                    if st.visitor_id and not st.is_staff and st.frames % 25 == 0:
                        self.ctx.reid.update(st.visitor_id, st.embedding, t)
            if s.ENABLE_DEMOGRAPHICS:
                self.demo.observe(tr.track_id, frame, tr.bbox, st.meta)
            if not st.is_staff:
                self.heatmap.add(tr.track_id, tr.foot, t)
            people.append((tr.track_id, tr.foot, st.is_staff))
            staffed_by_zone |= st.in_staff_zone or (
                st.is_staff and in_queue and any(point_in_polygon(tr.foot, p) for p in self.staff_zones)
            )
            any_staff |= st.is_staff

            # entry line crossings
            for c in self.lines.update(tr.track_id, tr.foot, t):
                if c.kind == "ENTRY":
                    self._on_entry(tr.track_id, c.zone_id, c.t)
                else:
                    self._on_exit(tr.track_id, c.zone_id, c.t)
            # section zones
            for zt in self.sections.update(tr.track_id, tr.foot, t):
                self._emit_zone(zt.track_id, zt.zone_id, zt.kind, zt.t, zt.dwell_sec)
            # SOP: non-staff person in a staff-only zone
            if s.STAFF_ZONE_MODE == "breach" and st.in_staff_zone and not st.is_staff:
                if self.staff.zone_time(tr.track_id) >= s.SOP_BREACH_SEC:
                    self.ctx.ops.report_sop_breach(
                        self.camera_id,
                        f"staffzone-{tr.track_id}",
                        f"Non-staff person in staff-only area on camera {self.camera.name or self.camera_id}",
                        t,
                    )

        counter_staffed = staffed_by_zone if self.staff_zones else any_staff
        self.queue.update(people, counter_staffed, t)

        # AI Manager detectors
        if self.ai.enabled:
            obs = [
                PersonObs(tr.track_id, tr.bbox, tr.foot, self.tracks[tr.track_id].is_staff, self.staff.uniform_state(tr.track_id))
                for tr in tracks
            ]
            qlen = {z.zone_id: self.queue.length(z.zone_id) for z in self.queue.zones}
            phones = [o for o in objects if o.cls == PHONE_CLASS]
            for f in self.ai.update(t, obs, phones, frame, qlen):
                self.ctx.emit_finding(f)

        # release ENTRY events whose group window has passed
        self._release_entries(t)

        # lost tracks
        for tid in [tid for tid, st in self.tracks.items() if t - st.last_seen > s.TRACK_LOST_SEC]:
            self._end_track(tid, t)

        self.current_people = len(tracks)
        self.current_staff = sum(1 for p in people if p[2])
        self.ctx.ops.on_people(self.camera_id, self.current_people, self.current_staff, t)
        if frame is not None and (self._last_stats_t is None or t - self._last_stats_t >= 1.0):
            self._last_stats_t = t
            fs = frame_stats(frame)
            self.ctx.ops.on_frame_stats(self.camera_id, fs, t)
            if fs.brightness >= s.LIGHTS_OFF_BRIGHTNESS:
                self.ctx.latest_lit[self.camera_id] = frame
        self._tick(t)

    def tick(self, t: float) -> None:
        """Periodic outputs: queue snapshots, unattended counters, heatmap windows."""
        with self._lock:
            self._tick(t)

    def _tick(self, t: float) -> None:
        readings, alerts = self.queue.tick(t)
        for r in readings:
            self.ctx.sink.emit_queue(
                QueueSnapshot(
                    zone_id=r.zone_id,
                    ts=iso(r.t),
                    queue_length=r.queue_length,
                    avg_wait_sec=r.avg_wait_sec,
                    counter_staffed=r.counter_staffed,
                )
            )
        for a in alerts:
            self.ctx.sink.emit_storeops(
                StoreOpsEvent(
                    type="COUNTER_UNATTENDED",
                    ts=iso(a.t),
                    camera_id=self.camera_id,
                    details=f"zone {a.zone_id}: {a.queue_length} waiting, counter unattended for {int(a.unattended_sec)}s",
                )
            )
        if self.heatmap.due(t, self.ctx.settings.HEATMAP_SEC):
            self.flush_heatmap(t)

    def flush_heatmap(self, t: float) -> None:
        if self.heatmap.window_start is None:
            return
        grid = self.heatmap.flush()
        if any(grid):
            self.ctx.sink.emit_heatmap(HeatmapPayload(camera_id=self.camera_id, ts=iso(t), grid=grid))

    def close(self, t: float) -> None:
        """Flush everything (end all tracks, release entries, final heatmap)."""
        with self._lock:
            for tid in list(self.tracks):
                self._end_track(tid, t)
            self._release_entries(t + 1e6)
            self.flush_heatmap(t)

    # ------------------------------------------------------------------ helpers
    def track_key(self, track_id: int) -> str:
        return f"c{self.camera_id}-{self.ctx.session}-{track_id}"

    def _visitor(self, tid: int, t: float) -> str:
        st = self.tracks[tid]
        if st.visitor_id is None:
            if st.is_staff:
                st.visitor_id = fallback_visitor_id(self.camera_id, self.ctx.session, tid, prefix="s")
            else:
                st.visitor_id = self.ctx.reid.match_or_create(self.camera_id, tid, self.ctx.session, st.embedding, t)
        return st.visitor_id

    def _base_event(self, tid: int, type_: str, t: float, zone_id: int | None = None, **kw: Any) -> VisitorEvent:
        st = self.tracks[tid]
        gender, band = self.demo.result(tid) if self.ctx.settings.ENABLE_DEMOGRAPHICS else ("U", "U")
        return VisitorEvent(
            camera_id=self.camera_id,
            zone_id=zone_id,
            type=type_,  # type: ignore[arg-type]
            ts=iso(t),
            track_id=self.track_key(tid),
            visitor_id=self._visitor(tid, t),
            is_staff=st.is_staff,
            gender=gender,  # type: ignore[arg-type]
            age_band=band,  # type: ignore[arg-type]
            **kw,
        )

    def _emit(self, ev: VisitorEvent) -> None:
        self.counts[ev.type] += 1
        self.ctx.sink.emit_event(ev)

    def _on_entry(self, tid: int, zone_id: int, t: float) -> None:
        st = self.tracks[tid]
        if st.is_staff:
            self._emit_entry(tid, zone_id, t, None)
            return
        self.groups.add(str(tid), t, st.bbox)
        self._pending_entries[tid] = t
        st.meta["_entry_zone"] = zone_id

    def _emit_entry(self, tid: int, zone_id: int, t: float, group_id: str | None) -> None:
        ev = self._base_event(tid, "ENTRY", t, zone_id, group_id=group_id)
        self.ctx.dwell.register_entry(ev.visitor_id, t)
        if group_id:
            self.ctx.visitor_groups[ev.visitor_id] = group_id
            if len(self.ctx.visitor_groups) > 20000:
                self.ctx.visitor_groups.clear()
        self._emit(ev)

    def _release_entries(self, now: float, force_tid: int | None = None) -> None:
        if not self._pending_entries:
            return
        for key, gid in self.groups.release(now, None if force_tid is None else str(force_tid)):
            tid = int(key)
            t = self._pending_entries.pop(tid, None)
            if t is None or tid not in self.tracks:
                continue
            self._emit_entry(tid, self.tracks[tid].meta.pop("_entry_zone", 0), t, gid)

    def _on_exit(self, tid: int, zone_id: int, t: float) -> None:
        if tid in self._pending_entries:
            self._release_entries(t, force_tid=tid)
        vid = self._visitor(tid, t)
        dwell = self.ctx.dwell.dwell_for_exit(vid, t)
        gid = self.ctx.visitor_groups.pop(vid, None)
        self._emit(self._base_event(tid, "EXIT", t, zone_id, dwell_sec=dwell, group_id=gid))
        if not self.tracks[tid].is_staff:
            self.ctx.reid.close(vid, t)

    def _emit_zone(self, tid: int, zone_id: int, kind: str, t: float, dwell: float | None) -> None:
        self._emit(self._base_event(tid, kind, t, zone_id, dwell_sec=dwell if kind == "ZONE_EXIT" else None))

    def _end_track(self, tid: int, t: float) -> None:
        if tid in self._pending_entries:
            self._release_entries(t, force_tid=tid)
        st = self.tracks[tid]
        for zt in self.sections.end_track(tid, t):
            self._emit_zone(tid, zt.zone_id, zt.kind, zt.t, zt.dwell_sec)
        self.queue.end_track(tid, t)
        self.lines.end_track(tid)
        if st.visitor_id is not None:
            self.ctx.reid.release(st.visitor_id, self.camera_id, tid, t)
        self.staff.end_track(tid)
        self.demo.end_track(tid)
        self.heatmap.end_track(tid)
        del self.tracks[tid]

    def status(self) -> dict[str, Any]:
        with self._lock:
            return self._status()

    def _status(self) -> dict[str, Any]:
        return {
            "counts": dict(self.counts),
            "currentPeople": self.current_people,
            "currentStaff": self.current_staff,
            "queues": [
                {"zoneId": z.zone_id, "queueLength": r.queue_length, "avgWaitSec": r.avg_wait_sec, "counterStaffed": r.counter_staffed}
                for z in self.queue.zones
                for r in [self.queue.reading(z.zone_id, self.last_t or time.time())]
            ],
        }


def _norm(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n else v
