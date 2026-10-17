import { asc, eq } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect } from '../connection';
import { TENANT_MIGRATIONS_DIR, tenantDb, type TenantDb } from '../index';
import { loadMigrations, migrate } from '../migrator';
import { departments, employeeJobHistory, employees } from '../schema/index';
import { createTestDatabase, dropTestDatabase } from '../testing';

import {
  applyJobChange,
  jobAsOf,
  JobHistoryError,
  refreshJobProjections,
  type JobValues,
} from './jobHistory';

const DB = 'hr_test_job_history';
let sql: Sql;
let db: TenantDb;
let empId: string;
const dept: Record<string, string> = {};

const base: JobValues = {
  branchId: null,
  departmentId: null,
  designationId: null,
  gradeId: null,
  costCenterId: null,
  reportsToId: null,
  employmentType: 'permanent',
};

beforeAll(async () => {
  sql = connect(await createTestDatabase(DB), { max: 3 });
  await migrate(sql, await loadMigrations(TENANT_MIGRATIONS_DIR), { table: 'tenant' });
  db = tenantDb(sql);
  for (const code of ['SALES', 'OPS', 'FIN', 'HR']) {
    const [d] = await db.insert(departments).values({ code, name: code }).returning();
    dept[code] = d!.id;
  }
  const [e] = await db
    .insert(employees)
    .values({ employeeNo: 'E1', firstName: 'Nimal', lastName: 'Perera', joinDate: '2024-01-15' })
    .returning();
  empId = e!.id;
  await db.transaction((tx) =>
    applyJobChange(tx, {
      employeeId: empId,
      effectiveFrom: '2024-01-15',
      values: { ...base, departmentId: dept.SALES! },
      reason: 'hire',
      actorId: null,
      today: '2026-10-18',
    }),
  );
});

afterAll(async () => {
  await sql.end();
  await dropTestDatabase(DB);
});

async function deptOn(date: string) {
  const row = await jobAsOf(db, empId, date);
  return Object.entries(dept).find(([, id]) => id === row?.departmentId)?.[0] ?? null;
}

async function timeline() {
  const rows = await db
    .select()
    .from(employeeJobHistory)
    .where(eq(employeeJobHistory.employeeId, empId))
    .orderBy(asc(employeeJobHistory.effectiveFrom));
  return rows.map((r) => [r.effectiveFrom, r.effectiveTo]);
}

describe('effective-dated job history', () => {
  it('answers "what was the department on date X" across transfers', async () => {
    await db.transaction((tx) =>
      applyJobChange(tx, {
        employeeId: empId,
        effectiveFrom: '2025-07-01',
        values: { ...base, departmentId: dept.OPS! },
        reason: 'transfer',
        actorId: null,
        today: '2026-10-18',
      }),
    );
    expect(await deptOn('2024-01-14')).toBeNull(); // before joining
    expect(await deptOn('2024-01-15')).toBe('SALES');
    expect(await deptOn('2025-06-30')).toBe('SALES');
    expect(await deptOn('2025-07-01')).toBe('OPS');
    expect(await deptOn('2026-10-18')).toBe('OPS');
    expect(await timeline()).toEqual([
      ['2024-01-15', '2025-06-30'],
      ['2025-07-01', null],
    ]);
  });

  it('inserts a backdated change between existing records without gaps or overlaps', async () => {
    await db.transaction((tx) =>
      applyJobChange(tx, {
        employeeId: empId,
        effectiveFrom: '2024-09-01',
        values: { ...base, departmentId: dept.FIN! },
        reason: 'transfer',
        actorId: null,
        today: '2026-10-18',
      }),
    );
    expect(await timeline()).toEqual([
      ['2024-01-15', '2024-08-31'],
      ['2024-09-01', '2025-06-30'],
      ['2025-07-01', null],
    ]);
    expect(await deptOn('2024-12-25')).toBe('FIN');
    // The current projection is untouched by a past change.
    const [e] = await db.select().from(employees).where(eq(employees.id, empId));
    expect(e!.departmentId).toBe(dept.OPS);
  });

  it('a change on an existing start date corrects that record', async () => {
    await db.transaction((tx) =>
      applyJobChange(tx, {
        employeeId: empId,
        effectiveFrom: '2024-09-01',
        values: { ...base, departmentId: dept.HR! },
        reason: 'correction',
        actorId: null,
        today: '2026-10-18',
      }),
    );
    expect((await timeline()).length).toBe(3);
    expect(await deptOn('2024-12-25')).toBe('HR');
  });

  it('future-dated changes apply to the projection only from their start date', async () => {
    await db.transaction((tx) =>
      applyJobChange(tx, {
        employeeId: empId,
        effectiveFrom: '2026-11-01',
        values: { ...base, departmentId: dept.FIN!, employmentType: 'contract' },
        reason: 'transfer',
        actorId: null,
        today: '2026-10-18',
      }),
    );
    let [e] = await db.select().from(employees).where(eq(employees.id, empId));
    expect(e!.departmentId).toBe(dept.OPS);

    expect(await refreshJobProjections(db, '2026-10-31')).toBe(0);
    expect(await refreshJobProjections(db, '2026-11-01')).toBe(1);
    [e] = await db.select().from(employees).where(eq(employees.id, empId));
    expect(e).toMatchObject({ departmentId: dept.FIN, employmentType: 'contract' });
  });

  it('rejects changes before the join date', async () => {
    await expect(
      db.transaction((tx) =>
        applyJobChange(tx, {
          employeeId: empId,
          effectiveFrom: '2023-12-31',
          values: base,
          reason: 'correction',
          actorId: null,
          today: '2026-10-18',
        }),
      ),
    ).rejects.toThrow(JobHistoryError);
  });
});
