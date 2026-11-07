/** Store-local time helpers built on Intl.DateTimeFormat (no external tz library). */
export const DEFAULT_TZ = 'Asia/Kolkata';

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    cache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  second: number;
  dow: number; // 0 = Sunday
}

export function localParts(d: Date, tz: string = DEFAULT_TZ): LocalParts {
  const parts = fmt(tz || DEFAULT_TZ).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const y = get('year');
  const m = get('month');
  const day = get('day');
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const date = `${y}-${m}-${day}`;
  return { date, hour, minute: Number(get('minute')), second: Number(get('second')), dow: dowOf(date) };
}

export const localDate = (d: Date, tz?: string) => localParts(d, tz).date;
export const todayLocal = (tz?: string) => localDate(new Date(), tz);

export function hhmm(d: Date, tz?: string): string {
  const p = localParts(d, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Offset (ms) of tz at instant t: local wall clock − UTC */
function tzOffset(t: number, tz: string): number {
  const p = localParts(new Date(t), tz);
  const [y, m, d] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute, p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Converts a store-local wall time to a UTC Date. */
export function zonedToUtc(date: string, time = '00:00', tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  let res = guess - tzOffset(guess, tz);
  const off2 = tzOffset(res, tz);
  if (guess - off2 !== res) res = guess - off2;
  return new Date(res);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function dowOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInclusive(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysInclusive(from, to);
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

export const minutesOfDay = (t: string): number => {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** A real calendar date "YYYY-MM-DD" (2026-02-30 is rejected: Date.parse would roll it over to March). */
export const isDateStr = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

export const round = (v: number, dp = 2): number => {
  if (!isFinite(v)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
};

export const pct = (a: number, b: number, dp = 2): number => (b > 0 ? round((a / b) * 100, dp) : 0);
export const safeDiv = (a: number, b: number, dp = 2): number => (b > 0 ? round(a / b, dp) : 0);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Human store-local stamp for messages shown to users: "05 Oct, 10:11 pm" (never a raw ISO string). */
export function localStamp(d: Date, tz?: string): string {
  const p = localParts(d, tz);
  const [, m, day] = p.date.split('-');
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${day} ${MONTHS[Number(m) - 1]}, ${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`;
}
