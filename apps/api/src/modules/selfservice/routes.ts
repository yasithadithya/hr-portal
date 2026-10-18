import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { appendAudit, schema, scopeCondition, withAudit } from '@hr/db';
import {
  decisionSchema,
  ok,
  PROFILE_FIELDS,
  profileChangeInputSchema,
  scopeCovers,
  type ApprovalsSummary,
  type ProfileChange,
} from '@hr/shared';

import { authedCtx, type AuthedUser, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { regInboxWhere } from '../attendance/service';
import { getSettings } from '../company/routes';
import { inboxWhere as leaveInboxWhere } from '../leave/service';
import { notify, usersOfEmployees, usersWithPermission } from '../notifications/notify';

const { attendanceDays, employees, leaveRequests, profileChangeRequests, regularizationRequests } =
  schema;
type Ctx = RequestContext & { user: AuthedUser };
const idParams = { params: z.object({ id: z.uuid() }) };
const SECTION_LABEL = {
  personal: 'personal details',
  contact: 'contact details',
  bank: 'bank details',
};

async function dtos(
  ctx: Ctx,
  rows: (typeof profileChangeRequests.$inferSelect)[],
): Promise<ProfileChange[]> {
  if (!rows.length) return [];
  const emps = await ctx.db
    .select()
    .from(employees)
    .where(inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))]));
  const by = new Map(emps.map((e) => [e.id, e]));
  return rows.map((r) => {
    const e = by.get(r.employeeId)!;
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeNo: e.employeeNo,
      employeeName: `${e.firstName} ${e.lastName}`,
      section: r.section,
      changes: r.changes,
      note: r.note,
      status: r.status,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function selfServiceRoutes(): Router {
  const router = Router();
  const hr = requirePermission('employees.update', 'all');

  // ── Profile change requests ────────────────────────────────────────────────
  const createSchemas = { body: profileChangeInputSchema };
  router.post('/me/profile-changes', validate(createSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, createSchemas);
    if (!ctx.user.employeeId)
      throw AppError.badRequest('Your account is not linked to an employee');
    const row = await withAudit(ctx.db, ctx.actor, 'profile_change_requests', async (tx) => {
      const [e] = await tx.select().from(employees).where(eq(employees.id, ctx.user.employeeId!));
      if (!e) throw AppError.notFound('Employee not found');
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const allowed = PROFILE_FIELDS[body.section] as readonly string[];
      for (const [k, to] of Object.entries(body.values)) {
        if (!allowed.includes(k)) continue;
        const from = (e as Record<string, unknown>)[k];
        if (!same(from, to)) changes[k] = { from: from ?? null, to: to ?? null };
      }
      if (!Object.keys(changes).length) throw AppError.badRequest('Nothing has changed');
      const [open] = await tx
        .select({ id: profileChangeRequests.id })
        .from(profileChangeRequests)
        .where(
          and(
            eq(profileChangeRequests.employeeId, e.id),
            eq(profileChangeRequests.section, body.section),
            eq(profileChangeRequests.status, 'pending'),
          ),
        );
      if (open)
        throw AppError.badRequest(
          `You already have a pending change to your ${SECTION_LABEL[body.section]}`,
        );
      const [r] = await tx
        .insert(profileChangeRequests)
        .values({
          employeeId: e.id,
          section: body.section,
          changes,
          note: body.note ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      return { action: 'request', entityId: r!.id, after: r, result: { r: r!, e } };
    });
    await notify(
      { db: ctx.db, tenantId: ctx.tenant.id, jobs: ctx.jobs },
      {
        userIds: await usersWithPermission(ctx.db, 'employees.update'),
        event: 'profile.change_submitted',
        title: `${row.e.firstName} ${row.e.lastName} asked to update their ${SECTION_LABEL[row.r.section]}`,
        body: row.r.note ?? 'Review the change and apply or reject it.',
        link: '/approvals',
        data: { requestId: row.r.id },
      },
    );
    res.status(201).json(ok((await dtos(ctx, [row.r]))[0]));
  });

  router.get('/me/profile-changes', async (req, res) => {
    const ctx = authedCtx(req);
    const rows = ctx.user.employeeId
      ? await ctx.db
          .select()
          .from(profileChangeRequests)
          .where(eq(profileChangeRequests.employeeId, ctx.user.employeeId))
          .orderBy(desc(profileChangeRequests.createdAt))
          .limit(50)
      : [];
    res.json(ok(await dtos(ctx, rows)));
  });

  router.post('/me/profile-changes/:id/withdraw', validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    const r = await withAudit(ctx.db, ctx.actor, 'profile_change_requests', async (tx) => {
      const [before] = await tx
        .select()
        .from(profileChangeRequests)
        .where(eq(profileChangeRequests.id, params.id))
        .for('update');
      if (!before || before.employeeId !== ctx.user.employeeId)
        throw AppError.notFound('Request not found');
      if (before.status !== 'pending')
        throw AppError.badRequest(`This request is already ${before.status}`);
      const [after] = await tx
        .update(profileChangeRequests)
        .set({ status: 'withdrawn', updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(profileChangeRequests.id, params.id))
        .returning();
      return { action: 'withdraw', entityId: params.id, before, after, result: after! };
    });
    res.json(ok((await dtos(ctx, [r]))[0]));
  });

  const listSchemas = {
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']).optional(),
    }),
  };
  router.get('/profile-changes', hr, validate(listSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, listSchemas);
    const rows = await ctx.db
      .select()
      .from(profileChangeRequests)
      .where(query.status ? eq(profileChangeRequests.status, query.status) : undefined)
      .orderBy(asc(profileChangeRequests.createdAt))
      .limit(200);
    res.json(ok(await dtos(ctx, rows)));
  });

  const decideSchemas = { ...idParams, body: decisionSchema };
  for (const action of ['approve', 'reject'] as const) {
    router.post(`/profile-changes/:id/${action}`, hr, validate(decideSchemas), async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, decideSchemas);
      const r = await withAudit(ctx.db, ctx.actor, 'profile_change_requests', async (tx) => {
        const [before] = await tx
          .select()
          .from(profileChangeRequests)
          .where(eq(profileChangeRequests.id, params.id))
          .for('update');
        if (!before) throw AppError.notFound('Request not found');
        if (before.status !== 'pending')
          throw AppError.badRequest(`This request is already ${before.status}`);
        if (before.employeeId === ctx.user.employeeId)
          throw AppError.forbidden('You cannot approve a change to your own profile');
        if (action === 'approve') {
          const set = Object.fromEntries(Object.entries(before.changes).map(([k, v]) => [k, v.to]));
          const [prev] = await tx
            .select()
            .from(employees)
            .where(eq(employees.id, before.employeeId));
          await tx
            .update(employees)
            .set({ ...set, updatedBy: ctx.user.id, updatedAt: new Date() })
            .where(eq(employees.id, before.employeeId));
          await appendAudit(tx, ctx.actor, 'employees', {
            action: 'profile_change_applied',
            entityId: before.employeeId,
            before: Object.fromEntries(
              Object.keys(set).map((k) => [k, (prev as Record<string, unknown>)[k] ?? null]),
            ),
            after: set,
          });
        }
        const [after] = await tx
          .update(profileChangeRequests)
          .set({
            status: action === 'approve' ? 'approved' : 'rejected',
            decidedBy: ctx.user.id,
            decidedAt: new Date(),
            decisionNote: body.note ?? null,
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(eq(profileChangeRequests.id, params.id))
          .returning();
        return { action, entityId: params.id, before, after, result: after! };
      });
      await notify(
        { db: ctx.db, tenantId: ctx.tenant.id, jobs: ctx.jobs },
        {
          userIds: await usersOfEmployees(ctx.db, [r.employeeId]),
          event: 'profile.change_decided',
          title: `Your ${SECTION_LABEL[r.section]} change was ${action === 'approve' ? 'applied' : 'rejected'}`,
          body:
            r.decisionNote ??
            (action === 'approve' ? 'Your profile is up to date.' : 'Contact HR for details.'),
          link: '/me/profile',
        },
      );
      res.json(ok((await dtos(ctx, [r]))[0]));
    });
  }

  // ── Unified approvals ──────────────────────────────────────────────────────
  router.get('/approvals/summary', async (req, res) => {
    const ctx = authedCtx(req);
    const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const p = ctx.permissions;
    const leave = p['leave.approve']
      ? await count(
          ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(leaveRequests)
            .where(await leaveInboxWhere(ctx)),
        )
      : 0;
    const regs = p['attendance.approve']
      ? await count(
          ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(regularizationRequests)
            .where(regInboxWhere(ctx)),
        )
      : 0;
    const otScope = p['attendance.approve'];
    const settings = await getSettings(ctx.db);
    const overtime =
      otScope && settings['attendance.ot_requires_approval']
        ? await count(
            ctx.db
              .select({ n: sql<number>`count(*)::int` })
              .from(attendanceDays)
              .where(
                and(
                  gt(attendanceDays.otMinutes, 0),
                  isNull(attendanceDays.otApprovedMinutes),
                  eq(attendanceDays.isLocked, false),
                  scopeCondition(otScope, ctx.user.employeeId, attendanceDays.employeeId),
                  ctx.user.employeeId
                    ? sql`${attendanceDays.employeeId} <> ${ctx.user.employeeId}`
                    : undefined,
                ),
              ),
          )
        : 0;
    const profileChanges =
      p['employees.update'] && scopeCovers(p['employees.update'], 'all')
        ? await count(
            ctx.db
              .select({ n: sql<number>`count(*)::int` })
              .from(profileChangeRequests)
              .where(eq(profileChangeRequests.status, 'pending')),
          )
        : 0;
    const body: ApprovalsSummary = {
      leave,
      regularizations: regs,
      overtime,
      profileChanges,
      total: leave + regs + overtime + profileChanges,
    };
    res.json(ok(body));
  });

  router.get(
    '/approvals/overtime',
    requirePermission('attendance.approve', 'team'),
    async (req, res) => {
      const ctx = authedCtx(req);
      const scope = ctx.permissions['attendance.approve']!;
      const rows = await ctx.db
        .select({ d: attendanceDays, e: employees })
        .from(attendanceDays)
        .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
        .where(
          and(
            gt(attendanceDays.otMinutes, 0),
            isNull(attendanceDays.otApprovedMinutes),
            eq(attendanceDays.isLocked, false),
            scopeCondition(scope, ctx.user.employeeId, employees.id),
            ctx.user.employeeId ? sql`${employees.id} <> ${ctx.user.employeeId}` : undefined,
          ),
        )
        .orderBy(desc(attendanceDays.date))
        .limit(200);
      res.json(
        ok(
          rows.map(({ d, e }) => ({
            dayId: d.id,
            employeeId: e.id,
            employeeNo: e.employeeNo,
            employeeName: `${e.firstName} ${e.lastName}`,
            date: d.date,
            otMinutes: d.otMinutes,
          })),
        ),
      );
    },
  );

  return router;
}
