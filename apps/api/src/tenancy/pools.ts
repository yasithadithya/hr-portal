import type { Sql } from 'postgres';

import { connect, tenantDb, type TenantDb } from '@hr/db';

interface PoolEntry {
  sql: Sql;
  db: TenantDb;
  url: string;
  lastUsed: number;
}

export interface PoolManagerOptions {
  /** Maximum number of tenant pools kept open (LRU eviction beyond this). */
  maxPools: number;
  /** Connections per tenant pool. */
  connectionsPerPool: number;
  /** Close a tenant pool after this long without use. */
  idleMs: number;
  /** Injected for tests. */
  connectFn?: (url: string) => Sql;
  now?: () => number;
}

export interface PoolMetrics {
  open: number;
  created: number;
  evicted: number;
  hits: number;
}

/**
 * One postgres.js pool per tenant (PLAN.md §1). There is deliberately no global tenant client:
 * handlers only ever see `req.ctx.db` (CLAUDE.md Hard Rule 4).
 */
export class PoolManager {
  private readonly pools = new Map<string, PoolEntry>();
  private readonly metrics: PoolMetrics = { open: 0, created: 0, evicted: 0, hits: 0 };
  private sweeper: NodeJS.Timeout | undefined;
  private readonly now: () => number;
  private readonly connectFn: (url: string) => Sql;

  constructor(private readonly opts: PoolManagerOptions) {
    this.now = opts.now ?? Date.now;
    this.connectFn =
      opts.connectFn ?? ((url) => connect(url, { max: opts.connectionsPerPool, idleTimeout: 20 }));
  }

  get(tenantId: string, url: string): TenantDb {
    const existing = this.pools.get(tenantId);
    if (existing && existing.url === url) {
      existing.lastUsed = this.now();
      // Re-insert to mark as most recently used.
      this.pools.delete(tenantId);
      this.pools.set(tenantId, existing);
      this.metrics.hits++;
      return existing.db;
    }
    if (existing) void this.close(tenantId); // URL rotated

    const sql = this.connectFn(url);
    this.pools.set(tenantId, { sql, db: tenantDb(sql), url, lastUsed: this.now() });
    this.metrics.created++;
    while (this.pools.size > this.opts.maxPools) {
      const oldest = this.pools.keys().next().value;
      if (oldest === undefined) break;
      void this.close(oldest);
    }
    return this.pools.get(tenantId)!.db;
  }

  async close(tenantId: string): Promise<void> {
    const entry = this.pools.get(tenantId);
    if (!entry) return;
    this.pools.delete(tenantId);
    this.metrics.evicted++;
    await entry.sql.end({ timeout: 5 });
  }

  async sweepIdle(): Promise<void> {
    const cutoff = this.now() - this.opts.idleMs;
    await Promise.all(
      [...this.pools].filter(([, e]) => e.lastUsed < cutoff).map(([id]) => this.close(id)),
    );
  }

  startSweeper(intervalMs = 60_000): void {
    this.sweeper ??= setInterval(() => void this.sweepIdle(), intervalMs);
    this.sweeper.unref();
  }

  getMetrics(): PoolMetrics {
    return { ...this.metrics, open: this.pools.size };
  }

  async closeAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.all([...this.pools.keys()].map((id) => this.close(id)));
  }
}
