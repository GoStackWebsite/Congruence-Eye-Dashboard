"""HTTP client for the backend ingestion API with retries, offline spooling and replay."""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from . import __version__
from .schemas import (
    HeartbeatPayload,
    HeatmapPayload,
    IngestConfig,
    QueueSnapshot,
    StoreOpsEvent,
    VisitorEvent,
    iso,
)
from .spool import KINDS, Spool, SpoolBatch

log = logging.getLogger(__name__)

RETRYABLE_STATUS = {401, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504}


def _permanent(status: int, text: str) -> bool:
    """A 403 because the cameras belong to another store will never succeed (wrong key / stale config)."""
    return status == 403 and "another store" in text


def _snap_body(camera_id: int, kind: str, t: float, jpeg: bytes) -> dict[str, Any]:
    return {"cameraId": camera_id, "kind": kind, "ts": iso(t), "jpeg": base64.b64encode(jpeg).decode("ascii")}


class BackendClient:
    """Edge client of ``/api/ingest/*``.

    * All analytics payloads go through the durable :class:`Spool` first (write-ahead) and are
      deleted only after a 2xx response, so a backend/network outage loses nothing: the
      background sender replays the backlog in order once the backend is reachable again.
    * Event batches are merged up to ``max_batch`` (5000) per request.
    * 400/413/422 responses are moved to a dead-letter table (inspectable, never retried) so one
      malformed batch cannot block the queue; auth/5xx/network errors are retried with backoff.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        spool_dir: Path | str,
        timeout: float = 15.0,
        retries: int = 3,
        max_batch: int = 5000,
        spool_max_rows: int = 200_000,
        spool_max_snapshots: int = 2000,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.spool_dir = Path(spool_dir)
        self.spool = Spool(self.spool_dir, spool_max_rows, spool_max_snapshots)
        self.retries = retries
        self.max_batch = max_batch
        self._sleep = sleep
        self._http = httpx.Client(
            base_url=self.base_url,
            headers={"X-Api-Key": api_key, "User-Agent": f"congruence-eye-ai/{__version__}"},
            timeout=timeout,
            transport=transport,
        )
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.online: bool | None = None
        self.last_error: str | None = None
        self.sent_items = 0

    # ------------------------------------------------------------------ low level
    def _request(self, method: str, path: str, retries: int | None = None, **kw: Any) -> httpx.Response:
        """Request with exponential backoff on network errors / retryable status codes."""
        attempts = (self.retries if retries is None else retries) + 1
        delay = 0.5
        last_exc: Exception | None = None
        for i in range(attempts):
            try:
                r = self._http.request(method, path, **kw)
                if r.status_code < 400 or r.status_code not in RETRYABLE_STATUS or i == attempts - 1:
                    return r
                last_exc = httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            except httpx.HTTPError as exc:
                last_exc = exc
                if i == attempts - 1:
                    raise
            self._sleep(delay)
            delay = min(delay * 2, 8.0)
        raise last_exc or RuntimeError("unreachable")

    # ------------------------------------------------------------------ config
    def get_config(self) -> IngestConfig:
        """Fetch ``/api/ingest/config``; falls back to the last cached copy when offline."""
        cache = self.spool_dir / "config.json"
        try:
            r = self._request("GET", "/api/ingest/config")
            r.raise_for_status()
            data = r.json()
            cache.write_text(json.dumps(data))
            self.online = True
            return IngestConfig.model_validate(data)
        except (httpx.HTTPError, ValueError) as exc:
            self.online = False
            self.last_error = str(exc)
            if cache.exists():
                log.warning("Config fetch failed (%s); using cached config", exc)
                return IngestConfig.model_validate(json.loads(cache.read_text()))
            raise

    # ------------------------------------------------------------------ spooled outputs
    def enqueue_events(self, events: list[VisitorEvent]) -> None:
        self._enqueue_list("events", [e.to_payload() for e in events])

    def enqueue_queue(self, snaps: list[QueueSnapshot]) -> None:
        self._enqueue_list("queue", [s.to_payload() for s in snaps])

    def enqueue_storeops(self, events: list[StoreOpsEvent]) -> None:
        self._enqueue_list("storeops", [e.to_payload() for e in events])

    def enqueue_heatmap(self, hm: HeatmapPayload) -> None:
        self.spool.put("heatmap", hm.to_payload(), 1)
        self._wake.set()

    def enqueue_snapshot(self, camera_id: int, kind: str, t: float, jpeg: bytes) -> None:
        """Periodic / reference snapshot (spooled, capped by ``spool_max_snapshots``)."""
        self.spool.put("snapshot", {"snapshot": _snap_body(camera_id, kind, t, jpeg), "storeops": [], "detections": []}, 1)
        self._wake.set()

    def enqueue_bundle(
        self,
        snapshot: tuple[int, str, float, bytes] | None,
        storeops: list[dict[str, Any]],
        detections: list[dict[str, Any]],
    ) -> None:
        """Snapshot first, then store-ops events / detections carrying the returned ``snapshotId``."""
        body = {"snapshot": _snap_body(*snapshot) if snapshot else None, "storeops": storeops, "detections": detections}
        self.spool.put("bundle", body, max(1, len(storeops) + len(detections)))
        self._wake.set()

    def _enqueue_list(self, kind: str, items: list[dict[str, Any]]) -> None:
        if not items:
            return
        rows = [(kind, items[i : i + self.max_batch], len(items[i : i + self.max_batch])) for i in range(0, len(items), self.max_batch)]
        self.spool.put_many(rows)
        self._wake.set()

    def drain(self, max_requests: int | None = None) -> int:
        """Send spooled batches (oldest first per kind). Returns number of items delivered.

        A kind whose request fails is skipped for the rest of this pass so that, for example, a
        heatmap endpoint outage does not block visitor events.
        """
        delivered = 0
        requests = 0
        blocked: set[str] = set()
        while max_requests is None or requests < max_requests:
            progressed = False
            for kind in KINDS:
                if kind in blocked:
                    continue
                batch = self.spool.next_batch(kind, self.max_batch)
                if batch is None:
                    continue
                requests += 1
                ok = self._send_batch(batch)
                if ok:
                    delivered += batch.items
                    progressed = True
                else:
                    blocked.add(kind)
                if max_requests is not None and requests >= max_requests:
                    break
            if not progressed:
                break
        self.sent_items += delivered
        return delivered

    def _send_batch(self, batch: SpoolBatch) -> bool:
        if batch.kind in ("bundle", "snapshot"):
            return self._send_bundle(batch)
        try:
            r = self._request("POST", batch.path, retries=0, json=batch.body, headers=self._batch_header(batch.batch_id))
        except httpx.HTTPError as exc:
            self.spool.mark_attempt(batch.ids)
            self._set_offline(f"{batch.path}: {exc.__class__.__name__}: {exc}")
            return False
        if r.status_code < 300:
            self.spool.ack(batch.ids)
            self.online = True
            return True
        if r.status_code in RETRYABLE_STATUS and not _permanent(r.status_code, r.text):
            self.spool.mark_attempt(batch.ids)
            self._set_offline(f"{batch.path}: HTTP {r.status_code} {r.text[:200]}")
            return False
        log.error("Backend rejected %s batch (%d items) HTTP %s: %s -> dead-letter", batch.kind, batch.items, r.status_code, r.text[:500])
        self.spool.dead_letter(batch, f"HTTP {r.status_code}: {r.text}")
        return True

    @staticmethod
    def _batch_header(batch_id: str, step: str = "") -> dict[str, str]:
        """``X-Batch-Id`` (backend idempotency key, max 64 chars)."""
        if not batch_id:
            return {}
        return {"X-Batch-Id": f"{batch_id}{':' + step if step else ''}"[:64]}

    def _send_bundle(self, batch: SpoolBatch) -> bool:
        """Upload the snapshot (if any), then post dependants with its ``snapshotId``.

        Progress is persisted after every step so a retry never re-uploads or re-posts.
        """
        row_id = batch.ids[0]
        body = dict(batch.body)
        snap = body.get("snapshot")
        if snap:
            try:
                r = self._request(
                    "POST", "/api/ingest/snapshot", retries=0,
                    data={"cameraId": str(snap["cameraId"]), "kind": snap["kind"], "ts": snap["ts"]},
                    files={"file": (f"camera-{snap['cameraId']}.jpg", base64.b64decode(snap["jpeg"]), "image/jpeg")},
                    headers=self._batch_header(batch.batch_id, "snap"),
                )
            except httpx.HTTPError as exc:
                self.spool.mark_attempt(batch.ids)
                self._set_offline(f"snapshot: {exc.__class__.__name__}: {exc}")
                return False
            if r.status_code in RETRYABLE_STATUS:
                self.spool.mark_attempt(batch.ids)
                self._set_offline(f"snapshot: HTTP {r.status_code} {r.text[:200]}")
                return False
            snapshot_id = None
            if r.status_code < 300:
                try:
                    snapshot_id = r.json().get("snapshotId")
                except ValueError:
                    snapshot_id = None
            else:
                log.warning("Snapshot rejected HTTP %s: %s (dependants sent without snapshotId)", r.status_code, r.text[:300])
            body["snapshot"] = None
            body["snapshotId"] = snapshot_id
            self.spool.update_body(row_id, body)
        sid = body.get("snapshotId")
        for key, path, wrapper in (("storeops", "/api/ingest/storeops", "events"), ("detections", "/api/ingest/detections", "detections")):
            items = body.get(key) or []
            if not items:
                continue
            if sid:
                items = [{**it, "snapshotId": sid} for it in items]
            try:
                r = self._request("POST", path, retries=0, json={wrapper: items}, headers=self._batch_header(batch.batch_id, key))
            except httpx.HTTPError as exc:
                self.spool.mark_attempt(batch.ids)
                self._set_offline(f"{path}: {exc.__class__.__name__}: {exc}")
                return False
            if r.status_code in RETRYABLE_STATUS and not _permanent(r.status_code, r.text):
                self.spool.mark_attempt(batch.ids)
                self._set_offline(f"{path}: HTTP {r.status_code} {r.text[:200]}")
                return False
            if r.status_code >= 300:
                log.error("Backend rejected %s HTTP %s: %s -> dead-letter", path, r.status_code, r.text[:500])
                self.spool.dead_letter(SpoolBatch(key, [], path, {wrapper: items}, len(items)), f"HTTP {r.status_code}: {r.text}")
            body[key] = []
            self.spool.update_body(row_id, body)
        self.spool.ack(batch.ids)
        self.online = True
        return True

    def _set_offline(self, err: str) -> None:
        if self.online is not False:
            log.warning("Backend unreachable, spooling locally: %s", err)
        self.online = False
        self.last_error = err

    # ------------------------------------------------------------------ direct (not spooled)
    def heartbeat(self, payload: HeartbeatPayload) -> bool:
        """Heartbeats are not spooled (stale health data is useless)."""
        try:
            r = self._request("POST", "/api/ingest/heartbeat", retries=1, json=payload.to_payload())
            ok = r.status_code < 300
            if not ok:
                log.warning("Heartbeat HTTP %s: %s", r.status_code, r.text[:200])
            return ok
        except httpx.HTTPError as exc:
            self._set_offline(f"heartbeat: {exc}")
            return False

    def upload_snapshot(self, camera_id: int, jpeg: bytes) -> bool:
        """Latest-frame JPEG upload (best effort, not spooled)."""
        try:
            r = self._request(
                "POST",
                "/api/ingest/snapshot",
                retries=1,
                data={"cameraId": str(camera_id)},
                files={"file": (f"camera-{camera_id}.jpg", jpeg, "image/jpeg")},
            )
            return r.status_code < 300
        except httpx.HTTPError as exc:
            log.debug("snapshot upload failed: %s", exc)
            return False

    # ------------------------------------------------------------------ contract v3: probes + discovery (not spooled)
    def claim_probes(self) -> list[dict[str, Any]]:
        """``GET /api/ingest/probes``: pending connection tests of this store (the backend marks them RUNNING)."""
        try:
            r = self._request("GET", "/api/ingest/probes", retries=0)
        except httpx.HTTPError as exc:
            self._set_offline(f"probes: {exc}")
            return []
        if r.status_code >= 300:
            log.warning("probe poll HTTP %s: %s", r.status_code, r.text[:200])
            return []
        try:
            data = r.json()
        except ValueError:
            return []
        return data if isinstance(data, list) else []

    def post_probe_result(self, probe_id: int, result: dict[str, Any], jpeg: bytes | None = None) -> bool:
        """``POST /api/ingest/probes/:id`` (multipart ``result`` JSON + optional JPEG). 404/409 = nothing to do."""
        files = {"file": (f"probe-{probe_id}.jpg", jpeg, "image/jpeg")} if jpeg else None
        try:
            r = self._request("POST", f"/api/ingest/probes/{probe_id}", retries=2, data={"result": json.dumps(result)}, files=files)
        except httpx.HTTPError as exc:
            self._set_offline(f"probe result: {exc}")
            return False
        if r.status_code in (404, 409):
            log.info("probe %s result not needed any more (HTTP %s)", probe_id, r.status_code)
            return False
        if r.status_code >= 300:
            log.warning("probe %s result HTTP %s: %s", probe_id, r.status_code, r.text[:300])
            return False
        return True

    def post_discovered(self, devices: list[dict[str, Any]]) -> bool:
        """``POST /api/ingest/discovered`` with ``{ devices }``."""
        try:
            r = self._request("POST", "/api/ingest/discovered", retries=1, json={"devices": devices})
        except httpx.HTTPError as exc:
            self._set_offline(f"discovered: {exc}")
            return False
        if r.status_code >= 300:
            log.warning("discovered HTTP %s: %s", r.status_code, r.text[:200])
        return r.status_code < 300

    # ------------------------------------------------------------------ background sender
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="backend-sender", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                self.drain()
            except Exception:  # pragma: no cover - defensive
                log.exception("sender loop error")
            if self.spool.count() == 0 or self.online:
                backoff = 1.0
                self._wake.wait(timeout=5.0)
            else:
                self._wake.wait(timeout=backoff)
                backoff = min(backoff * 2, 60.0)
            self._wake.clear()

    def wake(self) -> None:
        self._wake.set()

    def stop(self, final_drain: bool = True, timeout: float = 10.0) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=timeout)
        if final_drain:
            try:
                self.drain(max_requests=20)
            except Exception:  # pragma: no cover
                pass
        self._http.close()
        self.spool.close()
