"""Draw zones, entry lines and tracks on a frame for the live preview endpoint."""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from .detector import Track
from .schemas import Zone

ZONE_COLORS = {
    "ENTRY_LINE": (0, 200, 255),
    "SECTION": (255, 160, 0),
    "QUEUE": (0, 0, 255),
    "STAFF_ONLY": (200, 0, 200),
}


def annotate(frame: np.ndarray, zones: Iterable[Zone], tracks: Iterable[Track], staff_ids: set[int] | None = None, label: str = "") -> np.ndarray:
    import cv2

    img = frame.copy()
    h, w = img.shape[:2]
    staff_ids = staff_ids or set()
    for z in zones:
        color = ZONE_COLORS.get(z.type, (255, 255, 255))
        pts = np.array([[int(x * w), int(y * h)] for x, y in z.polygon], dtype=np.int32)
        if z.type == "ENTRY_LINE" and len(pts) >= 2:
            cv2.line(img, tuple(pts[0]), tuple(pts[1]), color, 2)
            mid = ((pts[0] + pts[1]) // 2).tolist()
            cv2.putText(img, f"{z.name} IN:{z.in_direction or 'UP'}", (mid[0] + 4, mid[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
        elif len(pts) >= 3:
            overlay = img.copy()
            cv2.fillPoly(overlay, [pts], color)
            img = cv2.addWeighted(overlay, 0.15, img, 0.85, 0)
            cv2.polylines(img, [pts], True, color, 2)
            cv2.putText(img, z.name, tuple(pts[0].tolist()), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
    for t in tracks:
        x1, y1, x2, y2 = t.pixel_bbox(w, h)
        color = (200, 0, 200) if t.track_id in staff_ids else (0, 220, 0)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        tag = f"#{t.track_id}{' STAFF' if t.track_id in staff_ids else ''} {t.conf:.2f}"
        cv2.putText(img, tag, (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
        fx, fy = int(t.foot[0] * w), int(t.foot[1] * h)
        cv2.circle(img, (fx, fy), 3, color, -1)
    if label:
        cv2.putText(img, label, (8, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return img


def encode_jpeg(frame: np.ndarray, quality: int = 80) -> bytes:
    import cv2

    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return buf.tobytes()


def draw_label(img: np.ndarray, text: str, org: tuple[int, int], color: tuple[int, int, int], scale: float | None = None) -> None:
    """Text on a filled background box (readable on any scene)."""
    import cv2

    h, w = img.shape[:2]
    scale = scale or max(0.4, min(1.2, w / 1100))
    thick = max(1, int(round(scale * 2)))
    (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
    x, y = max(0, min(org[0], w - tw - 6)), max(th + 6, org[1])
    cv2.rectangle(img, (x, y - th - 6), (x + tw + 6, y + base - 2), color, -1)
    cv2.putText(img, text, (x + 3, y - 3), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), thick, cv2.LINE_AA)


def draw_annotations(
    frame: np.ndarray,
    boxes: Iterable[tuple[tuple[float, float, float, float], str, tuple[int, int, int]]],
    fills: Iterable[tuple[tuple[float, float, float, float], tuple[int, int, int]]] = (),
    title: str | None = None,
) -> np.ndarray:
    """Draw normalised boxes (with labels), translucent cell fills and a title banner."""
    import cv2

    img = frame.copy()
    h, w = img.shape[:2]
    fills = list(fills)
    if fills:
        overlay = img.copy()
        for (x1, y1, x2, y2), color in fills:
            cv2.rectangle(overlay, (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h)), color, -1)
        img = cv2.addWeighted(overlay, 0.35, img, 0.65, 0)
    thick = max(2, int(round(w / 400)))
    for (x1, y1, x2, y2), label, color in boxes:
        p1, p2 = (int(x1 * w), int(y1 * h)), (int(x2 * w), int(y2 * h))
        cv2.rectangle(img, p1, p2, color, thick)
        if label:
            draw_label(img, label, (p1[0], p1[1] - 2 if p1[1] > 20 else p2[1] + 22), color)
    if title:
        scale = max(0.45, min(1.1, w / 1200))
        bar = int(34 * scale / 0.8)
        cv2.rectangle(img, (0, h - bar), (w, h), (30, 30, 30), -1)
        cv2.putText(img, title[:120], (8, h - int(bar * 0.3)), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), max(1, int(scale * 2)), cv2.LINE_AA)
    return img
