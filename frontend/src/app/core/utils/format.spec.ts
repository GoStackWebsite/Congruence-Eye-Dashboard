import { errorMessage, formatBytes, formatDuration, formatInr, formatNumber, formatPct, humanize } from './format';

describe('INR formatting', () => {
  it('uses en-IN lakh grouping with the ₹ symbol', () => {
    expect(formatInr(1234567)).toBe('₹12,34,567');
    expect(formatInr(100000)).toBe('₹1,00,000');
    expect(formatInr(999)).toBe('₹999');
  });

  it('rounds to whole rupees by default and shows paise on request', () => {
    expect(formatInr(1499.6)).toBe('₹1,500');
    expect(formatInr(1499.5, 'paise')).toBe('₹1,499.50');
  });

  it('compacts to K / L / Cr', () => {
    expect(formatInr(12500, 'compact')).toBe('₹12.5 K');
    expect(formatInr(1234567, 'compact')).toBe('₹12.35 L');
    expect(formatInr(45600000, 'compact')).toBe('₹4.56 Cr');
    expect(formatInr(-250000, 'compact')).toBe('-₹2.5 L');
  });

  it('renders a dash for missing values', () => {
    expect(formatInr(null)).toBe('--');
    expect(formatInr(undefined)).toBe('--');
    expect(formatInr(NaN)).toBe('--');
  });
});

describe('other formatters', () => {
  it('formats numbers with Indian grouping', () => {
    expect(formatNumber(1234567)).toBe('12,34,567');
    expect(formatNumber(12.345, 1)).toBe('12.3');
  });
  it('formats percentages', () => {
    expect(formatPct(12.345)).toBe('12.3%');
    expect(formatPct(null)).toBe('--');
  });
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(120)).toBe('2m');
    expect(formatDuration(3900)).toBe('1h 05m');
  });
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('humanizes enum values', () => {
    expect(humanize('QUEUE_LENGTH')).toBe('Queue length');
    expect(humanize(null)).toBe('');
  });
  it('extracts NestJS error messages', () => {
    expect(errorMessage({ error: { message: ['a', 'b'] } })).toBe('a; b');
    expect(errorMessage({ error: { message: 'Bad' } })).toBe('Bad');
    expect(errorMessage({ status: 0 })).toContain('Cannot reach');
  });
});
