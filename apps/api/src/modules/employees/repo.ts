import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { z } from 'zod';

import { schema, scopeCondition, type TenantDb, type Tx } from '@hr/db';
import {
  CURRENT_STATUSES,
  type employeeListQuerySchema,
  type EmployeeDetail,
  type EmployeeListItem,
  type JobHistoryItem,
  type Scope,
} from '@hr/shared';

const { employees, departments, branches, designations, grades, costCenters, employeeJobHistory } =
  schema;

type Db = TenantDb | Tx;
export type EmployeeRow = typeof employees.$inferSelect;

const fullName = (e: { firstName: string; lastName: string; preferredName?: string | null }) =>
  `${e.firstName} ${e.lastName}`;

export function listFilters(
  q: z.output<typeof employeeListQuerySchema>,
  scope: Scope,
  actorEmployeeId: string | null,
): SQL {
  const where: SQL[] = [
    isNull(employees.archivedAt),
    scopeCondition(scope, actorEmployeeId, employees.id),
  ];
  if (q.status === 'current') where.push(inArray(employees.status, CURRENT_STATUSES));
  else if (q.status !== 'all') where.push(eq(employees.status, q.status));
  if (q.departmentId) where.push(eq(employees.departmentId, q.departmentId));
  if (q.branchId) where.push(eq(employees.branchId, q.branchId));
  if (q.employmentType) where.push(eq(employees.employmentType, q.employmentType));
  if (q.q) {
    const term = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      or(
        ilike(employees.employeeNo, term),
        ilike(employees.firstName, term),
        ilike(employees.lastName, term),
        ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`, term),
        ilike(employees.workEmail, term),
      )!,
    );
  }
  return and(...where)!;
}

export async function listEmployees(
  db: Db,
  q: z.output<typeof employeeListQuerySchema>,
  where: SQL,
): Promise<{ items: EmployeeListItem[]; total: number }> {
  const sortCol = {
    employeeNo: employees.employeeNo,
    name: sql`lower(${employees.firstName} || ' ' || ${employees.lastName})`,
    joinDate: employees.joinDate,
    department: departments.name,
  }[q.sort];
  const order = q.dir === 'desc' ? desc(sortCol) : asc(sortCol);

  const rows = await db
    .select({
      e: employees,
      department: departments.name,
      branch: branches.name,
      designation: designations.title,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(where)
    .orderBy(order, asc(employees.employeeNo))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(where);

  return {
    total: n,
    items: rows.map(({ e, department, branch, designation }) => ({
      id: e.id,
      employeeNo: e.employeeNo,
      name: fullName(e),
      designation: designation ?? null,
      department: department ?? null,
      branch: branch ?? null,
      status: e.status,
      employmentType: e.employmentType,
      joinDate: e.joinDate,
      workEmail: e.workEmail,
    })),
  };
}

const manager = aliasedTable(employees, 'manager');

async function refs(
  db: Db,
  ids: {
    branchId: string | null;
    departmentId: string | null;
    designationId: string | null;
    gradeId: string | null;
    costCenterId: string | null;
    reportsToId: string | null;
  },
) {
  const one = async <T>(p: Promise<T[]>) => (await p)[0] ?? null;
  const [branch, department, designation, grade, costCenter, reportsTo] = await Promise.all([
    ids.branchId
      ? one(
          db
            .select({ id: branches.id, name: branches.name })
            .from(branches)
            .where(eq(branches.id, ids.branchId)),
        )
      : null,
    ids.departmentId
      ? one(
          db
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(eq(departments.id, ids.departmentId)),
        )
      : null,
    ids.designationId
      ? one(
          db
            .select({ id: designations.id, name: designations.title })
            .from(designations)
            .where(eq(designations.id, ids.designationId)),
        )
      : null,
    ids.gradeId
      ? one(
          db
            .select({ id: grades.id, name: grades.name })
            .from(grades)
            .where(eq(grades.id, ids.gradeId)),
        )
      : null,
    ids.costCenterId
      ? one(
          db
            .select({ id: costCenters.id, name: costCenters.name })
            .from(costCenters)
            .where(eq(costCenters.id, ids.costCenterId)),
        )
      : null,
    ids.reportsToId
      ? one(
          db
            .select({
              id: manager.id,
              name: sql<string>`${manager.firstName} || ' ' || ${manager.lastName}`,
            })
            .from(manager)
            .where(eq(manager.id, ids.reportsToId)),
        )
      : null,
  ]);
  return { branch, department, designation, grade, costCenter, reportsTo };
}

export async function getEmployee(db: Db, id: string, where?: SQL): Promise<EmployeeRow | null> {
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), where));
  return row ?? null;
}

export async function toDetail(
  db: Db,
  e: EmployeeRow,
  access: 'full' | 'work',
): Promise<EmployeeDetail> {
  const r = await refs(db, e);
  return {
    access,
    id: e.id,
    employeeNo: e.employeeNo,
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName,
    workEmail: e.workEmail,
    status: e.status,
    employmentType: e.employmentType,
    joinDate: e.joinDate,
    probationEndDate: e.probationEndDate,
    confirmationDate: e.confirmationDate,
    contractEndDate: e.contractEndDate,
    exitDate: e.exitDate,
    exitReason: access === 'full' ? e.exitReason : null,
    ...r,
    hasPhoto: !!e.photoPath,
    personal:
      access === 'full'
        ? {
            nameWithInitials: e.nameWithInitials,
            nic: e.nic,
            passportNo: e.passportNo,
            dob: e.dob,
            gender: e.gender,
            maritalStatus: e.maritalStatus,
            nationality: e.nationality,
            religion: e.religion,
            personalEmail: e.personalEmail,
            mobile: e.mobile,
            address: e.address ?? {},
          }
        : null,
    bank:
      access === 'full'
        ? {
            bankName: e.bankName,
            bankBranch: e.bankBranch,
            bankAccountNo: e.bankAccountNo,
            bankAccountName: e.bankAccountName,
            epfNo: e.epfNo,
            etfNo: e.etfNo,
            taxFileNo: e.taxFileNo,
          }
        : null,
  };
}

export async function jobHistory(db: Db, employeeId: string): Promise<JobHistoryItem[]> {
  const rows = await db
    .select()
    .from(employeeJobHistory)
    .where(eq(employeeJobHistory.employeeId, employeeId))
    .orderBy(desc(employeeJobHistory.effectiveFrom));
  return Promise.all(
    rows.map(async (h) => ({
      id: h.id,
      effectiveFrom: h.effectiveFrom,
      effectiveTo: h.effectiveTo,
      reason: h.reason,
      notes: h.notes,
      employmentType: h.employmentType,
      ...(await refs(db, h)),
    })),
  );
}

/** True if `candidateManagerId` is the employee or anywhere below them (would create a loop). */
export async function wouldCreateReportingLoop(
  db: Db,
  employeeId: string,
  candidateManagerId: string,
): Promise<boolean> {
  if (employeeId === candidateManagerId) return true;
  const [row] = await db.execute<{ found: boolean }>(sql`
    with recursive sub(id, depth) as (
      select id, 0 from employees where id = ${employeeId}
      union
      select e.id, s.depth + 1 from employees e join sub s on e.reports_to_id = s.id where s.depth < 50
    )
    select exists(select 1 from sub where id = ${candidateManagerId}) as found`);
  return !!row?.found;
}
