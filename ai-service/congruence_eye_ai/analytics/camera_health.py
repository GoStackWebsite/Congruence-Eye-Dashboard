"""Per-camera stream health (ONLINE/OFFLINE, fps, reconnect backoff)."""

from __future__ import annotations

import threading
from collections import deque


class CameraHealth:
    """Tracks frames received and stream failures for one camera."""

    def __init__(self, camera_id: int, offline_after_sec: float = 10.0, max_backoff_sec: float = 60.0) -> None:
        self.camera_id = camera_id
        self.offline_after_sec = offline_after_sec
        self.max_backoff_sec = max_backoff_sec
        self._frames: deque[float] = deque(maxlen=120)
        self._last_frame: float | None = None
        self._reason: str | None = "starting"
        self._failures = 0
        self._lock = threading.Lock()
        self.processed = 0

    def on_frame(self, t: float) -> None:
        with self._lock:
            self._frames.append(t)
            self._last_frame = t
            self._reason = None
            self._failures = 0
            self.processed += 1

    def on_failure(self, reason: str) -> None:
        with self._lock:
            self._reason = reason
            self._failures += 1

    def next_backoff(self) -> float:
        """Exponential reconnect delay: 1, 2, 4, ... capped at ``max_backoff_sec``."""
        with self._lock:
            return float(min(self.max_backoff_sec, 2 ** max(0, self._failures - 1)))

    def fps(self, now: float) -> float:
        with self._lock:
            recent = [x for x in self._frames if now - x <= 10.0]
        if len(recent) < 2:
            return 0.0
        span = recent[-1] - recent[0]
        return round((len(recent) - 1) / span, 2) if span > 0 else 0.0

    def status(self, now: float) -> tuple[str, str | None]:
        """("ONLINE"|"OFFLINE", reason)."""
        with self._lock:
            last, reason = self._last_frame, self._reason
        if last is None:
            return "OFFLINE", reason or "no frames yet"
        if now - last > self.offline_after_sec:
            return "OFFLINE", reason or f"no frames for {int(now - last)}s"
        return "ONLINE", None
