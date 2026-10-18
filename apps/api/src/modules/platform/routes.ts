import { sql } from 'drizzle-orm';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import {
  findTenantBySlug,
  isPlatformAdmin,
  listProvisioningEvents,
  listTenantDomains,
  listTenantMigrations,
  listTenants,
  getTenantConnection,
  listBillingSnapshots,
  listPlans,
  setPlanPrice,
  setTenantStatus,
  upsertBillingSnapshot,
  type ControlDb,
  type Tenant,
} from '@hr/control-db';
import { csvCell, ok, setTenantStatusSchema, type PlatformTenant } from '@hr/shared';
import { money } from '@hr/shared/money';
import { monthRange } from '@hr/shared/time';

import { AppError } from '../../lib/errors';
import { bearerToken, verifySupabaseToken, type JwksResolver } from '../../lib/jwt';
import { parsed, validate } from '../../middleware/validate';
import type { PoolManager } from '../../tenancy/pools';
import type { TenantRegistry } from '../../tenancy/registry';

const CRLF = String.fromCharCode(13, 10);

export interface PlatformDeps {
  control: ControlDb;
  registry: TenantRegistry;
  pools: PoolManager;
  /** JWKS of the control-plane Supabase project; platform admins log in there. */
  jwksUrl: string | null;
  jwks?: JwksResolver | undefined;
  /** Decrypts tenant secrets (billing counts read each tenant DB). */
  masterKey: Buffer;
}

/** Separate from tenant auth: a control-plane JWT whose email is in platform.platform_admins. */
function platformAuth(deps: PlatformDeps): RequestHandler {
  return async (req, _res, next) => {
    if (!deps.jwksUrl) throw new AppError(404, 'NOT_FOUND', 'Platform API is not configured');
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token');
    const claims = await verifySupabaseToken(token, deps.jwksUrl, deps.jwks);
    if (!claims.email || !(await isPlatformAdmin(deps.control, claims.email))) {
      throw AppError.forbidden('Not a platform admin');
    }
    req.platformAdmin = { email: claims.email };
    next();
  };
}

async function toDto(control: ControlDb, t: Tenant): Promise<PlatformTenant> {
  const domains = await listTenantDomains(control, t.id);
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    region: t.region,
    timezone: t.timezone,
    supabaseProjectRef: t.supabaseProjectRef,
    createdAt: t.createdAt.toISOString(),
    domains: domains.map((d) => d.host),
  };
}

const slugParams = { params: z.object({ slug: z.string().min(1).max(40) }) };
const statusSchemas = { ...slugParams, body: setTenantStatusSchema };

export function platformRoutes(deps: PlatformDeps): Router {
  const router = Router();
  router.use(platformAuth(deps));

  async function tenantOr404(slug: string) {
    const t = await findTenantBySlug(deps.control, slug);
    if (!t) throw AppError.notFound('Tenant not found');
    return t;
  }

  router.get('/tenants', async (_req, res) => {
    const rows = await listTenants(deps.control);
    res.json(ok(await Promise.all(rows.map((t) => toDto(deps.control, t)))));
  });

  router.get('/tenants/:slug', validate(slugParams), async (req, res) => {
    const t = await tenantOr404(parsed(req, slugParams).params.slug);
    res.json(ok(await toDto(deps.control, t)));
  });

  router.patch('/tenants/:slug/status', validate(statusSchemas), async (req, res) => {
    const { params, body } = parsed(req, statusSchemas);
    const t = await tenantOr404(params.slug);
    const updated = await setTenantStatus(deps.control, t.id, body.status);
    deps.registry.invalidate(t.id);
    if (body.status === 'suspended') await deps.pools.close(t.id);
    req.log.info(
      { tenant: t.slug, status: body.status, by: req.platformAdmin?.email },
      'tenant status changed',
    );
    res.json(ok(await toDto(deps.control, updated!)));
  });

  router.get('/tenants/:slug/provisioning', validate(slugParams), async (req, res) => {
    const t = await tenantOr404(parsed(req, slugParams).params.slug);
    const events = await listProvisioningEvents(deps.control, t.id);
    res.json(ok(events.map((e) => ({ ...e, at: e.at.toISOString() }))));
  });

  router.get('/tenants/:slug/migrations', validate(slugParams), async (req, res) => {
    const t = await tenantOr404(parsed(req, slugParams).params.slug);
    const rows = await listTenantMigrations(deps.control, t.id);
    res.json(ok(rows.map((r) => ({ ...r, appliedAt: r.appliedAt.toISOString() }))));
  });

  router.get('/pools', (_req, res) => {
    res.json(ok(deps.pools.getMetrics()));
  });

  /** Background job health: counts per queue and state (failed jobs need attention). */
  router.get('/jobs', async (_req, res) => {
    try {
      const rows = await deps.control.execute<{ name: string; state: string; n: number }>(
        sql`select name, state, count(*)::int as n from pgboss.job group by 1, 2 order by 1, 2`,
      );
      const recentFailures = await deps.control.execute<{
        name: string;
        data: unknown;
        output: unknown;
        completed_on: string;
      }>(
        sql`select name, data, output, completed_on from pgboss.job where state = 'failed' order by completed_on desc nulls last limit 20`,
      );
      res.json(ok({ enabled: true, counts: [...rows], recentFailures: [...recentFailures] }));
    } catch {
      // pg-boss schema missing: the worker has never run against this database.
      res.json(ok({ enabled: false, counts: [], recentFailures: [] }));
    }
  });

  // ── Billing v1 (manual invoicing) ──────────────────────────────────────────
  router.get('/plans', async (_req, res) => {
    res.json(ok(await listPlans(deps.control)));
  });

  const priceSchemas = {
    params: z.object({ key: z.string().min(1).max(40) }),
    body: z.object({
      pricePerEmployee: z
        .string()
        .regex(/^\d{1,8}(\.\d{1,2})?$/)
        .nullable(),
      minimumMonthly: z
        .string()
        .regex(/^\d{1,8}(\.\d{1,2})?$/)
        .nullable(),
      currency: z.string().length(3).optional(),
    }),
  };
  router.put('/plans/:key', validate(priceSchemas), async (req, res) => {
    const { params, body } = parsed(req, priceSchemas);
    const p = await setPlanPrice(deps.control, params.key, body);
    if (!p) throw AppError.notFound('Plan not found');
    res.json(ok(p));
  });

  const monthSchemas = { body: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }) };
  /**
   * Counts each active tenant's billable employees for a month (employed at any point in it) and
   * stores the snapshot with the plan price at that moment. Re-running replaces the month.
   */
  router.post('/billing/snapshot', validate(monthSchemas), async (req, res) => {
    const { body } = parsed(req, monthSchemas);
    const [y, m] = body.month.split('-').map(Number) as [number, number];
    const { start, end } = monthRange(y, m);
    const plans = await listPlans(deps.control);
    const out = [];
    for (const t of await listTenants(deps.control, { status: 'active' })) {
      const conn = await getTenantConnection(deps.control, t, deps.masterKey);
      const db = deps.pools.get(t.id, conn.dbUrl);
      const [c] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from employees where archived_at is null
            and join_date <= ${end} and (exit_date is null or exit_date >= ${start})`,
      );
      const plan = plans.find((p) => p.id === t.planId) ?? null;
      const count = c?.n ?? 0;
      const amount = plan?.pricePerEmployee
        ? (() => {
            const byHead = money(plan.pricePerEmployee).times(count);
            const minimum = money(plan.minimumMonthly ?? '0');
            return (byHead.lessThan(minimum) ? minimum : byHead).toFixed(2);
          })()
        : null;
      out.push(
        await upsertBillingSnapshot(deps.control, {
          tenantId: t.id,
          month: body.month,
          activeEmployees: count,
          planKey: plan?.key ?? null,
          pricePerEmployee: plan?.pricePerEmployee ?? null,
          minimumMonthly: plan?.minimumMonthly ?? null,
          amount,
          currency: plan?.currency ?? 'LKR',
        }),
      );
    }
    res.json(ok(out));
  });

  const invoiceSchemas = {
    query: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  };
  /** Invoice lines for the month as CSV (for the accounting system / manual invoices). */
  router.get('/billing/invoices.csv', validate(invoiceSchemas), async (req, res) => {
    const { query } = parsed(req, invoiceSchemas);
    const rows = await listBillingSnapshots(deps.control, query.month);
    const lines = [
      [
        'Month',
        'Client',
        'Slug',
        'Plan',
        'Active employees',
        'Price per employee',
        'Minimum',
        'Amount',
        'Currency',
      ],
      ...rows.map(({ s, t }) => [
        s.month,
        t.name,
        t.slug,
        s.planKey ?? '',
        s.activeEmployees,
        s.pricePerEmployee ?? '',
        s.minimumMonthly ?? '',
        s.amount ?? 'price not set',
        s.currency,
      ]),
    ];
    res
      .type('text/csv; charset=utf-8')
      .attachment(`invoices-${query.month}.csv`)
      .send(
        `${String.fromCharCode(0xfeff)}${lines.map((l) => l.map(csvCell).join(',')).join(CRLF)}${CRLF}`,
      );
  });

  return router;
}
