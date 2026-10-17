import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** created_at/updated_at/created_by/updated_by — required on every tenant table (CLAUDE.md Naming). */
export const auditColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
});

export const id = () => uuid('id').primaryKey().defaultRandom();
