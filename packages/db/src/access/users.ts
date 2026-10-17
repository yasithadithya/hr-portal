import { eq } from 'drizzle-orm';

import {
  widestScope,
  type PermissionKey,
  type PermissionMap,
  type Scope,
} from '@hr/shared/permissions';

import type { TenantDb } from '../index';
import { appUsers, rolePermissions, roles, userRoles } from '../schema/index';

export type AppUser = typeof appUsers.$inferSelect;

export async function findAppUserByAuthId(
  db: TenantDb,
  authUserId: string,
): Promise<AppUser | null> {
  const [row] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.authUserId, authUserId))
    .limit(1);
  return row ?? null;
}

/** Union of all the user's roles; each key gets the widest granted scope. */
export async function loadPermissions(db: TenantDb, userId: string): Promise<PermissionMap> {
  const rows = await db
    .select({ key: rolePermissions.permissionKey, scope: rolePermissions.scope })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const map: PermissionMap = {};
  for (const r of rows) {
    const key = r.key as PermissionKey;
    const current = map[key];
    map[key] = current ? widestScope(current, r.scope as Scope) : (r.scope as Scope);
  }
  return map;
}

export async function loadUserRoles(db: TenantDb, userId: string) {
  return db
    .select({ id: roles.id, key: roles.key, name: roles.name, isSystem: roles.isSystem })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
}
