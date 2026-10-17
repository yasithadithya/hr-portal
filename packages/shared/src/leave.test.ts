import { describe, expect, it } from 'vitest';

import {
  accrualsDue,
  addMonths,
  carryForwardAmount,
  carryForwardExpiry,
  LeaveRuleError,
  requestDays,
  roundLeave,
  yearlyEntitlement,
  type PolicyInput,
} from './leave';
import type { WorkWeek } from './time/index';

const MON_FRI: WorkWeek = {
  mon: 'full',
  tue: 'full',
  wed: 'full',
  thu: 'full',
  fri: 'full',
  sat: 'off',
  sun: 'off',
};
const HALF_SAT: WorkWeek = { ...MON_FRI, sat: 'half' };
const none = new Set<string>();

// Oct 2026: Thu 1 … Sat 3, Sun 4, Mon 5 … Fri 9, Sat 10, Sun 11, Mon 12 … Thu 15
const req = (start: string, end: string, startHalf = 'full', endHalf = 'full', unit = 'half_day') =>
  ({ start, end, startHalf, endHalf, unit }) as Parameters<typeof requestDays>[0];

describe('requestDays (golden day counting)', () => {
  it('skips weekends', () => {
    expect(requestDays(req('2026-10-01', '2026-10-07'), MON_FRI, none).amount).toBe(5);
  });

  it('counts a half Saturday as 0.5', () => {
    expect(requestDays(req('2026-10-01', '2026-10-07'), HALF_SAT, none).amount).toBe(5.5);
  });

  it('skips holidays, including on half days', () => {
    const hols = new Set(['2026-10-06', '2026-10-03']);
    expect(requestDays(req('2026-10-01', '2026-10-07'), HALF_SAT, hols).amount).toBe(4);
  });

  it('half-day start (afternoon) and half-day end (morning)', () => {
    const r = requestDays(req('2026-10-05', '2026-10-07', 'second', 'first'), MON_FRI, none);
    expect(r.amount).toBe(2);
    expect(r.days.map((d) => [d.date, d.portion, d.half])).toEqual([
      ['2026-10-05', 0.5, 'second'],
      ['2026-10-06', 1, 'full'],
      ['2026-10-07', 0.5, 'first'],
    ]);
  });

  it('single half day', () => {
    expect(
      requestDays(req('2026-10-05', '2026-10-05', 'first', 'first'), MON_FRI, none).days,
    ).toEqual([{ date: '2026-10-05', portion: 0.5, half: 'first' }]);
  });

  it('a half Saturday taken as a half day is still 0.5', () => {
    expect(
      requestDays(req('2026-10-03', '2026-10-03', 'first', 'first'), HALF_SAT, none).amount,
    ).toBe(0.5);
  });

  it('a weekend-only request costs nothing', () => {
    expect(requestDays(req('2026-10-03', '2026-10-04'), MON_FRI, none).amount).toBe(0);
  });

  it('rejects impossible half combinations and halves on whole-day types', () => {
    expect(() => requestDays(req('2026-10-05', '2026-10-07', 'first'), MON_FRI, none)).toThrow(
      LeaveRuleError,
    );
    expect(() =>
      requestDays(req('2026-10-05', '2026-10-07', 'full', 'second'), MON_FRI, none),
    ).toThrow(LeaveRuleError);
    expect(() =>
      requestDays(req('2026-10-05', '2026-10-05', 'first', 'first', 'day'), MON_FRI, none),
    ).toThrow(LeaveRuleError);
    expect(() => requestDays(req('2026-10-07', '2026-10-05'), MON_FRI, none)).toThrow(
      LeaveRuleError,
    );
  });

  it('hour-unit (short leave) is one working day, amount in hours', () => {
    expect(
      requestDays(
        { ...req('2026-10-05', '2026-10-05', 'full', 'full', 'hour'), hours: 1.5 },
        MON_FRI,
        none,
      ),
    ).toEqual({
      days: [{ date: '2026-10-05', portion: 1.5, half: 'full' }],
      amount: 1.5,
    });
    expect(() =>
      requestDays(
        { ...req('2026-10-04', '2026-10-04', 'full', 'full', 'hour'), hours: 1 },
        MON_FRI,
        none,
      ),
    ).toThrow(LeaveRuleError);
  });
});

describe('rounding and dates', () => {
  it.each([
    ['none', 10.833, 10.83],
    ['nearest_half', 10.76, 11],
    ['nearest_half', 10.74, 10.5],
    ['floor_half', 10.99, 10.5],
    ['floor_day', 10.99, 10],
    ['nearest_day', 10.5, 11],
  ] as const)('%s(%s) = %s', (mode, v, expected) => {
    expect(roundLeave(v, mode)).toBe(expected);
  });

  it('adds months with end-of-month clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-06-30', 0)).toBe('2026-06-30');
  });
});

const policy = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  entitlement: 14,
  accrual: 'upfront_yearly',
  prorationOnJoin: 'monthly',
  rounding: 'floor_half',
  eligibleAfterMonths: 0,
  ...over,
});

describe('entitlement and accrual', () => {
  it('full entitlement when joined before the year', () => {
    expect(yearlyEntitlement(2026, '2024-05-01', policy())).toBe(14);
  });

  it('monthly proration counts the join month as a full month', () => {
    // joined 15 Apr: Apr–Dec = 9 months → 14 × 9/12 = 10.5
    expect(yearlyEntitlement(2026, '2026-04-15', policy())).toBe(10.5);
    // Oct–Dec = 3 months → 3.5
    expect(yearlyEntitlement(2026, '2026-10-01', policy())).toBe(3.5);
  });

  it('daily proration counts remaining days', () => {
    // 1 Jul 2026 → 184 of 365 days × 14 = 7.05… → floor_half 7
    expect(yearlyEntitlement(2026, '2026-07-01', policy({ prorationOnJoin: 'daily' }))).toBe(7);
  });

  it('eligibility after N months moves the start (and can push it into the next year)', () => {
    expect(yearlyEntitlement(2026, '2026-03-01', policy({ eligibleAfterMonths: 12 }))).toBe(0);
    expect(yearlyEntitlement(2027, '2026-03-01', policy({ eligibleAfterMonths: 12 }))).toBe(11.5); // Mar–Dec 2027 = 10 months → 14 × 10/12 = 11.67 → floor_half 11.5
  });

  it('upfront accrual is a single keyed entry once eligible', () => {
    expect(accrualsDue(2026, '2026-04-15', '2026-04-01', policy())).toEqual([]);
    expect(accrualsDue(2026, '2026-04-15', '2026-04-20', policy())).toEqual([
      { key: '2026', amount: 10.5, effectiveDate: '2026-04-15' },
    ]);
  });

  it('monthly accrual never drifts: cumulative rounding', () => {
    const p = policy({ accrual: 'monthly', rounding: 'none', entitlement: 14 });
    const entries = accrualsDue(2026, '2020-01-01', '2026-12-31', p);
    expect(entries).toHaveLength(12);
    expect(entries.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(14, 10);
    const toMarch = accrualsDue(2026, '2020-01-01', '2026-03-10', p);
    expect(toMarch.map((e) => e.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(toMarch.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(3.5, 10);
  });

  it('no accrual policy yields nothing', () => {
    expect(accrualsDue(2026, '2020-01-01', '2026-12-31', policy({ accrual: 'none' }))).toEqual([]);
  });
});

describe('carry forward and expiry', () => {
  it('carries the closing balance up to the cap, never negative', () => {
    expect(carryForwardAmount(9, 5)).toBe(5);
    expect(carryForwardAmount(3, 5)).toBe(3);
    expect(carryForwardAmount(-2, 5)).toBe(0);
  });

  it('carried days are used first; the unused part expires', () => {
    expect(carryForwardExpiry(5, 2)).toBe(3);
    expect(carryForwardExpiry(5, 7)).toBe(0);
    expect(carryForwardExpiry(5, 0)).toBe(5);
  });
});
