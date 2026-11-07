"""Backend client: payload shapes, spooling while offline, ordered replay, batching, dead-letter."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from congruence_eye_ai.backend_client import BackendClient
from congruence_eye_ai.schemas import (
    CameraHeartbeat,
    HeartbeatPayload,
    HeatmapPayload,
    QueueSnapshot,
    StoreOpsEvent,
    VisitorEvent,
)
from congruence_eye_ai.sink import BackendSink

CONFIG = {
    "store": {"id": 1, "name": "T Nagar", "timezone": "Asia/Kolkata", "openTime": "10:00", "closeTime": "22:00", "code": "TNR", "regionId": 1},
    "cameras": [{"id": 1, "storeId": 1, "name": "Entrance", "rtspUrl": "rtsp://x", "type": "ENTRANCE", "status": "ONLINE", "isActive": True}],
    "zones": [{"id": 1, "storeId": 1, "cameraId": 1, "name": "Door", "type": "ENTRY_LINE", "polygon": [[0.1, 0.5], [0.9, 0.5]], "inDirection": "UP", "engagedDwellSec": 30, "isActive": True}],
    "settings": {"engagedStoreDwellSec": 300, "bounceSec": 60, "repeatWindowDays": 30, "currency": "INR"},
}


class FakeBackend:
    """In-memory backend implementing the ingestion contract, with an on/off switch."""

    def __init__(self) -> None:
        self.up = True
        self.status_override: int | None = None
        self.requests: list[tuple[str, str, dict | bytes]] = []
        self.events: list[dict] = []
        self.keys: set[str] = set()

    def handler(self, request: httpx.Request) -> httpx.Response:
        if not self.up:
            raise httpx.ConnectError("connection refused", request=request)
        self.keys.add(request.headers.get("x-api-key", ""))
        path = request.url.path
        if self.status_override:
            return httpx.Response(self.status_override, json={"statusCode": self.status_override, "message": "nope"})
        if request.method == "GET" and path == "/api/ingest/config":
            return httpx.Response(200, json=CONFIG)
        if path == "/api/ingest/snapshot":
            self.requests.append(("POST", path, request.content))
            return httpx.Response(201, json={"ok": True})
        body = json.loads(request.content)
        self.requests.append((request.method, path, body))
        if path == "/api/ingest/events":
            if len(body["events"]) > 5000:
                return httpx.Response(413, json={"message": "too many"})
            self.events.extend(body["events"])
            return httpx.Response(201, json={"accepted": len(body["events"])})
        if path in ("/api/ingest/queue",):
            return httpx.Response(201, json={"accepted": len(body["snapshots"])})
        if path == "/api/ingest/storeops":
            return httpx.Response(201, json={"accepted": len(body["events"])})
        return httpx.Response(201, json={"ok": True})

    def paths(self) -> list[str]:
        return [p for _, p, _ in self.requests]


@pytest.fixture
def backend() -> FakeBackend:
    return FakeBackend()


def make_client(backend: FakeBackend, spool: Path) -> BackendClient:
    return BackendClient("http://backend:3000", "dev-edge-key-store-1", spool, transport=httpx.MockTransport(backend.handler), sleep=lambda s: None, retries=2)


def ev(i: int) -> VisitorEvent:
    return VisitorEvent(camera_id=1, zone_id=1, type="ENTRY", ts=f"2026-10-05T10:00:{i % 60:02d}.000Z", track_id=f"t{i}", visitor_id=f"v{i}", is_staff=False)


def test_config_fetch_and_offline_cache(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    cfg = c.get_config()
    assert cfg.store.id == 1 and cfg.zones[0].in_direction == "UP" and cfg.zones[0].polygon[0] == (0.1, 0.5)
    assert backend.keys == {"dev-edge-key-store-1"}
    backend.up = False
    cfg2 = c.get_config()  # served from cache
    assert cfg2.store.name == "T Nagar"
    assert c.online is False
    c.stop(final_drain=False)
    fresh = make_client(backend, tmp_path / "other")
    with pytest.raises(httpx.HTTPError):
        fresh.get_config()
    fresh.stop(final_drain=False)


def test_events_are_wrapped_and_camelcase(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    c.enqueue_events([ev(1)])
    c.enqueue_queue([QueueSnapshot(zone_id=2, ts="2026-10-05T10:00:00.000Z", queue_length=3, avg_wait_sec=45.0, counter_staffed=True)])
    c.enqueue_storeops([StoreOpsEvent(type="COUNTER_UNATTENDED", ts="2026-10-05T10:00:00.000Z", camera_id=1, details="x")])
    c.enqueue_heatmap(HeatmapPayload(camera_id=1, ts="2026-10-05T10:05:00.000Z", grid=[0] * 576))
    assert c.drain() == 4
    bodies = {p: b for _, p, b in backend.requests}
    assert bodies["/api/ingest/events"] == {
        "events": [{"cameraId": 1, "zoneId": 1, "type": "ENTRY", "ts": "2026-10-05T10:00:01.000Z", "trackId": "t1", "visitorId": "v1", "isStaff": False}]
    }
    assert bodies["/api/ingest/queue"] == {"snapshots": [{"zoneId": 2, "ts": "2026-10-05T10:00:00.000Z", "queueLength": 3, "avgWaitSec": 45.0, "counterStaffed": True}]}
    assert bodies["/api/ingest/storeops"] == {"events": [{"type": "COUNTER_UNATTENDED", "ts": "2026-10-05T10:00:00.000Z", "cameraId": 1, "details": "x"}]}
    hm = bodies["/api/ingest/heatmap"]
    assert hm["cameraId"] == 1 and hm["width"] == 32 and hm["height"] == 18 and len(hm["grid"]) == 576
    assert c.spool.count() == 0
    c.stop()


def test_offline_spool_then_replay_in_order(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    backend.up = False
    for i in range(10):
        c.enqueue_events([ev(i)])
    assert c.drain() == 0
    assert c.spool.pending_items() == 10 and c.online is False
    backend.up = True
    assert c.drain() == 10
    assert [e["trackId"] for e in backend.events] == [f"t{i}" for i in range(10)]
    # merged into a single request
    assert backend.paths().count("/api/ingest/events") == 1
    assert c.spool.count() == 0
    c.stop()


def test_spool_survives_restart(backend: FakeBackend, tmp_path: Path) -> None:
    backend.up = False
    c1 = make_client(backend, tmp_path)
    c1.enqueue_events([ev(i) for i in range(3)])
    c1.stop(final_drain=True)  # final drain fails silently, data stays on disk
    backend.up = True
    c2 = make_client(backend, tmp_path)
    assert c2.spool.pending_items() == 3
    assert c2.drain() == 3
    assert len(backend.events) == 3
    c2.stop()


def test_batches_capped_at_5000(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    c.enqueue_events([ev(i) for i in range(12000)])
    assert c.drain() == 12000
    sizes = [len(b["events"]) for _, p, b in backend.requests if p == "/api/ingest/events"]
    assert sizes == [5000, 5000, 2000]
    c.stop()


def test_server_errors_retry_later_auth_errors_keep_data(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    c.enqueue_events([ev(1)])
    for code in (500, 503, 401, 429):
        backend.status_override = code
        assert c.drain() == 0
        assert c.spool.pending_items() == 1
    backend.status_override = None
    assert c.drain() == 1
    c.stop()


def test_validation_error_goes_to_dead_letter_without_blocking(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    c.enqueue_events([ev(1)])
    backend.status_override = 400
    c.drain()
    assert c.spool.count() == 0 and c.spool.dead_count() == 1
    backend.status_override = None
    c.enqueue_events([ev(2)])
    assert c.drain() == 1
    c.stop()


def test_one_failing_kind_does_not_block_others(tmp_path: Path) -> None:
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.url.path)
        if req.url.path == "/api/ingest/heatmap":
            return httpx.Response(503)
        return httpx.Response(201, json={"accepted": 1})

    c = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(handler), sleep=lambda s: None)
    c.enqueue_heatmap(HeatmapPayload(camera_id=1, ts="2026-10-05T10:05:00.000Z", grid=[1] * 576))
    c.enqueue_events([ev(1)])
    assert c.drain() == 1
    assert c.spool.count("heatmap") == 1 and c.spool.count("events") == 0
    c.stop(final_drain=False)


def test_spool_cap_drops_oldest(backend: FakeBackend, tmp_path: Path) -> None:
    c = BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(backend.handler), sleep=lambda s: None, spool_max_rows=5)
    backend.up = False
    for i in range(8):
        c.enqueue_events([ev(i)])
    assert c.spool.count() == 5
    backend.up = True
    c.drain()
    assert [e["trackId"] for e in backend.events] == ["t3", "t4", "t5", "t6", "t7"]
    c.stop()


def test_heartbeat_and_snapshot_are_direct(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    hb = HeartbeatPayload(version="1.0.0", cameras=[CameraHeartbeat(camera_id=1, status="ONLINE", fps=5.0), CameraHeartbeat(camera_id=2, status="OFFLINE", reason="stream open failed")])
    assert c.heartbeat(hb) is True
    body = backend.requests[-1][2]
    assert body == {"version": "1.0.0", "cameras": [{"cameraId": 1, "status": "ONLINE", "fps": 5.0}, {"cameraId": 2, "status": "OFFLINE", "reason": "stream open failed"}]}
    assert c.upload_snapshot(1, b"\xff\xd8jpegdata") is True
    raw = backend.requests[-1][2]
    assert isinstance(raw, bytes) and b'name="cameraId"' in raw and b'name="file"' in raw and b"image/jpeg" in raw
    backend.up = False
    assert c.heartbeat(hb) is False
    assert c.spool.count() == 0  # heartbeats are never spooled
    c.stop(final_drain=False)


def test_backend_sink_buffers_until_flush(backend: FakeBackend, tmp_path: Path) -> None:
    c = make_client(backend, tmp_path)
    sink = BackendSink(c)
    sink.emit_event(ev(1))
    sink.emit_event(ev(2))
    assert c.spool.count() == 0
    sink.flush()
    assert c.spool.pending_items() == 2
    sink.emit_storeops(StoreOpsEvent(type="LIGHTS_OFF", ts="2026-10-05T10:00:00.000Z"))  # flushed immediately
    assert c.spool.count("storeops") == 1
    c.drain()
    assert len(backend.events) == 2
    c.stop()


def test_background_sender_thread(backend: FakeBackend, tmp_path: Path) -> None:
    import time

    c = make_client(backend, tmp_path)
    c.start()
    c.enqueue_events([ev(1), ev(2)])
    deadline = time.time() + 5
    while time.time() < deadline and len(backend.events) < 2:
        time.sleep(0.05)
    c.stop()
    assert len(backend.events) == 2


# ----------------------------------------------------------------------------- v2: snapshots + detections


class V2Backend:
    """Snapshot endpoint returning snapshotId (contract v2) + detections endpoint."""

    def __init__(self, snapshot_id_in_response: bool = True) -> None:
        self.up = True
        self.fail: dict[str, int] = {}
        self.snapshots: list[dict] = []
        self.posts: list[tuple[str, dict]] = []
        self.with_id = snapshot_id_in_response

    def handler(self, request: httpx.Request) -> httpx.Response:
        if not self.up:
            raise httpx.ConnectError("down", request=request)
        path = request.url.path
        if path in self.fail:
            return httpx.Response(self.fail[path], json={"message": "x"})
        if path == "/api/ingest/snapshot":
            body = request.content
            fields = {}
            for name in (b"cameraId", b"kind", b"ts"):
                i = body.index(b'name="' + name + b'"')
                fields[name.decode()] = body[i:].split(b"\r\n\r\n", 1)[1].split(b"\r\n", 1)[0].decode()
            self.snapshots.append(fields)
            sid = 100 + len(self.snapshots)
            return httpx.Response(200, json={"ok": True, "snapshotId": sid, "url": f"/uploads/s{sid}.jpg"} if self.with_id else {"ok": True})
        self.posts.append((path, json.loads(request.content)))
        return httpx.Response(200, json={"accepted": 1})


def v2_client(b: V2Backend, tmp_path: Path, **kw) -> BackendClient:
    return BackendClient("http://b", "k", tmp_path, transport=httpx.MockTransport(b.handler), sleep=lambda s: None, **kw)


DET = {"type": "MOBILE_USAGE", "cameraId": 2, "ts": "2026-10-05T10:00:00.000Z", "status": "BREACHED", "details": "phone"}
OPS = {"type": "STORE_OPENED", "ts": "2026-10-05T04:20:00.000Z", "cameraId": 1}


def test_bundle_uploads_snapshot_then_links_detection(tmp_path: Path) -> None:
    b = V2Backend()
    c = v2_client(b, tmp_path)
    c.enqueue_bundle((2, "AI_MANAGER", 1790000000.0, b"\xff\xd8jpeg"), [], [DET])
    c.enqueue_bundle((1, "OPENING", 1790000100.0, b"\xff\xd8jpeg"), [OPS], [{**DET, "type": "STORE_OPEN_CLOSE", "status": "COMPLIED"}])
    assert c.drain() == 3
    assert b.snapshots == [
        {"cameraId": "2", "kind": "AI_MANAGER", "ts": "2026-09-21T14:13:20.000Z"},
        {"cameraId": "1", "kind": "OPENING", "ts": "2026-09-21T14:15:00.000Z"},
    ]
    assert b.posts[0] == ("/api/ingest/detections", {"detections": [{**DET, "snapshotId": 101}]})
    assert b.posts[1] == ("/api/ingest/storeops", {"events": [{**OPS, "snapshotId": 102}]})
    assert b.posts[2][1]["detections"][0]["snapshotId"] == 102
    assert c.spool.count() == 0
    c.stop()


def test_bundle_partial_failure_never_reuploads(tmp_path: Path) -> None:
    b = V2Backend()
    c = v2_client(b, tmp_path)
    c.enqueue_bundle((2, "AI_MANAGER", 1790000000.0, b"jpeg"), [], [DET])
    b.fail["/api/ingest/detections"] = 503
    assert c.drain() == 0 and len(b.snapshots) == 1
    assert c.drain() == 0 and len(b.snapshots) == 1  # retried, snapshot not uploaded again
    del b.fail["/api/ingest/detections"]
    assert c.drain() == 1
    assert len(b.snapshots) == 1 and b.posts == [("/api/ingest/detections", {"detections": [{**DET, "snapshotId": 101}]})]
    # network down before the snapshot -> nothing lost, replayed later
    b.up = False
    c.enqueue_bundle((2, "AI_MANAGER", 1790000000.0, b"jpeg"), [], [DET])
    assert c.drain() == 0 and c.spool.count("bundle") == 1
    b.up = True
    assert c.drain() == 1 and len(b.snapshots) == 2
    c.stop()


def test_bundle_without_snapshot_id_and_rejected_snapshot(tmp_path: Path) -> None:
    v1 = V2Backend(snapshot_id_in_response=False)
    c = v2_client(v1, tmp_path / "a")
    c.enqueue_bundle((2, "AI_MANAGER", 1790000000.0, b"jpeg"), [], [DET])
    c.drain()
    assert v1.posts == [("/api/ingest/detections", {"detections": [DET]})]
    c.stop()
    b = V2Backend()
    b.fail["/api/ingest/snapshot"] = 400
    c = v2_client(b, tmp_path / "b")
    c.enqueue_bundle((99, "AI_MANAGER", 1790000000.0, b"jpeg"), [], [DET])
    assert c.drain() == 1 and b.posts == [("/api/ingest/detections", {"detections": [DET]})]
    c.enqueue_bundle(None, [], [DET])  # no frame available
    assert c.drain() == 1
    c.stop()


def test_periodic_snapshots_are_spooled_and_capped(tmp_path: Path) -> None:
    b = V2Backend()
    c = v2_client(b, tmp_path, spool_max_snapshots=3)
    b.up = False
    for k in range(5):
        c.enqueue_snapshot(1, "PERIODIC", 1790000000.0 + k * 60, b"jpeg")
    c.enqueue_bundle((2, "AI_MANAGER", 1790000000.0, b"jpeg"), [], [DET])  # detections are never dropped by the cap
    assert c.spool.count("snapshot") == 3 and c.spool.count("bundle") == 1
    b.up = True
    c.drain()
    assert [s["ts"][11:19] for s in b.snapshots if s["kind"] == "PERIODIC"] == ["14:15:20", "14:16:20", "14:17:20"]
    assert len(b.posts) == 1
    c.stop()
