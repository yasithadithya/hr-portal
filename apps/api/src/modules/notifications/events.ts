import { eq } from 'drizzle-orm';

import { schema } from '@hr/db';

import type { RequestContext } from '../../context';

import { notify, usersOfEmployees, usersWithPermission, type NotificationInput } from './notify';

/**
 * Domain events → notifications (PLAN.md Phase 8). Called after the business transaction has
 * committed; a notification failure is logged and never turns a successful action into an error.
 */
const { employees, leaveTypes, payrollPeriods, payrollRuns, payslips } = schema;

async function send(
  ctx: RequestContext,
  build: () => Promise<NotificationInput | NotificationInput[] | null>,
) {
  try {
    const items = await build();
    if (items) await notify({ db: ctx.db, tenantId: ctx.tenant.id, jobs: ctx.jobs }, items);
  } catch (err) {
    console.error('notification failed', err);
  }
}

const fmt = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
const range = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`);

async function nameOf(ctx: RequestContext, employeeId: string) {
  const [e] = await ctx.db.select().from(employees).where(eq(employees.id, employeeId));
  return e ? `${e.firstName} ${e.lastName}` : 'An employee';
}

/** Who acts next on a pending request: the named manager, else HR approvers. */
async function approvers(
  ctx: RequestContext,
  approverEmployeeId: string | null,
  hrKey: 'leave.approve' | 'attendance.approve',
) {
  return approverEmployeeId
    ? usersOfEmployees(ctx.db, [approverEmployeeId])
    : usersWithPermission(ctx.db, hrKey, 'all');
}

interface LeaveLike {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  amount: string;
  status: string;
  currentApproverEmployeeId: string | null;
  decisionNote: string | null;
}

export function leaveSubmitted(ctx: RequestContext, r: LeaveLike) {
  return send(ctx, async () => {
    if (r.status !== 'pending') return null;
    const [t] = await ctx.db.select().from(leaveTypes).where(eq(leaveTypes.id, r.leaveTypeId));
    return {
      userIds: (await approvers(ctx, r.currentApproverEmployeeId, 'leave.approve')).filter(
        (u) => u !== ctx.user?.id,
      ),
      event: 'leave.submitted',
      title: `${await nameOf(ctx, r.employeeId)} requested ${t?.name.toLowerCase() ?? 'leave'}`,
      body: `${range(r.startDate, r.endDate)} (${Number(r.amount)} ${t?.unit === 'hour' ? 'h' : 'day(s)'}). Tap to review.`,
      link: '/approvals',
      data: { requestId: r.id },
    };
  });
}

export function leaveDecided(ctx: RequestContext, r: LeaveLike) {
  return send(ctx, async () => {
    if (r.status === 'pending') return leaveSubmittedItem(ctx, r);
    if (r.status !== 'approved' && r.status !== 'rejected') return null;
    const [t] = await ctx.db.select().from(leaveTypes).where(eq(leaveTypes.id, r.leaveTypeId));
    return {
      userIds: await usersOfEmployees(ctx.db, [r.employeeId]),
      event: 'leave.decided',
      title: `Your ${t?.name.toLowerCase() ?? 'leave'} was ${r.status}`,
      body: `${range(r.startDate, r.endDate)}${r.decisionNote ? ` — ${r.decisionNote}` : ''}`,
      link: '/leave',
      data: { requestId: r.id },
    };
  });
}

/** A multi-step approval moved on: tell the next approver. */
async function leaveSubmittedItem(ctx: RequestContext, r: LeaveLike): Promise<NotificationInput> {
  const [t] = await ctx.db.select().from(leaveTypes).where(eq(leaveTypes.id, r.leaveTypeId));
  return {
    userIds: (await approvers(ctx, r.currentApproverEmployeeId, 'leave.approve')).filter(
      (u) => u !== ctx.user?.id,
    ),
    event: 'leave.submitted',
    title: `${await nameOf(ctx, r.employeeId)}'s ${t?.name.toLowerCase() ?? 'leave'} needs your approval`,
    body: `${range(r.startDate, r.endDate)}. Approved at the previous step.`,
    link: '/approvals',
    data: { requestId: r.id },
  };
}

interface RegLike {
  id: string;
  employeeId: string;
  date: string;
  status: string;
  currentApproverEmployeeId: string | null;
  decisionNote: string | null;
}

export function regularizationSubmitted(ctx: RequestContext, r: RegLike) {
  return send(ctx, async () =>
    r.status !== 'pending'
      ? null
      : {
          userIds: (await approvers(ctx, r.currentApproverEmployeeId, 'attendance.approve')).filter(
            (u) => u !== ctx.user?.id,
          ),
          event: 'attendance.regularization_submitted',
          title: `${await nameOf(ctx, r.employeeId)} asked to correct attendance`,
          body: `For ${fmt(r.date)}. Tap to review.`,
          link: '/approvals',
          data: { requestId: r.id },
        },
  );
}

export function regularizationDecided(ctx: RequestContext, r: RegLike) {
  return send(ctx, async () => {
    if (r.status === 'pending') return regularizationNext(ctx, r);
    if (r.status !== 'approved' && r.status !== 'rejected') return null;
    return {
      userIds: await usersOfEmployees(ctx.db, [r.employeeId]),
      event: 'attendance.regularization_decided',
      title: `Your attendance correction for ${fmt(r.date)} was ${r.status}`,
      body:
        r.decisionNote ??
        (r.status === 'approved'
          ? 'Your attendance has been updated.'
          : 'Contact your manager for details.'),
      link: '/attendance',
      data: { requestId: r.id },
    };
  });
}

async function regularizationNext(ctx: RequestContext, r: RegLike): Promise<NotificationInput> {
  return {
    userIds: (await approvers(ctx, r.currentApproverEmployeeId, 'attendance.approve')).filter(
      (u) => u !== ctx.user?.id,
    ),
    event: 'attendance.regularization_submitted',
    title: `${await nameOf(ctx, r.employeeId)}'s attendance correction needs your approval`,
    body: `For ${fmt(r.date)}. Approved at the previous step.`,
    link: '/approvals',
    data: { requestId: r.id },
  };
}

/** Payroll locked: every employee in the run can now see their payslip. */
export function payslipsPublished(ctx: RequestContext, runId: string) {
  return send(ctx, async () => {
    const [run] = await ctx.db
      .select({ r: payrollRuns, p: payrollPeriods })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .where(eq(payrollRuns.id, runId));
    if (!run || run.r.status !== 'locked') return null;
    const slips = await ctx.db
      .select({ e: payslips.employeeId })
      .from(payslips)
      .where(eq(payslips.runId, runId));
    const month = new Date(Date.UTC(run.p.year, run.p.month - 1, 1)).toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    });
    const users = slips.length
      ? await usersOfEmployees(
          ctx.db,
          slips.map((s) => s.e),
        )
      : [];
    return {
      userIds: users,
      event: 'payroll.payslip_published',
      title: `Your payslip for ${month} is ready`,
      body: `Pay date ${run.p.payDate}. Open it in My payslips.`,
      link: '/me/payslips',
      data: { runId },
      dedupeKey: `payslip:${runId}`,
    };
  });
}
