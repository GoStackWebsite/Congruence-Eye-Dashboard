"""FastAPI routes called by the backend for AI-in-Checklist (contract v2)."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import Settings
from .common import AiCheckResult, ImageDecodeError, decode_image, parse_hsv_ranges
from .reference_match import reference_match
from .uniform_check import PersonDetector, uniform_check

log = logging.getLogger(__name__)


class LazyPersonDetector:
    """Loads YOLO on first use (only if the weights file exists locally — never downloads)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._det = None
        self._failed = False
        self._lock = threading.Lock()

    def __call__(self, img):  # type: ignore[no-untyped-def]
        det = self._load()
        if det is None:
            return []
        return [t.bbox for t in det.detect(img) if t.conf >= 0.4]

    def _load(self):  # type: ignore[no-untyped-def]
        if self._det is not None or self._failed or not self.settings.CHECKLIST_USE_YOLO:
            return self._det
        with self._lock:
            if self._det is None and not self._failed:
                if not Path(self.settings.MODEL_PATH).is_file():
                    log.info("AI checklist: %s not found, uniform check uses the whole image", self.settings.MODEL_PATH)
                    self._failed = True
                    return None
                try:
                    from ..detector import YoloDetector

                    self._det = YoloDetector(self.settings.MODEL_PATH, conf=0.4, device=self.settings.DEVICE)
                except Exception as exc:  # pragma: no cover
                    log.warning("AI checklist: YOLO unavailable (%s)", exc)
                    self._failed = True
        return self._det


def build_router(settings: Settings, person_detector: PersonDetector | None | Callable = "auto") -> APIRouter:  # type: ignore[assignment]
    router = APIRouter(prefix="/ai/checklist", tags=["ai-checklist"])
    detector = LazyPersonDetector(settings) if person_detector == "auto" else person_detector

    async def _read(f: UploadFile | None, name: str):  # type: ignore[no-untyped-def]
        if f is None:
            raise HTTPException(422, f"{name} is required")
        try:
            return decode_image(await f.read())
        except ImageDecodeError as exc:
            raise HTTPException(422, f"{name}: {exc}") from exc

    @router.post("/reference-match", response_model=AiCheckResult, response_model_exclude_none=True)
    async def reference_match_endpoint(image: UploadFile = File(...), reference: UploadFile = File(...)) -> AiCheckResult:
        """Compare a checklist photo with the approved reference image."""
        img = await _read(image, "image")
        ref = await _read(reference, "reference")
        from starlette.concurrency import run_in_threadpool

        return await run_in_threadpool(reference_match, img, ref)

    @router.post("/uniform", response_model=AiCheckResult, response_model_exclude_none=True)
    async def uniform_endpoint(image: UploadFile = File(...), uniformHsv: str | None = Form(default=None)) -> AiCheckResult:  # noqa: N803
        """Staff grooming check: uniform colour + ID card / lanyard."""
        img = await _read(image, "image")
        try:
            ranges = parse_hsv_ranges(uniformHsv) or settings.STAFF_UNIFORM_HSV
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, f"uniformHsv: {exc}") from exc
        from starlette.concurrency import run_in_threadpool

        return await run_in_threadpool(uniform_check, img, ranges, detector)

    return router
