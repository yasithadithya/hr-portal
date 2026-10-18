import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Control-plane tables live in the `platform` schema (PLAN.md Phase 1). */
export const platform = pgSchema('platform');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const TENANT_STATUSES = ['provisioning', 'active', 'suspended', 'archived'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const plans = platform
  .table('plans', {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    maxEmployees: integer('max_employees'),
    features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
    /** Billing v1 (manual): monthly price per active employee; null until pricing is decided. */
    pricePerEmployee: numeric('price_per_employee', { precision: 10, scale: 2 }),
    minimumMonthly: numeric('minimum_monthly', { precision: 10, scale: 2 }),
    currency: text('currency').notNull().default('LKR'),
    createdAt: createdAt(),
  })
  .enableRLS();

export const tenants = platform
  .table(
    'tenants',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      slug: text('slug').notNull().unique(),
      name: text('name').notNull(),
      status: text('status', { enum: TENANT_STATUSES }).notNull().default('provisioning'),
      planId: uuid('plan_id').references(() => plans.id),
      supabaseProjectRef: text('supabase_project_ref'),
      region: text('region'),
      timezone: text('timezone').notNull().default('Asia/Colombo'),
      createdAt: createdAt(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check(
        'tenants_status_check',
        sql`${t.status} in ('provisioning','active','suspended','archived')`,
      ),
      check('tenants_slug_check', sql`${t.slug} ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'`),
    ],
  )
  .enableRLS();

export const tenantDomains = platform
  .table(
    'tenant_domains',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      host: text('host').notNull().unique(),
      isPrimary: boolean('is_primary').notNull().default(false),
      createdAt: createdAt(),
    },
    (t) => [
      index('tenant_domains_tenant_idx').on(t.tenantId),
      check('tenant_domains_host_lower', sql`${t.host} = lower(${t.host})`),
    ],
  )
  .enableRLS();

/** Encrypted with AES-256-GCM using MASTER_KEY from env (never stored in the DB). */
export const tenantSecrets = platform
  .table('tenant_secrets', {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Runtime URL: transaction pooler (port 6543). */
    dbUrlEnc: text('db_url_enc').notNull(),
    /** Migration URL: session pooler / direct (port 5432). Falls back to db_url when null. */
    dbDirectUrlEnc: text('db_direct_url_enc'),
    serviceRoleKeyEnc: text('service_role_key_enc'),
    /** Web push (VAPID) key pair for this tenant; private key encrypted like the others. */
    vapidPublicKey: text('vapid_public_key'),
    vapidPrivateKeyEnc: text('vapid_private_key_enc'),
    anonKey: text('anon_key'),
    supabaseUrl: text('supabase_url'),
    jwksUrl: text('jwks_url'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    createdAt: createdAt(),
  })
  .enableRLS();

export const tenantMigrations = platform
  .table(
    'tenant_migrations',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      migrationName: text('migration_name').notNull(),
      status: text('status', { enum: ['applied', 'failed'] }).notNull(),
      error: text('error'),
      appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique('tenant_migrations_tenant_name').on(t.tenantId, t.migrationName)],
  )
  .enableRLS();

export const platformAdmins = platform
  .table('platform_admins', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    createdAt: createdAt(),
  })
  .enableRLS();

export const PROVISIONING_STATUSES = ['started', 'succeeded', 'failed', 'skipped'] as const;

export const provisioningEvents = platform
  .table(
    'provisioning_events',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      step: text('step').notNull(),
      status: text('status', { enum: PROVISIONING_STATUSES }).notNull(),
      payload: jsonb('payload'),
      at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('provisioning_events_tenant_idx').on(t.tenantId, t.at)],
  )
  .enableRLS();

/** One row per tenant per month: the employee count billed (manual invoicing, Phase 10). */
export const billingSnapshots = platform
  .table(
    'billing_snapshots',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      month: text('month').notNull(),
      activeEmployees: integer('active_employees').notNull(),
      planKey: text('plan_key'),
      pricePerEmployee: numeric('price_per_employee', { precision: 10, scale: 2 }),
      minimumMonthly: numeric('minimum_monthly', { precision: 10, scale: 2 }),
      amount: numeric('amount', { precision: 14, scale: 2 }),
      currency: text('currency').notNull().default('LKR'),
      createdAt: createdAt(),
    },
    (t) => [uniqueIndex('billing_snapshots_tenant_month').on(t.tenantId, t.month)],
  )
  .enableRLS();
