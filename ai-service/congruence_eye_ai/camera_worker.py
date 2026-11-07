"""One capture + inference thread per camera, with reconnection and frame-rate control."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from typing import Any

import numpy as np

from .analytics import CameraHealth
from .annotate import annotate, encode_jpeg
from .config import Settings
from .detector import Detector, Track
from .processor import CameraProcessor

log = logging.getLogger(__name__)


class CameraWorker(threading.Thread):
    """Capture frames from RTSP/file, skip to ``TARGET_FPS``, detect+track, run analytics.

    * Reconnects with exponential backoff (1 s .. ``RECONNECT_MAX_SEC``) on open/read failures.
    * Files are played at real-time speed and looped when ``FILE_LOOP`` is set (handy for demos).
    * Keeps the latest frame + tracks for the annotated preview and uploads a JPEG snapshot every
      ``SNAPSHOT_SEC``.
    """

    def __init__(
        self,
        processor: CameraProcessor,
        source: str | None,
        detector_factory: Callable[[], Detector],
        settings: Settings,
        snapshot_uploader: Callable[[int, bytes], Any] | None = None,
    ) -> None:
        super().__init__(name=f"camera-{processor.camera_id}", daemon=True)
        self.processor = processor
        self.camera_id = processor.camera_id
        self.source = source
        self.detector_factory = detector_factory
        self.settings = settings
        self.snapshot_uploader = snapshot_uploader
        self.health = CameraHealth(self.camera_id, settings.CAMERA_OFFLINE_SEC, settings.RECONNECT_MAX_SEC)
        self._stop_evt = threading.Event()
        self._lock = threading.Lock()
        self._latest: tuple[np.ndarray, list[Track]] | None = None
        self._last_snapshot = 0.0
        self.detector: Detector | None = None
        if not source:
            self.health.on_failure("no stream URL configured")

    # ------------------------------------------------------------------ control
    def stop(self) -> None:
        self._stop_evt.set()

    @property
    def stopped(self) -> bool:
        return self._stop_evt.is_set()

    # ------------------------------------------------------------------ thread body
    def run(self) -> None:
        try:
            self.detector = self.detector_factory()
        except Exception as exc:
            log.exception("camera %s: detector init failed", self.camera_id)
            self.health.on_failure(f"detector init failed: {exc}")
            return
        while not self._stop_evt.is_set():
            if not self.source:
                self._idle(5.0)
                continue
            try:
                self._capture_loop()
            except Exception as exc:  # pragma: no cover - defensive
                log.exception("camera %s: capture loop crashed", self.camera_id)
                self.health.on_failure(f"error: {exc}")
            if not self._stop_evt.is_set():
                delay = self.health.next_backoff()
                log.info("camera %s: reconnecting in %.0fs", self.camera_id, delay)
                self._idle(delay)
        self.processor.close(time.time())

    def _idle(self, seconds: float) -> None:
        """Wait while keeping periodic analytics (track loss, queue snapshots) ticking."""
        end = time.time() + seconds
        while not self._stop_evt.is_set() and time.time() < end:
            self.processor.process(None, [], time.time())
            self._stop_evt.wait(min(1.0, max(0.0, end - time.time())))

    def _capture_loop(self) -> None:
        import cv2

        src = self.source
        assert src is not None
        is_file = os.path.exists(src)
        if src.startswith("rtsp://"):
            os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        cap = cv2.VideoCapture(src)
        if not cap.isOpened():
            self.health.on_failure("stream open failed")
            log.warning("camera %s: cannot open %s", self.camera_id, _redact(src))
            return
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            if not (1.0 <= src_fps <= 120.0):
                src_fps = 25.0
            interval = 1.0 / max(0.1, self.settings.TARGET_FPS)
            stride = max(1, round(src_fps / max(0.1, self.settings.TARGET_FPS)))
            log.info("camera %s: opened %s (%.1f fps source, stride %d)", self.camera_id, _redact(src), src_fps, stride)
            last_proc = 0.0
            frame_idx = 0
            started = time.time()
            if self.detector:
                self.detector.reset()
            while not self._stop_evt.is_set():
                if is_file:
                    ok = cap.grab()
                    if not ok:
                        if self.settings.FILE_LOOP:
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            frame_idx, started = 0, time.time()
                            if self.detector:
                                self.detector.reset()
                            continue
                        self.health.on_failure("end of file")
                        return
                    frame_idx += 1
                    if frame_idx % stride:
                        continue
                    # real-time pacing
                    due = started + frame_idx / src_fps
                    delay = due - time.time()
                    if delay > 0:
                        self._stop_evt.wait(delay)
                    ok, frame = cap.retrieve()
                else:
                    ok = cap.grab()  # keep draining the RTSP buffer to stay live
                    if not ok:
                        self.health.on_failure("stream read failed")
                        return
                    now = time.time()
                    if now - last_proc < interval:
                        continue
                    ok, frame = cap.retrieve()
                if not ok or frame is None:
                    self.health.on_failure("frame decode failed")
                    return
                last_proc = t = time.time()
                self._process(frame, t)
        finally:
            cap.release()

    def _process(self, frame: np.ndarray, t: float) -> None:
        assert self.detector is not None
        tracks = self.detector.track(frame, t)
        self.processor.process(frame, tracks, t)
        self.health.on_frame(t)
        with self._lock:
            self._latest = (frame, tracks)
        if self.snapshot_uploader and t - self._last_snapshot >= self.settings.SNAPSHOT_SEC:
            self._last_snapshot = t
            try:
                jpeg = encode_jpeg(frame)
                threading.Thread(target=self.snapshot_uploader, args=(self.camera_id, jpeg), daemon=True).start()
            except Exception as exc:  # pragma: no cover
                log.debug("snapshot failed: %s", exc)

    # ------------------------------------------------------------------ preview / status
    def preview_jpeg(self) -> bytes | None:
        with self._lock:
            latest = self._latest
        if latest is None:
            return None
        frame, tracks = latest
        staff = {tid for tid, st in list(self.processor.tracks.items()) if st.is_staff}
        st, _ = self.health.status(time.time())
        img = annotate(frame, self.processor.zones, tracks, staff, f"cam {self.camera_id} {st} {self.health.fps(time.time())}fps")
        return encode_jpeg(img)

    def status(self) -> dict[str, Any]:
        now = time.time()
        st, reason = self.health.status(now)
        return {
            "cameraId": self.camera_id,
            "name": self.processor.camera.name,
            "status": st,
            "reason": reason,
            "fps": self.health.fps(now),
            "framesProcessed": self.health.processed,
            **self.processor.status(),
        }


def _redact(url: str) -> str:
    """Hide credentials in rtsp://user:pass@host URLs for logs."""
    if "@" in url and "://" in url:
        scheme, rest = url.split("://", 1)
        return f"{scheme}://***@{rest.split('@', 1)[1]}"
    return url
