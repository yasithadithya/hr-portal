import { randomBytes } from 'node:crypto';

import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from 'jose';
import { pino } from 'pino';
import type { Sql } from 'postgres';

import {
  addTenantDomain,
  CONTROL_MIGRATIONS_DIR,
  controlDb,
  upsertTenantSecrets,
  type ControlDb,
} from '@hr/control-db';
import { schema as controlSchema } from '@hr/control-db';
import { connect, loadMigrations, migrate, TENANT_MIGRATIONS_DIR } from '@hr/db';
import { createTestDatabase, dropTestDatabase } from '@hr/db/testing';

import { createApp, type AppOptions } from '../app';
import { loadEnv } from '../env';
import { localJwks } from '../lib/jwt';
import { PoolManager } from '../tenancy/pools';
import { TenantRegistry } from '../tenancy/registry';

export interface TestTenant {
  id: string;
  slug: string;
  host: string;
  dbUrl: string;
  sql: Sql;
}

/**
 * Spins up a control-plane DB plus N tenant DBs on the local test Postgres, migrates them and
 * builds an app wired exactly like production (only the JWKS is local).
 */
export async function createHarness(
  prefix: string,
  slugs: string[],
  extra: Partial<AppOptions> = {},
) {
  const masterKey = randomBytes(32);
  const controlName = `hr_test_${prefix}_control`;
  const controlSql = connect(await createTestDatabase(controlName), { max: 3 });
  await migrate(controlSql, await loadMigrations(CONTROL_MIGRATIONS_DIR), { table: 'control' });
  const control: ControlDb = controlDb(controlSql);

  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const jwks: JSONWebKeySet = { keys: [jwk] };

  const tenantFiles = await loadMigrations(TENANT_MIGRATIONS_DIR);
  const tenants: Record<string, TestTenant> = {};
  for (const slug of slugs) {
    const dbName = `hr_test_${prefix}_${slug}`;
    const dbUrl = await createTestDatabase(dbName);
    const sql = connect(dbUrl, { max: 2 });
    await migrate(sql, tenantFiles, { table: 'tenant' });
    const [t] = await control
      .insert(controlSchema.tenants)
      .values({ slug, name: `Tenant ${slug.toUpperCase()}`, status: 'active' })
      .returning();
    await upsertTenantSecrets(
      control,
      t!.id,
      { dbUrl, supabaseUrl: `https://${slug}.supabase.test`, anonKey: `anon-${slug}` },
      masterKey,
    );
    const host = `${slug}.localhost`;
    await addTenantDomain(control, t!.id, host, true);
    tenants[slug] = { id: t!.id, slug, host, dbUrl, sql };
  }

  const pools = new PoolManager({ maxPools: 10, connectionsPerPool: 2, idleMs: 60_000 });
  const registry = new TenantRegistry({ control, masterKey, pools });
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: 'loopback' });
  const app = createApp({
    env,
    logger: pino({ level: 'silent' }),
    tenancy: {
      control,
      registry,
      pools,
      platformJwksUrl: 'https://platform.supabase.test/auth/v1/.well-known/jwks.json',
      jwks: localJwks(jwks),
    },
    ...extra,
  });

  async function sign(claims: Record<string, unknown>, opts: { expiresIn?: string } = {}) {
    return new SignJWT({ aud: 'authenticated', role: 'authenticated', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '5m')
      .sign(privateKey);
  }

  async function close() {
    await pools.closeAll();
    for (const t of Object.values(tenants)) await t.sql.end();
    await controlSql.end();
    for (const slug of slugs) await dropTestDatabase(`hr_test_${prefix}_${slug}`);
    await dropTestDatabase(controlName);
  }

  return { app, control, controlSql, registry, pools, tenants, masterKey, sign, close };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
