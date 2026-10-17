import { and, eq, notInArray } from 'drizzle-orm';

import { SYSTEM_ROLES } from '@hr/shared/permissions';

import type { TenantDb } from '../index';
import { rolePermissions, roles } from '../schema/index';

import type { Seed } from './index';

/** Upserts the five system roles and makes their permissions match code exactly. */
export const rbacSeed: Seed = {
  key: 'rbac.system-roles',
  description: 'System roles: owner, hr_admin, payroll_admin, manager, employee',
  run: async (db: TenantDb) => {
    await db.transaction(async (tx) => {
      for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
        const [role] = await tx
          .insert(roles)
          .values({ key, name: def.name, description: def.description, isSystem: true })
          .onConflictDoUpdate({
            target: roles.key,
            set: {
              name: def.name,
              description: def.description,
              isSystem: true,
              updatedAt: new Date(),
            },
          })
          .returning();
        const keys = def.permissions.map((p) => p.key);
        await tx
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.roleId, role!.id),
              notInArray(rolePermissions.permissionKey, keys),
            ),
          );
        for (const p of def.permissions) {
          await tx
            .insert(rolePermissions)
            .values({ roleId: role!.id, permissionKey: p.key, scope: p.scope })
            .onConflictDoUpdate({
              target: [rolePermissions.roleId, rolePermissions.permissionKey],
              set: { scope: p.scope, updatedAt: new Date() },
            });
        }
      }
    });
  },
};
