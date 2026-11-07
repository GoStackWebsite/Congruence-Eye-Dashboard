"""Simulator: deterministic day scenario through the real analytics, delivered via the real client."""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from congruence_eye_ai.backend_client import BackendClient
from congruence_eye_ai.config import Settings
from congruence_eye_ai.schemas import (
    AI_RULE_TYPES,
    DetectionsPayload,
    EventsPayload,
    HeartbeatPayload,
    HeatmapPayload,
    QueuePayload,
    StoreOpsPayload,
)
from congruence_eye_ai.simulate import demo_config, main, run_simulation
from congruence_eye_ai.sink import BackendSink, ListSink, TeeSink

IST = ZoneInfo("Asia/Kolkata")
DAY = date(2026, 9, 21)
NOW = datetime(2026, 9, 22, 9, 0, tzinfo=IST).timestamp()  # the next morning: the whole day is in the past


def fresh_settings(tmp: Path) -> Settings:
    return Settings(_env_file=None, SPOOL_DIR=tmp)  # type: ignore[call-arg]


@pytest.fixture(scope="module")
def day_run(tmp_path_factory) -> tuple:
    out = []
    for i in range(2):
        sink = ListSink()
        res = run_simulation(demo_config(), fresh_settings(tmp_path_factory.mktemp(f"day{i}")), sink, minutes=15, seed=7, scripted=True, day=DAY, now=NOW)
        out.append((res, sink))
    return tuple(out)


def test_day_scenario_is_deterministic(day_run) -> None:
    (r1, s1), (r2, s2) = day_run
    assert r1.counts == r2.counts and r1.detections == r2.detections
    assert [e.to_payload() for e in s1.events] == [e.to_payload() for e in s2.events]
    assert [d.to_payload() for d in s1.detections] == [d.to_payload() for d in s2.detections]
    assert [len(s.jpeg) for s in s1.snapshots] == [len(s.jpeg) for s in s2.snapshots]


def test_day_scenario_segments_and_traffic(day_run) -> None:
    (res, sink), _ = day_run
    assert [s["label"] for s in res.segments] == ["opening", "traffic", "closing"]
    assert res.dates == ["2026-09-21"]
    shoppers = res.world["shoppers"]
    customer_entries = [e for e in sink.events if e.type == "ENTRY" and not e.is_staff]
    exits = [e for e in sink.events if e.type == "EXIT" and not e.is_staff]
    assert len(customer_entries) == shoppers and len(exits) == shoppers
    assert {e.visitor_id for e in exits} == {e.visitor_id for e in customer_entries}  # re-identified
    assert all(e.dwell_sec and e.dwell_sec > 0 for e in exits)
    assert len({e.group_id for e in customer_entries if e.group_id}) == res.world["groups"]
    assert sum(1 for e in sink.events if e.type == "EXIT" and e.is_staff) == 4  # staff leave at closing
    assert res.counts["ZONE_ENTER"] == res.counts["ZONE_EXIT"] > 0
    assert max(q.queue_length for q in sink.queue) >= 6
    ops = {o.type for o in sink.storeops}
    assert {"STORE_OPENED", "STORE_CLOSED", "COUNTER_UNATTENDED"} <= ops
    opened = next(o for o in sink.storeops if o.type == "STORE_OPENED")
    closed = next(o for o in sink.storeops if o.type == "STORE_CLOSED")
    assert opened.ts.startswith("2026-09-21T04:2")  # ~09:52 IST, before the 10:00 opening
    assert closed.ts.startswith("2026-09-21T16:3")  # ~22:01 IST, shortly after the 22:00 closing


def test_day_scenario_exercises_every_ai_manager_rule(day_run) -> None:
    (res, sink), _ = day_run
    types = {d.type for d in sink.detections}
    assert types == set(AI_RULE_TYPES)
    assert res.detections == {
        "HUDDLE_MEETING:COMPLIED": 1,
        "HYGIENE_CLEANING:BREACHED": 1,  # partial sweep at closing
        "HYGIENE_CLEANING:COMPLIED": 1,  # full sweep in the traffic block
        "MOBILE_USAGE:BREACHED": 1,
        "QUEUE_BREACH:BREACHED": 1,
        "STOCK_OUT:BREACHED": 1,
        "STORE_OPEN_CLOSE:COMPLIED": 2,
        "UNATTENDED_CUSTOMER:BREACHED": 1,
        "UNIFORM_COMPLIANCE:BREACHED": 1,
    }
    # every detection comes with an annotated snapshot of the right kind
    kinds = {b.detections[0].type: b.snapshot.kind for b in sink.bundles if b.detections and b.snapshot}
    assert len(kinds) == 8
    assert kinds["STORE_OPEN_CLOSE"] == "CLOSING" or kinds["STORE_OPEN_CLOSE"] == "OPENING"
    assert {k for t, k in kinds.items() if t != "STORE_OPEN_CLOSE"} == {"AI_MANAGER"}
    snap_kinds = {s.kind for s in sink.snapshots}
    assert snap_kinds == {"PERIODIC", "OPENING", "CLOSING", "AI_MANAGER", "REFERENCE"}
    assert sum(1 for s in sink.snapshots if s.kind == "PERIODIC") >= 100  # enough frames for a recap
    # snapshot timestamps all fall on the simulated store day (recap = one store-day)
    assert {datetime.fromtimestamp(s.t, tz=IST).date() for s in sink.snapshots} == {DAY}


def test_simulation_posts_valid_payloads(tmp_path: Path) -> None:
    posted: dict[str, list] = {}
    snap_ids = iter(range(1, 100000))

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/api/ingest/snapshot":
            body = req.content
            kind = body.split(b'name="kind"', 1)[1].split(b"\r\n\r\n", 1)[1].split(b"\r\n", 1)[0].decode()
            posted.setdefault(path, []).append(kind)
            return httpx.Response(200, json={"ok": True, "snapshotId": next(snap_ids), "url": "/uploads/x.jpg"})
        posted.setdefault(path, []).append(json.loads(req.content))
        return httpx.Response(200, json={"accepted": 1, "ok": True})

    settings = fresh_settings(tmp_path / "s")
    client = BackendClient("http://backend", "dev-edge-key-store-1", tmp_path / "sp", transport=httpx.MockTransport(handler), sleep=lambda s: None)
    sink = BackendSink(client)
    start = datetime(2026, 9, 21, 13, 0, tzinfo=IST).timestamp()
    res = run_simulation(demo_config(), settings, sink, minutes=15, start=start, seed=7, scripted=True, client=client, now=NOW)
    assert res.spool_pending == 0
    n_events = sum(len(EventsPayload.model_validate(b).events) for b in posted["/api/ingest/events"])
    assert n_events == sum(res.counts[k] for k in ("ENTRY", "EXIT", "ZONE_ENTER", "ZONE_EXIT"))
    for b in posted.get("/api/ingest/queue", []):
        QueuePayload.model_validate(b)
    for b in posted["/api/ingest/storeops"]:
        StoreOpsPayload.model_validate(b)
    for b in posted["/api/ingest/heatmap"]:
        HeatmapPayload.model_validate(b)
    for b in posted["/api/ingest/heartbeat"]:
        HeartbeatPayload.model_validate(b)
    dets = [d for b in posted["/api/ingest/detections"] for d in DetectionsPayload.model_validate(b).detections]
    assert len(dets) == res.counts["detections"] >= 7
    assert all(d.snapshot_id for d in dets)  # each detection links its uploaded snapshot
    assert {"PERIODIC", "AI_MANAGER", "REFERENCE"} <= set(posted["/api/ingest/snapshot"])
    client.stop()


def test_teed_backend_sink_delivers_everything(tmp_path: Path) -> None:
    """--print-events wraps the BackendSink in a TeeSink: buffered events must still be flushed and delivered."""
    posted: list[dict] = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/ingest/snapshot":
            return httpx.Response(200, json={"ok": True, "snapshotId": 1, "url": "/uploads/x.jpg"})
        if req.url.path == "/api/ingest/events":
            posted.append(json.loads(req.content))
        return httpx.Response(200, json={"accepted": 1, "ok": True})

    client = BackendClient("http://backend", "dev-edge-key-store-1", tmp_path / "sp", transport=httpx.MockTransport(handler), sleep=lambda s: None)
    printed = ListSink()
    sink = TeeSink(BackendSink(client), printed)
    start = datetime(2026, 9, 21, 13, 0, tzinfo=IST).timestamp()
    res = run_simulation(demo_config(), fresh_settings(tmp_path / "s"), sink, minutes=15, start=start, seed=7, scripted=True, client=client, now=NOW)
    assert res.spool_pending == 0
    n_events = sum(len(EventsPayload.model_validate(b).events) for b in posted)
    assert n_events == len(printed.events) == sum(res.counts[k] for k in ("ENTRY", "EXIT", "ZONE_ENTER", "ZONE_EXIT"))
    client.stop()


def test_cli_dry_run_and_date_validation(capsys, tmp_path: Path) -> None:
    assert main(["--dry-run", "--once", "--spool-dir", str(tmp_path / "a")]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["generated"]["ENTRY"] > 0 and out["spoolPendingItems"] == 0
    assert out["segments"][-1]["label"] == "traffic"
    assert {k.split(":")[0] for k in out["detections"]} >= set(AI_RULE_TYPES) - {"STORE_OPEN_CLOSE"}
    assert main(["--dry-run", "--once", "--date", "2999-01-01", "--spool-dir", str(tmp_path / "b")]) == 2


def test_random_scenario_runs(tmp_path: Path) -> None:
    sink = ListSink()
    start = datetime(2026, 9, 21, 13, 0, tzinfo=IST).timestamp()
    res = run_simulation(demo_config(), fresh_settings(tmp_path), sink, minutes=20, start=start, seed=3, arrivals_per_hour=90, fps=3, now=NOW, incidents=False)
    assert res.counts["ENTRY"] > 5 and res.counts["EXIT"] > 0 and res.counts["detections"] == 0
