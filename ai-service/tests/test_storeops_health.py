from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

from congruence_eye_ai.analytics.camera_health import CameraHealth
from congruence_eye_ai.analytics.storeops import StoreOpsConfig, StoreOpsMonitor, frame_stats

IST = ZoneInfo("Asia/Kolkata")


def ts(h: int, m: int = 0, s: int = 0) -> float:
    return datetime(2026, 10, 5, h, m, s, tzinfo=IST).timestamp()


RS = np.random.RandomState(0)
LIT = np.clip(RS.randint(80, 200, (180, 320, 3)), 0, 255).astype(np.uint8)  # textured, bright
DARK = (LIT // 12).astype(np.uint8)  # lights off
COVERED = np.full((180, 320, 3), 130, np.uint8)  # lens covered / sprayed
BLURRED = np.full((180, 320, 3), 0, np.uint8)
BLURRED[:] = np.linspace(60, 200, 320, dtype=np.uint8)[None, :, None]  # smooth gradient = defocused


def monitor(**kw) -> StoreOpsMonitor:
    cfg = StoreOpsConfig(open_time="10:00", close_time="22:00", lights_persist_sec=60, tamper_persist_sec=5, staff_absent_sec=900, closed_idle_sec=1800, **kw)
    return StoreOpsMonitor(cfg)


def types(evts) -> list[str]:
    return [e.type for e in evts]


def test_frame_stats() -> None:
    lit, dark, cov, blur = frame_stats(LIT), frame_stats(DARK), frame_stats(COVERED), frame_stats(BLURRED)
    assert lit.brightness > 100 and dark.brightness < 20
    assert cov.std < 1 and lit.std > 20
    assert blur.sharpness < lit.sharpness * 0.05
    assert frame_stats(LIT[:, :, 0]).brightness > 0  # grey input


def test_business_hours() -> None:
    m = monitor()
    assert m.in_business_hours(ts(10, 0)) and m.in_business_hours(ts(21, 59))
    assert not m.in_business_hours(ts(9, 59)) and not m.in_business_hours(ts(22, 0))
    late = StoreOpsMonitor(StoreOpsConfig(open_time="18:00", close_time="02:00"))
    assert late.in_business_hours(ts(23, 0)) and late.in_business_hours(ts(1, 0)) and not late.in_business_hours(ts(3, 0))


def test_store_opened_once_per_day_then_closed() -> None:
    m = monitor()
    t = ts(9, 40)
    m.on_frame_stats(1, frame_stats(LIT), t)
    m.on_people(1, 0, 0, t)
    assert m.tick(t) == []
    m.on_people(1, 1, 1, ts(9, 45))
    ev = m.tick(ts(9, 45))
    assert types(ev) == ["STORE_OPENED"] and ev[0].t == ts(9, 45)
    m.on_people(1, 2, 1, ts(12, 0))
    assert m.tick(ts(12, 0)) == []  # once per day
    # evening: last activity at 21:50, lights off at 21:55
    m.on_people(1, 1, 1, ts(21, 50))
    for k in range(0, 120, 5):
        t = ts(21, 55) + k
        m.on_frame_stats(1, frame_stats(DARK), t)
        m.on_people(1, 0, 0, t)
        out = m.tick(t)
        if out:
            break
    assert types(out) == ["STORE_CLOSED"]
    assert out[0].t == ts(21, 50)
    # a new day re-arms opening
    m.on_frame_stats(1, frame_stats(LIT), ts(9, 50) + 86400)
    m.on_people(1, 1, 1, ts(9, 50) + 86400)
    assert "STORE_OPENED" in types(m.tick(ts(9, 50) + 86400))


def test_too_early_activity_does_not_open() -> None:
    m = monitor()
    m.on_frame_stats(1, frame_stats(LIT), ts(4, 0))
    m.on_people(1, 1, 1, ts(4, 0))
    assert m.tick(ts(4, 0)) == []


def test_lights_off_during_business_hours() -> None:
    m = monitor()
    out = []
    base = ts(15, 0)
    for k in range(0, 200, 2):
        t = base + k
        m.on_frame_stats(1, frame_stats(LIT if k < 20 else DARK), t)
        m.on_frame_stats(2, frame_stats(LIT if k < 20 else DARK), t)
        m.on_people(1, 1, 1, t)
        out += m.tick(t)
    assert types(out).count("LIGHTS_OFF") == 1
    lo = next(e for e in out if e.type == "LIGHTS_OFF")
    assert lo.t >= base + 20 + 60  # persisted for the configured time
    assert "CAMERA_TAMPER" not in types(out)  # whole store dark is not tampering


def test_camera_tamper_covered_single_camera() -> None:
    m = monitor()
    out = []
    base = ts(15, 0)
    for k in range(0, 60):
        t = base + k
        m.on_frame_stats(1, frame_stats(LIT), t)
        m.on_frame_stats(2, frame_stats(LIT if k < 30 else COVERED), t)
        out += m.tick(t)
    tam = [e for e in out if e.type == "CAMERA_TAMPER"]
    assert len(tam) == 1 and tam[0].camera_id == 2 and tam[0].t == base + 35


def test_camera_tamper_blur_against_baseline() -> None:
    m = monitor()
    out = []
    base = ts(15, 0)
    for k in range(0, 80):
        t = base + k
        m.on_frame_stats(1, frame_stats(LIT if k < 40 else BLURRED), t)
        out += m.tick(t)
    tam = [e for e in out if e.type == "CAMERA_TAMPER"]
    assert len(tam) == 1 and "blur" in (tam[0].details or "")


def test_single_camera_blacked_out_while_store_lit() -> None:
    m = monitor()
    out = []
    base = ts(15, 0)
    for k in range(0, 30):
        t = base + k
        m.on_frame_stats(1, frame_stats(LIT), t)
        m.on_frame_stats(2, frame_stats(LIT), t)
        m.on_frame_stats(3, frame_stats(DARK if k >= 10 else LIT), t)
        out += m.tick(t)
    assert [(e.type, e.camera_id) for e in out if e.type == "CAMERA_TAMPER"] == [("CAMERA_TAMPER", 3)]


def test_staff_absent() -> None:
    m = monitor()
    out = []
    base = ts(11, 0)
    m.on_people(1, 1, 1, base)
    for k in range(0, 1200, 10):
        t = base + k
        m.on_people(1, 2, 0, t)  # customers only
        out += m.tick(t)
    assert types(out).count("STAFF_ABSENT") == 1
    sa = next(e for e in out if e.type == "STAFF_ABSENT")
    assert sa.t == base + 900
    # staff comes back -> re-armed
    m.on_people(1, 1, 1, base + 1300)
    assert m.tick(base + 1300) == []


def test_sop_breach_dedup() -> None:
    m = monitor()
    assert m.report_sop_breach(1, "k", "intruder", ts(12))
    assert not m.report_sop_breach(1, "k", "intruder", ts(12) + 60)
    assert m.report_sop_breach(1, "k", "intruder", ts(12) + 400)
    assert types(m.tick(ts(12) + 401)) == ["SOP_BREACH", "SOP_BREACH"]


# ----------------------------------------------------------------------------- camera health


def test_camera_health() -> None:
    h = CameraHealth(1, offline_after_sec=10, max_backoff_sec=60)
    assert h.status(0.0) == ("OFFLINE", "starting")
    for i in range(11):
        h.on_frame(100.0 + i * 0.2)
    assert h.status(102.0) == ("ONLINE", None)
    assert h.fps(102.0) == 5.0
    st, reason = h.status(120.0)
    assert st == "OFFLINE" and "no frames" in (reason or "")
    h.on_failure("stream open failed")
    assert h.status(120.0) == ("OFFLINE", "stream open failed")
    delays = []
    for _ in range(8):
        delays.append(h.next_backoff())
        h.on_failure("x")
    assert delays == [1, 2, 4, 8, 16, 32, 60, 60]
    h.on_frame(130.0)
    assert h.next_backoff() == 1
