import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, id } from './columns';
import { employees } from './employees';

export const APP_USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export const SCOPES = ['self', 'team', 'all'] as const;

/** Maps a Supabase Auth user (in this tenant's project) to an employee and roles. */
export const appUsers = pgTable(
  'app_users',
  {
    id: id(),
    authUserId: uuid('auth_user_id').unique(),
    employeeId: uuid('employee_id')
      .unique()
      .references(() => employees.id),
    email: text('email').notNull().unique(),
    status: text('status', { enum: APP_USER_STATUSES }).notNull().default('invited'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    check('app_users_status_check', sql`${t.status} in ('invited','active','disabled')`),
    check('app_users_email_lower', sql`${t.email} = lower(${t.email})`),
  ],
).enableRLS();

export const roles = pgTable('roles', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  ...auditColumns(),
}).enableRLS();

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: id(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
    scope: text('scope', { enum: SCOPES }).notNull(),
    ...auditColumns(),
  },
  (t) => [
    unique('role_permissions_role_key').on(t.roleId, t.permissionKey),
    check('role_permissions_scope_check', sql`${t.scope} in ('self','team','all')`),
  ],
).enableRLS();

export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    ...auditColumns(),
  },
  (t) => [
    unique('user_roles_user_role').on(t.userId, t.roleId),
    index('user_roles_role_idx').on(t.roleId),
  ],
).enableRLS();
