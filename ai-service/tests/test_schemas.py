"""Payload schema conformance with docs/API_CONTRACT.md (Ingestion)."""

import pytest
from pydantic import ValidationError

from congruence_eye_ai.schemas import (
    EventsPayload,
    HeartbeatPayload,
    HeatmapPayload,
    IngestConfig,
    QueueSnapshot,
    StoreOpsEvent,
    VisitorEvent,
    iso,
    parse_iso,
)

VISITOR_KEYS = {"cameraId", "zoneId", "type", "ts", "trackId", "visitorId", "isStaff", "groupId", "gender", "ageBand", "dwellSec"}


def test_iso_format() -> None:
    assert iso(0) == "1970-01-01T00:00:00.000Z"
    assert iso(1.2345) == "1970-01-01T00:00:01.234Z" or iso(1.2345) == "1970-01-01T00:00:01.235Z"
    assert iso(59.9999) == "1970-01-01T00:01:00.000Z"
    assert abs(parse_iso(iso(1790000000.5)) - 1790000000.5) < 1e-3


def test_visitor_event_payload_keys() -> None:
    e = VisitorEvent(camera_id=1, zone_id=2, type="EXIT", ts=iso(0), track_id="t", visitor_id="v", is_staff=False, group_id="g-1", gender="F", age_band="25-34", dwell_sec=12.5)
    p = e.to_payload()
    assert set(p) == VISITOR_KEYS
    assert p["dwellSec"] == 12.5 and p["ageBand"] == "25-34"
    minimal = VisitorEvent(camera_id=1, type="ENTRY", ts=iso(0), track_id="t", visitor_id="v").to_payload()
    assert set(minimal) == {"cameraId", "type", "ts", "trackId", "visitorId"}


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "WALK"},
        {"gender": "X"},
        {"age_band": "30-40"},
        {"dwell_sec": -1},
    ],
)
def test_visitor_event_enums_enforced(bad) -> None:
    base = dict(camera_id=1, type="ENTRY", ts=iso(0), track_id="t", visitor_id="v")
    base.update(bad)
    with pytest.raises(ValidationError):
        VisitorEvent(**base)


def test_events_payload_max_5000() -> None:
    e = VisitorEvent(camera_id=1, type="ENTRY", ts=iso(0), track_id="t", visitor_id="v")
    EventsPayload(events=[e] * 5000)
    with pytest.raises(ValidationError):
        EventsPayload(events=[e] * 5001)


def test_other_payloads() -> None:
    assert QueueSnapshot(zone_id=1, ts=iso(0), queue_length=2, avg_wait_sec=30, counter_staffed=False).to_payload() == {
        "zoneId": 1, "ts": iso(0), "queueLength": 2, "avgWaitSec": 30.0, "counterStaffed": False,
    }
    for t in ("STORE_OPENED", "STORE_CLOSED", "SOP_BREACH", "COUNTER_UNATTENDED", "STAFF_ABSENT", "LIGHTS_OFF", "CAMERA_TAMPER"):
        StoreOpsEvent(type=t, ts=iso(0))  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        StoreOpsEvent(type="FIRE", ts=iso(0))  # type: ignore[arg-type]
    hm = HeatmapPayload(camera_id=1, ts=iso(0), grid=[0] * 576).to_payload()
    assert (hm["width"], hm["height"], len(hm["grid"])) == (32, 18, 576)
    with pytest.raises(ValidationError):
        HeatmapPayload(camera_id=1, ts=iso(0), grid=[0] * 10)
    with pytest.raises(ValidationError):
        HeartbeatPayload(cameras=[{"camera_id": 1, "status": "UNKNOWN"}])  # type: ignore[list-item]


def test_ingest_config_parsing_is_tolerant() -> None:
    cfg = IngestConfig.model_validate(
        {
            "store": {"id": 1, "name": "T Nagar", "openTime": "09:30", "closeTime": "21:30", "areaSqft": 4000, "unknownField": 1},
            "cameras": [{"id": 3, "storeId": 1, "name": "Cam", "rtspUrl": "rtsp://a", "type": "ZONE", "status": "UNKNOWN", "lastHeartbeatAt": None, "isActive": False}],
            "zones": [
                {"id": 1, "storeId": 1, "cameraId": 3, "name": "Z", "type": "SECTION", "polygon": "[[0,0],[1,0],[1,1]]", "engagedDwellSec": 45, "isActive": True},
                {"id": 2, "storeId": 1, "cameraId": 3, "name": "Q", "type": "QUEUE", "polygon": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}], "engagedDwellSec": 30, "queueAlertLength": 5, "isActive": False},
            ],
            "settings": {"engagedStoreDwellSec": 300, "bounceSec": 60, "currency": "INR"},
        }
    )
    assert cfg.store.open_time == "09:30"
    assert cfg.zones[0].polygon == [(0, 0), (1, 0), (1, 1)]
    assert cfg.zones[1].polygon[1] == (1, 0)
    assert cfg.active_cameras() == []
    assert [z.id for z in cfg.zones_for(3)] == [1]
