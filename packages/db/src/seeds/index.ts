import type { TenantDb } from '../index';

/**
 * Default-data seeds for a new tenant (Sri Lanka defaults, all editable, flagged `verify`).
 * Each seed must be idempotent: provisioning may re-run it with `--resume`.
 * Phases 3, 5 and 7 register their seeds here.
 */
export interface Seed {
  key: string;
  description: string;
  run: (db: TenantDb) => Promise<void>;
}

export const seeds: Seed[] = [];

export async function runSeeds(db: TenantDb, log: (msg: string) => void = () => {}) {
  for (const seed of seeds) {
    await seed.run(db);
    log(`seeded ${seed.key}`);
  }
}
