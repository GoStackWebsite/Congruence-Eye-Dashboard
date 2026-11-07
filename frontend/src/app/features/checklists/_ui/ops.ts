/**
 * Shared helpers for the Trax / store-operations screens (checklists, tasks, tickets, documents, vendors).
 * Pure functions only — unit tested in ops.spec.ts. Candidates for promotion into core/utils or shared/ds.
 */
import type { CeColumn } from '../../../shared/ds';

export const MAX_UPLOAD_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * Phone stacked cards are built into ce-table (`mobileCards`, on by default: every cell carries its header as
 * `data-label`). This keeps the old call sites working: `hideOnPhone` columns are left out of the cards.
 */
export function withMobileLabels<T>(cols: CeColumn<T>[], hideOnPhone: string[] = []): CeColumn<T>[] {
  return cols.map((c) => (hideOnPhone.includes(c.key) ? { ...c, mobileHide: true } : c));
}

// ---------------------------------------------------------------- time
// (store-zone conversions live in core/utils/dates.ts; re-exported here for the Trax screens)
export { STORE_TZ, tzOffsetMin, zonedInputToIso, isoToZonedInput } from '../../../core/utils/dates';
import { STORE_TZ } from '../../../core/utils/dates';

/** "05 Oct, 6:30 pm" in the store's zone; null → '--'. */
export function storeDateTime(iso: string | null | undefined, tz: string = STORE_TZ): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-IN', { timeZone: tz, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** "05 Oct 2026" in the store's zone. */
export function storeDate(iso: string | null | undefined, tz: string = STORE_TZ): string {
  if (!iso) return '--';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-IN', { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : tz, day: '2-digit', month: 'short', year: 'numeric' });
}

/** "6:30 pm" in the store's zone. */
export function storeTime(iso: string | null | undefined, tz: string = STORE_TZ): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
}

/** "HH:mm" (24 h) → "9:30 AM". */
export function hm12(hm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm ?? '');
  if (!m) return '--';
  const h = +m[1];
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Compact duration: 45m, 3h 05m, 2d 4h. */
export function compactDuration(ms: number): string {
  const min = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${String(min % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export type DueTone = 'overdue' | 'soon' | 'ok' | 'done' | 'none';
export interface DueInfo {
  tone: DueTone;
  /** "Overdue by 2h 10m", "Due in 45m", "Due 08 Oct, 6:00 pm" */
  label: string;
}

/** Relative due label for open work; finished work never shows as overdue. */
export function dueInfo(dueIso: string | null | undefined, done: boolean, now = Date.now(), soonMs = 4 * 3600_000): DueInfo {
  if (!dueIso) return { tone: 'none', label: 'No due date' };
  const due = new Date(dueIso).getTime();
  if (isNaN(due)) return { tone: 'none', label: 'No due date' };
  if (done) return { tone: 'done', label: `Due ${storeDateTime(dueIso)}` };
  const diff = due - now;
  if (diff < 0) return { tone: 'overdue', label: `Overdue by ${compactDuration(diff)}` };
  if (diff <= soonMs) return { tone: 'soon', label: `Due in ${compactDuration(diff)}` };
  return { tone: 'ok', label: `Due ${storeDateTime(dueIso)}` };
}

/** SLA countdown for a ticket: remaining time, breach and a 0..100 "time used" fraction. */
export function slaInfo(
  t: { slaDueAt: string | null; createdAt: string; status: string; resolvedAt: string | null; isSlaBreached?: boolean },
  now = Date.now(),
): { state: 'none' | 'met' | 'breached' | 'at-risk' | 'on-track'; label: string; usedPct: number } {
  if (!t.slaDueAt) return { state: 'none', label: 'No SLA', usedPct: 0 };
  const due = new Date(t.slaDueAt).getTime();
  const start = new Date(t.createdAt).getTime();
  const closed = t.status === 'RESOLVED' || t.status === 'CLOSED';
  const end = t.resolvedAt ? new Date(t.resolvedAt).getTime() : closed ? due : now;
  const total = Math.max(1, due - start);
  const usedPct = Math.max(0, Math.min(100, ((end - start) / total) * 100));
  if (t.isSlaBreached || end > due) return { state: 'breached', label: closed ? `Breached by ${compactDuration(end - due)}` : `Breached ${compactDuration(end - due)} ago`, usedPct: 100 };
  if (closed) return { state: 'met', label: 'SLA met', usedPct };
  const left = due - now;
  return { state: usedPct >= 75 ? 'at-risk' : 'on-track', label: `${compactDuration(left)} left`, usedPct };
}

// ---------------------------------------------------------------- files

export interface FileRule {
  maxBytes?: number;
  /** MIME prefixes or exact types: ['image/', 'video/mp4'] */
  accept?: string[];
  label?: string;
}

/** Returns a user-facing error, or null when the file is acceptable. */
export function validateFile(f: { size: number; type: string; name?: string } | null | undefined, rule: FileRule = {}): string | null {
  if (!f) return 'Choose a file';
  const max = rule.maxBytes ?? MAX_UPLOAD_BYTES;
  if (!f.size) return 'The file is empty';
  if (f.size > max) return `File is too large (${(f.size / 1048576).toFixed(1)} MB). The limit is ${Math.round(max / 1048576)} MB.`;
  if (rule.accept?.length) {
    const t = (f.type || '').toLowerCase();
    const ok = rule.accept.some((a) => (a.endsWith('/') ? t.startsWith(a) : t === a));
    if (!ok) return `Unsupported file type${f.type ? ` (${f.type})` : ''}. ${rule.label ?? 'Choose a different file.'}`;
  }
  return null;
}

export const IMAGE_RULE: FileRule = { accept: ['image/jpeg', 'image/png', 'image/webp'], label: 'Use a JPG, PNG or WebP photo.' };
export const VIDEO_RULE: FileRule = { accept: ['video/mp4', 'video/webm', 'video/quicktime'], label: 'Use an MP4, WebM or MOV video.' };
export const PROOF_RULE: FileRule = { accept: [...IMAGE_RULE.accept!, ...VIDEO_RULE.accept!], label: 'Use a photo (JPG, PNG, WebP) or a video (MP4, WebM, MOV).' };

export interface FileKind {
  icon: string;
  label: string;
  tone: 'red' | 'blue' | 'green' | 'orange' | 'violet' | 'grey';
}

/** File-type icon + short label from MIME type / extension. */
export function fileKind(mime: string | null | undefined, name?: string | null): FileKind {
  const m = (mime ?? '').toLowerCase();
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (m.includes('pdf') || ext === 'pdf') return { icon: 'picture_as_pdf', label: 'PDF', tone: 'red' };
  if (m.startsWith('image/')) return { icon: 'image', label: (ext || 'IMG').toUpperCase(), tone: 'violet' };
  if (m.startsWith('video/')) return { icon: 'movie', label: 'Video', tone: 'violet' };
  if (/sheet|excel|csv/.test(m) || ['xlsx', 'xls', 'csv'].includes(ext)) return { icon: 'table_chart', label: ext ? ext.toUpperCase() : 'Sheet', tone: 'green' };
  if (/presentation|powerpoint/.test(m) || ['ppt', 'pptx'].includes(ext)) return { icon: 'slideshow', label: 'Slides', tone: 'orange' };
  if (/word|msword|document/.test(m) || ['doc', 'docx'].includes(ext)) return { icon: 'description', label: 'DOC', tone: 'blue' };
  if (m.startsWith('text/') || ext === 'txt') return { icon: 'article', label: 'TXT', tone: 'grey' };
  return { icon: 'draft', label: ext ? ext.toUpperCase() : 'File', tone: 'grey' };
}

/** Friendly enum labels for the ops screens (humanize() gives "Sop", "It"). */
export const OPS_LABELS: Record<string, string> = {
  SOP: 'SOP',
  IT: 'IT',
  CIRCULAR: 'Circular',
  PLANOGRAM: 'Planogram',
  TRAINING: 'Training',
  OTHER: 'Other',
  HOUSEKEEPING: 'Housekeeping',
  SECURITY: 'Security',
  MAINTENANCE: 'Maintenance',
  SUPPLIER: 'Supplier',
  INFRASTRUCTURE: 'Infrastructure',
  CAMERA: 'Camera',
  NETWORK: 'Network',
  VISUAL_MERCHANDISING: 'Visual merchandising',
  ZONE_ALLOCATION: 'Zone allocation',
  FOLLOW_UP: 'Follow-up',
  GENERAL: 'General',
};
export function opsLabel(v: string | null | undefined): string {
  if (!v) return '';
  return OPS_LABELS[v] ?? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
}

export const TICKET_CATEGORY_ICON: Record<string, string> = {
  PLANOGRAM: 'view_quilt',
  INFRASTRUCTURE: 'domain',
  CAMERA: 'videocam',
  NETWORK: 'lan',
  MAINTENANCE: 'handyman',
  OTHER: 'help',
};
export const VENDOR_CATEGORY_ICON: Record<string, string> = {
  HOUSEKEEPING: 'cleaning_services',
  SECURITY: 'shield_person',
  MAINTENANCE: 'handyman',
  IT: 'computer',
  SUPPLIER: 'local_shipping',
  OTHER: 'storefront',
};
export const QUESTION_TYPE_META: Record<string, { icon: string; label: string; hint: string }> = {
  YES_NO: { icon: 'thumbs_up_down', label: 'Yes / No', hint: 'Two big buttons' },
  MCQ_SINGLE: { icon: 'radio_button_checked', label: 'Single choice', hint: 'Pick one option' },
  MCQ_MULTI: { icon: 'check_box', label: 'Multiple choice', hint: 'Pick several options' },
  TEXT: { icon: 'notes', label: 'Text', hint: 'Free-text answer' },
  NUMBER: { icon: 'pin', label: 'Number', hint: 'Value with an expected range' },
  RATING: { icon: 'star', label: 'Rating', hint: '1 to 5 stars' },
  PHOTO: { icon: 'photo_camera', label: 'Photo', hint: 'Camera capture, optional AI check' },
  VIDEO: { icon: 'videocam', label: 'Video', hint: 'Short clip as evidence' },
};

/** Builder-side checks the template validator doesn't cover (inline, per question). */
export function questionIssues(q: { text?: string; type: string; weight: unknown; options?: string[]; minValue?: unknown; maxValue?: unknown }): Record<string, string> {
  const e: Record<string, string> = {};
  if (!String(q.text ?? '').trim()) e['text'] = 'Write the question';
  const w = Number(q.weight);
  if (q.weight === '' || q.weight === null || q.weight === undefined || !Number.isFinite(w) || w <= 0) e['weight'] = 'Weight must be greater than 0';
  if ((q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI') && (q.options ?? []).length < 2) e['options'] = 'Add at least 2 options';
  const has = (v: unknown) => v !== null && v !== undefined && v !== '';
  if (q.type === 'NUMBER' && has(q.minValue) && has(q.maxValue) && Number(q.minValue) > Number(q.maxValue)) e['range'] = 'Min must be less than or equal to max';
  return e;
}

/** "Occurs every 2 days starting 03 Jun 2026" (reference 06). */
export function occursSentence(s: { frequency: string; repeatEvery: number; daysOfWeek: number[]; dayOfMonth: number | null; startDate: string; endDate: string | null; windowStart: string; windowEnd: string }): string {
  const n = Math.max(1, Number(s.repeatEvery) || 1);
  const start = s.startDate ? storeDate(s.startDate) : '--';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...new Set(s.daysOfWeek ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => dow[d]);
  const at = `between ${hm12(s.windowStart)} and ${hm12(s.windowEnd)}`;
  let what: string;
  switch (s.frequency) {
    case 'ONCE':
      return `Occurs once on ${start}, ${at}`;
    case 'WEEKLY':
      what = `${n === 1 ? 'every week' : `every ${n} weeks`}${days.length ? ` on ${days.join(', ')}` : ''}`;
      break;
    case 'MONTHLY':
      what = `${n === 1 ? 'every month' : `every ${n} months`}${s.dayOfMonth ? ` on day ${s.dayOfMonth}` : ''}`;
      break;
    default:
      what = n === 1 ? 'every day' : `every ${n} days`;
  }
  return `Occurs ${what} starting ${start}${s.endDate ? ` until ${storeDate(s.endDate)}` : ''}, ${at}`;
}
