import { addDays, toBusinessDate, zonedInstant, type BusinessDate } from './time/index';

/**
 * Pure attendance-day calculation (PLAN.md Phase 6). Punches are raw instants; this turns one
 * employee-day into worked / late / early / OT minutes and a status. All thresholds come from
 * the shift (data), and every wall-clock time is interpreted in the tenant timezone.
 */

export interface ShiftRules {
  /** `HH:mm` local. A shift whose end ≤ start (or flagged night) ends the next day. */
  startTime: string;
  endTime: string;
  isNightShift: boolean;
  breakMinutes: number;
  /** The unpaid break is deducted only when the worked span is at least this long. */
  breakAfterMinutes: number;
  graceLateMinutes: number;
  earlyLeaveGraceMinutes: number;
  /** Worked minutes at or above this count as a full day; anything less (but > 0) is half. */
  halfDayThresholdMinutes: number;
  /** OT is paid only if the employee stays at least this long past the shift end. */
  otAfterMinutes: number;
  /** Punches this long before the shift start / after its end still belong to this day. */
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
}

export type DayType = 'workday' | 'weekend' | 'holiday';
export type AttendanceStatus =
  'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'weekend' | 'incomplete';

export interface DayInput {
  date: BusinessDate;
  tz: string;
  /** null = no shift (rest day / no assignment). */
  shift: ShiftRules | null;
  dayType: DayType;
  /** 1, 0.5 or 0 — how much of the day the calendar expects (half Saturday = 0.5). */
  expected: number;
  /** Approved leave covering this day (days). */
  leavePortion: number;
  punches: Date[];
}

export interface DayResult {
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  otMinutes: number;
  /** Portion of the expected day not covered by work or leave (→ no-pay candidate). */
  absentPortion: number;
  status: AttendanceStatus;
}

const MIN = 60_000;
const minutes = (ms: number) => Math.floor(ms / MIN);

/** Shift start/end instants for a date (end rolls to the next day for night shifts). */
export function shiftWindow(date: BusinessDate, tz: string, s: ShiftRules) {
  const start = zonedInstant(date, s.startTime, tz);
  const crosses = s.isNightShift || s.endTime <= s.startTime;
  const end = zonedInstant(crosses ? addDays(date, 1) : date, s.endTime, tz);
  return {
    start,
    end,
    from: new Date(start.getTime() - s.windowBeforeMinutes * MIN),
    to: new Date(end.getTime() + s.windowAfterMinutes * MIN),
  };
}

/** Which instants belong to this day: shift window, or the local calendar day if no shift. */
export function dayWindow(date: BusinessDate, tz: string, shift: ShiftRules | null) {
  if (shift) {
    const w = shiftWindow(date, tz, shift);
    return { from: w.from, to: w.to };
  }
  return { from: zonedInstant(date, '00:00', tz), to: zonedInstant(addDays(date, 1), '00:00', tz) };
}

export function computeDay(input: DayInput): DayResult {
  const { shift, expected } = input;
  const w = dayWindow(input.date, input.tz, shift);
  const punches = input.punches
    .filter((p) => p >= w.from && p < w.to)
    .sort((a, b) => a.getTime() - b.getTime());
  const firstIn = punches[0] ?? null;
  const lastOut = punches.length > 1 ? punches[punches.length - 1]! : null;
  const leave = Math.min(input.leavePortion, expected || input.leavePortion);

  let workedMinutes = 0;
  let lateMinutes = 0;
  let earlyMinutes = 0;
  let otMinutes = 0;

  if (firstIn && lastOut) {
    const span = minutes(lastOut.getTime() - firstIn.getTime());
    const breakMinutes = shift && span >= shift.breakAfterMinutes ? shift.breakMinutes : 0;
    workedMinutes = Math.max(0, span - breakMinutes);
  }

  if (shift && input.dayType === 'workday' && expected > 0) {
    const sw = shiftWindow(input.date, input.tz, shift);
    // Expected half day (e.g. half Saturday): the shift's second half is not expected.
    const expectedEnd =
      expected < 1
        ? new Date(sw.start.getTime() + (sw.end.getTime() - sw.start.getTime()) / 2)
        : sw.end;
    if (firstIn) {
      const late = minutes(firstIn.getTime() - sw.start.getTime());
      lateMinutes = late > shift.graceLateMinutes ? late : 0;
    }
    if (lastOut) {
      const early = minutes(expectedEnd.getTime() - lastOut.getTime());
      earlyMinutes = early > shift.earlyLeaveGraceMinutes ? early : 0;
      const over = minutes(lastOut.getTime() - expectedEnd.getTime());
      otMinutes = over >= shift.otAfterMinutes && over > 0 ? over : 0;
    }
  } else if (input.dayType !== 'workday' || expected === 0) {
    // Work on a rest day or holiday is all overtime (paid at the holiday/rest-day rate).
    otMinutes = workedMinutes;
  }

  if (firstIn && !lastOut) {
    return {
      firstIn,
      lastOut,
      workedMinutes: 0,
      lateMinutes,
      earlyMinutes: 0,
      otMinutes: 0,
      absentPortion: 0,
      status: 'incomplete',
    };
  }

  if (expected === 0) {
    const status: AttendanceStatus =
      workedMinutes > 0 ? 'present' : input.dayType === 'holiday' ? 'holiday' : 'weekend';
    return {
      firstIn,
      lastOut,
      workedMinutes,
      lateMinutes,
      earlyMinutes,
      otMinutes,
      absentPortion: 0,
      status,
    };
  }

  const threshold = shift ? shift.halfDayThresholdMinutes * Math.min(1, expected) : 0;
  const present =
    workedMinutes === 0 ? 0 : workedMinutes >= threshold ? expected : Math.min(0.5, expected);
  const absentPortion = Math.max(0, round2(expected - leave - present));
  let status: AttendanceStatus;
  if (leave >= expected) status = 'on_leave';
  else if (present === 0 && absentPortion >= expected) status = 'absent';
  else if (absentPortion > 0 || (leave > 0 && present < expected)) status = 'half_day';
  else status = 'present';
  return {
    firstIn,
    lastOut,
    workedMinutes,
    lateMinutes,
    earlyMinutes,
    otMinutes,
    absentPortion,
    status,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Business date a punch most likely belongs to when no shift is known (local calendar day). */
export function punchDate(at: Date, tz: string): BusinessDate {
  return toBusinessDate(at, tz);
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** IPv4 address in a CIDR (or exact match). IPv6 supports exact match only. */
export function ipAllowed(ip: string, allowed: string[]): boolean {
  const v4 = ip.replace(/^::ffff:/, '');
  for (const rule of allowed) {
    const [net, bitsRaw] = rule.split('/');
    if (!bitsRaw) {
      if (net === v4 || net === ip) return true;
      continue;
    }
    const toInt = (s: string) => s.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(v4) || !/^\d+\.\d+\.\d+\.\d+$/.test(net ?? '')) continue;
    const bits = Number(bitsRaw);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((toInt(v4) & mask) === (toInt(net!) & mask)) return true;
  }
  return false;
}

/**
 * Parses a fingerprint-device export's date/time into a business date and `HH:mm:ss` wall time
 * (tenant timezone). Dates: YYYY-MM-DD, YYYY/MM/DD, or day-first DD/MM/YYYY (also `-` or `.`), the
 * Sri Lankan convention. Times: HH:mm[:ss] with optional AM/PM. `timestamp` = date and time in one
 * cell. Spreadsheet time-only cells (dated 1899-12-30/31) contribute just their time.
 */
export function parseDeviceTimestamp(input: {
  timestamp?: string | undefined;
  date?: string | undefined;
  time?: string | undefined;
}): { date: string; time: string } | { error: string } {
  let dateRaw = input.date?.trim() ?? '';
  let timeRaw = input.time?.trim() ?? '';
  const ts = input.timestamp?.trim();
  if (ts) {
    const m = /^(\S+)[ T](.+)$/.exec(ts);
    if (!m) return { error: `Cannot read date and time from "${ts}"` };
    dateRaw = m[1]!;
    timeRaw = m[2]!;
  } else {
    // A time cell parsed from a spreadsheet arrives as "1899-12-30 08:15:00".
    const t = /^1899-12-3[01][ T](.+)$/.exec(timeRaw);
    if (t) timeRaw = t[1]!;
    const d = /^(\S+)[ T]00:00(:00)?$/.exec(dateRaw);
    if (d) dateRaw = d[1]!;
  }
  if (!dateRaw || !timeRaw) return { error: 'Date and time are required' };

  let y: number, mo: number, d: number;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(dateRaw);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(dateRaw))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    return { error: `Unrecognised date "${dateRaw}" (use YYYY-MM-DD or DD/MM/YYYY)` };
  }
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date)
    return { error: `Invalid date "${dateRaw}"` };

  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?$/.exec(timeRaw);
  if (!t) return { error: `Unrecognised time "${timeRaw}" (use HH:mm or HH:mm:ss)` };
  let h = Number(t[1]);
  const min = Number(t[2]);
  const sec = Number(t[3] ?? 0);
  const ampm = t[4]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return { error: `Invalid time "${timeRaw}"` };
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  }
  if (h > 23 || min > 59 || sec > 59) return { error: `Invalid time "${timeRaw}"` };
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date, time: `${pad(h)}:${pad(min)}:${pad(sec)}` };
}
