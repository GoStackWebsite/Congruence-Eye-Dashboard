import { Question } from '../models/api.models';
import { moveItem, normaliseQuestion, parseOptions, validateTemplate } from './template-validation';

const base: Question = { section: 'S', text: 'T', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 };

describe('template builder helpers', () => {
  it('parses comma separated options', () => {
    expect(parseOptions(' A, B ,,A\nC ')).toEqual(['A', 'B', 'C']);
  });

  it('normalises per type and sets sortOrder', () => {
    const n = normaliseQuestion({ ...base, type: 'MCQ_SINGLE', options: ['A', 'B'], correctOptions: ['A', 'B', 'Z'] }, 3);
    expect(n.sortOrder).toBe(3);
    expect(n.correctOptions).toEqual(['A']);
    const y = normaliseQuestion({ ...base, options: ['x'], minValue: 1 }, 0);
    expect(y.options).toEqual([]);
    expect(y.minValue).toBeNull();
    expect(normaliseQuestion({ ...base, type: 'PHOTO' }, 0).requiresPhoto).toBe(true);
    expect(normaliseQuestion({ ...base, section: '  ' }, 0).section).toBe('General');
  });

  it('validates templates', () => {
    expect(validateTemplate({ name: '', questions: [] })).toEqual(['Template name is required', 'Add at least one question']);
    expect(validateTemplate({ name: 'x', questions: [{ ...base, type: 'MCQ_MULTI', options: ['A'] }] })).toContain('Question 1: add at least 2 options');
    expect(validateTemplate({ name: 'x', questions: [{ ...base, type: 'NUMBER', minValue: 5, maxValue: 1 }] })).toContain('Question 1: min must be ≤ max');
    expect(validateTemplate({ name: 'x', questions: [base] })).toEqual([]);
  });

  it('moves items immutably', () => {
    const a = [1, 2, 3, 4];
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem(a, 3, -5)).toEqual([4, 1, 2, 3]);
    expect(a).toEqual([1, 2, 3, 4]);
  });
});
