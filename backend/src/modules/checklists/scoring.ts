/** Checklist scoring rules (API_CONTRACT.md "Scoring"). */
export interface ScorableQuestion {
  type: string;
  weight: number;
  correctOptions?: string[] | null;
  minValue?: number | null;
  maxValue?: number | null;
}

/** Normalises any answer payload to the stored string form (MCQ_MULTI → JSON array string). */
export function normaliseValue(type: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (type === 'MCQ_MULTI') {
    if (Array.isArray(value)) return JSON.stringify(value.map(String));
    const s = String(value).trim();
    if (!s) return null;
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return JSON.stringify(arr.map(String));
    } catch {
      /* comma separated fallback */
    }
    return JSON.stringify(s.split(',').map((x) => x.trim()).filter(Boolean));
  }
  if (type === 'YES_NO' && typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (Array.isArray(value)) return JSON.stringify(value);
  const s = String(value);
  return s.trim() === '' ? null : s;
}

export function isAnswered(type: string, value: string | null, photoUrl?: string | null): boolean {
  if (type === 'PHOTO' || type === 'VIDEO') return !!(photoUrl && photoUrl.trim()) || !!(value && value.trim());
  if (type === 'MCQ_MULTI') {
    try {
      return Array.isArray(JSON.parse(value ?? '')) && JSON.parse(value).length > 0;
    } catch {
      return false;
    }
  }
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export function scoreAnswer(q: ScorableQuestion, value: string | null, photoUrl?: string | null): number {
  const w = Number(q.weight ?? 1);
  if (!isAnswered(q.type, value, photoUrl)) return 0;
  const correct = (q.correctOptions ?? []).map(String);
  switch (q.type) {
    case 'YES_NO':
      return String(value).trim().toUpperCase() === 'YES' ? w : 0;
    case 'MCQ_SINGLE':
      return !correct.length || correct.includes(String(value)) ? w : 0;
    case 'MCQ_MULTI': {
      if (!correct.length) return w;
      const chosen = new Set<string>(JSON.parse(value).map(String));
      return chosen.size === correct.length && correct.every((c) => chosen.has(c)) ? w : 0;
    }
    case 'RATING': {
      const v = Math.max(0, Math.min(5, Number(value)));
      return isFinite(v) ? Math.round((v / 5) * w * 100) / 100 : 0;
    }
    case 'NUMBER': {
      const v = Number(value);
      if (!isFinite(v)) return 0;
      if (q.minValue !== null && q.minValue !== undefined && v < q.minValue) return 0;
      if (q.maxValue !== null && q.maxValue !== undefined && v > q.maxValue) return 0;
      return w;
    }
    case 'TEXT':
    case 'PHOTO':
    case 'VIDEO':
      return w;
    default:
      return 0;
  }
}

/** Deviation flag: YES_NO answered NO, wrong MCQ, NUMBER out of range (AI FAIL is added by the caller). */
export function isFlagged(q: ScorableQuestion, value: string | null, photoUrl?: string | null): boolean {
  if (!isAnswered(q.type, value, photoUrl)) return false;
  switch (q.type) {
    case 'YES_NO':
      return String(value).trim().toUpperCase() !== 'YES';
    case 'MCQ_SINGLE':
    case 'MCQ_MULTI':
      return (q.correctOptions ?? []).length > 0 && scoreAnswer({ ...q, weight: 1 }, value, photoUrl) === 0;
    case 'NUMBER':
      return scoreAnswer({ ...q, weight: 1 }, value, photoUrl) === 0;
    default:
      return false;
  }
}
