from congruence_eye_ai.analytics.zone_tracker import ZoneTracker

ZONE = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]
IN, OUT = (0.5, 0.5), (0.95, 0.95)


def feed(zt: ZoneTracker, tid: int, points, t0=0.0, dt=0.5):
    out = []
    for i, p in enumerate(points):
        out += zt.update(tid, p, t0 + i * dt)
    return out


def test_enter_and_exit_with_dwell() -> None:
    zt = ZoneTracker([(5, ZONE)], min_presence_sec=2.0, exit_grace_sec=1.0)
    # out at t=0, in from t=0.5 .. t=10.5, out afterwards
    pts = [OUT] + [IN] * 21 + [OUT] * 4
    ev = feed(zt, 1, pts)
    assert [(e.kind, e.zone_id) for e in ev] == [("ZONE_ENTER", 5), ("ZONE_EXIT", 5)]
    assert ev[0].t == 0.5  # back-dated to first frame inside
    assert ev[1].t == 10.5  # last frame inside
    assert ev[1].dwell_sec == 10.0


def test_short_visit_below_min_presence_is_ignored() -> None:
    zt = ZoneTracker([(5, ZONE)], min_presence_sec=2.0)
    assert feed(zt, 1, [IN, IN, IN, OUT, OUT, OUT, OUT]) == []


def test_brief_step_outside_within_grace_keeps_visit() -> None:
    zt = ZoneTracker([(5, ZONE)], min_presence_sec=1.0, exit_grace_sec=1.5)
    pts = [IN] * 6 + [OUT] * 2 + [IN] * 6 + [OUT] * 5
    ev = feed(zt, 1, pts)
    assert [e.kind for e in ev] == ["ZONE_ENTER", "ZONE_EXIT"]
    assert ev[1].dwell_sec == 6.5


def test_track_lost_closes_visit() -> None:
    zt = ZoneTracker([(5, ZONE)], min_presence_sec=1.0)
    feed(zt, 1, [IN] * 6)
    ev = zt.end_track(1, 10.0)
    assert [(e.kind, e.dwell_sec) for e in ev] == [("ZONE_EXIT", 2.5)]
    assert zt.end_track(1, 11.0) == []


def test_multiple_zones_and_tracks() -> None:
    z2 = [(0.0, 0.0), (0.1, 0.0), (0.1, 0.1), (0.0, 0.1)]
    zt = ZoneTracker([(1, ZONE), (2, z2)], min_presence_sec=0.5)
    ev = feed(zt, 1, [IN, IN, IN]) + feed(zt, 2, [(0.05, 0.05)] * 3)
    assert sorted((e.zone_id, e.track_id) for e in ev) == [(1, 1), (2, 2)]
    assert set(zt.inside(1)) == {1}
