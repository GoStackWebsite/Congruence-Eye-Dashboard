"""Runtime configuration (environment variables / .env) for the edge AI service."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import json
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

HsvRange = tuple[tuple[int, int, int], tuple[int, int, int]]

#: Default Congruence staff uniform colour (teal). OpenCV HSV scale: H 0-179, S/V 0-255.
DEFAULT_UNIFORM_HSV: list[HsvRange] = [((80, 120, 60), (95, 255, 255))]


class Settings(BaseSettings):
    """All tunables of the AI service. Every field can be set via an env var of the same name."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- backend -------------------------------------------------------------------------
    BACKEND_URL: str = "http://localhost:3000"
    EDGE_API_KEY: str = "dev-edge-key-store-1"
    HTTP_TIMEOUT_SEC: float = 15.0
    HTTP_RETRIES: int = 3
    CONFIG_REFRESH_SEC: float = 300

    # --- model / detection ---------------------------------------------------------------
    MODEL_PATH: str = "yolo11n.pt"
    CONF: float = 0.35
    IOU: float = 0.5
    IMGSZ: int = 640
    DEVICE: str = "cpu"
    TRACKER: str = "bytetrack.yaml"
    TARGET_FPS: float = 5.0
    TRACK_LOST_SEC: float = 2.0

    # --- periodic outputs ----------------------------------------------------------------
    HEARTBEAT_SEC: float = 30
    FLUSH_SEC: float = 5
    SNAPSHOT_SEC: float = 60
    HEATMAP_SEC: float = 300
    QUEUE_SNAPSHOT_SEC: float = 30
    MAX_EVENTS_PER_BATCH: int = 5000

    # --- offline spool -------------------------------------------------------------------
    SPOOL_DIR: Path = Path("./spool")
    SPOOL_MAX_ROWS: int = 200_000

    # --- analytics tuning ----------------------------------------------------------------
    LINE_MARGIN: float = 0.015
    LINE_MIN_FRAMES: int = 2
    ZONE_MIN_PRESENCE_SEC: float = 2.0
    ZONE_EXIT_GRACE_SEC: float = 1.0
    QUEUE_MIN_PRESENCE_SEC: float = 1.0
    COUNTER_UNATTENDED_SEC: float = 60.0
    GROUP_WINDOW_SEC: float = 3.0
    GROUP_MAX_DISTANCE: float = 0.2
    STAFF_UNIFORM_HSV: list[HsvRange] = Field(default_factory=lambda: list(DEFAULT_UNIFORM_HSV))
    STAFF_UNIFORM_MIN_RATIO: float = 0.35
    STAFF_MIN_VOTES: int = 3
    STAFF_ZONE_MODE: Literal["mark_staff", "breach"] = "mark_staff"
    STAFF_ZONE_CONFIRM_SEC: float = 5.0
    SOP_BREACH_SEC: float = 10.0
    REID_THRESHOLD: float = 0.86
    REID_WINDOW_SEC: float = 7200.0
    REID_REENTRY_SEC: float = 300.0
    ENABLE_DEMOGRAPHICS: bool = True
    DEMOGRAPHICS_MAX_SAMPLES: int = 5
    MODELS_DIR: Path = Path("./models")

    # --- AI Manager / AI-in-checklist (contract v2) ----------------------------------
    AI_COOLDOWN_SEC: float = 600.0
    SHELF_CHECK_SEC: float = 30.0
    PHONE_CONF: float = 0.25
    SPOOL_MAX_SNAPSHOTS: int = 2000
    CHECKLIST_USE_YOLO: bool = True

    # --- store ops ----------------------------------------------------------------------
    LIGHTS_OFF_BRIGHTNESS: float = 40.0
    LIGHTS_PERSIST_SEC: float = 60.0
    TAMPER_STD: float = 8.0
    TAMPER_BLUR_RATIO: float = 0.15
    TAMPER_PERSIST_SEC: float = 5.0
    STAFF_ABSENT_SEC: float = 900.0
    STORE_CLOSED_IDLE_SEC: float = 1800.0

    # --- cameras ------------------------------------------------------------------------
    CAMERA_SOURCE_OVERRIDES: Annotated[dict[int, str], NoDecode] = Field(default_factory=dict)
    CAMERA_OFFLINE_SEC: float = 10.0
    RECONNECT_MAX_SEC: float = 60.0
    FILE_LOOP: bool = True

    # --- contract v3: DVR / NVR connection tests and LAN discovery -------------------------
    PROBE_ENABLED: bool = True
    PROBE_POLL_SEC: float = 5.0
    PROBE_BURST_POLL_SEC: float = 1.0
    PROBE_BURST_WINDOW_SEC: float = 30.0
    PROBE_TIMEOUT_SEC: float = 10.0
    PROBE_CONCURRENCY: int = 4
    FFMPEG_PATH: str | None = None
    ONVIF_TIMEOUT_SEC: float = 5.0
    DISCOVERY_ENABLED: bool = True
    DISCOVERY_TIMEOUT_SEC: float = 10.0
    DISCOVERY_INTERVAL_SEC: float = 3600.0
    DISCOVERY_SUBNET: str | None = None
    DISCOVERY_PORTS: list[int] = Field(default_factory=lambda: [554])
    DISCOVERY_WS_ENABLED: bool = True

    # --- API ----------------------------------------------------------------------------
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    LOG_LEVEL: str = "INFO"

    @field_validator("CAMERA_SOURCE_OVERRIDES", mode="before")
    @classmethod
    def _parse_overrides(cls, v: object) -> object:
        """Accept JSON (handled by pydantic-settings) or ``1=/path.mp4,2=rtsp://...``."""
        if isinstance(v, str):
            if not v.strip():
                return {}
            if v.strip().startswith("{"):
                return json.loads(v)
            out: dict[int, str] = {}
            for part in v.split(","):
                if "=" in part:
                    k, val = part.split("=", 1)
                    out[int(k.strip())] = val.strip()
            return out
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
