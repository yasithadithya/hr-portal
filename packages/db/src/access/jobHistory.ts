import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { addDays, type BusinessDate } from '@hr/shared/time';

import type { TenantDb } from '../index';
import { employeeJobHistory, employees } from '../schema/index';

import type { Tx } from './audit';

type Db = TenantDb | Tx;

export const JOB_FIELDS = [
  'branchId',
  'departmentId',
  'designationId',
  'gradeId',
  'costCenterId',
  'reportsToId',
  'employmentType',
] as const;

export type JobValues = {
  branchId: string | null;
  departmentId: string | null;
  designationId: string | null;
  gradeId: string | null;
  costCenterId: string | null;
  reportsToId: string | null;
  employmentType: (typeof employeeJobHistory.$inferSelect)['employmentType'];
};

export type JobRow = typeof employeeJobHistory.$inferSelect;

export class JobHistoryError extends Error {
  override name = 'JobHistoryError';
}

/** The job record in force on `date` (inclusive), or null if before the first record. */
export async function jobAsOf(
  db: Db,
  employeeId: string,
  date: BusinessDate,
): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(employeeJobHistory)
    .where(
      and(
        eq(employeeJobHistory.employeeId, employeeId),
        lte(employeeJobHistory.effectiveFrom, date),
        or(isNull(employeeJobHistory.effectiveTo), gte(employeeJobHistory.effectiveTo, date)),
      ),
    )
    .orderBy(desc(employeeJobHistory.effectiveFrom))
    .limit(1);
  return row ?? null;
}

/**
 * Inserts (or, for the same start date, replaces) a job record and re-links the ranges either
 * side so the timeline stays gap-free and non-overlapping. Then re-projects the current job
 * fields onto `employees` for `today`. Must run inside the caller's transaction.
 */
export async function applyJobChange(
  tx: Tx,
  input: {
    employeeId: string;
    effectiveFrom: BusinessDate;
    values: JobValues;
    reason: JobRow['reason'];
    notes?: string | null;
    actorId: string | null;
    today: BusinessDate;
  },
): Promise<JobRow> {
  // Serialise changes per employee.
  const [emp] = await tx
    .select({ id: employees.id, joinDate: employees.joinDate })
    .from(employees)
    .where(eq(employees.id, input.employeeId))
    .for('update');
  if (!emp) throw new JobHistoryError('Employee not found');
  if (input.effectiveFrom < emp.joinDate) {
    throw new JobHistoryError('A job change cannot take effect before the join date');
  }

  const rows = await tx
    .select()
    .from(employeeJobHistory)
    .where(eq(employeeJobHistory.employeeId, input.employeeId))
    .orderBy(asc(employeeJobHistory.effectiveFrom));

  const same = rows.find((r) => r.effectiveFrom === input.effectiveFrom);
  const prev = [...rows].reverse().find((r) => r.effectiveFrom < input.effectiveFrom);
  const next = rows.find((r) => r.effectiveFrom > input.effectiveFrom);
  const effectiveTo = next ? addDays(next.effectiveFrom, -1) : null;

  let saved: JobRow;
  if (same) {
    [saved] = (await tx
      .update(employeeJobHistory)
      .set({
        ...input.values,
        reason: input.reason,
        notes: input.notes ?? null,
        updatedBy: input.actorId,
        updatedAt: new Date(),
      })
      .where(eq(employeeJobHistory.id, same.id))
      .returning()) as [JobRow];
  } else {
    if (prev) {
      await tx
        .update(employeeJobHistory)
        .set({ effectiveTo: addDays(input.effectiveFrom, -1), updatedAt: new Date() })
        .where(eq(employeeJobHistory.id, prev.id));
    }
    [saved] = (await tx
      .insert(employeeJobHistory)
      .values({
        employeeId: input.employeeId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo,
        ...input.values,
        reason: input.reason,
        notes: input.notes ?? null,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })
      .returning()) as [JobRow];
  }

  await projectCurrentJob(tx, input.employeeId, input.today);
  return saved;
}

/** Copies the job record in force on `today` onto the employee row. */
export async function projectCurrentJob(db: Db, employeeId: string, today: BusinessDate) {
  const current = await jobAsOf(db, employeeId, today);
  if (!current) return;
  await db
    .update(employees)
    .set({
      branchId: current.branchId,
      departmentId: current.departmentId,
      designationId: current.designationId,
      gradeId: current.gradeId,
      costCenterId: current.costCenterId,
      reportsToId: current.reportsToId,
      employmentType: current.employmentType,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, employeeId));
}

/**
 * Re-projects every employee whose current job record differs from the projection — run daily
 * so future-dated changes take effect on their start date (scheduled from Phase 8).
 */
export async function refreshJobProjections(db: TenantDb, today: BusinessDate): Promise<number> {
  const stale = await db.execute<{ id: string }>(sql`
    select e.id from employees e
    join employee_job_history h on h.employee_id = e.id
      and h.effective_from <= ${today} and (h.effective_to is null or h.effective_to >= ${today})
    where e.department_id is distinct from h.department_id
       or e.branch_id is distinct from h.branch_id
       or e.designation_id is distinct from h.designation_id
       or e.grade_id is distinct from h.grade_id
       or e.cost_center_id is distinct from h.cost_center_id
       or e.reports_to_id is distinct from h.reports_to_id
       or e.employment_type is distinct from h.employment_type`);
  for (const { id } of stale) await projectCurrentJob(db, id, today);
  return stale.length;
}
