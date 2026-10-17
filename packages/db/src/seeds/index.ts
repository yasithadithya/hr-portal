import type { TenantDb } from '../index';

import { orgSeed } from './org';
import { rbacSeed } from './rbac';

/**
 * Default-data seeds for a new tenant (Sri Lanka defaults, all editable, flagged `verify`).
 * Each seed must be idempotent: provisioning and `tenants:migrate` re-run them.
 * Phases 5 and 7 register their seeds here.
 */
export interface SeedContext {
  tenantName: string;
  timezone: string;
}

export interface Seed {
  key: string;
  description: string;
  run: (db: TenantDb, ctx: SeedContext) => Promise<void>;
}

export const seeds: Seed[] = [rbacSeed, orgSeed];

export async function runSeeds(
  db: TenantDb,
  ctx: SeedContext = { tenantName: 'My Company', timezone: 'Asia/Colombo' },
  log: (msg: string) => void = () => {},
) {
  for (const seed of seeds) {
    await seed.run(db, ctx);
    log(`seeded ${seed.key}`);
  }
}
