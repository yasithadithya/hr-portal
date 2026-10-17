import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';

import * as schema from './schema/index';

export { schema };
export * from './connection';
export * from './migrator';
export * from './seeds/index';
export * from './access/index';

export const TENANT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export function tenantDb(sql: Sql) {
  return drizzle(sql, { schema });
}

export type TenantDb = ReturnType<typeof tenantDb>;
