import { Router, type Request } from 'express';
import { z } from 'zod';

import { inviteUserSchema, ok, updateUserSchema } from '@hr/shared';

import { authedCtx } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';

import * as repo from './repo';
import * as service from './service';

const idParams = { params: z.object({ id: z.uuid() }) };
const inviteSchemas = { body: inviteUserSchema };
const updateSchemas = { ...idParams, body: updateUserSchema };

/** Where the invite email sends people: this workspace's own host. */
function acceptUrl(req: Request): string {
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${req.protocol}://${host}/auth/accept`;
}

export function userRoutes(): Router {
  const router = Router();
  router.use('/users', requirePermission('users.manage', 'all'));

  router.get('/users', async (req, res) => {
    res.json(ok(await repo.listUsers(authedCtx(req).db)));
  });

  router.get('/users/:id', validate(idParams), async (req, res) => {
    const user = await repo.getUser(authedCtx(req).db, parsed(req, idParams).params.id);
    if (!user) throw AppError.notFound('User not found');
    res.json(ok(user));
  });

  router.post('/users/invite', validate(inviteSchemas), async (req, res) => {
    const user = await service.inviteUser(
      authedCtx(req),
      parsed(req, inviteSchemas).body,
      acceptUrl(req),
    );
    res.status(201).json(ok(user));
  });

  router.post('/users/:id/resend-invite', validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const user = await repo.getUser(ctx.db, parsed(req, idParams).params.id);
    if (!user) throw AppError.notFound('User not found');
    if (user.status !== 'invited')
      throw AppError.badRequest('User has already accepted the invite');
    const updated = await service.inviteUser(
      ctx,
      { email: user.email, roleIds: user.roles.map((r) => r.id), employeeId: user.employeeId },
      acceptUrl(req),
    );
    res.json(ok(updated));
  });

  router.patch('/users/:id', validate(updateSchemas), async (req, res) => {
    const { params, body } = parsed(req, updateSchemas);
    res.json(ok(await service.updateUser(authedCtx(req), params.id, body)));
  });

  return router;
}
