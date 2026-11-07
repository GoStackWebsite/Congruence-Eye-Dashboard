"""Output sinks that receive contract payloads from camera processors."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Protocol

from .backend_client import BackendClient
from .schemas import Detection, HeatmapPayload, QueueSnapshot, StoreOpsEvent, VisitorEvent


@dataclass
class SnapshotOut:
    """A JPEG to upload via ``POST /api/ingest/snapshot`` (kind PERIODIC/OPENING/CLOSING/AI_MANAGER/REFERENCE)."""

    camera_id: int
    kind: str
    t: float
    jpeg: bytes


@dataclass
class Bundle:
    """Snapshot + the store-ops events / detections that reference its ``snapshotId``."""

    snapshot: SnapshotOut | None
    storeops: list[StoreOpsEvent]
    detections: list[Detection]


class OutputSink(Protocol):
    def emit_event(self, ev: VisitorEvent) -> None: ...
    def emit_queue(self, snap: QueueSnapshot) -> None: ...
    def emit_storeops(self, ev: StoreOpsEvent) -> None: ...
    def emit_heatmap(self, hm: HeatmapPayload) -> None: ...
    def emit_snapshot(self, snap: SnapshotOut) -> None: ...
    def emit_bundle(self, bundle: Bundle) -> None: ...


class ListSink:
    """Collects everything in memory (tests, simulator dry-run)."""

    def __init__(self) -> None:
        self.events: list[VisitorEvent] = []
        self.queue: list[QueueSnapshot] = []
        self.storeops: list[StoreOpsEvent] = []
        self.heatmaps: list[HeatmapPayload] = []
        self.snapshots: list[SnapshotOut] = []
        self.detections: list[Detection] = []
        self.bundles: list[Bundle] = []
        self._lock = threading.Lock()

    def emit_event(self, ev: VisitorEvent) -> None:
        with self._lock:
            self.events.append(ev)

    def emit_queue(self, snap: QueueSnapshot) -> None:
        with self._lock:
            self.queue.append(snap)

    def emit_storeops(self, ev: StoreOpsEvent) -> None:
        with self._lock:
            self.storeops.append(ev)

    def emit_heatmap(self, hm: HeatmapPayload) -> None:
        with self._lock:
            self.heatmaps.append(hm)

    def emit_snapshot(self, snap: SnapshotOut) -> None:
        with self._lock:
            self.snapshots.append(snap)

    def emit_bundle(self, bundle: Bundle) -> None:
        with self._lock:
            self.bundles.append(bundle)
            if bundle.snapshot is not None:
                self.snapshots.append(bundle.snapshot)
            self.storeops.extend(bundle.storeops)
            self.detections.extend(bundle.detections)

    def counts(self) -> dict[str, int]:
        from collections import Counter

        c = Counter(e.type for e in self.events)
        return {
            **{k: c.get(k, 0) for k in ("ENTRY", "EXIT", "ZONE_ENTER", "ZONE_EXIT")},
            "queueSnapshots": len(self.queue),
            "storeOps": len(self.storeops),
            "heatmaps": len(self.heatmaps),
            "snapshots": len(self.snapshots),
            "detections": len(self.detections),
        }


class BackendSink:
    """Buffers payloads in memory and writes them to the durable spool on :meth:`flush`
    (called every ``FLUSH_SEC`` and on shutdown); the client's sender thread delivers them."""

    def __init__(self, client: BackendClient) -> None:
        self.client = client
        self._events: list[VisitorEvent] = []
        self._queue: list[QueueSnapshot] = []
        self._ops: list[StoreOpsEvent] = []
        self._lock = threading.Lock()
        self.totals: dict[str, int] = {"events": 0, "queue": 0, "storeops": 0, "heatmap": 0, "snapshots": 0, "detections": 0}

    def emit_event(self, ev: VisitorEvent) -> None:
        with self._lock:
            self._events.append(ev)

    def emit_queue(self, snap: QueueSnapshot) -> None:
        with self._lock:
            self._queue.append(snap)

    def emit_storeops(self, ev: StoreOpsEvent) -> None:
        with self._lock:
            self._ops.append(ev)
        self.flush()  # operational alerts should not wait

    def emit_heatmap(self, hm: HeatmapPayload) -> None:
        self.client.enqueue_heatmap(hm)
        self.totals["heatmap"] += 1

    def emit_snapshot(self, snap: SnapshotOut) -> None:
        self.client.enqueue_snapshot(snap.camera_id, snap.kind, snap.t, snap.jpeg)
        self.totals["snapshots"] += 1

    def emit_bundle(self, bundle: Bundle) -> None:
        s = bundle.snapshot
        self.client.enqueue_bundle(
            None if s is None else (s.camera_id, s.kind, s.t, s.jpeg),
            [e.to_payload() for e in bundle.storeops],
            [d.to_payload() for d in bundle.detections],
        )
        self.totals["snapshots"] += 1 if s is not None else 0
        self.totals["storeops"] += len(bundle.storeops)
        self.totals["detections"] += len(bundle.detections)

    def flush(self) -> None:
        with self._lock:
            ev, q, ops = self._events, self._queue, self._ops
            self._events, self._queue, self._ops = [], [], []
        if ev:
            self.client.enqueue_events(ev)
        if q:
            self.client.enqueue_queue(q)
        if ops:
            self.client.enqueue_storeops(ops)
        self.totals["events"] += len(ev)
        self.totals["queue"] += len(q)
        self.totals["storeops"] += len(ops)


class TeeSink:
    """Fan-out to several sinks."""

    def __init__(self, *sinks: OutputSink) -> None:
        self.sinks = sinks

    def emit_event(self, ev: VisitorEvent) -> None:
        for s in self.sinks:
            s.emit_event(ev)

    def emit_queue(self, snap: QueueSnapshot) -> None:
        for s in self.sinks:
            s.emit_queue(snap)

    def emit_storeops(self, ev: StoreOpsEvent) -> None:
        for s in self.sinks:
            s.emit_storeops(ev)

    def emit_heatmap(self, hm: HeatmapPayload) -> None:
        for s in self.sinks:
            s.emit_heatmap(hm)

    def emit_snapshot(self, snap: SnapshotOut) -> None:
        for s in self.sinks:
            s.emit_snapshot(snap)

    def emit_bundle(self, bundle: Bundle) -> None:
        for s in self.sinks:
            s.emit_bundle(bundle)

    def flush(self) -> None:
        """Forwards flush to every buffering sink (e.g. a BackendSink teed with ``--print-events``)."""
        for s in self.sinks:
            fl = getattr(s, "flush", None)
            if callable(fl):
                fl()
