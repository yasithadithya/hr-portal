import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { schema, type TenantDb, type Tx } from '@hr/db';
import { computeDay, dayWindow, type DayType, type ShiftRules } from '@hr/shared/attendance';
import { addDays, dayPortion, eachDay, zonedInstant, type WorkWeek } from '@hr/shared/time';

/**
 * Attendance processing (PLAN.md Phase 6): recomputes `attendance_days` from raw punches, shift
 * assignments / roster, the work calendar and approved leave. Idempotent (an upsert keyed on
 * employee + date with deterministic output) and never touches a locked period.
 */

const {
  attendanceDays,
  attendancePeriods,
  attendancePunches,
  branches,
  employees,
  holidays,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
  rosterEntries,
  shiftAssignments,
  shifts,
  workCalendars,
} = schema;

type Db = TenantDb | Tx;
export type ShiftRow = typeof shifts.$inferSelect;
export type EmployeeRow = typeof employees.$inferSelect;

export const hhmm = (t: string) => t.slice(0, 5);

export function shiftRules(s: ShiftRow): ShiftRules {
  return {
    startTime: hhmm(s.startTime),
    endTime: hhmm(s.endTime),
    isNightShift: s.isNightShift,
    breakMinutes: s.breakMinutes,
    breakAfterMinutes: s.breakAfterMinutes,
    graceLateMinutes: s.graceLateMinutes,
    earlyLeaveGraceMinutes: s.earlyLeaveGraceMinutes,
    halfDayThresholdMinutes: s.halfDayThresholdMinutes,
    otAfterMinutes: s.otAfterMinutes,
    windowBeforeMinutes: s.windowBeforeMinutes,
    windowAfterMinutes: s.windowAfterMinutes,
  };
}

const monthKey = (date: string) => date.slice(0, 7);

/** `YYYY-MM` keys of locked periods touching [from, to]. */
export async function lockedMonths(db: Db, from: string, to: string): Promise<Set<string>> {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  const rows = await db
    .select({ year: attendancePeriods.year, month: attendancePeriods.month })
    .from(attendancePeriods)
    .where(
      and(
        eq(attendancePeriods.status, 'locked'),
        sql`(${attendancePeriods.year} * 12 + ${attendancePeriods.month}) between ${fy * 12 + fm} and ${ty * 12 + tm}`,
      ),
    );
  return new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`));
}

export async function isDateLocked(db: Db, date: string): Promise<boolean> {
  return (await lockedMonths(db, date, date)).has(monthKey(date));
}

/** Everything the day computation needs for a set of employees and dates, loaded in bulk. */
export interface DayContext {
  tz: string;
  shiftsById: Map<string, ShiftRow>;
  calendarOf: (e: EmployeeRow) => { workWeek: WorkWeek; holidays: Set<string> };
  assignments: Map<string, { shiftId: string; from: string; to: string | null }[]>;
  roster: Map<string, string | null>;
}

export async function loadDayContext(
  db: Db,
  tz: string,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<DayContext> {
  const allShifts = await db.select().from(shifts);
  const cals = await db.select().from(workCalendars);
  const branchRows = await db
    .select({ id: branches.id, calendarId: branches.calendarId })
    .from(branches);
  const hols = await db
    .select({ calendarId: holidays.calendarId, date: holidays.date })
    .from(holidays)
    .where(and(gte(holidays.date, from), lte(holidays.date, to)));
  const holsByCal = new Map<string, Set<string>>();
  for (const h of hols) {
    if (!holsByCal.has(h.calendarId)) holsByCal.set(h.calendarId, new Set());
    holsByCal.get(h.calendarId)!.add(h.date);
  }
  const calById = new Map(cals.map((c) => [c.id, c]));
  const defaultCal = cals.find((c) => c.isDefault) ?? cals[0];
  const branchCal = new Map(branchRows.map((b) => [b.id, b.calendarId]));

  const assignRows = employeeIds.length
    ? await db
        .select()
        .from(shiftAssignments)
        .where(
          and(
            inArray(shiftAssignments.employeeId, employeeIds),
            lte(shiftAssignments.effectiveFrom, to),
            or(isNull(shiftAssignments.effectiveTo), gte(shiftAssignments.effectiveTo, from)),
          ),
        )
    : [];
  const assignments = new Map<string, { shiftId: string; from: string; to: string | null }[]>();
  for (const a of assignRows) {
    if (!assignments.has(a.employeeId)) assignments.set(a.employeeId, []);
    assignments
      .get(a.employeeId)!
      .push({ shiftId: a.shiftId, from: a.effectiveFrom, to: a.effectiveTo });
  }

  const rosterRows = employeeIds.length
    ? await db
        .select()
        .from(rosterEntries)
        .where(
          and(
            inArray(rosterEntries.employeeId, employeeIds),
            gte(rosterEntries.date, from),
            lte(rosterEntries.date, to),
          ),
        )
    : [];
  const roster = new Map(rosterRows.map((r) => [`${r.employeeId}:${r.date}`, r.shiftId]));

  return {
    tz,
    shiftsById: new Map(allShifts.map((s) => [s.id, s])),
    calendarOf: (e) => {
      const calId = (e.branchId && branchCal.get(e.branchId)) || defaultCal?.id;
      const cal = calId ? calById.get(calId) : undefined;
      if (!cal) throw new Error('No work calendar configured');
      return { workWeek: cal.workWeek as WorkWeek, holidays: holsByCal.get(cal.id) ?? new Set() };
    },
    assignments,
    roster,
  };
}

/** The shift and expectation for one employee-day. Roster beats assignment; holidays beat both. */
export function planDay(c: DayContext, e: EmployeeRow, date: string) {
  const cal = c.calendarOf(e);
  const rosterKey = `${e.id}:${date}`;
  const rostered = c.roster.has(rosterKey);
  const rosterShift = c.roster.get(rosterKey) ?? null;
  const assigned = c.assignments
    .get(e.id)
    ?.find((a) => a.from <= date && (a.to === null || a.to >= date));
  const shiftId = rostered ? rosterShift : (assigned?.shiftId ?? null);
  const shift = shiftId ? (c.shiftsById.get(shiftId) ?? null) : null;

  let dayType: DayType;
  let expected: number;
  if (cal.holidays.has(date)) {
    dayType = 'holiday';
    expected = 0;
  } else if (rostered) {
    dayType = rosterShift ? 'workday' : 'weekend';
    expected = rosterShift ? 1 : 0;
  } else {
    const portion = dayPortion(date, cal.workWeek);
    dayType = portion === 'off' ? 'weekend' : 'workday';
    expected = portion === 'full' ? 1 : portion === 'half' ? 0.5 : 0;
  }
  return { shift, dayType, expected };
}

export interface ProcessResult {
  processed: number;
  skippedLocked: number;
}

/**
 * Recomputes days in [from, to] (capped at `today`: future days have nothing to compute).
 * `employeeIds` limits the run; omitted = every employee employed in the range.
 */
export async function processRange(
  db: Db,
  opts: {
    tz: string;
    from: string;
    to: string;
    today: string;
    employeeIds?: string[];
    /**
     * Screens pass true: compute only days that have no row yet. Changes that affect existing
     * days (punches, imports, leave, corrections, roster, assignments, shift rules) reprocess
     * explicitly, the nightly job finalises yesterday, and lock/Recalculate do a full pass.
     */
    onlyMissing?: boolean;
  },
): Promise<ProcessResult> {
  const { tz, from } = opts;
  const to = opts.to > opts.today ? opts.today : opts.to;
  if (to < from) return { processed: 0, skippedLocked: 0 };
  if (opts.employeeIds && !opts.employeeIds.length) return { processed: 0, skippedLocked: 0 };

  const locked = await lockedMonths(db, from, to);
  const staff = await db
    .select()
    .from(employees)
    .where(
      and(
        isNull(employees.archivedAt),
        lte(employees.joinDate, to),
        or(isNull(employees.exitDate), gte(employees.exitDate, from)),
        opts.employeeIds ? inArray(employees.id, opts.employeeIds) : undefined,
      ),
    );
  if (!staff.length) return { processed: 0, skippedLocked: 0 };
  let missing: Set<string> | null = null;
  if (opts.onlyMissing) {
    const have = await db
      .select({ e: attendanceDays.employeeId, d: attendanceDays.date })
      .from(attendanceDays)
      .where(
        and(
          inArray(
            attendanceDays.employeeId,
            staff.map((e) => e.id),
          ),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, to),
        ),
      );
    const haveSet = new Set(have.map((r) => `${r.e}:${r.d}`));
    missing = new Set();
    for (const e of staff)
      for (const date of eachDay(from, to)) {
        if (date < e.joinDate || (e.exitDate && date > e.exitDate)) continue;
        if (locked.has(monthKey(date)) || haveSet.has(`${e.id}:${date}`)) continue;
        missing.add(`${e.id}:${date}`);
      }
    if (!missing.size) return { processed: 0, skippedLocked: 0 };
    const need = new Set([...missing].map((k) => k.split(':')[0]));
    staff.splice(0, staff.length, ...staff.filter((e) => need.has(e.id)));
  }
  const ids = staff.map((e) => e.id);
  const c = await loadDayContext(db, tz, ids, from, to);

  // Approved day-based leave (hour-unit short leave doesn't change the day's expectation).
  const leaveRows = await db
    .select({
      employeeId: leaveRequests.employeeId,
      date: leaveRequestDays.date,
      portion: leaveRequestDays.portion,
    })
    .from(leaveRequestDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        inArray(leaveRequests.employeeId, ids),
        eq(leaveRequests.status, 'approved'),
        sql`${leaveTypes.unit} <> 'hour'`,
        gte(leaveRequestDays.date, from),
        lte(leaveRequestDays.date, to),
      ),
    );
  const leave = new Map<string, number>();
  for (const l of leaveRows) {
    const k = `${l.employeeId}:${l.date}`;
    leave.set(k, (leave.get(k) ?? 0) + Number(l.portion));
  }

  // Punches from the day before (night shifts) to two days after (late outs).
  const punchRows = await db
    .select({
      employeeId: attendancePunches.employeeId,
      at: attendancePunches.at,
      source: attendancePunches.source,
    })
    .from(attendancePunches)
    .where(
      and(
        inArray(attendancePunches.employeeId, ids),
        eq(attendancePunches.accepted, true),
        gte(attendancePunches.at, zonedInstant(addDays(from, -1), '00:00', tz)),
        lt(attendancePunches.at, zonedInstant(addDays(to, 2), '00:00', tz)),
      ),
    );
  const punches = new Map<string, { at: Date; source: string }[]>();
  for (const p of punchRows) {
    if (!punches.has(p.employeeId)) punches.set(p.employeeId, []);
    punches.get(p.employeeId)!.push({ at: p.at, source: p.source });
  }

  const rows: (typeof attendanceDays.$inferInsert)[] = [];
  let skippedLocked = 0;
  for (const e of staff) {
    const mine = punches.get(e.id) ?? [];
    for (const date of eachDay(from, to)) {
      if (date < e.joinDate || (e.exitDate && date > e.exitDate)) continue;
      if (locked.has(monthKey(date))) {
        skippedLocked++;
        continue;
      }
      if (missing && !missing.has(`${e.id}:${date}`)) continue;
      const plan = planDay(c, e, date);
      const rules = plan.shift ? shiftRules(plan.shift) : null;
      const leavePortion = plan.dayType === 'workday' ? (leave.get(`${e.id}:${date}`) ?? 0) : 0;
      const w = dayWindow(date, tz, rules);
      const inWindow = mine.filter((p) => p.at >= w.from && p.at < w.to);
      const r = computeDay({
        date,
        tz,
        shift: rules,
        dayType: plan.dayType,
        expected: plan.expected,
        leavePortion,
        punches: inWindow.map((p) => p.at),
      });
      const sourceSummary: Record<string, number> = {};
      for (const p of inWindow) sourceSummary[p.source] = (sourceSummary[p.source] ?? 0) + 1;
      rows.push({
        employeeId: e.id,
        date,
        shiftId: plan.shift?.id ?? null,
        dayType: plan.dayType,
        expected: String(plan.expected),
        leavePortion: String(Math.min(leavePortion, 1)),
        firstIn: r.firstIn,
        lastOut: r.lastOut,
        workedMinutes: r.workedMinutes,
        lateMinutes: r.lateMinutes,
        earlyMinutes: r.earlyMinutes,
        otMinutes: r.otMinutes,
        absentPortion: String(r.absentPortion),
        status: r.status,
        sourceSummary,
      });
    }
  }

  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(attendanceDays)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [attendanceDays.employeeId, attendanceDays.date],
        set: {
          shiftId: sql`excluded.shift_id`,
          dayType: sql`excluded.day_type`,
          expected: sql`excluded.expected`,
          leavePortion: sql`excluded.leave_portion`,
          firstIn: sql`excluded.first_in`,
          lastOut: sql`excluded.last_out`,
          workedMinutes: sql`excluded.worked_minutes`,
          lateMinutes: sql`excluded.late_minutes`,
          earlyMinutes: sql`excluded.early_minutes`,
          otMinutes: sql`excluded.ot_minutes`,
          // An OT approval never exceeds the (re)computed OT.
          otApprovedMinutes: sql`case when ${attendanceDays.otApprovedMinutes} is null then null else least(${attendanceDays.otApprovedMinutes}, excluded.ot_minutes) end`,
          absentPortion: sql`excluded.absent_portion`,
          status: sql`excluded.status`,
          sourceSummary: sql`excluded.source_summary`,
          updatedAt: sql`now()`,
        },
        // Skip rows whose computed values are unchanged: reprocessing is mostly a no-op, and
        // rewriting 1,000 identical rows per board load was the slowest path at scale.
        setWhere: sql`${attendanceDays.isLocked} = false and (
          attendance_days.shift_id, attendance_days.day_type, attendance_days.expected,
          attendance_days.leave_portion, attendance_days.first_in, attendance_days.last_out,
          attendance_days.worked_minutes, attendance_days.late_minutes, attendance_days.early_minutes,
          attendance_days.ot_minutes, attendance_days.absent_portion, attendance_days.status,
          attendance_days.source_summary
        ) is distinct from (
          excluded.shift_id, excluded.day_type, excluded.expected, excluded.leave_portion,
          excluded.first_in, excluded.last_out, excluded.worked_minutes, excluded.late_minutes,
          excluded.early_minutes, excluded.ot_minutes, excluded.absent_portion, excluded.status,
          excluded.source_summary
        )`,
      });
  }
  return { processed: rows.length, skippedLocked };
}
