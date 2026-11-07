import { addDays, daysInclusive, dowOf, eachDate, hhmm, isDateStr, localParts, localStamp, minutesOfDay, pct, round, zonedToUtc } from './time.util';

describe('time.util', () => {
  it('converts UTC instants to IST parts', () => {
    // 2026-10-05T18:45:00Z = 2026-10-06 00:15 IST
    const p = localParts(new Date('2026-10-05T18:45:00Z'), 'Asia/Kolkata');
    expect(p).toEqual({ date: '2026-10-06', hour: 0, minute: 15, second: 0, dow: 2 });
    expect(localParts(new Date('2026-10-05T04:29:59Z'), 'Asia/Kolkata').hour).toBe(9);
    expect(hhmm(new Date('2026-10-05T04:30:00Z'), 'Asia/Kolkata')).toBe('10:00');
  });

  it('converts store-local wall time to UTC (IST, DST zones)', () => {
    expect(zonedToUtc('2026-10-05', '10:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-05T04:30:00.000Z');
    expect(zonedToUtc('2026-10-05', '00:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-04T18:30:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(zonedToUtc('2026-10-05', '12:30', 'UTC').toISOString()).toBe('2026-10-05T12:30:00.000Z');
  });

  it('round-trips local → utc → local', () => {
    for (const tz of ['Asia/Kolkata', 'Europe/London', 'Asia/Dubai']) {
      for (let h = 0; h < 24; h += 5) {
        const d = zonedToUtc('2026-03-10', `${String(h).padStart(2, '0')}:20`, tz);
        expect(localParts(d, tz)).toMatchObject({ date: '2026-03-10', hour: h, minute: 20 });
      }
    }
  });

  it('date arithmetic', () => {
    expect(addDays('2026-10-05', -7)).toBe('2026-09-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysInclusive('2026-10-01', '2026-10-07')).toBe(7);
    expect(eachDate('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(dowOf('2026-10-04')).toBe(0); // Sunday
    expect(minutesOfDay('21:30')).toBe(1290);
  });

  it('numeric helpers', () => {
    expect(round(4.6666, 2)).toBe(4.67);
    expect(pct(1, 3)).toBe(33.33);
    expect(pct(1, 0)).toBe(0);
  });

  it('QA §1: IST midnight edges, other zones, leap years and DST transitions', () => {
    expect(localParts(new Date('2026-10-05T18:29:59.999Z'))).toMatchObject({ date: '2026-10-05', hour: 23 });
    expect(localParts(new Date('2026-10-05T18:30:00.000Z'))).toMatchObject({ date: '2026-10-06', hour: 0 });
    expect(zonedToUtc('2026-10-06', '00:00', 'Asia/Dubai').toISOString()).toBe('2026-10-05T20:00:00.000Z');
    expect(localParts(new Date('2026-10-05T20:00:00Z'), 'Asia/Dubai')).toMatchObject({ date: '2026-10-06', hour: 0 });
    expect(zonedToUtc('2026-10-06', '05:45', 'Asia/Kathmandu').toISOString()).toBe('2026-10-06T00:00:00.000Z'); // +05:45
    // DST (stores abroad): London springs forward 2026-03-29 01:00 → 02:00, falls back 2026-10-25
    expect(zonedToUtc('2026-03-29', '00:30', 'Europe/London').toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(zonedToUtc('2026-03-29', '03:00', 'Europe/London').toISOString()).toBe('2026-03-29T02:00:00.000Z');
    expect(localParts(new Date('2026-10-25T00:30:00Z'), 'Europe/London')).toMatchObject({ date: '2026-10-25', hour: 1 });
    expect(localParts(new Date('2026-10-25T01:30:00Z'), 'Europe/London')).toMatchObject({ date: '2026-10-25', hour: 1 });
    expect(eachDate('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(isDateStr('2028-02-29')).toBe(true);
    expect(isDateStr('2026-02-29')).toBe(false);
    expect(isDateStr('2026-02-30')).toBe(false);
    expect(isDateStr('2026-13-01')).toBe(false);
    expect(isDateStr('2026-1-01')).toBe(false);
  });
});

describe('localStamp', () => {
  it('formats an instant in store time for user-facing messages', () => {
    expect(localStamp(new Date('2026-10-05T22:11:00.908Z'), 'Asia/Kolkata')).toBe('06 Oct, 3:41 am');
    expect(localStamp(new Date('2026-10-05T06:30:00Z'), 'Asia/Kolkata')).toBe('05 Oct, 12:00 pm');
  });
});
