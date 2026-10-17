import { eq } from 'drizzle-orm';

import { schema, withAudit } from '@hr/db';
import {
  scopeCovers,
  type InviteUserInput,
  type PermissionMap,
  type RolePermission,
  type UpdateUserInput,
  type User,
} from '@hr/shared';

import type { AuthedUser, RequestContext } from '../../context';
import { AppError } from '../../lib/errors';

import * as repo from './repo';

type Ctx = RequestContext & { user: AuthedUser };

/**
 * Privilege-escalation guard: you can only hand out permissions (and scopes) you hold yourself.
 * This also means only an owner can make someone an owner.
 */
export function assertCanGrant(actor: PermissionMap, grants: RolePermission[]): void {
  const excess = grants.filter((g) => {
    const mine = actor[g.key];
    return !mine || !scopeCovers(mine, g.scope);
  });
  if (excess.length > 0) {
    throw new AppError(403, 'FORBIDDEN', 'You cannot grant permissions you do not have', {
      permissions: excess.map((g) => `${g.key}:${g.scope}`),
    });
  }
}

async function validateRoles(ctx: Ctx, roleIds: string[]) {
  const found = await repo.rolesByIds(ctx.db, roleIds);
  if (found.length !== new Set(roleIds).size) throw AppError.badRequest('Unknown role');
  assertCanGrant(ctx.permissions, await repo.permissionsOfRoles(ctx.db, roleIds));
  return found;
}

async function validateEmployee(ctx: Ctx, employeeId: string, exceptUserId?: string) {
  const [emp] = await ctx.db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(eq(schema.employees.id, employeeId));
  if (!emp) throw AppError.badRequest('Unknown employee');
  if (await repo.employeeLinkedTo(ctx.db, employeeId, exceptUserId)) {
    throw new AppError(409, 'CONFLICT', 'That employee is already linked to another user');
  }
}

export async function inviteUser(
  ctx: Ctx,
  input: InviteUserInput,
  redirectTo: string,
): Promise<User> {
  const email = input.email.toLowerCase();
  await validateRoles(ctx, input.roleIds);
  if (input.employeeId) await validateEmployee(ctx, input.employeeId);

  const existing = await repo.findUserByEmail(ctx.db, email);
  if (existing && existing.status !== 'invited') {
    throw new AppError(409, 'CONFLICT', 'A user with this email already exists');
  }

  // Send (or re-send) the Supabase invite first; if it fails nothing is written.
  const { authUserId } = await ctx.authAdmin().inviteUser(email, redirectTo);

  const id = await withAudit(ctx.db, ctx.actor, 'app_users', async (tx) => {
    const values = {
      email,
      authUserId,
      employeeId: input.employeeId ?? null,
      status: 'invited' as const,
      invitedAt: new Date(),
      updatedBy: ctx.user.id,
    };
    const [row] = existing
      ? await tx
          .update(schema.appUsers)
          .set(values)
          .where(eq(schema.appUsers.id, existing.id))
          .returning()
      : await tx
          .insert(schema.appUsers)
          .values({ ...values, createdBy: ctx.user.id })
          .returning();
    await repo.setUserRoles(tx, row!.id, input.roleIds, ctx.user.id);
    return {
      action: existing ? 'reinvite' : 'invite',
      entityId: row!.id,
      before: existing ?? null,
      after: { ...row, roleIds: input.roleIds },
      result: row!.id,
    };
  });
  return (await repo.getUser(ctx.db, id))!;
}

export async function updateUser(ctx: Ctx, id: string, input: UpdateUserInput): Promise<User> {
  const before = await repo.getUser(ctx.db, id);
  if (!before) throw AppError.notFound('User not found');
  if (id === ctx.user.id && (input.status === 'disabled' || input.roleIds)) {
    throw AppError.badRequest('You cannot disable yourself or change your own roles');
  }
  // Editing someone who holds more than you (e.g. an owner) is an escalation too.
  assertCanGrant(
    ctx.permissions,
    await repo.permissionsOfRoles(
      ctx.db,
      before.roles.map((r) => r.id),
    ),
  );
  if (input.roleIds) await validateRoles(ctx, input.roleIds);
  if (input.employeeId) await validateEmployee(ctx, input.employeeId, id);

  const losesOwner =
    before.roles.some((r) => r.key === 'owner') &&
    (input.status === 'disabled' ||
      (input.roleIds &&
        !(await repo.rolesByIds(ctx.db, input.roleIds)).some((r) => r.key === 'owner')));
  if (losesOwner && (await repo.otherActiveOwners(ctx.db, id)) === 0) {
    throw new AppError(409, 'CONFLICT', 'A workspace must keep at least one active owner');
  }

  await withAudit(ctx.db, ctx.actor, 'app_users', async (tx) => {
    const set: Partial<typeof schema.appUsers.$inferInsert> = {
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
    };
    if (input.status) {
      if (before.status === 'invited' && input.status === 'active') {
        throw AppError.badRequest('An invited user becomes active when they first sign in');
      }
      set.status = input.status;
    }
    if (input.employeeId !== undefined) set.employeeId = input.employeeId;
    await tx.update(schema.appUsers).set(set).where(eq(schema.appUsers.id, id));
    if (input.roleIds) await repo.setUserRoles(tx, id, input.roleIds, ctx.user.id);
    return { action: 'update', entityId: id, before, after: { ...before, ...input }, result: null };
  });
  return (await repo.getUser(ctx.db, id))!;
}
