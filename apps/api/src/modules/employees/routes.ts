import { and, asc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { schema, scopeCondition } from '@hr/db';
import { ok, type EmployeeSummary } from '@hr/shared';

import { authedCtx, scopeOf } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';

const { employees } = schema;
const idParams = { params: z.object({ id: z.uuid() }) };

function toDto(e: typeof employees.$inferSelect): EmployeeSummary {
  return {
    id: e.id,
    employeeNo: e.employeeNo,
    firstName: e.firstName,
    lastName: e.lastName,
    workEmail: e.workEmail,
    reportsToId: e.reportsToId,
    status: e.status,
  };
}

/** Scoped employee reads (Phase 2 minimum; Phase 4 builds the full module). */
export function employeeRoutes(): Router {
  const router = Router();
  router.use('/employees', requirePermission('employees.read'));

  router.get('/employees', async (req, res) => {
    const ctx = authedCtx(req);
    const rows = await ctx.db
      .select()
      .from(employees)
      .where(
        and(
          isNull(employees.archivedAt),
          scopeCondition(scopeOf(req, 'employees.read'), ctx.user.employeeId, employees.id),
        ),
      )
      .orderBy(asc(employees.employeeNo));
    res.json(ok(rows.map(toDto)));
  });

  router.get('/employees/:id', validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    const [row] = await ctx.db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.id, params.id),
          scopeCondition(scopeOf(req, 'employees.read'), ctx.user.employeeId, employees.id),
        ),
      );
    // Out-of-scope looks identical to missing: no existence oracle for IDs.
    if (!row) throw AppError.notFound('Employee not found');
    res.json(ok(toDto(row)));
  });

  return router;
}
