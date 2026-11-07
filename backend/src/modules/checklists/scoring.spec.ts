import { isAnswered, normaliseValue, scoreAnswer } from './scoring';

describe('checklist scoring', () => {
  const q = (type: string, extra: object = {}) => ({ type, weight: 4, ...extra });
  it('YES_NO', () => {
    expect(scoreAnswer(q('YES_NO'), 'YES')).toBe(4);
    expect(scoreAnswer(q('YES_NO'), 'yes')).toBe(4);
    expect(scoreAnswer(q('YES_NO'), 'NO')).toBe(0);
    expect(normaliseValue('YES_NO', true)).toBe('YES');
  });
  it('MCQ', () => {
    expect(scoreAnswer(q('MCQ_SINGLE', { correctOptions: ['B'] }), 'B')).toBe(4);
    expect(scoreAnswer(q('MCQ_SINGLE', { correctOptions: ['B'] }), 'A')).toBe(0);
    expect(scoreAnswer(q('MCQ_SINGLE', { correctOptions: [] }), 'A')).toBe(4);
    expect(scoreAnswer(q('MCQ_MULTI', { correctOptions: ['A', 'C'] }), normaliseValue('MCQ_MULTI', ['C', 'A']))).toBe(4);
    expect(scoreAnswer(q('MCQ_MULTI', { correctOptions: ['A', 'C'] }), '["A"]')).toBe(0);
    expect(scoreAnswer(q('MCQ_MULTI', { correctOptions: ['A', 'C'] }), '["A","B","C"]')).toBe(0);
    expect(normaliseValue('MCQ_MULTI', 'A, B')).toBe('["A","B"]');
  });
  it('RATING / NUMBER / TEXT / PHOTO', () => {
    expect(scoreAnswer(q('RATING', { weight: 5 }), '3')).toBe(3);
    expect(scoreAnswer(q('RATING', { weight: 2 }), '5')).toBe(2);
    expect(scoreAnswer(q('RATING', { weight: 2 }), '9')).toBe(2);
    expect(scoreAnswer(q('NUMBER', { minValue: 18, maxValue: 24 }), '24')).toBe(4);
    expect(scoreAnswer(q('NUMBER', { minValue: 18, maxValue: 24 }), '25')).toBe(0);
    expect(scoreAnswer(q('NUMBER', {}), 'abc')).toBe(0);
    expect(scoreAnswer(q('TEXT'), 'hello')).toBe(4);
    expect(scoreAnswer(q('TEXT'), null)).toBe(0);
    expect(scoreAnswer(q('PHOTO'), null, '/uploads/files/a.jpg')).toBe(4);
    expect(isAnswered('PHOTO', null, null)).toBe(false);
  });
});

import { isFlagged } from './scoring';
import { scheduleDueOn } from './schedules.service';

describe('v2 flags + VIDEO', () => {
  it('flags deviations only', () => {
    expect(isFlagged({ type: 'YES_NO', weight: 1 }, 'NO')).toBe(true);
    expect(isFlagged({ type: 'YES_NO', weight: 1 }, 'YES')).toBe(false);
    expect(isFlagged({ type: 'YES_NO', weight: 1 }, null)).toBe(false);
    expect(isFlagged({ type: 'MCQ_SINGLE', weight: 1, correctOptions: ['B'] }, 'A')).toBe(true);
    expect(isFlagged({ type: 'MCQ_SINGLE', weight: 1, correctOptions: [] }, 'A')).toBe(false);
    expect(isFlagged({ type: 'NUMBER', weight: 1, minValue: 1, maxValue: 5 }, '6')).toBe(true);
    expect(isFlagged({ type: 'RATING', weight: 1 }, '1')).toBe(false);
    expect(scoreAnswer({ type: 'VIDEO', weight: 3 }, '/uploads/files/a.mp4')).toBe(3);
  });
});

describe('scheduleDueOn', () => {
  const base = { repeatEvery: 1, daysOfWeek: [] as number[], dayOfMonth: null as number | null, startDate: '2026-10-01', endDate: null as string | null };
  it('ONCE / DAILY / WEEKLY / MONTHLY', () => {
    expect(scheduleDueOn({ ...base, frequency: 'ONCE' }, '2026-10-01')).toBe(true);
    expect(scheduleDueOn({ ...base, frequency: 'ONCE' }, '2026-10-02')).toBe(false);
    expect(scheduleDueOn({ ...base, frequency: 'DAILY', repeatEvery: 2 }, '2026-10-03')).toBe(true);
    expect(scheduleDueOn({ ...base, frequency: 'DAILY', repeatEvery: 2 }, '2026-10-04')).toBe(false);
    expect(scheduleDueOn({ ...base, frequency: 'DAILY' }, '2026-09-30')).toBe(false);
    expect(scheduleDueOn({ ...base, frequency: 'DAILY', endDate: '2026-10-05' }, '2026-10-06')).toBe(false);
    // 2026-10-05 is a Monday
    expect(scheduleDueOn({ ...base, frequency: 'WEEKLY', daysOfWeek: [1] }, '2026-10-05')).toBe(true);
    expect(scheduleDueOn({ ...base, frequency: 'WEEKLY', daysOfWeek: [1], repeatEvery: 2 }, '2026-10-12')).toBe(false);
    expect(scheduleDueOn({ ...base, frequency: 'WEEKLY', daysOfWeek: [1], repeatEvery: 2 }, '2026-10-19')).toBe(true);
    expect(scheduleDueOn({ ...base, frequency: 'MONTHLY', dayOfMonth: 31 }, '2026-11-30')).toBe(true);
    expect(scheduleDueOn({ ...base, frequency: 'MONTHLY' }, '2026-11-01')).toBe(true);
  });
});
