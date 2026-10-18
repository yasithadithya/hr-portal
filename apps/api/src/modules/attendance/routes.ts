import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { schema, scopeCondition, withAudit } from '@hr/db';
import {
  ATTENDANCE_STATUSES,
  assignShiftSchema,
  clockSchema,
  CURRENT_STATUSES,
  decisionSchema,
  deviceUserInputSchema,
  lockSchema,
  manualPunchSchema,
  monthQuerySchema,
  ok,
  otDecisionSchema,
  processSchema,
  REGULARIZATION_STATUSES,
  regularizationInputSchema,
  rosterUpdateSchema,
  shiftInputSchema,
  unlockSchema,
  type AttendancePeriod,
  type RosterWeek,
  type Shift,
  type SummaryRow,
} from '@hr/shared';
import {
  addDays,
  businessDateSchema,
  eachDay,
  monthRange,
  toBusinessDate,
  zonedInstant,
} from '@hr/shared/time';

import { authedCtx, scopeOf, type AuthedUser, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { getSettings } from '../company/routes';
import { tenantToday } from '../employees/service';
import * as events from '../notifications/events';

import { hhmm, isDateLocked, lockedMonths, processRange } from './process';
import * as service from './service';

const {
  attendanceDays,
  attendanceDeviceUsers,
  attendancePeriods,
  attendancePunches,
  departments,
  employees,
  regularizationRequests,
  rosterEntries,
  shiftAssignments,
  shifts,
} = schema;
type Ctx = RequestContext & { user: AuthedUser };

const idParams = { params: z.object({ id: z.uuid() }) };
const NO_EMPLOYEE = '00000000-0000-0000-0000-000000000000';

function shiftDto(s: typeof shifts.$inferSelect): Shift {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
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
    color: s.color,
    needsReview: s.needsReview,
    archived: !!s.archivedAt,
  };
}

function periodDto(year: number, month: number, p?: typeof attendancePeriods.$inferSelect) {
  const out: AttendancePeriod = {
    year,
    month,
    status: p?.status ?? 'open',
    lockedAt: p?.lockedAt?.toISOString() ?? null,
    lockedBy: p?.lockedBy ?? null,
  };
  return out;
}

const parseMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return { year: y, month: mo, ...monthRange(y, mo) };
};

/** Current employees visible under a permission's scope. */
function visibleStaff(
  ctx: Ctx,
  req: Express.Request,
  key: 'attendance.read',
  departmentId?: string,
) {
  return ctx.db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        isNull(employees.archivedAt),
        scopeCondition(scopeOf(req, key), ctx.user.employeeId, employees.id),
        departmentId ? eq(employees.departmentId, departmentId) : undefined,
      ),
    );
}

async function visibleEmployee(ctx: Ctx, req: Express.Request, employeeId: string) {
  const [e] = await ctx.db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        scopeCondition(scopeOf(req, 'attendance.read'), ctx.user.employeeId, employees.id),
      ),
    );
  if (!e) throw AppError.notFound('Employee not found');
  return e;
}

/** Monthly totals per employee from computed days. */
export async function monthlySummary(
  ctx: Ctx,
  from: string,
  to: string,
  employeeIds: string[],
  otRequiresApproval: boolean,
): Promise<SummaryRow[]> {
  if (!employeeIds.length) return [];
  const dept = aliasedTable(departments, 'dept');
  const rows = await ctx.db
    .select({
      employeeId: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: dept.name,
      expectedDays: sql<string>`coalesce(sum(${attendanceDays.expected}), 0)`,
      leaveDays: sql<string>`coalesce(sum(least(${attendanceDays.leavePortion}, ${attendanceDays.expected})), 0)`,
      absentDays: sql<string>`coalesce(sum(${attendanceDays.absentPortion}), 0)`,
      lateCount: sql<number>`count(*) filter (where ${attendanceDays.lateMinutes} > 0)::int`,
      lateMinutes: sql<number>`coalesce(sum(${attendanceDays.lateMinutes}), 0)::int`,
      earlyMinutes: sql<number>`coalesce(sum(${attendanceDays.earlyMinutes}), 0)::int`,
      workedMinutes: sql<number>`coalesce(sum(${attendanceDays.workedMinutes}), 0)::int`,
      otMinutes: sql<number>`coalesce(sum(${attendanceDays.otMinutes}), 0)::int`,
      otApproved: sql<number>`coalesce(sum(coalesce(${attendanceDays.otApprovedMinutes}, 0)), 0)::int`,
      incompleteDays: sql<number>`count(*) filter (where ${attendanceDays.status} = 'incomplete')::int`,
    })
    .from(employees)
    .leftJoin(dept, eq(dept.id, employees.departmentId))
    .leftJoin(
      attendanceDays,
      and(
        eq(attendanceDays.employeeId, employees.id),
        gte(attendanceDays.date, from),
        lte(attendanceDays.date, to),
      ),
    )
    .where(inArray(employees.id, employeeIds))
    .groupBy(employees.id, dept.name)
    .orderBy(asc(employees.employeeNo));
  return rows.map((r) => {
    const expected = Number(r.expectedDays);
    const leave = Number(r.leaveDays);
    const absent = Number(r.absentDays);
    return {
      employeeId: r.employeeId,
      employeeNo: r.employeeNo,
      name: `${r.firstName} ${r.lastName}`,
      department: r.department,
      expectedDays: expected,
      presentDays: Math.max(0, Math.round((expected - leave - absent) * 100) / 100),
      leaveDays: leave,
      absentDays: absent,
      lateCount: r.lateCount,
      lateMinutes: r.lateMinutes,
      earlyMinutes: r.earlyMinutes,
      workedMinutes: r.workedMinutes,
      otMinutes: r.otMinutes,
      payableOtMinutes: otRequiresApproval ? r.otApproved : r.otMinutes,
      incompleteDays: r.incompleteDays,
    };
  });
}

export function attendanceRoutes(): Router {
  const router = Router();
  const read = requirePermission('attendance.read');
  const readTeam = requirePermission('attendance.read', 'team');
  const manage = requirePermission('attendance.manage', 'all');
  const approve = requirePermission('attendance.approve', 'team');

  // ── Shifts ─────────────────────────────────────────────────────────────────
  router.get('/attendance/shifts', async (req, res) => {
    const rows = await authedCtx(req).db.select().from(shifts).orderBy(asc(shifts.code));
    res.json(ok(rows.map(shiftDto)));
  });

  const shiftValues = (b: z.output<typeof shiftInputSchema>, userId: string) => {
    const { archived, ...rest } = b;
    return {
      ...rest,
      archivedAt: archived ? new Date() : null,
      // Saving a shift is HR's review of it.
      needsReview: false,
      updatedBy: userId,
    };
  };
  const shiftCreate = { body: shiftInputSchema };
  router.post('/attendance/shifts', manage, validate(shiftCreate), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, shiftCreate);
    const row = await withAudit(ctx.db, ctx.actor, 'shifts', async (tx) => {
      const [s] = await tx
        .insert(shifts)
        .values({ ...shiftValues(body, ctx.user.id), createdBy: ctx.user.id })
        .returning();
      return { action: 'create', entityId: s!.id, after: s, result: s! };
    });
    res.status(201).json(ok(shiftDto(row)));
  });

  const shiftUpdate = { ...idParams, body: shiftInputSchema };
  router.put('/attendance/shifts/:id', manage, validate(shiftUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, shiftUpdate);
    const row = await withAudit(ctx.db, ctx.actor, 'shifts', async (tx) => {
      const [before] = await tx.select().from(shifts).where(eq(shifts.id, params.id));
      if (!before) throw AppError.notFound('Shift not found');
      const [s] = await tx
        .update(shifts)
        .set({
          ...shiftValues(body, ctx.user.id),
          archivedAt: body.archived ? (before.archivedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(shifts.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: s, result: s! };
    });
    res.json(ok(shiftDto(row)));
  });

  // ── Assignments ────────────────────────────────────────────────────────────
  const assignList = { query: z.object({ employeeId: z.uuid().optional() }) };
  router.get('/attendance/assignments', readTeam, validate(assignList), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, assignList);
    const rows = await ctx.db
      .select({ a: shiftAssignments, s: shifts })
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
      .where(
        and(
          scopeCondition(scopeOf(req, 'attendance.read'), ctx.user.employeeId, employees.id),
          query.employeeId ? eq(shiftAssignments.employeeId, query.employeeId) : undefined,
        ),
      )
      .orderBy(asc(shiftAssignments.employeeId), desc(shiftAssignments.effectiveFrom));
    res.json(
      ok(
        rows.map(({ a, s }) => ({
          id: a.id,
          employeeId: a.employeeId,
          shiftId: a.shiftId,
          shiftCode: s.code,
          shiftName: s.name,
          effectiveFrom: a.effectiveFrom,
          effectiveTo: a.effectiveTo,
        })),
      ),
    );
  });

  /**
   * Assign a shift from a date. Per employee the ranges stay gap-free: the range in force is
   * closed the day before, and assignments starting on/after the date are replaced.
   */
  const assignSchemas = { body: assignShiftSchema };
  router.post('/attendance/assignments', manage, validate(assignSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, assignSchemas);
    const from = body.effectiveFrom;
    const count = await withAudit(ctx.db, ctx.actor, 'shift_assignments', async (tx) => {
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, body.shiftId));
      if (!s || s.archivedAt) throw AppError.badRequest('Unknown or archived shift');
      const found = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(inArray(employees.id, body.employeeIds));
      if (found.length !== new Set(body.employeeIds).size)
        throw AppError.badRequest('Unknown employee in the list');
      await tx
        .delete(shiftAssignments)
        .where(
          and(
            inArray(shiftAssignments.employeeId, body.employeeIds),
            gte(shiftAssignments.effectiveFrom, from),
          ),
        );
      await tx
        .update(shiftAssignments)
        .set({ effectiveTo: addDays(from, -1), updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(
          and(
            inArray(shiftAssignments.employeeId, body.employeeIds),
            lte(shiftAssignments.effectiveFrom, from),
            or(isNull(shiftAssignments.effectiveTo), gte(shiftAssignments.effectiveTo, from)),
          ),
        );
      await tx.insert(shiftAssignments).values(
        body.employeeIds.map((employeeId) => ({
          employeeId,
          shiftId: body.shiftId,
          effectiveFrom: from,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })),
      );
      await processRange(tx, {
        tz: ctx.tenant.timezone,
        from,
        to: tenantToday(ctx),
        today: tenantToday(ctx),
        employeeIds: body.employeeIds,
      });
      return {
        action: 'assign',
        entityId: body.shiftId,
        after: { ...body },
        result: body.employeeIds.length,
      };
    });
    res.status(201).json(ok({ assigned: count }));
  });

  // ── Roster (week grid) ─────────────────────────────────────────────────────
  const rosterQuery = {
    query: z.object({ weekStart: businessDateSchema, departmentId: z.uuid().optional() }),
  };
  router.get('/attendance/roster', readTeam, validate(rosterQuery), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, rosterQuery);
    const dates = eachDay(query.weekStart, addDays(query.weekStart, 6));
    const end = dates[6]!;
    const staff = await ctx.db
      .select()
      .from(employees)
      .where(
        and(
          isNull(employees.archivedAt),
          inArray(employees.status, CURRENT_STATUSES),
          scopeCondition(scopeOf(req, 'attendance.read'), ctx.user.employeeId, employees.id),
          query.departmentId ? eq(employees.departmentId, query.departmentId) : undefined,
        ),
      )
      .orderBy(asc(employees.employeeNo));
    const ids = staff.map((e) => e.id);
    const assigns = ids.length
      ? await ctx.db
          .select()
          .from(shiftAssignments)
          .where(
            and(
              inArray(shiftAssignments.employeeId, ids),
              lte(shiftAssignments.effectiveFrom, end),
              or(
                isNull(shiftAssignments.effectiveTo),
                gte(shiftAssignments.effectiveTo, query.weekStart),
              ),
            ),
          )
      : [];
    const roster = ids.length
      ? await ctx.db
          .select()
          .from(rosterEntries)
          .where(
            and(
              inArray(rosterEntries.employeeId, ids),
              gte(rosterEntries.date, query.weekStart),
              lte(rosterEntries.date, end),
            ),
          )
      : [];
    const rosterMap = new Map(roster.map((r) => [`${r.employeeId}:${r.date}`, r.shiftId]));
    const body: RosterWeek = {
      weekStart: query.weekStart,
      dates,
      rows: staff.map((e) => ({
        employeeId: e.id,
        employeeNo: e.employeeNo,
        name: `${e.firstName} ${e.lastName}`,
        cells: dates.map((date) => {
          const k = `${e.id}:${date}`;
          if (rosterMap.has(k))
            return { date, shiftId: rosterMap.get(k) ?? null, source: 'roster' as const };
          const a = assigns.find(
            (x) =>
              x.employeeId === e.id &&
              x.effectiveFrom <= date &&
              (x.effectiveTo === null || x.effectiveTo >= date),
          );
          return a
            ? { date, shiftId: a.shiftId, source: 'assignment' as const }
            : { date, shiftId: null, source: 'none' as const };
        }),
      })),
    };
    res.json(ok(body));
  });

  const rosterSchemas = { body: rosterUpdateSchema };
  router.put('/attendance/roster', manage, validate(rosterSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, rosterSchemas);
    const dates = body.entries.map((e) => e.date).sort();
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    const locked = await lockedMonths(ctx.db, from, to);
    if (body.entries.some((e) => locked.has(e.date.slice(0, 7)))) throw service.lockedError();
    const n = await withAudit(ctx.db, ctx.actor, 'roster_entries', async (tx) => {
      for (const e of body.entries) {
        if (e.shiftId === 'clear') {
          await tx
            .delete(rosterEntries)
            .where(and(eq(rosterEntries.employeeId, e.employeeId), eq(rosterEntries.date, e.date)));
        } else {
          await tx
            .insert(rosterEntries)
            .values({
              employeeId: e.employeeId,
              date: e.date,
              shiftId: e.shiftId,
              createdBy: ctx.user.id,
              updatedBy: ctx.user.id,
            })
            .onConflictDoUpdate({
              target: [rosterEntries.employeeId, rosterEntries.date],
              set: { shiftId: e.shiftId, updatedBy: ctx.user.id, updatedAt: new Date() },
            });
        }
      }
      await processRange(tx, {
        tz: ctx.tenant.timezone,
        from,
        to,
        today: tenantToday(ctx),
        employeeIds: [...new Set(body.entries.map((e) => e.employeeId))],
      });
      return { action: 'roster', entityId: null, after: body, result: body.entries.length };
    });
    res.json(ok({ updated: n }));
  });

  // ── Self-service clock ─────────────────────────────────────────────────────
  router.get('/attendance/today', requirePermission('attendance.clock'), async (req, res) => {
    res.json(ok(await service.today(authedCtx(req))));
  });

  const clockSchemas = { body: clockSchema };
  router.post(
    '/attendance/clock',
    requirePermission('attendance.clock'),
    validate(clockSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const result = await service.clock(ctx, parsed(req, clockSchemas).body, req.ip ?? null);
      res.status(201).json(ok(result));
    },
  );

  // ── Days (board and per-employee month) ────────────────────────────────────
  const daysQuery = {
    query: z
      .object({
        date: businessDateSchema.optional(),
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        employeeId: z.uuid().optional(),
        departmentId: z.uuid().optional(),
        status: z.enum(ATTENDANCE_STATUSES).optional(),
      })
      .refine((q) => q.date || (q.month && q.employeeId), {
        message: 'Give a date, or a month with an employee',
      }),
  };
  router.get('/attendance/days', read, validate(daysQuery), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, daysQuery);
    const today = tenantToday(ctx);
    let from: string;
    let to: string;
    let ids: string[];
    if (query.date) {
      from = to = query.date;
      ids = query.employeeId
        ? [(await visibleEmployee(ctx, req, query.employeeId)).id]
        : (await visibleStaff(ctx, req, 'attendance.read', query.departmentId)).map((e) => e.id);
    } else {
      const m = parseMonth(query.month!);
      from = m.start;
      to = m.end;
      ids = [(await visibleEmployee(ctx, req, query.employeeId!)).id];
    }
    // Days with no events (absences) only exist once processed, so process before reading.
    await processRange(ctx.db, {
      tz: ctx.tenant.timezone,
      from,
      to,
      today,
      employeeIds: ids,
    });
    const rows = ids.length
      ? await ctx.db
          .select()
          .from(attendanceDays)
          .where(
            and(
              inArray(attendanceDays.employeeId, ids),
              gte(attendanceDays.date, from),
              lte(attendanceDays.date, to),
              query.status ? eq(attendanceDays.status, query.status) : undefined,
            ),
          )
          .orderBy(asc(attendanceDays.date))
      : [];
    res.json(ok(await service.dayDtos(ctx.db, rows)));
  });

  const otSchemas = { ...idParams, body: otDecisionSchema };
  router.post('/attendance/days/:id/ot', approve, validate(otSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, otSchemas);
    const row = await withAudit(ctx.db, ctx.actor, 'attendance_days', async (tx) => {
      const [d] = await tx
        .select()
        .from(attendanceDays)
        .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
        .where(
          and(
            eq(attendanceDays.id, params.id),
            scopeCondition(scopeOf(req, 'attendance.approve'), ctx.user.employeeId, employees.id),
          ),
        );
      if (!d) throw AppError.notFound('Attendance day not found');
      const day = d.attendance_days;
      if (day.employeeId === ctx.user.employeeId)
        throw AppError.forbidden('You cannot approve your own overtime');
      if (day.isLocked) throw service.lockedError();
      if (body.approvedMinutes > day.otMinutes)
        throw AppError.badRequest(`Only ${day.otMinutes} OT minutes were worked that day`);
      const [after] = await tx
        .update(attendanceDays)
        .set({
          otApprovedMinutes: body.approvedMinutes,
          otDecidedBy: ctx.user.id,
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(attendanceDays.id, params.id))
        .returning();
      return { action: 'approve_ot', entityId: params.id, before: day, after, result: after! };
    });
    res.json(ok((await service.dayDtos(ctx.db, [row]))[0]));
  });

  const processSchemas = { body: processSchema };
  router.post('/attendance/process', manage, validate(processSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, processSchemas);
    if (body.to < body.from) throw AppError.badRequest('The end date is before the start date');
    if (eachDay(body.from, body.to).length > 62)
      throw AppError.badRequest('Process at most two months at a time');
    const result = await processRange(ctx.db, {
      tz: ctx.tenant.timezone,
      from: body.from,
      to: body.to,
      today: tenantToday(ctx),
      ...(body.employeeId ? { employeeIds: [body.employeeId] } : {}),
    });
    res.json(ok(result));
  });

  // ── Punches ────────────────────────────────────────────────────────────────
  const punchQuery = {
    query: z.object({
      employeeId: z.uuid(),
      from: businessDateSchema,
      to: businessDateSchema,
    }),
  };
  router.get('/attendance/punches', read, validate(punchQuery), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, punchQuery);
    await visibleEmployee(ctx, req, query.employeeId);
    const tz = ctx.tenant.timezone;
    const rows = await ctx.db
      .select()
      .from(attendancePunches)
      .where(
        and(
          eq(attendancePunches.employeeId, query.employeeId),
          gte(attendancePunches.at, zonedInstant(query.from, '00:00', tz)),
          lt(attendancePunches.at, zonedInstant(addDays(query.to, 1), '00:00', tz)),
        ),
      )
      .orderBy(asc(attendancePunches.at))
      .limit(2000);
    res.json(ok(rows.map(service.punchDto)));
  });

  const manualSchemas = { body: manualPunchSchema };
  router.post('/attendance/punches', manage, validate(manualSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, manualSchemas);
    const at = new Date(body.at);
    if (at > new Date()) throw AppError.badRequest('That time is in the future');
    const date = toBusinessDate(at, ctx.tenant.timezone);
    if (await isDateLocked(ctx.db, date)) throw service.lockedError();
    const row = await withAudit(ctx.db, ctx.actor, 'attendance_punches', async (tx) => {
      const [e] = await tx.select().from(employees).where(eq(employees.id, body.employeeId));
      if (!e) throw AppError.notFound('Employee not found');
      const [p] = await tx
        .insert(attendancePunches)
        .values({
          employeeId: body.employeeId,
          at,
          source: 'manual',
          note: body.note,
          createdBy: ctx.user.id,
        })
        .returning();
      await service.reprocessAround(ctx, tx, body.employeeId, date, addDays(date, 1));
      return { action: 'manual_punch', entityId: p!.id, after: p, result: p! };
    });
    res.status(201).json(ok(service.punchDto(row)));
  });

  // ── Regularisation ─────────────────────────────────────────────────────────
  const regSchemas = { body: regularizationInputSchema };
  router.post(
    '/attendance/regularizations',
    requirePermission('attendance.regularize'),
    validate(regSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const r = await service.applyRegularization(ctx, parsed(req, regSchemas).body);
      await events.regularizationSubmitted(ctx, r);
      res.status(201).json(ok((await service.regDtos(ctx.db, [r]))[0]));
    },
  );

  const regList = {
    query: z.object({
      status: z.enum(REGULARIZATION_STATUSES).optional(),
      mine: z.enum(['true', 'false']).optional(),
      employeeId: z.uuid().optional(),
    }),
  };
  router.get('/attendance/regularizations', read, validate(regList), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, regList);
    const rows = await ctx.db
      .select({ r: regularizationRequests })
      .from(regularizationRequests)
      .innerJoin(employees, eq(employees.id, regularizationRequests.employeeId))
      .where(
        and(
          scopeCondition(scopeOf(req, 'attendance.read'), ctx.user.employeeId, employees.id),
          query.mine === 'true'
            ? eq(regularizationRequests.employeeId, ctx.user.employeeId ?? NO_EMPLOYEE)
            : undefined,
          query.employeeId ? eq(regularizationRequests.employeeId, query.employeeId) : undefined,
          query.status ? eq(regularizationRequests.status, query.status) : undefined,
        ),
      )
      .orderBy(desc(regularizationRequests.date))
      .limit(500);
    res.json(
      ok(
        await service.regDtos(
          ctx.db,
          rows.map((x) => x.r),
        ),
      ),
    );
  });

  router.get('/attendance/inbox', approve, async (req, res) => {
    const ctx = authedCtx(req);
    const rows = await ctx.db
      .select()
      .from(regularizationRequests)
      .where(service.regInboxWhere(ctx))
      .orderBy(asc(regularizationRequests.date))
      .limit(500);
    res.json(ok(await service.regDtos(ctx.db, rows)));
  });

  const decideSchemas = { ...idParams, body: decisionSchema };
  for (const action of ['approve', 'reject'] as const) {
    router.post(
      `/attendance/regularizations/:id/${action}`,
      approve,
      validate(decideSchemas),
      async (req, res) => {
        const ctx = authedCtx(req);
        const { params, body } = parsed(req, decideSchemas);
        const r = await service.decideRegularization(ctx, params.id, action, body.note ?? null);
        await events.regularizationDecided(ctx, r);
        res.json(ok((await service.regDtos(ctx.db, [r]))[0]));
      },
    );
  }

  router.post(
    '/attendance/regularizations/:id/cancel',
    requirePermission('attendance.regularize'),
    validate(decideSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, decideSchemas);
      const r = await service.cancelRegularization(ctx, params.id, body.note ?? null);
      res.json(ok((await service.regDtos(ctx.db, [r]))[0]));
    },
  );

  // ── Device users (fingerprint id → employee) ───────────────────────────────
  router.get('/attendance/device-users', manage, async (req, res) => {
    const ctx = authedCtx(req);
    const rows = await ctx.db
      .select({ d: attendanceDeviceUsers, e: employees })
      .from(attendanceDeviceUsers)
      .innerJoin(employees, eq(employees.id, attendanceDeviceUsers.employeeId))
      .orderBy(asc(attendanceDeviceUsers.deviceUserId));
    res.json(
      ok(
        rows.map(({ d, e }) => ({
          id: d.id,
          deviceUserId: d.deviceUserId,
          employeeId: e.id,
          employeeNo: e.employeeNo,
          employeeName: `${e.firstName} ${e.lastName}`,
        })),
      ),
    );
  });

  const devSchemas = { body: deviceUserInputSchema };
  router.post('/attendance/device-users', manage, validate(devSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, devSchemas);
    const row = await withAudit(ctx.db, ctx.actor, 'attendance_device_users', async (tx) => {
      const [d] = await tx
        .insert(attendanceDeviceUsers)
        .values({ ...body, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: attendanceDeviceUsers.deviceUserId,
          set: { employeeId: body.employeeId, updatedBy: ctx.user.id, updatedAt: new Date() },
        })
        .returning();
      return { action: 'map_device_user', entityId: d!.id, after: d, result: d! };
    });
    res.status(201).json(ok({ id: row.id }));
  });

  router.delete('/attendance/device-users/:id', manage, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    await withAudit(ctx.db, ctx.actor, 'attendance_device_users', async (tx) => {
      const [before] = await tx
        .delete(attendanceDeviceUsers)
        .where(eq(attendanceDeviceUsers.id, params.id))
        .returning();
      if (!before) throw AppError.notFound('Mapping not found');
      return { action: 'delete', entityId: params.id, before, result: null };
    });
    res.json(ok({ deleted: true }));
  });

  // ── Monthly summary & period lock ──────────────────────────────────────────
  const summarySchemas = {
    query: monthQuerySchema.extend({ departmentId: z.uuid().optional() }),
  };
  router.get('/attendance/summary', readTeam, validate(summarySchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, summarySchemas);
    const m = parseMonth(query.month);
    const ids = (await visibleStaff(ctx, req, 'attendance.read', query.departmentId)).map(
      (e) => e.id,
    );
    await processRange(ctx.db, {
      tz: ctx.tenant.timezone,
      from: m.start,
      to: m.end,
      today: tenantToday(ctx),
      employeeIds: ids,
    });
    const settings = await getSettings(ctx.db);
    const otApproval = settings['attendance.ot_requires_approval'];
    const [period] = await ctx.db
      .select()
      .from(attendancePeriods)
      .where(and(eq(attendancePeriods.year, m.year), eq(attendancePeriods.month, m.month)));
    const [pending] = ids.length
      ? await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(regularizationRequests)
          .where(
            and(
              eq(regularizationRequests.status, 'pending'),
              inArray(regularizationRequests.employeeId, ids),
              gte(regularizationRequests.date, m.start),
              lte(regularizationRequests.date, m.end),
            ),
          )
      : [{ n: 0 }];
    res.json(
      ok({
        month: query.month,
        period: periodDto(m.year, m.month, period),
        otRequiresApproval: otApproval,
        pendingRegularizations: pending?.n ?? 0,
        rows: await monthlySummary(ctx, m.start, m.end, ids, otApproval),
      }),
    );
  });

  const yearQuery = { query: z.object({ year: z.coerce.number().int().min(2000).max(2100) }) };
  router.get('/attendance/periods', readTeam, validate(yearQuery), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, yearQuery);
    const rows = await ctx.db
      .select()
      .from(attendancePeriods)
      .where(eq(attendancePeriods.year, query.year));
    res.json(
      ok(
        Array.from({ length: 12 }, (_, i) =>
          periodDto(
            query.year,
            i + 1,
            rows.find((r) => r.month === i + 1),
          ),
        ),
      ),
    );
  });

  const monthParams = {
    params: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  };
  const lockSchemas = { ...monthParams, body: lockSchema };
  router.post(
    '/attendance/periods/:month/lock',
    manage,
    validate(lockSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, lockSchemas);
      const m = parseMonth(params.month);
      const today = tenantToday(ctx);
      if (m.end >= today)
        throw AppError.badRequest('A month can be locked only after it has ended');
      const result = await withAudit(ctx.db, ctx.actor, 'attendance_periods', async (tx) => {
        const [existing] = await tx
          .select()
          .from(attendancePeriods)
          .where(and(eq(attendancePeriods.year, m.year), eq(attendancePeriods.month, m.month)))
          .for('update');
        if (existing?.status === 'locked')
          throw new AppError(409, 'CONFLICT', `${params.month} is already locked`);
        // Final recompute of the whole month, then freeze it.
        await processRange(tx, { tz: ctx.tenant.timezone, from: m.start, to: m.end, today });
        const [inc] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(attendanceDays)
          .where(
            and(
              gte(attendanceDays.date, m.start),
              lte(attendanceDays.date, m.end),
              eq(attendanceDays.status, 'incomplete'),
            ),
          );
        const [pend] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(regularizationRequests)
          .where(
            and(
              eq(regularizationRequests.status, 'pending'),
              gte(regularizationRequests.date, m.start),
              lte(regularizationRequests.date, m.end),
            ),
          );
        const incomplete = inc?.n ?? 0;
        const pending = pend?.n ?? 0;
        if ((incomplete || pending) && !body.force) {
          throw new AppError(
            409,
            'CONFLICT',
            `${incomplete} incomplete day(s) and ${pending} pending correction(s) in ${params.month}`,
            { incomplete, pending },
          );
        }
        const values = {
          status: 'locked' as const,
          lockedBy: ctx.user.id,
          lockedAt: new Date(),
          summary: { incomplete, pending, forced: body.force },
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        };
        const [p] = existing
          ? await tx
              .update(attendancePeriods)
              .set(values)
              .where(eq(attendancePeriods.id, existing.id))
              .returning()
          : await tx
              .insert(attendancePeriods)
              .values({ year: m.year, month: m.month, ...values, createdBy: ctx.user.id })
              .returning();
        await tx
          .update(attendanceDays)
          .set({ isLocked: true })
          .where(and(gte(attendanceDays.date, m.start), lte(attendanceDays.date, m.end)));
        return { action: 'lock', entityId: p!.id, before: existing, after: p, result: p! };
      });
      res.json(ok(periodDto(m.year, m.month, result)));
    },
  );

  const unlockSchemas = { ...monthParams, body: unlockSchema };
  router.post(
    '/attendance/periods/:month/unlock',
    manage,
    validate(unlockSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, unlockSchemas);
      const m = parseMonth(params.month);
      // Phase 7: refuse when an approved payroll run has consumed this period.
      const result = await withAudit(ctx.db, ctx.actor, 'attendance_periods', async (tx) => {
        const [existing] = await tx
          .select()
          .from(attendancePeriods)
          .where(and(eq(attendancePeriods.year, m.year), eq(attendancePeriods.month, m.month)))
          .for('update');
        if (existing?.status !== 'locked')
          throw AppError.badRequest(`${params.month} is not locked`);
        await tx
          .update(attendanceDays)
          .set({ isLocked: false })
          .where(and(gte(attendanceDays.date, m.start), lte(attendanceDays.date, m.end)));
        const [p] = await tx
          .update(attendancePeriods)
          .set({
            status: 'open',
            lockedAt: null,
            lockedBy: null,
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(eq(attendancePeriods.id, existing.id))
          .returning();
        return {
          action: 'unlock',
          entityId: p!.id,
          before: existing,
          after: { ...p, reason: body.reason },
          result: p!,
        };
      });
      res.json(ok(periodDto(m.year, m.month, result)));
    },
  );

  return router;
}
