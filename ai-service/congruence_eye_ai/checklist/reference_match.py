"""AI-in-Checklist: compare a submitted photo with the approved reference image.

Pipeline (all thresholds are module constants, deterministic for a given input):

1. **Clarity** — both images are resized to ``MAX_SIDE``; the variance of the Laplacian of the
   submitted image must be >= ``BLUR_MIN_VAR`` and >= ``BLUR_REL_MIN`` x the reference's variance,
   otherwise FAIL "Submitted image is not clear".
2. **Alignment** — ORB features (AKAZE fallback), Lowe ratio test, RANSAC homography (fixed RNG
   seed). Fewer than ``MIN_INLIERS`` inliers => FAIL "does not match the reference".
3. **Framing / zoom** — the submitted frame must show >= ``MIN_COVERAGE`` of the reference area
   (else zoomed in / cropped) and the reference must fill >= ``MIN_PROJECTED_AREA`` of the submitted
   photo (else taken from too far) — both reported as "not clear".
4. **Structural diff** — the submitted image is warped onto the reference; after photometric
   normalisation a dissimilarity map ``max((1-SSIM)/2, chroma diff)`` is smoothed, thresholded at
   ``DIFF_THRESHOLD`` and cleaned morphologically. Regions >= ``MIN_REGION_FRAC`` of the image are
   reported, boxed in red on the submitted photo: "Element not found as per reference" when the
   reference had clearly more detail there (something removed), else "Element changed vs reference".
"""

from __future__ import annotations

import numpy as np

from ..annotate import draw_label
from .common import AiCheckResult, jpeg_b64, resize_max

MAX_SIDE = 800
BLUR_MIN_VAR = 60.0
BLUR_REL_MIN = 0.25
RATIO_TEST = 0.75
MIN_INLIERS = 15
MIN_COVERAGE = 0.6
MIN_PROJECTED_AREA = 0.2
DIFF_THRESHOLD = 0.25
MIN_REGION_FRAC = 0.01
NOT_CLEAR = "Submitted image is not clear"
NOT_FOUND = "Element not found as per reference"
CHANGED = "Element changed vs reference"

RED = (0, 0, 230)
GREEN = (0, 170, 0)


def laplacian_var(grey: np.ndarray) -> float:
    import cv2

    return float(cv2.Laplacian(grey, cv2.CV_64F).var())


def _features(grey: np.ndarray, kind: str) -> tuple[list, np.ndarray | None]:
    import cv2

    det = cv2.ORB_create(nfeatures=3000, fastThreshold=10) if kind == "orb" else cv2.AKAZE_create()
    return det.detectAndCompute(grey, None)


def _match(ref_g: np.ndarray, img_g: np.ndarray) -> tuple[np.ndarray, np.ndarray, int] | None:
    """Matched point arrays (ref, img) after the ratio test, trying ORB then AKAZE."""
    import cv2

    best = None
    for kind in ("orb", "akaze"):
        k1, d1 = _features(ref_g, kind)
        k2, d2 = _features(img_g, kind)
        if d1 is None or d2 is None or len(k1) < 4 or len(k2) < 4:
            continue
        bf = cv2.BFMatcher(cv2.NORM_HAMMING)
        good = []
        for pair in bf.knnMatch(d1, d2, k=2):
            if len(pair) == 2 and pair[0].distance < RATIO_TEST * pair[1].distance:
                good.append(pair[0])
        if best is None or len(good) > best[2]:
            p1 = np.float32([k1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
            p2 = np.float32([k2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
            best = (p1, p2, len(good))
        if best[2] >= 4 * MIN_INLIERS:
            break
    return best


def _ssim_map(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    import cv2

    a = a.astype(np.float32)
    b = b.astype(np.float32)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)  # noqa: E731
    mu_a, mu_b = blur(a), blur(b)
    saa = blur(a * a) - mu_a**2
    sbb = blur(b * b) - mu_b**2
    sab = blur(a * b) - mu_a * mu_b
    return ((2 * mu_a * mu_b + c1) * (2 * sab + c2)) / ((mu_a**2 + mu_b**2 + c1) * (saa + sbb + c2))


def _where(box: tuple[int, int, int, int], w: int, h: int) -> str:
    cx, cy = (box[0] + box[2]) / 2 / w, (box[1] + box[3]) / 2 / h
    v = "top" if cy < 1 / 3 else "bottom" if cy > 2 / 3 else "middle"
    hz = "left" if cx < 1 / 3 else "right" if cx > 2 / 3 else "centre"
    return "centre" if (v, hz) == ("middle", "centre") else f"{v}-{hz}"


def _banner(img: np.ndarray, text: str, color: tuple[int, int, int]) -> np.ndarray:
    out = img.copy()
    draw_label(out, text, (6, out.shape[0] - 8), color, scale=max(0.5, min(1.0, out.shape[1] / 900)))
    return out


def reference_match(image: np.ndarray, reference: np.ndarray) -> AiCheckResult:
    """Compare ``image`` (submitted, BGR) with ``reference`` (approved, BGR)."""
    return match_with_boxes(image, reference)[0]


def match_with_boxes(image: np.ndarray, reference: np.ndarray) -> tuple[AiCheckResult, list[tuple[float, float, float, float]]]:
    """Like :func:`reference_match` but also returns the mismatch boxes, normalised to the submitted image."""
    return _compare(image, reference)


def _compare(image: np.ndarray, reference: np.ndarray) -> tuple[AiCheckResult, list[tuple[float, float, float, float]]]:
    import cv2

    img = resize_max(image, MAX_SIDE)
    ref = resize_max(reference, MAX_SIDE)
    img_g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ref_g = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    h, w = ref_g.shape
    ih, iw = img_g.shape

    # 1. clarity -------------------------------------------------------------------------
    v_img, v_ref = laplacian_var(img_g), laplacian_var(ref_g)

    def blurred() -> AiCheckResult:
        return AiCheckResult(
            status="FAIL", score=0.0, message=NOT_CLEAR,
            issues=[f"Image is blurred or out of focus (sharpness {v_img:.0f}, reference {v_ref:.0f})"],
            annotatedJpegBase64=jpeg_b64(_banner(img, NOT_CLEAR, RED)),
        )

    if v_img < BLUR_MIN_VAR:
        return blurred(), []
    rel_blurry = v_img < BLUR_REL_MIN * v_ref

    # 2. alignment -----------------------------------------------------------------------
    m = _match(ref_g, img_g)
    mismatch = "Submitted image does not match the reference"
    if (m is None or m[2] < MIN_INLIERS) and rel_blurry:
        return blurred(), []
    if m is None or m[2] < MIN_INLIERS:
        return AiCheckResult(status="FAIL", score=0.0, message=mismatch, issues=["Reference scene not recognised in the photo"],
                             annotatedJpegBase64=jpeg_b64(_banner(img, mismatch, RED))), []
    p_ref, p_img, _ = m
    cv2.setRNGSeed(42)
    H, mask = cv2.findHomography(p_ref, p_img, cv2.RANSAC, 5.0, maxIters=2000, confidence=0.995)
    inliers = int(mask.sum()) if mask is not None else 0
    if H is None or inliers < MIN_INLIERS or abs(np.linalg.det(H[:2, :2])) < 1e-6:
        return AiCheckResult(status="FAIL", score=0.0, message=mismatch, issues=["Reference scene not recognised in the photo"],
                             annotatedJpegBase64=jpeg_b64(_banner(img, mismatch, RED))), []
    H_inv = np.linalg.inv(H)

    # 3. framing ---------------------------------------------------------------------------
    ones = np.full((ih, iw), 255, np.uint8)
    valid = cv2.warpPerspective(ones, H_inv, (w, h), flags=cv2.INTER_NEAREST) > 0
    coverage = float(valid.mean())
    ref_in_img = cv2.warpPerspective(np.full((h, w), 255, np.uint8), H, (iw, ih), flags=cv2.INTER_NEAREST) > 0
    projected = float(ref_in_img.mean())
    if coverage < MIN_COVERAGE:
        return AiCheckResult(
            status="FAIL", score=round(coverage * 0.5, 3), message=NOT_CLEAR,
            issues=[f"Image is zoomed in or cropped: shows only {coverage:.0%} of the reference area"],
            annotatedJpegBase64=jpeg_b64(_banner(img, NOT_CLEAR, RED)),
        ), []
    if projected < MIN_PROJECTED_AREA:
        return AiCheckResult(
            status="FAIL", score=round(projected, 3), message=NOT_CLEAR,
            issues=[f"Image taken from too far: the reference area fills only {projected:.0%} of the photo"],
            annotatedJpegBase64=jpeg_b64(_banner(img, NOT_CLEAR, RED)),
        ), []

    if rel_blurry:
        return blurred(), []

    # 4. structural diff -----------------------------------------------------------------
    warped = cv2.warpPerspective(img, H_inv, (w, h), flags=cv2.INTER_LINEAR)
    valid_er = cv2.erode(valid.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    wg = cv2.GaussianBlur(cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.float32)
    rg = cv2.GaussianBlur(ref_g, (5, 5), 0).astype(np.float32)
    if valid_er.any():  # photometric normalisation (exposure / white balance differences)
        ms, ss = wg[valid_er].mean(), wg[valid_er].std() + 1e-6
        mr, sr = rg[valid_er].mean(), rg[valid_er].std() + 1e-6
        wg = np.clip((wg - ms) / ss * sr + mr, 0, 255)
    dis = np.clip((1.0 - _ssim_map(wg, rg)) / 2.0, 0, 1)
    lab_w = cv2.cvtColor(warped, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_r = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    chroma = np.sqrt(((lab_w[..., 1:] - lab_r[..., 1:]) ** 2).sum(-1)) / 60.0
    diff = np.maximum(dis, np.clip(chroma, 0, 1))
    diff = cv2.blur(diff, (15, 15))
    diff[~valid_er] = 0
    binm = (diff > DIFF_THRESHOLD).astype(np.uint8)
    binm = cv2.morphologyEx(binm, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    binm = cv2.morphologyEx(binm, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binm, 8)
    min_area = MIN_REGION_FRAC * max(1, int(valid_er.sum()))
    ref_edges = cv2.Canny(ref_g, 60, 160) > 0
    w_edges = cv2.Canny(wg.astype(np.uint8), 60, 160) > 0
    regions = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < min_area:
            continue
        sel = labels == i
        removed = ref_edges[sel].mean() > 1.5 * w_edges[sel].mean() + 0.01
        regions.append(((int(x), int(y), int(x + bw), int(y + bh)), int(area), NOT_FOUND if removed else CHANGED))
    regions.sort(key=lambda r: -r[1])

    changed_frac = sum(a for _, a, _ in regions) / max(1, int(valid_er.sum()))
    inlier_ratio = inliers / max(1, len(p_ref))
    score = float(np.clip((1.0 - 2.5 * changed_frac) * min(1.0, 0.5 + inlier_ratio), 0.0, 1.0))
    if not regions:
        score = max(score, 0.75)

    out = img.copy()
    issues: list[str] = []
    boxes: list[tuple[float, float, float, float]] = []
    for k, (box, _, label) in enumerate(regions[:10], 1):
        corners = np.float32([[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]).reshape(-1, 1, 2)
        pts = cv2.perspectiveTransform(corners, H).reshape(-1, 2)
        x1, y1 = np.clip(pts.min(0), 0, [iw - 1, ih - 1]).astype(int)
        x2, y2 = np.clip(pts.max(0), 0, [iw - 1, ih - 1]).astype(int)
        boxes.append((x1 / iw, y1 / ih, x2 / iw, y2 / ih))
        cv2.rectangle(out, (int(x1), int(y1)), (int(x2), int(y2)), RED, max(2, iw // 300))
        draw_label(out, label, (int(x1), int(y1) - 4 if y1 > 30 else int(y2) + 24), RED, scale=max(0.45, min(0.8, iw / 1100)))
        issues.append(f"{label} ({_where(box, w, h)})")
    if regions:
        out = _banner(out, f"AI check: {len(regions)} mismatch(es) vs reference", RED)
        msg = regions[0][2] if len({r[2] for r in regions}) == 1 else "Image does not match the reference"
        return AiCheckResult(status="FAIL", score=round(min(score, 0.6), 3), message=msg, issues=issues, annotatedJpegBase64=jpeg_b64(out)), boxes
    out = _banner(out, "Matches reference", GREEN)
    return AiCheckResult(status="PASS", score=round(score, 3), message="Image matches the reference", issues=[], annotatedJpegBase64=jpeg_b64(out)), []
