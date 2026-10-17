import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';

/**
 * Tenant-timezone date helpers (CLAUDE.md Hard Rule 3).
 *
 * A "business date" is a calendar day with no time, represented as `YYYY-MM-DD`
 * (matches Postgres `date`). Day-of-week is derived from the date string itself,
 * so the result never depends on the server's or browser's local timezone.
 */

/** Default tenant timezone; a tenant setting overrides it. */
export const DEFAULT_TZ = 'Asia/Colombo';

export type BusinessDate = string;

export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .refine((s) => isValidBusinessDate(s), 'Invalid calendar date');

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type DayPortion = 'full' | 'half' | 'off';

/** Which days are worked; stored per work calendar in tenant config. */
export type WorkWeek = Record<Weekday, DayPortion>;

export const workWeekSchema = z.object(
  Object.fromEntries(WEEKDAYS.map((d) => [d, z.enum(['full', 'half', 'off'])])) as Record<
    Weekday,
    z.ZodEnum<{ full: 'full'; half: 'half'; off: 'off' }>
  >,
);

const MS_PER_DAY = 86_400_000;

function parseUtc(date: BusinessDate): Date {
  if (!isValidBusinessDate(date)) {
    throw new RangeError(`Invalid business date: ${date}`);
  }
  return new Date(`${date}T00:00:00Z`);
}

function formatUtc(d: Date): BusinessDate {
  return d.toISOString().slice(0, 10);
}

export function isValidBusinessDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && formatUtc(d) === s;
}

/** The business date of an instant as seen in the given timezone. */
export function toBusinessDate(instant: Date, tz: string): BusinessDate {
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd');
}

/** Today's business date in the tenant timezone. */
export function today(tz: string, now: Date = new Date()): BusinessDate {
  return toBusinessDate(now, tz);
}

export function weekdayOf(date: BusinessDate): Weekday {
  return WEEKDAYS[parseUtc(date).getUTCDay()]!;
}

export function dayPortion(date: BusinessDate, workWeek: WorkWeek): DayPortion {
  return workWeek[weekdayOf(date)];
}

/** True when the work week marks this weekday as fully off. Half days are not weekends. */
export function isWeekend(date: BusinessDate, workWeek: WorkWeek): boolean {
  return dayPortion(date, workWeek) === 'off';
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  return formatUtc(new Date(parseUtc(date).getTime() + days * MS_PER_DAY));
}

/** Every business date from start to end, inclusive. Empty if end < start. */
export function eachDay(start: BusinessDate, end: BusinessDate): BusinessDate[] {
  const out: BusinessDate[] = [];
  const endMs = parseUtc(end).getTime();
  for (let ms = parseUtc(start).getTime(); ms <= endMs; ms += MS_PER_DAY) {
    out.push(formatUtc(new Date(ms)));
  }
  return out;
}

/** Working value of a day: 1 full, 0.5 half, 0 for off days and holidays. */
export function workingValue(
  date: BusinessDate,
  workWeek: WorkWeek,
  holidays: ReadonlySet<BusinessDate>,
): 0 | 0.5 | 1 {
  if (holidays.has(date)) return 0;
  const portion = dayPortion(date, workWeek);
  return portion === 'full' ? 1 : portion === 'half' ? 0.5 : 0;
}

/**
 * Working days between start and end inclusive, for a work calendar and its holidays.
 * Half days count 0.5. Uses calendar dates only, never server-local time.
 */
export function countWorkingDays(
  start: BusinessDate,
  end: BusinessDate,
  workWeek: WorkWeek,
  holidays: ReadonlySet<BusinessDate> = new Set(),
): number {
  return eachDay(start, end).reduce((sum, d) => sum + workingValue(d, workWeek, holidays), 0);
}

/** First and last day of a calendar month. */
export function monthRange(
  year: number,
  month: number,
): { start: BusinessDate; end: BusinessDate } {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid month ${month}`);
  }
  const mm = String(month).padStart(2, '0');
  const start = `${String(year).padStart(4, '0')}-${mm}-01`;
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, end: addDays(next, -1) };
}
