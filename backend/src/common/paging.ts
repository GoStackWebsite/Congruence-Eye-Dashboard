export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export function parsePaging(q: { page?: unknown; pageSize?: unknown }) {
  let page = parseInt(String(q.page ?? '1'), 10);
  let pageSize = parseInt(String(q.pageSize ?? '25'), 10);
  if (!isFinite(page) || page < 1) page = 1;
  if (!isFinite(pageSize) || pageSize < 1) pageSize = 25;
  if (pageSize > 500) pageSize = 500;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
export function parseIds(v: unknown): number[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  // ids outside the SQL Server int range are dropped (they cannot exist and would fail the query)
  const ids = arr.map((x) => parseInt(String(x).trim(), 10)).filter((n) => isFinite(n) && n > 0 && n <= 2147483647);
  return ids;
}
export function parseIntOpt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseInt(String(Array.isArray(v) ? v[0] : v), 10);
  return isFinite(n) && Math.abs(n) <= 2147483647 ? n : undefined;
}
/** First value of a query parameter as a string (repeated keys arrive as arrays). */
export const qstr = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v === undefined || v === null ? '' : String(v));
export const parseBool = (v: unknown) => v === true || v === 'true' || v === '1';
