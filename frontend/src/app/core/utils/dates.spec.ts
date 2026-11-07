import { daysInRange, hourLabel, isoToLocalInput, parseIsoDate, previousPeriod, rangeForPreset, toIsoDate } from './dates';

describe('date presets', () => {
  const today = new Date(2026, 9, 5, 15, 30); // 5 Oct 2026 local

  it('today / yesterday', () => {
    expect(rangeForPreset('today', today)).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(rangeForPreset('yesterday', today)).toEqual({ from: '2026-10-04', to: '2026-10-04' });
  });

  it('last 7 / last 30 days are inclusive of today', () => {
    expect(rangeForPreset('last7', today)).toEqual({ from: '2026-09-29', to: '2026-10-05' });
    expect(rangeForPreset('last30', today)).toEqual({ from: '2026-09-06', to: '2026-10-05' });
  });

  it('this month', () => {
    expect(rangeForPreset('thisMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-05' });
  });

  it('custom swaps inverted ranges and falls back when invalid', () => {
    expect(rangeForPreset('custom', today, { from: '2026-10-03', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-03' });
    expect(rangeForPreset('custom', today, { from: 'bad', to: '2026-10-01' })).toEqual({ from: '2026-09-29', to: '2026-10-05' });
  });

  it('crosses month and year boundaries', () => {
    expect(rangeForPreset('last7', new Date(2026, 0, 3))).toEqual({ from: '2025-12-28', to: '2026-01-03' });
  });

  it('previous period has equal length and ends the day before', () => {
    const r = { from: '2026-09-29', to: '2026-10-05' };
    expect(daysInRange(r)).toBe(7);
    expect(previousPeriod(r)).toEqual({ from: '2026-09-22', to: '2026-09-28' });
  });

  it('round-trips local dates without UTC shift', () => {
    expect(toIsoDate(parseIsoDate('2026-03-31'))).toBe('2026-03-31');
  });

  it('labels hours', () => {
    expect(hourLabel(0)).toBe('12am');
    expect(hourLabel(13)).toBe('1pm');
    expect(hourLabel(12)).toBe('12pm');
  });

  it('converts ISO to datetime-local input', () => {
    expect(isoToLocalInput(null)).toBe('');
    expect(isoToLocalInput('2026-10-05T10:00:00Z')).toMatch(/^2026-10-05T\d{2}:\d{2}$/);
  });
});
