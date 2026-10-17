import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { auditColumns, id } from './columns';

/** Generic typed settings; each key's value is validated by a Zod schema in @hr/shared. */
export const settings = pgTable('settings', {
  id: id(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  ...auditColumns(),
}).enableRLS();
