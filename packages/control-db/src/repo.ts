import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { ControlDb } from './client';
import {
  plans,
  platformAdmins,
  provisioningEvents,
  tenantDomains,
  tenantMigrations,
  tenants,
  tenantSecrets,
  type PROVISIONING_STATUSES,
  type TenantStatus,
} from './schema/index';
import { decryptSecret, encryptSecret } from './secrets';

export type Tenant = typeof tenants.$inferSelect;

export interface TenantConnection {
  tenant: Tenant;
  dbUrl: string;
  dbDirectUrl: string;
  supabaseUrl: string | null;
  anonKey: string | null;
  jwksUrl: string | null;
  serviceRoleKey: string | null;
}

/** Hosts are matched without port, lower-cased. */
export function normaliseHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export async function findTenantByHost(db: ControlDb, host: string): Promise<Tenant | null> {
  const [row] = await db
    .select({ tenant: tenants })
    .from(tenantDomains)
    .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
    .where(eq(tenantDomains.host, normaliseHost(host)))
    .limit(1);
  return row?.tenant ?? null;
}

export async function findTenantBySlug(db: ControlDb, slug: string): Promise<Tenant | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return row ?? null;
}

export async function getTenantConnection(
  db: ControlDb,
  tenant: Tenant,
  masterKey: Buffer,
): Promise<TenantConnection> {
  const [s] = await db.select().from(tenantSecrets).where(eq(tenantSecrets.tenantId, tenant.id));
  if (!s) throw new Error(`Tenant ${tenant.slug} has no secrets`);
  const dbUrl = decryptSecret(s.dbUrlEnc, masterKey);
  return {
    tenant,
    dbUrl,
    dbDirectUrl: s.dbDirectUrlEnc ? decryptSecret(s.dbDirectUrlEnc, masterKey) : dbUrl,
    supabaseUrl: s.supabaseUrl,
    anonKey: s.anonKey,
    jwksUrl: s.jwksUrl,
    serviceRoleKey: s.serviceRoleKeyEnc ? decryptSecret(s.serviceRoleKeyEnc, masterKey) : null,
  };
}

export interface TenantSecretsInput {
  dbUrl: string;
  dbDirectUrl?: string | undefined;
  serviceRoleKey?: string | undefined;
  anonKey?: string | undefined;
  supabaseUrl?: string | undefined;
}

export async function upsertTenantSecrets(
  db: ControlDb,
  tenantId: string,
  input: TenantSecretsInput,
  masterKey: Buffer,
): Promise<void> {
  const values = {
    tenantId,
    dbUrlEnc: encryptSecret(input.dbUrl, masterKey),
    dbDirectUrlEnc: input.dbDirectUrl ? encryptSecret(input.dbDirectUrl, masterKey) : null,
    serviceRoleKeyEnc: input.serviceRoleKey ? encryptSecret(input.serviceRoleKey, masterKey) : null,
    anonKey: input.anonKey ?? null,
    supabaseUrl: input.supabaseUrl ?? null,
    jwksUrl: input.supabaseUrl
      ? `${input.supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
      : null,
  };
  await db
    .insert(tenantSecrets)
    .values(values)
    .onConflictDoUpdate({
      target: tenantSecrets.tenantId,
      set: { ...values, rotatedAt: new Date() },
    });
}

export async function listTenants(db: ControlDb, filter: { status?: TenantStatus } = {}) {
  return db
    .select()
    .from(tenants)
    .where(filter.status ? eq(tenants.status, filter.status) : undefined)
    .orderBy(asc(tenants.slug));
}

export async function setTenantStatus(db: ControlDb, tenantId: string, status: TenantStatus) {
  const [row] = await db
    .update(tenants)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning();
  return row ?? null;
}

export async function listTenantDomains(db: ControlDb, tenantId: string) {
  return db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, tenantId));
}

export async function addTenantDomain(
  db: ControlDb,
  tenantId: string,
  host: string,
  isPrimary = false,
): Promise<void> {
  await db
    .insert(tenantDomains)
    .values({ tenantId, host: normaliseHost(host), isPrimary })
    .onConflictDoNothing({ target: tenantDomains.host });
}

export async function recordProvisioningEvent(
  db: ControlDb,
  tenantId: string,
  step: string,
  status: (typeof PROVISIONING_STATUSES)[number],
  payload?: unknown,
): Promise<void> {
  await db.insert(provisioningEvents).values({ tenantId, step, status, payload: payload ?? null });
}

export async function listProvisioningEvents(db: ControlDb, tenantId: string) {
  return db
    .select()
    .from(provisioningEvents)
    .where(eq(provisioningEvents.tenantId, tenantId))
    .orderBy(asc(provisioningEvents.at));
}

/** Steps whose latest event is `succeeded` or `skipped` (used by `--resume`). */
export async function completedProvisioningSteps(db: ControlDb, tenantId: string) {
  const events = await db
    .select()
    .from(provisioningEvents)
    .where(eq(provisioningEvents.tenantId, tenantId))
    .orderBy(desc(provisioningEvents.at));
  const latest = new Map<string, string>();
  for (const e of events) if (!latest.has(e.step)) latest.set(e.step, e.status);
  return new Set(
    [...latest].filter(([, s]) => s === 'succeeded' || s === 'skipped').map(([k]) => k),
  );
}

export async function recordTenantMigration(
  db: ControlDb,
  tenantId: string,
  migrationName: string,
  status: 'applied' | 'failed',
  error?: string,
): Promise<void> {
  await db
    .insert(tenantMigrations)
    .values({ tenantId, migrationName, status, error: error ?? null })
    .onConflictDoUpdate({
      target: [tenantMigrations.tenantId, tenantMigrations.migrationName],
      set: { status, error: error ?? null, appliedAt: new Date() },
    });
}

export async function listTenantMigrations(db: ControlDb, tenantId: string) {
  return db
    .select()
    .from(tenantMigrations)
    .where(eq(tenantMigrations.tenantId, tenantId))
    .orderBy(asc(tenantMigrations.migrationName));
}

export async function isPlatformAdmin(db: ControlDb, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email.toLowerCase()))
    .limit(1);
  return !!row;
}

export async function ensureDefaultPlan(db: ControlDb) {
  await db
    .insert(plans)
    .values({ key: 'standard', name: 'Standard', maxEmployees: null, features: {} })
    .onConflictDoNothing({ target: plans.key });
  const [plan] = await db.select().from(plans).where(eq(plans.key, 'standard'));
  return plan!;
}

export async function getTenantPlan(db: ControlDb, tenant: Tenant) {
  if (!tenant.planId) return null;
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, tenant.planId)));
  return plan ?? null;
}

/**
 * The tenant's VAPID key pair, created on first use by `generate` (web-push keys are created
 * in the API so this package stays free of the dependency). Concurrent first calls keep one pair.
 */
export async function getOrCreateVapidKeys(
  db: ControlDb,
  tenantId: string,
  masterKey: Buffer,
  generate: () => { publicKey: string; privateKey: string },
): Promise<{ publicKey: string; privateKey: string }> {
  const read = async () => {
    const [s] = await db
      .select({ pub: tenantSecrets.vapidPublicKey, priv: tenantSecrets.vapidPrivateKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenantId));
    return s?.pub && s.priv
      ? { publicKey: s.pub, privateKey: decryptSecret(s.priv, masterKey) }
      : null;
  };
  const existing = await read();
  if (existing) return existing;
  const keys = generate();
  await db
    .update(tenantSecrets)
    .set({
      vapidPublicKey: keys.publicKey,
      vapidPrivateKeyEnc: encryptSecret(keys.privateKey, masterKey),
    })
    .where(and(eq(tenantSecrets.tenantId, tenantId), isNull(tenantSecrets.vapidPublicKey)));
  const stored = await read();
  if (!stored) throw new Error(`Tenant ${tenantId} has no secrets row`);
  return stored;
}

export async function findTenantById(db: ControlDb, id: string): Promise<Tenant | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  return t ?? null;
}

/** Primary (else first) domain of a tenant, for absolute links in emails. */
export async function primaryDomain(db: ControlDb, tenantId: string): Promise<string | null> {
  const rows = await listTenantDomains(db, tenantId);
  return (rows.find((d) => d.isPrimary) ?? rows[0])?.host ?? null;
}
