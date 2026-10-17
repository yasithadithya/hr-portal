import { connect, migrate, MigrationFailedError, type MigrationFile } from '@hr/db';

import type { ControlDb } from './client';
import {
  findTenantBySlug,
  getTenantConnection,
  listTenants,
  recordTenantMigration,
  type Tenant,
} from './repo';

export interface FanoutOptions {
  db: ControlDb;
  masterKey: Buffer;
  files: MigrationFile[];
  /** Only this tenant (any status). Otherwise all `active` + `provisioning` tenants. */
  slug?: string | undefined;
  dryRun?: boolean;
  concurrency?: number;
  continueOnError?: boolean;
  log?: (msg: string) => void;
}

export interface TenantFanoutResult {
  slug: string;
  status: 'ok' | 'failed' | 'skipped';
  applied: string[];
  pending: string[];
  error?: string;
}

/**
 * Applies tenant migrations to every tenant DB (PLAN.md Phase 1 "Migration fan-out").
 * Records per-tenant status in `platform.tenant_migrations`. Stops scheduling new tenants after
 * the first failure unless `continueOnError`.
 */
export async function migrateTenants(opts: FanoutOptions): Promise<TenantFanoutResult[]> {
  const { db, masterKey, files, dryRun = false, continueOnError = false, log = () => {} } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? 1);

  let targets: Tenant[];
  if (opts.slug) {
    const t = await findTenantBySlug(db, opts.slug);
    if (!t) throw new Error(`No tenant with slug "${opts.slug}"`);
    targets = [t];
  } else {
    targets = (await listTenants(db)).filter(
      (t) => t.status === 'active' || t.status === 'provisioning',
    );
  }

  const results: TenantFanoutResult[] = [];
  let failed = false;
  const queue = [...targets];

  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (failed && !continueOnError) {
        results.push({ slug: t.slug, status: 'skipped', applied: [], pending: [] });
        continue;
      }
      const conn = await getTenantConnection(db, t, masterKey);
      const sql = connect(conn.dbDirectUrl, { max: 1 });
      try {
        const res = await migrate(sql, files, {
          table: 'tenant',
          dryRun,
          log: (m) => log(`[${t.slug}] ${m}`),
        });
        if (!dryRun) {
          for (const name of res.applied) await recordTenantMigration(db, t.id, name, 'applied');
        }
        results.push({ slug: t.slug, status: 'ok', ...res });
      } catch (err) {
        failed = true;
        const message = err instanceof Error ? err.message : String(err);
        log(`[${t.slug}] FAILED: ${message}`);
        const appliedBefore = err instanceof MigrationFailedError ? err.applied : [];
        if (!dryRun && err instanceof MigrationFailedError) {
          for (const name of err.applied) await recordTenantMigration(db, t.id, name, 'applied');
          await recordTenantMigration(db, t.id, err.migration, 'failed', message);
        }
        results.push({
          slug: t.slug,
          status: 'failed',
          applied: appliedBefore,
          pending: [],
          error: message,
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results.sort((a, b) => a.slug.localeCompare(b.slug));
}
