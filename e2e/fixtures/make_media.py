"""Generate the E2E media fixtures (run with the ai-service venv: numpy + OpenCV).

    python fixtures/make_media.py <out_dir> [ffmpeg]

Outputs
  shelf_reference.jpg      approved reference: a store wall with shelves, products and a red "MEGA SALE" poster
  shelf_identical.jpg      the same wall photographed again (slightly brighter, re-encoded)  -> REFERENCE_MATCH PASS
  shelf_poster_removed.jpg the poster is missing                                             -> REFERENCE_MATCH FAIL
  staff_uniform_ok.jpg     staff member in the teal Congruence uniform with an ID card + lanyard -> UNIFORM PASS
  staff_wrong_colour.jpg   same pose in a red shirt                                           -> UNIFORM FAIL
  task_proof.jpg           a generic photo used as task completion proof
  checklist_clip.mp4       2 s H.264 clip (VIDEO question answer)   (only when an ffmpeg binary is given)
  checklist_clip.webm      2 s VP8 clip                              (only when an ffmpeg binary is given)

The scenes are drawn here (not taken from the ai-service test-suite) so the E2E verdicts are an independent check
of the real ai-service.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

WALL = (200, 212, 222)


def wall(h: int, w: int, seed: int) -> np.ndarray:
    rs = np.random.RandomState(seed)
    img = np.full((h, w, 3), WALL, np.uint8)
    return (img.astype(np.int16) + rs.randint(-5, 6, (h, w, 1))).clip(0, 255).astype(np.uint8)


def shelf_scene(poster: bool = True) -> np.ndarray:
    h, w = 800, 1200
    img = wall(h, w, 3)
    rs = np.random.RandomState(42)
    for y in (310, 530, 750):
        cv2.rectangle(img, (30, y), (w - 30, y + 16), (60, 80, 110), -1)
        x = 45
        while x < w - 110:
            bw, bh = int(rs.randint(38, 88)), int(rs.randint(70, 160))
            col = tuple(int(c) for c in rs.randint(25, 225, 3))
            cv2.rectangle(img, (x, y - bh), (x + bw, y), col, -1)
            cv2.rectangle(img, (x, y - bh), (x + bw, y), (15, 15, 15), 2)
            cv2.putText(img, "XYZ"[int(rs.randint(3))], (x + 9, y - bh // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (250, 250, 250), 2)
            cv2.line(img, (x + 5, y - 12), (x + bw - 5, y - 12), (240, 240, 240), 2)
            x += bw + int(rs.randint(6, 18))
    cv2.putText(img, "CONGRUENCE", (50, 125), cv2.FONT_HERSHEY_TRIPLEX, 2.1, (35, 55, 85), 4)
    cv2.putText(img, "T NAGAR", (60, 185), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (35, 55, 85), 3)
    if poster:
        x1, y1, x2, y2 = 800, 25, 1160, 255
        cv2.rectangle(img, (x1, y1), (x2, y2), (35, 35, 205), -1)
        cv2.rectangle(img, (x1 + 8, y1 + 8), (x2 - 8, y2 - 8), (255, 255, 255), 3)
        cv2.putText(img, "MEGA SALE", (x1 + 30, y1 + 90), cv2.FONT_HERSHEY_DUPLEX, 1.5, (255, 255, 255), 3)
        cv2.putText(img, "UPTO 50% OFF", (x1 + 25, y1 + 165), cv2.FONT_HERSHEY_DUPLEX, 1.2, (0, 225, 255), 3)
        cv2.circle(img, (x2 - 45, y2 - 40), 22, (255, 255, 255), 3)
    return img


def staff(shirt_bgr: tuple[int, int, int]) -> np.ndarray:
    h, w = 900, 600
    img = wall(h, w, 5)
    cv2.ellipse(img, (w // 2, int(h * 0.12)), (68, 88), 0, 0, 360, (110, 150, 205), -1)  # head
    cv2.rectangle(img, (int(w * 0.2), int(h * 0.22)), (int(w * 0.8), int(h * 0.62)), shirt_bgr, -1)  # torso
    cv2.rectangle(img, (int(w * 0.06), int(h * 0.24)), (int(w * 0.2), int(h * 0.56)), shirt_bgr, -1)  # arms
    cv2.rectangle(img, (int(w * 0.8), int(h * 0.24)), (int(w * 0.94), int(h * 0.56)), shirt_bgr, -1)
    cv2.rectangle(img, (int(w * 0.26), int(h * 0.62)), (int(w * 0.74), h), (45, 40, 38), -1)  # trousers
    # lanyard + ID card
    cv2.line(img, (int(w * 0.42), int(h * 0.22)), (int(w * 0.47), int(h * 0.4)), (25, 25, 150), 6)
    cv2.line(img, (int(w * 0.58), int(h * 0.22)), (int(w * 0.53), int(h * 0.4)), (25, 25, 150), 6)
    x1, y1, x2, y2 = int(w * 0.42), int(h * 0.4), int(w * 0.58), int(h * 0.5)
    cv2.rectangle(img, (x1, y1), (x2, y2), (246, 246, 246), -1)
    cv2.rectangle(img, (x1 + 8, y1 + 10), (x1 + 34, y1 + 44), (85, 85, 85), -1)
    cv2.line(img, (x1 + 42, y1 + 22), (x2 - 8, y1 + 22), (35, 35, 35), 3)
    cv2.line(img, (x1 + 42, y1 + 42), (x2 - 8, y1 + 42), (35, 35, 35), 3)
    return img


def hsv_to_bgr(h: int, s: int, v: int) -> tuple[int, int, int]:
    return tuple(int(x) for x in cv2.cvtColor(np.uint8([[[h, s, v]]]), cv2.COLOR_HSV2BGR)[0, 0])  # type: ignore[return-value]


def save(path: Path, img: np.ndarray, q: int = 90) -> None:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    assert ok
    path.write_bytes(buf.tobytes())


def main() -> int:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    ref = shelf_scene(True)
    save(out / "shelf_reference.jpg", ref)
    save(out / "shelf_identical.jpg", np.clip(ref.astype(np.int16) + 8, 0, 255).astype(np.uint8), 85)
    save(out / "shelf_poster_removed.jpg", shelf_scene(False), 85)
    save(out / "staff_uniform_ok.jpg", staff(hsv_to_bgr(87, 200, 160)))
    save(out / "staff_wrong_colour.jpg", staff((40, 40, 200)))
    save(out / "task_proof.jpg", shelf_scene(True)[100:700, 200:1000])
    if len(sys.argv) > 2:
        ff = sys.argv[2]
        src = ["-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10"]
        subprocess.run([ff, "-y", "-loglevel", "error", *src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                        str(out / "checklist_clip.mp4")], check=True)
        subprocess.run([ff, "-y", "-loglevel", "error", *src, "-c:v", "libvpx", "-b:v", "200k", str(out / "checklist_clip.webm")], check=True)
    print(f"media written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
