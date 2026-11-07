"""Durable SQLite outbox. Every analytics payload is written here *before* it is sent, and only
deleted after the backend acknowledged it (at-least-once delivery)."""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

#: kind -> (path, wrapper key or None for a single-object payload)
KINDS: dict[str, tuple[str, str | None]] = {
    "events": ("/api/ingest/events", "events"),
    "queue": ("/api/ingest/queue", "snapshots"),
    "storeops": ("/api/ingest/storeops", "events"),
    "heatmap": ("/api/ingest/heatmap", None),
    # snapshot (+ optional store-ops events / detections referencing its snapshotId), one per row
    "bundle": ("/api/ingest/snapshot", None),
    # periodic snapshots (Image Directory / recap); capped separately because they are large
    "snapshot": ("/api/ingest/snapshot", None),
}


@dataclass(slots=True)
class SpoolBatch:
    kind: str
    ids: list[int]
    path: str
    body: dict[str, Any]
    items: int
    #: idempotency key sent as ``X-Batch-Id``. Fixed the first time the rows are handed out and persisted with
    #: them, so a retry after a lost response (or after a process restart) resends exactly the same rows under
    #: the same id and the backend can drop the replay instead of double counting it.
    batch_id: str = ""


class Spool:
    """Append-only outbox in ``<dir>/spool.db`` (WAL mode, safe across threads)."""

    def __init__(self, directory: Path | str, max_rows: int = 200_000, max_snapshots: int = 2000) -> None:
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.max_rows = max_rows
        self.max_snapshots = max_snapshots
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.dir / "spool.db", check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,"
            " body TEXT NOT NULL, n INTEGER NOT NULL, created REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)"
        )
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS dead (id INTEGER PRIMARY KEY, kind TEXT, body TEXT, error TEXT, created REAL)"
        )
        self._db.execute("CREATE INDEX IF NOT EXISTS outbox_kind ON outbox(kind, id)")
        cols = {r[1] for r in self._db.execute("PRAGMA table_info(outbox)").fetchall()}
        if "batch" not in cols:  # spools created by older versions
            self._db.execute("ALTER TABLE outbox ADD COLUMN batch TEXT")
        self._rows = self._db.execute("SELECT count(*) FROM outbox").fetchone()[0]

    # ------------------------------------------------------------------ write
    def put(self, kind: str, body: Any, n: int = 1) -> None:
        """Store one row. ``body`` is a list of items (merge-able kinds) or a dict (heatmap)."""
        self.put_many([(kind, body, n)])

    def put_many(self, rows: list[tuple[str, Any, int]]) -> None:
        if not rows:
            return
        now = time.time()
        with self._lock:
            self._db.execute("BEGIN")
            self._db.executemany(
                "INSERT INTO outbox(kind, body, n, created) VALUES (?,?,?,?)",
                [(k, json.dumps(b, separators=(",", ":")), n, now) for k, b, n in rows],
            )
            self._db.execute("COMMIT")
            self._rows += len(rows)
            if self._rows > self.max_rows:
                drop = self._rows - self.max_rows
                self._db.execute("DELETE FROM outbox WHERE id IN (SELECT id FROM outbox ORDER BY id LIMIT ?)", (drop,))
                self._rows -= drop
                log.error("Spool full (%d rows): dropped %d oldest rows", self.max_rows, drop)
            if any(k == "snapshot" for k, _, _ in rows):
                n = self._db.execute("SELECT count(*) FROM outbox WHERE kind='snapshot'").fetchone()[0]
                if n > self.max_snapshots:
                    drop = n - self.max_snapshots
                    self._db.execute(
                        "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox WHERE kind='snapshot' ORDER BY id LIMIT ?)", (drop,)
                    )
                    self._rows -= drop
                    log.warning("Snapshot spool full: dropped %d oldest periodic snapshots", drop)

    # ------------------------------------------------------------------ read
    def next_batch(self, kind: str, max_items: int = 5000) -> SpoolBatch | None:
        """Oldest rows of ``kind`` merged into one request body (up to ``max_items`` items).

        A batch that was already handed out (has a ``batch`` id, i.e. it was attempted and not acknowledged)
        is always returned again first, with exactly the same rows and id — it is never re-merged with newer
        rows, so a replay is byte-for-byte the same request.
        """
        path, key = KINDS[kind]
        with self._lock:
            pending = self._db.execute(
                "SELECT batch FROM outbox WHERE kind=? AND batch IS NOT NULL ORDER BY id LIMIT 1", (kind,)
            ).fetchone()
            if pending is not None:
                rows = self._db.execute(
                    "SELECT id, body, n FROM outbox WHERE kind=? AND batch=? ORDER BY id", (kind, pending[0])
                ).fetchall()
                bid = pending[0]
            elif key is None:
                rows = self._db.execute("SELECT id, body, n FROM outbox WHERE kind=? ORDER BY id LIMIT 1", (kind,)).fetchall()
                bid = None
            else:
                candidates = self._db.execute(
                    "SELECT id, body, n FROM outbox WHERE kind=? ORDER BY id LIMIT 500", (kind,)
                ).fetchall()
                rows = []
                total = 0
                for r in candidates:
                    if rows and total + r[2] > max_items:
                        break
                    rows.append(r)
                    total += r[2]
                bid = None
            if not rows:
                return None
            if bid is None:
                bid = uuid.uuid4().hex
                self._db.executemany("UPDATE outbox SET batch=? WHERE id=?", [(bid, r[0]) for r in rows])
        ids = [r[0] for r in rows]
        if key is None:
            return SpoolBatch(kind, ids, path, json.loads(rows[0][1]), rows[0][2], bid)
        items: list[Any] = []
        for _, body, _ in rows:
            items.extend(json.loads(body))
        return SpoolBatch(kind, ids, path, {key: items}, len(items), bid)

    def ack(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._lock:
            self._db.execute(f"DELETE FROM outbox WHERE id IN ({','.join('?' * len(ids))})", ids)
            self._rows = max(0, self._rows - len(ids))

    def update_body(self, row_id: int, body: Any) -> None:
        """Persist partial progress of a multi-step row (e.g. snapshot already uploaded)."""
        with self._lock:
            self._db.execute("UPDATE outbox SET body=? WHERE id=?", (json.dumps(body, separators=(",", ":")), row_id))

    def mark_attempt(self, ids: list[int]) -> None:
        with self._lock:
            self._db.execute(f"UPDATE outbox SET attempts=attempts+1 WHERE id IN ({','.join('?' * len(ids))})", ids)

    def dead_letter(self, batch: SpoolBatch, error: str) -> None:
        """Move a permanently rejected batch aside (kept for inspection, never resent)."""
        with self._lock:
            self._db.execute("BEGIN")
            self._db.execute(
                "INSERT INTO dead(kind, body, error, created) VALUES (?,?,?,?)",
                (batch.kind, json.dumps(batch.body), error[:2000], time.time()),
            )
            if batch.ids:
                self._db.execute(f"DELETE FROM outbox WHERE id IN ({','.join('?' * len(batch.ids))})", batch.ids)
            self._db.execute("COMMIT")
            self._rows = max(0, self._rows - len(batch.ids))

    def count(self, kind: str | None = None) -> int:
        with self._lock:
            if kind is None:
                return self._db.execute("SELECT count(*) FROM outbox").fetchone()[0]
            return self._db.execute("SELECT count(*) FROM outbox WHERE kind=?", (kind,)).fetchone()[0]

    def pending_items(self) -> int:
        with self._lock:
            return int(self._db.execute("SELECT coalesce(sum(n),0) FROM outbox").fetchone()[0])

    def dead_count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT count(*) FROM dead").fetchone()[0]

    def close(self) -> None:
        with self._lock:
            self._db.close()
