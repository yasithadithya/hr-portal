import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import {
  findTenantBySlug,
  isPlatformAdmin,
  listProvisioningEvents,
  listTenantDomains,
  listTenantMigrations,
  listTenants,
  setTenantStatus,
  type ControlDb,
  type Tenant,
} from '@hr/control-db';
import { ok, setTenantStatusSchema, type PlatformTenant } from '@hr/shared';

import { AppError } from '../../lib/errors';
import { bearerToken, verifySupabaseToken, type JwksResolver } from '../../lib/jwt';
import { parsed, validate } from '../../middleware/validate';
import type { PoolManager } from '../../tenancy/pools';
import type { TenantRegistry } from '../../tenancy/registry';

export interface PlatformDeps {
  control: ControlDb;
  registry: TenantRegistry;
  pools: PoolManager;
  /** JWKS of the control-plane Supabase project; platform admins log in there. */
  jwksUrl: string | null;
  jwks?: JwksResolver | undefined;
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

  return router;
}
