import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { schema, withAudit, type Tx } from '@hr/db';
import {
  CURRENT_STATUSES,
  scopeCovers,
  type applyLeaveSchema,
  type LeaveQuote,
  type LeaveRequest,
} from '@hr/shared';
import { leaveYearOf, LeaveRuleError, requestDays } from '@hr/shared/leave';
import { countWorkingDays } from '@hr/shared/time';

import type { AuthedUser, RequestContext } from '../../context';
import { approvalSteps, nextStep, type Step } from '../../lib/approvals';
import { AppError } from '../../lib/errors';
import { processRange } from '../attendance/process';
import { tenantToday } from '../employees/service';

import {
  balanceOf,
  employeeCalendar,
  ensureAccruals,
  ensureCarryExpiry,
  resolvePolicy,
  type Employee,
  type LeaveTypeRow,
} from './engine';

const { employees, leaveLedger, leaveRequestDays, leaveRequests, leaveTypes } = schema;

type Ctx = RequestContext & { user: AuthedUser };
type ApplyInput = z.output<typeof applyLeaveSchema>;
type RequestRow = typeof leaveRequests.$inferSelect;

const num = (v: string | number | null) => (v === null ? null : Number(v));

function ruleError(err: unknown): never {
  if (err instanceof LeaveRuleError) throw AppError.badRequest(err.message);
  throw err;
}

export async function flowSteps(db: Ctx['db'] | Tx): Promise<Step[]> {
  return approvalSteps(db, 'leave');
}

/** Approved or cancelled leave changes the attendance days it covers (locked months are skipped). */
async function syncAttendance(ctx: Ctx, tx: Tx, r: RequestRow) {
  await processRange(tx, {
    tz: ctx.tenant.timezone,
    from: r.startDate,
    to: r.endDate,
    today: tenantToday(ctx),
    employeeIds: [r.employeeId],
  });
}

export function toRequestDto(
  r: RequestRow,
  e: Pick<Employee, 'firstName' | 'lastName' | 'employeeNo'>,
  t: LeaveTypeRow,
  steps: Step[],
): LeaveRequest {
  const threshold = num(t.requiresAttachmentAfterDays);
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: `${e.firstName} ${e.lastName}`,
    employeeNo: e.employeeNo,
    leaveType: { id: t.id, code: t.code, name: t.name, color: t.color, unit: t.unit },
    startDate: r.startDate,
    endDate: r.endDate,
    startHalf: r.startHalf,
    endHalf: r.endHalf,
    hours: num(r.hours),
    amount: Number(r.amount),
    reason: r.reason,
    hasAttachment: !!r.attachmentPath,
    attachmentRequired: threshold !== null && Number(r.amount) > threshold,
    status: r.status,
    currentStep: r.currentStep,
    waitingFor:
      r.status !== 'pending'
        ? null
        : r.currentApproverEmployeeId
          ? 'manager'
          : (steps[r.currentStep] ?? 'hr'),
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  };
}

interface Checked {
  employee: Employee;
  type: LeaveTypeRow;
  days: { date: string; portion: number; half: 'full' | 'first' | 'second' }[];
  amount: number;
  year: number;
  balanceAfter: number | null;
  attachmentRequired: boolean;
  warnings: string[];
}

/**
 * All the rules for a request (PLAN.md Phase 5). Runs inside the apply transaction, after the
 * employee row is locked, so balance and overlap checks can't race.
 */
async function check(
  ctx: Ctx,
  db: Ctx['db'] | Tx,
  employee: Employee,
  input: ApplyInput,
  opts: { onBehalf: boolean },
): Promise<Checked> {
  const [type] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, input.leaveTypeId));
  if (!type || !type.isActive) throw AppError.badRequest('Unknown leave type');
  if (type.genderRestriction && employee.gender !== type.genderRestriction) {
    throw AppError.badRequest(`${type.name} is not available for this employee`);
  }
  if (!(CURRENT_STATUSES as string[]).includes(employee.status))
    throw AppError.badRequest('This employee is no longer employed');
  const year = leaveYearOf(input.startDate);
  if (leaveYearOf(input.endDate) !== year) {
    throw AppError.badRequest('Leave cannot span two leave years — split it into two requests');
  }
  if (input.startDate < employee.joinDate)
    throw AppError.badRequest('Leave starts before the join date');
  if (employee.exitDate && input.endDate > employee.exitDate)
    throw AppError.badRequest('Leave ends after the exit date');

  const policy = await resolvePolicy(db, employee, type.id, input.startDate);
  if (!policy)
    throw AppError.badRequest(`No ${type.name.toLowerCase()} policy covers this employee`);

  const cal = await employeeCalendar(db, employee, input.startDate, input.endDate);
  let expanded;
  try {
    expanded = requestDays(
      {
        start: input.startDate,
        end: input.endDate,
        startHalf: input.startHalf,
        endHalf: input.endHalf,
        unit: type.unit,
        hours: input.hours ?? null,
      },
      cal.workWeek,
      new Set(cal.holidays.map((h) => h.date)),
    );
  } catch (err) {
    ruleError(err);
  }
  if (expanded.amount <= 0) throw AppError.badRequest('There are no working days in that period');

  const warnings: string[] = [];
  const today = tenantToday(ctx);
  const notice =
    countWorkingDays(today, input.startDate, {
      mon: 'full',
      tue: 'full',
      wed: 'full',
      thu: 'full',
      fri: 'full',
      sat: 'full',
      sun: 'full',
    }) - 1;
  if (!opts.onBehalf && type.minNoticeDays > 0 && notice < type.minNoticeDays) {
    throw AppError.badRequest(`${type.name} needs ${type.minNoticeDays} day(s) notice`);
  }
  const maxConsecutive = num(type.maxConsecutiveDays);
  if (maxConsecutive !== null && type.unit !== 'hour' && expanded.amount > maxConsecutive) {
    throw AppError.badRequest(`${type.name} can be at most ${maxConsecutive} day(s) at a time`);
  }

  // Overlap: total portion per date across active requests can't exceed one day
  // (first-half and second-half leave on the same date is fine).
  const dates = expanded.days.map((d) => d.date);
  const existing = await db
    .select({
      date: leaveRequestDays.date,
      portion: leaveRequestDays.portion,
      half: leaveRequestDays.half,
      unit: leaveTypes.unit,
    })
    .from(leaveRequestDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.employeeId, employee.id),
        inArray(leaveRequests.status, ['pending', 'approved']),
        inArray(leaveRequestDays.date, dates),
      ),
    );
  for (const d of expanded.days) {
    const same = existing.filter((x) => x.date === d.date && x.unit !== 'hour');
    if (type.unit === 'hour' || same.length === 0) continue;
    const taken = same.reduce((s, x) => s + Number(x.portion), 0);
    const clash = same.some((x) => x.half === 'full' || x.half === d.half || d.half === 'full');
    if (clash || taken + d.portion > 1)
      throw AppError.badRequest(`You already have leave on ${d.date}`);
  }

  const asOf = input.startDate > today ? input.startDate : today;
  await ensureAccruals(db, employee, policy, year, asOf);
  await ensureCarryExpiry(db, employee, policy, year, asOf);
  const bal = await balanceOf(db, employee.id, type.id, year);
  const available = bal.balance - bal.pending;
  const balanceAfter = available - expanded.amount;
  if (!type.allowNegative && balanceAfter < 0) {
    throw AppError.badRequest(
      `Not enough ${type.name.toLowerCase()}: ${available} available, ${expanded.amount} requested`,
    );
  }
  if (policy.needsReview)
    warnings.push(`The ${type.name.toLowerCase()} policy has not been reviewed by HR yet`);

  const threshold = num(type.requiresAttachmentAfterDays);
  return {
    employee,
    type,
    days: expanded.days,
    amount: expanded.amount,
    year,
    balanceAfter: type.allowNegative ? null : balanceAfter,
    attachmentRequired: threshold !== null && expanded.amount > threshold,
    warnings,
  };
}

async function targetEmployee(
  ctx: Ctx,
  input: ApplyInput,
): Promise<{ employeeId: string; onBehalf: boolean }> {
  const self = ctx.user.employeeId;
  if (!input.employeeId || input.employeeId === self) {
    if (!self) throw AppError.badRequest('Your account is not linked to an employee');
    return { employeeId: self, onBehalf: false };
  }
  const scope = ctx.permissions['leave.manage'];
  if (!scope || !scopeCovers(scope, 'all'))
    throw AppError.forbidden('Only HR can apply on behalf of others');
  return { employeeId: input.employeeId, onBehalf: true };
}

/** Dry run: what would this request cost, and would it be allowed? */
export async function quote(ctx: Ctx, input: ApplyInput): Promise<LeaveQuote> {
  const { employeeId, onBehalf } = await targetEmployee(ctx, input);
  const [employee] = await ctx.db.select().from(employees).where(eq(employees.id, employeeId));
  if (!employee) throw AppError.notFound('Employee not found');
  const c = await check(ctx, ctx.db, employee, input, { onBehalf });
  return {
    amount: c.amount,
    unit: c.type.unit,
    days: c.days,
    balanceAfter: c.balanceAfter,
    attachmentRequired: c.attachmentRequired,
    warnings: c.warnings,
  };
}

export async function apply(ctx: Ctx, input: ApplyInput): Promise<RequestRow> {
  const { employeeId, onBehalf } = await targetEmployee(ctx, input);
  return withAudit(ctx.db, ctx.actor, 'leave_requests', async (tx) => {
    // Serialise this employee's leave: two concurrent requests can't both pass the balance check.
    const [employee] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .for('update');
    if (!employee) throw AppError.notFound('Employee not found');
    const c = await check(ctx, tx, employee, input, { onBehalf });
    const steps = await flowSteps(tx);
    const next = nextStep(steps, 0, employee);
    const [req] = await tx
      .insert(leaveRequests)
      .values({
        employeeId,
        leaveTypeId: c.type.id,
        periodYear: c.year,
        startDate: input.startDate,
        endDate: input.endDate,
        startHalf: input.startHalf,
        endHalf: input.endHalf,
        hours: input.hours ? String(input.hours) : null,
        amount: String(c.amount),
        reason: input.reason ?? null,
        currentStep: next?.step ?? 0,
        currentApproverEmployeeId: next?.approver ?? null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning();
    await tx.insert(leaveRequestDays).values(
      c.days.map((d) => ({
        requestId: req!.id,
        date: d.date,
        portion: String(d.portion),
        half: d.half,
      })),
    );
    return {
      action: onBehalf ? 'apply_on_behalf' : 'apply',
      entityId: req!.id,
      after: { ...req, days: c.days },
      result: req!,
    };
  });
}

/** Can this user act on the request's current step? */
function canAct(ctx: Ctx, r: RequestRow, steps: Step[]): boolean {
  if (r.employeeId === ctx.user.employeeId) return false; // never your own leave
  const hrScope = ctx.permissions['leave.approve'];
  if (hrScope && scopeCovers(hrScope, 'all')) return true; // HR can act on any step
  const step = steps[r.currentStep];
  return (
    step === 'manager' &&
    !!r.currentApproverEmployeeId &&
    r.currentApproverEmployeeId === ctx.user.employeeId &&
    !!hrScope
  );
}

export async function decide(
  ctx: Ctx,
  id: string,
  action: 'approve' | 'reject',
  note: string | null,
) {
  return withAudit(ctx.db, ctx.actor, 'leave_requests', async (tx) => {
    const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for('update');
    if (!r) throw AppError.notFound('Leave request not found');
    if (r.status !== 'pending') throw AppError.badRequest(`This request is already ${r.status}`);
    const steps = await flowSteps(tx);
    if (!canAct(ctx, r, steps)) {
      throw r.employeeId === ctx.user.employeeId
        ? AppError.forbidden('You cannot approve your own leave')
        : AppError.forbidden('This request is not waiting for you');
    }
    const [employee] = await tx.select().from(employees).where(eq(employees.id, r.employeeId));
    const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, r.leaveTypeId));
    const trail = [
      ...(r.approvalTrail ?? []),
      {
        step: r.currentStep,
        by: ctx.user.id,
        action,
        at: new Date().toISOString(),
        ...(note ? { note } : {}),
      },
    ];

    if (action === 'reject') {
      const [after] = await tx
        .update(leaveRequests)
        .set({
          status: 'rejected',
          approvalTrail: trail,
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decisionNote: note,
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequests.id, id))
        .returning();
      return { action: 'reject', entityId: id, before: r, after, result: after! };
    }

    const next = nextStep(steps, r.currentStep + 1, employee!);
    if (
      next &&
      next.step < steps.length &&
      !(next.approver && next.approver === ctx.user.employeeId)
    ) {
      const [after] = await tx
        .update(leaveRequests)
        .set({
          currentStep: next.step,
          currentApproverEmployeeId: next.approver,
          approvalTrail: trail,
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequests.id, id))
        .returning();
      return { action: 'approve_step', entityId: id, before: r, after, result: after! };
    }

    const threshold = num(type!.requiresAttachmentAfterDays);
    if (threshold !== null && Number(r.amount) > threshold && !r.attachmentPath) {
      throw AppError.badRequest(
        'A supporting document must be attached before this leave can be approved',
      );
    }
    const [after] = await tx
      .update(leaveRequests)
      .set({
        status: 'approved',
        approvalTrail: trail,
        decidedBy: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: note,
        currentApproverEmployeeId: null,
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(eq(leaveRequests.id, id))
      .returning();
    await tx.insert(leaveLedger).values({
      employeeId: r.employeeId,
      leaveTypeId: r.leaveTypeId,
      periodYear: r.periodYear,
      entryType: 'taken',
      amount: String(-Number(r.amount)),
      idempotencyKey: `taken:${r.id}`,
      refType: 'leave_request',
      refId: r.id,
      effectiveDate: r.startDate,
      createdBy: ctx.user.id,
    });
    await syncAttendance(ctx, tx, r);
    return { action: 'approve', entityId: id, before: r, after, result: after! };
  });
}

/**
 * Pending → withdrawn (by the employee). Approved → cancelled with a reversal ledger entry;
 * employees can cancel only before the leave starts, HR (leave.manage) any time.
 */
export async function cancel(ctx: Ctx, id: string, note: string | null) {
  return withAudit(ctx.db, ctx.actor, 'leave_requests', async (tx) => {
    const [r] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for('update');
    if (!r) throw AppError.notFound('Leave request not found');
    const own = r.employeeId === ctx.user.employeeId;
    const manageScope = ctx.permissions['leave.manage'];
    const isHr = !!manageScope && scopeCovers(manageScope, 'all');
    if (!own && !isHr) throw AppError.notFound('Leave request not found');
    if (r.status === 'pending') {
      const [after] = await tx
        .update(leaveRequests)
        .set({
          status: own ? 'withdrawn' : 'cancelled',
          decisionNote: note,
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequests.id, id))
        .returning();
      return {
        action: own ? 'withdraw' : 'cancel',
        entityId: id,
        before: r,
        after,
        result: after!,
      };
    }
    if (r.status !== 'approved') throw AppError.badRequest(`This request is already ${r.status}`);
    if (!isHr && r.startDate <= tenantToday(ctx)) {
      throw AppError.badRequest('Leave that has started can only be cancelled by HR');
    }
    const [after] = await tx
      .update(leaveRequests)
      .set({
        status: 'cancelled',
        decisionNote: note,
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(eq(leaveRequests.id, id))
      .returning();
    await tx.insert(leaveLedger).values({
      employeeId: r.employeeId,
      leaveTypeId: r.leaveTypeId,
      periodYear: r.periodYear,
      entryType: 'reversal',
      amount: String(Number(r.amount)),
      idempotencyKey: `rev:${r.id}`,
      refType: 'leave_request',
      refId: r.id,
      effectiveDate: r.startDate,
      note,
      createdBy: ctx.user.id,
    });
    await syncAttendance(ctx, tx, r);
    return { action: 'cancel_approved', entityId: id, before: r, after, result: after! };
  });
}

/** Requests waiting for this user's decision. */
export async function inboxWhere(ctx: Ctx) {
  const hrScope = ctx.permissions['leave.approve'];
  const isHr = !!hrScope && scopeCovers(hrScope, 'all');
  const mine = ctx.user.employeeId;
  return and(
    eq(leaveRequests.status, 'pending'),
    mine ? sql`${leaveRequests.employeeId} <> ${mine}` : undefined,
    isHr ? undefined : mine ? eq(leaveRequests.currentApproverEmployeeId, mine) : sql`false`,
  );
}
