import { DurationPipe, InrPipe, PctPipe, relativeTime } from './pipes';

describe('InrPipe', () => {
  const pipe = new InrPipe();
  it('formats with lakh grouping', () => {
    expect(pipe.transform(1234567)).toBe('₹12,34,567');
  });
  it('supports compact mode', () => {
    expect(pipe.transform(2500000, 'compact')).toBe('₹25 L');
  });
  it('handles null', () => {
    expect(pipe.transform(null)).toBe('--');
  });
});

describe('misc pipes', () => {
  it('pct and duration', () => {
    expect(new PctPipe().transform(33.333, 2)).toBe('33.33%');
    expect(new DurationPipe().transform(61)).toBe('1m 1s');
  });
  it('relative time', () => {
    const now = Date.parse('2026-10-05T10:00:00Z');
    expect(relativeTime(new Date(now - 10_000), now)).toBe('just now');
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe('5 min ago');
    expect(relativeTime(new Date(now - 3 * 3600_000), now)).toBe('3 h ago');
    expect(relativeTime(new Date(now - 2 * 86400_000), now)).toBe('2 d ago');
  });
});
