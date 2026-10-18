import { and, eq, inArray, sql } from 'drizzle-orm';

import { schema, type TenantDb, type Tx } from '@hr/db';
import { scopeCovers, type NotificationEvent, type PermissionKey, type Scope } from '@hr/shared';

import type { JobQueue } from '../../jobs/queue';

const { appUsers, notifications, rolePermissions, userRoles } = schema;
type Db = TenantDb | Tx;

export interface NotifyTarget {
  db: Db;
  tenantId: string;
  jobs: JobQueue;
}

export interface NotificationInput {
  userIds: string[];
  event: NotificationEvent;
  title: string;
  body: string;
  link?: string | null;
  data?: Record<string, unknown>;
  /** One notification per user for this key, ever (reminders). */
  dedupeKey?: string;
}

/**
 * Stores in-app notifications and queues email/push delivery. Never throws into the caller's
 * business flow: a failed notification must not undo an approved leave.
 */
export async function notify(t: NotifyTarget, items: NotificationInput | NotificationInput[]) {
  const list = (Array.isArray(items) ? items : [items]).filter((i) => i.userIds.length);
  if (!list.length) return [];
  const rows = list.flatMap((i) =>
    [...new Set(i.userIds)].map((userId) => ({
      userId,
      event: i.event,
      title: i.title,
      body: i.body,
      link: i.link ?? null,
      data: i.data ?? {},
      dedupeKey: i.dedupeKey ?? null,
    })),
  );
  const inserted = await t.db
    .insert(notifications)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (inserted.length) {
    await t.jobs.send('notifications.deliver', {
      tenantId: t.tenantId,
      notificationIds: inserted.map((r) => r.id),
    });
  }
  return inserted.map((r) => r.id);
}

/** Active app users linked to these employees. */
export async function usersOfEmployees(db: Db, employeeIds: (string | null | undefined)[]) {
  const ids = [...new Set(employeeIds.filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(inArray(appUsers.employeeId, ids), eq(appUsers.status, 'active')));
  return rows.map((r) => r.id);
}

/** Active users holding `key` at `scope` or wider (e.g. HR approvers for leave). */
export async function usersWithPermission(db: Db, key: PermissionKey, scope: Scope = 'all') {
  const rows = await db
    .select({ id: appUsers.id, scope: rolePermissions.scope })
    .from(appUsers)
    .innerJoin(userRoles, eq(userRoles.userId, appUsers.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(appUsers.status, 'active'), eq(rolePermissions.permissionKey, key)));
  return [...new Set(rows.filter((r) => scopeCovers(r.scope as Scope, scope)).map((r) => r.id))];
}

/** Unread count (for the bell). */
export async function unreadCount(db: Db, userId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`));
  return r?.n ?? 0;
}
