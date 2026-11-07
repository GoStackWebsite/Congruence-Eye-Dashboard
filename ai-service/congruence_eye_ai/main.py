"""FastAPI control/status API of the edge service (port 8000) and the ``run`` entry point."""

from __future__ import annotations

import logging
import signal
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

from . import __version__
from .config import Settings, get_settings
from .store_runner import StoreRunner

log = logging.getLogger(__name__)


def create_app(runner: StoreRunner, manage_lifecycle: bool = True, person_detector: object = "auto") -> FastAPI:
    """Build the API around a :class:`StoreRunner`.

    When ``manage_lifecycle`` is true the runner is started/stopped with the app.
    """

    @asynccontextmanager
    async def lifespan(_: FastAPI):  # type: ignore[no-untyped-def]
        if manage_lifecycle:
            threading.Thread(target=runner.start, name="runner-start", daemon=True).start()
        try:
            yield
        finally:
            if manage_lifecycle:
                runner.stop()

    app = FastAPI(title="Congruence Eye AI service", version=__version__, lifespan=lifespan)
    from .checklist.api import build_router

    app.include_router(build_router(runner.settings, person_detector))  # type: ignore[arg-type]

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "version": __version__, "backendOnline": runner.client.online}

    @app.get("/status")
    def status() -> dict[str, Any]:
        return runner.status()

    @app.get("/cameras/{camera_id}/preview.jpg")
    def preview(camera_id: int) -> Response:
        w = runner.workers.get(camera_id)
        if w is None:
            raise HTTPException(404, f"camera {camera_id} is not running on this edge device")
        jpeg = w.preview_jpeg()
        if jpeg is None:
            raise HTTPException(404, "no frame captured yet")
        return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.post("/ai/shelves/{zone_id}/reference")
    def reset_shelf_reference(zone_id: int) -> dict[str, Any]:
        """Forget the stored "full shelf" reference; it is re-captured at the next clear view."""
        if runner.ctx is None:
            raise HTTPException(503, "store not configured yet")
        runner.ctx.shelf_refs.clear(zone_id)
        return {"ok": True, "zoneId": zone_id}

    @app.post("/ai/discover")
    def ai_discover(report: bool = True) -> list[dict[str, Any]]:
        """Contract v3: LAN discovery (WS-Discovery + RTSP port scan of the local /24, capped at 10 s)
        -> ``{ host, port, brandGuess, onvif }[]``; also reported to ``/api/ingest/discovered``."""
        if not runner.settings.DISCOVERY_ENABLED:
            raise HTTPException(503, "LAN discovery is disabled on this edge (DISCOVERY_ENABLED=false)")
        return [d.contract() for d in runner.discover(report=report)]

    @app.post("/reload-config")
    def reload_config() -> dict[str, Any]:
        try:
            return runner.reload_config()
        except Exception as exc:
            raise HTTPException(502, f"config reload failed: {exc}") from exc

    return app


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(threadName)s %(name)s: %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)


def run(settings: Settings | None = None, start_runner: bool = True) -> None:
    """Start the store runner + HTTP API (or the API only); stops gracefully on SIGINT/SIGTERM."""
    import uvicorn

    settings = settings or get_settings()
    setup_logging(settings.LOG_LEVEL)
    runner = StoreRunner(settings)
    app = create_app(runner, manage_lifecycle=start_runner)
    config = uvicorn.Config(app, host=settings.API_HOST, port=settings.API_PORT, log_level=settings.LOG_LEVEL.lower())
    server = uvicorn.Server(config)
    # uvicorn installs its own SIGINT/SIGTERM handlers which trigger the lifespan shutdown
    # SIGHUP -> reload the camera/zone configuration from the backend.
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, lambda *_: threading.Thread(target=runner.reload_config, daemon=True).start())
    try:
        server.run()
    except KeyboardInterrupt:  # uvicorn re-raises after a clean lifespan shutdown
        pass
