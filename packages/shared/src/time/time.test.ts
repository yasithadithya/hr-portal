import { afterEach, describe, expect, it } from 'vitest';

import {
  addDays,
  eachDay,
  isValidBusinessDate,
  isWeekend,
  today,
  toBusinessDate,
  weekdayOf,
  type WorkWeek,
} from './index';

const MON_FRI: WorkWeek = {
  mon: 'full',
  tue: 'full',
  wed: 'full',
  thu: 'full',
  fri: 'full',
  sat: 'off',
  sun: 'off',
};

const MON_FRI_HALF_SAT: WorkWeek = { ...MON_FRI, sat: 'half' };

// 2026-10-17T19:00Z is Saturday 19:00 in UTC, Saturday 12:00 in Los Angeles,
// but already Sunday 00:30 in Colombo (UTC+05:30).
const INSTANT = new Date('2026-10-17T19:00:00Z');

describe('tenant timezone, not server timezone', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each(['UTC', 'America/Los_Angeles', 'Asia/Colombo', 'Pacific/Kiritimati'])(
    'gives the Colombo business date regardless of server TZ=%s',
    (serverTz) => {
      process.env.TZ = serverTz;

      const d = today('Asia/Colombo', INSTANT);
      expect(d).toBe('2026-10-18');
      expect(weekdayOf(d)).toBe('sun');
      expect(isWeekend(d, MON_FRI)).toBe(true);
    },
  );

  it('the server-local weekday would disagree (shows why the helper exists)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(INSTANT.getDay()).toBe(6); // Saturday locally, wrong for a Colombo tenant
    expect(weekdayOf(today('Asia/Colombo', INSTANT))).toBe('sun');
  });

  it('converts the same instant per tenant timezone', () => {
    expect(toBusinessDate(INSTANT, 'Asia/Colombo')).toBe('2026-10-18');
    expect(toBusinessDate(INSTANT, 'UTC')).toBe('2026-10-17');
  });
});

describe('work week', () => {
  it('treats a half Saturday as a working day, Sunday as weekend', () => {
    expect(isWeekend('2026-10-17', MON_FRI_HALF_SAT)).toBe(false);
    expect(isWeekend('2026-10-17', MON_FRI)).toBe(true);
    expect(isWeekend('2026-10-18', MON_FRI_HALF_SAT)).toBe(true);
    expect(isWeekend('2026-10-19', MON_FRI_HALF_SAT)).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('lists each day inclusive, across month and leap boundaries', () => {
    expect(eachDay('2028-02-27', '2028-03-01')).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(eachDay('2026-01-02', '2026-01-01')).toEqual([]);
  });

  it('adds days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('validates business dates', () => {
    expect(isValidBusinessDate('2026-02-29')).toBe(false);
    expect(isValidBusinessDate('2028-02-29')).toBe(true);
    expect(isValidBusinessDate('2026-1-01')).toBe(false);
    expect(() => weekdayOf('nope')).toThrow(RangeError);
  });
});
