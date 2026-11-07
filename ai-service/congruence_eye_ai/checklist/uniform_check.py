"""AI-in-Checklist: staff grooming / uniform adherence from a photo.

1. **People** — YOLO person boxes (conf >= 0.4, height >= 25 % of the photo, up to 3 largest).
   Without a model, or when nobody is detected, the whole photo is treated as one person.
2. **Uniform colour** — fraction of torso pixels (box rows 20-55 %, columns 20-80 %) inside the
   configured HSV ranges; >= ``UNIFORM_MIN_RATIO`` (35 %) = uniform matched.
3. **ID card / lanyard** — on the chest (rows 18-62 %, columns 15-85 %) pixels that do *not* belong
   to the shirt colour are grouped into connected components. A component counts as an **ID card**
   when it covers 0.8-15 % of the chest, has an aspect ratio of 0.45-1.9, is >= 60 % rectangular and
   stands out from the shirt (V or S differs by >= 25); a **lanyard** is a thin component >= 30 % of
   the chest height and <= 12 % of its width. Either one counts as "ID detected".
4. **Verdict** — "Groomed" when every person passes both checks; issues list the missing items
   ("Uniform colour not matched", "ID card not detected"). Score = mean(0.6 x min(1, ratio/0.35)
   + 0.4 x id).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np

from ..analytics.staff import crop, uniform_ratio
from ..geometry import BBox
from .common import AiCheckResult, jpeg_b64, resize_max

HsvRange = tuple[tuple[int, int, int], tuple[int, int, int]]

MAX_SIDE = 960
UNIFORM_MIN_RATIO = 0.35
PERSON_MIN_HEIGHT = 0.25
CARD_MIN_AREA, CARD_MAX_AREA = 0.008, 0.15
CARD_ASPECT = (0.45, 1.9)
CARD_FILL = 0.6
CARD_CONTRAST = 25
LANYARD_MIN_H, LANYARD_MAX_W = 0.30, 0.12

GREEN, RED, BLUE = (0, 170, 0), (0, 0, 230), (220, 120, 0)
UNIFORM_ISSUE = "Uniform colour not matched"
ID_ISSUE = "ID card not detected"

PersonDetector = Callable[[np.ndarray], list[BBox]]


def _shirt_mask(hsv: np.ndarray, lab: np.ndarray, ranges: Sequence[HsvRange], uniform_ok: bool) -> np.ndarray:
    import cv2

    if uniform_ok:
        m = np.zeros(hsv.shape[:2], np.uint8)
        for lo, hi in ranges:
            m |= cv2.inRange(hsv, np.array(lo, np.uint8), np.array(hi, np.uint8))
        return m > 0
    med = np.median(lab.reshape(-1, 3), axis=0)
    return np.sqrt(((lab.astype(np.float32) - med) ** 2).sum(-1)) < 20


def detect_id(chest_bgr: np.ndarray, ranges: Sequence[HsvRange], uniform_ok: bool) -> tuple[str | None, tuple[int, int, int, int] | None]:
    """("card"|"lanyard"|None, box in chest pixel coords)."""
    import cv2

    ch, cw = chest_bgr.shape[:2]
    if ch < 10 or cw < 10:
        return None, None
    hsv = cv2.cvtColor(chest_bgr, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(chest_bgr, cv2.COLOR_BGR2LAB)
    shirt = _shirt_mask(hsv, lab, ranges, uniform_ok)
    if shirt.mean() < 0.2:
        return None, None
    shirt_v = float(np.median(hsv[..., 2][shirt]))
    shirt_s = float(np.median(hsv[..., 1][shirt]))
    other = (~shirt).astype(np.uint8)
    other = cv2.morphologyEx(other, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    k = max(5, int(min(ch, cw) * 0.04) | 1)
    solid = cv2.morphologyEx(other, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))  # removes thin straps
    thin = cv2.bitwise_and(other, cv2.bitwise_not(solid))
    area_total = ch * cw
    best_card, best_lanyard = None, None
    n, labels, stats, _ = cv2.connectedComponentsWithStats(solid, 8)
    for i in range(1, n):
        x, y, w, h, a = (int(v) for v in stats[i])
        if x == 0 or x + w >= cw or y == 0:  # touching the crop border: arms, neck, background
            continue
        frac = a / area_total
        fill = a / max(1, w * h)
        sel = labels == i
        dv = abs(float(np.median(hsv[..., 2][sel])) - shirt_v)
        ds = abs(float(np.median(hsv[..., 1][sel])) - shirt_s)
        if CARD_MIN_AREA <= frac <= CARD_MAX_AREA and CARD_ASPECT[0] <= w / max(1, h) <= CARD_ASPECT[1] and fill >= CARD_FILL and max(dv, ds) >= CARD_CONTRAST:
            if best_card is None or a > best_card[1]:
                best_card = ((x, y, x + w, y + h), a)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(thin, 8)
    for i in range(1, n):
        x, y, w, h, a = (int(v) for v in stats[i])
        if x == 0 or x + w >= cw:
            continue
        if h >= LANYARD_MIN_H * ch and w <= max(LANYARD_MAX_W * cw, h):
            if best_lanyard is None or h > best_lanyard[1]:
                best_lanyard = ((x, y, x + w, y + h), h)
    if best_card:
        return "card", best_card[0]
    if best_lanyard:
        return "lanyard", best_lanyard[0]
    return None, None


def uniform_check(image: np.ndarray, ranges: Sequence[HsvRange], person_detector: PersonDetector | None = None) -> AiCheckResult:
    """Grooming verdict for a staff photo."""
    import cv2

    from ..annotate import draw_label

    img = resize_max(image, MAX_SIDE)
    ih, iw = img.shape[:2]
    persons: list[BBox] = []
    if person_detector is not None:
        try:
            persons = [b for b in person_detector(img) if b[3] - b[1] >= PERSON_MIN_HEIGHT]
        except Exception:  # pragma: no cover - model failure falls back to the whole image
            persons = []
        persons = sorted(persons, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))[:3]
    whole = not persons
    if whole:
        persons = [(0.0, 0.0, 1.0, 1.0)]

    out = img.copy()
    thick = max(2, iw // 300)
    issues: list[str] = []
    scores: list[float] = []
    for k, b in enumerate(persons, 1):
        torso = crop(img, b, 0.2, 0.55, 0.2, 0.8)
        ratio = uniform_ratio(torso, ranges)
        uniform_ok = ratio >= UNIFORM_MIN_RATIO
        chest_box = (b[0] + (b[2] - b[0]) * 0.15, b[1] + (b[3] - b[1]) * 0.18, b[0] + (b[2] - b[0]) * 0.85, b[1] + (b[3] - b[1]) * 0.62)
        chest = crop(img, b, 0.18, 0.62, 0.15, 0.85)
        kind, cbox = detect_id(chest, ranges, uniform_ok)
        id_ok = kind is not None
        scores.append(0.6 * min(1.0, ratio / UNIFORM_MIN_RATIO) + 0.4 * (1.0 if id_ok else 0.0))
        prefix = f"Person {k}: " if len(persons) > 1 else ""
        if not uniform_ok:
            issues.append(prefix + UNIFORM_ISSUE)
        if not id_ok:
            issues.append(prefix + ID_ISSUE)
        groomed = uniform_ok and id_ok
        px = (int(b[0] * iw), int(b[1] * ih), int(b[2] * iw) - 1, int(b[3] * ih) - 1)
        color = GREEN if groomed else RED
        if not whole:
            cv2.rectangle(out, px[:2], px[2:], color, thick)
        tx1, ty1 = int((b[0] + (b[2] - b[0]) * 0.2) * iw), int((b[1] + (b[3] - b[1]) * 0.2) * ih)
        tx2, ty2 = int((b[0] + (b[2] - b[0]) * 0.8) * iw), int((b[1] + (b[3] - b[1]) * 0.55) * ih)
        cv2.rectangle(out, (tx1, ty1), (tx2, ty2), GREEN if uniform_ok else RED, max(1, thick - 1))
        draw_label(out, f"Uniform {ratio:.0%}", (tx1, ty2 + 22), GREEN if uniform_ok else RED)
        if cbox is not None:
            cx0, cy0 = chest_box[0] * iw, chest_box[1] * ih
            cv2.rectangle(out, (int(cx0 + cbox[0]), int(cy0 + cbox[1])), (int(cx0 + cbox[2]), int(cy0 + cbox[3])), BLUE, thick)
            draw_label(out, "ID card" if kind == "card" else "Lanyard", (int(cx0 + cbox[0]), int(cy0 + cbox[1]) - 4), BLUE)
        draw_label(out, ("Groomed" if groomed else "Not Groomed") + (f" (P{k})" if len(persons) > 1 else ""), (px[0] + 4, px[1] + 28 if whole else px[1] - 4), color)
    passed = not issues
    score = round(float(np.clip(np.mean(scores), 0, 1)), 3)
    return AiCheckResult(
        status="PASS" if passed else "FAIL",
        score=score,
        message="Groomed" if passed else "Not Groomed",
        issues=issues,
        annotatedJpegBase64=jpeg_b64(out),
    )
