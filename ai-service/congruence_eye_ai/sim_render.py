"""Synthetic CCTV-like scene rendering for the simulator.

Two resolutions are produced from the same scene description:

* small analytics frames (320x180) fed to the analytics pipeline — people are drawn as flat
  colour blocks so uniform detection and colour re-ID behave like on real (clean) video;
* larger snapshot frames (960x540 by default) with nicer figures, a timestamp / camera overlay
  and darkened "lights off" scenes, uploaded as PERIODIC / AI_MANAGER / OPENING / CLOSING
  snapshots (Image Directory, recap video, detection evidence).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

from .detector import Track
from .schemas import Camera, Zone

SKIN = (120, 160, 210)
PHONE_CLASS = 67


def _poly_bbox(poly: Sequence[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


class SceneRenderer:
    """Renders every camera of the simulated store."""

    def __init__(
        self,
        cameras: Sequence[Camera],
        zones: Sequence[Zone],
        colours: Callable[[int], tuple[tuple[int, int, int], tuple[int, int, int]]],
        shelf_fill: Callable[[int, float], float],
        lights_on: Callable[[float], bool],
        tz: ZoneInfo,
        store_name: str = "",
        seed: int = 3,
    ) -> None:
        self.cameras = {c.id: c for c in cameras}
        self.zones = {c.id: [z for z in zones if z.camera_id == c.id and z.is_active] for c in cameras}
        self.colours = colours
        self.shelf_fill = shelf_fill
        self.lights_on = lights_on
        self.tz = tz
        self.store_name = store_name
        self.seed = seed
        self._bg: dict[tuple[int, int, int], np.ndarray] = {}
        self._shelf: dict[tuple[int, int, int, int, int], np.ndarray] = {}

    # ------------------------------------------------------------------ static background
    def background(self, cam_id: int, w: int, h: int) -> np.ndarray:
        key = (cam_id, w, h)
        bg = self._bg.get(key)
        if bg is None:
            bg = self._bg[key] = self._make_background(cam_id, w, h)
        return bg

    def _make_background(self, cam_id: int, w: int, h: int) -> np.ndarray:
        import cv2

        rs = np.random.RandomState(self.seed * 1000 + cam_id)
        cam = self.cameras[cam_id]
        zones = self.zones[cam_id]
        horizon = int(0.27 * h)
        img = np.zeros((h, w, 3), np.uint8)
        wall = np.array([200, 214, 226], np.float32) + rs.randint(-12, 12, 3)
        floor = np.array([150, 150, 140], np.float32) + rs.randint(-15, 15, 3)
        for y in range(h):
            if y < horizon:
                img[y] = np.clip(wall * (0.92 + 0.08 * y / horizon), 0, 255)
            else:
                img[y] = np.clip(floor * (0.85 + 0.25 * (y - horizon) / (h - horizon)), 0, 255)
        # skirting + perspective floor tiles
        cv2.rectangle(img, (0, horizon - max(2, h // 90)), (w, horizon), (90, 100, 110), -1)
        vp = (w // 2, -int(0.6 * h))
        line = tuple(int(c) for c in np.clip(floor * 0.78, 0, 255))
        for k in range(-12, 13):
            x_bottom = int(w / 2 + k * w / 9)
            cv2.line(img, vp, (x_bottom, h), line, 1)
        y = horizon
        step = (h - horizon) / 14
        while y < h:
            cv2.line(img, (0, int(y)), (w, int(y)), line, 1)
            step *= 1.18
            y += step
        cv2.rectangle(img, (0, 0), (w, horizon - max(2, h // 90)), tuple(int(c) for c in wall), -1)
        # wall racks with products (not where a SHELF zone is)
        shelf_boxes = [_poly_bbox(z.polygon) for z in zones if z.type == "SHELF"]
        if cam.type in ("ZONE", "GENERAL") or any(z.type == "SECTION" for z in zones):
            for rx0 in np.arange(0.03, 0.97, 0.19):
                rb = (rx0, 0.02, rx0 + 0.16, 0.25)
                if any(not (rb[2] < b[0] or rb[0] > b[2] or rb[3] < b[1] or rb[1] > b[3]) for b in shelf_boxes):
                    continue
                self._draw_rack(img, rb, rs, w, h, full=True)
        # section rugs / fixtures
        for z in zones:
            pts = np.array([[int(x * w), int(y * h)] for x, y in z.polygon], np.int32)
            if z.type == "SECTION" and len(pts) >= 3:
                tint = img.copy()
                cv2.fillPoly(tint, [pts], tuple(int(c) for c in rs.randint(110, 170, 3)))
                img = cv2.addWeighted(tint, 0.18, img, 0.82, 0)
            elif z.type == "ENTRY_LINE" and len(pts) >= 2:
                (x1, y1), (x2, y2) = pts[0], pts[1]
                # door frame + mat around the entry line
                cv2.rectangle(img, (min(x1, x2), min(y1, y2) - h // 30), (max(x1, x2), max(y1, y2) + h // 30), (70, 70, 70), -1)
                cv2.rectangle(img, (min(x1, x2), 0), (max(x1, x2), horizon), (170, 190, 200), -1)
                for gx in np.linspace(min(x1, x2), max(x1, x2), 5).astype(int):
                    cv2.line(img, (int(gx), 0), (int(gx), horizon), (110, 110, 110), max(1, w // 300))
            elif z.type == "STAFF_ONLY" and len(pts) >= 3:
                bx = _poly_bbox(z.polygon)
                # billing counter just in front of the staff area + POS terminal
                cy = int(bx[1] * h)
                cv2.rectangle(img, (int(bx[0] * w), cy - h // 14), (int(bx[2] * w), cy), (60, 80, 110), -1)
                cv2.rectangle(img, (int((bx[0] + bx[2]) / 2 * w), cy - h // 7), (int((bx[0] + bx[2]) / 2 * w) + w // 30, cy - h // 14), (30, 30, 30), -1)
        for z in zones:
            if z.type == "SHELF":
                b = _poly_bbox(z.polygon)
                cv2.rectangle(img, (int(b[0] * w) - 2, int(b[1] * h) - 2), (int(b[2] * w) + 2, int(b[3] * h) + 2), (40, 60, 80), max(2, w // 200))
                cv2.rectangle(img, (int(b[0] * w), int(b[1] * h)), (int(b[2] * w), int(b[3] * h)), (215, 225, 230), -1)
        noise = rs.randint(-3, 4, (h, w, 1)).astype(np.int16)
        return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    @staticmethod
    def _draw_rack(img: np.ndarray, b: tuple[float, float, float, float], rs: np.random.RandomState, w: int, h: int, full: bool) -> None:
        import cv2

        x0, y0, x1, y1 = int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)
        cv2.rectangle(img, (x0, y0), (x1, y1), (60, 80, 105), max(1, w // 300))
        rows = 3
        for r in range(rows):
            by = y0 + (r + 1) * (y1 - y0) // rows
            cv2.line(img, (x0, by), (x1, by), (60, 80, 105), max(1, w // 300))
            x = x0 + 2
            while x < x1 - 4:
                pw = max(2, int(rs.randint(5, 12) * w / 640))
                ph = max(2, int((y1 - y0) / rows * rs.uniform(0.55, 0.9)))
                col = tuple(int(c) for c in rs.randint(40, 230, 3))
                cv2.rectangle(img, (x, by - ph), (min(x1 - 2, x + pw), by - 1), col, -1)
                x += pw + max(1, w // 400)

    # ------------------------------------------------------------------ dynamic shelf
    def _shelf_layer(self, zone: Zone, n_present: int, w: int, h: int) -> np.ndarray:
        """Products for a SHELF zone with ``n_present`` of its slots stocked (RGBA-like: mask in alpha)."""
        import cv2

        key = (zone.id, n_present, w, h, 0)
        layer = self._shelf.get(key)
        if layer is not None:
            return layer
        b = _poly_bbox(zone.polygon)
        x0, y0, x1, y1 = int(b[0] * w), int(b[1] * h), int(b[2] * w), int(b[3] * h)
        layer = np.zeros((h, w, 4), np.uint8)
        slots = self._slots(zone)
        order = np.random.RandomState(abs(zone.id) + 77).permutation(len(slots))
        present = set(order[:n_present].tolist())
        rows = 3
        for i, (r, c, cols) in enumerate(slots):
            if i not in present:
                continue
            sw = (x1 - x0) / cols
            sh = (y1 - y0) / rows
            px0, py0 = int(x0 + c * sw + sw * 0.1), int(y0 + r * sh + sh * 0.12)
            px1, py1 = int(x0 + (c + 1) * sw - sw * 0.1), int(y0 + (r + 1) * sh - sh * 0.05)
            rs = np.random.RandomState(abs(zone.id) * 100 + i)
            col = tuple(int(v) for v in rs.randint(30, 220, 3)) + (255,)
            cv2.rectangle(layer, (px0, py0), (px1, py1), col, -1)
            cv2.rectangle(layer, (px0, py0), (px1, py1), (20, 20, 20, 255), max(1, w // 320))
            ly = (py0 + py1) // 2
            cv2.line(layer, (px0 + 2, ly), (px1 - 2, ly), (250, 250, 250, 255), max(1, w // 400))
        for r in range(1, rows + 1):
            yy = int(y0 + r * (y1 - y0) / rows)
            cv2.line(layer, (x0, yy), (x1, yy), (40, 60, 80, 255), max(1, w // 300))
        self._shelf[key] = layer
        return layer

    def _shelf_patch(self, zone: Zone, present: int, w: int, h: int) -> tuple[int, int, int, int, np.ndarray, np.ndarray]:
        key = (zone.id, present, w, h, 1)
        cached = self._shelf.get(key)
        if cached is None:
            layer = self._shelf_layer(zone, present, w, h)
            b = _poly_bbox(zone.polygon)
            x0, y0 = max(0, int(b[0] * w) - 2), max(0, int(b[1] * h) - 2)
            x1, y1 = min(w, int(b[2] * w) + 3), min(h, int(b[3] * h) + 3)
            sub = layer[y0:y1, x0:x1]
            cached = (y0, y1, x0, x1, np.ascontiguousarray(sub[..., :3]), np.repeat(sub[..., 3:4] > 0, 3, axis=2))
            self._shelf[key] = cached  # type: ignore[assignment]
        return cached  # type: ignore[return-value]

    @staticmethod
    def _slots(zone: Zone) -> list[tuple[int, int, int]]:
        b = _poly_bbox(zone.polygon)
        cols = max(4, int(round((b[2] - b[0]) / 0.045)))
        return [(r, c, cols) for r in range(3) for c in range(cols)]

    # ------------------------------------------------------------------ frame
    def render(self, cam_id: int, t: float, tracks: Sequence[Track], w: int = 320, h: int = 180, overlay: bool = False) -> np.ndarray:
        import cv2

        img = self.background(cam_id, w, h).copy()
        for z in self.zones[cam_id]:
            if z.type == "SHELF":
                n = len(self._slots(z))
                present = int(round(n * max(0.0, min(1.0, self.shelf_fill(z.id, t)))))
                y0, y1, x0, x1, rgb, mask = self._shelf_patch(z, present, w, h)
                np.copyto(img[y0:y1, x0:x1], rgb, where=mask)
        fancy = w >= 480
        people = sorted((tr for tr in tracks if tr.cls == 0), key=lambda tr: tr.bbox[3])
        phones = [tr for tr in tracks if tr.cls == PHONE_CLASS]
        for tr in people:
            self._draw_person(img, tr, w, h, fancy)
        for ph in phones:
            x1, y1, x2, y2 = ph.pixel_bbox(w, h)
            cv2.rectangle(img, (x1, y1), (max(x1 + 1, x2), max(y1 + 1, y2)), (25, 25, 25), -1)
            if fancy:
                cv2.rectangle(img, (x1 + 2, y1 + 2), (max(x1 + 3, x2 - 2), max(y1 + 3, y2 - 3)), (230, 200, 120), -1)
        if not self.lights_on(t):
            img = cv2.convertScaleAbs(img, alpha=0.1)
        if overlay:
            self._overlay(img, cam_id, t)
        return img

    def _draw_person(self, img: np.ndarray, tr: Track, w: int, h: int, fancy: bool) -> None:
        import cv2

        x1, y1, x2, y2 = tr.pixel_bbox(w, h)
        if x2 - x1 < 2 or y2 - y1 < 4:
            return
        ph = y2 - y1
        pw = x2 - x1
        shirt, pants = self.colours(tr.meta.get("pid", 0))
        if not fancy:
            img[y1 : y1 + int(ph * 0.15), x1 + pw // 4 : x2 - pw // 4] = SKIN
            img[y1 + int(ph * 0.15) : y1 + int(ph * 0.55), x1:x2] = shirt
            img[y1 + int(ph * 0.55) : y2, x1:x2] = pants
            return
        # nicer figure for snapshots
        cx = (x1 + x2) // 2
        head_r = max(2, int(ph * 0.075))
        cv2.circle(img, (cx, y1 + head_r + 1), head_r, SKIN, -1)
        cv2.ellipse(img, (cx, y1 + head_r - head_r // 3), (head_r, head_r // 2 + 1), 0, 180, 360, (40, 40, 50), -1)  # hair
        torso_top, torso_bot = y1 + int(ph * 0.17), y1 + int(ph * 0.56)
        cv2.rectangle(img, (x1 + pw // 8, torso_top), (x2 - pw // 8, torso_bot), shirt, -1)
        cv2.rectangle(img, (x1, torso_top + 2), (x1 + pw // 8, torso_bot - ph // 12), shirt, -1)  # arms
        cv2.rectangle(img, (x2 - pw // 8, torso_top + 2), (x2, torso_bot - ph // 12), shirt, -1)
        cv2.rectangle(img, (x1 + pw // 6, torso_bot), (cx - 1, y2 - ph // 25), pants, -1)
        cv2.rectangle(img, (cx + 1, torso_bot), (x2 - pw // 6, y2 - ph // 25), pants, -1)
        cv2.rectangle(img, (x1 + pw // 6, y2 - ph // 25), (x2 - pw // 6, y2), (30, 30, 30), -1)
        if tr.meta.get("staff"):
            # ID card on lanyard
            cv2.rectangle(img, (cx - pw // 10, torso_top + ph // 10), (cx + pw // 10, torso_top + ph // 6), (245, 245, 245), -1)
        if tr.meta.get("mop"):
            cv2.line(img, (x2, torso_top + ph // 6), (x2 + pw // 2, y2), (60, 90, 140), max(1, pw // 12))
            cv2.rectangle(img, (x2 + pw // 4, y2 - ph // 30), (x2 + pw, y2), (210, 210, 210), -1)

    def _overlay(self, img: np.ndarray, cam_id: int, t: float) -> None:
        import cv2

        h, w = img.shape[:2]
        scale = max(0.45, w / 1400)
        th = max(1, int(scale * 2))
        stamp = datetime.fromtimestamp(t, tz=self.tz).strftime("%Y-%m-%d %H:%M:%S")
        for txt, org in ((stamp, (10, int(28 * scale / 0.7))), (f"{self.cameras[cam_id].name}", (10, h - 12))):
            cv2.putText(img, txt, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), th + 2, cv2.LINE_AA)
            cv2.putText(img, txt, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), th, cv2.LINE_AA)
        label = f"{self.store_name}  CAM {cam_id:02d}"
        (tw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, th)
        cv2.putText(img, label, (w - tw - 12, int(28 * scale / 0.7)), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), th + 2, cv2.LINE_AA)
        cv2.putText(img, label, (w - tw - 12, int(28 * scale / 0.7)), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), th, cv2.LINE_AA)
        cv2.circle(img, (w - 20, h - 18), max(4, int(6 * scale / 0.7)), (0, 0, 230), -1)

