import Decimal from 'decimal.js';

import { addDays, eachDay, workingValue, type BusinessDate, type WorkWeek } from './time/index';

/**
 * Pure leave arithmetic (no DB). Every number that varies between employers — entitlements,
 * proration, rounding, eligibility — comes in through the policy (CLAUDE.md Hard Rule 1).
 */

export type Half = 'full' | 'first' | 'second';
export type LeaveUnit = 'day' | 'half_day' | 'hour';
export type LeaveRounding = 'none' | 'nearest_half' | 'floor_half' | 'floor_day' | 'nearest_day';
export type Proration = 'none' | 'monthly' | 'daily';
export type Accrual = 'upfront_yearly' | 'monthly' | 'none';

export interface RequestDay {
  date: BusinessDate;
  /** Days for day/half_day units, hours for hour units. */
  portion: number;
  half: Half;
}

export class LeaveRuleError extends Error {
  override name = 'LeaveRuleError';
}

/**
 * Expands a request into the working days it consumes.
 *  - start_half 'second' = leave from the afternoon of the start date (0.5)
 *  - end_half 'first'    = back in the afternoon of the end date (0.5)
 *  - a one-day request with half 'first'/'second' is that half only
 *  - off days and holidays cost nothing; a half working day (e.g. Saturday) costs at most 0.5
 */
export function requestDays(
  input: {
    start: BusinessDate;
    end: BusinessDate;
    startHalf: Half;
    endHalf: Half;
    unit: LeaveUnit;
    hours?: number | null;
  },
  workWeek: WorkWeek,
  holidays: ReadonlySet<BusinessDate>,
): { days: RequestDay[]; amount: number } {
  if (input.end < input.start) throw new LeaveRuleError('End date is before the start date');

  if (input.unit === 'hour') {
    if (input.start !== input.end) throw new LeaveRuleError('Short leave is for a single day');
    const hours = input.hours ?? 0;
    if (!(hours > 0)) throw new LeaveRuleError('Enter the number of hours');
    if (workingValue(input.start, workWeek, holidays) === 0) {
      throw new LeaveRuleError('That day is not a working day');
    }
    return { days: [{ date: input.start, portion: hours, half: 'full' }], amount: hours };
  }

  const single = input.start === input.end;
  if (input.unit === 'day' && (input.startHalf !== 'full' || input.endHalf !== 'full')) {
    throw new LeaveRuleError('This leave type is taken in whole days');
  }
  if (!single && input.startHalf === 'first') {
    throw new LeaveRuleError('A multi-day request can only start in the afternoon (second half)');
  }
  if (!single && input.endHalf === 'second') {
    throw new LeaveRuleError('A multi-day request can only end at midday (first half)');
  }

  const days: RequestDay[] = [];
  for (const date of eachDay(input.start, input.end)) {
    const value = workingValue(date, workWeek, holidays);
    if (value === 0) continue;
    let portion: number = value;
    let half: Half = 'full';
    if (single && input.startHalf !== 'full') {
      portion = Math.min(0.5, value);
      half = input.startHalf;
    } else if (date === input.start && input.startHalf === 'second') {
      portion = Math.min(0.5, value);
      half = 'second';
    } else if (date === input.end && input.endHalf === 'first') {
      portion = Math.min(0.5, value);
      half = 'first';
    }
    days.push({ date, portion, half });
  }
  const amount = days.reduce((s, d) => s.plus(d.portion), new Decimal(0)).toNumber();
  return { days, amount };
}

export function roundLeave(value: Decimal.Value, mode: LeaveRounding): number {
  const d = new Decimal(value);
  switch (mode) {
    case 'none':
      return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    case 'nearest_half':
      return d.times(2).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).div(2).toNumber();
    case 'floor_half':
      return d.times(2).toDecimalPlaces(0, Decimal.ROUND_FLOOR).div(2).toNumber();
    case 'floor_day':
      return d.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber();
    case 'nearest_day':
      return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }
}

/** Adds whole months to a date, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: BusinessDate, months: number): BusinessDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export interface PolicyInput {
  entitlement: Decimal.Value;
  accrual: Accrual;
  prorationOnJoin: Proration;
  rounding: LeaveRounding;
  eligibleAfterMonths: number;
}

/** The date an employee becomes eligible for a policy. */
export function eligibleFrom(
  joinDate: BusinessDate,
  policy: Pick<PolicyInput, 'eligibleAfterMonths'>,
) {
  return addMonths(joinDate, policy.eligibleAfterMonths);
}

/**
 * Entitlement for a whole leave year (calendar year), allowing for the year in which the employee
 * joins / becomes eligible. Proration: `monthly` counts the start month as a full month; `daily`
 * counts days from the start date.
 */
export function yearlyEntitlement(year: number, joinDate: BusinessDate, p: PolicyInput): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const from = eligibleFrom(joinDate, p);
  if (from > yearEnd) return 0;
  const full = new Decimal(p.entitlement);
  if (from <= yearStart || p.prorationOnJoin === 'none') return roundLeave(full, p.rounding);
  if (p.prorationOnJoin === 'monthly') {
    const startMonth = Number(from.slice(5, 7));
    return roundLeave(full.times(13 - startMonth).div(12), p.rounding);
  }
  const daysInYear = eachDay(yearStart, yearEnd).length;
  const remaining = eachDay(from, yearEnd).length;
  return roundLeave(full.times(remaining).div(daysInYear), p.rounding);
}

export interface AccrualEntry {
  /** Stable key for idempotent inserts. */
  key: string;
  amount: number;
  effectiveDate: BusinessDate;
}

/**
 * Accrual ledger entries due for `year` as of `asOf`. Upfront policies credit the year's full
 * (prorated) entitlement once; monthly policies credit 1/12 per month from the eligibility month,
 * computed on the cumulative total so rounding never drifts.
 */
export function accrualsDue(
  year: number,
  joinDate: BusinessDate,
  asOf: BusinessDate,
  p: PolicyInput,
): AccrualEntry[] {
  if (p.accrual === 'none') return [];
  const from = eligibleFrom(joinDate, p);
  const yearStart = `${year}-01-01`;
  if (from > `${year}-12-31` || asOf < yearStart) return [];

  if (p.accrual === 'upfront_yearly') {
    if (asOf < from) return [];
    const amount = yearlyEntitlement(year, joinDate, p);
    return amount === 0
      ? []
      : [{ key: `${year}`, amount, effectiveDate: from > yearStart ? from : yearStart }];
  }

  // monthly
  const firstMonth = from > yearStart ? Number(from.slice(5, 7)) : 1;
  const lastMonth =
    asOf.slice(0, 4) === String(year) ? Number(asOf.slice(5, 7)) : asOf > `${year}-12-31` ? 12 : 0;
  const entries: AccrualEntry[] = [];
  const monthly = new Decimal(p.entitlement).div(12);
  for (let m = firstMonth; m <= lastMonth; m++) {
    const cumulative = roundLeave(monthly.times(m - firstMonth + 1), p.rounding);
    const previous = roundLeave(monthly.times(m - firstMonth), p.rounding);
    const amount = new Decimal(cumulative).minus(previous).toNumber();
    if (amount !== 0) {
      entries.push({
        key: `${year}-${String(m).padStart(2, '0')}`,
        amount,
        effectiveDate: `${year}-${String(m).padStart(2, '0')}-01`,
      });
    }
  }
  return entries;
}

/**
 * Carried-forward leave that expires: carried days are used first (FIFO), so what expires is
 * whatever of the carried amount wasn't taken before the expiry date.
 */
export function carryForwardExpiry(carried: number, takenBeforeExpiry: number): number {
  return Math.max(0, new Decimal(carried).minus(Math.max(0, takenBeforeExpiry)).toNumber());
}

export function carryForwardAmount(closingBalance: number, max: number): number {
  return Math.max(0, Math.min(closingBalance, max));
}

export const leaveYearOf = (date: BusinessDate) => Number(date.slice(0, 4));

export { addDays };
