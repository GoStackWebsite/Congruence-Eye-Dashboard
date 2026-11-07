"""AI Manager rules: parsing and schedule (time window + days of week) evaluation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time as dtime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from ..schemas import DEFAULT_AI_PARAMS, AiManagerRule

DAY = 86400.0


def hhmm_to_sec(s: str, end: bool = False) -> float:
    """``"HH:mm"`` -> seconds of day. ``"23:59"`` as a window *end* means end of day (86400)."""
    h, m = (int(x) for x in s.split(":")[:2])
    v = h * 3600.0 + m * 60.0
    if end and h == 23 and m == 59:
        return DAY
    return v


def contract_dow(d: date) -> int:
    """0 = Sunday ... 6 = Saturday (contract convention)."""
    return (d.weekday() + 1) % 7


@dataclass
class RuleSpec:
    """An AI Manager rule as evaluated on the edge."""

    key: str
    rule_id: int | None
    name: str
    type: str
    zone_ids: list[int] = field(default_factory=list)
    start_sec: float = 0.0
    end_sec: float = DAY
    days: set[int] = field(default_factory=set)
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_model(cls, r: AiManagerRule) -> RuleSpec:
        return cls(
            key=f"r{r.id}" if r.id is not None else f"default-{r.type}",
            rule_id=r.id,
            name=r.name or r.type,
            type=r.type,
            zone_ids=list(r.zone_ids),
            start_sec=hhmm_to_sec(r.window_start or "00:00"),
            end_sec=hhmm_to_sec(r.window_end or "23:59", end=True),
            days=set(r.days_of_week or []),
            params={**DEFAULT_AI_PARAMS.get(r.type, {}), **(r.params or {})},
        )

    def p(self, key: str, default: Any = None) -> Any:
        v = self.params.get(key)
        if v is None:
            v = DEFAULT_AI_PARAMS.get(self.type, {}).get(key, default)
        return default if v is None else v

    def pf(self, key: str, default: float = 0.0) -> float:
        try:
            return float(self.p(key, default))
        except (TypeError, ValueError):
            return default

    def pb(self, key: str, default: bool = False) -> bool:
        v = self.p(key, default)
        if isinstance(v, str):
            return v.strip().lower() in ("1", "true", "yes", "on")
        return bool(v)

    # ------------------------------------------------------------------ schedule
    def _day_ok(self, d: date) -> bool:
        return not self.days or contract_dow(d) in self.days

    def window_at(self, t: float, tz: ZoneInfo) -> tuple[float, float] | None:
        """(start_ts, end_ts) of the window instance containing ``t``, or None when inactive."""
        local = datetime.fromtimestamp(t, tz=tz)
        d = local.date()
        sod = local.hour * 3600 + local.minute * 60 + local.second + local.microsecond / 1e6
        start, end = self.start_sec, self.end_sec
        if end <= start and not (start == 0 and end == 0):
            # overnight window (e.g. 22:00-02:00)
            if sod >= start and self._day_ok(d):
                return _ts(d, start, tz), _ts(d, end + DAY, tz)
            prev = d - timedelta(days=1)
            if sod < end and self._day_ok(prev):
                return _ts(prev, start, tz), _ts(prev, end + DAY, tz)
            return None
        if start == end:  # degenerate -> whole day
            start, end = 0.0, DAY
        if start <= sod < end and self._day_ok(d):
            return _ts(d, start, tz), _ts(d, end, tz)
        return None

    def active(self, t: float, tz: ZoneInfo) -> bool:
        sec = int(t)
        cached = self.__dict__.get("_active_cache")
        if cached is None or cached[0] != sec:
            cached = (sec, self.window_at(t, tz) is not None)
            self.__dict__["_active_cache"] = cached  # atomic tuple swap: safe across camera threads
        return cached[1]


def _ts(d: date, sec: float, tz: ZoneInfo) -> float:
    return (datetime.combine(d, dtime.min, tzinfo=tz) + timedelta(seconds=sec)).timestamp()


def specs_from_config(rules: list[AiManagerRule]) -> list[RuleSpec]:
    return [RuleSpec.from_model(r) for r in rules if r.is_active]
