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
