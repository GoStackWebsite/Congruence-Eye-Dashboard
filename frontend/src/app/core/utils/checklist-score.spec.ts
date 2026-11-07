import { Question } from '../models/api.models';
import { groupBySection, missingRequired, parseMulti, previewScore, scoreAnswer, serverAnswerIssues } from './checklist-score';

const q = (over: Partial<Question>): Question => ({
  id: 1,
  section: 'General',
  text: 'Q',
  type: 'YES_NO',
  required: true,
  weight: 2,
  requiresPhoto: false,
  sortOrder: 0,
  ...over,
});

describe('checklist scoring (contract rules)', () => {
  it('YES_NO: YES = full weight', () => {
    expect(scoreAnswer(q({}), 'YES')).toBe(2);
    expect(scoreAnswer(q({}), 'NO')).toBe(0);
    expect(scoreAnswer(q({}), '')).toBe(0);
  });

  it('MCQ_SINGLE: correct option or any if none defined', () => {
    const withCorrect = q({ type: 'MCQ_SINGLE', options: ['A', 'B'], correctOptions: ['B'] });
    expect(scoreAnswer(withCorrect, 'B')).toBe(2);
    expect(scoreAnswer(withCorrect, 'A')).toBe(0);
    expect(scoreAnswer(q({ type: 'MCQ_SINGLE', options: ['A', 'B'], correctOptions: [] }), 'A')).toBe(2);
  });

  it('MCQ_MULTI: exact set of correct options (JSON array string)', () => {
    const m = q({ type: 'MCQ_MULTI', options: ['A', 'B', 'C'], correctOptions: ['A', 'C'] });
    expect(scoreAnswer(m, '["C","A"]')).toBe(2);
    expect(scoreAnswer(m, '["A"]')).toBe(0);
    expect(scoreAnswer(m, 'not-json')).toBe(0);
    expect(scoreAnswer(q({ type: 'MCQ_MULTI', options: ['A'], correctOptions: [] }), '["A"]')).toBe(2);
  });

  it('RATING: value/5 × weight', () => {
    expect(scoreAnswer(q({ type: 'RATING', weight: 10 }), '4')).toBe(8);
    expect(scoreAnswer(q({ type: 'RATING', weight: 10 }), '9')).toBe(10);
  });

  it('NUMBER: within [min,max]', () => {
    const n = q({ type: 'NUMBER', minValue: 18, maxValue: 24 });
    expect(scoreAnswer(n, '20')).toBe(2);
    expect(scoreAnswer(n, '25')).toBe(0);
    expect(scoreAnswer(n, '')).toBe(0);
    expect(scoreAnswer(q({ type: 'NUMBER', minValue: null, maxValue: 5 }), '-100')).toBe(2);
  });

  it('TEXT / PHOTO: answered = weight', () => {
    expect(scoreAnswer(q({ type: 'TEXT' }), 'ok')).toBe(2);
    expect(scoreAnswer(q({ type: 'TEXT' }), '   ')).toBe(0);
    expect(scoreAnswer(q({ type: 'PHOTO' }), '', '/uploads/a.jpg')).toBe(2);
  });

  it('previews total score and percentage', () => {
    const qs = [q({ id: 1, weight: 2 }), q({ id: 2, type: 'RATING', weight: 5 }), q({ id: 3, type: 'TEXT', weight: 3 })];
    const r = previewScore(qs, { 1: { value: 'YES' }, 2: { value: '3' }, 3: { value: '' } });
    expect(r).toEqual({ score: 5, maxScore: 10, pct: 50 });
    expect(previewScore([], {})).toEqual({ score: 0, maxScore: 0, pct: 0 });
  });

  it('finds missing required answers and photos', () => {
    const qs = [q({ id: 1 }), q({ id: 2, required: false, requiresPhoto: true }), q({ id: 3, type: 'MCQ_MULTI', options: ['A'] })];
    const missing = missingRequired(qs, { 1: { value: 'NO' }, 2: { value: 'x' }, 3: { value: '[]' } });
    expect(missing.map((m) => m.id)).toEqual([2, 3]);
  });

  it('groups by section in sortOrder', () => {
    const g = groupBySection([q({ id: 1, section: 'B', sortOrder: 2 }), q({ id: 2, section: 'A', sortOrder: 0 }), q({ id: 3, section: 'B', sortOrder: 1 })]);
    expect(g.map((x) => x.section)).toEqual(['A', 'B']);
    expect(g[1].questions.map((x) => x.id)).toEqual([3, 1]);
  });

  it('parseMulti is defensive', () => {
    expect(parseMulti(null)).toEqual([]);
    expect(parseMulti('{"a":1}')).toEqual([]);
  });
});

describe('serverAnswerIssues (contract v4 answer validation)', () => {
  it('maps missingQuestionIds and invalidAnswers to per-question messages', () => {
    const r = serverAnswerIssues({ status: 400, error: { message: 'Some answers are invalid', invalidAnswers: [{ questionId: 4, reason: 'must be YES or NO' }], missingQuestionIds: [7] } });
    expect(r).toEqual({ message: 'Some answers are invalid', byQuestion: { 4: 'Not accepted: must be YES or NO', 7: 'Required: this question needs an answer' } });
  });
  it('is null for other errors', () => {
    expect(serverAnswerIssues({ status: 400, error: { message: 'bad' } })).toBeNull();
    expect(serverAnswerIssues({ status: 500, error: { missingQuestionIds: [1] } })).toBeNull();
    expect(serverAnswerIssues(null)).toBeNull();
  });
});
