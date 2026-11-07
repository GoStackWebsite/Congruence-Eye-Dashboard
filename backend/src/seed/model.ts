import { addDays, daysInclusive, dowOf, minutesOfDay } from '../common/time.util';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { Staff } from '../modules/staff/entities/staff.entity';
import { Zone } from '../modules/zones/entities/zone.entity';
import { DIWALI, SectionDef, StoreDef } from './catalog';
import { Rng } from './rng';

export interface SeedStore {
  id: number;
  def: StoreDef;
  tz: string;
  entrance: Camera;
  floors: Camera[];
  billing: Camera;
  entryLine: Zone;
  sections: { zone: Zone; def: SectionDef }[];
  queues: Zone[];
  staffArea: Zone;
  staff: Staff[];
}

const HOUR_PROFILE: Record<number, number> = { 9: 0.3, 10: 0.45, 11: 0.6, 12: 0.8, 13: 0.95, 14: 0.85, 15: 0.8, 16: 0.9, 17: 1.1, 18: 1.4, 19: 1.5, 20: 1.3, 21: 0.8, 22: 0.5 };

/** Open hours with the fraction of each hour the store is open. */
export function openHours(def: StoreDef): { hour: number; frac: number; startMin: number; endMin: number }[] {
  const o = minutesOfDay(def.openTime);
  const c = minutesOfDay(def.closeTime);
  const out: { hour: number; frac: number; startMin: number; endMin: number }[] = [];
  for (let h = Math.floor(o / 60); h * 60 < c; h++) {
    const a = Math.max(o, h * 60);
    const b = Math.min(c, h * 60 + 60);
    if (b > a) out.push({ hour: h, frac: (b - a) / 60, startMin: a, endMin: b });
  }
  return out;
}

/** Share of the daily footfall arriving in each open hour (sums to 1). */
export function hourShares(def: StoreDef): Map<number, number> {
  const hs = openHours(def);
  const raw = hs.map((h) => (HOUR_PROFILE[h.hour] ?? 0.4) * h.frac);
  const total = raw.reduce((a, b) => a + b, 0);
  return new Map(hs.map((h, i) => [h.hour, raw[i] / total]));
}

export function festiveFactor(date: string): number {
  const md = date.slice(5);
  let f = 1;
  if (md >= '07-17' && md <= '08-16') f *= 1.3; // Aadi sale
  if (md >= '12-20' || md <= '01-01') f *= 1.25;
  if (md >= '01-11' && md <= '01-17') f *= 1.5; // Pongal
  for (const d of DIWALI) {
    const diff = daysInclusive(date, d) - 1; // days until Diwali
    if (diff >= 0 && diff <= 45) f *= 1 + 0.9 * (1 - diff / 45);
    else if (diff < 0 && diff >= -3) f *= 0.8;
  }
  if (['2026-09-13', '2026-09-14', '2025-08-27', '2027-09-04'].includes(date)) f *= 1.2; // Vinayagar Chathurthi
  return f;
}

export function dayFactor(date: string): number {
  const dow = dowOf(date);
  const d = [1.45, 0.85, 0.92, 0.95, 0.97, 1.1, 1.4][dow];
  return d * festiveFactor(date);
}

export const baseDailyFootfall = (def: StoreDef) => 150 + def.areaSqft * 0.11;

/** Integer split of `total` by probabilities (largest remainder). */
export function split(total: number, probs: number[], rng: Rng, noise = 0.15): number[] {
  const w = probs.map((p) => p * rng.jitter(noise));
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (x / sum) * total);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as [number, number]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}

export function amountFor(rng: Rng, atv: number): number {
  const v = Math.exp(rng.normal(Math.log(atv) - 0.15, 0.55));
  const a = Math.max(149, Math.min(atv * 8, v));
  return rng.chance(0.6) ? Math.round(a / 10) * 10 - 1 : Math.round(a);
}

export function dateRange(today: string, days: number): string[] {
  const out: string[] = [];
  for (let i = days; i >= 1; i--) out.push(addDays(today, -i));
  return out;
}
