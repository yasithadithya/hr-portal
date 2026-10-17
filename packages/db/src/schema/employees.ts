import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { auditColumns, id } from './columns';

export const EMPLOYEE_STATUSES = [
  'active',
  'on_probation',
  'notice',
  'resigned',
  'terminated',
  'retired',
] as const;

/**
 * Minimal employee master introduced in Phase 2 so `team` scope (reports_to subtree) and IDOR
 * tests run against real data. Phase 4 adds the full set of columns in a later migration.
 */
export const employees = pgTable(
  'employees',
  {
    id: id(),
    employeeNo: text('employee_no').notNull().unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    workEmail: text('work_email'),
    reportsToId: uuid('reports_to_id').references((): AnyPgColumn => employees.id),
    status: text('status', { enum: EMPLOYEE_STATUSES }).notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    index('employees_reports_to_idx').on(t.reportsToId),
    check(
      'employees_status_check',
      sql`${t.status} in ('active','on_probation','notice','resigned','terminated','retired')`,
    ),
    check(
      'employees_not_own_manager',
      sql`${t.reportsToId} is null or ${t.reportsToId} <> ${t.id}`,
    ),
  ],
).enableRLS();
