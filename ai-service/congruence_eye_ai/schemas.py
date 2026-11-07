"""Pydantic models mirroring docs/API_CONTRACT.md (Ingestion section).

Outgoing payloads are serialised with ``to_payload()`` which produces camelCase keys and drops
``None`` optionals, exactly as the backend's class-validator DTOs expect.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

EventType = Literal["ENTRY", "EXIT", "ZONE_ENTER", "ZONE_EXIT"]
Gender = Literal["M", "F", "U"]
AgeBand = Literal["0-17", "18-24", "25-34", "35-44", "45-54", "55+", "U"]
StoreOpsType = Literal[
    "STORE_OPENED",
    "STORE_CLOSED",
    "SOP_BREACH",
    "COUNTER_UNATTENDED",
    "STAFF_ABSENT",
    "LIGHTS_OFF",
    "CAMERA_TAMPER",
]
ZoneType = Literal["ENTRY_LINE", "SECTION", "QUEUE", "STAFF_ONLY", "SHELF"]
CameraType = Literal["ENTRANCE", "ZONE", "BILLING", "GENERAL"]
Direction = Literal["UP", "DOWN", "LEFT", "RIGHT"]
CameraStatus = Literal["ONLINE", "OFFLINE"]
SnapshotKind = Literal["PERIODIC", "EVENT", "OPENING", "CLOSING", "AI_MANAGER", "REFERENCE"]
AiRuleType = Literal[
    "MOBILE_USAGE",
    "UNATTENDED_CUSTOMER",
    "STORE_OPEN_CLOSE",
    "HYGIENE_CLEANING",
    "HUDDLE_MEETING",
    "UNIFORM_COMPLIANCE",
    "STOCK_OUT",
    "QUEUE_BREACH",
]
AI_RULE_TYPES: tuple[str, ...] = (
    "MOBILE_USAGE",
    "UNATTENDED_CUSTOMER",
    "STORE_OPEN_CLOSE",
    "HYGIENE_CLEANING",
    "HUDDLE_MEETING",
    "UNIFORM_COMPLIANCE",
    "STOCK_OUT",
    "QUEUE_BREACH",
)
#: Contract v2 default params per AI Manager rule type.
DEFAULT_AI_PARAMS: dict[str, dict[str, float | bool | str]] = {
    "MOBILE_USAGE": {"minDurationSec": 20, "staffOnly": True},
    "UNATTENDED_CUSTOMER": {"minDurationSec": 120, "staffRadius": 0.15},
    "STORE_OPEN_CLOSE": {"toleranceMin": 10},
    "HYGIENE_CLEANING": {"minCoveragePct": 60},
    "HUDDLE_MEETING": {"minPeople": 3, "minDurationMin": 5, "radius": 0.2},
    "UNIFORM_COMPLIANCE": {"minNonCompliantSec": 60},
    "STOCK_OUT": {"emptyPct": 70},
    "QUEUE_BREACH": {"maxQueue": 5},
}

AGE_BANDS: tuple[str, ...] = ("0-17", "18-24", "25-34", "35-44", "45-54", "55+")
HEATMAP_W = 32
HEATMAP_H = 18


def iso(t: float) -> str:
    """Epoch seconds -> ISO-8601 UTC string with millisecond precision and ``Z`` suffix."""
    dt = datetime.fromtimestamp(round(t, 3), tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(s: str) -> float:
    """ISO-8601 string -> epoch seconds."""
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


class _Out(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)


class _In(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


# ----------------------------------------------------------------------------- outgoing


class VisitorEvent(_Out):
    camera_id: int
    zone_id: int | None = None
    type: EventType
    ts: str
    track_id: str
    visitor_id: str
    is_staff: bool | None = None
    group_id: str | None = None
    gender: Gender | None = None
    age_band: AgeBand | None = None
    dwell_sec: float | None = Field(default=None, ge=0)


class QueueSnapshot(_Out):
    zone_id: int
    ts: str
    queue_length: int = Field(ge=0)
    avg_wait_sec: float = Field(ge=0)
    counter_staffed: bool


class StoreOpsEvent(_Out):
    type: StoreOpsType
    ts: str
    camera_id: int | None = None
    details: str | None = Field(default=None, max_length=1000)
    snapshot_id: int | None = None


class Detection(_Out):
    """AI Manager detection (``POST /api/ingest/detections``)."""

    rule_id: int | None = None
    type: AiRuleType
    camera_id: int
    zone_id: int | None = None
    ts: str
    status: Literal["BREACHED", "COMPLIED"]
    details: str | None = Field(default=None, max_length=1000)
    confidence: float | None = Field(default=None, ge=0, le=1)
    snapshot_id: int | None = None


class DetectionsPayload(_Out):
    detections: list[Detection] = Field(max_length=1000)


class HeatmapPayload(_Out):
    camera_id: int
    ts: str
    width: Literal[32] = HEATMAP_W
    height: Literal[18] = HEATMAP_H
    grid: list[int]

    @field_validator("grid")
    @classmethod
    def _size(cls, v: list[int]) -> list[int]:
        if len(v) != HEATMAP_W * HEATMAP_H:
            raise ValueError(f"grid must have {HEATMAP_W * HEATMAP_H} cells")
        return v


class CameraHeartbeat(_Out):
    camera_id: int
    status: CameraStatus
    fps: float | None = None
    reason: str | None = None


class HeartbeatPayload(_Out):
    version: str | None = None
    cameras: list[CameraHeartbeat]


class EventsPayload(_Out):
    events: list[VisitorEvent] = Field(max_length=5000)


class QueuePayload(_Out):
    snapshots: list[QueueSnapshot]


class StoreOpsPayload(_Out):
    events: list[StoreOpsEvent]


# ----------------------------------------------------------------------------- incoming


class Store(_In):
    id: int
    code: str | None = None
    name: str = ""
    timezone: str = "Asia/Kolkata"
    open_time: str = "10:00"
    close_time: str = "22:00"
    is_active: bool = True


class Camera(_In):
    id: int
    store_id: int | None = None
    name: str = ""
    rtsp_url: str | None = None
    type: str = "GENERAL"
    is_active: bool = True
    fps: float | None = None
    # contract v3: DVR / NVR channel. rtsp_url is already the real URL (edge config only).
    recorder_id: int | None = None
    channel: int | None = None
    stream_profile: str | None = None
    recorder: dict[str, Any] | None = None
    onvif: dict[str, Any] | None = None


class Zone(_In):
    id: int
    store_id: int | None = None
    camera_id: int
    name: str = ""
    type: ZoneType
    polygon: list[tuple[float, float]]
    in_direction: Direction | None = None
    engaged_dwell_sec: float = 30
    queue_alert_length: int | None = None
    queue_alert_wait_sec: float | None = None
    reference_snapshot_id: int | None = None
    is_active: bool = True

    @field_validator("polygon", mode="before")
    @classmethod
    def _poly(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = json.loads(v)
        if isinstance(v, list) and v and isinstance(v[0], dict):
            v = [(p["x"], p["y"]) for p in v]
        return v


class AiManagerRule(_In):
    id: int | None = None
    name: str = ""
    type: AiRuleType
    store_ids: list[int] = Field(default_factory=list)
    zone_ids: list[int] = Field(default_factory=list)
    window_start: str = "00:00"
    window_end: str = "23:59"
    days_of_week: list[int] = Field(default_factory=list)
    params: dict[str, Any] = Field(default_factory=dict)
    severity: str | None = None
    is_active: bool = True

    def param(self, key: str) -> Any:
        """Rule param with the contract default as fallback."""
        if key in self.params and self.params[key] is not None:
            return self.params[key]
        return DEFAULT_AI_PARAMS.get(self.type, {}).get(key)


class IngestSettings(_In):
    engaged_store_dwell_sec: float = 300
    bounce_sec: float = 60


class IngestConfig(_In):
    store: Store
    cameras: list[Camera] = Field(default_factory=list)
    zones: list[Zone] = Field(default_factory=list)
    settings: IngestSettings = Field(default_factory=IngestSettings)
    ai_manager_rules: list[AiManagerRule] = Field(default_factory=list)

    def zones_for(self, camera_id: int) -> list[Zone]:
        return [z for z in self.zones if z.camera_id == camera_id and z.is_active]

    def active_cameras(self) -> list[Camera]:
        return [c for c in self.cameras if c.is_active]
