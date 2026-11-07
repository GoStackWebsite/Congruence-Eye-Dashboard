import { addPoint, centroid, isNormalised, normalisePoint, polygonArea, toSvgPoints, validateZoneGeometry } from './zone-geometry';

describe('zone editor coordinate normalisation', () => {
  const box = { left: 100, top: 50, width: 800, height: 450 };

  it('maps client coordinates into 0..1 relative to the stage', () => {
    expect(normalisePoint(100, 50, box)).toEqual([0, 0]);
    expect(normalisePoint(900, 500, box)).toEqual([1, 1]);
    expect(normalisePoint(500, 275, box)).toEqual([0.5, 0.5]);
  });

  it('clamps points outside the stage', () => {
    expect(normalisePoint(0, 1000, box)).toEqual([0, 1]);
  });

  it('rounds to 4 decimals', () => {
    const [x, y] = normalisePoint(100 + 800 / 3, 50 + 450 / 7, box);
    expect(x).toBe(0.3333);
    expect(y).toBe(0.1429);
  });

  it('is safe for zero-size boxes', () => {
    expect(normalisePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual([0, 0]);
  });

  it('renders SVG points in a viewBox', () => {
    expect(toSvgPoints([[0, 0], [0.5, 0.25]], 1000, 1000)).toBe('0,0 500,250');
  });

  it('validates per zone type', () => {
    expect(validateZoneGeometry('ENTRY_LINE', [[0, 0], [1, 1]])).toBeNull();
    expect(validateZoneGeometry('ENTRY_LINE', [[0, 0]])).toMatch(/exactly 2/);
    expect(validateZoneGeometry('SECTION', [[0, 0], [1, 0]])).toMatch(/at least 3/);
    expect(validateZoneGeometry('SECTION', [[0, 0], [1, 0], [1, 1]])).toBeNull();
    expect(validateZoneGeometry('QUEUE', [[0, 0], [0.5, 0.5], [1, 1]])).toMatch(/too small/);
    expect(validateZoneGeometry('SECTION', [[0, 0], [2, 0], [1, 1]])).toMatch(/normalised/);
  });

  it('ENTRY_LINE keeps only the last two clicks', () => {
    let pts = addPoint('ENTRY_LINE', [], [0.1, 0.1]);
    pts = addPoint('ENTRY_LINE', pts, [0.2, 0.2]);
    pts = addPoint('ENTRY_LINE', pts, [0.3, 0.3]);
    expect(pts).toEqual([[0.2, 0.2], [0.3, 0.3]]);
    expect(addPoint('SECTION', [[0, 0]], [1, 1])).toHaveLength(2);
  });

  it('area, centroid and type guard', () => {
    expect(Math.abs(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]]))).toBe(1);
    expect(centroid([[0, 0], [1, 0], [1, 1], [0, 1]])).toEqual([0.5, 0.5]);
    expect(isNormalised([[0.1, 0.2]])).toBe(true);
    expect(isNormalised([[0.1]])).toBe(false);
  });
});
