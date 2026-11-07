import { HttpParams } from '@angular/common/http';

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];
export type QueryObject = Record<string, QueryValue>;

/**
 * Converts a plain object into a flat record of query-string values following the
 * API contract conventions:
 *  - null / undefined / '' are dropped
 *  - arrays are comma-joined (`storeIds=1,2,3`); empty arrays are dropped
 *  - booleans: `true` → 'true'; `false` is dropped unless keepFalse is set
 *    (e.g. `compare=false` is the server default anyway)
 */
export function toQueryRecord(obj: QueryObject | undefined | null, keepFalse = false): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj) return out;
  for (const [key, raw] of Object.entries(obj)) {
    if (raw === null || raw === undefined) continue;
    if (Array.isArray(raw)) {
      const parts = raw.filter((v) => v !== null && v !== undefined && `${v}` !== '');
      if (parts.length) out[key] = parts.join(',');
      continue;
    }
    if (typeof raw === 'boolean') {
      if (raw || keepFalse) out[key] = String(raw);
      continue;
    }
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) out[key] = String(raw);
      continue;
    }
    const s = String(raw).trim();
    if (s !== '') out[key] = s;
  }
  return out;
}

export function buildHttpParams(obj?: QueryObject | null): HttpParams {
  return new HttpParams({ fromObject: toQueryRecord(obj) });
}

export function buildQueryString(obj?: QueryObject | null): string {
  const rec = toQueryRecord(obj);
  const keys = Object.keys(rec);
  if (!keys.length) return '';
  return '?' + keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(rec[k])}`).join('&');
}
