"""QA edge-case plan §8 (docs/qa/EDGE_CASE_PLAN.md): spool idempotency, backoff, config refresh, stream
drop/reconnect, low FPS, line jitter, simultaneous crossings, groups, night-time, UTC timestamps."""

from __future__ import annotations

import copy
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pytest

from congruence_eye_ai.analytics.storeops import frame_stats
from congruence_eye_ai.backend_client import BackendClient
from congruence_eye_ai.camera_worker import CameraWorker
from congruence_eye_ai.config import Settings
from congruence_eye_ai.detector import FakeDetector, ScriptedDetector, Track
from congruence_eye_ai.processor import CameraProcessor, StoreContext
from congruence_eye_ai.schemas import IngestConfig, VisitorEvent, iso
from congruence_eye_ai.sink import ListSink
from congruence_eye_ai.store_runner import StoreRunner

from .test_backend_client import CONFIG, FakeBackend, ev, make_client
from .test_pipeline_e2e import T0, box
from .test_runner_api import video, worker_settings  # noqa: F401  (fixture re-export)
from .test_storeops_health import DARK, LIT, monitor, ts as local_ts, types

# ----------------------------------------------------------------------------- spool / client


class IdempotentBackend(FakeBackend):
    """Fake backend that remembers X-Batch-Id like the real one and can 'lose' a response once."""

    def __init__(self) -> None:
        super().__init__()
        self.seen: dict[str, dict] = {}
        self.batch_ids: list[str] = []
        self.lose_next_response = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        bid = request.headers.get("x-batch-id")
        if bid:
            self.batch_ids.append(bid)
        if bid and bid in self.seen:
            return httpx.Response(200, json={**self.seen[bid], "duplicate": True})
        res = super().handler(request)
        if bid and res.status_code < 300:
            self.seen[bid] = res.json()
        if self.lose_next_response:
            self.lose_next_response = False
            raise httpx.ReadTimeout("response lost", request=request)
        return res


def test_retry_after_lost_response_reuses_the_batch_id_and_is_not_double_counted(tmp_path: Path) -> None:
    be = IdempotentBackend()
    c = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(be.handler), sleep=lambda s: None, retries=0)
    c.enqueue_events([ev(i) for i in range(3)])
    be.lose_next_response = True  # backend processed it, the edge never saw the 2xx
    assert c.drain() == 0 and c.spool.pending_items() == 3
    # new data arrives meanwhile: it must NOT be merged into the in-flight batch
    c.enqueue_events([ev(i) for i in range(3, 5)])
    assert c.drain() == 5
    events_posts = [b for _, p, b in be.requests if p == "/api/ingest/events"]
    assert be.batch_ids[0] == be.batch_ids[1]  # the replay carried the same id
    assert be.batch_ids[2] != be.batch_ids[0]
    assert [len(b["events"]) for b in events_posts] == [3, 2]  # replay answered from the idempotency store
    assert [e["trackId"] for e in be.events] == [f"t{i}" for i in range(5)]
    c.stop()


def test_spool_survives_restart_and_replays_in_order_with_the_same_batch_ids(tmp_path: Path) -> None:
    be = IdempotentBackend()
    be.up = False
    c1 = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(be.handler), sleep=lambda s: None, retries=0, max_batch=4)
    c1.enqueue_events([ev(i) for i in range(6)])
    c1.enqueue_events([ev(i) for i in range(6, 10)])
    assert c1.drain() == 0  # first batch handed out (and failed) → its id is persisted
    first = c1.spool.next_batch("events", 4)
    assert first is not None and first.batch_id
    c1.stop(final_drain=False)
    # process restart: the same rows come back under the same id, then the rest in order
    be.up = True
    c2 = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(be.handler), sleep=lambda s: None, retries=0, max_batch=4)
    again = c2.spool.next_batch("events", 4)
    assert again is not None and again.batch_id == first.batch_id and again.ids == first.ids
    assert c2.drain() == 10
    assert [e["trackId"] for e in be.events] == [f"t{i}" for i in range(10)]
    # [failed attempt before the restart, its replay after it, batch 2, batch 3]
    assert be.batch_ids[0] == be.batch_ids[1] == first.batch_id and len(set(be.batch_ids)) == 3
    c2.stop()


def test_old_spool_without_batch_column_is_migrated(tmp_path: Path) -> None:
    import sqlite3

    db = sqlite3.connect(tmp_path / "spool.db")
    db.execute("CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL, n INTEGER NOT NULL, created REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)")
    db.execute("INSERT INTO outbox(kind, body, n, created) VALUES ('events', ?, 1, 0)", (json.dumps([ev(1).to_payload()]),))
    db.commit()
    db.close()
    be = FakeBackend()
    c = make_client(be, tmp_path)
    assert c.drain() == 1 and be.events[0]["trackId"] == "t1"
    c.stop()


def test_backend_500_and_timeouts_back_off_then_deliver_once(tmp_path: Path) -> None:
    be = IdempotentBackend()
    sleeps: list[float] = []
    c = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(be.handler), sleep=sleeps.append, retries=3)
    # direct requests (heartbeat) retry with exponential backoff capped at 8 s
    be.status_override = 503
    assert c.heartbeat(__import__("congruence_eye_ai.schemas", fromlist=["HeartbeatPayload"]).HeartbeatPayload(version="t", cameras=[])) is False
    assert sleeps == [0.5]  # heartbeat: retries=1
    c.enqueue_events([ev(1)])
    for _ in range(3):
        assert c.drain() == 0  # spooled data: no blocking retries, kept for the sender loop's backoff
    be.status_override = None
    assert c.drain() == 1
    assert len(be.events) == 1
    assert c.spool.count() == 0 and c.online is True
    c.stop()


def test_sender_loop_backoff_grows_while_offline(tmp_path: Path) -> None:
    be = FakeBackend()
    be.up = False
    c = make_client(be, tmp_path)
    waits: list[float] = []
    real_wait = c._wake.wait

    def fake_wait(timeout: float | None = None) -> bool:
        waits.append(timeout or 0)
        if len(waits) >= 4:
            c._stop.set()
        return real_wait(0)

    c._wake.wait = fake_wait  # type: ignore[method-assign]
    c.enqueue_events([ev(1)])
    c._run()
    assert waits[:4] == [1.0, 2.0, 4.0, 8.0]
    c.stop(final_drain=False)


def test_403_for_another_stores_camera_is_dead_lettered_not_retried_forever(tmp_path: Path) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"statusCode": 403, "message": "cameraId 7 belongs to another store"})

    c = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(handler), sleep=lambda s: None, retries=0)
    c.enqueue_events([ev(1)])
    c.drain()
    assert c.spool.count() == 0 and c.spool.dead_count() == 1
    # a plain 403 (proxy / WAF) is still retried
    c2 = BackendClient("http://b", "k", tmp_path / "b", transport=httpx.MockTransport(lambda r: httpx.Response(403, text="Forbidden")), sleep=lambda s: None, retries=0)
    c2.enqueue_events([ev(1)])
    assert c2.drain() == 0 and c2.spool.count() == 1 and c2.spool.dead_count() == 0
    c.stop()
    c2.stop()


def test_bundle_steps_carry_derived_batch_ids(tmp_path: Path) -> None:
    be = IdempotentBackend()
    c = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(be.handler), sleep=lambda s: None, retries=0)
    c.enqueue_bundle((1, "AI_MANAGER", T0, b"\xff\xd8\xff\xe0jpeg"), [{"type": "STORE_OPENED", "ts": iso(T0)}], [{"type": "MOBILE_USAGE", "cameraId": 1, "ts": iso(T0), "status": "COMPLIED"}])
    c.drain()
    base = be.batch_ids[0].split(":")[0]
    assert be.batch_ids == [f"{base}:snap", f"{base}:storeops", f"{base}:detections"]
    assert all(len(b) <= 64 for b in be.batch_ids)
    c.stop()


# ----------------------------------------------------------------------------- runner / worker


def test_config_refresh_removing_a_camera_stops_its_worker(tmp_path: Path) -> None:
    s = worker_settings(tmp_path)
    be = FakeBackend()
    client = BackendClient("http://b", "k", s.SPOOL_DIR, transport=httpx.MockTransport(be.handler), sleep=lambda x: None)
    runner = StoreRunner(s, client=client, detector_factory=lambda: ScriptedDetector(lambda t: []))
    cfg = copy.deepcopy(CONFIG)
    cfg["cameras"].append({"id": 2, "storeId": 1, "name": "Floor", "rtspUrl": None, "type": "ZONE", "isActive": True})
    try:
        assert sorted(runner.apply_config(IngestConfig.model_validate(cfg))["started"]) == [1, 2]
        w2 = runner.workers[2]
        cfg2 = copy.deepcopy(cfg)
        cfg2["cameras"] = [c for c in cfg2["cameras"] if c["id"] != 2]  # deleted in the web app
        res = runner.apply_config(IngestConfig.model_validate(cfg2))
        assert res["stopped"] == [2] and res["started"] == []
        w2.join(timeout=5)
        assert not w2.is_alive() and 2 not in runner.workers
        assert runner.workers[1].is_alive()
    finally:
        runner.stop()


def test_stream_drop_goes_offline_then_reconnects(tmp_path: Path, video: str) -> None:  # noqa: F811
    s = worker_settings(tmp_path)
    cfg = IngestConfig.model_validate(CONFIG)
    proc = CameraProcessor(cfg.cameras[0], [], StoreContext(s, cfg, ListSink()))
    target = tmp_path / "late.avi"
    w = CameraWorker(proc, str(target), lambda: ScriptedDetector(lambda t: []), s)
    w.start()
    try:
        deadline = time.time() + 5
        while time.time() < deadline and w.status()["status"] != "OFFLINE":
            time.sleep(0.1)
        assert w.status()["status"] == "OFFLINE"  # → OFFLINE heartbeat with a reason
        shutil.copy(video, target)  # the DVR channel comes back
        deadline = time.time() + 15
        while time.time() < deadline and w.health.processed < 3:
            time.sleep(0.1)
        assert w.health.processed >= 3
    finally:
        w.stop()
        w.join(timeout=5)


# ----------------------------------------------------------------------------- counting


def run_tracks(settings: Settings, cfg: IngestConfig, frames: list[tuple[float, list[Track]]]) -> ListSink:
    sink = ListSink()
    ctx = StoreContext(settings, cfg, sink, session="qa")
    proc = CameraProcessor(cfg.cameras[0], cfg.zones_for(10), ctx)
    for t, tracks in frames:
        proc.process(None, tracks, t)
    proc.close(frames[-1][0] + 1)
    return sink


def walk(tid: int, x: float, ys: list[float], dt: float, t0: float = T0) -> list[tuple[float, list[Track]]]:
    return [(t0 + k * dt, [Track(tid, box(x, y), 0.9)]) for k, y in enumerate(ys)]


def merge(*runs: list[tuple[float, list[Track]]]) -> list[tuple[float, list[Track]]]:
    by_t: dict[float, list[Track]] = {}
    for r in runs:
        for t, tr in r:
            by_t.setdefault(round(t, 3), []).extend(tr)
    return sorted(by_t.items())


def test_person_standing_on_the_entry_line_is_not_counted(settings: Settings, store_config: IngestConfig) -> None:
    rs = np.random.RandomState(1)
    ys = [0.8, 0.8, 0.8] + list(0.5 + rs.uniform(-0.012, 0.012, 300))  # loiters on the line for 60 s
    sink = run_tracks(settings, store_config, walk(1, 0.25, ys, 0.2))
    assert [e.type for e in sink.events if e.type in ("ENTRY", "EXIT")] == []


def test_two_people_crossing_simultaneously_are_two_entries_in_one_group(settings: Settings, store_config: IngestConfig) -> None:
    ys = [0.8] * 3 + [0.6, 0.5, 0.4, 0.3, 0.2, 0.2, 0.2]
    sink = run_tracks(settings, store_config, merge(walk(1, 0.2, ys, 0.2), walk(2, 0.3, ys, 0.2)))
    entries = [e for e in sink.events if e.type == "ENTRY"]
    assert len(entries) == 2 and len({e.track_id for e in entries}) == 2
    assert entries[0].group_id is not None and entries[0].group_id == entries[1].group_id


def test_group_of_four_shares_one_group_id(settings: Settings, store_config: IngestConfig) -> None:
    ys = [0.8] * 3 + [0.6, 0.5, 0.4, 0.3, 0.2, 0.2, 0.2]
    runs = [walk(tid, x, ys, 0.2, T0 + 0.4 * i) for i, (tid, x) in enumerate([(1, 0.1), (2, 0.2), (3, 0.3), (4, 0.4)])]
    sink = run_tracks(settings, store_config, merge(*runs))
    entries = [e for e in sink.events if e.type == "ENTRY"]
    assert len(entries) == 4
    assert len({e.group_id for e in entries}) == 1 and entries[0].group_id is not None


def test_very_low_fps_and_dropped_frames_still_count_once(settings: Settings, store_config: IngestConfig) -> None:
    # 1 fps: the crossing is seen in only a few frames
    sink = run_tracks(settings, store_config, walk(1, 0.25, [0.8, 0.8, 0.3, 0.2, 0.2, 0.2], 1.0))
    assert [e.type for e in sink.events if e.type == "ENTRY"] == ["ENTRY"]
    # frame drops (gaps of 3 s) around the line at 5 fps
    frames = walk(2, 0.25, [0.8, 0.8, 0.8, 0.7, 0.3, 0.25, 0.2, 0.2, 0.2], 0.2, T0 + 100)
    dropped = [f for i, f in enumerate(frames) if i not in (3, 4)]
    dropped = [(t + (3.0 if i >= 3 else 0), tr) for i, (t, tr) in enumerate(dropped)]
    sink2 = run_tracks(settings, store_config, dropped)
    assert [e.type for e in sink2.events if e.type == "ENTRY"] == ["ENTRY"]


def test_emitted_timestamps_are_utc_with_z(settings: Settings, store_config: IngestConfig) -> None:
    ys = [0.8] * 3 + [0.3, 0.2, 0.2, 0.2]
    sink = run_tracks(settings, store_config, walk(1, 0.25, ys, 0.2))
    payloads = [e.to_payload() for e in sink.events] + [q.to_payload() for q in sink.queue] + [o.to_payload() for o in sink.storeops]
    assert payloads
    for p in payloads:
        assert p["ts"].endswith("Z"), p
        parsed = datetime.fromisoformat(p["ts"].replace("Z", "+00:00"))
        assert parsed.utcoffset() == timezone.utc.utcoffset(None)
    first = sink.events[0]
    assert abs(datetime.fromisoformat(first.ts.replace("Z", "+00:00")).timestamp() - (T0 + 0.6)) < 1.0
    assert iso(0.0) == "1970-01-01T00:00:00.000Z"
    assert VisitorEvent(camera_id=1, type="ENTRY", ts=iso(T0), track_id="t", visitor_id="v").to_payload()["ts"].endswith("Z")


# ----------------------------------------------------------------------------- night time


def test_lights_off_at_night_is_not_an_alert_but_during_business_hours_it_is() -> None:
    night = monitor()
    out = []
    for k in range(0, 400, 2):
        t = local_ts(2, 0) + k  # 02:00, store closed
        night.on_frame_stats(1, frame_stats(DARK), t)
        night.on_people(1, 0, 0, t)
        out += night.tick(t)
    assert "LIGHTS_OFF" not in types(out) and "STORE_OPENED" not in types(out) and "CAMERA_TAMPER" not in types(out)
    day = monitor()
    out = []
    for k in range(0, 200, 2):
        t = local_ts(15, 0) + k
        day.on_frame_stats(1, frame_stats(LIT if k < 10 else DARK), t)
        day.on_people(1, 1, 1, t)
        out += day.tick(t)
    assert types(out).count("LIGHTS_OFF") == 1


@pytest.mark.parametrize("dark_people", [0, 2])
def test_dark_frames_do_not_crash_the_pipeline(settings: Settings, store_config: IngestConfig, dark_people: int) -> None:
    sink = ListSink()
    ctx = StoreContext(settings, store_config, sink, session="night")
    proc = CameraProcessor(store_config.cameras[0], store_config.zones_for(10), ctx)
    det = FakeDetector([[Track(i + 1, box(0.2 + 0.1 * i, 0.8), 0.4) for i in range(dark_people)] for _ in range(20)])
    frame = np.zeros((180, 320, 3), np.uint8)
    for k in range(20):
        t = local_ts(2, 0) + k * 0.5
        proc.process(frame, det.track(frame, t), t)
        ctx.tick_ops(t)
    assert all(e.ts.endswith("Z") for e in sink.events)
