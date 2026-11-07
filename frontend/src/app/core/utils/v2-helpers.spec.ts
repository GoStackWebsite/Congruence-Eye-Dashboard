import {
  AI_PARAM_DEFAULTS,
  DENSITY_RAMP,
  daysLabel,
  densityColor,
  densityMatrix,
  normaliseAiParams,
  notificationKind,
  resolveNotificationLink,
  scheduleSummary,
  validateSchedule,
} from './v2-helpers';
import { toCsv } from './csv';

describe('traffic density matrix', () => {
  const d = {
    cells: [
      { dow: 1, hour: 10, avgFootfall: 50 },
      { dow: 0, hour: 10, avgFootfall: 100 },
      { dow: 6, hour: 11, avgFootfall: 25 },
    ],
    max: 100,
    hours: [11, 10],
  };

  it('builds hour rows with Monday-first columns', () => {
    const rows = densityMatrix(d);
    expect(rows.map((r) => r.hour)).toEqual([10, 11]);
    expect(rows[0].cells.map((c) => c.dow)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(rows[0].cells[0].value).toBe(50);
    expect(rows[0].cells[6].value).toBe(100);
    expect(rows[0].total).toBe(150);
    expect(rows[0].label).toBe('10am – 11am');
  });

  it('colours with a light→dark blue ramp and white text on dark cells', () => {
    expect(densityColor(0, 100).bg).toBe(DENSITY_RAMP[0]);
    expect(densityColor(100, 100)).toEqual({ bg: DENSITY_RAMP[6], fg: '#ffffff' });
    expect(densityColor(10, 100).fg).toBe('#0b0b0b');
  });

  it('handles null input', () => {
    expect(densityMatrix(null)).toEqual([]);
  });
});

describe('AI Manager params', () => {
  it('fills defaults, drops unknown keys and coerces types', () => {
    expect(normaliseAiParams('MOBILE_USAGE', { minDurationSec: '45', staffOnly: 'false', junk: 1 })).toEqual({ minDurationSec: 45, staffOnly: false });
    expect(normaliseAiParams('STOCK_OUT', {})).toEqual(AI_PARAM_DEFAULTS.STOCK_OUT);
    expect(normaliseAiParams('HUDDLE_MEETING', { minPeople: 'abc' })).toEqual({ minPeople: 3, minDurationMin: 5, radius: 0.2 });
  });

  it('labels day sets', () => {
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(daysLabel([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(daysLabel([6, 0])).toBe('Weekends');
    expect(daysLabel([0, 3, 1])).toBe('Mon, Wed, Sun');
  });
});

describe('schedules', () => {
  const base = { frequency: 'WEEKLY' as const, repeatEvery: 2, daysOfWeek: [1, 3], dayOfMonth: null, windowStart: '09:30', windowEnd: '10:30' };
  it('summarises', () => {
    expect(scheduleSummary(base)).toBe('Every 2 weeks on Mon, Wed · 09:30–10:30');
    expect(scheduleSummary({ ...base, frequency: 'DAILY', repeatEvery: 1 })).toBe('Daily · 09:30–10:30');
    expect(scheduleSummary({ ...base, frequency: 'MONTHLY', repeatEvery: 1, dayOfMonth: 5 })).toBe('Monthly on day 5 · 09:30–10:30');
  });
  it('validates', () => {
    const ok = { templateId: 1, storeIds: [1], frequency: 'DAILY', daysOfWeek: [], windowStart: '09:00', windowEnd: '10:00', startDate: '2026-10-01', endDate: null, repeatEvery: 1 };
    expect(validateSchedule(ok)).toEqual([]);
    expect(validateSchedule({ ...ok, templateId: null, storeIds: [] })).toEqual(['Choose a checklist', 'Choose at least one store']);
    expect(validateSchedule({ ...ok, frequency: 'WEEKLY' })).toContain('Pick at least one day of the week');
    expect(validateSchedule({ ...ok, windowEnd: '08:00' })).toContain('Window end must be after window start');
    expect(validateSchedule({ ...ok, endDate: '2026-09-01' })).toContain('End date must be on or after the start date');
  });
});

describe('notifications', () => {
  it('classifies deep links', () => {
    expect(notificationKind({ title: '[HIGH] Queue', link: '/alerts/3' })).toBe('alert');
    expect(notificationKind({ title: 'X breach detected', link: '/ai-manager/detections?id=9' })).toBe('ai-breach');
    expect(notificationKind({ title: 'Reminder: Opening', link: '/checklists/assignments/4' })).toBe('reminder');
    expect(notificationKind({ title: 'Overdue: Opening', link: '/checklists/assignments/4' })).toBe('overdue');
    expect(notificationKind({ title: 'x', link: null })).toBe('other');
  });
  it('normalises links', () => {
    expect(resolveNotificationLink('https://ce.example.com/alerts/3')).toBe('/alerts/3');
    expect(resolveNotificationLink('tickets/4')).toBe('/tickets/4');
    expect(resolveNotificationLink(null)).toBeNull();
  });
});

describe('csv', () => {
  it('quotes and escapes', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"' }], [{ label: 'A', value: (r) => r.a }, { label: 'B', value: (r) => r.b }])).toBe('A,B\n"x,y","say ""hi"""');
  });
});
