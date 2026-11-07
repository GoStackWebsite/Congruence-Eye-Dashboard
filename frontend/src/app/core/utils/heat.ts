/**
 * Single-hue sequential ramp (blue, light → dark) for heatmap magnitude.
 * Zero cells are fully transparent so the camera snapshot shows through.
 */
export const HEAT_RAMP = ['#B2DDFF', '#84CAFF', '#53B1FD', '#2E90FA', '#1570EF', '#175CD3', '#194185'];

/**
 * Concentration heatmap spectrum (DESIGN_SYSTEM.md): violet → blue → cyan → yellow → orange → red; cells below the
 * threshold stay transparent so the camera snapshot shows through.
 */
export const HEAT_SPECTRUM = ['#7A5AF8', '#2E90FA', '#36BFFA', '#FDE047', '#F97316', '#DC2626'];

/** rgba() for value v on the spectrum (linear interpolation between stops); null below `threshold` (0–1 of max). */
export function spectrumColor(v: number, max: number, alpha = 0.75, threshold = 0.08): string | null {
  if (!max || max <= 0 || !v || v <= 0) return null;
  const t = Math.min(1, v / max);
  if (t < threshold) return null;
  const pos = t * (HEAT_SPECTRUM.length - 1);
  const i = Math.min(HEAT_SPECTRUM.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(HEAT_SPECTRUM[i]);
  const b = hexToRgb(HEAT_SPECTRUM[i + 1]);
  const mix = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgba(${mix(0)},${mix(1)},${mix(2)},${alpha})`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Returns an rgba() colour for value v in [0,max]; null for zero/empty cells. */
export function heatColor(v: number, max: number, alpha = 0.72): string | null {
  if (!max || max <= 0 || !v || v <= 0) return null;
  const t = Math.min(1, v / max);
  const idx = Math.min(HEAT_RAMP.length - 1, Math.floor(t * HEAT_RAMP.length));
  const [r, g, b] = hexToRgb(HEAT_RAMP[idx]);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Grid cell index lookup; returns 0 for out-of-range. */
export function cellValue(grid: number[], width: number, x: number, y: number): number {
  const i = y * width + x;
  return i >= 0 && i < grid.length ? grid[i] || 0 : 0;
}
