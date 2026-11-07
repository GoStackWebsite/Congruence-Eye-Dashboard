"""End-to-end pipeline: FakeDetector with scripted tracks -> CameraProcessor -> exact contract events."""

from __future__ import annotations

import numpy as np
import pytest

from congruence_eye_ai.analytics.demographics import HintEstimator
from congruence_eye_ai.config import Settings
from congruence_eye_ai.detector import FakeDetector, Track
from congruence_eye_ai.processor import CameraProcessor, StoreContext
from congruence_eye_ai.schemas import IngestConfig, iso
from congruence_eye_ai.sink import ListSink

from .conftest import paint_person
from .test_staff import UNIFORM

T0 = 1_790_000_000.0  # 2026-09-21 (inside the store's 00:00-23:59 business hours)
DT = 0.2


def box(x: float, y: float) -> tuple[float, float, float, float]:
    return (x - 0.03, y - 0.3, x + 0.03, y)


def position(script: list[tuple[float, float, tuple[float, float]]], t: float):
    for a, b, p in script:
        if a - 1e-6 <= t <= b + 1e-6:
            return p
    return None


SCRIPTS: dict[int, list[tuple[float, float, tuple[float, float]]]] = {
    # shopper A: enters, browses the Promo section, queues, leaves
    1: [(0.0, 1.0, (0.25, 0.8)), (1.2, 3.8, (0.25, 0.2)), (4.0, 13.8, (0.75, 0.25)), (14.0, 39.8, (0.75, 0.75)), (40.0, 40.8, (0.75, 0.2)), (41.0, 41.8, (0.25, 0.2)), (42.0, 44.0, (0.25, 0.8))],
    # shopper B: enters together with A, then leaves the camera view
    2: [(0.0, 1.2, (0.35, 0.8)), (1.4, 3.0, (0.35, 0.2))],
    # cashier standing in the STAFF_ONLY zone the whole time
    3: [(0.0, 60.0, (0.96, 0.75))],
    # shopper C enters alone much later
    4: [(20.0, 21.0, (0.05, 0.8)), (21.2, 23.0, (0.05, 0.2))],
}


def scripted_frames(n: int) -> list[list[Track]]:
    frames = []
    for k in range(n):
        t = round(k * DT, 1)
        tracks = []
        for tid, script in SCRIPTS.items():
            p = position(script, t)
            if p is not None:
                tracks.append(Track(tid, box(*p), 0.9))
        frames.append(tracks)
    return frames


def run_pipeline(settings: Settings, cfg: IngestConfig, n_frames: int = 301) -> tuple[ListSink, CameraProcessor, StoreContext]:
    sink = ListSink()
    ctx = StoreContext(settings, cfg, sink, session="test")
    proc = CameraProcessor(cfg.cameras[0], cfg.zones_for(10), ctx)
    det = FakeDetector(scripted_frames(n_frames))
    for k in range(n_frames):
        t = T0 + round(k * DT, 1)
        proc.process(None, det.track(None, t), t)
        ctx.tick_ops(t)
    proc.close(T0 + 60.2)
    return sink, proc, ctx


def test_scripted_tracks_produce_exact_events(settings: Settings, store_config: IngestConfig) -> None:
    sink, proc, ctx = run_pipeline(settings, store_config)
    got = [(e.type, e.track_id, e.zone_id, e.ts, e.dwell_sec, e.is_staff) for e in sink.events]
    key = proc.track_key
    assert got == [
        ("ENTRY", key(1), 100, iso(T0 + 1.4), None, False),
        ("ENTRY", key(2), 100, iso(T0 + 1.6), None, False),
        ("ZONE_ENTER", key(1), 101, iso(T0 + 4.0), None, False),
        ("ZONE_EXIT", key(1), 101, iso(T0 + 13.8), 9.8, False),
        ("ENTRY", key(4), 100, iso(T0 + 21.4), None, False),
        ("EXIT", key(1), 100, iso(T0 + 42.2), 40.8, False),
    ]
    entries = [e for e in sink.events if e.type == "ENTRY"]
    # A and B entered together -> same group, C alone
    assert entries[0].group_id is not None and entries[0].group_id == entries[1].group_id
    assert entries[2].group_id is None
    # EXIT carries the group and the same visitorId as the ENTRY
    exit_ev = sink.events[-1]
    assert exit_ev.visitor_id == entries[0].visitor_id and exit_ev.group_id == entries[0].group_id
    assert len({e.visitor_id for e in entries}) == 3
    assert all(e.gender == "U" and e.age_band == "U" for e in sink.events)
    # queue snapshots every 30 s: empty, A waiting 16 s, empty again
    q = [(s.ts, s.queue_length, s.avg_wait_sec, s.counter_staffed) for s in sink.queue]
    assert q == [(iso(T0), 0, 0.0, True), (iso(T0 + 30.0), 1, 16.0, True), (iso(T0 + 60.0), 0, 0.0, True)]
    assert list(proc.queue.zones[0].completed)[0][1] == pytest.approx(25.8)
    # cashier became staff via the staff-only zone; no unattended alerts
    assert not any(o.type == "COUNTER_UNATTENDED" for o in sink.storeops)
    assert [o.type for o in sink.storeops] == ["STORE_OPENED"]
    # heatmap flushed on close, excluding the cashier
    assert len(sink.heatmaps) == 1 and sum(sink.heatmaps[0].grid) > 0
    cashier_cell = int(0.75 * 18) * 32 + int(0.96 * 32)
    assert sink.heatmaps[0].grid[cashier_cell] <= 6  # only until confirmed as staff (5 s), not 60 s
    # every payload is contract-valid when serialised
    for e in sink.events:
        assert set(e.to_payload()) <= {"cameraId", "zoneId", "type", "ts", "trackId", "visitorId", "isStaff", "groupId", "gender", "ageBand", "dwellSec"}
    assert proc.counts == {"ENTRY": 3, "EXIT": 1, "ZONE_ENTER": 1, "ZONE_EXIT": 1}
    assert ctx.dwell.occupancy() == 2  # B and C never exited


def test_unattended_counter_when_cashier_absent(settings: Settings, store_config: IngestConfig) -> None:
    sink = ListSink()
    ctx = StoreContext(settings, store_config, sink, session="u")
    proc = CameraProcessor(store_config.cameras[0], store_config.zones_for(10), ctx)
    for k in range(0, 500):
        t = T0 + k * DT
        proc.process(None, [Track(1, box(0.75, 0.75))], t)
    alerts = [o for o in sink.storeops if o.type == "COUNTER_UNATTENDED"]
    assert len(alerts) == 1 and alerts[0].camera_id == 10
    assert sink.queue[-1].counter_staffed is False


def test_sop_breach_mode(tmp_path, store_config: IngestConfig) -> None:
    s = Settings(_env_file=None, SPOOL_DIR=tmp_path, STAFF_ZONE_MODE="breach", SOP_BREACH_SEC=10)  # type: ignore[call-arg]
    sink = ListSink()
    ctx = StoreContext(s, store_config, sink, session="b")
    proc = CameraProcessor(store_config.cameras[0], store_config.zones_for(10), ctx)
    for k in range(0, 100):
        t = T0 + k * DT
        proc.process(None, [Track(7, box(0.96, 0.75))], t)
        ctx.tick_ops(t)
    breaches = [o for o in sink.storeops if o.type == "SOP_BREACH"]
    assert len(breaches) == 1 and breaches[0].camera_id == 10
    assert not proc.staff.is_staff(7)


def _frame_with(people: list[tuple[tuple[float, float, float, float], tuple[int, int, int], tuple[int, int, int]]]) -> np.ndarray:
    f = np.random.RandomState(1).randint(90, 140, (360, 640, 3)).astype(np.uint8)
    for b, shirt, pants in people:
        paint_person(f, b, shirt, pants)
    return f


def test_frames_uniform_staff_and_cross_camera_reid(settings: Settings) -> None:
    cfg = IngestConfig.model_validate(
        {
            "store": {"id": 1, "name": "S", "openTime": "00:00", "closeTime": "23:59"},
            "cameras": [{"id": 1, "name": "Entrance"}, {"id": 2, "name": "Floor"}],
            "zones": [
                {"id": 1, "cameraId": 1, "name": "Door", "type": "ENTRY_LINE", "polygon": [[0.0, 0.5], [1.0, 0.5]], "inDirection": "UP"},
                {"id": 2, "cameraId": 2, "name": "Sarees", "type": "SECTION", "polygon": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]},
            ],
        }
    )
    sink = ListSink()
    ctx = StoreContext(settings, cfg, sink, session="f")
    cam1 = CameraProcessor(cfg.cameras[0], cfg.zones_for(1), ctx, HintEstimator())
    cam2 = CameraProcessor(cfg.cameras[1], cfg.zones_for(2), ctx, HintEstimator())
    red, blue = (30, 30, 200), (160, 80, 20)
    t = T0
    # customer (track 5) and staff in uniform (track 6) walk in on camera 1
    for k in range(20):
        y = 0.9 - k * 0.04
        b5, b6 = box(0.3, y), box(0.7, y)
        frame = _frame_with([(b5, red, blue), (b6, UNIFORM, (40, 40, 40))])
        tracks = [Track(5, b5, meta={"gender": "F", "ageBand": "25-34"}), Track(6, b6)]
        cam1.process(frame, tracks, t)
        t += DT
    for _ in range(25):
        cam1.process(None, [], t)
        t += DT
    # the customer later appears on camera 2 (new tracker id 1)
    for k in range(30):
        b = box(0.5, 0.6)
        cam2.process(_frame_with([(b, red, blue)]), [Track(1, b, meta={"gender": "F", "ageBand": "25-34"})], t)
        t += DT
    cam2.close(t)
    entries = {e.track_id.rsplit("-", 1)[1]: e for e in sink.events if e.type == "ENTRY"}
    assert entries["6"].is_staff is True and entries["6"].visitor_id.startswith("s-") and entries["6"].group_id is None
    assert entries["5"].is_staff is False
    assert entries["5"].gender == "F" and entries["5"].age_band == "25-34"
    zone = [e for e in sink.events if e.type == "ZONE_ENTER"]
    assert len(zone) == 1 and zone[0].camera_id == 2
    assert zone[0].visitor_id == entries["5"].visitor_id  # re-identified across cameras


def test_overlapping_queue_and_staff_zone(settings: Settings) -> None:
    """Queuing customers inside a STAFF_ONLY polygon that overlaps the QUEUE polygon stay customers."""
    poly = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]
    cfg = IngestConfig.model_validate(
        {
            "store": {"id": 1, "name": "S", "openTime": "00:00", "closeTime": "23:59"},
            "cameras": [{"id": 3, "name": "Billing"}],
            "zones": [
                {"id": 5, "cameraId": 3, "name": "Q", "type": "QUEUE", "polygon": poly},
                {"id": 6, "cameraId": 3, "name": "Staff", "type": "STAFF_ONLY", "polygon": poly},
            ],
        }
    )
    sink = ListSink()
    ctx = StoreContext(settings, cfg, sink, session="o")
    proc = CameraProcessor(cfg.cameras[0], cfg.zones_for(3), ctx)
    for k in range(200):  # 40 s, two customers queuing, nobody in uniform
        t = T0 + k * DT
        proc.process(None, [Track(1, box(0.2, 0.3)), Track(2, box(0.3, 0.3))], t)
    assert not proc.staff.is_staff(1) and not proc.staff.is_staff(2)
    assert sink.queue[-1].queue_length == 2 and sink.queue[-1].counter_staffed is False


# ----------------------------------------------------------------------------- AI Manager through the processor


def _ai_rule(type_: str, **params):
    from congruence_eye_ai.aimanager.rules import RuleSpec
    from congruence_eye_ai.schemas import AiManagerRule

    return RuleSpec.from_model(AiManagerRule(id=7, name=f"{type_} rule", type=type_, params=params))


def test_processor_phone_detection_with_annotated_snapshot(settings: Settings, store_config: IngestConfig) -> None:
    import cv2

    from congruence_eye_ai.schemas import DetectionsPayload

    sink = ListSink()
    ctx = StoreContext(settings, store_config, sink, session="ai", ai_rules=[_ai_rule("MOBILE_USAGE")])
    proc = CameraProcessor(store_config.cameras[0], store_config.zones_for(10), ctx)
    frame = np.full((360, 640, 3), 128, np.uint8)
    cashier = box(0.96, 0.75)
    phone = (cashier[2] - 0.02, cashier[1] + 0.1, cashier[2] - 0.005, cashier[1] + 0.14)
    for k in range(0, 160):  # 32 s: becomes staff after 5 s in the staff-only zone, then 20 s on the phone
        t = T0 + k * DT
        proc.process(frame, [Track(1, cashier), Track(77, phone, 0.55, cls=67)], t)
    dets = [b for b in sink.bundles if b.detections]
    assert len(dets) == 1
    d = dets[0].detections[0]
    assert (d.type, d.status, d.rule_id, d.camera_id) == ("MOBILE_USAGE", "BREACHED", 7, 10)
    assert iso(T0 + 25.0) <= d.ts <= iso(T0 + 26.0)
    DetectionsPayload.model_validate({"detections": [d.to_payload()]})
    snap = dets[0].snapshot
    assert snap is not None and snap.kind == "AI_MANAGER" and snap.camera_id == 10
    img = cv2.imdecode(np.frombuffer(snap.jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (360, 640, 3) and (img[..., 2] > 200).sum() > 100  # red annotation drawn
    # phones never become visitor tracks
    assert all(not e.track_id.endswith("-77") for e in sink.events)


def test_store_opened_bundle_with_opening_snapshot(settings: Settings, store_config: IngestConfig) -> None:
    sink = ListSink()
    ctx = StoreContext(settings, store_config, sink, session="oc", ai_rules=[_ai_rule("STORE_OPEN_CLOSE")])
    proc = CameraProcessor(store_config.cameras[0], store_config.zones_for(10), ctx)
    lit = np.random.RandomState(0).randint(90, 200, (180, 320, 3)).astype(np.uint8)
    for k in range(10):
        proc.process(lit, [Track(1, box(0.3, 0.8))], T0 + k)
        ctx.tick_ops(T0 + k)
    opened = [b for b in sink.bundles if b.storeops and b.storeops[0].type == "STORE_OPENED"]
    assert len(opened) == 1
    b = opened[0]
    assert b.snapshot is not None and b.snapshot.kind == "OPENING"
    assert [d.type for d in b.detections] == ["STORE_OPEN_CLOSE"]
    # store opens 00:00 in this fixture; T0 is 19:43 local -> far outside the 10 min tolerance
    assert b.detections[0].status == "BREACHED" and "late" in (b.detections[0].details or "")
