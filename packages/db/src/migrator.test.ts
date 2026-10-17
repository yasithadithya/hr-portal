import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect } from './connection';
import { loadMigrations, migrate, MigrationIntegrityError } from './migrator';
import { createTestDatabase, dropTestDatabase } from './testing';

import { TENANT_MIGRATIONS_DIR } from './index';

const DB = 'hr_test_migrator';
let sql: Sql;

async function fixtureDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hr-mig-'));
  await mkdir(path.join(dir, 'meta'));
  const entries = Object.keys(files).map((tag, idx) => ({ idx, tag }));
  await writeFile(path.join(dir, 'meta', '_journal.json'), JSON.stringify({ entries }));
  for (const [tag, content] of Object.entries(files)) {
    await writeFile(path.join(dir, `${tag}.sql`), content);
  }
  return dir;
}

beforeAll(async () => {
  sql = connect(await createTestDatabase(DB), { max: 4 });
});

afterAll(async () => {
  await sql.end();
  await dropTestDatabase(DB);
});

describe('migrator', () => {
  it('applies pending migrations once, in journal order', async () => {
    const dir = await fixtureDir({
      '0000_a': 'create table t (id int);',
      '0001_b':
        'alter table t add column name text;--> statement-breakpoint\ninsert into t values (1, $$x$$);',
    });
    const files = await loadMigrations(dir);

    expect((await migrate(sql, files, { table: 'tenant', dryRun: true })).pending).toEqual([
      '0000_a',
      '0001_b',
    ]);
    expect((await migrate(sql, files, { table: 'tenant' })).applied).toEqual(['0000_a', '0001_b']);
    expect((await migrate(sql, files, { table: 'tenant' })).applied).toEqual([]);
    expect(await sql`select * from t`).toEqual([{ id: 1, name: 'x' }]);
  });

  it('refuses to run when an applied migration was edited', async () => {
    const dir = await fixtureDir({
      '0000_a': 'create table t (id int, extra int);',
      '0001_b': 'select 1;',
    });
    await expect(migrate(sql, await loadMigrations(dir), { table: 'tenant' })).rejects.toThrow(
      MigrationIntegrityError,
    );
  });

  it('rolls back a failing migration and leaves the ledger untouched', async () => {
    const dir = await fixtureDir({
      '0000_ok': 'create table u (id int);',
      '0001_bad': 'insert into u values (1);--> statement-breakpoint\nselect * from missing_table;',
    });
    const files = await loadMigrations(dir);
    await expect(migrate(sql, files, { table: 'control' })).rejects.toThrow();
    expect(await sql`select count(*)::int as n from u`).toEqual([{ n: 0 }]);
    expect(
      (await migrate(sql, files.slice(0, 1), { table: 'control', dryRun: true })).pending,
    ).toEqual([]);
  });

  it('is safe when two runners race', async () => {
    const dir = await fixtureDir({ '0000_race': 'create table race (id int);' });
    const files = await loadMigrations(dir);
    const other = connect(await createTestDatabase('hr_test_migrator_race'), { max: 4 });
    try {
      const results = await Promise.all([
        migrate(other, files, { table: 'tenant' }),
        migrate(other, files, { table: 'tenant' }),
      ]);
      expect(results.flatMap((r) => r.applied)).toEqual(['0000_race']);
    } finally {
      await other.end();
      await dropTestDatabase('hr_test_migrator_race');
    }
  });
});

describe('tenant schema', () => {
  it('enables RLS on every public table (Hard Rule 5)', async () => {
    const tenant = connect(await createTestDatabase('hr_test_tenant_schema'), { max: 2 });
    try {
      await migrate(tenant, await loadMigrations(TENANT_MIGRATIONS_DIR), { table: 'tenant' });
      const tables = await tenant<{ tablename: string; rowsecurity: boolean }[]>`
        select tablename, rowsecurity from pg_tables where schemaname = 'public'`;
      expect(tables.length).toBeGreaterThan(0);
      expect(tables.filter((t) => !t.rowsecurity).map((t) => t.tablename)).toEqual([]);

      const policies = await tenant`select * from pg_policies where schemaname = 'public'`;
      expect(policies).toEqual([]);
    } finally {
      await tenant.end();
      await dropTestDatabase('hr_test_tenant_schema');
    }
  });
});
