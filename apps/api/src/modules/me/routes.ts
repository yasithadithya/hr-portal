import { eq } from 'drizzle-orm';
import { Router } from 'express';

import { loadUserRoles, schema } from '@hr/db';
import { ok, type Me } from '@hr/shared';

import { authedCtx } from '../../context';

export function meRoutes(): Router {
  const router = Router();

  /** Who am I in this workspace: drives menus and route guards in the web app. */
  router.get('/me', async (req, res) => {
    const ctx = authedCtx(req);
    const [employee] = ctx.user.employeeId
      ? await ctx.db
          .select()
          .from(schema.employees)
          .where(eq(schema.employees.id, ctx.user.employeeId))
      : [];
    const [u] = await ctx.db
      .select()
      .from(schema.appUsers)
      .where(eq(schema.appUsers.id, ctx.user.id));
    const body: Me = {
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        status: u!.status,
        employeeId: ctx.user.employeeId,
      },
      employee: employee
        ? {
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
            employeeNo: employee.employeeNo,
          }
        : null,
      roles: (await loadUserRoles(ctx.db, ctx.user.id)).map(({ id, key, name }) => ({
        id,
        key,
        name,
      })),
      permissions: ctx.permissions,
      tenant: { slug: ctx.tenant.slug, name: ctx.tenant.name, timezone: ctx.tenant.timezone },
    };
    res.json(ok(body));
  });

  return router;
}
