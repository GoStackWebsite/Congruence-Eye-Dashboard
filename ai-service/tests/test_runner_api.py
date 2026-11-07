"""Camera worker (real cv2 capture of a synthetic video), store runner and FastAPI endpoints."""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from congruence_eye_ai.backend_client import BackendClient
from congruence_eye_ai.camera_worker import CameraWorker, _redact
from congruence_eye_ai.config import Settings
from congruence_eye_ai.detector import ScriptedDetector, Track
from congruence_eye_ai.main import create_app
from congruence_eye_ai.processor import CameraProcessor, StoreContext
from congruence_eye_ai.schemas import IngestConfig
from congruence_eye_ai.sink import ListSink
from congruence_eye_ai.store_runner import StoreRunner

from .test_backend_client import CONFIG, FakeBackend


@pytest.fixture
def video(tmp_path: Path) -> str:
    path = str(tmp_path / "clip.avi")
    w = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 10, (320, 180))
    rs = np.random.RandomState(0)
    bg = rs.randint(80, 160, (180, 320, 3)).astype(np.uint8)
    for k in range(30):
        f = bg.copy()
        cv2.rectangle(f, (50 + 5 * k, 40), (80 + 5 * k, 150), (30, 30, 200), -1)
        w.write(f)
    w.release()
    return path


def moving_person(t: float) -> list[Track]:
    x = 0.2 + (t * 0.1) % 0.6
    return [Track(1, (x - 0.05, 0.2, x + 0.05, 0.85), 0.8)]


def worker_settings(tmp_path: Path, **kw) -> Settings:
    return Settings(_env_file=None, SPOOL_DIR=tmp_path / "spool", TARGET_FPS=10, SNAPSHOT_SEC=0.5, RECONNECT_MAX_SEC=1, **kw)  # type: ignore[call-arg]


def test_camera_worker_reads_file_and_previews(tmp_path: Path, video: str) -> None:
    s = worker_settings(tmp_path)
    cfg = IngestConfig.model_validate(CONFIG)
    sink = ListSink()
    ctx = StoreContext(s, cfg, sink)
    proc = CameraProcessor(cfg.cameras[0], cfg.zones_for(1), ctx)
    snaps: list[tuple[int, bytes]] = []
    w = CameraWorker(proc, video, lambda: ScriptedDetector(moving_person), s, lambda cid, b: snaps.append((cid, b)))
    w.start()
    deadline = time.time() + 10
    while time.time() < deadline and w.health.processed < 8:
        time.sleep(0.1)
    st = w.status()
    jpeg = w.preview_jpeg()
    w.stop()
    w.join(timeout=5)
    assert not w.is_alive()
    assert st["status"] == "ONLINE" and st["framesProcessed"] >= 8 and st["fps"] > 0
    assert jpeg is not None and jpeg[:2] == b"\xff\xd8"
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (180, 320, 3)
    time.sleep(0.2)
    assert snaps and snaps[0][0] == 1 and snaps[0][1][:2] == b"\xff\xd8"


def test_camera_worker_bad_source_goes_offline(tmp_path: Path) -> None:
    s = worker_settings(tmp_path)
    cfg = IngestConfig.model_validate(CONFIG)
    proc = CameraProcessor(cfg.cameras[0], [], StoreContext(s, cfg, ListSink()))
    w = CameraWorker(proc, str(tmp_path / "missing.mp4"), lambda: ScriptedDetector(lambda t: []), s)
    w.start()
    time.sleep(1.0)
    st = w.status()
    w.stop()
    w.join(timeout=5)
    assert st["status"] == "OFFLINE" and st["reason"] == "stream open failed"
    assert w.health.next_backoff() >= 1


def test_redact() -> None:
    assert _redact("rtsp://admin:secret@10.0.0.5:554/Streaming/Channels/101") == "rtsp://***@10.0.0.5:554/Streaming/Channels/101"
    assert _redact("/videos/a.mp4") == "/videos/a.mp4"


def test_store_runner_and_api(tmp_path: Path, video: str) -> None:
    backend = FakeBackend()
    s = worker_settings(tmp_path, CAMERA_SOURCE_OVERRIDES={1: video}, HEARTBEAT_SEC=1, FLUSH_SEC=1)
    client = BackendClient("http://backend", "dev-edge-key-store-1", s.SPOOL_DIR, transport=httpx.MockTransport(backend.handler), sleep=lambda x: None)
    runner = StoreRunner(s, client=client, detector_factory=lambda: ScriptedDetector(moving_person))
    app = create_app(runner)
    with TestClient(app) as api:
        deadline = time.time() + 10
        while time.time() < deadline and not (runner.workers and runner.workers[1].health.processed >= 5):
            time.sleep(0.1)
        assert api.get("/health").json()["status"] == "ok"
        st = api.get("/status").json()
        assert st["store"] == {"id": 1, "name": "T Nagar"}
        assert st["cameras"][0]["cameraId"] == 1 and st["cameras"][0]["status"] == "ONLINE"
        r = api.get("/cameras/1/preview.jpg")
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
        assert api.get("/cameras/99/preview.jpg").status_code == 404
        # unchanged config -> nothing restarted
        assert api.post("/reload-config").json()["started"] == []
        time.sleep(1.5)  # allow a heartbeat
    # lifespan shutdown stopped everything
    assert not any(w.is_alive() for w in runner.workers.values())
    hbs = [b for _, p, b in backend.requests if p == "/api/ingest/heartbeat"]
    assert hbs and hbs[-1]["cameras"][0]["cameraId"] == 1
    assert any(c["status"] == "ONLINE" for hb in hbs for c in hb["cameras"])


def test_runner_restarts_only_changed_cameras(tmp_path: Path) -> None:
    import copy

    s = worker_settings(tmp_path)
    backend = FakeBackend()
    client = BackendClient("http://backend", "k", s.SPOOL_DIR, transport=httpx.MockTransport(backend.handler), sleep=lambda x: None)
    runner = StoreRunner(s, client=client, detector_factory=lambda: ScriptedDetector(lambda t: []))
    cfg = copy.deepcopy(CONFIG)
    cfg["cameras"].append({"id": 2, "storeId": 1, "name": "Floor", "rtspUrl": None, "type": "ZONE", "isActive": True})
    try:
        res = runner.apply_config(IngestConfig.model_validate(cfg))
        assert sorted(res["started"]) == [1, 2]
        cfg2 = copy.deepcopy(cfg)
        cfg2["zones"][0]["polygon"] = [[0.2, 0.5], [0.8, 0.5]]  # camera 1 zone edited
        res = runner.apply_config(IngestConfig.model_validate(cfg2))
        assert res["stopped"] == [1] and res["started"] == [1]
        cfg3 = copy.deepcopy(cfg2)
        cfg3["cameras"][1]["isActive"] = False
        res = runner.apply_config(IngestConfig.model_validate(cfg3))
        assert res["stopped"] == [2] and res["started"] == []
        hb = runner.heartbeat_payload().to_payload()
        assert [c["cameraId"] for c in hb["cameras"]] == [1]
    finally:
        runner.stop()
