import { Question } from '../models/api.models';

export interface ScorePreview {
  score: number;
  maxScore: number;
  pct: number;
}

/** Parses an MCQ_MULTI answer value (JSON array string) into a string list. */
export function parseMulti(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Scores a single answer following the contract rules:
 *  YES_NO "YES" = full weight; MCQ_SINGLE/MULTI correct options = weight (any answer if no correctOptions);
 *  RATING value/5 × weight; NUMBER within [min,max] = weight; TEXT/PHOTO answered = weight.
 * Unanswered → 0.
 */
export function scoreAnswer(q: Question, value: string | null | undefined, photoUrl?: string | null): number {
  const w = Number(q.weight) || 0;
  const v = (value ?? '').toString().trim();
  switch (q.type) {
    case 'YES_NO':
      return v.toUpperCase() === 'YES' ? w : 0;
    case 'MCQ_SINGLE': {
      if (!v) return 0;
      const correct = q.correctOptions ?? [];
      return correct.length === 0 || correct.includes(v) ? w : 0;
    }
    case 'MCQ_MULTI': {
      const picked = parseMulti(v);
      if (!picked.length) return 0;
      const correct = q.correctOptions ?? [];
      return correct.length === 0 || sameSet(picked, correct) ? w : 0;
    }
    case 'RATING': {
      const n = Number(v);
      if (!v || !Number.isFinite(n)) return 0;
      return (Math.min(5, Math.max(0, n)) / 5) * w;
    }
    case 'NUMBER': {
      if (v === '') return 0;
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      const okMin = q.minValue === null || q.minValue === undefined || n >= q.minValue;
      const okMax = q.maxValue === null || q.maxValue === undefined || n <= q.maxValue;
      return okMin && okMax ? w : 0;
    }
    case 'PHOTO':
    case 'VIDEO':
      return v || photoUrl ? w : 0;
    case 'TEXT':
    default:
      return v ? w : 0;
  }
}

export function previewScore(
  questions: Question[],
  answers: Record<number, { value: string; photoUrl?: string | null } | undefined>,
): ScorePreview {
  let score = 0;
  let maxScore = 0;
  for (const q of questions) {
    const w = Number(q.weight) || 0;
    maxScore += w;
    const a = q.id !== undefined ? answers[q.id] : undefined;
    score += a ? scoreAnswer(q, a.value, a.photoUrl) : 0;
  }
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  return { score: Math.round(score * 100) / 100, maxScore, pct };
}

/** Returns the questions that are required (or need a photo) but not answered. */
export function missingRequired(
  questions: Question[],
  answers: Record<number, { value: string; photoUrl?: string | null } | undefined>,
): Question[] {
  return questions.filter((q) => {
    if (q.id === undefined) return false;
    const a = answers[q.id];
    const v = (a?.value ?? '').trim();
    const answered = q.type === 'MCQ_MULTI' ? parseMulti(v).length > 0 : q.type === 'PHOTO' ? !!(v || a?.photoUrl) : v !== '';
    // VIDEO: the answer value is the uploaded video url
    if (q.required && !answered) return true;
    // VIDEO: "requiresPhoto" means "media required" and is satisfied by the uploaded video (value)
    if (q.requiresPhoto && q.type !== 'VIDEO' && !a?.photoUrl) return true;
    if (q.requiresPhoto && q.type === 'VIDEO' && !v) return true;
    return false;
  });
}

/** Groups questions by section while preserving sortOrder. */
export function groupBySection<T extends Pick<Question, 'section' | 'sortOrder'>>(questions: T[]): { section: string; questions: T[] }[] {
  const sorted = [...questions].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const map = new Map<string, T[]>();
  for (const q of sorted) {
    const key = q.section || 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(q);
  }
  return [...map.entries()].map(([section, qs]) => ({ section, questions: qs }));
}

/**
 * Contract v4 answer validation (`400` before scoring): `{ message, missingQuestionIds }` or
 * `{ message, invalidAnswers: [{ questionId, reason }] }` → question id → message to show on that question.
 * Null when the error is not an answer-validation error.
 */
export function serverAnswerIssues(err: unknown): { message: string; byQuestion: Record<number, string> } | null {
  const e = err as { status?: number; error?: { message?: unknown; missingQuestionIds?: unknown; invalidAnswers?: unknown } };
  if (e?.status !== 400 || !e.error || typeof e.error !== 'object') return null;
  const byQuestion: Record<number, string> = {};
  if (Array.isArray(e.error.missingQuestionIds)) for (const id of e.error.missingQuestionIds) if (typeof id === 'number') byQuestion[id] = 'Required: this question needs an answer';
  if (Array.isArray(e.error.invalidAnswers))
    for (const x of e.error.invalidAnswers as { questionId?: unknown; reason?: unknown }[])
      if (x && typeof x.questionId === 'number') byQuestion[x.questionId] = typeof x.reason === 'string' && x.reason ? `Not accepted: ${x.reason}` : 'This answer was not accepted';
  if (!Object.keys(byQuestion).length) return null;
  const m = e.error.message;
  return { message: Array.isArray(m) ? m.join('; ') : typeof m === 'string' && m ? m : 'Some answers were not accepted', byQuestion };
}
