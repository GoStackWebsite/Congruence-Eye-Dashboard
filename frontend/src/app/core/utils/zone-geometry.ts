import { Point, ZoneType } from '../models/api.models';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Converts a client (mouse) coordinate into a normalised 0..1 point relative to `box`, clamped and rounded to 4 dp. */
export function normalisePoint(clientX: number, clientY: number, box: Box): Point {
  if (box.width <= 0 || box.height <= 0) return [0, 0];
  return [round4(clamp01((clientX - box.left) / box.width)), round4(clamp01((clientY - box.top) / box.height))];
}

/** Converts a normalised point to pixel coordinates within a width×height surface. */
export function denormalisePoint(p: Point, width: number, height: number): [number, number] {
  return [p[0] * width, p[1] * height];
}

/** SVG `points` attribute for a polygon in a viewBox of width×height. */
export function toSvgPoints(points: Point[], width = 1000, height = 1000): string {
  return points.map((p) => denormalisePoint(p, width, height).map((n) => Math.round(n * 10) / 10).join(',')).join(' ');
}

export function isNormalised(points: unknown): points is Point[] {
  return (
    Array.isArray(points) &&
    points.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1),
    )
  );
}

/** Validates point count for a zone type. Returns an error message or null. */
export function validateZoneGeometry(type: ZoneType, points: Point[]): string | null {
  if (!isNormalised(points)) return 'Coordinates must be normalised between 0 and 1';
  if (type === 'ENTRY_LINE') {
    return points.length === 2 ? null : 'An entry line needs exactly 2 points';
  }
  if (points.length < 3) return 'A polygon needs at least 3 points';
  if (Math.abs(polygonArea(points)) < 1e-4) return 'Polygon area is too small';
  return null;
}

/** Signed shoelace area of a normalised polygon. */
export function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(points: Point[]): Point {
  if (!points.length) return [0, 0];
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  return [sx / points.length, sy / points.length];
}

/** Adds a point respecting the type's limit (ENTRY_LINE keeps only the last 2 clicks). */
export function addPoint(type: ZoneType, points: Point[], p: Point): Point[] {
  if (type === 'ENTRY_LINE') {
    return points.length >= 2 ? [points[1], p] : [...points, p];
  }
  return [...points, p];
}
