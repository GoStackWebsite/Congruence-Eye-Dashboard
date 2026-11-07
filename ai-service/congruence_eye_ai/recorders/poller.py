"""Edge side of connection tests: poll ``/api/ingest/probes``, test each stream, post the result.

* polls every ``PROBE_POLL_SEC`` (5 s); after it finds work it polls every ``PROBE_BURST_POLL_SEC`` (1 s) for
  ``PROBE_BURST_WINDOW_SEC`` (30 s), so a "Test selected" in the web app feels live;
* runs up to ``PROBE_CONCURRENCY`` tests at once (a 16-channel NVR test does not take 16 × 10 s);
* GENERIC_ONVIF probes resolve the stream URL with ONVIF GetStreamUri first (fallback: the backend's URL).
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .onvif import OnvifError, resolve_stream_uri
from .prober import ProbeResult, RtspProber
from .urls import redact

log = logging.getLogger(__name__)


class ProbePoller:
    def __init__(
        self,
        client: Any,
        prober: RtspProber | None = None,
        poll_sec: float = 5.0,
        burst_poll_sec: float = 1.0,
        burst_window_sec: float = 30.0,
        concurrency: int = 4,
        onvif_timeout: float = 5.0,
        resolver: Callable[..., str] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.client = client
        self.prober = prober or RtspProber()
        self.poll_sec = poll_sec
        self.burst_poll_sec = burst_poll_sec
        self.burst_window_sec = burst_window_sec
        self.concurrency = max(1, concurrency)
        self.onvif_timeout = onvif_timeout
        self.resolver = resolver or resolve_stream_uri
        self.clock = clock
        self.last_found: float | None = None
        self.done = 0
        self.last_error: str | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ------------------------------------------------------------------ scheduling
    def interval(self, now: float | None = None) -> float:
        now = self.clock() if now is None else now
        if self.last_found is not None and now - self.last_found < self.burst_window_sec:
            return self.burst_poll_sec
        return self.poll_sec

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="probe-poller", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=15)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.poll_once()
            except Exception as exc:  # pragma: no cover - keep polling
                self.last_error = str(exc)
                log.exception("probe poll failed")
            self._stop.wait(self.interval())

    # ------------------------------------------------------------------ work
    def poll_once(self) -> int:
        """Claims pending probes, runs them, posts results. Returns the number handled."""
        items = self.client.claim_probes()
        if not items:
            return 0
        self.last_found = self.clock()
        log.info("running %d connection test(s)", len(items))
        if len(items) == 1 or self.concurrency == 1:
            for it in items:
                self._handle(it)
        else:
            with ThreadPoolExecutor(max_workers=min(self.concurrency, len(items)), thread_name_prefix="probe") as ex:
                list(ex.map(self._handle, items))
        self.last_found = self.clock()
        return len(items)

    def resolve_url(self, item: dict[str, Any]) -> str:
        url = item.get("rtspUrl") or ""
        onvif = item.get("onvif")
        if item.get("brand") == "GENERIC_ONVIF" and onvif and item.get("channel"):
            try:
                return self.resolver(onvif["host"], int(onvif.get("httpPort") or 80), onvif.get("username") or "", onvif.get("password") or "",
                                     int(item["channel"]), item.get("streamProfile") or "MAIN", timeout=self.onvif_timeout)
            except OnvifError as exc:
                log.warning("ONVIF GetStreamUri failed for probe %s (%s); using the template URL", item.get("id"), exc)
            except Exception as exc:  # network / parse errors: fall back
                log.warning("ONVIF lookup error for probe %s: %s", item.get("id"), exc)
        return url

    def run_probe(self, item: dict[str, Any]) -> ProbeResult:
        return self.prober.probe(self.resolve_url(item))

    def _handle(self, item: dict[str, Any]) -> None:
        pid = item.get("id")
        try:
            res = self.run_probe(item)
        except Exception as exc:  # pragma: no cover - defensive
            res = ProbeResult(False, error=redact(f"{exc.__class__.__name__}: {exc}")[:300], error_code="OTHER")
        ok = self.client.post_probe_result(int(pid), res.to_payload(), res.jpeg)
        self.done += 1
        log.info("probe %s: %s%s", pid, "OK" if res.ok else res.error_code,
                 f" {res.width}x{res.height} {res.codec} {res.fps}fps {res.latency_ms}ms" if res.ok else f" {res.error}")
        if not ok:
            self.last_error = f"result for probe {pid} not accepted"
