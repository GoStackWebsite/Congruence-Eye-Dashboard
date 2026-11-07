import { Question, TemplateInput } from '../models/api.models';

export const OPTION_TYPES = new Set(['MCQ_SINGLE', 'MCQ_MULTI']);

/** Splits a comma/newline separated options string into a trimmed, de-duplicated list. */
export function parseOptions(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (text ?? '').split(/[,\n]/)) {
    const s = raw.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Normalises a question before saving: strips irrelevant fields per type and fixes sortOrder. */
export function normaliseQuestion(q: Question, index: number): Question {
  const base: Question = {
    section: (q.section ?? '').trim() || 'General',
    text: (q.text ?? '').trim(),
    type: q.type,
    required: !!q.required,
    weight: Number.isFinite(Number(q.weight)) ? Number(q.weight) : 1,
    requiresPhoto: q.type === 'PHOTO' || q.type === 'VIDEO' ? true : !!q.requiresPhoto,
    sortOrder: index,
  };
  if (q.id !== undefined) base.id = q.id;
  // v2: AI check applies to photo evidence only
  const hasPhoto = q.type === 'PHOTO' || (!!q.requiresPhoto && q.type !== 'VIDEO');
  base.aiCheck = hasPhoto ? (q.aiCheck ?? 'NONE') : 'NONE';
  base.referenceImageUrl = base.aiCheck === 'REFERENCE_MATCH' ? (q.referenceImageUrl ?? null) : null;
  base.createTaskOnFail = !!q.createTaskOnFail;
  if (OPTION_TYPES.has(q.type)) {
    base.options = [...(q.options ?? [])];
    base.correctOptions = (q.correctOptions ?? []).filter((c) => base.options!.includes(c));
    if (q.type === 'MCQ_SINGLE' && base.correctOptions.length > 1) base.correctOptions = base.correctOptions.slice(0, 1);
  } else {
    base.options = [];
    base.correctOptions = [];
  }
  if (q.type === 'NUMBER') {
    base.minValue = q.minValue === undefined || q.minValue === null || (q.minValue as unknown) === '' ? null : Number(q.minValue);
    base.maxValue = q.maxValue === undefined || q.maxValue === null || (q.maxValue as unknown) === '' ? null : Number(q.maxValue);
  } else {
    base.minValue = null;
    base.maxValue = null;
  }
  return base;
}

/** Returns human-readable problems; empty array means the template can be saved. */
export function validateTemplate(t: Pick<TemplateInput, 'name' | 'questions'>): string[] {
  const errors: string[] = [];
  if (!t.name?.trim()) errors.push('Template name is required');
  if (!t.questions?.length) errors.push('Add at least one question');
  t.questions?.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!q.text?.trim()) errors.push(`${n}: text is required`);
    if (!(Number(q.weight) >= 0)) errors.push(`${n}: weight must be 0 or more`);
    if (OPTION_TYPES.has(q.type)) {
      if ((q.options ?? []).length < 2) errors.push(`${n}: add at least 2 options`);
      const bad = (q.correctOptions ?? []).filter((c) => !(q.options ?? []).includes(c));
      if (bad.length) errors.push(`${n}: correct options must be among the options`);
      if (q.type === 'MCQ_SINGLE' && (q.correctOptions ?? []).length > 1) errors.push(`${n}: single choice can have only one correct option`);
    }
    const aiCheck = q.aiCheck ?? 'NONE';
    if (aiCheck !== 'NONE' && q.type !== 'PHOTO' && !q.requiresPhoto) errors.push(`${n}: AI check needs a PHOTO question or "Requires photo"`);
    if (aiCheck !== 'NONE' && q.type === 'VIDEO') errors.push(`${n}: AI check is not available for video answers`);
    if (aiCheck === 'REFERENCE_MATCH' && !q.referenceImageUrl) errors.push(`${n}: upload a reference image for the AI match`);
    if (q.type === 'NUMBER' && q.minValue !== null && q.minValue !== undefined && q.maxValue !== null && q.maxValue !== undefined && Number(q.minValue) > Number(q.maxValue)) {
      errors.push(`${n}: min must be ≤ max`);
    }
  });
  return errors;
}

/** Moves an item within an array (immutable). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  if (from < 0 || from >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, item);
  return copy;
}
