import type { RequestHandler } from 'express';

import '../context';
import { AppError } from '../lib/errors';
import type { TenantRegistry } from '../tenancy/registry';

/**
 * Resolves the tenant from the request host before anything else (CLAUDE.md Hard Rule 4).
 * `req.hostname` honours X-Forwarded-Host when `trust proxy` is set; the web app proxies `/api/*`
 * so the browser's host (acme.hrportal.lk) is what we see. Unknown host → 404 before auth.
 */
export function tenantMiddleware(registry: TenantRegistry): RequestHandler {
  return async (req, _res, next) => {
    const resolved = await registry.resolve(req.hostname ?? '');
    if (
      !resolved ||
      resolved.tenant.status === 'archived' ||
      resolved.tenant.status === 'provisioning'
    ) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Unknown workspace');
    }
    if (resolved.tenant.status === 'suspended') {
      throw new AppError(403, 'FORBIDDEN', 'This workspace is suspended. Contact support.');
    }
    const { supabaseUrl, anonKey, jwksUrl } = resolved.connection;
    req.ctx = {
      tenant: resolved.tenant,
      db: registry.db(resolved),
      supabase: { url: supabaseUrl, anonKey, jwksUrl },
    };
    next();
  };
}
