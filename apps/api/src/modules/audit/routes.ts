import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';

import { schema } from '@hr/db';
import { auditQuerySchema, ok, type AuditEntry } from '@hr/shared';

import { authedCtx } from '../../context';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';

const { auditLog, appUsers } = schema;
const querySchemas = { query: auditQuerySchema };

export function auditRoutes(): Router {
  const router = Router();

  router.get(
    '/audit-log',
    requirePermission('audit.read', 'all'),
    validate(querySchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { query: q } = parsed(req, querySchemas);
      const where: SQL[] = [];
      if (q.entity) where.push(eq(auditLog.entity, q.entity));
      if (q.entityId) where.push(eq(auditLog.entityId, q.entityId));
      if (q.actorUserId) where.push(eq(auditLog.actorUserId, q.actorUserId));
      if (q.cursor) {
        // Keyset pagination on (at, id), compared in SQL against the cursor row itself so
        // microsecond timestamps and ties are exact.
        where.push(
          sql`(${auditLog.at}, ${auditLog.id}) < (select c.at, c.id from audit_log c where c.id = ${q.cursor}::uuid)`,
        );
      }

      const rows = await ctx.db
        .select({ log: auditLog, actorEmail: appUsers.email })
        .from(auditLog)
        .leftJoin(appUsers, eq(appUsers.id, auditLog.actorUserId))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(q.limit + 1);

      const page = rows.slice(0, q.limit);
      const items: AuditEntry[] = page.map(({ log, actorEmail }) => ({
        id: log.id,
        actorUserId: log.actorUserId,
        actorEmail,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        before: log.before,
        after: log.after,
        ip: log.ip,
        at: log.at.toISOString(),
      }));
      res.json(
        ok({
          items,
          nextCursor: rows.length > q.limit && page.length ? page.at(-1)!.log.id : null,
        }),
      );
    },
  );

  return router;
}
