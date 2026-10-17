import { randomUUID } from 'node:crypto';

import { aliasedTable, and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import express, { Router } from 'express';
import { z } from 'zod';

import { schema, scopeCondition, withAudit } from '@hr/db';
import {
  adjustmentSchema,
  applyLeaveSchema,
  bulkDecisionSchema,
  CURRENT_STATUSES,
  decisionSchema,
  LEAVE_REQUEST_STATUSES,
  leavePolicyInputSchema,
  leaveTypeInputSchema,
  ok,
  yearEndRunSchema,
  type LeaveBalance,
  type LeavePolicy,
  type LeaveType,
} from '@hr/shared';
import { carryForwardAmount, leaveYearOf } from '@hr/shared/leave';
import { monthRange } from '@hr/shared/time';

import { authedCtx, scopeOf, type AuthedUser, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { tenantToday } from '../employees/service';

import { balanceOf, balancesFor, employeeCalendar, resolvePolicy, typesById } from './engine';
import * as service from './service';

const {
  employees,
  departments,
  leaveLedger,
  leavePolicies,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
  leaveYearRuns,
} = schema;
type Ctx = RequestContext & { user: AuthedUser };

const idParams = { params: z.object({ id: z.uuid() }) };
const ATTACH_BUCKET = 'employee-documents';
const ATTACH_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const num = (v: string | null) => (v === null ? null : Number(v));

/** Past years are shown as closed (31 Dec), the current year as of today, future years as of 1 Jan. */
function balanceAsOf(year: number, today: string): string {
  const current = leaveYearOf(today);
  return year < current ? `${year}-12-31` : year > current ? `${year}-01-01` : today;
}

function typeDto(t: typeof leaveTypes.$inferSelect): LeaveType {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    isPaid: t.isPaid,
    unit: t.unit,
    color: t.color,
    requiresAttachmentAfterDays: num(t.requiresAttachmentAfterDays),
    maxConsecutiveDays: num(t.maxConsecutiveDays),
    minNoticeDays: t.minNoticeDays,
    allowNegative: t.allowNegative,
    genderRestriction: t.genderRestriction,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
  };
}

function policyDto(p: typeof leavePolicies.$inferSelect): LeavePolicy {
  return {
    id: p.id,
    leaveTypeId: p.leaveTypeId,
    name: p.name,
    appliesTo: p.appliesTo ?? {},
    entitlement: Number(p.entitlement),
    accrual: p.accrual,
    prorationOnJoin: p.prorationOnJoin,
    rounding: p.rounding,
    eligibleAfterMonths: p.eligibleAfterMonths,
    carryForwardMax: Number(p.carryForwardMax),
    carryForwardExpiryMonths: p.carryForwardExpiryMonths,
    encashable: p.encashable,
    effectiveFrom: p.effectiveFrom,
    priority: p.priority,
    isActive: p.isActive,
    needsReview: p.needsReview,
  };
}

async function requestDtos(ctx: Ctx, rows: (typeof leaveRequests.$inferSelect)[]) {
  if (!rows.length) return [];
  const emps = await ctx.db
    .select()
    .from(employees)
    .where(inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))]));
  const byId = new Map(emps.map((e) => [e.id, e]));
  const types = await typesById(ctx.db, [...new Set(rows.map((r) => r.leaveTypeId))]);
  const steps = await service.flowSteps(ctx.db);
  return rows.map((r) =>
    service.toRequestDto(r, byId.get(r.employeeId)!, types.get(r.leaveTypeId)!, steps),
  );
}

/** Employee the caller may see under `leave.read`, or 404. */
async function visibleEmployee(ctx: Ctx, req: Express.Request, employeeId: string) {
  const [e] = await ctx.db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        scopeCondition(scopeOf(req, 'leave.read'), ctx.user.employeeId, employees.id),
      ),
    );
  if (!e) throw AppError.notFound('Employee not found');
  return e;
}

function balanceDto(
  b: Awaited<ReturnType<typeof balancesFor>>[number],
  year: number,
): LeaveBalance {
  return {
    leaveType: {
      id: b.type.id,
      code: b.type.code,
      name: b.type.name,
      color: b.type.color,
      unit: b.type.unit,
      isPaid: b.type.isPaid,
    },
    year,
    entitled: b.entitled,
    taken: b.taken,
    pending: b.pending,
    balance: b.balance,
    available: b.available,
    allowNegative: b.type.allowNegative,
    hasPolicy: !!b.policy,
    policyNeedsReview: !!b.policy?.needsReview,
  };
}

export function leaveRoutes(): Router {
  const router = Router();
  const read = requirePermission('leave.read');
  const manage = requirePermission('leave.manage', 'all');

  // ── Types & policies ───────────────────────────────────────────────────────
  router.get('/leave/types', async (req, res) => {
    const rows = await authedCtx(req)
      .db.select()
      .from(leaveTypes)
      .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
    res.json(ok(rows.map(typeDto)));
  });

  const typeSchemas = { body: leaveTypeInputSchema };
  router.post('/leave/types', manage, validate(typeSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, typeSchemas);
    const row = await withAudit(ctx.db, ctx.actor, 'leave_types', async (tx) => {
      const [t] = await tx
        .insert(leaveTypes)
        .values({
          ...body,
          requiresAttachmentAfterDays: body.requiresAttachmentAfterDays?.toString() ?? null,
          maxConsecutiveDays: body.maxConsecutiveDays?.toString() ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      return { action: 'create', entityId: t!.id, after: t, result: t! };
    });
    res.status(201).json(ok(typeDto(row)));
  });

  const typeUpdate = { ...idParams, body: leaveTypeInputSchema };
  router.put('/leave/types/:id', manage, validate(typeUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, typeUpdate);
    const row = await withAudit(ctx.db, ctx.actor, 'leave_types', async (tx) => {
      const [before] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, params.id));
      if (!before) throw AppError.notFound('Leave type not found');
      if (before.unit !== body.unit) {
        const [used] = await tx
          .select({ id: leaveLedger.id })
          .from(leaveLedger)
          .where(eq(leaveLedger.leaveTypeId, params.id))
          .limit(1);
        if (used)
          throw AppError.badRequest(
            'The unit cannot change once leave has been recorded for this type',
          );
      }
      const [t] = await tx
        .update(leaveTypes)
        .set({
          ...body,
          requiresAttachmentAfterDays: body.requiresAttachmentAfterDays?.toString() ?? null,
          maxConsecutiveDays: body.maxConsecutiveDays?.toString() ?? null,
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(leaveTypes.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: t, result: t! };
    });
    res.json(ok(typeDto(row)));
  });

  router.get('/leave/policies', manage, async (req, res) => {
    const rows = await authedCtx(req)
      .db.select()
      .from(leavePolicies)
      .orderBy(asc(leavePolicies.priority), asc(leavePolicies.name));
    res.json(ok(rows.map(policyDto)));
  });

  const policyValues = (b: z.output<typeof leavePolicyInputSchema>) => ({
    ...b,
    entitlement: String(b.entitlement),
    carryForwardMax: String(b.carryForwardMax),
    // Saving a policy is HR's review of it.
    needsReview: false,
  });
  const policySchemas = { body: leavePolicyInputSchema };
  router.post('/leave/policies', manage, validate(policySchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, policySchemas);
    const row = await withAudit(ctx.db, ctx.actor, 'leave_policies', async (tx) => {
      const [p] = await tx
        .insert(leavePolicies)
        .values({ ...policyValues(body), createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .returning();
      return { action: 'create', entityId: p!.id, after: p, result: p! };
    });
    res.status(201).json(ok(policyDto(row)));
  });

  const policyUpdate = { ...idParams, body: leavePolicyInputSchema };
  router.put('/leave/policies/:id', manage, validate(policyUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, policyUpdate);
    const row = await withAudit(ctx.db, ctx.actor, 'leave_policies', async (tx) => {
      const [before] = await tx.select().from(leavePolicies).where(eq(leavePolicies.id, params.id));
      if (!before) throw AppError.notFound('Policy not found');
      const [p] = await tx
        .update(leavePolicies)
        .set({ ...policyValues(body), updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(leavePolicies.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: p, result: p! };
    });
    res.json(ok(policyDto(row)));
  });

  /** Policy preview: which current employees a policy would apply to. */
  router.get('/leave/policies/:id/preview', manage, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    const [p] = await ctx.db.select().from(leavePolicies).where(eq(leavePolicies.id, params.id));
    if (!p) throw AppError.notFound('Policy not found');
    const today = tenantToday(ctx);
    const staff = await ctx.db
      .select()
      .from(employees)
      .where(and(isNull(employees.archivedAt), inArray(employees.status, CURRENT_STATUSES)));
    const covered = [];
    for (const e of staff) {
      const winner = await resolvePolicy(ctx.db, e, p.leaveTypeId, today);
      if (winner?.id === p.id)
        covered.push({ id: e.id, employeeNo: e.employeeNo, name: `${e.firstName} ${e.lastName}` });
    }
    res.json(ok({ total: staff.length, covered }));
  });

  // ── Balances ───────────────────────────────────────────────────────────────
  const balanceSchemas = {
    query: z.object({
      employeeId: z.uuid().optional(),
      year: z.coerce.number().int().min(2000).max(2100).optional(),
    }),
  };
  router.get('/leave/balances', read, validate(balanceSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, balanceSchemas);
    const employeeId = query.employeeId ?? ctx.user.employeeId;
    if (!employeeId) throw AppError.badRequest('Your account is not linked to an employee');
    const e = await visibleEmployee(ctx, req, employeeId);
    const today = tenantToday(ctx);
    const year = query.year ?? leaveYearOf(today);
    const asOf = balanceAsOf(year, today);
    const rows = await balancesFor(ctx.db, e, year, asOf);
    res.json(ok(rows.map((b) => balanceDto(b, year))));
  });

  const ledgerSchemas = {
    query: z.object({ employeeId: z.uuid(), leaveTypeId: z.uuid(), year: z.coerce.number().int() }),
  };
  router.get('/leave/ledger', read, validate(ledgerSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, ledgerSchemas);
    await visibleEmployee(ctx, req, query.employeeId);
    const rows = await ctx.db
      .select()
      .from(leaveLedger)
      .where(
        and(
          eq(leaveLedger.employeeId, query.employeeId),
          eq(leaveLedger.leaveTypeId, query.leaveTypeId),
          eq(leaveLedger.periodYear, query.year),
        ),
      )
      .orderBy(asc(leaveLedger.effectiveDate), asc(leaveLedger.at));
    res.json(
      ok(
        rows.map((l) => ({
          id: l.id,
          entryType: l.entryType,
          amount: Number(l.amount),
          effectiveDate: l.effectiveDate,
          note: l.note,
          at: l.at.toISOString(),
        })),
      ),
    );
  });

  // ── Requests ───────────────────────────────────────────────────────────────
  const applySchemas = { body: applyLeaveSchema };
  router.post(
    '/leave/quote',
    requirePermission('leave.apply'),
    validate(applySchemas),
    async (req, res) => {
      res.json(ok(await service.quote(authedCtx(req), parsed(req, applySchemas).body)));
    },
  );

  router.post(
    '/leave/requests',
    requirePermission('leave.apply'),
    validate(applySchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const r = await service.apply(ctx, parsed(req, applySchemas).body);
      res.status(201).json(ok((await requestDtos(ctx, [r]))[0]));
    },
  );

  const listSchemas = {
    query: z.object({
      employeeId: z.uuid().optional(),
      status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
      year: z.coerce.number().int().optional(),
      mine: z.enum(['true', 'false']).optional(),
    }),
  };
  router.get('/leave/requests', read, validate(listSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, listSchemas);
    const rows = await ctx.db
      .select({ r: leaveRequests })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .where(
        and(
          scopeCondition(scopeOf(req, 'leave.read'), ctx.user.employeeId, employees.id),
          query.mine === 'true'
            ? eq(
                leaveRequests.employeeId,
                ctx.user.employeeId ?? '00000000-0000-0000-0000-000000000000',
              )
            : undefined,
          query.employeeId ? eq(leaveRequests.employeeId, query.employeeId) : undefined,
          query.status ? eq(leaveRequests.status, query.status) : undefined,
          query.year ? eq(leaveRequests.periodYear, query.year) : undefined,
        ),
      )
      .orderBy(desc(leaveRequests.startDate))
      .limit(500);
    res.json(
      ok(
        await requestDtos(
          ctx,
          rows.map((x) => x.r),
        ),
      ),
    );
  });

  router.get('/leave/inbox', requirePermission('leave.approve', 'team'), async (req, res) => {
    const ctx = authedCtx(req);
    const rows = await ctx.db
      .select()
      .from(leaveRequests)
      .where(await service.inboxWhere(ctx))
      .orderBy(asc(leaveRequests.startDate))
      .limit(500);
    res.json(ok(await requestDtos(ctx, rows)));
  });

  const decideSchemas = { ...idParams, body: decisionSchema };
  for (const action of ['approve', 'reject'] as const) {
    router.post(
      `/leave/requests/:id/${action}`,
      requirePermission('leave.approve', 'team'),
      validate(decideSchemas),
      async (req, res) => {
        const ctx = authedCtx(req);
        const { params, body } = parsed(req, decideSchemas);
        const r = await service.decide(ctx, params.id, action, body.note ?? null);
        res.json(ok((await requestDtos(ctx, [r]))[0]));
      },
    );
  }

  const bulkSchemas = { body: bulkDecisionSchema };
  router.post(
    '/leave/requests/bulk-decide',
    requirePermission('leave.approve', 'team'),
    validate(bulkSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { body } = parsed(req, bulkSchemas);
      const done: string[] = [];
      const failed: { id: string; message: string }[] = [];
      // Each decision is its own transaction: one failure doesn't undo the others.
      for (const id of body.ids) {
        try {
          await service.decide(ctx, id, body.action, body.note ?? null);
          done.push(id);
        } catch (err) {
          failed.push({ id, message: err instanceof Error ? err.message : 'Failed' });
        }
      }
      res.json(ok({ done, failed }));
    },
  );

  router.post(
    '/leave/requests/:id/cancel',
    requirePermission('leave.apply'),
    validate(decideSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, decideSchemas);
      const r = await service.cancel(ctx, params.id, body.note ?? null);
      res.json(ok((await requestDtos(ctx, [r]))[0]));
    },
  );

  router.put(
    '/leave/requests/:id/attachment',
    requirePermission('leave.apply'),
    express.raw({ type: Object.keys(ATTACH_TYPES), limit: '10mb' }),
    validate(idParams),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, idParams);
      const [r] = await ctx.db.select().from(leaveRequests).where(eq(leaveRequests.id, params.id));
      const manage = ctx.permissions['leave.manage'] === 'all';
      if (!r || (r.employeeId !== ctx.user.employeeId && !manage))
        throw AppError.notFound('Leave request not found');
      if (r.status !== 'pending' && r.status !== 'approved')
        throw AppError.badRequest('Cannot attach to a closed request');
      const type = req.get('content-type')?.split(';')[0]?.trim() ?? '';
      const ext = ATTACH_TYPES[type];
      if (!ext || !Buffer.isBuffer(req.body) || !req.body.length)
        throw AppError.badRequest('Attach a PDF or image up to 10 MB');
      const path = `${r.employeeId}/leave/${r.id}-${randomUUID()}.${ext}`;
      await ctx.storage().upload(ATTACH_BUCKET, path, req.body, type);
      const updated = await withAudit(ctx.db, ctx.actor, 'leave_requests', async (tx) => {
        const [u] = await tx
          .update(leaveRequests)
          .set({ attachmentPath: path, updatedBy: ctx.user.id, updatedAt: new Date() })
          .where(eq(leaveRequests.id, r.id))
          .returning();
        return { action: 'attach', entityId: r.id, after: { attachmentPath: path }, result: u! };
      });
      res.json(ok((await requestDtos(ctx, [updated]))[0]));
    },
  );

  router.get('/leave/requests/:id/attachment', read, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    const [row] = await ctx.db
      .select({ r: leaveRequests })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .where(
        and(
          eq(leaveRequests.id, params.id),
          or(
            scopeCondition(scopeOf(req, 'leave.read'), ctx.user.employeeId, employees.id),
            ctx.user.employeeId
              ? eq(leaveRequests.currentApproverEmployeeId, ctx.user.employeeId)
              : sql`false`,
          ),
        ),
      );
    if (!row?.r.attachmentPath) throw AppError.notFound('No attachment');
    res.json(ok({ url: await ctx.storage().signedUrl(ATTACH_BUCKET, row.r.attachmentPath, 60) }));
  });

  // ── Calendar ───────────────────────────────────────────────────────────────
  const calSchemas = {
    query: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      departmentId: z.uuid().optional(),
    }),
  };
  router.get('/leave/calendar', read, validate(calSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, calSchemas);
    const [y, m] = query.month.split('-').map(Number) as [number, number];
    const range = monthRange(y, m);
    const rows = await ctx.db
      .select({ d: leaveRequestDays, r: leaveRequests, e: employees, t: leaveTypes })
      .from(leaveRequestDays)
      .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          gte(leaveRequestDays.date, range.start),
          lte(leaveRequestDays.date, range.end),
          inArray(leaveRequests.status, ['pending', 'approved']),
          scopeCondition(scopeOf(req, 'leave.read'), ctx.user.employeeId, employees.id),
          query.departmentId ? eq(employees.departmentId, query.departmentId) : undefined,
        ),
      )
      .orderBy(asc(leaveRequestDays.date), asc(employees.firstName));
    const [anyone] = await ctx.db.select().from(employees).limit(1);
    const cal = anyone
      ? await employeeCalendar(ctx.db, { ...anyone, branchId: null }, range.start, range.end)
      : { holidays: [] };
    res.json(
      ok({
        month: query.month,
        entries: rows.map(({ d, r, e, t }) => ({
          requestId: r.id,
          employeeId: e.id,
          employeeName: `${e.firstName} ${e.lastName}`,
          leaveTypeCode: t.code,
          color: t.color,
          date: d.date,
          portion: Number(d.portion),
          half: d.half,
          status: r.status as 'pending' | 'approved',
        })),
        holidays: cal.holidays,
      }),
    );
  });

  // ── Admin: adjustments, report, year-end ───────────────────────────────────
  const adjSchemas = { body: adjustmentSchema };
  router.post('/leave/adjustments', manage, validate(adjSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, adjSchemas);
    await withAudit(ctx.db, ctx.actor, 'leave_ledger', async (tx) => {
      const [l] = await tx
        .insert(leaveLedger)
        .values({
          employeeId: body.employeeId,
          leaveTypeId: body.leaveTypeId,
          periodYear: body.year,
          entryType: 'adjustment',
          amount: String(body.amount),
          note: body.note,
          effectiveDate: tenantToday(ctx),
          createdBy: ctx.user.id,
        })
        .returning();
      return { action: 'adjust', entityId: l!.id, after: l, result: l };
    });
    res.status(201).json(ok(await balanceOf(ctx.db, body.employeeId, body.leaveTypeId, body.year)));
  });

  const reportSchemas = {
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      departmentId: z.uuid().optional(),
    }),
  };
  router.get(
    '/leave/report/balances',
    requirePermission('leave.read', 'team'),
    validate(reportSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { query } = parsed(req, reportSchemas);
      const today = tenantToday(ctx);
      const year = query.year ?? leaveYearOf(today);
      const asOf = balanceAsOf(year, today);
      const dept = aliasedTable(departments, 'dept');
      const staff = await ctx.db
        .select({ e: employees, department: dept.name })
        .from(employees)
        .leftJoin(dept, eq(dept.id, employees.departmentId))
        .where(
          and(
            isNull(employees.archivedAt),
            inArray(employees.status, CURRENT_STATUSES),
            scopeCondition(scopeOf(req, 'leave.read'), ctx.user.employeeId, employees.id),
            query.departmentId ? eq(employees.departmentId, query.departmentId) : undefined,
          ),
        )
        .orderBy(asc(employees.employeeNo));
      const rows = [];
      for (const { e, department } of staff) {
        const b = await balancesFor(ctx.db, e, year, asOf);
        rows.push({
          employeeId: e.id,
          employeeNo: e.employeeNo,
          name: `${e.firstName} ${e.lastName}`,
          department,
          balances: Object.fromEntries(
            b.map((x) => [x.type.code, { balance: x.balance, taken: x.taken, pending: x.pending }]),
          ),
        });
      }
      res.json(ok({ year, rows }));
    },
  );

  /**
   * Year-end: carry forward up to each policy's cap into next year (as ledger entries). Re-runnable:
   * entries are keyed by employee/type/year, and a run record prevents accidental double runs.
   */
  const yearEndSchemas = { body: yearEndRunSchema };
  router.post('/leave/year-end', manage, validate(yearEndSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, yearEndSchemas);
    const from = body.fromYear;
    const to = from + 1;
    const [prior] = await ctx.db
      .select()
      .from(leaveYearRuns)
      .where(eq(leaveYearRuns.fromYear, from));
    const staff = await ctx.db
      .select()
      .from(employees)
      .where(and(isNull(employees.archivedAt), inArray(employees.status, CURRENT_STATUSES)));
    const types = await ctx.db.select().from(leaveTypes).where(eq(leaveTypes.isActive, true));
    const plan: {
      employee: typeof employees.$inferSelect;
      type: typeof leaveTypes.$inferSelect;
      closing: number;
      carry: number;
      expiryMonths: number | null;
    }[] = [];
    for (const e of staff) {
      for (const t of types) {
        const policy = await resolvePolicy(ctx.db, e, t.id, `${from}-12-31`);
        if (!policy) continue;
        const b = await balanceOf(ctx.db, e.id, t.id, from);
        const carry = carryForwardAmount(b.balance, Number(policy.carryForwardMax));
        if (b.balance === 0 && carry === 0) continue;
        plan.push({
          employee: e,
          type: t,
          closing: b.balance,
          carry,
          expiryMonths: policy.carryForwardExpiryMonths,
        });
      }
    }
    const preview = {
      fromYear: from,
      alreadyRun: !!prior,
      rows: plan.map((p) => ({
        employeeNo: p.employee.employeeNo,
        name: `${p.employee.firstName} ${p.employee.lastName}`,
        leaveTypeCode: p.type.code,
        closingBalance: p.closing,
        carryForward: p.carry,
        lapsed: Math.max(0, p.closing - p.carry),
      })),
    };
    if (body.dryRun) return void res.json(ok(preview));
    if (prior) throw new AppError(409, 'CONFLICT', `Year-end for ${from} has already been run`);
    await withAudit(ctx.db, ctx.actor, 'leave_ledger', async (tx) => {
      const entries = plan
        .filter((p) => p.carry > 0)
        .map((p) => ({
          employeeId: p.employee.id,
          leaveTypeId: p.type.id,
          periodYear: to,
          entryType: 'carry_forward' as const,
          amount: String(p.carry),
          idempotencyKey: `cf:${p.employee.id}:${p.type.id}:${from}`,
          note: p.expiryMonths
            ? `Carried from ${from}; expires after ${p.expiryMonths} month(s)`
            : `Carried from ${from}`,
          effectiveDate: `${to}-01-01`,
          createdBy: ctx.user.id,
        }));
      if (entries.length)
        await tx
          .insert(leaveLedger)
          .values(entries)
          .onConflictDoNothing({ target: leaveLedger.idempotencyKey });
      await tx.insert(leaveYearRuns).values({
        fromYear: from,
        ranBy: ctx.user.id,
        summary: { rows: preview.rows.length, carried: entries.length },
      });
      return {
        action: 'year_end',
        entityId: null,
        after: { fromYear: from, carried: entries.length },
        result: null,
      };
    });
    res.json(ok({ ...preview, alreadyRun: true }));
  });

  return router;
}
