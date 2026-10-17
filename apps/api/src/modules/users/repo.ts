import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';

import { schema, type TenantDb, type Tx } from '@hr/db';
import type { RolePermission, User } from '@hr/shared';

const { appUsers, rolePermissions, roles, userRoles } = schema;

type Db = TenantDb | Tx;

export async function listUsers(db: Db): Promise<User[]> {
  const users = await db.select().from(appUsers).orderBy(appUsers.email);
  const links = await db
    .select({ userId: userRoles.userId, id: roles.id, key: roles.key, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId));
  return users.map((u) =>
    toUserDto(
      u,
      links.filter((l) => l.userId === u.id),
    ),
  );
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const [u] = await db.select().from(appUsers).where(eq(appUsers.id, id));
  if (!u) return null;
  const links = await db
    .select({ id: roles.id, key: roles.key, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, id));
  return toUserDto(u, links);
}

function toUserDto(
  u: typeof appUsers.$inferSelect,
  links: { id: string; key: string; name: string }[],
): User {
  return {
    id: u.id,
    email: u.email,
    status: u.status,
    employeeId: u.employeeId,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    invitedAt: u.invitedAt?.toISOString() ?? null,
    roles: links.map(({ id, key, name }) => ({ id, key, name })),
  };
}

export async function rolesByIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(roles).where(inArray(roles.id, ids));
}

export async function permissionsOfRoles(db: Db, roleIds: string[]): Promise<RolePermission[]> {
  if (roleIds.length === 0) return [];
  const rows = await db
    .select({ key: rolePermissions.permissionKey, scope: rolePermissions.scope })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));
  return rows as RolePermission[];
}

export async function setUserRoles(tx: Tx, userId: string, roleIds: string[], actorId: string) {
  await tx.delete(userRoles).where(eq(userRoles.userId, userId));
  await tx
    .insert(userRoles)
    .values(roleIds.map((roleId) => ({ userId, roleId, createdBy: actorId, updatedBy: actorId })));
}

/** Active users (other than `exceptUserId`) holding the owner role. */
export async function otherActiveOwners(db: Db, exceptUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(appUsers, eq(appUsers.id, userRoles.userId))
    .where(
      and(eq(roles.key, 'owner'), eq(appUsers.status, 'active'), ne(appUsers.id, exceptUserId)),
    );
  return row?.n ?? 0;
}

export async function findUserByEmail(db: Db, email: string) {
  const [u] = await db.select().from(appUsers).where(eq(appUsers.email, email.toLowerCase()));
  return u ?? null;
}

export async function employeeLinkedTo(db: Db, employeeId: string, exceptUserId?: string) {
  const [u] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.employeeId, employeeId),
        exceptUserId ? ne(appUsers.id, exceptUserId) : sql`true`,
      ),
    );
  return u ?? null;
}
