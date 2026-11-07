from congruence_eye_ai.analytics.queue_monitor import QueueMonitor

Q = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]
IN = (0.5, 0.5)
OUT = (0.95, 0.95)


def make(**kw) -> QueueMonitor:
    return QueueMonitor([(9, Q)], min_presence_sec=1.0, exit_grace_sec=1.0, snapshot_sec=30, unattended_sec=60, **kw)


def test_queue_length_excludes_staff_and_needs_presence() -> None:
    qm = make()
    qm.update([(1, IN, False), (2, IN, False), (3, IN, True)], True, 0.0)
    assert qm.reading(9, 0.0).queue_length == 0  # not yet 1 s
    qm.update([(1, IN, False), (2, IN, False), (3, IN, True)], True, 1.5)
    r = qm.reading(9, 1.5)
    assert r.queue_length == 2
    assert r.counter_staffed is True


def test_wait_time_current_max_then_rolling_average() -> None:
    qm = make()
    # person 1 waits 0..20 s, person 2 waits 0..40 s
    t = 0.0
    while t <= 40.0:
        people = [(2, IN, False)] + ([(1, IN, False)] if t <= 20 else [(1, OUT, False)])
        qm.update(people, True, t)
        if t == 10.0:
            assert qm.reading(9, t).avg_wait_sec == 10.0  # longest current wait
        t += 1.0
    # p1 completed with 20 s; p2 currently waiting 40 s -> max(20, 40)
    assert qm.reading(9, 40.0).avg_wait_sec == 40.0
    # p2 leaves (served) and a newcomer arrives; rolling average dominates
    for k in range(5):
        qm.update([(2, OUT, False), (3, IN, False)], True, 41.0 + k)
    r = qm.reading(9, 45.0)
    assert r.queue_length == 1
    assert r.avg_wait_sec == 30.0  # mean(20, 40)


def test_empty_queue_reports_zero_wait() -> None:
    qm = make()
    for k in range(5):
        qm.update([(1, IN, False)], True, float(k))
    for k in range(5, 10):
        qm.update([], True, float(k))
    r = qm.reading(9, 10.0)
    assert (r.queue_length, r.avg_wait_sec) == (0, 0.0)


def test_end_track_completes_wait() -> None:
    qm = make()
    for k in range(10):
        qm.update([(1, IN, False)], True, float(k))
    qm.end_track(1, 12.0)
    assert list(qm.zones[0].completed) == [(9.0, 9.0)]


def test_snapshot_interval() -> None:
    qm = make()
    snaps = []
    for k in range(0, 91):
        qm.update([], True, float(k))
        snaps += qm.tick(float(k))[0]
    assert [s.t for s in snaps] == [0.0, 30.0, 60.0, 90.0]


def test_counter_unattended_once_per_episode() -> None:
    qm = make()
    alerts = []
    for k in range(0, 200):
        staffed = k >= 150  # cashier returns at 150 s
        qm.update([(1, IN, False)], staffed, float(k))
        alerts += qm.tick(float(k))[1]
    assert len(alerts) == 1
    assert alerts[0].t == 61.0 and alerts[0].queue_length == 1
    # cashier leaves again -> second episode
    for k in range(200, 300):
        qm.update([(1, IN, False)], False, float(k))
        alerts += qm.tick(float(k))[1]
    assert len(alerts) == 2


def test_no_unattended_alert_without_queue() -> None:
    qm = make()
    alerts = []
    for k in range(0, 200):
        qm.update([], False, float(k))
        alerts += qm.tick(float(k))[1]
    assert alerts == []
