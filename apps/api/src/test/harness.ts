import { randomBytes, randomUUID } from 'node:crypto';

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
import {
  connect,
  loadMigrations,
  migrate,
  runSeeds,
  TENANT_MIGRATIONS_DIR,
  tenantDb,
} from '@hr/db';
import { createTestDatabase, dropTestDatabase } from '@hr/db/testing';

import { createApp, type AppOptions } from '../app';
import { loadEnv } from '../env';
import { createJobHandlers } from '../jobs/handlers';
import { InlineQueue } from '../jobs/queue';
import { memorySender } from '../lib/email';
import { localJwks } from '../lib/jwt';
import { memoryPush } from '../lib/push';
import { memoryStorage } from '../lib/storage';
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
    // Separate client: drizzle swaps postgres.js serializers, which breaks raw `sql.json` use.
    const seedSql = connect(dbUrl, { max: 1 });
    await runSeeds(tenantDb(seedSql), {
      tenantName: `Tenant ${slug.toUpperCase()}`,
      timezone: 'Asia/Colombo',
    });
    await seedSql.end();
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

  /** Fake Supabase Auth admin: records invites, returns a fresh auth user id. */
  const invites: { email: string; redirectTo: string; authUserId: string }[] = [];
  const authAdmin = () => ({
    inviteUser: async (email: string, redirectTo: string) => {
      const authUserId = randomUUID();
      invites.push({ email, redirectTo, authUserId });
      return { authUserId };
    },
  });

  const storage = memoryStorage();

  const pools = new PoolManager({ maxPools: 10, connectionsPerPool: 2, idleMs: 60_000 });
  const registry = new TenantRegistry({ control, masterKey, pools });
  const env = loadEnv({ NODE_ENV: 'test', TRUST_PROXY: 'loopback' });
  // Jobs run in-process; tests await `jobs.drain()` and inspect `email.sent` / `push.sent`.
  const email = memorySender();
  const push = memoryPush();
  const jobs = new InlineQueue();
  jobs.register(
    createJobHandlers({
      control,
      pools,
      masterKey,
      email,
      push,
      jobs,
      logger: pino({ level: 'silent' }),
      appBaseUrl: 'http://app.test',
      pushSubject: 'mailto:test@hr.test',
    }),
  );
  const app = createApp({
    env,
    logger: pino({ level: 'silent' }),
    tenancy: {
      control,
      registry,
      pools,
      platformJwksUrl: 'https://platform.supabase.test/auth/v1/.well-known/jwks.json',
      jwks: localJwks(jwks),
      authAdmin,
      storage: () => storage,
      masterKey,
      jobs,
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

  /** Access token as the tenant's own Supabase project would issue it. */
  async function tokenFor(slug: string, authUserId: string, extra: Record<string, unknown> = {}) {
    return sign({
      sub: authUserId,
      iss: `https://${slug}.supabase.test/auth/v1`,
      aal: 'aal1',
      ...extra,
    });
  }

  /** Creates an active app user with the given system/custom role keys; returns ids + token. */
  async function createUser(
    slug: string,
    opts: {
      email: string;
      roles: string[];
      employeeId?: string | null;
      status?: 'active' | 'invited' | 'disabled';
    },
  ) {
    const t = tenants[slug]!;
    const authUserId = randomUUID();
    const [u] = await t.sql`
      insert into app_users (email, auth_user_id, employee_id, status)
      values (${opts.email}, ${authUserId}, ${opts.employeeId ?? null}, ${opts.status ?? 'active'})
      returning id`;
    for (const key of opts.roles) {
      await t.sql`insert into user_roles (user_id, role_id) select ${u!.id}, id from roles where key = ${key}`;
    }
    return { id: u!.id as string, authUserId, token: await tokenFor(slug, authUserId) };
  }

  async function createEmployee(slug: string, no: string, reportsToId: string | null = null) {
    const sql = tenants[slug]!.sql;
    const [e] = await sql`
      insert into employees (employee_no, first_name, last_name, reports_to_id, join_date)
      values (${no}, ${no}, 'Test', ${reportsToId}, '2020-01-01') returning id`;
    await sql`
      insert into employee_job_history (employee_id, effective_from, reports_to_id, employment_type, reason)
      values (${e!.id}, '2020-01-01', ${reportsToId}, 'permanent', 'hire')`;
    return e!.id as string;
  }

  return {
    app,
    control,
    controlSql,
    registry,
    pools,
    tenants,
    masterKey,
    invites,
    storage,
    email,
    push,
    jobs,
    sign,
    tokenFor,
    createUser,
    createEmployee,
    close,
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
