/**
 * Pure helpers for the in-browser demo backend (no Angular dependencies → easy to unit test).
 */

export type PresetKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth';

const DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date YYYY-MM-DD. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function utcDays(iso: string): number {
  const m = DATE_RE.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY;
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(utcDays(b) - utcDays(a));
}

export function shiftDate(iso: string, days: number): string {
  const t = utcDays(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date((t + days) * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function shiftTimestamp(iso: string, days: number): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + days * DAY).toISOString();
}

export function shiftTimestampMs(iso: string, ms: number): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + ms).toISOString();
}

/**
 * Deeply shifts every full-string date (YYYY-MM-DD) by `days` and every ISO timestamp by `timestampMs`
 * (default: the same number of days; the demo uses the exact time elapsed since capture so relative
 * times like "2 h ago" stay as captured).
 * Other strings (URLs, names, HH:mm …) are untouched. Returns a new structure.
 */
export function shiftDeep<T>(value: T, days: number, timestampMs: number = days * DAY): T {
  if (!days && !timestampMs) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.length === 10 && DATE_RE.test(v)) return shiftDate(v, days);
      if (v.length >= 16 && v.length <= 35 && ISO_RE.test(v)) return shiftTimestampMs(v, timestampMs);
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * Maps an analytics date range (relative to `today`) to the closest captured preset:
 * exact matches for Today / Yesterday / Last 7 / Last 30 / This month, otherwise the
 * preset whose length is nearest (custom ranges).
 */
export function presetFor(from: string | null | undefined, to: string | null | undefined, today: string, thisMonthCapturedLen = 30): PresetKey {
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return 'last7';
  const len = daysBetween(from, to) + 1;
  const off = daysBetween(to, today);
  if (len === 1 && off === 0) return 'today';
  if (len === 1 && off === 1) return 'yesterday';
  if (off === 0 && from.endsWith('-01') && from.slice(0, 7) === today.slice(0, 7) && len > 1) return 'thisMonth';
  if (len === 7 && off === 0) return 'last7';
  if (len === 30 && off === 0) return 'last30';
  const candidates: [PresetKey, number][] = [
    ['today', 1],
    ['last7', 7],
    ['thisMonth', thisMonthCapturedLen],
    ['last30', 30],
  ];
  return candidates.reduce((best, c) => (Math.abs(c[1] - len) < Math.abs(best[1] - len) ? c : best))[0];
}

/** Scope key for captured analytics: one store id, or 'all' (no filter / several stores). */
export function scopeKey(storeIds: number[] | null | undefined, userScope: number[] | null, allStoreIds: number[]): string {
  const ids = storeIds?.length ? storeIds : userScope ?? [];
  const valid = ids.filter((id) => allStoreIds.includes(id));
  return valid.length === 1 ? String(valid[0]) : 'all';
}

export function parseIds(v: string | null | undefined): number[] {
  if (!v) return [];
  return v
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginate<T>(items: T[], page: unknown, pageSize: unknown, defaultSize = 25): PagedResult<T> {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(500, Math.max(1, Number(pageSize) || defaultSize));
  return { items: items.slice((p - 1) * s, p * s), total: items.length, page: p, pageSize: s };
}

/** True when the local calendar date of `ts` (ISO timestamp or date) falls within [from, to]. */
export function inDateRange(ts: string | null | undefined, from: string | null | undefined, to: string | null | undefined): boolean {
  if (!ts) return false;
  const d = DATE_RE.test(ts) ? ts : localIsoDate(new Date(ts));
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// ---------- fake JWT ----------
const b64url = (s: string) => btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function makeDemoToken(userId: number, now = Date.now()): string {
  const payload = { sub: userId, demo: true, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 30 * 86400 };
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.demo`;
}

export function readDemoToken(authHeader: string | null | undefined): number | null {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)));
    return typeof json.sub === 'number' ? json.sub : null;
  } catch {
    return null;
  }
}

// ---------- CSV ----------
export function toCsvText(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length >= maxRows) return rows;
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Decodes a data: URL into a Blob without a network request. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(5, comma);
  const mime = header.split(';')[0] || 'application/octet-stream';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Stable small hash (for deterministic demo choices). */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
