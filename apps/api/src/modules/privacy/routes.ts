import { eq } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { schema, withAudit } from '@hr/db';
import { ok } from '@hr/shared';

import { authedCtx } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { getSettings } from '../company/routes';
import { tenantToday } from '../employees/service';

import { anonymizeEmployee, dataExport, retentionCandidates } from './service';

const { appUsers } = schema;
const idParams = { params: z.object({ id: z.uuid() }) };

export function privacyRoutes(): Router {
  const router = Router();
  const admin = requirePermission('settings.manage', 'all');

  /** The tenant's privacy notice and whether this user has acknowledged the current version. */
  router.get('/privacy', async (req, res) => {
    const ctx = authedCtx(req);
    const s = await getSettings(ctx.db);
    const [u] = await ctx.db
      .select({ v: appUsers.privacyAckVersion, at: appUsers.privacyAckAt })
      .from(appUsers)
      .where(eq(appUsers.id, ctx.user.id));
    res.json(
      ok({
        notice: s['privacy.notice'],
        version: s['privacy.notice_version'],
        acknowledgedVersion: u?.v ?? null,
        acknowledgedAt: u?.at?.toISOString() ?? null,
        mustAcknowledge: !!s['privacy.notice'] && (u?.v ?? 0) < s['privacy.notice_version'],
      }),
    );
  });

  const ackSchemas = { body: z.object({ version: z.number().int().min(1) }) };
  router.post('/privacy/acknowledge', validate(ackSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, ackSchemas);
    const s = await getSettings(ctx.db);
    if (body.version !== s['privacy.notice_version'])
      throw AppError.badRequest('The privacy notice has changed — reload and read it again');
    await withAudit(ctx.db, ctx.actor, 'app_users', async (tx) => {
      await tx
        .update(appUsers)
        .set({ privacyAckVersion: body.version, privacyAckAt: new Date() })
        .where(eq(appUsers.id, ctx.user.id));
      return {
        action: 'privacy_acknowledged',
        entityId: ctx.user.id,
        after: { version: body.version },
        result: null,
      };
    });
    res.json(ok({ acknowledgedVersion: body.version }));
  });

  // ── Data-subject access ────────────────────────────────────────────────────
  const send = async (ctx: ReturnType<typeof authedCtx>, res: Response, employeeId: string) => {
    const data = await dataExport(ctx.db, employeeId);
    if (!data) throw AppError.notFound('Employee not found');
    await withAudit(ctx.db, ctx.actor, 'employees', async () => ({
      action: 'data_export',
      entityId: employeeId,
      result: null,
    }));
    res
      .type('application/json')
      .attachment(`personal-data-${data.employee.employeeNo}.json`)
      .send(JSON.stringify({ success: true, data }, null, 2));
  };

  router.get('/me/data-export', async (req, res) => {
    const ctx = authedCtx(req);
    if (!ctx.user.employeeId)
      throw AppError.badRequest('Your account is not linked to an employee');
    await send(ctx, res, ctx.user.employeeId);
  });

  router.get(
    '/employees/:id/data-export',
    requirePermission('employees.update', 'all'),
    validate(idParams),
    async (req, res) => {
      await send(authedCtx(req), res, parsed(req, idParams).params.id);
    },
  );

  // ── Retention ──────────────────────────────────────────────────────────────
  router.get('/privacy/retention', admin, async (req, res) => {
    const ctx = authedCtx(req);
    const s = await getSettings(ctx.db);
    const years = s['privacy.retention_years_after_exit'];
    res.json(
      ok({
        years,
        due: years ? await retentionCandidates(ctx.db, tenantToday(ctx), years) : [],
      }),
    );
  });

  /** Run now (the daily job does the same). Requires the retention setting. */
  router.post('/privacy/retention/run', admin, async (req, res) => {
    const ctx = authedCtx(req);
    const s = await getSettings(ctx.db);
    const years = s['privacy.retention_years_after_exit'];
    if (!years) throw AppError.badRequest('Set a retention period first (Settings → Privacy)');
    const due = await retentionCandidates(ctx.db, tenantToday(ctx), years);
    let files = 0;
    for (const d of due)
      files += (await anonymizeEmployee(ctx.db, ctx.actor, d.id, ctx.storage())).files;
    res.json(ok({ anonymized: due.length, filesRemoved: files }));
  });

  return router;
}
