import { asc, eq, isNull, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { Router } from 'express';
import { z } from 'zod';

import { withAudit } from '@hr/db';
import { archiveSchema, ok, type PermissionKey } from '@hr/shared';

import { authedCtx, type AuthedUser, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';

type RefTable = PgTable & { id: PgColumn; archivedAt: PgColumn };
type Row = Record<string, unknown> & { id: string; archivedAt: Date | null };

export interface RefConfig<I extends z.ZodType> {
  /** URL segment, e.g. 'grades'. */
  path: string;
  /** Audit entity name (table name). */
  entity: string;
  table: RefTable;
  input: I;
  orderBy: AnyColumn | SQL;
  toDto: (row: Row) => unknown;
  /** Map validated input to column values. */
  toValues?: (input: z.infer<I>) => Record<string, unknown>;
  /** Extra checks (e.g. department cycles). Throw AppError to reject. */
  check?: (
    ctx: RequestContext & { user: AuthedUser },
    input: z.infer<I>,
    id?: string,
  ) => Promise<void>;
  writePermission?: PermissionKey;
}

const idParams = { params: z.object({ id: z.uuid() }) };
const listQuery = { query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) };

/**
 * List / create / replace / archive for simple reference tables (branches, grades, …).
 * Reads are open to any signed-in user (needed for dropdowns); writes need `org.manage`.
 * No hard delete: employees reference these rows, so they are archived instead.
 */
export function refCrudRoutes<I extends z.ZodType>(cfg: RefConfig<I>): Router {
  const router = Router();
  const write = requirePermission(cfg.writePermission ?? 'org.manage', 'all');
  const toValues = cfg.toValues ?? ((v: z.infer<I>) => v as Record<string, unknown>);
  const bodySchemas = { body: cfg.input };
  const updateSchemas = { ...idParams, body: cfg.input };
  const archiveSchemas = { ...idParams, body: archiveSchema };
  const base = `/${cfg.path}`;

  async function getRow(db: RequestContext['db'], id: string): Promise<Row> {
    const [row] = await db
      .select()
      .from(cfg.table as PgTable)
      .where(eq(cfg.table.id, id));
    if (!row) throw AppError.notFound('Not found');
    return row as Row;
  }

  router.get(base, validate(listQuery), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, listQuery);
    const rows = await ctx.db
      .select()
      .from(cfg.table as PgTable)
      .where(query.includeArchived === 'true' ? undefined : isNull(cfg.table.archivedAt))
      .orderBy(cfg.orderBy as SQL, asc(cfg.table.id));
    res.json(ok(rows.map((r) => cfg.toDto(r as Row))));
  });

  router.post(base, write, validate(bodySchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, bodySchemas);
    await cfg.check?.(ctx, body);
    const row = await withAudit(ctx.db, ctx.actor, cfg.entity, async (tx) => {
      const [created] = await tx
        .insert(cfg.table)
        .values({ ...toValues(body), createdBy: ctx.user.id, updatedBy: ctx.user.id } as never)
        .returning();
      const r = created as Row;
      return { action: 'create', entityId: r.id, after: r, result: r };
    });
    res.status(201).json(ok(cfg.toDto(row)));
  });

  router.put(`${base}/:id`, write, validate(updateSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, updateSchemas);
    const before = await getRow(ctx.db, params.id);
    await cfg.check?.(ctx, body, params.id);
    const row = await withAudit(ctx.db, ctx.actor, cfg.entity, async (tx) => {
      const [updated] = await tx
        .update(cfg.table)
        .set({ ...toValues(body), updatedBy: ctx.user.id, updatedAt: new Date() } as never)
        .where(eq(cfg.table.id, params.id))
        .returning();
      return {
        action: 'update',
        entityId: params.id,
        before,
        after: updated,
        result: updated as Row,
      };
    });
    res.json(ok(cfg.toDto(row)));
  });

  router.patch(`${base}/:id/archive`, write, validate(archiveSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, archiveSchemas);
    const before = await getRow(ctx.db, params.id);
    const row = await withAudit(ctx.db, ctx.actor, cfg.entity, async (tx) => {
      const [updated] = await tx
        .update(cfg.table)
        .set({
          archivedAt: body.archived ? new Date() : null,
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        } as never)
        .where(eq(cfg.table.id, params.id))
        .returning();
      return {
        action: body.archived ? 'archive' : 'restore',
        entityId: params.id,
        before,
        after: updated,
        result: updated as Row,
      };
    });
    res.json(ok(cfg.toDto(row)));
  });

  return router;
}
