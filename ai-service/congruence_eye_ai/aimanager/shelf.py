"""Shelf emptiness (stock-out) estimation by edge/texture density vs a "full shelf" reference.

A stocked shelf is full of product edges; an empty shelf shows a flat back panel. Only *vertical*
edges (horizontal intensity steps) are counted so the shelf boards themselves don't look like
stock. The polygon's
bounding box is split into ``cols x rows`` cells; for every cell the fraction of strong-gradient
pixels is compared with the same cell in the reference. A cell is *empty* when its density drops
below ``EMPTY_RATIO`` (35 %) of the reference. ``emptyPct`` = empty cells / comparable cells.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..geometry import BBox, Point, point_in_polygon

EDGE_THRESHOLD = 28.0  # grey-level step counted as an edge
EMPTY_RATIO = 0.35  # cell density below 35 % of reference => empty
MIN_REF_DENSITY = 0.03  # cells that were already flat in the reference are ignored
OCCLUSION_OVERLAP = 0.2  # a person box covering > 20 % of a cell hides it


def _grey(frame: np.ndarray) -> np.ndarray:
    if frame.ndim == 2:
        return frame.astype(np.float32)
    return frame.astype(np.float32) @ np.array([0.114, 0.587, 0.299], np.float32)


def edge_mask(grey: np.ndarray, threshold: float = EDGE_THRESHOLD) -> np.ndarray:
    """Boolean mask of vertical edges: pixels with a horizontal intensity step above ``threshold``."""
    m = np.zeros(grey.shape, dtype=bool)
    if grey.shape[1] < 2:
        return m
    m[:, :-1] = np.abs(np.diff(grey, axis=1)) > threshold
    return m


@dataclass(slots=True)
class ShelfCell:
    index: int
    bbox: BBox  # normalised


def shelf_cells(polygon: Sequence[Point], cols: int = 8, rows: int = 2) -> list[ShelfCell]:
    """Cells of the polygon's bounding box whose centre lies inside the polygon."""
    xs, ys = [p[0] for p in polygon], [p[1] for p in polygon]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = (x1 - x0) / cols, (y1 - y0) / rows
    out = []
    for r in range(rows):
        for c in range(cols):
            b = (x0 + c * w, y0 + r * h, x0 + (c + 1) * w, y0 + (r + 1) * h)
            if point_in_polygon(((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), polygon):
                out.append(ShelfCell(r * cols + c, b))
    return out


def cell_densities(frame: np.ndarray, cells: Sequence[ShelfCell]) -> np.ndarray:
    """Edge density (0..1) per cell."""
    h, w = frame.shape[:2]
    edges = edge_mask(_grey(frame))
    out = np.zeros(len(cells), dtype=np.float32)
    for i, c in enumerate(cells):
        x1, y1 = int(c.bbox[0] * w), int(c.bbox[1] * h)
        x2, y2 = max(x1 + 1, int(round(c.bbox[2] * w))), max(y1 + 1, int(round(c.bbox[3] * h)))
        patch = edges[y1:y2, x1:x2]
        out[i] = float(patch.mean()) if patch.size else 0.0
    return out


def occluded_cells(cells: Sequence[ShelfCell], person_boxes: Sequence[BBox]) -> np.ndarray:
    occ = np.zeros(len(cells), dtype=bool)
    for i, c in enumerate(cells):
        area = max(1e-9, (c.bbox[2] - c.bbox[0]) * (c.bbox[3] - c.bbox[1]))
        for b in person_boxes:
            ix = max(0.0, min(c.bbox[2], b[2]) - max(c.bbox[0], b[0]))
            iy = max(0.0, min(c.bbox[3], b[3]) - max(c.bbox[1], b[1]))
            if ix * iy / area > OCCLUSION_OVERLAP:
                occ[i] = True
                break
    return occ


@dataclass(slots=True)
class ShelfReading:
    empty_pct: float  # 0..100
    comparable: int
    visible_fraction: float
    empty_cells: list[int]


def compare(current: np.ndarray, reference: np.ndarray, occluded: np.ndarray | None = None) -> ShelfReading:
    """Empty percentage of the shelf vs the reference densities."""
    valid = reference >= MIN_REF_DENSITY
    total_valid = int(valid.sum())
    if occluded is not None:
        valid = valid & ~occluded
    n = int(valid.sum())
    if n == 0:
        return ShelfReading(0.0, 0, 0.0, [])
    empty = valid & (current < reference * EMPTY_RATIO)
    return ShelfReading(round(100.0 * float(empty.sum()) / n, 1), n, n / max(1, total_valid), [int(i) for i in np.where(empty)[0]])


class ShelfReferenceStore:
    """Persists the "full shelf" reference densities per SHELF zone (JSON in ``SPOOL_DIR``).

    The reference is keyed by a signature of polygon + grid + ``referenceSnapshotId`` so it is
    re-captured automatically when the zone is redrawn or a new reference is requested.
    """

    def __init__(self, directory: Path | str | None) -> None:
        self.path = Path(directory) / "shelf_references.json" if directory else None
        self._lock = threading.Lock()
        self._data: dict[str, dict] = {}
        if self.path and self.path.exists():
            try:
                self._data = json.loads(self.path.read_text())
            except ValueError:
                self._data = {}

    @staticmethod
    def signature(polygon: Sequence[Point], cols: int, rows: int, reference_snapshot_id: int | None) -> str:
        raw = json.dumps([[round(x, 4), round(y, 4)] for x, y in polygon]) + f"|{cols}x{rows}|{reference_snapshot_id}"
        return hashlib.sha1(raw.encode()).hexdigest()[:16]

    def get(self, zone_id: int, sig: str) -> np.ndarray | None:
        with self._lock:
            d = self._data.get(str(zone_id))
        if not d or d.get("sig") != sig:
            return None
        return np.asarray(d["densities"], dtype=np.float32)

    def set(self, zone_id: int, sig: str, densities: np.ndarray) -> None:
        with self._lock:
            self._data[str(zone_id)] = {"sig": sig, "densities": [round(float(x), 5) for x in densities], "capturedAt": time.time()}
            if self.path:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(json.dumps(self._data))

    def clear(self, zone_id: int | None = None) -> None:
        with self._lock:
            if zone_id is None:
                self._data.clear()
            else:
                self._data.pop(str(zone_id), None)
            if self.path:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(json.dumps(self._data))
