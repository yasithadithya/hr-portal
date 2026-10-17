import {
  findTenantByHost,
  getTenantConnection,
  normaliseHost,
  type ControlDb,
  type Tenant,
  type TenantConnection,
} from '@hr/control-db';
import type { TenantDb } from '@hr/db';

import type { PoolManager } from './pools';

export interface ResolvedTenant {
  tenant: Tenant;
  connection: TenantConnection;
}

interface CacheEntry {
  value: ResolvedTenant | null;
  expires: number;
}

export interface TenantRegistryOptions {
  control: ControlDb;
  masterKey: Buffer;
  pools: PoolManager;
  /** PLAN.md: host lookups cached 60 s. */
  ttlMs?: number;
  /** Unknown hosts are cached briefly so random hosts can't hammer the control plane. */
  negativeTtlMs?: number;
  now?: () => number;
}

/** Host → tenant (+ decrypted connection info), cached; tenant → DB pool. */
export class TenantRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly negativeTtl: number;
  private readonly now: () => number;

  constructor(private readonly opts: TenantRegistryOptions) {
    this.ttl = opts.ttlMs ?? 60_000;
    this.negativeTtl = opts.negativeTtlMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  async resolve(rawHost: string): Promise<ResolvedTenant | null> {
    const host = normaliseHost(rawHost);
    const hit = this.cache.get(host);
    if (hit && hit.expires > this.now()) return hit.value;

    const tenant = await findTenantByHost(this.opts.control, host);
    const value = tenant
      ? {
          tenant,
          connection: await getTenantConnection(this.opts.control, tenant, this.opts.masterKey),
        }
      : null;
    this.cache.set(host, { value, expires: this.now() + (value ? this.ttl : this.negativeTtl) });
    return value;
  }

  db(resolved: ResolvedTenant): TenantDb {
    return this.opts.pools.get(resolved.tenant.id, resolved.connection.dbUrl);
  }

  /** Drop cached lookups for a tenant (status change, secret rotation, domain change). */
  invalidate(tenantId?: string): void {
    for (const [host, entry] of this.cache) {
      if (!tenantId || entry.value?.tenant.id === tenantId) this.cache.delete(host);
    }
  }
}
