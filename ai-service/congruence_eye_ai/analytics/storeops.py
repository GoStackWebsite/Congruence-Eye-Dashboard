"""Store operations: open/close detection, lights, camera tamper, staff presence, SOP breaches.

Pure numpy (no cv2) so it is fully unit-testable on synthetic frames.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, time as dtime, timedelta
from zoneinfo import ZoneInfo

import numpy as np


@dataclass(slots=True)
class FrameStats:
    brightness: float  # mean grey level 0..255
    std: float  # grey std-dev (uniformity)
    sharpness: float  # variance of Laplacian (blur)


def frame_stats(frame: np.ndarray, max_side: int = 320) -> FrameStats:
    """Brightness / uniformity / sharpness of a BGR or grey frame (downsampled for speed).

    Uses OpenCV when available (fast path) and plain numpy otherwise.
    """
    img = frame
    step = max(1, int(max(img.shape[:2]) / max_side))
    img = img[::step, ::step]
    try:
        import cv2

        grey = img if img.ndim == 2 else cv2.cvtColor(np.ascontiguousarray(img), cv2.COLOR_BGR2GRAY)
        mean, std = cv2.meanStdDev(grey)
        lap = cv2.Laplacian(grey, cv2.CV_32F, ksize=1)
        _, lstd = cv2.meanStdDev(lap)
        return FrameStats(float(mean[0, 0]), float(std[0, 0]), float(lstd[0, 0]) ** 2)
    except ImportError:  # pragma: no cover
        pass
    grey = img.astype(np.float32) if img.ndim == 2 else img.astype(np.float32) @ np.array([0.114, 0.587, 0.299], np.float32)
    lap = (
        -4 * grey[1:-1, 1:-1] + grey[:-2, 1:-1] + grey[2:, 1:-1] + grey[1:-1, :-2] + grey[1:-1, 2:]
        if grey.shape[0] > 2 and grey.shape[1] > 2
        else np.zeros((1, 1), np.float32)
    )
    return FrameStats(float(grey.mean()), float(grey.std()), float(lap.var()))


@dataclass(slots=True)
class OpsEvent:
    type: str
    t: float
    camera_id: int | None = None
    details: str | None = None


def _parse_hhmm(s: str) -> dtime:
    h, m = s.split(":")[:2]
    return dtime(int(h), int(m))


@dataclass
class _CamState:
    stats: FrameStats | None = None
    stats_t: float = 0.0
    baseline_sharp: float | None = None
    baseline_n: int = 0
    tamper_since: float | None = None
    tamper_alerted: bool = False
    normal_since: float | None = None


@dataclass
class _DayState:
    date: str = ""
    opened_at: float | None = None
    closed: bool = False


@dataclass
class StoreOpsConfig:
    timezone: str = "Asia/Kolkata"
    open_time: str = "10:00"
    close_time: str = "22:00"
    lights_off_brightness: float = 40.0
    lights_persist_sec: float = 60.0
    tamper_std: float = 8.0
    tamper_blur_ratio: float = 0.15
    tamper_persist_sec: float = 5.0
    staff_absent_sec: float = 900.0
    closed_idle_sec: float = 1800.0
    open_lead_sec: float = 3 * 3600.0  # earliest STORE_OPENED before scheduled open
    close_lead_sec: float = 4 * 3600.0  # earliest STORE_CLOSED before scheduled close
    sop_cooldown_sec: float = 300.0
    baseline_min_samples: int = 20


class StoreOpsMonitor:
    """Store-wide operations monitor shared by all camera workers (thread-safe)."""

    def __init__(self, cfg: StoreOpsConfig | None = None) -> None:
        self.cfg = cfg or StoreOpsConfig()
        self.tz = ZoneInfo(self.cfg.timezone)
        self.open_t = _parse_hhmm(self.cfg.open_time)
        self.close_t = _parse_hhmm(self.cfg.close_time)
        self._cams: dict[int, _CamState] = {}
        self._day = _DayState()
        self._lights_on: bool | None = None
        self._lights_change_since: float | None = None
        self._lights_off_alerted = False
        self._last_activity: float | None = None
        self._last_staff: float | None = None
        self._staff_absent_alerted = False
        self._sop_last: dict[tuple[int | None, str], float] = {}
        self._pending: list[OpsEvent] = []
        self._last_tick: float | None = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ time helpers
    def local(self, t: float) -> datetime:
        return datetime.fromtimestamp(t, tz=self.tz)

    def _sched(self, t: float) -> tuple[datetime, datetime]:
        d = self.local(t)
        o = d.replace(hour=self.open_t.hour, minute=self.open_t.minute, second=0, microsecond=0)
        c = d.replace(hour=self.close_t.hour, minute=self.close_t.minute, second=0, microsecond=0)
        if c <= o:
            c += timedelta(days=1)
        return o, c

    def in_business_hours(self, t: float) -> bool:
        o, c = self._sched(t)
        d = self.local(t)
        return o <= d < c or (o - timedelta(days=1) <= d < c - timedelta(days=1))

    def _roll_day(self, t: float) -> None:
        date = self.local(t).strftime("%Y-%m-%d")
        if date != self._day.date:
            self._day = _DayState(date=date)

    # ------------------------------------------------------------------ inputs
    def on_frame_stats(self, camera_id: int, s: FrameStats, t: float) -> None:
        with self._lock:
            cs = self._cams.setdefault(camera_id, _CamState())
            cs.stats, cs.stats_t = s, t
            others_bright = self._others_bright(camera_id, t)
            dark = s.brightness < self.cfg.lights_off_brightness
            uniform = s.std < self.cfg.tamper_std and (not dark or others_bright)
            blurred = (
                cs.baseline_sharp is not None
                and cs.baseline_n >= self.cfg.baseline_min_samples
                and s.std >= self.cfg.tamper_std
                and s.sharpness < cs.baseline_sharp * self.cfg.tamper_blur_ratio
            )
            dark_alone = dark and others_bright
            if uniform or blurred or dark_alone:
                cs.normal_since = None
                if cs.tamper_since is None:
                    cs.tamper_since = t
                if not cs.tamper_alerted and t - cs.tamper_since >= self.cfg.tamper_persist_sec:
                    cs.tamper_alerted = True
                    why = "covered/uniform view" if uniform else "blurred/defocused" if blurred else "blacked out"
                    self._pending.append(OpsEvent("CAMERA_TAMPER", t, camera_id, f"Camera view {why}"))
            else:
                cs.tamper_since = None
                if cs.normal_since is None:
                    cs.normal_since = t
                if cs.tamper_alerted and t - cs.normal_since >= 30.0:
                    cs.tamper_alerted = False
                if not dark:  # learn sharpness baseline from healthy, lit frames
                    a = 0.05 if cs.baseline_n >= self.cfg.baseline_min_samples else 1.0 / (cs.baseline_n + 1)
                    cs.baseline_sharp = s.sharpness if cs.baseline_sharp is None else (1 - a) * cs.baseline_sharp + a * s.sharpness
                    cs.baseline_n += 1

    def on_people(self, camera_id: int, n_people: int, n_staff: int, t: float) -> None:
        with self._lock:
            self._roll_day(t)
            if n_people > 0:
                self._last_activity = t
                if self._day.opened_at is None and self._lights_now(t) is not False:
                    o, _ = self._sched(t)
                    if self.local(t) >= o - timedelta(seconds=self.cfg.open_lead_sec):
                        self._day.opened_at = t
                        self._pending.append(OpsEvent("STORE_OPENED", t, camera_id, "Lights on and first activity"))
            if n_staff > 0:
                self._last_staff = t
                self._staff_absent_alerted = False

    def report_sop_breach(self, camera_id: int | None, key: str, details: str, t: float) -> bool:
        """SOP breach hook (deduplicated per camera+key within ``sop_cooldown_sec``)."""
        with self._lock:
            last = self._sop_last.get((camera_id, key))
            if last is not None and t - last < self.cfg.sop_cooldown_sec:
                return False
            self._sop_last[(camera_id, key)] = t
            self._pending.append(OpsEvent("SOP_BREACH", t, camera_id, details))
            return True

    # ------------------------------------------------------------------ periodic
    def tick(self, t: float) -> list[OpsEvent]:
        with self._lock:
            if self._last_tick is not None and t - self._last_tick > 300:
                # monitoring gap (restart / simulator segment jump): don't infer absences across it
                if self._last_staff is not None:
                    self._last_staff = t
                if self._last_activity is not None and self._last_activity <= self._last_tick:
                    self._last_activity = t  # nothing observed during the gap: don't call it idle
            self._last_tick = t
            self._roll_day(t)
            business = self.in_business_hours(t)
            lights = self._lights_now(t)
            if lights is not None and lights != self._lights_on:
                if self._lights_change_since is None:
                    self._lights_change_since = t
                if t - self._lights_change_since >= self.cfg.lights_persist_sec or self._lights_on is None:
                    self._lights_on = lights
                    self._lights_change_since = None
                    if lights:
                        self._lights_off_alerted = False
            else:
                self._lights_change_since = None

            # store closed: lights confirmed off, or idle for long, late enough in the day
            day = self._day
            if day.opened_at is not None and not day.closed:
                _, c = self._sched(day.opened_at)
                late_enough = self.local(t) >= c - timedelta(seconds=self.cfg.close_lead_sec)
                idle = self._last_activity is not None and t - self._last_activity >= self.cfg.closed_idle_sec
                if late_enough and (self._lights_on is False or idle):
                    day.closed = True
                    ts = self._last_activity if self._last_activity is not None else t
                    why = "lights off" if self._lights_on is False else "no activity"
                    self._pending.append(OpsEvent("STORE_CLOSED", max(ts, day.opened_at), None, f"Closed ({why})"))

            # lights off while the store should be trading (not after it closed for the day)
            if self._lights_on is False and business and not day.closed and not self._lights_off_alerted:
                self._lights_off_alerted = True
                self._pending.append(OpsEvent("LIGHTS_OFF", t, None, "Store lights off during business hours"))

            # staff absent
            if business:
                if self._last_staff is None:
                    self._last_staff = t  # grace period starts when monitoring starts
                if not self._staff_absent_alerted and t - self._last_staff >= self.cfg.staff_absent_sec:
                    self._staff_absent_alerted = True
                    mins = int((t - self._last_staff) // 60)
                    self._pending.append(OpsEvent("STAFF_ABSENT", t, None, f"No staff seen for {mins} min"))

            out, self._pending = self._pending, []
            return out

    # ------------------------------------------------------------------ helpers
    def _fresh_stats(self, t: float, exclude: int | None = None) -> list[FrameStats]:
        return [
            cs.stats
            for cid, cs in self._cams.items()
            if cs.stats is not None and cid != exclude and t - cs.stats_t <= 60 and not cs.tamper_alerted
        ]

    def _others_bright(self, camera_id: int, t: float) -> bool:
        others = self._fresh_stats(t, exclude=camera_id)
        return bool(others) and float(np.median([s.brightness for s in others])) >= self.cfg.lights_off_brightness

    def _lights_now(self, t: float) -> bool | None:
        stats = self._fresh_stats(t)
        if not stats:
            return None
        return float(np.median([s.brightness for s in stats])) >= self.cfg.lights_off_brightness

    @property
    def lights_on(self) -> bool | None:
        return self._lights_on

    @property
    def opened_at(self) -> float | None:
        return self._day.opened_at
