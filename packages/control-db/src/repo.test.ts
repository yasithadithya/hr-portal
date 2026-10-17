import { randomBytes } from 'node:crypto';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect, loadMigrations, migrate } from '@hr/db';
import { createTestDatabase, dropTestDatabase } from '@hr/db/testing';

import { CONTROL_MIGRATIONS_DIR, controlDb, type ControlDb } from './client';
import {
  addTenantDomain,
  completedProvisioningSteps,
  findTenantByHost,
  getTenantConnection,
  normaliseHost,
  recordProvisioningEvent,
  upsertTenantSecrets,
} from './repo';
import { tenants } from './schema/index';

const DB = 'hr_test_control_repo';
const key = randomBytes(32);
let sql: Sql;
let db: ControlDb;

beforeAll(async () => {
  sql = connect(await createTestDatabase(DB), { max: 2 });
  await migrate(sql, await loadMigrations(CONTROL_MIGRATIONS_DIR), { table: 'control' });
  db = controlDb(sql);
});

afterAll(async () => {
  await sql.end();
  await dropTestDatabase(DB);
});

describe('control-plane repo', () => {
  it('resolves a tenant by host, ignoring case and port', async () => {
    const [t] = await db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
    await addTenantDomain(db, t!.id, 'Acme.LocalHost', true);

    expect(normaliseHost('ACME.localhost:3000')).toBe('acme.localhost');
    expect((await findTenantByHost(db, 'acme.localhost:3000'))?.slug).toBe('acme');
    expect(await findTenantByHost(db, 'other.localhost')).toBeNull();
  });

  it('stores secrets encrypted and decrypts them', async () => {
    const [t] = await db.insert(tenants).values({ slug: 'beta', name: 'Beta' }).returning();
    await upsertTenantSecrets(
      db,
      t!.id,
      { dbUrl: 'postgres://x:secret-pw@h:6543/db', supabaseUrl: 'https://ref.supabase.co/' },
      key,
    );
    const [raw] =
      await sql`select db_url_enc, jwks_url from platform.tenant_secrets where tenant_id = ${t!.id}`;
    expect(raw!.db_url_enc).not.toContain('secret-pw');
    expect(raw!.jwks_url).toBe('https://ref.supabase.co/auth/v1/.well-known/jwks.json');

    const conn = await getTenantConnection(db, t!, key);
    expect(conn.dbUrl).toBe('postgres://x:secret-pw@h:6543/db');
    expect(conn.dbDirectUrl).toBe(conn.dbUrl);
  });

  it('rejects invalid slugs and statuses at the database level', async () => {
    await expect(db.insert(tenants).values({ slug: 'Bad Slug', name: 'x' })).rejects.toThrow();
    await expect(
      sql`insert into platform.tenants (slug, name, status) values ('ok-slug', 'x', 'bogus')`,
    ).rejects.toThrow();
  });

  it('tracks completed provisioning steps for --resume', async () => {
    const [t] = await db.insert(tenants).values({ slug: 'gamma', name: 'Gamma' }).returning();
    await recordProvisioningEvent(db, t!.id, 'secrets', 'succeeded');
    await recordProvisioningEvent(db, t!.id, 'migrate', 'failed', { error: 'x' });
    await recordProvisioningEvent(db, t!.id, 'auth-config', 'skipped');
    expect([...(await completedProvisioningSteps(db, t!.id))].sort()).toEqual([
      'auth-config',
      'secrets',
    ]);
  });
});
