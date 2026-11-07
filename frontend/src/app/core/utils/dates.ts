export type RangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

const pad = (n: number) => (n < 10 ? '0' + n : '' + n);

/** Formats a Date as local YYYY-MM-DD (never via toISOString, which shifts to UTC). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses YYYY-MM-DD as a local date (midnight). */
export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + days);
  return r;
}

export function isValidIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseIsoDate(s).getTime());
}

/** Inclusive number of days in a range. */
export function daysInRange(r: DateRange): number {
  const ms = parseIsoDate(r.to).getTime() - parseIsoDate(r.from).getTime();
  return Math.round(ms / 86400000) + 1;
}

/** Computes the date range for a preset relative to `today` (local). */
export function rangeForPreset(preset: RangePreset, today: Date = new Date(), custom?: DateRange): DateRange {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (preset) {
    case 'today':
      return { from: toIsoDate(t), to: toIsoDate(t) };
    case 'yesterday': {
      const y = addDays(t, -1);
      return { from: toIsoDate(y), to: toIsoDate(y) };
    }
    case 'last7':
      return { from: toIsoDate(addDays(t, -6)), to: toIsoDate(t) };
    case 'last30':
      return { from: toIsoDate(addDays(t, -29)), to: toIsoDate(t) };
    case 'thisMonth':
      return { from: toIsoDate(new Date(t.getFullYear(), t.getMonth(), 1)), to: toIsoDate(t) };
    case 'custom':
    default:
      if (custom && isValidIsoDate(custom.from) && isValidIsoDate(custom.to)) {
        return custom.from <= custom.to ? { ...custom } : { from: custom.to, to: custom.from };
      }
      return { from: toIsoDate(addDays(t, -6)), to: toIsoDate(t) };
  }
}

/** The equally long period immediately before `r` (what the backend uses for compare=true). */
export function previousPeriod(r: DateRange): DateRange {
  const len = daysInRange(r);
  const prevTo = addDays(parseIsoDate(r.from), -1);
  return { from: toIsoDate(addDays(prevTo, -(len - 1))), to: toIsoDate(prevTo) };
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dowLabel(dow: number): string {
  return DOW[((dow % 7) + 7) % 7];
}

export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${suffix}`;
}

/** "12 Mar" style label from YYYY-MM-DD. */
export function shortDate(s: string): string {
  if (isValidIsoDate(s)) return parseIsoDate(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  // full ISO timestamp (2026-10-05T15:52:14.000Z) → the store-local calendar day
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: STORE_TZ });
  }
  return s;
}

/** Converts a datetime-local input value (YYYY-MM-DDTHH:mm, local) to ISO UTC. */
export function localInputToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Converts an ISO timestamp to a datetime-local input value. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${toIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** All Congruence stores are in Chennai; store-local labels and inputs use this zone unless a store says otherwise. */
export const STORE_TZ = 'Asia/Kolkata';


function parts(d: Date, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

/** Offset of `tz` from UTC at instant `d`, in minutes (IST → 330). */
export function tzOffsetMin(d: Date, tz: string = STORE_TZ): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(+p['year'], +p['month'] - 1, +p['day'], +p['hour'] % 24, +p['minute'], +p['second']);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** datetime-local value (YYYY-MM-DDTHH:mm) interpreted in the store's zone → ISO UTC; '' / invalid → null. */
export function zonedInputToIso(v: string | null | undefined, tz: string = STORE_TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v ?? '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = tzOffsetMin(new Date(guess), tz);
  let ts = guess - off * 60000;
  // DST-safe second pass (no-op for IST)
  const off2 = tzOffsetMin(new Date(ts), tz);
  if (off2 !== off) ts = guess - off2 * 60000;
  return new Date(ts).toISOString();
}

/** ISO UTC → datetime-local value in the store's zone. */
export function isoToZonedInput(iso: string | null | undefined, tz: string = STORE_TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = parts(d, tz);
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}`;
}


/** Replaces raw ISO timestamps inside server text ("offline since 2026-10-05T22:11:00.908Z") with store time ("05 Oct, 3:41 am"). */
export function localizeTimestamps(text: string | null | undefined, tz: string = STORE_TZ): string {
  return (text ?? '').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { timeZone: tz, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  });
}
