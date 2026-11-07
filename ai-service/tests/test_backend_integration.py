"""End-to-end against a scratch copy of the real NestJS backend (SQLite + its e2e test seed).

The backend sources are copied to a temp dir (``node_modules`` symlinked), so nothing is written into
``../backend``. Skipped when Node.js or the backend checkout is unavailable, or when
``CE_SKIP_BACKEND_IT=1``. Point ``CE_BACKEND_DIR`` at another checkout if needed.
"""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from congruence_eye_ai.backend_client import BackendClient
from congruence_eye_ai.config import Settings
from congruence_eye_ai.schemas import AI_RULE_TYPES
from congruence_eye_ai.simulate import run_simulation
from congruence_eye_ai.sink import BackendSink

BACKEND = Path(os.environ.get("CE_BACKEND_DIR", Path(__file__).resolve().parents[2] / "backend"))
IST = ZoneInfo("Asia/Kolkata")

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
    or shutil.which("node") is None
    or not (BACKEND / "node_modules" / ".bin" / "ts-node").exists()
    or not (BACKEND / "src" / "seed" / "test-seed.ts").exists(),
    reason="backend checkout / node not available",
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def backend(tmp_path_factory):
    work = tmp_path_factory.mktemp("backend")
    for name in ("src", "tsconfig.json", "package.json"):
        src = BACKEND / name
        (shutil.copytree if src.is_dir() else shutil.copy)(src, work / name)
    (work / "node_modules").symlink_to(BACKEND / "node_modules")
    (work / "src" / "it-boot.ts").write_text(BOOT)
    port = _free_port()
    env = {**os.environ, "DB_TYPE": "sqlite", "DB_PATH": str(work / "it.sqlite"), "DB_SYNC": "true", "JWT_SECRET": "it-secret",
           "PORT": str(port), "UPLOAD_DIR": str(work / "uploads"), "NODE_ENV": "test"}
    log = open(work / "backend.log", "w")
    proc = subprocess.Popen(
        [str(work / "node_modules" / ".bin" / "ts-node"), "--transpile-only", "src/it-boot.ts"],
        cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
    )
    url = f"http://127.0.0.1:{port}"
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
        yield url, work
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        log.close()


def test_simulator_against_real_backend(backend, tmp_path: Path) -> None:
    url, _ = backend
    api = httpx.Client(base_url=url, timeout=60)
    token = api.post("/api/auth/login", json={"email": "admin@congruence.in", "password": "Password@123"}).json()["accessToken"]
    api.headers["Authorization"] = f"Bearer {token}"
    # a real AI Manager rule for store 1 (the simulator adds defaults for the other types)
    rule = api.post("/api/ai-manager/rules", json={
        "name": "No phones on the floor", "type": "MOBILE_USAGE", "storeIds": [1], "windowStart": "00:00", "windowEnd": "23:59",
        "severity": "HIGH", "notifyChannels": ["IN_APP"], "isActive": True,
    })
    assert rule.status_code in (200, 201), rule.text
    rule_id = rule.json()["id"]

    settings = Settings(_env_file=None, BACKEND_URL=url, EDGE_API_KEY="dev-edge-key-store-1", SPOOL_DIR=tmp_path / "s")  # type: ignore[call-arg]
    client = BackendClient(url, "dev-edge-key-store-1", tmp_path / "spool", retries=1, timeout=60)
    config = client.get_config()
    assert config.store.id == 1 and any(r.id == rule_id for r in config.ai_manager_rules)
    day = (datetime.now(IST) - timedelta(days=1)).date()
    res = run_simulation(config, settings, BackendSink(client), minutes=15, seed=7, scripted=True, day=day, client=client)
    client.stop()
    assert res.spool_pending == 0, "everything must be delivered"
    d = day.isoformat()

    # AI Manager detections: every rule type, each with a snapshot; the real rule is linked
    dets = api.get("/api/ai-manager/detections", params={"storeIds": 1, "from": d, "to": d, "pageSize": 500}).json()
    items = dets["items"]
    assert {x["type"] for x in items} == set(AI_RULE_TYPES)
    assert all(x["snapshotUrl"] for x in items)
    phone = [x for x in items if x["type"] == "MOBILE_USAGE"]
    assert phone and phone[0]["ruleId"] == rule_id and phone[0]["status"] == "BREACHED"
    img = api.get(phone[0]["snapshotUrl"])
    assert img.status_code == 200 and img.content[:2] == b"\xff\xd8"
    summary = api.get("/api/ai-manager/summary", params={"storeIds": 1, "from": d, "to": d}).json()
    assert sum(r["breached"] for r in summary["byType"]) >= 6 and sum(r["complied"] for r in summary["byType"]) >= 3

    # open / close with opening + closing snaps
    oc = [r for r in api.get("/api/ai-manager/open-close", params={"storeIds": 1, "from": d, "to": d}).json() if r["storeId"] == 1]
    assert oc and oc[0]["actualOpen"] and oc[0]["actualClose"] and oc[0]["openingSnapUrl"] and oc[0]["closingSnapUrl"]
    assert oc[0]["openStatus"] == "ON_TIME" and oc[0]["closeStatus"] == "ON_TIME"

    # image directory: periodic snapshots for the day
    periodic = api.get("/api/image-directory", params={"storeIds": 1, "from": d, "to": d, "kind": "PERIODIC", "pageSize": 1}).json()
    assert periodic["total"] >= 100

    # recap video for that store-day
    recap = api.post("/api/recaps/generate", json={"storeId": 1, "date": d})
    assert recap.status_code in (200, 201), recap.text
    r = recap.json()
    assert r["status"] == "READY" and r["url"] and r["frameCount"] >= 100 and 0 < r["durationSec"] < 120
    video = api.get(r["url"])
    assert video.status_code == 200 and len(video.content) > 10_000 and video.content[4:8] == b"ftyp"

    # classic analytics still flow
    traffic = api.get("/api/analytics/traffic", params={"storeIds": 1, "from": d, "to": d}).json()
    assert traffic["totals"]["footfallIn"] >= 20
