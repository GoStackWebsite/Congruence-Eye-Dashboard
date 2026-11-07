"""Contract v3 end to end: real RTSP server + scratch backend + edge poller.

A local RTSP server (``tests/rtsp_test_server.py``: Digest auth, 404 for unknown paths, H.264 test pattern)
plays a Hikvision DVR. The test creates the recorder through the real backend API (a scratch copy of
``../backend`` on SQLite, port ``CE_IT_PORT`` = 3300 by default), starts tests from the "browser", lets the
edge's :class:`ProbePoller` claim them and probe the real streams, and checks the results (resolution, snapshot,
AUTH / NOT_FOUND / UNREACHABLE) and the recorder status through the API.

Skipped without ffmpeg, Node.js or the backend checkout, or with ``CE_SKIP_BACKEND_IT=1``.
"""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import time
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest

from congruence_eye_ai.backend_client import BackendClient
from congruence_eye_ai.recorders.poller import ProbePoller
from congruence_eye_ai.recorders.prober import RtspProber
from tests.rtsp_test_server import RtspTestServer, encode_test_pattern, free_port

BACKEND = Path(os.environ.get("CE_BACKEND_DIR", Path(__file__).resolve().parents[2] / "backend"))
PW = "p@ss:w/rd#1"
KEY = "dev-edge-key-store-1"

BOOT = """
import './env';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { testSeed } from './seed/test-seed';

async function boot() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true, logger: ['error', 'warn'] });
  configureApp(app, { swagger: false });
  await testSeed(app.get(DataSource));
  await app.listen(Number(process.env.PORT), '127.0.0.1');
  console.log('READY');
}
void boot();
"""

pytestmark = pytest.mark.skipif(
    os.environ.get("CE_SKIP_BACKEND_IT") == "1"
    or shutil.which("ffmpeg") is None
    or shutil.which("node") is None
    or not (BACKEND / "node_modules" / ".bin" / "ts-node").exists()
    or not (BACKEND / "src" / "modules" / "recorders").exists(),
    reason="ffmpeg / node / backend checkout with recorders not available",
)


def _port_free(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


@pytest.fixture(scope="module")
def backend(tmp_path_factory):
    work = tmp_path_factory.mktemp("backend-v3")
    for name in ("src", "tsconfig.json", "package.json"):
        src = BACKEND / name
        (shutil.copytree if src.is_dir() else shutil.copy)(src, work / name)
    (work / "node_modules").symlink_to(BACKEND / "node_modules")
    (work / "src" / "it-boot.ts").write_text(BOOT)
    port = int(os.environ.get("CE_IT_PORT", "3300"))
    if not _port_free(port):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    env = {**os.environ, "DB_TYPE": "sqlite", "DB_PATH": str(work / "it.sqlite"), "DB_SYNC": "true", "JWT_SECRET": "it-secret",
           "PORT": str(port), "UPLOAD_DIR": str(work / "uploads"), "NODE_ENV": "test", "RECORDER_SECRET": "it-recorder-secret"}
    log = open(work / "backend.log", "w")
    proc = subprocess.Popen([str(work / "node_modules" / ".bin" / "ts-node"), "--transpile-only", "src/it-boot.ts"],
                            cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        deadline = time.time() + 180
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError("backend exited:\n" + (work / "backend.log").read_text()[-3000:])
            if "READY" in (work / "backend.log").read_text():
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("backend did not start:\n" + (work / "backend.log").read_text()[-3000:])
        yield f"http://127.0.0.1:{port}"
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


@pytest.fixture(scope="module")
def dvr(tmp_path_factory):
    d = tmp_path_factory.mktemp("dvr")
    stream = encode_test_pattern(d / "p.h264", 640, 360, fps=10, seconds=3)
    srv = RtspTestServer(user="admin", password=PW, realm="HikvisionDS")
    for ch in (1, 2):  # channels 1 and 2 have cameras; channel 3 does not (404)
        srv.add_stream(f"/Streaming/Channels/{ch}01", stream, fps=10)
        srv.add_stream(f"/Streaming/Channels/{ch}02", stream, fps=10)
    srv.start()
    yield srv
    srv.stop()


def _wait_done(api: httpx.Client, ids: list[int], timeout: float = 60) -> list[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        ps = [api.get(f"/api/probes/{i}").json() for i in ids]
        if all(p["status"] not in ("PENDING", "RUNNING") for p in ps):
            return ps
        time.sleep(0.3)
    raise AssertionError(f"probes still running: {ps}")


def test_recorder_probe_loop_against_real_rtsp(backend: str, dvr: RtspTestServer, tmp_path: Path) -> None:
    api = httpx.Client(base_url=backend, timeout=60)
    token = api.post("/api/auth/login", json={"email": "admin@congruence.in", "password": "Password@123"}).json()["accessToken"]
    api.headers["Authorization"] = f"Bearer {token}"

    # 1. create the DVR (Hikvision template) pointing at the local RTSP server, add cameras for ch 1–2
    rec = api.post("/api/recorders", json={
        "storeId": 1, "name": "IT DVR", "kind": "DVR", "brand": "HIKVISION", "host": "127.0.0.1", "rtspPort": dvr.port,
        "httpPort": 80, "username": "admin", "password": PW, "channels": 4, "stream": "MAIN",
    })
    assert rec.status_code == 201, rec.text
    rid = rec.json()["id"]
    assert "password" not in rec.json() and rec.json()["hasPassword"] is True
    cams = api.post(f"/api/recorders/{rid}/generate-cameras", json={"channels": [1, 2], "type": "ZONE", "namePrefix": "DVR ch"}).json()
    assert [c["rtspUrl"] for c in cams] == [f"rtsp://admin:****@127.0.0.1:{dvr.port}/Streaming/Channels/101",
                                           f"rtsp://admin:****@127.0.0.1:{dvr.port}/Streaming/Channels/201"]

    client = BackendClient(backend, KEY, tmp_path / "spool", retries=1, timeout=30)
    # the edge config carries the real URL, and it really plays
    cfg = client.get_config()  # also marks the edge as seen (otherwise tests fail fast with EDGE_OFFLINE)
    real = next(c for c in cfg.cameras if c.id == cams[0]["id"]).rtsp_url
    assert real == f"rtsp://admin:p%40ss%3Aw%2Frd%231@127.0.0.1:{dvr.port}/Streaming/Channels/101"
    poller = ProbePoller(client, RtspProber(timeout_sec=5), concurrency=3)

    # 2. "Test selected" for channels 1–3 → edge claims → probes the real streams → posts results
    probes = api.post(f"/api/recorders/{rid}/test", json={"channels": [1, 2, 3]}).json()
    assert [p["status"] for p in probes] == ["PENDING"] * 3
    assert poller.poll_once() == 3
    ch1, ch2, ch3 = _wait_done(api, [p["id"] for p in probes])
    for ok in (ch1, ch2):
        assert ok["status"] == "OK", ok
        assert (ok["width"], ok["height"], ok["codec"], ok["fps"]) == (640, 360, "h264", 10)
        assert 0 < ok["latencyMs"] < 10_000 and ok["errorCode"] is None
    assert ch1["cameraId"] == cams[0]["id"] and ch3["cameraId"] is None
    snap = api.get(ch1["snapshotUrl"])
    assert snap.status_code == 200 and snap.headers["content-type"].startswith("image/jpeg")
    img = cv2.imdecode(np.frombuffer(snap.content, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (360, 640, 3)
    assert (ch3["status"], ch3["errorCode"]) == ("FAILED", "NOT_FOUND")
    r = api.get(f"/api/recorders/{rid}").json()
    assert r["status"] == "PARTIAL" and r["lastCheckedAt"]

    # 3. wrong password → AUTH, recorder OFFLINE; the poller thread (burst mode) picks the test up by itself
    assert api.patch(f"/api/recorders/{rid}", json={"password": "wrong-password"}).status_code == 200
    poller.poll_sec = 0.5
    poller.start()
    try:
        auth = api.post(f"/api/cameras/{cams[0]['id']}/test").json()
        (auth,) = _wait_done(api, [auth["id"]])
        assert (auth["status"], auth["errorCode"]) == ("FAILED", "AUTH"), auth
        assert "wrong-password" not in (auth["error"] or "")

        # 4. right password, sub stream of channel 2 via PATCH camera → OK again
        assert api.patch(f"/api/recorders/{rid}", json={"password": PW}).status_code == 200
        assert api.patch(f"/api/cameras/{cams[1]['id']}", json={"streamProfile": "SUB"}).json()["rtspUrl"].endswith("/Streaming/Channels/202")
        sub = api.post(f"/api/cameras/{cams[1]['id']}/test").json()
        (sub,) = _wait_done(api, [sub["id"]])
        assert sub["status"] == "OK" and sub["width"] == 640, sub

        # 5. closed port → UNREACHABLE
        assert api.patch(f"/api/recorders/{rid}", json={"rtspPort": free_port()}).status_code == 200
        ur = api.post(f"/api/recorders/{rid}/test", json={"channels": [1]}).json()
        (ur,) = _wait_done(api, [ur[0]["id"]])
        assert (ur["status"], ur["errorCode"]) == ("FAILED", "UNREACHABLE"), ur
    finally:
        poller.stop()
        client.stop(final_drain=False)

    # recorder status follows the latest result per channel: ch1 UNREACHABLE, ch2 OK, ch3 NOT_FOUND → PARTIAL
    assert api.get(f"/api/recorders/{rid}").json()["status"] == "PARTIAL"
    listed = api.get("/api/probes", params={"recorderId": rid}).json()
    assert len(listed) == 6 and {p["errorCode"] for p in listed} >= {None, "AUTH", "NOT_FOUND", "UNREACHABLE"}
    # the RTSP server really saw Digest-authenticated DESCRIBE / SETUP / PLAY over TCP
    assert any(r.startswith("PLAY ") for r in dvr.requests) and any(r.startswith("SETUP ") for r in dvr.requests)
