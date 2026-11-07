import pytest

from congruence_eye_ai.geometry import (
    crossing_direction,
    foot_point,
    in_side_sign,
    line_param,
    normalize_bbox,
    point_in_polygon,
    polygon_area,
    segments_intersect,
    signed_distance,
)

SQUARE = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]


def test_normalize_and_foot() -> None:
    b = normalize_bbox([64, 36, 128, 144], 640, 360)
    assert b == pytest.approx((0.1, 0.1, 0.2, 0.4))
    assert foot_point(b) == pytest.approx((0.15, 0.4))
    # clamped
    assert normalize_bbox([-10, -10, 700, 400], 640, 360) == (0.0, 0.0, 1.0, 1.0)


@pytest.mark.parametrize(
    "p,inside",
    [((0.5, 0.5), True), ((0.1, 0.5), False), ((0.9, 0.9), False), ((0.2, 0.5), True), ((0.8, 0.8), True)],
)
def test_point_in_polygon(p, inside) -> None:
    assert point_in_polygon(p, SQUARE) is inside


def test_point_in_concave_polygon() -> None:
    # "U" shape: the notch is outside
    u = [(0.1, 0.1), (0.3, 0.1), (0.3, 0.6), (0.7, 0.6), (0.7, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]
    assert point_in_polygon((0.5, 0.3), u) is False
    assert point_in_polygon((0.5, 0.8), u) is True
    assert point_in_polygon((0.2, 0.2), u) is True


def test_degenerate_polygon() -> None:
    assert point_in_polygon((0.5, 0.5), [(0, 0), (1, 1)]) is False


def test_segments_intersect() -> None:
    assert segments_intersect((0, 0), (1, 1), (0, 1), (1, 0))
    assert not segments_intersect((0, 0), (0.4, 0.4), (0, 1), (1, 0.9))
    assert segments_intersect((0, 0), (0.5, 0.5), (0.5, 0.5), (1, 0))  # touching
    assert not segments_intersect((0, 0), (1, 0), (0, 1), (1, 1))  # parallel


def test_line_param_and_signed_distance() -> None:
    a, b = (0.0, 0.5), (1.0, 0.5)
    assert line_param(a, b, (0.25, 0.9), (0.25, 0.1)) == pytest.approx(0.25)
    assert line_param(a, b, (0.0, 0.1), (1.0, 0.1)) is None
    assert signed_distance(a, b, (0.5, 0.6)) == pytest.approx(0.1)
    assert signed_distance(a, b, (0.5, 0.4)) == pytest.approx(-0.1)


@pytest.mark.parametrize(
    "direction,expected_side_point",
    [("UP", (0.5, 0.1)), ("DOWN", (0.5, 0.9)), ("LEFT", (0.1, 0.5)), ("RIGHT", (0.9, 0.5))],
)
def test_in_side_sign(direction, expected_side_point) -> None:
    # use a horizontal line for UP/DOWN and a vertical line for LEFT/RIGHT
    a, b = ((0.0, 0.5), (1.0, 0.5)) if direction in ("UP", "DOWN") else ((0.5, 0.0), (0.5, 1.0))
    sign = in_side_sign(a, b, direction)
    d = signed_distance(a, b, expected_side_point)
    assert (d > 0) == (sign > 0)


def test_in_side_sign_independent_of_point_order() -> None:
    a, b = (0.0, 0.5), (1.0, 0.5)
    p_inside = (0.5, 0.2)  # entering UP ends above the line
    for (p1, p2) in ((a, b), (b, a)):
        assert (signed_distance(p1, p2, p_inside) > 0) == (in_side_sign(p1, p2, "UP") > 0)


def test_crossing_direction_and_area() -> None:
    assert crossing_direction((0.5, 0.8), (0.5, 0.2)) == "UP"
    assert crossing_direction((0.2, 0.5), (0.8, 0.55)) == "RIGHT"
    assert polygon_area(SQUARE) == pytest.approx(0.36)
