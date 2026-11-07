import { Recap } from '../core/models/api.models';
import { normaliseQuestion, validateTemplate } from '../core/utils/template-validation';
import { scoreAnswer } from '../core/utils/checklist-score';
import { emptyAiRule, validateAiRule, DETECTION_ZONE_TYPES } from './ai-manager/rules.page';
import { detectionChip } from './ai-manager/detections.page';
import { openCloseChip } from './ai-manager/open-close.page';
import { journeyHighlightCards } from './analytics/journey.page';
import { concentrationRanking } from './analytics/zone-concentration.component';
import { aiErrorMessage } from './checklists/fill.page';
import { emptySchedule, schedulePayload } from './checklists/schedules.page';
import { perfRows } from './checklists/trax-dashboard.page';
import { healthChip, sortByHealth } from './infra/infra-health.page';
import { completionBody } from './tasks/complete-task.dialog';
import { sortRecaps } from './traffic/recap.page';
import { conversionFlowStages } from '../shared/charts/chart-builders';
import { ZoneAnalytics } from '../core/models/api.models';

describe('conversion flow (v2 order)', () => {
  it('orders Footfall → Engagers → Billable entities → Conversion with % of footfall', () => {
    const s = conversionFlowStages({ footfall: 1000, engaged: 500, billableEntities: 800, transactions: 200 });
    expect(s.map((x) => x.label)).toEqual(['Footfall', 'Engagers', 'Billable entities', 'Conversion']);
    expect(s.map((x) => x.pctOfFootfall)).toEqual([100, 50, 80, 20]);
    expect(conversionFlowStages(null)[0].value).toBe(0);
  });
});

describe('checklist v2', () => {
  const q = { section: 'S', text: 'Signage', type: 'PHOTO' as const, required: true, weight: 2, requiresPhoto: true, sortOrder: 0 };
  it('keeps AI settings only for photo questions', () => {
    expect(normaliseQuestion({ ...q, aiCheck: 'REFERENCE_MATCH', referenceImageUrl: '/u/r.jpg', createTaskOnFail: true }, 0)).toMatchObject({ aiCheck: 'REFERENCE_MATCH', referenceImageUrl: '/u/r.jpg', createTaskOnFail: true });
    expect(normaliseQuestion({ ...q, type: 'YES_NO', requiresPhoto: false, aiCheck: 'UNIFORM' }, 0).aiCheck).toBe('NONE');
    expect(normaliseQuestion({ ...q, aiCheck: 'UNIFORM', referenceImageUrl: '/x' }, 0).referenceImageUrl).toBeNull();
  });
  it('requires a reference image for reference match', () => {
    expect(validateTemplate({ name: 't', questions: [{ ...q, aiCheck: 'REFERENCE_MATCH' }] })).toContain('Question 1: upload a reference image for the AI match');
    expect(validateTemplate({ name: 't', questions: [{ ...q, type: 'TEXT', requiresPhoto: false, aiCheck: 'UNIFORM' }] })[0]).toMatch(/AI check needs a PHOTO/);
  });
  it('scores VIDEO like PHOTO', () => {
    expect(scoreAnswer({ ...q, type: 'VIDEO' }, '/uploads/v.mp4')).toBe(2);
    expect(scoreAnswer({ ...q, type: 'VIDEO' }, '')).toBe(0);
  });
  it('explains AI outages without blocking', () => {
    expect(aiErrorMessage({ status: 0 })).toMatch(/still submit/);
  });
  it('schedule payload clears irrelevant fields', () => {
    const p = schedulePayload({ ...emptySchedule(), frequency: 'DAILY', daysOfWeek: [1], dayOfMonth: 4, repeatEvery: 0 });
    expect(p.daysOfWeek).toEqual([]);
    expect(p.dayOfMonth).toBeNull();
    expect(p.repeatEvery).toBe(1);
    const once = schedulePayload({ ...emptySchedule(), frequency: 'ONCE', startDate: '2026-10-09', endDate: '2026-12-01' });
    expect(once.endDate).toBe('2026-10-09');
    expect(schedulePayload({ ...emptySchedule(), frequency: 'WEEKLY', daysOfWeek: [3, 1, 3] }).daysOfWeek).toEqual([1, 3]);
  });
  it('dashboard performance rows', () => {
    const d = {
      activeChecklists: 1, checklistInstances: 2, notSubmitted: 0, open: 0, inProgress: 0, submitted: 2, completionScorePct: 100, complianceScorePct: 90, totalFlags: 1,
      byChecklist: [{ templateId: 1, name: 'Opening', frequency: 'DAILY', stores: 3, assigned: 2, submitted: 2, flags: 1, completionPct: 100, compliancePct: 90 }],
      byStore: [{ storeId: 4, storeName: 'TNR', assigned: 2, submitted: 2, flags: 1, completionPct: 100, compliancePct: 90 }],
      byUser: [{ userId: 9, name: 'Divya', assigned: 2, submitted: 2, flags: 1, completionPct: 100, compliancePct: 90 }],
    };
    expect(perfRows(d, 'checklist')[0]).toMatchObject({ id: 1, name: 'Opening', extra: 'Daily · 3 store(s)' });
    expect(perfRows(d, 'store')[0].id).toBe(4);
    expect(perfRows(d, 'user')[0].name).toBe('Divya');
    expect(perfRows(null, 'user')).toEqual([]);
  });
});

describe('tasks v2', () => {
  it('completion body includes only provided proof/remark', () => {
    expect(completionBody(null, '  ')).toEqual({ status: 'DONE' });
    expect(completionBody('/uploads/p.jpg', ' fixed ')).toEqual({ status: 'DONE', proofUrl: '/uploads/p.jpg', remark: 'fixed' });
  });
});

describe('AI manager', () => {
  it('rule defaults and validation', () => {
    const r = emptyAiRule('QUEUE_BREACH');
    expect(r.params).toEqual({ maxQueue: 5 });
    expect(validateAiRule(r)).toEqual(['Rule name is required']);
    expect(validateAiRule({ ...r, name: 'Q', notifyChannels: ['EMAIL'], notifyEmails: '' })).toEqual(['Enter notification emails']);
    expect(validateAiRule({ ...r, name: 'Q', daysOfWeek: [], windowEnd: '09:00' })).toEqual(['Window end must be after window start', 'Pick at least one day']);
    expect(DETECTION_ZONE_TYPES.STOCK_OUT).toEqual(['SHELF']);
  });
  it('status chips', () => {
    expect(detectionChip('BREACHED').label).toBe('Breached');
    expect(openCloseChip('LATE')).toEqual({ value: 'OVERDUE', label: 'Late' });
    expect(openCloseChip('MISSING').label).toBe('Missing');
    expect(openCloseChip('PENDING').label).toBe('Pending');
  });
});

describe('analytics v2', () => {
  it('journey highlight cards', () => {
    const cards = journeyHighlightCards({
      nodes: [],
      links: [],
      highlights: {
        highestFootfall: { zoneName: 'Women', value: 10, label: '10 visits' },
        highestImpression: null,
        highestBounced: { zoneName: 'Acc', value: 50, label: '50% bounced' },
        highestEngaged: null,
        highestDwell: null,
      },
    });
    expect(cards.map((c) => c.key)).toEqual(['highestFootfall', 'highestBounced']);
    expect(journeyHighlightCards(null)).toEqual([]);
  });
  it('concentration ranking per store', () => {
    const z = (id: number, storeId: number, c: number, type = 'SECTION') => ({ id, storeId, concentrationPct: c, type }) as unknown as ZoneAnalytics;
    expect(concentrationRanking([z(1, 1, 5), z(2, 1, 20), z(3, 2, 99), z(4, 1, 50, 'ENTRY_LINE')], 1).map((x) => x.id)).toEqual([2, 1]);
  });
  it('infra health sorting and chips', () => {
    const s = (storeName: string, health: 'GOOD' | 'DEGRADED' | 'DOWN') => ({ storeName, health }) as never;
    expect(sortByHealth([s('B', 'GOOD'), s('A', 'DOWN'), s('C', 'DEGRADED')]).map((x: { storeName: string }) => x.storeName)).toEqual(['A', 'C', 'B']);
    expect(healthChip('DEGRADED').label).toBe('Degraded');
  });
  it('recaps newest first', () => {
    const r = (id: number, date: string, storeName: string) => ({ id, date, storeName }) as Recap;
    expect(sortRecaps([r(1, '2026-10-01', 'B'), r(2, '2026-10-03', 'A'), r(3, '2026-10-03', 'C')]).map((x) => x.id)).toEqual([2, 3, 1]);
  });
});
