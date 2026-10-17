import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import {
  addTenantDomain,
  completedProvisioningSteps,
  ensureDefaultPlan,
  findTenantBySlug,
  getTenantConnection,
  recordProvisioningEvent,
  schema,
  setTenantStatus,
  upsertTenantSecrets,
  type ControlDb,
  type Tenant,
} from '@hr/control-db';
import {
  connect,
  loadMigrations,
  migrate,
  runSeeds,
  TENANT_MIGRATIONS_DIR,
  tenantDb,
} from '@hr/db';

import { log, main, masterKey, openControl, optionalEnv, requireEnv } from './lib';

/**
 * pnpm tenant:create --slug acme --name "Acme (Pvt) Ltd" --admin-email hr@acme.lk
 *   [--existing-project <ref>] [--region ap-southeast-1] [--domain extra.host]... [--resume]
 *
 * Turns a client into a working, migrated, seeded portal (PLAN.md Phase 1). Every step is
 * idempotent and logged to platform.provisioning_events; --resume skips completed steps.
 *
 * With --existing-project, the Supabase project was created in the dashboard and its
 * credentials are read from env: TENANT_DB_URL (transaction pooler, :6543),
 * TENANT_DB_DIRECT_URL (session pooler, :5432), TENANT_SUPABASE_URL, TENANT_ANON_KEY,
 * TENANT_SERVICE_ROLE_KEY. Automatic creation via the Management API comes later.
 */

const BUCKETS = ['employee-documents', 'employee-photos', 'payslips', 'imports'] as const;

interface Ctx {
  db: ControlDb;
  key: Buffer;
  tenant: Tenant;
  args: Args;
}

interface Args {
  slug: string;
  name: string;
  adminEmail: string;
  existingProject?: string | undefined;
  region: string;
  domains: string[];
  resume: boolean;
}

type Step = {
  key: string;
  run: (ctx: Ctx) => Promise<{ status: 'succeeded' | 'skipped'; payload?: unknown }>;
};

const steps: Step[] = [
  {
    key: 'create-project',
    run: async ({ args }) => {
      if (args.existingProject) {
        return {
          status: 'skipped',
          payload: { reason: 'existing project', ref: args.existingProject },
        };
      }
      throw new Error(
        'Automatic Supabase project creation is not built yet. Create the project in the ' +
          'dashboard (region ap-southeast-1) and pass --existing-project <ref>.',
      );
    },
  },
  {
    key: 'secrets',
    run: async ({ db, key, tenant }) => {
      await upsertTenantSecrets(
        db,
        tenant.id,
        {
          dbUrl: requireEnv('TENANT_DB_URL'),
          dbDirectUrl: optionalEnv('TENANT_DB_DIRECT_URL'),
          supabaseUrl: optionalEnv('TENANT_SUPABASE_URL'),
          anonKey: optionalEnv('TENANT_ANON_KEY'),
          serviceRoleKey: optionalEnv('TENANT_SERVICE_ROLE_KEY'),
        },
        key,
      );
      return { status: 'succeeded' };
    },
  },
  {
    key: 'domains',
    run: async ({ db, tenant, args }) => {
      const base = optionalEnv('PLATFORM_BASE_DOMAIN') ?? 'hrportal.lk';
      const hosts = [`${args.slug}.${base}`, `${args.slug}.localhost`, ...args.domains];
      for (const [i, host] of hosts.entries()) await addTenantDomain(db, tenant.id, host, i === 0);
      return { status: 'succeeded', payload: { hosts } };
    },
  },
  {
    key: 'auth-config',
    run: async ({ args }) => {
      // Needs the Management API (SUPABASE_ACCESS_TOKEN). Until then, a manual checklist.
      log(`  ! Configure Auth in the Supabase dashboard for this project:
      - Site URL: https://${args.slug}.${optionalEnv('PLATFORM_BASE_DOMAIN') ?? 'hrportal.lk'}
      - Redirect URLs: the same host + /auth/callback
      - Disable "Allow new users to sign up" (users are invited by HR)
      - SMTP: shared sender; invite/reset templates mention the company name`);
      return { status: 'skipped', payload: { reason: 'manual (no Management API token)' } };
    },
  },
  {
    key: 'storage-buckets',
    run: async ({ db, key, tenant }) => {
      const conn = await getTenantConnection(db, tenant, key);
      if (!conn.supabaseUrl || !conn.serviceRoleKey) {
        return { status: 'skipped', payload: { reason: 'no Supabase URL / service-role key' } };
      }
      const supabase = createClient(conn.supabaseUrl, conn.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: existing, error } = await supabase.storage.listBuckets();
      if (error) throw error;
      const have = new Set(existing.map((b) => b.name));
      const created: string[] = [];
      for (const name of BUCKETS) {
        if (have.has(name)) continue;
        const res = await supabase.storage.createBucket(name, { public: false });
        if (res.error) throw res.error;
        created.push(name);
      }
      return { status: 'succeeded', payload: { created } };
    },
  },
  {
    key: 'migrate',
    run: async ({ db, key, tenant }) => {
      const conn = await getTenantConnection(db, tenant, key);
      const sql = connect(conn.dbDirectUrl, { max: 1 });
      try {
        const res = await migrate(sql, await loadMigrations(TENANT_MIGRATIONS_DIR), {
          table: 'tenant',
          log: (m) => log(`  ${m}`),
        });
        return { status: 'succeeded', payload: res };
      } finally {
        await sql.end();
      }
    },
  },
  {
    key: 'seed',
    run: async ({ db, key, tenant }) => {
      const conn = await getTenantConnection(db, tenant, key);
      const sql = connect(conn.dbDirectUrl, { max: 1 });
      try {
        await runSeeds(tenantDb(sql), (m) => log(`  ${m}`));
        return { status: 'succeeded' };
      } finally {
        await sql.end();
      }
    },
  },
  {
    key: 'invite-owner',
    run: async ({ db, key, tenant, args }) => {
      const conn = await getTenantConnection(db, tenant, key);
      if (!conn.supabaseUrl || !conn.serviceRoleKey) {
        return { status: 'skipped', payload: { reason: 'no Supabase URL / service-role key' } };
      }
      const sql = connect(conn.dbDirectUrl, { max: 1 });
      try {
        const email = args.adminEmail.toLowerCase();
        const [existing] = await sql`select id from app_users where email = ${email}`;
        if (existing) return { status: 'skipped', payload: { reason: 'owner already exists' } };

        const supabase = createClient(conn.supabaseUrl, conn.serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const host = `${args.slug}.${optionalEnv('PLATFORM_BASE_DOMAIN') ?? 'hrportal.lk'}`;
        const redirectTo = optionalEnv('INVITE_REDIRECT_BASE')
          ? `${optionalEnv('INVITE_REDIRECT_BASE')}/auth/accept`
          : `https://${host}/auth/accept`;
        const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
        if (error || !data.user) throw new Error(`Invite failed: ${error?.message ?? 'unknown'}`);

        await sql.begin(async (tx) => {
          const [u] = await tx`
            insert into app_users (email, auth_user_id, status, invited_at)
            values (${email}, ${data.user.id}, 'invited', now()) returning id`;
          await tx`
            insert into user_roles (user_id, role_id) select ${u!.id}, id from roles where key = 'owner'`;
          await tx`
            insert into audit_log (action, entity, entity_id, after)
            values ('invite', 'app_users', ${u!.id}, ${tx.json({ email, role: 'owner', via: 'provisioning' })})`;
        });
        return { status: 'succeeded', payload: { email, redirectTo } };
      } finally {
        await sql.end();
      }
    },
  },
  {
    key: 'activate',
    run: async ({ db, tenant }) => {
      await setTenantStatus(db, tenant.id, 'active');
      return { status: 'succeeded' };
    },
  },
];

function parse(): Args {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      'admin-email': { type: 'string' },
      'existing-project': { type: 'string' },
      region: { type: 'string', default: 'ap-southeast-1' },
      domain: { type: 'string', multiple: true, default: [] },
      resume: { type: 'boolean', default: false },
    },
  });
  if (!values.slug || !/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(values.slug)) {
    throw new Error('--slug is required: lowercase letters, digits and hyphens');
  }
  if (!values.name) throw new Error('--name is required');
  if (!values['admin-email']?.includes('@')) throw new Error('--admin-email is required');
  return {
    slug: values.slug,
    name: values.name,
    adminEmail: values['admin-email'],
    existingProject: values['existing-project'],
    region: values.region,
    domains: values.domain,
    resume: values.resume,
  };
}

await main(async () => {
  const args = parse();
  const key = masterKey();
  const { sql, db } = openControl();
  try {
    const existing = await findTenantBySlug(db, args.slug);
    if (existing && !args.resume) {
      throw new Error(
        `Tenant "${args.slug}" already exists. Use --resume to continue provisioning.`,
      );
    }
    let tenant: Tenant;
    if (existing) {
      tenant = existing;
    } else {
      const plan = await ensureDefaultPlan(db);
      const [created] = await db
        .insert(schema.tenants)
        .values({
          slug: args.slug,
          name: args.name,
          planId: plan.id,
          supabaseProjectRef: args.existingProject ?? null,
          region: args.region,
        })
        .returning();
      tenant = created!;
      await recordProvisioningEvent(db, tenant.id, 'register', 'succeeded', {
        adminEmail: args.adminEmail,
      });
    }
    const done = await completedProvisioningSteps(db, tenant.id);
    log(`Provisioning ${args.slug} (${args.name})`);

    for (const step of steps) {
      if (done.has(step.key)) {
        log(`· ${step.key} (already done)`);
        continue;
      }
      await recordProvisioningEvent(db, tenant.id, step.key, 'started');
      try {
        const res = await step.run({ db, key, tenant, args });
        await recordProvisioningEvent(db, tenant.id, step.key, res.status, res.payload);
        log(
          `${res.status === 'skipped' ? '…' : '✔'} ${step.key}${res.status === 'skipped' ? ' (skipped)' : ''}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordProvisioningEvent(db, tenant.id, step.key, 'failed', { error: message });
        throw new Error(
          `Step "${step.key}" failed: ${message}\nFix the cause and re-run with --resume.`,
          { cause: err },
        );
      }
    }
    log(`\n✔ ${args.slug} is active.`);
  } finally {
    await sql.end();
  }
});
