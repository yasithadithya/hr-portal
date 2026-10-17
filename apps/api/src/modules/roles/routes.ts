import { and, count, eq, notInArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { schema, withAudit, type TenantDb } from '@hr/db';
import { createRoleSchema, ok, updateRoleSchema, type Role, type RolePermission } from '@hr/shared';

import { authedCtx } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { assertCanGrant } from '../users/service';

const { roles, rolePermissions, userRoles } = schema;

const idParams = { params: z.object({ id: z.uuid() }) };
const createSchemas = { body: createRoleSchema };
const updateSchemas = { ...idParams, body: updateRoleSchema };

async function listRoles(db: TenantDb): Promise<Role[]> {
  const rows = await db.select().from(roles).orderBy(roles.isSystem, roles.name);
  const perms = await db.select().from(rolePermissions);
  const counts = await db
    .select({ roleId: userRoles.roleId, n: count() })
    .from(userRoles)
    .groupBy(userRoles.roleId);
  return rows
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      userCount: counts.find((c) => c.roleId === r.id)?.n ?? 0,
      permissions: perms
        .filter((p) => p.roleId === r.id)
        .map((p) => ({ key: p.permissionKey, scope: p.scope }) as RolePermission),
    }))
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name));
}

async function getRole(db: TenantDb, id: string) {
  return (await listRoles(db)).find((r) => r.id === id) ?? null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

async function writePermissions(
  tx: Parameters<Parameters<TenantDb['transaction']>[0]>[0],
  roleId: string,
  permissions: RolePermission[],
  actorId: string,
) {
  const keys = permissions.map((p) => p.key);
  await tx
    .delete(rolePermissions)
    .where(
      keys.length
        ? and(eq(rolePermissions.roleId, roleId), notInArray(rolePermissions.permissionKey, keys))
        : eq(rolePermissions.roleId, roleId),
    );
  for (const p of permissions) {
    await tx
      .insert(rolePermissions)
      .values({
        roleId,
        permissionKey: p.key,
        scope: p.scope,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoUpdate({
        target: [rolePermissions.roleId, rolePermissions.permissionKey],
        set: { scope: p.scope, updatedBy: actorId, updatedAt: new Date() },
      });
  }
}

export function roleRoutes(): Router {
  const router = Router();

  // Reading roles is needed to invite users, so users.manage is enough.
  router.get('/roles', requirePermission('users.manage', 'all'), async (req, res) => {
    res.json(ok(await listRoles(authedCtx(req).db)));
  });

  router.post(
    '/roles',
    requirePermission('users.manage', 'all'),
    validate(createSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { body } = parsed(req, createSchemas);
      let permissions: RolePermission[] = body.permissions ?? [];
      if (body.copyFromRoleId && !body.permissions) {
        const source = await getRole(ctx.db, body.copyFromRoleId);
        if (!source) throw AppError.badRequest('Unknown role to copy from');
        permissions = source.permissions;
      }
      assertCanGrant(ctx.permissions, permissions);

      let key = `custom_${slugify(body.name)}`;
      const taken = new Set(
        (await ctx.db.select({ key: roles.key }).from(roles)).map((r) => r.key),
      );
      for (let i = 2; taken.has(key); i++) key = `custom_${slugify(body.name)}_${i}`;

      const id = await withAudit(ctx.db, ctx.actor, 'roles', async (tx) => {
        const [role] = await tx
          .insert(roles)
          .values({
            key,
            name: body.name,
            description: body.description ?? null,
            isSystem: false,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })
          .returning();
        await writePermissions(tx, role!.id, permissions, ctx.user.id);
        return {
          action: 'create',
          entityId: role!.id,
          after: { ...role, permissions },
          result: role!.id,
        };
      });
      res.status(201).json(ok(await getRole(ctx.db, id)));
    },
  );

  router.patch(
    '/roles/:id',
    requirePermission('users.manage', 'all'),
    validate(updateSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, updateSchemas);
      const before = await getRole(ctx.db, params.id);
      if (!before) throw AppError.notFound('Role not found');
      if (before.isSystem)
        throw AppError.badRequest('System roles cannot be edited. Copy it instead.');
      // Must hold everything the role has now and everything it will have.
      assertCanGrant(ctx.permissions, [...before.permissions, ...(body.permissions ?? [])]);

      await withAudit(ctx.db, ctx.actor, 'roles', async (tx) => {
        await tx
          .update(roles)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(eq(roles.id, params.id));
        if (body.permissions) await writePermissions(tx, params.id, body.permissions, ctx.user.id);
        return {
          action: 'update',
          entityId: params.id,
          before,
          after: { ...before, ...body },
          result: null,
        };
      });
      res.json(ok(await getRole(ctx.db, params.id)));
    },
  );

  router.delete(
    '/roles/:id',
    requirePermission('users.manage', 'all'),
    validate(idParams),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, idParams);
      const before = await getRole(ctx.db, params.id);
      if (!before) throw AppError.notFound('Role not found');
      if (before.isSystem) throw AppError.badRequest('System roles cannot be deleted');
      if (before.userCount > 0)
        throw new AppError(409, 'CONFLICT', 'Remove this role from all users first');
      assertCanGrant(ctx.permissions, before.permissions);
      await withAudit(ctx.db, ctx.actor, 'roles', async (tx) => {
        await tx.delete(roles).where(eq(roles.id, params.id));
        return { action: 'delete', entityId: params.id, before, result: null };
      });
      res.json(ok({ id: params.id }));
    },
  );

  return router;
}
