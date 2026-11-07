import { Assignment, Question, Task, Template, VendorVisit } from '../../../core/models/api.models';
import { taskFormErrors } from '../../tasks/task-form.drawer';
import { groupTasks, isTaskOverdue } from '../../tasks/tasks.page';
import { storeDay, vendorStats, weekDays } from '../../vendors/vendors.page';
import { assignmentDueIso, sortAssignments } from '../assignments.page';
import { weightedAvg } from '../compliance.page';
import { startIndex } from '../fill.page';
import { emptySchedule, scheduleFieldErrors } from '../schedules.page';
import { answerDisplay } from '../submission-detail.page';
import { scoreBand } from '../submissions.page';
import { reorderSections, sectionBlocks } from '../template-builder.page';
import { templateRows } from '../templates.page';
import { isAnswered, missingReason } from './fill-question.component';
import {
  compactDuration,
  dueInfo,
  fileKind,
  hm12,
  isoToZonedInput,
  occursSentence,
  questionIssues,
  slaInfo,
  storeDate,
  storeDateTime,
  tzOffsetMin,
  validateFile,
  withMobileLabels,
  zonedInputToIso,
} from './ops';

const H = 3600_000;

describe('ops time helpers (store time = Asia/Kolkata)', () => {
  it('converts datetime-local values in IST to UTC and back', () => {
    expect(tzOffsetMin(new Date('2030-01-15T00:00:00Z'))).toBe(330);
    expect(zonedInputToIso('2030-01-15T18:30')).toBe('2030-01-15T13:00:00.000Z');
    expect(isoToZonedInput('2030-01-15T13:00:00.000Z')).toBe('2030-01-15T18:30');
    expect(zonedInputToIso('')).toBeNull();
    expect(zonedInputToIso('nonsense')).toBeNull();
    expect(isoToZonedInput(null)).toBe('');
  });
  it('formats store-local labels and never shows Invalid Date', () => {
    expect(storeDateTime('2030-01-15T13:00:00.000Z')).toMatch(/15 Jan.*6:30 pm/i);
    expect(storeDate('2026-10-06')).toMatch(/06 Oct 2026/);
    expect(storeDateTime(null)).toBe('--');
    expect(storeDate('garbage')).toBe('--');
    expect(hm12('09:30')).toBe('9:30 AM');
    expect(hm12('00:05')).toBe('12:05 AM');
    expect(hm12('23:55')).toBe('11:55 PM');
    expect(hm12(null)).toBe('--');
  });
  it('compacts durations', () => {
    expect(compactDuration(45 * 60_000)).toBe('45m');
    expect(compactDuration(3 * H + 5 * 60_000)).toBe('3h 05m');
    expect(compactDuration(50 * H)).toBe('2d 2h');
    expect(compactDuration(-90 * 60_000)).toBe('1h 30m');
  });
  it('labels due times: overdue, due soon, later, finished', () => {
    const now = Date.parse('2026-10-06T06:00:00Z');
    expect(dueInfo('2026-10-06T04:00:00Z', false, now)).toEqual({ tone: 'overdue', label: 'Overdue by 2h 00m' });
    expect(dueInfo('2026-10-06T07:00:00Z', false, now).tone).toBe('soon');
    expect(dueInfo('2026-10-08T07:00:00Z', false, now).tone).toBe('ok');
    expect(dueInfo('2026-10-06T04:00:00Z', true, now).tone).toBe('done');
    expect(dueInfo(null, false, now).tone).toBe('none');
  });
});

describe('SLA countdown', () => {
  const base = { createdAt: '2026-10-06T00:00:00Z', slaDueAt: '2026-10-06T04:00:00Z', resolvedAt: null as string | null, status: 'OPEN', isSlaBreached: false };
  it('counts down, flags at-risk at 75% and breached after the deadline', () => {
    expect(slaInfo(base, Date.parse('2026-10-06T01:00:00Z'))).toMatchObject({ state: 'on-track', label: '3h 00m left' });
    expect(slaInfo(base, Date.parse('2026-10-06T03:30:00Z')).state).toBe('at-risk');
    expect(slaInfo(base, Date.parse('2026-10-06T05:00:00Z'))).toMatchObject({ state: 'breached', usedPct: 100 });
  });
  it('resolved on time is met; the backend flag wins', () => {
    expect(slaInfo({ ...base, status: 'RESOLVED', resolvedAt: '2026-10-06T02:00:00Z' }).state).toBe('met');
    expect(slaInfo({ ...base, isSlaBreached: true }, Date.parse('2026-10-06T01:00:00Z')).state).toBe('breached');
    expect(slaInfo({ ...base, slaDueAt: null }).state).toBe('none');
  });
});

describe('file validation', () => {
  it('rejects empty, too large (> 50 MB) and unsupported files', () => {
    expect(validateFile(null)).toBe('Choose a file');
    expect(validateFile({ size: 0, type: 'image/png' })).toBe('The file is empty');
    expect(validateFile({ size: 51 * 1048576, type: 'image/png' })).toMatch(/too large .*50 MB/);
    expect(validateFile({ size: 10, type: 'image/heic' }, { accept: ['image/jpeg', 'image/png'] })).toMatch(/Unsupported file type/);
    expect(validateFile({ size: 10, type: 'image/png' }, { accept: ['image/'] })).toBeNull();
  });
  it('maps MIME types to icons', () => {
    expect(fileKind('application/pdf').icon).toBe('picture_as_pdf');
    expect(fileKind('text/plain', 'sop.txt').label).toBe('TXT');
    expect(fileKind('', 'plan.xlsx').icon).toBe('table_chart');
    expect(fileKind('application/octet-stream', 'x.bin').label).toBe('BIN');
  });
});

describe('builder', () => {
  it('flags inline question problems: text, weight ≤ 0, MCQ with < 2 options, min > max', () => {
    expect(questionIssues({ text: '', type: 'YES_NO', weight: 1 })).toEqual({ text: 'Write the question' });
    expect(questionIssues({ text: 'Q', type: 'YES_NO', weight: 0 })['weight']).toBeDefined();
    expect(questionIssues({ text: 'Q', type: 'YES_NO', weight: '' })['weight']).toBeDefined();
    expect(questionIssues({ text: 'Q', type: 'MCQ_SINGLE', weight: 1, options: ['A'] })['options']).toBe('Add at least 2 options');
    expect(questionIssues({ text: 'Q', type: 'NUMBER', weight: 1, minValue: 9, maxValue: 2 })['range']).toBeDefined();
    expect(questionIssues({ text: 'Q', type: 'NUMBER', weight: 2, minValue: 2, maxValue: 8 })).toEqual({});
  });
  it('groups sections in order and reorders whole sections', () => {
    const qs = [{ section: 'A', id: 1 }, { section: 'B', id: 2 }, { section: 'A', id: 3 }, { section: '', id: 4 }];
    expect(sectionBlocks(qs).map((b) => [b.section, b.items.map((i) => i.index)])).toEqual([
      ['A', [0, 2]],
      ['B', [1]],
      ['General', [3]],
    ]);
    expect(reorderSections(qs, 2, 0).map((q) => q.id)).toEqual([4, 1, 3, 2]);
  });
  it('summarises templates for the list', () => {
    const t = { id: 1, name: 'T', description: '', category: 'AUDIT', frequency: 'DAILY', isActive: false, createdAt: '', questions: [
      { section: 'S', text: 'a', type: 'PHOTO', required: true, weight: 2, requiresPhoto: true, sortOrder: 0, aiCheck: 'UNIFORM' },
      { section: 'T', text: 'b', type: 'YES_NO', required: true, weight: 3, requiresPhoto: false, sortOrder: 1 },
    ] } as unknown as Template;
    expect(templateRows([t])[0]).toMatchObject({ questionCount: 2, maxScore: 5, sections: 2, photos: 1, ai: 1, status: 'DRAFT' });
    expect(templateRows(null)).toEqual([]);
  });
});

describe('schedule editor', () => {
  it('validates window, dates and the defined date range inline', () => {
    const f = { ...emptySchedule(), templateId: 1, storeIds: [1], windowStart: '10:00', windowEnd: '09:00' };
    expect(scheduleFieldErrors(f, false)['window']).toBe('The end time must be after the start time');
    expect(scheduleFieldErrors({ ...f, windowEnd: '11:00' }, true)['end']).toMatch(/Pick an end date/);
    expect(scheduleFieldErrors({ ...f, windowEnd: '11:00', startDate: '2026-10-10', endDate: '2026-10-01' }, true)['end']).toMatch(/on or after/);
    expect(scheduleFieldErrors({ ...f, windowEnd: '11:00' }, false)).toEqual({});
    expect(scheduleFieldErrors({ ...emptySchedule() }, false)).toMatchObject({ template: expect.any(String), stores: expect.any(String) });
  });
  it('writes the reference "Occurs every …" sentence', () => {
    const s = { frequency: 'DAILY', repeatEvery: 2, daysOfWeek: [], dayOfMonth: null, startDate: '2023-06-03', endDate: null, windowStart: '09:30', windowEnd: '10:30' };
    expect(occursSentence(s)).toBe('Occurs every 2 days starting 03 Jun 2023, between 9:30 AM and 10:30 AM');
    expect(occursSentence({ ...s, frequency: 'WEEKLY', repeatEvery: 1, daysOfWeek: [0, 1] })).toMatch(/every week on Mon, Sun/);
    expect(occursSentence({ ...s, frequency: 'ONCE' })).toMatch(/^Occurs once on 03 Jun 2023/);
  });
});

describe('fill & review', () => {
  const q = (p: Partial<Question>): Question => ({ id: 1, section: 'S', text: 'Q', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0, ...p });
  const a = (value = '', photoUrl: string | null = null) => ({ value, photoUrl, remark: '', showRemark: false });
  it('explains why a question is incomplete and counts answers', () => {
    expect(missingReason(q({ type: 'VIDEO' }), a())).toBe('A video is required');
    expect(missingReason(q({ type: 'PHOTO', requiresPhoto: true }), a())).toBe('A photo is required');
    expect(missingReason(q({}), a())).toBe('This question is required');
    expect(isAnswered(q({ type: 'MCQ_MULTI' }), a('[]'))).toBe(false);
    expect(isAnswered(q({ type: 'MCQ_MULTI' }), a('["A"]'))).toBe(true);
    expect(isAnswered(q({ type: 'PHOTO' }), a('', '/u/p.jpg'))).toBe(true);
  });
  it('opens a redo at the first redo question', () => {
    const qs = [q({ id: 1 }), q({ id: 2 }), q({ id: 3 })];
    expect(startIndex(qs, {}, new Set([3]))).toBe(2);
    expect(startIndex(qs, {}, new Set())).toBe(0);
  });
  it('renders answers for reviewers', () => {
    const ans = (value: string) => ({ id: 1, questionId: 1, value, photoUrl: null, remark: null, score: 0, maxScore: 1, redo: false });
    expect(answerDisplay(q({ type: 'RATING' }), ans('4'))).toBe('★★★★☆ (4/5)');
    expect(answerDisplay(q({ type: 'MCQ_MULTI' }), ans('["A","B"]'))).toBe('A, B');
    expect(answerDisplay(q({}), ans('NO'))).toBe('No');
    expect(answerDisplay(q({}), undefined)).toBe('Not answered');
  });
  it('bands scores and averages compliance without NaN', () => {
    expect([scoreBand(40), scoreBand(70), scoreBand(90), scoreBand(null)]).toEqual(['low', 'mid', 'good', 'low']);
    expect(weightedAvg([])).toBeNull();
    expect(weightedAvg([{ avgScorePct: 80, submissions: 1 }, { avgScorePct: 100, submissions: 3 }])).toBe(95);
  });
});

describe('assignments, tasks, vendors', () => {
  it('lists open assignments first, soonest due first', () => {
    const mk = (id: number, status: string, dueDate: string) => ({ id, status, dueDate, dueAt: null }) as unknown as Assignment;
    const out = sortAssignments([mk(1, 'APPROVED', '2026-10-01'), mk(2, 'PENDING', '2026-10-07'), mk(3, 'OVERDUE', '2026-10-02'), mk(4, 'SUBMITTED', '2026-10-05')]);
    expect(out.map((x) => x.id)).toEqual([3, 2, 4, 1]);
    expect(assignmentDueIso({ dueAt: null, dueDate: '2026-10-06' })).toBe('2026-10-06T23:59:00+05:30');
  });
  it('validates the task form (title, store, zone, due after start, past due)', () => {
    const v = { title: '', description: '', storeId: null, storeIds: [], type: 'ZONE_ALLOCATION' as const, zoneId: null, priority: 'MEDIUM' as const, assigneeId: null, startAt: '2030-01-12T10:00', dueAt: '2030-01-12T09:00' };
    expect(taskFormErrors(v, false, true)).toMatchObject({ title: expect.any(String), store: 'Choose a store', zone: expect.any(String), dueAt: 'Due time must be after the start time' });
    expect(taskFormErrors({ ...v, title: 'x', storeIds: [], type: 'GENERAL', startAt: '', dueAt: '' }, true, true)).toEqual({ store: 'Choose at least one store' });
    expect(taskFormErrors({ ...v, title: 'x', storeId: 1, type: 'GENERAL', startAt: '', dueAt: '2020-01-01T10:00' }, false, true)['dueAt']).toBe('Due time is in the past');
    expect(taskFormErrors({ ...v, title: 'x', storeId: 1, type: 'GENERAL', startAt: '', dueAt: '2020-01-01T10:00' }, false, false)).toEqual({});
  });
  it('groups the board by status and priority; overdue ignores finished tasks', () => {
    const t = (id: number, status: string, priority: string, dueAt: string | null = null) => ({ id, status, priority, dueAt }) as unknown as Task;
    const g = groupTasks([t(1, 'TODO', 'LOW'), t(2, 'TODO', 'URGENT'), t(3, 'DONE', 'HIGH')]);
    expect(g.TODO.map((x) => x.id)).toEqual([2, 1]);
    expect(g.DONE.map((x) => x.id)).toEqual([3]);
    expect(isTaskOverdue({ status: 'TODO', dueAt: '2020-01-01T00:00:00Z' })).toBe(true);
    expect(isTaskOverdue({ status: 'DONE', dueAt: '2020-01-01T00:00:00Z' })).toBe(false);
  });
  it('builds the vendor week (Mon → Sun) and vendor stats', () => {
    const days = weekDays(new Date('2026-10-08T06:00:00Z'));
    expect(days).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(weekDays(new Date('2026-10-08T06:00:00Z'), -1)[0]).toBe('2026-09-28');
    expect(storeDay('2026-10-05T20:00:00Z')).toBe('2026-10-06');
    const visits = [{ vendorId: 1, rating: 4, scheduledAt: '2026-10-01T04:00:00Z', checkInAt: null }, { vendorId: 1, rating: 5, scheduledAt: '2026-10-02T04:00:00Z', checkInAt: null }] as VendorVisit[];
    const [row] = vendorStats([{ id: 1, name: 'V', category: 'IT', contactName: '', phone: '', email: '', isActive: true }], visits);
    expect(row).toMatchObject({ visits: 2, avgRating: 4.5, lastVisit: '2026-10-02T04:00:00Z' });
  });
  it('adds mobile labels to table cells', () => {
    const [c, act] = withMobileLabels<{ a: number }>([{ key: 'a', header: 'A' }, { key: 'x', header: 'Action', type: 'actions' }], ['a']);
    // labels come from ce-table itself now; the helper only marks the phone-hidden columns
    expect(c.mobileHide).toBe(true);
    expect(act.mobileHide).toBeUndefined();
  });
});
