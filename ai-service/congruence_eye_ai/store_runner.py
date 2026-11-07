"""Orchestrates all camera workers of one store from the backend configuration."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from . import __version__
from .analytics.demographics import AgeGenderEstimator, build_estimator
from .backend_client import BackendClient
from .camera_worker import CameraWorker
from .config import Settings
from .detector import Detector, build_detector
from .processor import CameraProcessor, StoreContext
from .aimanager.detectors import PHONE_CLASS
from .schemas import CameraHeartbeat, HeartbeatPayload, IngestConfig
from .sink import BackendSink, SnapshotOut
from .recorders.discovery import DiscoveredDevice, discover
from .recorders.onvif import resolve_stream_uri
from .recorders.poller import ProbePoller
from .recorders.prober import RtspProber
from .recorders.urls import redact

log = logging.getLogger(__name__)


class StoreRunner:
    """Runs the whole edge pipeline for the store owning ``EDGE_API_KEY``.

    * pulls ``/api/ingest/config`` (cached locally for offline restarts) and refreshes it every
      ``CONFIG_REFRESH_SEC``; only cameras whose settings or zones changed are restarted;
    * one :class:`CameraWorker` thread per active camera;
    * a housekeeping thread flushes the output buffer to the spool every ``FLUSH_SEC``, runs the
      store-ops rules every second and sends heartbeats every ``HEARTBEAT_SEC``.
    """

    def __init__(
        self,
        settings: Settings,
        client: BackendClient | None = None,
        detector_factory: Callable[[], Detector] | None = None,
        estimator_factory: Callable[[], AgeGenderEstimator] | None = None,
    ) -> None:
        self.settings = settings
        self.client = client or BackendClient(
            settings.BACKEND_URL,
            settings.EDGE_API_KEY,
            settings.SPOOL_DIR,
            timeout=settings.HTTP_TIMEOUT_SEC,
            retries=settings.HTTP_RETRIES,
            max_batch=settings.MAX_EVENTS_PER_BATCH,
            spool_max_rows=settings.SPOOL_MAX_ROWS,
            spool_max_snapshots=settings.SPOOL_MAX_SNAPSHOTS,
        )
        self.detector_factory = detector_factory or self._default_detector
        self.estimator_factory = estimator_factory or (
            lambda: build_estimator(settings.ENABLE_DEMOGRAPHICS, settings.MODELS_DIR)
        )
        self.sink = BackendSink(self.client)
        self.config: IngestConfig | None = None
        self.ctx: StoreContext | None = None
        self.workers: dict[int, CameraWorker] = {}
        self._signatures: dict[int, str] = {}
        self._stop = threading.Event()
        self._house: threading.Thread | None = None
        self._lock = threading.RLock()
        self.started_at: float | None = None
        self.last_config_at: float | None = None
        self.last_heartbeat_ok: bool | None = None
        # contract v3: connection tests (probes) and LAN discovery
        self.prober = RtspProber(settings.PROBE_TIMEOUT_SEC, settings.FFMPEG_PATH)
        self.probe_poller: ProbePoller | None = (
            ProbePoller(
                self.client, self.prober, poll_sec=settings.PROBE_POLL_SEC, burst_poll_sec=settings.PROBE_BURST_POLL_SEC,
                burst_window_sec=settings.PROBE_BURST_WINDOW_SEC, concurrency=settings.PROBE_CONCURRENCY, onvif_timeout=settings.ONVIF_TIMEOUT_SEC,
            )
            if settings.PROBE_ENABLED
            else None
        )
        self._onvif_cache: dict[tuple[Any, ...], str] = {}
        self._discovery_lock = threading.Lock()
        self.last_discovery_at: float | None = None
        self.last_discovery: list[DiscoveredDevice] = []

    def _default_detector(self) -> Detector:
        """YOLO person tracker; also tracks phones (COCO 67) when a MOBILE_USAGE rule exists."""
        cfg = self.config
        phones = bool(cfg and any(r.type == "MOBILE_USAGE" and r.is_active for r in cfg.ai_manager_rules))
        return build_detector(self.settings, [PHONE_CLASS] if phones else [])

    def _periodic_snapshot(self, camera_id: int, jpeg: bytes) -> None:
        """PERIODIC snapshots feed the Image Directory and the daily recap video (spooled)."""
        self.sink.emit_snapshot(SnapshotOut(camera_id, "PERIODIC", time.time(), jpeg))

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self.started_at = time.time()
        self.client.start()
        if self.probe_poller:
            self.probe_poller.start()
        self._load_config_with_retry()
        self._house = threading.Thread(target=self._housekeeping, name="housekeeping", daemon=True)
        self._house.start()

    def _load_config_with_retry(self) -> None:
        delay = 2.0
        while not self._stop.is_set():
            try:
                self.apply_config(self.client.get_config())
                return
            except Exception as exc:
                log.error("Cannot load store config (%s); retrying in %.0fs", exc, delay)
                self._stop.wait(delay)
                delay = min(60.0, delay * 2)

    def stop(self) -> None:
        log.info("Stopping store runner ...")
        self._stop.set()
        if self.probe_poller:
            self.probe_poller.stop()
        with self._lock:
            for w in self.workers.values():
                w.stop()
            for w in self.workers.values():
                w.join(timeout=10)
        if self._house:
            self._house.join(timeout=5)
        if self.ctx:
            self.ctx.tick_ops(time.time())
        self.sink.flush()
        self.client.stop(final_drain=True)
        log.info("Store runner stopped")

    # ------------------------------------------------------------------ config
    def reload_config(self) -> dict[str, Any]:
        cfg = self.client.get_config()
        return self.apply_config(cfg)

    def apply_config(self, cfg: IngestConfig) -> dict[str, Any]:
        with self._lock:
            store_changed = (
                self.config is None
                or self.config.store.model_dump() != cfg.store.model_dump()
                or [r.model_dump() for r in self.config.ai_manager_rules] != [r.model_dump() for r in cfg.ai_manager_rules]
            )
            self.config = cfg
            if self.ctx is None or store_changed:
                # a new context resets store-level state (re-id gallery, ops, AI Manager rules);
                # restart all cameras
                self.ctx = StoreContext(self.settings, cfg, self.sink)
                restart_all = True
            else:
                self.ctx.config = cfg
                restart_all = False
            wanted = {c.id: c for c in cfg.active_cameras()}
            started, stopped = [], []
            for cid in list(self.workers):
                sig = self._signature(cfg, cid) if cid in wanted else None
                if restart_all or sig != self._signatures.get(cid):
                    w = self.workers.pop(cid)
                    w.stop()
                    w.join(timeout=10)
                    self._signatures.pop(cid, None)
                    stopped.append(cid)
            for cid, cam in wanted.items():
                if cid in self.workers:
                    continue
                proc = CameraProcessor(cam, cfg.zones_for(cid), self.ctx, self.estimator_factory())
                source = self.settings.CAMERA_SOURCE_OVERRIDES.get(cid) or self.camera_source(cam)
                w = CameraWorker(proc, source, self.detector_factory, self.settings, self._periodic_snapshot)
                self.workers[cid] = w
                self._signatures[cid] = self._signature(cfg, cid)
                w.start()
                started.append(cid)
            self.last_config_at = time.time()
            log.info(
                "Config applied for store %s (%s): %d cameras, %d zones; started %s stopped %s",
                cfg.store.id, cfg.store.name, len(wanted), len(cfg.zones), started, stopped,
            )
            return {"storeId": cfg.store.id, "cameras": len(wanted), "zones": len(cfg.zones), "started": started, "stopped": stopped}

    def camera_source(self, cam: Any) -> str | None:
        """The stream URL of a camera: GENERIC_ONVIF recorder channels are resolved with ONVIF GetStreamUri
        (cached), falling back to the backend's template URL."""
        rec = cam.recorder or {}
        onvif = cam.onvif
        if rec.get("brand") != "GENERIC_ONVIF" or not onvif or not cam.channel:
            return cam.rtsp_url
        key = (onvif.get("host"), onvif.get("httpPort"), onvif.get("username"), onvif.get("password"), cam.channel, cam.stream_profile)
        if key in self._onvif_cache:
            return self._onvif_cache[key]
        try:
            url = resolve_stream_uri(onvif["host"], int(onvif.get("httpPort") or 80), onvif.get("username") or "", onvif.get("password") or "",
                                     int(cam.channel), cam.stream_profile or "MAIN", timeout=self.settings.ONVIF_TIMEOUT_SEC)
            log.info("camera %s: ONVIF stream %s", cam.id, redact(url))
            self._onvif_cache[key] = url
            return url
        except Exception as exc:
            log.warning("camera %s: ONVIF GetStreamUri failed (%s); using %s", cam.id, exc, redact(cam.rtsp_url or ""))
            return cam.rtsp_url

    # ------------------------------------------------------------------ discovery
    def discover(self, report: bool = True) -> list[DiscoveredDevice]:
        """WS-Discovery + RTSP scan of the local /24 (capped at DISCOVERY_TIMEOUT_SEC); reported to the backend."""
        s = self.settings
        with self._discovery_lock:
            devices = discover(timeout=s.DISCOVERY_TIMEOUT_SEC, subnet=s.DISCOVERY_SUBNET, ports=s.DISCOVERY_PORTS,
                               ws_discovery_enabled=s.DISCOVERY_WS_ENABLED)
            self.last_discovery_at = time.time()
            self.last_discovery = devices
        if report and devices:
            self.client.post_discovered([d.to_payload() for d in devices])
        log.info("discovery: %d device(s) %s", len(devices), [f"{d.host}:{d.port}" for d in devices][:20])
        return devices

    def _signature(self, cfg: IngestConfig, cid: int) -> str:
        cam = next(c for c in cfg.cameras if c.id == cid)
        zones = sorted((z.model_dump() for z in cfg.zones_for(cid)), key=lambda z: z["id"])
        return json.dumps(
            {"cam": cam.model_dump(), "zones": zones, "src": self.settings.CAMERA_SOURCE_OVERRIDES.get(cid)},
            sort_keys=True,
            default=str,
        )

    # ------------------------------------------------------------------ housekeeping
    def _housekeeping(self) -> None:
        s = self.settings
        last_flush = last_hb = time.time()
        last_cfg = time.time()
        # first LAN discovery shortly after start, then every DISCOVERY_INTERVAL_SEC
        next_discovery = time.time() + 30 if s.DISCOVERY_ENABLED and s.DISCOVERY_INTERVAL_SEC > 0 else None
        self.send_heartbeat()
        while not self._stop.wait(1.0):
            now = time.time()
            try:
                if self.ctx:
                    self.ctx.tick_ops(now)
                if now - last_flush >= s.FLUSH_SEC:
                    last_flush = now
                    self.sink.flush()
                if now - last_hb >= s.HEARTBEAT_SEC:
                    last_hb = now
                    self.send_heartbeat()
                if now - last_cfg >= s.CONFIG_REFRESH_SEC:
                    last_cfg = now
                    try:
                        self.reload_config()
                    except Exception as exc:
                        log.warning("config refresh failed: %s", exc)
                if next_discovery is not None and now >= next_discovery:
                    next_discovery = now + s.DISCOVERY_INTERVAL_SEC
                    threading.Thread(target=self._discover_quietly, name="discovery", daemon=True).start()
            except Exception:  # pragma: no cover - keep the loop alive
                log.exception("housekeeping error")

    def _discover_quietly(self) -> None:
        try:
            self.discover(report=True)
        except Exception as exc:  # pragma: no cover - best effort
            log.warning("discovery failed: %s", exc)

    def heartbeat_payload(self) -> HeartbeatPayload:
        now = time.time()
        cams: list[CameraHeartbeat] = []
        with self._lock:
            for cid, w in self.workers.items():
                st, reason = w.health.status(now)
                cams.append(CameraHeartbeat(camera_id=cid, status=st, fps=w.health.fps(now) if st == "ONLINE" else None, reason=reason[:300] if reason else None))  # type: ignore[arg-type]
        return HeartbeatPayload(version=__version__, cameras=cams)

    def send_heartbeat(self) -> bool:
        self.last_heartbeat_ok = self.client.heartbeat(self.heartbeat_payload())
        return self.last_heartbeat_ok

    # ------------------------------------------------------------------ status
    def status(self) -> dict[str, Any]:
        with self._lock:
            cams = [w.status() for w in self.workers.values()]
            store = self.config.store if self.config else None
        return {
            "version": __version__,
            "store": {"id": store.id, "name": store.name} if store else None,
            "uptimeSec": round(time.time() - self.started_at, 1) if self.started_at else 0,
            "backend": {
                "url": self.settings.BACKEND_URL,
                "online": self.client.online,
                "lastError": self.client.last_error,
                "spoolPendingItems": self.client.spool.pending_items(),
                "deadLetters": self.client.spool.dead_count(),
                "sentItems": self.client.sent_items,
                "lastHeartbeatOk": self.last_heartbeat_ok,
            },
            "aiManager": {
                "rules": [{"id": r.rule_id, "type": r.type, "name": r.name} for r in (self.ctx.ai_rules if self.ctx else [])],
                "detections": dict(self.ctx.ai_counts) if self.ctx else {},
            },
            "storeOps": {
                "lightsOn": self.ctx.ops.lights_on if self.ctx else None,
                "openedAt": self.ctx.ops.opened_at if self.ctx else None,
                "occupancy": self.ctx.dwell.occupancy() if self.ctx else 0,
            },
            "probes": {
                "enabled": self.probe_poller is not None,
                "backend": self.prober.backend,
                "done": self.probe_poller.done if self.probe_poller else 0,
                "lastError": self.probe_poller.last_error if self.probe_poller else None,
            },
            "discovery": {
                "enabled": self.settings.DISCOVERY_ENABLED,
                "lastRunAt": self.last_discovery_at,
                "devices": [d.contract() for d in self.last_discovery],
            },
            "cameras": cams,
        }
