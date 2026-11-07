"""Planar geometry helpers in normalised image coordinates (x right, y down, both 0..1)."""

from __future__ import annotations

import math
from collections.abc import Sequence

Point = tuple[float, float]
BBox = tuple[float, float, float, float]  # x1, y1, x2, y2

DIRECTION_VECTORS: dict[str, Point] = {
    "UP": (0.0, -1.0),
    "DOWN": (0.0, 1.0),
    "LEFT": (-1.0, 0.0),
    "RIGHT": (1.0, 0.0),
}


def clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def normalize_point(x: float, y: float, width: int, height: int) -> Point:
    """Pixel -> normalised coordinates (clamped to 0..1)."""
    return clamp01(float(x) / max(width, 1)), clamp01(float(y) / max(height, 1))


def normalize_bbox(b: Sequence[float], width: int, height: int) -> BBox:
    x1, y1 = normalize_point(b[0], b[1], width, height)
    x2, y2 = normalize_point(b[2], b[3], width, height)
    return x1, y1, x2, y2


def foot_point(b: BBox) -> Point:
    """Bottom-centre of a bounding box: the person's ground contact point."""
    return (b[0] + b[2]) / 2.0, b[3]


def bbox_center(b: BBox) -> Point:
    return (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0


def distance(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def cross(o: Point, a: Point, b: Point) -> float:
    """Z component of (a-o) x (b-o). >0 means b is clockwise of a in image coords (y down)."""
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def point_in_polygon(p: Point, poly: Sequence[Point]) -> bool:
    """Ray-casting point-in-polygon test. Points on the boundary count as inside."""
    n = len(poly)
    if n < 3:
        return False
    x, y = p
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        # boundary check
        if _on_segment((xi, yi), (xj, yj), p):
            return True
        if (yi > y) != (yj > y):
            x_int = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_int:
                inside = not inside
        j = i
    return inside


def _on_segment(a: Point, b: Point, p: Point, eps: float = 1e-9) -> bool:
    if abs(cross(a, b, p)) > eps:
        return False
    return min(a[0], b[0]) - eps <= p[0] <= max(a[0], b[0]) + eps and min(a[1], b[1]) - eps <= p[
        1
    ] <= max(a[1], b[1]) + eps


def segments_intersect(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    """True when segment p1-p2 intersects segment q1-q2 (including touching)."""
    d1 = cross(q1, q2, p1)
    d2 = cross(q1, q2, p2)
    d3 = cross(p1, p2, q1)
    d4 = cross(p1, p2, q2)
    if ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4)):
        return True
    return (
        (d1 == 0 and _on_segment(q1, q2, p1))
        or (d2 == 0 and _on_segment(q1, q2, p2))
        or (d3 == 0 and _on_segment(p1, p2, q1))
        or (d4 == 0 and _on_segment(p1, p2, q2))
    )


def line_param(a: Point, b: Point, p1: Point, p2: Point) -> float | None:
    """Parameter t along a->b where the infinite line through p1->p2 meets it (None if parallel)."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = p2[0] - p1[0], p2[1] - p1[1]
    denom = rx * sy - ry * sx
    if abs(denom) < 1e-12:
        return None
    return ((p1[0] - a[0]) * sy - (p1[1] - a[1]) * sx) / denom


def signed_distance(a: Point, b: Point, p: Point) -> float:
    """Signed perpendicular distance of p from the infinite line a->b (sign = side)."""
    length = distance(a, b)
    if length == 0:
        return 0.0
    return cross(a, b, p) / length


def in_side_sign(a: Point, b: Point, direction: str) -> int:
    """Side sign (+1/-1) of line a->b that a person ends up on when moving in ``direction``.

    Falls back to the line's left normal when the direction is parallel to the line.
    """
    d = DIRECTION_VECTORS[direction]
    c = (b[0] - a[0]) * d[1] - (b[1] - a[1]) * d[0]
    if abs(c) < 1e-9:
        return 1
    return 1 if c > 0 else -1


def crossing_direction(p_from: Point, p_to: Point) -> str:
    """Dominant movement direction between two points."""
    dx, dy = p_to[0] - p_from[0], p_to[1] - p_from[1]
    if abs(dx) >= abs(dy):
        return "RIGHT" if dx > 0 else "LEFT"
    return "DOWN" if dy > 0 else "UP"


def polygon_area(poly: Sequence[Point]) -> float:
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def polygon_centroid(poly: Sequence[Point]) -> Point:
    return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
