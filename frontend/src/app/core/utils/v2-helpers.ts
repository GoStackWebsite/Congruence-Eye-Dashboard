import { AiManagerType, ChecklistSchedule, ParamValue, TrafficDensity } from '../models/api.models';
import { hourLabel } from './dates';

// ---------- Traffic density (hour rows × Mon..Sun columns) ----------

/** Monday-first column order used by the density table (dow 0 = Sunday in the API). */
export const DENSITY_DOWS = [1, 2, 3, 4, 5, 6, 0];
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Blue sequential ramp (light → dark), 7 steps — Tango-style density shading. */
export const DENSITY_RAMP = ['#EFF8FF', '#D1E9FF', '#B2DDFF', '#84CAFF', '#53B1FD', '#1570EF', '#194185'];

export interface DensityRow {
  hour: number;
  label: string;
  cells: { dow: number; value: number; bg: string; fg: string }[];
  total: number;
}

export function densityColor(value: number, max: number): { bg: string; fg: string } {
  if (!max || value <= 0) return { bg: DENSITY_RAMP[0], fg: '#667085' };
  const idx = Math.min(DENSITY_RAMP.length - 1, Math.max(1, Math.ceil((value / max) * (DENSITY_RAMP.length - 1))));
  return { bg: DENSITY_RAMP[idx], fg: idx >= 5 ? '#ffffff' : '#0b0b0b' };
}

export function densityMatrix(d: TrafficDensity | null | undefined): DensityRow[] {
  if (!d) return [];
  const map = new Map<string, number>();
  for (const c of d.cells) map.set(`${c.hour}:${c.dow}`, c.avgFootfall);
  const hours = d.hours?.length ? [...d.hours].sort((a, b) => a - b) : [...new Set(d.cells.map((c) => c.hour))].sort((a, b) => a - b);
  const max = d.max || Math.max(0, ...d.cells.map((c) => c.avgFootfall));
  return hours.map((hour) => {
    const cells = DENSITY_DOWS.map((dow) => {
      const value = map.get(`${hour}:${dow}`) ?? 0;
      return { dow, value, ...densityColor(value, max) };
    });
    return { hour, label: `${hourLabel(hour)} – ${hourLabel(hour + 1)}`, cells, total: cells.reduce((s, c) => s + c.value, 0) };
  });
}

// ---------- AI Manager ----------

export const AI_TYPE_INFO: Record<AiManagerType, { label: string; icon: string; desc: string }> = {
  MOBILE_USAGE: { label: 'Mobile phone usage', icon: 'phone_android', desc: 'Staff using a phone on the floor' },
  UNATTENDED_CUSTOMER: { label: 'Unattended customer', icon: 'person_alert', desc: 'Customer waiting with no staff nearby' },
  STORE_OPEN_CLOSE: { label: 'Store open / close', icon: 'door_open', desc: 'Opening and closing on time, with snaps' },
  HYGIENE_CLEANING: { label: 'Hygiene (cleaning & mopping)', icon: 'cleaning_services', desc: 'Floor coverage by cleaning staff in the window' },
  HUDDLE_MEETING: { label: 'Huddle meeting', icon: 'groups', desc: 'Staff huddle held in the window' },
  UNIFORM_COMPLIANCE: { label: 'Uniform compliance', icon: 'checkroom', desc: 'Staff in uniform with name badge' },
  STOCK_OUT: { label: 'Stock-out (shelf empty)', icon: 'inventory_2', desc: 'Shelf zone empty beyond threshold' },
  QUEUE_BREACH: { label: 'Queue breach', icon: 'queue', desc: 'Billing queue longer than allowed' },
};

/** Default params per detection type (API_CONTRACT_V2.md). */
export const AI_PARAM_DEFAULTS: Record<AiManagerType, Record<string, ParamValue>> = {
  MOBILE_USAGE: { minDurationSec: 20, staffOnly: true },
  UNATTENDED_CUSTOMER: { minDurationSec: 120, staffRadius: 0.15 },
  STORE_OPEN_CLOSE: { toleranceMin: 10 },
  HYGIENE_CLEANING: { minCoveragePct: 60 },
  HUDDLE_MEETING: { minPeople: 3, minDurationMin: 5, radius: 0.2 },
  UNIFORM_COMPLIANCE: { minNonCompliantSec: 60 },
  STOCK_OUT: { emptyPct: 70 },
  QUEUE_BREACH: { maxQueue: 5 },
};

export const AI_PARAM_LABELS: Record<string, string> = {
  minDurationSec: 'Minimum duration (s)',
  staffOnly: 'Staff only',
  staffRadius: 'Staff radius (0–1 of frame)',
  toleranceMin: 'Tolerance (min)',
  minCoveragePct: 'Minimum floor coverage (%)',
  minPeople: 'Minimum people',
  minDurationMin: 'Minimum duration (min)',
  radius: 'Gathering radius (0–1 of frame)',
  minNonCompliantSec: 'Non-compliant for (s)',
  emptyPct: 'Shelf empty threshold (%)',
  maxQueue: 'Maximum queue length',
};

/** Keeps only the params known for the type, filling defaults and coercing value types to the default's type. */
export function normaliseAiParams(type: AiManagerType, params: Record<string, unknown> | null | undefined): Record<string, ParamValue> {
  const defs = AI_PARAM_DEFAULTS[type] ?? {};
  const out: Record<string, ParamValue> = {};
  for (const [k, def] of Object.entries(defs)) {
    const v = params?.[k];
    if (v === undefined || v === null || v === '') {
      out[k] = def;
    } else if (typeof def === 'boolean') {
      out[k] = v === true || v === 'true';
    } else if (typeof def === 'number') {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : def;
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function daysLabel(days: number[] | null | undefined): string {
  const d = [...new Set(days ?? [])].sort();
  if (!d.length || d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '0,6') return 'Weekends';
  return [...d].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((x) => DOW_SHORT[x]).join(', ');
}

// ---------- Schedules ----------

export function scheduleSummary(s: Pick<ChecklistSchedule, 'frequency' | 'repeatEvery' | 'daysOfWeek' | 'dayOfMonth' | 'windowStart' | 'windowEnd'>): string {
  const n = Math.max(1, Number(s.repeatEvery) || 1);
  let base: string;
  switch (s.frequency) {
    case 'ONCE':
      base = 'Once';
      break;
    case 'DAILY':
      base = n === 1 ? 'Daily' : `Every ${n} days`;
      break;
    case 'WEEKLY':
      base = `${n === 1 ? 'Weekly' : `Every ${n} weeks`} on ${daysLabel(s.daysOfWeek)}`;
      break;
    case 'MONTHLY':
      base = `${n === 1 ? 'Monthly' : `Every ${n} months`}${s.dayOfMonth ? ` on day ${s.dayOfMonth}` : ''}`;
      break;
    default:
      base = s.frequency;
  }
  return `${base} · ${s.windowStart}–${s.windowEnd}`;
}

/** Returns validation errors for a schedule form. */
export function validateSchedule(s: {
  templateId: number | null;
  storeIds: number[];
  frequency: string;
  daysOfWeek: number[];
  windowStart: string;
  windowEnd: string;
  startDate: string;
  endDate: string | null;
  repeatEvery: number;
}): string[] {
  const e: string[] = [];
  if (!s.templateId) e.push('Choose a checklist');
  if (!s.storeIds.length) e.push('Choose at least one store');
  if (s.frequency === 'WEEKLY' && !s.daysOfWeek.length) e.push('Pick at least one day of the week');
  if (!(Number(s.repeatEvery) >= 1)) e.push('Repeat every must be 1 or more');
  if (!/^\d{2}:\d{2}$/.test(s.windowStart) || !/^\d{2}:\d{2}$/.test(s.windowEnd)) e.push('Window times must be HH:mm');
  else if (s.windowStart >= s.windowEnd) e.push('Window end must be after window start');
  if (!s.startDate) e.push('Start date is required');
  if (s.endDate && s.startDate && s.endDate < s.startDate) e.push('End date must be on or after the start date');
  return e;
}

// ---------- Notifications ----------

export type NotificationKind = 'alert' | 'ai-breach' | 'reminder' | 'overdue' | 'other';

export function notificationKind(n: { title: string; link: string | null }): NotificationKind {
  const link = n.link ?? '';
  if (link.startsWith('/ai-manager')) return 'ai-breach';
  if (link.startsWith('/checklists/assignments') || link.startsWith('/checklists/fill')) {
    return /overdue/i.test(n.title) ? 'overdue' : 'reminder';
  }
  if (link.startsWith('/alerts')) return 'alert';
  return 'other';
}

export const NOTIFICATION_ICON: Record<NotificationKind, string> = {
  alert: 'notifications_active',
  'ai-breach': 'smart_toy',
  reminder: 'alarm',
  overdue: 'assignment_late',
  other: 'info',
};

/** Normalises a backend notification link into an in-app URL (strips origins, keeps query). */
export function resolveNotificationLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const stripped = link.replace(/^https?:\/\/[^/]+/, '');
  return stripped.startsWith('/') ? stripped : '/' + stripped;
}
