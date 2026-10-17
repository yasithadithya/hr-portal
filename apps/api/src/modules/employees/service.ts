import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type { z } from 'zod';

import {
  applyJobChange,
  JobHistoryError,
  nextSequenceValue,
  schema,
  withAudit,
  type JobValues,
  type Tx,
} from '@hr/db';
import type {
  bankStatutorySchema,
  confirmSchema,
  datesSchema,
  exitSchema,
  hireSchema,
  jobChangeSchema,
  noticeSchema,
  personalSchema,
} from '@hr/shared';
import { today as todayIn } from '@hr/shared/time';

import type { AuthedUser, RequestContext } from '../../context';
import { AppError } from '../../lib/errors';

import { getEmployee, wouldCreateReportingLoop, type EmployeeRow } from './repo';

const { employees, employeeJobHistory } = schema;
type Ctx = RequestContext & { user: AuthedUser };

export function tenantToday(ctx: RequestContext): string {
  return todayIn(ctx.tenant.timezone);
}

async function mustGet(ctx: Ctx, id: string): Promise<EmployeeRow> {
  const e = await getEmployee(ctx.db, id);
  if (!e || e.archivedAt) throw AppError.notFound('Employee not found');
  return e;
}

function jobValues(v: z.output<typeof hireSchema> | z.output<typeof jobChangeSchema>): JobValues {
  return {
    branchId: v.branchId,
    departmentId: v.departmentId,
    designationId: v.designationId,
    gradeId: v.gradeId,
    costCenterId: v.costCenterId,
    reportsToId: v.reportsToId,
    employmentType: v.employmentType,
  };
}

function wrapJobError(err: unknown): never {
  if (err instanceof JobHistoryError) throw AppError.badRequest(err.message);
  throw err;
}

/** Creates the employee, takes a number if none was given, and opens the job history. */
export async function hire(
  ctx: Ctx,
  input: z.output<typeof hireSchema>,
  tx?: Tx,
): Promise<EmployeeRow> {
  const run = async (t: Tx) => {
    const employeeNo = input.employeeNo ?? (await nextSequenceValue(t, 'employee'));
    const status =
      input.probationEndDate && input.probationEndDate >= tenantToday(ctx)
        ? 'on_probation'
        : 'active';
    const { employeeNo: _n, ...rest } = input;
    const [created] = await t
      .insert(employees)
      .values({ ...rest, employeeNo, status, createdBy: ctx.user.id, updatedBy: ctx.user.id })
      .returning();
    await applyJobChange(t, {
      employeeId: created!.id,
      effectiveFrom: input.joinDate,
      values: jobValues(input),
      reason: 'hire',
      actorId: ctx.user.id,
      today: tenantToday(ctx),
    }).catch(wrapJobError);
    return created!;
  };
  if (tx) return run(tx);
  return withAudit(ctx.db, ctx.actor, 'employees', async (t) => {
    const created = await run(t);
    return { action: 'hire', entityId: created.id, after: created, result: created };
  });
}

export async function updatePersonal(ctx: Ctx, id: string, input: z.output<typeof personalSchema>) {
  const before = await mustGet(ctx, id);
  return withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
    const [after] = await tx
      .update(employees)
      .set({ ...input, updatedBy: ctx.user.id, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    return { action: 'update_personal', entityId: id, before, after, result: after! };
  });
}

export async function updateBank(
  ctx: Ctx,
  id: string,
  input: z.output<typeof bankStatutorySchema>,
) {
  const before = await mustGet(ctx, id);
  return withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
    const [after] = await tx
      .update(employees)
      .set({ ...input, updatedBy: ctx.user.id, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    const pick = (e: EmployeeRow) => ({
      bankName: e.bankName,
      bankBranch: e.bankBranch,
      bankAccountNo: e.bankAccountNo,
      bankAccountName: e.bankAccountName,
      epfNo: e.epfNo,
      etfNo: e.etfNo,
      taxFileNo: e.taxFileNo,
    });
    return {
      action: 'update_bank',
      entityId: id,
      before: pick(before),
      after: pick(after!),
      result: after!,
    };
  });
}

export async function changeJob(ctx: Ctx, id: string, input: z.output<typeof jobChangeSchema>) {
  const before = await mustGet(ctx, id);
  if (input.reportsToId && (await wouldCreateReportingLoop(ctx.db, id, input.reportsToId))) {
    throw AppError.badRequest('That manager reports (directly or indirectly) to this employee');
  }
  return withAudit(ctx.db, ctx.actor, 'employee_job_history', async (tx) => {
    const row = await applyJobChange(tx, {
      employeeId: id,
      effectiveFrom: input.effectiveFrom,
      values: jobValues(input),
      reason: input.reason,
      notes: input.notes,
      actorId: ctx.user.id,
      today: tenantToday(ctx),
    }).catch(wrapJobError);
    return { action: input.reason, entityId: id, before, after: row, result: row };
  });
}

export async function confirm(ctx: Ctx, id: string, input: z.output<typeof confirmSchema>) {
  const before = await mustGet(ctx, id);
  if (before.status !== 'on_probation')
    throw AppError.badRequest('Only employees on probation can be confirmed');
  if (input.confirmationDate < before.joinDate)
    throw AppError.badRequest('Confirmation is before the join date');
  return withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
    const set: Partial<EmployeeRow> = {
      status: 'active',
      confirmationDate: input.confirmationDate,
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
    };
    const [after] = await tx.update(employees).set(set).where(eq(employees.id, id)).returning();
    // A probationary contract becomes permanent from the confirmation date.
    if (before.employmentType === 'probation') {
      await applyJobChange(tx, {
        employeeId: id,
        effectiveFrom: input.confirmationDate,
        values: {
          branchId: before.branchId,
          departmentId: before.departmentId,
          designationId: before.designationId,
          gradeId: before.gradeId,
          costCenterId: before.costCenterId,
          reportsToId: before.reportsToId,
          employmentType: 'permanent',
        },
        reason: 'confirmation',
        actorId: ctx.user.id,
        today: tenantToday(ctx),
      }).catch(wrapJobError);
    }
    return { action: 'confirm', entityId: id, before, after, result: after! };
  });
}

export async function setNotice(ctx: Ctx, id: string, input: z.output<typeof noticeSchema>) {
  const before = await mustGet(ctx, id);
  if (!['active', 'on_probation'].includes(before.status)) {
    throw AppError.badRequest('Notice can only be set for a current employee');
  }
  if (input.exitDate < before.joinDate)
    throw AppError.badRequest('Exit date is before the join date');
  return withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
    const [after] = await tx
      .update(employees)
      .set({
        status: 'notice',
        exitDate: input.exitDate,
        exitReason: input.exitReason,
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, id))
      .returning();
    return { action: 'notice', entityId: id, before, after, result: after! };
  });
}

export async function exitEmployee(ctx: Ctx, id: string, input: z.output<typeof exitSchema>) {
  const before = await mustGet(ctx, id);
  if (['resigned', 'terminated', 'retired'].includes(before.status)) {
    throw AppError.badRequest('This employee has already left');
  }
  if (input.exitDate < before.joinDate)
    throw AppError.badRequest('Exit date is before the join date');
  const [later] = await ctx.db
    .select({ id: employeeJobHistory.id })
    .from(employeeJobHistory)
    .where(
      and(
        eq(employeeJobHistory.employeeId, id),
        gt(employeeJobHistory.effectiveFrom, input.exitDate),
      ),
    );
  if (later)
    throw AppError.badRequest('There are job changes after this exit date; remove them first');
  return withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
    const [after] = await tx
      .update(employees)
      .set({
        status: input.status,
        exitDate: input.exitDate,
        exitReason: input.exitReason,
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, id))
      .returning();
    // No record starts after the exit date (checked above), so the last record is the one in
    // force on that date: close it there.
    const [last] = await tx
      .select({ id: employeeJobHistory.id })
      .from(employeeJobHistory)
      .where(eq(employeeJobHistory.employeeId, id))
      .orderBy(desc(employeeJobHistory.effectiveFrom))
      .limit(1);
    if (last) {
      await tx
        .update(employeeJobHistory)
        .set({ effectiveTo: input.exitDate, updatedAt: new Date() })
        .where(eq(employeeJobHistory.id, last.id));
    }
    return { action: 'exit', entityId: id, before, after, result: after! };
  });
}

/** Corrects join/probation/contract dates; the opening job record moves with the join date. */
export async function updateDates(ctx: Ctx, id: string, input: z.output<typeof datesSchema>) {
  const before = await mustGet(ctx, id);
  const history = await ctx.db
    .select()
    .from(employeeJobHistory)
    .where(eq(employeeJobHistory.employeeId, id))
    .orderBy(asc(employeeJobHistory.effectiveFrom));
  const [first, second] = history;
  if (second && input.joinDate >= second.effectiveFrom) {
    throw AppError.badRequest('The join date must be before the first job change');
  }
  return withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
    const [after] = await tx
      .update(employees)
      .set({ ...input, updatedBy: ctx.user.id, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    if (first && first.effectiveFrom !== input.joinDate) {
      await tx
        .update(employeeJobHistory)
        .set({ effectiveFrom: input.joinDate, updatedAt: new Date() })
        .where(eq(employeeJobHistory.id, first.id));
    }
    return { action: 'update_dates', entityId: id, before, after, result: after! };
  });
}
