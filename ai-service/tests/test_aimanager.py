"""AI Manager detectors: scripted tracks/frames, breach and compliance, window boundaries, cooldown."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from congruence_eye_ai.aimanager.detectors import (
    CameraAiManager,
    HuddleTracker,
    HygieneTracker,
    MobileUsageDetector,
    PersonObs,
    QueueBreachDetector,
    StockOutDetector,
    UniformComplianceDetector,
    UnattendedCustomerDetector,
    huddle_cluster,
)
from congruence_eye_ai.aimanager.rules import RuleSpec, contract_dow, hhmm_to_sec
from congruence_eye_ai.aimanager.shelf import ShelfReferenceStore, cell_densities, compare, shelf_cells
from congruence_eye_ai.aimanager.store import StoreAiManager
from congruence_eye_ai.detector import Track
from congruence_eye_ai.schemas import DEFAULT_AI_PARAMS, AiManagerRule, Zone

IST = ZoneInfo("Asia/Kolkata")


def ts(h: int, m: int = 0, s: float = 0, day: int = 5) -> float:
    """2026-10-<day> (5 = Monday) local time."""
    return datetime(2026, 10, day, h, m, int(s), int((s % 1) * 1e6), tzinfo=IST).timestamp()


def rule(type_: str, start: str = "00:00", end: str = "23:59", days: list[int] | None = None, zone_ids: list[int] | None = None, rid: int = 1, **params) -> RuleSpec:
    return RuleSpec.from_model(
        AiManagerRule(id=rid, name=type_.title(), type=type_, window_start=start, window_end=end, days_of_week=days or [], zone_ids=zone_ids or [], params=params)
    )


def person(tid: int, x: float, y: float, staff: bool = False, uniform: bool | None = None) -> PersonObs:
    return PersonObs(tid, (x - 0.04, y - 0.3, x + 0.04, y), (x, y), staff, uniform)


def phone_for(p: PersonObs, conf: float = 0.6) -> Track:
    b = p.bbox
    return Track(900, (b[2] - 0.03, b[1] + 0.1, b[2] - 0.005, b[1] + 0.14), conf, cls=67)


def run(det, frames, **kw):
    out = []
    for t, people, extra in frames:
        out += det.update(t, people, **{**kw, **extra})
    return out


# ----------------------------------------------------------------------------- rules


def test_rule_params_and_schedule() -> None:
    r = rule("MOBILE_USAGE")
    assert r.pf("minDurationSec") == 20 and r.pb("staffOnly") is True
    assert rule("QUEUE_BREACH", maxQueue=3).pf("maxQueue") == 3
    assert set(DEFAULT_AI_PARAMS) == {
        "MOBILE_USAGE", "UNATTENDED_CUSTOMER", "STORE_OPEN_CLOSE", "HYGIENE_CLEANING", "HUDDLE_MEETING", "UNIFORM_COMPLIANCE", "STOCK_OUT", "QUEUE_BREACH",
    }
    assert hhmm_to_sec("09:30") == 34200 and hhmm_to_sec("23:59", end=True) == 86400
    w = rule("HUDDLE_MEETING", "09:30", "10:00")
    assert w.window_at(ts(9, 29, 59), IST) is None
    assert w.window_at(ts(9, 30), IST) == (ts(9, 30), ts(10, 0))
    assert w.active(ts(9, 59, 59), IST) and not w.active(ts(10, 0), IST)
    # days of week: 0 = Sunday; 2026-10-05 is a Monday
    assert contract_dow(datetime(2026, 10, 5).date()) == 1
    mon = rule("HUDDLE_MEETING", "09:00", "10:00", days=[1])
    assert mon.active(ts(9, 15), IST) and not mon.active(ts(9, 15, day=6), IST)
    # overnight window 22:00-02:00 started on Monday
    night = rule("HYGIENE_CLEANING", "22:00", "02:00", days=[1])
    assert night.window_at(ts(23, 0), IST) == (ts(22, 0), ts(2, 0, day=6))
    assert night.window_at(ts(1, 0, day=6), IST) == (ts(22, 0), ts(2, 0, day=6))
    assert night.window_at(ts(1, 0), IST) is None  # Sunday night not allowed


# ----------------------------------------------------------------------------- mobile usage


def test_mobile_usage_breach_once_with_gap_tolerance() -> None:
    d = MobileUsageDetector(rule("MOBILE_USAGE"), 1, None)
    frames = []
    for k in range(60):  # 30 s at 2 fps; phone missing for 2 s in the middle
        t = ts(12) + k * 0.5
        p = person(1, 0.5, 0.7, staff=True)
        phones = [] if 20 <= k < 24 else [phone_for(p)]
        frames.append((t, [p], {"phones": phones}))
    out = run(d, frames)
    assert len(out) == 1
    f = out[0]
    assert f.status == "BREACHED" and f.t == ts(12) + 20.0 and f.rule.type == "MOBILE_USAGE"
    assert {b[1] for b in f.boxes} == {"Mobile phone usage", "Phone"} and f.confidence == 0.6


def test_mobile_usage_long_gap_restarts_and_staff_only() -> None:
    d = MobileUsageDetector(rule("MOBILE_USAGE"), 1, None)
    frames = []
    for k in range(80):
        t = ts(12) + k * 0.5
        p = person(1, 0.5, 0.7, staff=True)
        frames.append((t, [p], {"phones": [phone_for(p)] if (k < 30 or k >= 40) and k < 70 else []}))
    out = run(d, frames)
    assert out == [] or out[0].t >= ts(12) + 15 + 5  # 15 s, gap 5 s (> 3 s) -> restart; 15 s more is still < 20 s
    assert out == []
    customer = MobileUsageDetector(rule("MOBILE_USAGE"), 1, None)
    p = person(2, 0.5, 0.7, staff=False)
    assert run(customer, [(ts(12) + k, [p], {"phones": [phone_for(p)]}) for k in range(30)]) == []
    anyone = MobileUsageDetector(rule("MOBILE_USAGE", staffOnly=False), 1, None)
    assert len(run(anyone, [(ts(12) + k, [p], {"phones": [phone_for(p)]}) for k in range(30)])) == 1


def test_mobile_phone_far_from_person_or_outside_area_ignored() -> None:
    d = MobileUsageDetector(rule("MOBILE_USAGE"), 1, None)
    p = person(1, 0.2, 0.7, staff=True)
    far = Track(9, (0.8, 0.3, 0.83, 0.34), 0.7, cls=67)
    assert run(d, [(ts(12) + k, [p], {"phones": [far]}) for k in range(40)]) == []
    area = [(7, [(0.6, 0.0), (1.0, 0.0), (1.0, 1.0), (0.6, 1.0)])]
    d2 = MobileUsageDetector(rule("MOBILE_USAGE", zone_ids=[7]), 1, area)
    assert run(d2, [(ts(12) + k, [p], {"phones": [phone_for(p)]}) for k in range(40)]) == []
    q = person(2, 0.8, 0.7, staff=True)
    out = run(d2, [(ts(13) + k, [q], {"phones": [phone_for(q)]}) for k in range(40)])
    assert len(out) == 1 and out[0].zone_id == 7


# ----------------------------------------------------------------------------- unattended


def test_unattended_customer() -> None:
    queue = [[(0.6, 0.6), (0.9, 0.6), (0.9, 0.9), (0.6, 0.9)]]
    d = UnattendedCustomerDetector(rule("UNATTENDED_CUSTOMER"), 1, None, queue)
    cust = person(1, 0.2, 0.5)
    queued = person(3, 0.75, 0.75)
    far_staff = person(2, 0.6, 0.3, staff=True)  # 0.45 away
    frames = [(ts(12) + k, [cust, queued, far_staff], {}) for k in range(130)]
    out = run(d, frames)
    assert len(out) == 1 and out[0].t == ts(12) + 120 and "Unattended customer" in out[0].boxes[0][1]
    # staff nearby resets the timer
    d2 = UnattendedCustomerDetector(rule("UNATTENDED_CUSTOMER"), 1, None)
    near_staff = person(4, 0.28, 0.5, staff=True)
    frames = [(ts(12) + k, [cust] + ([near_staff] if 60 <= k < 70 else []), {}) for k in range(200)]
    out = run(d2, frames)
    assert len(out) == 1 and out[0].t == ts(12) + 70 + 120


# ----------------------------------------------------------------------------- uniform


def test_uniform_compliance() -> None:
    area = [(5, [(0.0, 0.3), (0.3, 0.3), (0.3, 0.9), (0.0, 0.9)])]
    d = UniformComplianceDetector(rule("UNIFORM_COMPLIANCE"), 3, area)
    helper = person(1, 0.15, 0.6, staff=True, uniform=False)
    cashier = person(2, 0.1, 0.6, staff=True, uniform=True)
    outside = person(3, 0.6, 0.6, uniform=False)
    frames = []
    for k in range(140):  # 70 s at 2 fps, helper steps outside the area for 1 s at 20 s
        h = person(1, 0.35, 0.6, staff=True, uniform=False) if 40 <= k < 42 else helper
        frames.append((ts(12) + k * 0.5, [h, cashier, outside], {}))
    out = run(d, frames)
    assert len(out) == 1 and out[0].zone_id == 5 and out[0].boxes[0][1] == "Uniform not detected"
    assert 60.0 <= out[0].t - ts(12) <= 62.0
    unknown = UniformComplianceDetector(rule("UNIFORM_COMPLIANCE"), 3, area)
    assert run(unknown, [(ts(12) + k, [person(1, 0.15, 0.6)], {}) for k in range(100)]) == []


# ----------------------------------------------------------------------------- queue


def test_queue_breach_duration_and_rearm() -> None:
    q = [(4, [(0.3, 0.3), (0.9, 0.3), (0.9, 0.8), (0.3, 0.8)])]
    d = QueueBreachDetector(rule("QUEUE_BREACH"), 3, q)
    lengths = [6] * 8 + [4] * 5 + [7] * 15 + [3] * 5 + [6] * 15
    frames = [(ts(12) + k, [], {"queue_lengths": {4: n}}) for k, n in enumerate(lengths)]
    out = run(d, frames)
    assert [round(f.t - ts(12)) for f in out] == [23, 43]  # >=10 s above 5 each time
    assert "Queue of 7" in out[0].details


# ----------------------------------------------------------------------------- stock-out


def shelf_frame(fill: float, lights: bool = True) -> np.ndarray:
    img = np.full((180, 320, 3), 200, np.uint8)
    rs = np.random.RandomState(0)
    x0, x1, y0, y1 = 40, 280, 10, 60
    n = 24
    keep = rs.permutation(n)[: int(round(n * fill))]
    for i in keep:
        r, c = divmod(int(i), 12)
        px = x0 + c * 20
        py = y0 + r * 25
        img[py + 3 : py + 22, px + 3 : px + 17] = rs.randint(20, 120, 3)
    img[y0 + 24 : y0 + 26, x0:x1] = 60  # shelf board (horizontal edge only)
    return img if lights else (img // 10)


def test_shelf_density_metric() -> None:
    poly = [(40 / 320, 10 / 180), (280 / 320, 10 / 180), (280 / 320, 60 / 180), (40 / 320, 60 / 180)]
    cells = shelf_cells(poly, 8, 2)
    assert len(cells) == 16
    ref = cell_densities(shelf_frame(1.0), cells)
    assert compare(cell_densities(shelf_frame(1.0), cells), ref).empty_pct == 0
    empty = compare(cell_densities(shelf_frame(0.0), cells), ref)
    assert empty.empty_pct == 100.0 and empty.comparable == 16
    half = compare(cell_densities(shelf_frame(0.5), cells), ref).empty_pct
    assert 20 <= half <= 80
    occ = np.zeros(16, bool)
    occ[:8] = True
    assert compare(cell_densities(shelf_frame(0.0), cells), ref, occ).visible_fraction == 0.5


def test_stock_out_detector_reference_capture_and_breach(tmp_path) -> None:
    zone = Zone(id=9, camera_id=2, name="Wall shelf", type="SHELF", polygon=[(40 / 320, 10 / 180), (280 / 320, 10 / 180), (280 / 320, 60 / 180), (40 / 320, 60 / 180)])
    refs = ShelfReferenceStore(tmp_path)
    d = StockOutDetector(rule("STOCK_OUT"), 2, [zone], refs, check_sec=30)
    fills = [1.0, 1.0, 0.6, 0.15, 0.1, 0.1, 0.1]
    out = []
    for k, f in enumerate(fills):
        out += d.update(ts(12) + k * 30, [], frame=shelf_frame(f))
    assert out[0].status is None and out[0].snapshot_kind == "REFERENCE"  # reference captured first
    breaches = [f for f in out if f.status == "BREACHED"]
    assert len(breaches) == 1 and breaches[0].t == ts(12) + 4 * 30  # two consecutive checks >= 70 %
    assert breaches[0].zone_id == 9 and breaches[0].fills
    # the reference persists across restarts
    assert ShelfReferenceStore(tmp_path).get(9, d.shelves[0][2]) is not None
    # lights off: no evaluation; occluding people: no false alarm
    d2 = StockOutDetector(rule("STOCK_OUT"), 2, [zone], refs, check_sec=30)
    assert d2.update(ts(13), [], frame=shelf_frame(0.0, lights=False)) == []
    blocker = PersonObs(1, (0.0, 0.0, 1.0, 1.0), (0.5, 1.0), False)
    assert [f for f in (d2.update(ts(13) + 60 * k, [blocker], frame=shelf_frame(0.0)) for k in range(1, 4)) if f] == []


# ----------------------------------------------------------------------------- window rules


def test_hygiene_window_coverage() -> None:
    r = rule("HYGIENE_CLEANING", "10:00", "10:30")
    store = StoreAiManager([r], IST)
    area = [(2, [(0.0, 0.52), (1.0, 0.52), (1.0, 1.0), (0.0, 1.0)])]  # bottom rows: 16 x 4 cells
    d = HygieneTracker(r, 2, area, store)
    assert len(d.cells) == 64
    # staff sweeps two of four rows (50 %) inside the window; a customer and pre-window steps don't count
    run(d, [(ts(9, 50), [person(1, 0.5, 0.6, staff=True)], {})])
    frames = []
    for row_y in (0.56, 0.67):
        for k in range(17):
            frames.append((ts(10, 5) + len(frames), [person(1, (k + 0.5) / 16.5, row_y, staff=True), person(2, 0.5, 0.95)], {}))
    run(d, frames)
    assert store.tick(ts(10, 29)) == []  # not before the window end
    out = store.tick(ts(10, 30, 1))
    assert len(out) == 1 and out[0].status == "BREACHED" and "50%" in out[0].details and out[0].t == ts(10, 30)
    assert store.tick(ts(10, 31)) == []  # one result per window
    # full coverage next day -> COMPLIED
    for row_y in (0.56, 0.67, 0.78, 0.9):
        run(d, [(ts(10, 10, k, day=6), [person(1, (k + 0.5) / 16, row_y, staff=True)], {}) for k in range(16)])
    out = store.tick(ts(10, 30, 5, day=6))
    assert [f.status for f in out] == ["COMPLIED"]


def test_huddle_complied_and_breached() -> None:
    r = rule("HUDDLE_MEETING", "09:30", "10:00")
    store = StoreAiManager([r], IST)
    d = HuddleTracker(r, 1, None, store)
    staff3 = [person(1, 0.45, 0.6, True), person(2, 0.55, 0.6, True), person(3, 0.5, 0.65, True)]
    run(d, [(ts(9, 40) + k * 2, staff3, {}) for k in range(160)])  # 320 s together
    out = store.tick(ts(9, 50))
    assert len(out) == 1 and out[0].status == "COMPLIED" and out[0].t == ts(9, 40) + 300
    assert store.tick(ts(10, 1)) == []  # achieved -> no BREACHED at window end
    # next day: only 2 staff -> BREACHED at the end of the window
    run(d, [(ts(9, 40, day=6) + k * 2, staff3[:2], {}) for k in range(160)])
    out = store.tick(ts(10, 0, 1, day=6))
    assert [f.status for f in out] == ["BREACHED"] and "No huddle of 3+" in out[0].details
    assert huddle_cluster(staff3, 3, 0.2) and not huddle_cluster(staff3, 3, 0.03)


def test_window_boundary_for_instant_rules_and_cooldown() -> None:
    zones = [Zone(id=4, camera_id=3, name="Q", type="QUEUE", polygon=[(0.3, 0.3), (0.9, 0.3), (0.9, 0.8), (0.3, 0.8)])]
    mgr = CameraAiManager(3, zones, [rule("MOBILE_USAGE", "12:00", "13:00")], IST, StoreAiManager([], IST), ShelfReferenceStore(None), cooldown_sec=600)
    p = person(1, 0.5, 0.7, staff=True)
    out = []
    for k in range(120):  # 11:59:00 .. 11:59:59.5 (before the window), phone the whole time
        out += mgr.update(ts(11, 59) + k * 0.5, [p], [phone_for(p)])
    assert out == []
    for k in range(240):  # 12:01:00 .. 12:02:59.5
        out += mgr.update(ts(12, 1) + k * 0.5, [p], [phone_for(p)])
    assert len(out) == 1 and out[0].t == ts(12, 1, 20)
    # second incident (another person) within the cooldown is suppressed; after the cooldown it's reported
    q = person(2, 0.6, 0.7, staff=True)
    late = [f for k in range(60) for f in mgr.update(ts(12, 5) + k, [q], [phone_for(q)])]
    assert late == []
    r = person(3, 0.6, 0.7, staff=True)
    after = [f for k in range(60) for f in mgr.update(ts(12, 20) + k, [r], [phone_for(r)])]
    assert len(after) == 1


def test_window_boundary_mobile_exact() -> None:
    mgr = CameraAiManager(3, [], [rule("MOBILE_USAGE", "12:00", "13:00")], IST, StoreAiManager([], IST), ShelfReferenceStore(None))
    p = person(1, 0.5, 0.7, staff=True)
    out = [f for k in range(50) for f in mgr.update(ts(11, 59, 50) + k, [p], [phone_for(p)])]
    assert len(out) == 1 and out[0].t == ts(12, 0, 20)  # timing starts when the window opens
    after = CameraAiManager(3, [], [rule("MOBILE_USAGE", "12:00", "13:00")], IST, StoreAiManager([], IST), ShelfReferenceStore(None))
    assert [f for k in range(40) for f in after.update(ts(12, 59, 50) + k, [p], [phone_for(p)])] == []


def test_camera_manager_applicability() -> None:
    zones = [
        Zone(id=1, camera_id=2, name="Sec", type="SECTION", polygon=[(0, 0), (1, 0), (1, 1), (0, 1)]),
        Zone(id=2, camera_id=3, name="Staff", type="STAFF_ONLY", polygon=[(0, 0), (0.2, 0), (0.2, 1), (0, 1)]),
    ]
    rules = [
        rule("MOBILE_USAGE", zone_ids=[1], rid=1),  # areas on camera 2 only
        rule("UNIFORM_COMPLIANCE", rid=2),  # needs a STAFF_ONLY zone
        rule("STOCK_OUT", rid=3),  # needs a SHELF zone
        rule("QUEUE_BREACH", rid=4),  # needs a QUEUE zone
        rule("STORE_OPEN_CLOSE", rid=5),  # store-level
    ]
    m2 = CameraAiManager(2, [z for z in zones if z.camera_id == 2], rules, IST, StoreAiManager(rules, IST), ShelfReferenceStore(None))
    m3 = CameraAiManager(3, [z for z in zones if z.camera_id == 3], rules, IST, StoreAiManager(rules, IST), ShelfReferenceStore(None))
    assert [type(d).__name__ for d in m2.detectors] == ["MobileUsageDetector"] and m2.wants_phones
    assert [type(d).__name__ for d in m3.detectors] == ["UniformComplianceDetector"] and not m3.wants_phones


@pytest.mark.parametrize(
    "event,hhmm,expected",
    [("STORE_OPENED", (10, 5), "COMPLIED"), ("STORE_OPENED", (10, 25), "BREACHED"), ("STORE_OPENED", (9, 40), "BREACHED"), ("STORE_CLOSED", (22, 8), "COMPLIED")],
)
def test_open_close_findings(event, hhmm, expected) -> None:
    store = StoreAiManager([rule("STORE_OPEN_CLOSE", toleranceMin=10)], IST)
    out = store.open_close_findings(event, ts(*hhmm), 1, "10:00" if event == "STORE_OPENED" else "22:00")
    assert [f.status for f in out] == [expected]
    assert out[0].snapshot_kind == ("OPENING" if event == "STORE_OPENED" else "CLOSING")
    sunday_only = StoreAiManager([rule("STORE_OPEN_CLOSE", days=[0])], IST)
    assert sunday_only.open_close_findings(event, ts(*hhmm), 1, "10:00") == []
