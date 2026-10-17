import { eq } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect } from '../connection';
import { TENANT_MIGRATIONS_DIR, tenantDb, type TenantDb } from '../index';
import { loadMigrations, migrate } from '../migrator';
import { auditLog, appUsers, employees, roles, userRoles } from '../schema/index';
import { runSeeds } from '../seeds/index';
import { createTestDatabase, dropTestDatabase } from '../testing';

import { withAudit } from './audit';
import { scopeCondition } from './scope';
import { nextSequenceValue } from './sequences';
import { loadPermissions } from './users';

describe('number sequences', () => {
  it('hands out unique, gap-free numbers under concurrency; rollback does not burn a number', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => db.transaction((tx) => nextSequenceValue(tx, 'employee'))),
    );
    expect(new Set(results).size).toBe(20);
    expect([...results].sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `EMP-${String(i + 1).padStart(4, '0')}`),
    );

    await expect(
      db.transaction(async (tx) => {
        await nextSequenceValue(tx, 'employee');
        throw new Error('hire failed');
      }),
    ).rejects.toThrow('hire failed');
    expect(await db.transaction((tx) => nextSequenceValue(tx, 'employee'))).toBe('EMP-0021');
  });

  it('fails clearly for unknown sequences', async () => {
    await expect(db.transaction((tx) => nextSequenceValue(tx, 'nope'))).rejects.toThrow(
      /not configured/,
    );
  });
});

const DB = 'hr_test_access';
let sql: Sql;
let db: TenantDb;

beforeAll(async () => {
  sql = connect(await createTestDatabase(DB), { max: 3 });
  await migrate(sql, await loadMigrations(TENANT_MIGRATIONS_DIR), { table: 'tenant' });
  db = tenantDb(sql);
  await runSeeds(db);
});

afterAll(async () => {
  await sql.end();
  await dropTestDatabase(DB);
});

async function emp(no: string, reportsToId: string | null = null) {
  const [e] = await db
    .insert(employees)
    .values({ joinDate: '2020-01-01', employeeNo: no, firstName: no, lastName: 'X', reportsToId })
    .returning();
  return e!;
}

describe('audit log', () => {
  it('writes the change and its audit row atomically', async () => {
    const created = await withAudit(
      db,
      { userId: null, ip: '1.2.3.4' },
      'employees',
      async (tx) => {
        const [e] = await tx
          .insert(employees)
          .values({ joinDate: '2020-01-01', employeeNo: 'A-1', firstName: 'A', lastName: 'B' })
          .returning();
        return { action: 'create', entityId: e!.id, after: { ...e, password: 'x' }, result: e! };
      },
    );
    const [row] = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id));
    expect(row).toMatchObject({ action: 'create', entity: 'employees', ip: '1.2.3.4' });
    expect((row!.after as Record<string, unknown>).password).toBe('[redacted]');
  });

  it('rolls back both when the write fails', async () => {
    const before = (await db.select().from(auditLog)).length;
    await expect(
      withAudit(db, { userId: null }, 'employees', async (tx) => {
        await tx
          .insert(employees)
          .values({ joinDate: '2020-01-01', employeeNo: 'A-2', firstName: 'A', lastName: 'B' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await db.select().from(auditLog)).length).toBe(before);
    expect(await db.select().from(employees).where(eq(employees.employeeNo, 'A-2'))).toEqual([]);
  });

  it('is append-only: update, delete and truncate are rejected', async () => {
    await expect(sql`update audit_log set action = 'tampered'`).rejects.toThrow(/append-only/);
    await expect(sql`delete from audit_log`).rejects.toThrow(/append-only/);
    await expect(sql`truncate audit_log`).rejects.toThrow(/append-only/);
  });
});

describe('scope', () => {
  it('team = the manager plus the whole reports_to subtree, nothing else', async () => {
    const ceo = await emp('S-CEO');
    const mgr = await emp('S-MGR', ceo.id);
    const lead = await emp('S-LEAD', mgr.id);
    const dev = await emp('S-DEV', lead.id);
    const other = await emp('S-OTHER', ceo.id);

    const team = await db
      .select({ no: employees.employeeNo })
      .from(employees)
      .where(scopeCondition('team', mgr.id, employees.id));
    expect(team.map((r) => r.no).sort()).toEqual(['S-DEV', 'S-LEAD', 'S-MGR']);
    expect(team.map((r) => r.no)).not.toContain(other.employeeNo);

    const self = await db
      .select()
      .from(employees)
      .where(scopeCondition('self', dev.id, employees.id));
    expect(self.map((r) => r.employeeNo)).toEqual(['S-DEV']);

    expect(
      await db
        .select()
        .from(employees)
        .where(scopeCondition('team', null, employees.id)),
    ).toEqual([]);
  });
});

describe('rbac seed + permission loading', () => {
  it('seed is idempotent', async () => {
    await runSeeds(db);
    const rows = await db.select().from(roles);
    expect(rows.map((r) => r.key).sort()).toEqual([
      'employee',
      'hr_admin',
      'manager',
      'owner',
      'payroll_admin',
    ]);
  });

  it('multiple roles combine with the widest scope', async () => {
    const [u] = await db
      .insert(appUsers)
      .values({ email: 'multi@x.lk', status: 'active' })
      .returning();
    const all = await db.select().from(roles);
    const id = (k: string) => all.find((r) => r.key === k)!.id;
    await db.insert(userRoles).values([
      { userId: u!.id, roleId: id('employee') },
      { userId: u!.id, roleId: id('manager') },
    ]);
    const perms = await loadPermissions(db, u!.id);
    expect(perms['leave.read']).toBe('team');
    expect(perms['leave.apply']).toBe('self');
    expect(perms['payroll.run']).toBeUndefined();
  });
});
