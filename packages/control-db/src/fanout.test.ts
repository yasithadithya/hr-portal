import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect, loadMigrations, migrate, type MigrationFile } from '@hr/db';
import { createTestDatabase, dropTestDatabase } from '@hr/db/testing';

import { CONTROL_MIGRATIONS_DIR, controlDb, type ControlDb } from './client';
import { migrateTenants } from './fanout';
import { listTenantMigrations, setTenantStatus, upsertTenantSecrets } from './repo';
import { tenants } from './schema/index';

const key = randomBytes(32);
const DBS = ['hr_test_fanout_control', 'hr_test_fanout_a', 'hr_test_fanout_b', 'hr_test_fanout_c'];
let control: Sql;
let db: ControlDb;
const urls: Record<string, string> = {};

function file(name: string, sqlText: string): MigrationFile {
  return { name, hash: `h-${name}-${sqlText.length}`, statements: [sqlText] };
}

beforeAll(async () => {
  for (const name of DBS) urls[name] = await createTestDatabase(name);
  control = connect(urls.hr_test_fanout_control!, { max: 2 });
  await migrate(control, await loadMigrations(CONTROL_MIGRATIONS_DIR), { table: 'control' });
  db = controlDb(control);
  for (const [slug, dbName, status] of [
    ['a', 'hr_test_fanout_a', 'active'],
    ['b', 'hr_test_fanout_b', 'active'],
    ['c', 'hr_test_fanout_c', 'suspended'],
  ] as const) {
    const [t] = await db.insert(tenants).values({ slug, name: slug, status }).returning();
    await upsertTenantSecrets(db, t!.id, { dbUrl: urls[dbName]! }, key);
  }
});

afterAll(async () => {
  await control.end();
  for (const name of DBS) await dropTestDatabase(name);
});

async function tableExists(dbName: string, table: string) {
  const sql = connect(urls[dbName]!, { max: 1 });
  try {
    const [r] = await sql<{ t: string | null }[]>`select to_regclass(${table}) as t`;
    return !!r?.t;
  } finally {
    await sql.end();
  }
}

describe('tenant migration fan-out', () => {
  const v1 = [file('0000_one', 'create table one (id int)')];
  const v2 = [...v1, file('0001_two', 'create table two (id int)')];

  it('dry-run reports pending per tenant without applying', async () => {
    const res = await migrateTenants({ db, masterKey: key, files: v1, dryRun: true });
    expect(res.map((r) => [r.slug, r.pending])).toEqual([
      ['a', ['0000_one']],
      ['b', ['0000_one']],
    ]);
    expect(await tableExists('hr_test_fanout_a', 'one')).toBe(false);
  });

  it('a new migration reaches every active tenant with one call; suspended tenants are skipped', async () => {
    await migrateTenants({ db, masterKey: key, files: v1 });
    const res = await migrateTenants({ db, masterKey: key, files: v2, concurrency: 2 });
    expect(res.map((r) => [r.slug, r.status, r.applied])).toEqual([
      ['a', 'ok', ['0001_two']],
      ['b', 'ok', ['0001_two']],
    ]);
    expect(await tableExists('hr_test_fanout_a', 'two')).toBe(true);
    expect(await tableExists('hr_test_fanout_b', 'two')).toBe(true);
    expect(await tableExists('hr_test_fanout_c', 'one')).toBe(false);
  });

  it('records failures and stops at the first failing tenant by default', async () => {
    const [b] = await db.select().from(tenants).where(eq(tenants.slug, 'b'));
    // Make tenant "a" fail by pre-creating the table its next migration creates.
    const a = connect(urls.hr_test_fanout_a!, { max: 1 });
    await a`create table three (id int)`;
    await a.end();

    const v3 = [...v2, file('0002_three', 'create table three (id int)')];
    const res = await migrateTenants({ db, masterKey: key, files: v3 });
    expect(res.map((r) => [r.slug, r.status])).toEqual([
      ['a', 'failed'],
      ['b', 'skipped'],
    ]);

    const continued = await migrateTenants({
      db,
      masterKey: key,
      files: v3,
      continueOnError: true,
    });
    expect(continued.find((r) => r.slug === 'b')?.applied).toEqual(['0002_three']);

    const rows = await listTenantMigrations(db, b!.id);
    expect(rows.map((r) => [r.migrationName, r.status])).toEqual([
      ['0000_one', 'applied'],
      ['0001_two', 'applied'],
      ['0002_three', 'applied'],
    ]);
  });

  it('targets one tenant with --tenant, regardless of status', async () => {
    const [c] = await db.select().from(tenants).where(eq(tenants.slug, 'c'));
    await setTenantStatus(db, c!.id, 'suspended');
    const res = await migrateTenants({ db, masterKey: key, files: v1, slug: 'c' });
    expect(res).toMatchObject([{ slug: 'c', status: 'ok', applied: ['0000_one'] }]);
  });
});
