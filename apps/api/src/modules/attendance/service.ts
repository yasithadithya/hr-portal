import { aliasedTable, and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { schema, withAudit, type TenantDb, type Tx } from '@hr/db';
import {
  CURRENT_STATUSES,
  scopeCovers,
  type AttendanceDay,
  type AttendanceToday,
  type clockSchema,
  type ClockResult,
  type Punch,
  type Regularization,
  type regularizationInputSchema,
} from '@hr/shared';
import { dayWindow, distanceMetres, ipAllowed } from '@hr/shared/attendance';
import { addDays, zonedInstant } from '@hr/shared/time';

import type { AuthedUser, RequestContext } from '../../context';
import { approvalSteps, nextStep, waitingFor, type TrailEntry } from '../../lib/approvals';
import { AppError } from '../../lib/errors';
import { getSettings } from '../company/routes';
import { tenantToday } from '../employees/service';

import {
  hhmm,
  isDateLocked,
  loadDayContext,
  planDay,
  processRange,
  shiftRules,
  type EmployeeRow,
} from './process';

const {
  attendanceDays,
  attendancePunches,
  branches,
  departments,
  employees,
  regularizationRequests,
  shifts,
} = schema;

type Ctx = RequestContext & { user: AuthedUser };
type Db = TenantDb | Tx;
type DayRow = typeof attendanceDays.$inferSelect;
type PunchRow = typeof attendancePunches.$inferSelect;
type RegRow = typeof regularizationRequests.$inferSelect;

/** Clicks within this many seconds of an accepted punch are treated as a double-tap, not a punch. */
const DOUBLE_TAP_SECONDS = 60;

export const lockedError = () => new AppError(409, 'CONFLICT', 'That attendance month is locked');

// ── DTOs ────────────────────────────────────────────────────────────────────
export function punchDto(p: PunchRow): Punch {
  return {
    id: p.id,
    employeeId: p.employeeId,
    at: p.at.toISOString(),
    source: p.source,
    accepted: p.accepted,
    rejectReason: p.rejectReason,
    note: p.note,
    lat: p.lat,
    lng: p.lng,
    ip: p.ip,
  };
}

export async function dayDtos(db: Db, rows: DayRow[]): Promise<AttendanceDay[]> {
  if (!rows.length) return [];
  const dept = aliasedTable(departments, 'dept');
  const emps = await db
    .select({ e: employees, department: dept.name })
    .from(employees)
    .leftJoin(dept, eq(dept.id, employees.departmentId))
    .where(inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))]));
  const byId = new Map(emps.map((x) => [x.e.id, x]));
  const shiftIds = [...new Set(rows.flatMap((r) => (r.shiftId ? [r.shiftId] : [])))];
  const shiftRows = shiftIds.length
    ? await db.select().from(shifts).where(inArray(shifts.id, shiftIds))
    : [];
  const shiftById = new Map(shiftRows.map((s) => [s.id, s]));
  return rows.map((r) => {
    const x = byId.get(r.employeeId)!;
    const s = r.shiftId ? shiftById.get(r.shiftId) : undefined;
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeNo: x.e.employeeNo,
      employeeName: `${x.e.firstName} ${x.e.lastName}`,
      department: x.department,
      date: r.date,
      shift: s ? { id: s.id, code: s.code, name: s.name } : null,
      dayType: r.dayType,
      expected: Number(r.expected),
      leavePortion: Number(r.leavePortion),
      firstIn: r.firstIn?.toISOString() ?? null,
      lastOut: r.lastOut?.toISOString() ?? null,
      workedMinutes: r.workedMinutes,
      lateMinutes: r.lateMinutes,
      earlyMinutes: r.earlyMinutes,
      otMinutes: r.otMinutes,
      otApprovedMinutes: r.otApprovedMinutes,
      absentPortion: Number(r.absentPortion),
      status: r.status,
      isLocked: r.isLocked,
    };
  });
}

export async function regDtos(db: Db, rows: RegRow[]): Promise<Regularization[]> {
  if (!rows.length) return [];
  const emps = await db
    .select()
    .from(employees)
    .where(inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))]));
  const byId = new Map(emps.map((e) => [e.id, e]));
  const steps = await approvalSteps(db, 'attendance');
  return rows.map((r) => {
    const e = byId.get(r.employeeId)!;
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${e.firstName} ${e.lastName}`,
      employeeNo: e.employeeNo,
      date: r.date,
      requestedIn: r.requestedIn?.toISOString() ?? null,
      requestedOut: r.requestedOut?.toISOString() ?? null,
      reason: r.reason,
      status: r.status,
      waitingFor: waitingFor(r.status, r.currentApproverEmployeeId, steps, r.currentStep),
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

// ── Processing helpers ──────────────────────────────────────────────────────
/** Reprocess one employee around a date (the day before covers night shifts ending today). */
export async function reprocessAround(
  ctx: RequestContext,
  db: Db,
  employeeId: string,
  from: string,
  to = from,
) {
  return processRange(db, {
    tz: ctx.tenant.timezone,
    from: addDays(from, -1),
    to,
    today: tenantToday(ctx),
    employeeIds: [employeeId],
  });
}

/**
 * The business date a punch at `now` belongs to: yesterday if `now` is still inside yesterday's
 * shift window (night shifts), else today.
 */
async function workDate(ctx: RequestContext, db: Db, e: EmployeeRow, now: Date) {
  const tz = ctx.tenant.timezone;
  const today = tenantToday(ctx);
  const yesterday = addDays(today, -1);
  const c = await loadDayContext(db, tz, [e.id], yesterday, today);
  const y = planDay(c, e, yesterday);
  if (y.shift) {
    const w = dayWindow(yesterday, tz, shiftRules(y.shift));
    const t = planDay(c, e, today);
    const tw = dayWindow(today, tz, t.shift ? shiftRules(t.shift) : null);
    if (now >= w.from && now < w.to && !(now >= tw.from && t.shift)) {
      return { date: yesterday, plan: y };
    }
  }
  return { date: today, plan: planDay(c, e, today) };
}

async function linkedEmployee(ctx: Ctx, db: Db) {
  if (!ctx.user.employeeId) throw AppError.badRequest('Your account is not linked to an employee');
  const [e] = await db.select().from(employees).where(eq(employees.id, ctx.user.employeeId));
  if (!e) throw AppError.badRequest('Your account is not linked to an employee');
  return e;
}

async function branchChecks(db: Db, e: EmployeeRow) {
  if (!e.branchId) return { branch: null, geofence: false, ip: false };
  const [b] = await db.select().from(branches).where(eq(branches.id, e.branchId));
  if (!b) return { branch: null, geofence: false, ip: false };
  return {
    branch: b,
    geofence: b.geoLat !== null && b.geoLng !== null && b.geoRadiusM !== null,
    ip: b.allowedIps.length > 0,
  };
}

// ── Clock ───────────────────────────────────────────────────────────────────
/** Accepted punches inside a day's window, oldest first. */
async function dayPunches(ctx: RequestContext, db: Db, e: EmployeeRow, date: string) {
  const c = await loadDayContext(db, ctx.tenant.timezone, [e.id], date, date);
  const p = planDay(c, e, date);
  const w = dayWindow(date, ctx.tenant.timezone, p.shift ? shiftRules(p.shift) : null);
  return db
    .select()
    .from(attendancePunches)
    .where(
      and(
        eq(attendancePunches.employeeId, e.id),
        gte(attendancePunches.at, w.from),
        lt(attendancePunches.at, w.to),
      ),
    )
    .orderBy(asc(attendancePunches.at));
}

export async function today(ctx: Ctx): Promise<AttendanceToday> {
  const tz = ctx.tenant.timezone;
  const base = {
    date: tenantToday(ctx),
    timezone: tz,
    shift: null,
    punches: [],
    nextAction: 'in' as const,
    day: null,
    checks: { geofence: false, ip: false },
  };
  if (!ctx.user.employeeId) return { ...base, linked: false, canClock: false };
  const e = await linkedEmployee(ctx, ctx.db);
  const { date, plan } = await workDate(ctx, ctx.db, e, new Date());
  const punches = await dayPunches(ctx, ctx.db, e, date);
  const accepted = punches.filter((p) => p.accepted).length;
  const [day] = await ctx.db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, e.id), eq(attendanceDays.date, date)));
  const checks = await branchChecks(ctx.db, e);
  return {
    date,
    timezone: tz,
    linked: true,
    canClock: (CURRENT_STATUSES as string[]).includes(e.status),
    shift: plan.shift
      ? {
          code: plan.shift.code,
          name: plan.shift.name,
          startTime: hhmm(plan.shift.startTime),
          endTime: hhmm(plan.shift.endTime),
        }
      : null,
    punches: punches.map(punchDto),
    nextAction: accepted % 2 === 0 ? 'in' : 'out',
    day: day ? ((await dayDtos(ctx.db, [day]))[0] ?? null) : null,
    checks: { geofence: checks.geofence, ip: checks.ip },
  };
}

/**
 * PWA / web clock-in (PLAN.md Phase 6). Validates the branch geofence and/or IP allowlist;
 * rejected punches are stored with the reason (useful for disputes) and never count.
 */
export async function clock(
  ctx: Ctx,
  input: z.output<typeof clockSchema>,
  ip: string | null,
): Promise<ClockResult> {
  const now = new Date();
  const result = await withAudit(ctx.db, ctx.actor, 'attendance_punches', async (tx) => {
    // Serialise this employee's punches (double-taps from two tabs).
    const [e] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, ctx.user.employeeId ?? '00000000-0000-0000-0000-000000000000'))
      .for('update');
    if (!e) throw AppError.badRequest('Your account is not linked to an employee');
    if (!(CURRENT_STATUSES as string[]).includes(e.status))
      throw AppError.forbidden('You are no longer employed here');

    const [last] = await tx
      .select({ at: attendancePunches.at })
      .from(attendancePunches)
      .where(and(eq(attendancePunches.employeeId, e.id), eq(attendancePunches.accepted, true)))
      .orderBy(sql`${attendancePunches.at} desc`)
      .limit(1);
    if (last && now.getTime() - last.at.getTime() < DOUBLE_TAP_SECONDS * 1000) {
      throw AppError.badRequest('You just clocked — wait a minute before clocking again');
    }

    const checks = await branchChecks(tx, e);
    const failures: string[] = [];
    let geoOk: boolean | null = null;
    let ipOk: boolean | null = null;
    if (checks.geofence && checks.branch) {
      const b = checks.branch;
      if (input.lat === null || input.lat === undefined || input.lng == null) {
        geoOk = false;
        failures.push(
          input.locationError
            ? `Location is needed to clock in at ${b.name} (${input.locationError}). Allow location access and try again.`
            : `Location is needed to clock in at ${b.name}. Allow location access and try again.`,
        );
      } else {
        const d = distanceMetres(
          { lat: input.lat, lng: input.lng },
          { lat: Number(b.geoLat), lng: Number(b.geoLng) },
        );
        geoOk = d <= b.geoRadiusM!;
        if (!geoOk)
          failures.push(
            `You are about ${Math.round(d)} m from ${b.name}; clock-in is allowed within ${b.geoRadiusM} m.`,
          );
      }
    }
    if (checks.ip && checks.branch) {
      ipOk = !!ip && ipAllowed(ip, checks.branch.allowedIps);
      if (!ipOk)
        failures.push(`Clock-in at ${checks.branch.name} works only on the office network.`);
    }
    const settings = await getSettings(tx);
    const results = [geoOk, ipOk].filter((r): r is boolean => r !== null);
    const accepted =
      results.length === 0 ||
      (settings['attendance.branch_check'] === 'both'
        ? results.every(Boolean)
        : results.some(Boolean));
    const rejectReason = accepted ? null : failures.join(' ');

    const [punch] = await tx
      .insert(attendancePunches)
      .values({
        employeeId: e.id,
        at: now,
        source: input.source,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracy ?? null,
        ip,
        accepted,
        rejectReason,
        createdBy: ctx.user.id,
      })
      .returning();
    if (accepted) await reprocessAround(ctx, tx, e.id, tenantToday(ctx));
    return {
      action: accepted ? 'clock' : 'clock_rejected',
      entityId: punch!.id,
      after: punch,
      result: { punch: punch!, accepted, rejectReason },
    };
  });
  return {
    punch: punchDto(result.punch),
    accepted: result.accepted,
    message: result.accepted
      ? `Clocked at ${result.punch.at.toISOString()}`
      : (result.rejectReason ?? 'Clock-in rejected'),
  };
}

// ── Regularisation ──────────────────────────────────────────────────────────
type RegInput = z.output<typeof regularizationInputSchema>;

export async function applyRegularization(ctx: Ctx, input: RegInput): Promise<RegRow> {
  const self = ctx.user.employeeId;
  let employeeId = self;
  if (input.employeeId && input.employeeId !== self) {
    const scope = ctx.permissions['attendance.manage'];
    if (!scope || !scopeCovers(scope, 'all'))
      throw AppError.forbidden('Only HR can request corrections for others');
    employeeId = input.employeeId;
  }
  if (!employeeId) throw AppError.badRequest('Your account is not linked to an employee');
  const tz = ctx.tenant.timezone;
  if (input.date > tenantToday(ctx)) throw AppError.badRequest('That date is in the future');
  const requestedIn = input.requestedIn ? zonedInstant(input.date, input.requestedIn, tz) : null;
  const requestedOut = input.requestedOut
    ? zonedInstant(input.outNextDay ? addDays(input.date, 1) : input.date, input.requestedOut, tz)
    : null;
  if (requestedIn && requestedOut && requestedOut <= requestedIn)
    throw AppError.badRequest('The out time must be after the in time');
  if (requestedOut && requestedOut > new Date())
    throw AppError.badRequest('The out time is in the future');

  return withAudit(ctx.db, ctx.actor, 'regularization_requests', async (tx) => {
    const [e] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for('update');
    if (!e) throw AppError.notFound('Employee not found');
    if (input.date < e.joinDate) throw AppError.badRequest('That date is before the join date');
    if (await isDateLocked(tx, input.date)) throw lockedError();
    const [open] = await tx
      .select({ id: regularizationRequests.id })
      .from(regularizationRequests)
      .where(
        and(
          eq(regularizationRequests.employeeId, employeeId),
          eq(regularizationRequests.date, input.date),
          eq(regularizationRequests.status, 'pending'),
        ),
      );
    if (open) throw AppError.badRequest('There is already a pending correction for that date');
    const steps = await approvalSteps(tx, 'attendance');
    const next = nextStep(steps, 0, e);
    const [r] = await tx
      .insert(regularizationRequests)
      .values({
        employeeId,
        date: input.date,
        requestedIn,
        requestedOut,
        reason: input.reason,
        currentStep: next?.step ?? 0,
        currentApproverEmployeeId: next?.approver ?? null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning();
    return {
      action: employeeId === self ? 'apply' : 'apply_on_behalf',
      entityId: r!.id,
      after: r,
      result: r!,
    };
  });
}

function canAct(ctx: Ctx, r: RegRow, steps: string[]): boolean {
  if (r.employeeId === ctx.user.employeeId) return false;
  const scope = ctx.permissions['attendance.approve'];
  if (scope && scopeCovers(scope, 'all')) return true;
  return (
    steps[r.currentStep] === 'manager' &&
    !!scope &&
    !!r.currentApproverEmployeeId &&
    r.currentApproverEmployeeId === ctx.user.employeeId
  );
}

export async function decideRegularization(
  ctx: Ctx,
  id: string,
  action: 'approve' | 'reject',
  note: string | null,
): Promise<RegRow> {
  return withAudit(ctx.db, ctx.actor, 'regularization_requests', async (tx) => {
    const [r] = await tx
      .select()
      .from(regularizationRequests)
      .where(eq(regularizationRequests.id, id))
      .for('update');
    if (!r) throw AppError.notFound('Request not found');
    if (r.status !== 'pending') throw AppError.badRequest(`This request is already ${r.status}`);
    const steps = await approvalSteps(tx, 'attendance');
    if (!canAct(ctx, r, steps)) {
      throw r.employeeId === ctx.user.employeeId
        ? AppError.forbidden('You cannot approve your own correction')
        : AppError.forbidden('This request is not waiting for you');
    }
    const trail: TrailEntry[] = [
      ...(r.approvalTrail ?? []),
      {
        step: r.currentStep,
        by: ctx.user.id,
        action,
        at: new Date().toISOString(),
        ...(note ? { note } : {}),
      },
    ];
    const base = { approvalTrail: trail, updatedBy: ctx.user.id, updatedAt: new Date() };
    if (action === 'reject') {
      const [after] = await tx
        .update(regularizationRequests)
        .set({
          ...base,
          status: 'rejected',
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decisionNote: note,
        })
        .where(eq(regularizationRequests.id, id))
        .returning();
      return { action: 'reject', entityId: id, before: r, after, result: after! };
    }
    const [e] = await tx.select().from(employees).where(eq(employees.id, r.employeeId));
    const next = nextStep(steps, r.currentStep + 1, e!);
    if (
      next &&
      next.step < steps.length &&
      !(next.approver && next.approver === ctx.user.employeeId)
    ) {
      const [after] = await tx
        .update(regularizationRequests)
        .set({ ...base, currentStep: next.step, currentApproverEmployeeId: next.approver })
        .where(eq(regularizationRequests.id, id))
        .returning();
      return { action: 'approve_step', entityId: id, before: r, after, result: after! };
    }
    if (await isDateLocked(tx, r.date)) throw lockedError();
    const [after] = await tx
      .update(regularizationRequests)
      .set({
        ...base,
        status: 'approved',
        decidedBy: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: note,
        currentApproverEmployeeId: null,
      })
      .where(eq(regularizationRequests.id, id))
      .returning();
    // The correction becomes ordinary manual punches; raw punches are never edited.
    const punches = [r.requestedIn, r.requestedOut].filter((t): t is Date => !!t);
    await tx.insert(attendancePunches).values(
      punches.map((at) => ({
        employeeId: r.employeeId,
        at,
        source: 'manual' as const,
        note: `Correction: ${r.reason}`,
        ref: `regularization:${r.id}`,
        createdBy: ctx.user.id,
      })),
    );
    await reprocessAround(ctx, tx, r.employeeId, r.date);
    return { action: 'approve', entityId: id, before: r, after, result: after! };
  });
}

export async function cancelRegularization(ctx: Ctx, id: string, note: string | null) {
  return withAudit(ctx.db, ctx.actor, 'regularization_requests', async (tx) => {
    const [r] = await tx
      .select()
      .from(regularizationRequests)
      .where(eq(regularizationRequests.id, id))
      .for('update');
    const own = r?.employeeId === ctx.user.employeeId;
    const manage = ctx.permissions['attendance.manage'];
    const isHr = !!manage && scopeCovers(manage, 'all');
    if (!r || (!own && !isHr)) throw AppError.notFound('Request not found');
    if (r.status !== 'pending') throw AppError.badRequest(`This request is already ${r.status}`);
    const [after] = await tx
      .update(regularizationRequests)
      .set({
        status: own ? 'withdrawn' : 'cancelled',
        decisionNote: note,
        decidedBy: ctx.user.id,
        decidedAt: new Date(),
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(eq(regularizationRequests.id, id))
      .returning();
    return { action: own ? 'withdraw' : 'cancel', entityId: id, before: r, after, result: after! };
  });
}

/** Requests waiting for this user's decision. */
export function regInboxWhere(ctx: Ctx) {
  const scope = ctx.permissions['attendance.approve'];
  const isHr = !!scope && scopeCovers(scope, 'all');
  const mine = ctx.user.employeeId;
  return and(
    eq(regularizationRequests.status, 'pending'),
    mine ? sql`${regularizationRequests.employeeId} <> ${mine}` : undefined,
    isHr
      ? undefined
      : mine
        ? eq(regularizationRequests.currentApproverEmployeeId, mine)
        : sql`false`,
  );
}
