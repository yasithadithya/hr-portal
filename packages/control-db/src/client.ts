import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';

import * as schema from './schema/index';

export const CONTROL_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export function controlDb(sql: Sql) {
  return drizzle(sql, { schema });
}

export type ControlDb = ReturnType<typeof controlDb>;
