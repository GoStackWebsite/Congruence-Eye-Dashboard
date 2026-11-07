const inrFull = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const num1Fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * INR currency with Indian (lakh/crore) digit grouping.
 *  - default: ₹12,34,567
 *  - 'paise': ₹12,34,567.50
 *  - 'compact': ₹12.3 L / ₹4.56 Cr / ₹12.5 K
 */
export function formatInr(value: number | null | undefined, mode: 'full' | 'paise' | 'compact' = 'full'): string {
  if (!isNum(value)) return '--';
  if (mode === 'paise') return inrPaise.format(value);
  if (mode === 'compact') {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7, 2)} Cr`;
    if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5, 2)} L`;
    if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3, 1)} K`;
    return inrFull.format(value);
  }
  return inrFull.format(value);
}

function trim(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

/** Integer with en-IN grouping: 1234567 → 12,34,567 */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (!isNum(value)) return '--';
  return decimals === 1 ? num1Fmt.format(value) : decimals > 1 ? value.toFixed(decimals) : numFmt.format(value);
}

export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (!isNum(value)) return '--';
  return `${value.toFixed(decimals)}%`;
}

/** Seconds → "45s", "3m 20s", "1h 05m" */
export function formatDuration(sec: number | null | undefined): string {
  if (!isNum(sec)) return '--';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!isNum(bytes)) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "QUEUE_LENGTH" → "Queue length" */
export function humanize(v: string | null | undefined): string {
  if (!v) return '';
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function errorMessage(err: unknown): string {
  const e = err as { error?: { message?: string | string[] }; message?: string; status?: number };
  const m = e?.error?.message;
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string' && m) return m;
  if (e?.status === 0) return 'Cannot reach the server. Check your connection.';
  return e?.message || 'Something went wrong';
}
