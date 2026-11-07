"""Store-level AI Manager state: window rules (one result per store per window) and open/close."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from ..geometry import BBox
from .detectors import GREEN, RED, Finding
from .rules import RuleSpec


@dataclass
class WindowState:
    rule: RuleSpec
    start: float
    end: float
    cameras: set[int] = field(default_factory=set)
    hygiene: dict[int, tuple[set[int], dict[int, BBox], int | None]] = field(default_factory=dict)
    huddle_done: bool = False
    finalized: bool = False


class StoreAiManager:
    """Shared by every camera of a store (thread-safe)."""

    def __init__(self, rules: list[RuleSpec], tz: ZoneInfo) -> None:
        self.rules = rules
        self.tz = tz
        self._windows: dict[tuple[str, float], WindowState] = {}
        self._pending: list[Finding] = []
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ window bookkeeping
    def window(self, rule: RuleSpec, t: float) -> WindowState | None:
        w = rule.window_at(t, self.tz)
        if w is None:
            return None
        key = (rule.key, w[0])
        with self._lock:
            ws = self._windows.get(key)
            if ws is None:
                ws = self._windows[key] = WindowState(rule, w[0], w[1])
            return ws

    def observe(self, win: WindowState, camera_id: int) -> None:
        with self._lock:
            win.cameras.add(camera_id)

    def hygiene_cells(self, win: WindowState, camera_id: int, cells: dict[int, BBox], zone_id: int | None) -> set[int]:
        """The (mutable) visited-cell set of this camera for the window."""
        with self._lock:
            win.cameras.add(camera_id)
            if camera_id not in win.hygiene:
                win.hygiene[camera_id] = (set(), cells, zone_id)
            return win.hygiene[camera_id][0]

    def huddle_achieved(self, win: WindowState, camera_id: int, t: float, zone_id: int | None, details: str, boxes: list[Any]) -> None:
        with self._lock:
            if win.huddle_done or win.finalized:
                return
            win.huddle_done = True
            self._pending.append(Finding(win.rule, camera_id, t, "COMPLIED", details, zone_id=zone_id, confidence=0.9, boxes=boxes))

    # ------------------------------------------------------------------ periodic
    def tick(self, t: float) -> list[Finding]:
        """Finalise ended windows; return findings to report."""
        with self._lock:
            out, self._pending = self._pending, []
            for key, w in list(self._windows.items()):
                if w.finalized or t < w.end:
                    if w.finalized and t - w.end > 86400:
                        del self._windows[key]
                    continue
                w.finalized = True
                f = self._finalize(w)
                if f is not None:
                    out.append(f)
            return out

    def _finalize(self, w: WindowState) -> Finding | None:
        span = f"{_hhmm(w.start, self.tz)}–{_hhmm(w.end, self.tz)}"
        if w.rule.type == "HYGIENE_CLEANING":
            if not w.hygiene:
                return None
            total = sum(len(c) for _, c, _ in w.hygiene.values())
            visited = sum(len(v) for v, _, _ in w.hygiene.values())
            if total == 0:
                return None
            cov = 100.0 * visited / total
            need = w.rule.pf("minCoveragePct", 60)
            cam = max(w.hygiene, key=lambda c: len(w.hygiene[c][1]))
            v, cells, zid = w.hygiene[cam]
            fills = [(b, GREEN if i in v else RED) for i, b in cells.items()]
            status = "COMPLIED" if cov >= need else "BREACHED"
            return Finding(w.rule, cam, w.end, status, f"Cleaning coverage {cov:.0f}% of floor area (required {need:.0f}%) during {span}",
                           zone_id=zid, confidence=0.8, fills=fills)
        if w.rule.type == "HUDDLE_MEETING":
            if w.huddle_done or not w.cameras:
                return None
            n = int(w.rule.pf("minPeople", 3))
            m = w.rule.pf("minDurationMin", 5)
            return Finding(w.rule, min(w.cameras), w.end, "BREACHED", f"No huddle of {n}+ staff for {m:g} min during {span}", confidence=0.8)
        return None

    # ------------------------------------------------------------------ open / close
    def open_close_findings(self, event_type: str, t: float, camera_id: int, scheduled: str) -> list[Finding]:
        """STORE_OPEN_CLOSE detections for a STORE_OPENED/STORE_CLOSED event (tolerance ``toleranceMin``)."""
        out: list[Finding] = []
        local = datetime.fromtimestamp(t, tz=self.tz)
        for r in self.rules:
            if r.type != "STORE_OPEN_CLOSE" or (r.days and (local.weekday() + 1) % 7 not in r.days):
                continue
            tol = r.pf("toleranceMin", 10)
            h, m = (int(x) for x in scheduled.split(":")[:2])
            diff = (local.hour * 60 + local.minute) - (h * 60 + m)
            what = "opened" if event_type == "STORE_OPENED" else "closed"
            if diff > tol:
                status, verdict = "BREACHED", f"late by {diff} min"
            elif diff < -tol:
                status, verdict = "BREACHED", f"early by {-diff} min"
            else:
                status, verdict = "COMPLIED", "on time"
            kind = "OPENING" if event_type == "STORE_OPENED" else "CLOSING"
            out.append(Finding(r, camera_id, t, status, f"Store {what} at {local:%H:%M} (scheduled {scheduled}) – {verdict}", confidence=0.9, snapshot_kind=kind))
        return out


def _hhmm(t: float, tz: ZoneInfo) -> str:
    return datetime.fromtimestamp(t, tz=tz).strftime("%H:%M")
