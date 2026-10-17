import type { Tenant } from '@hr/control-db';
import type { TenantDb } from '@hr/db';

/**
 * Per-request context (CLAUDE.md Hard Rule 4). Handlers use `req.ctx.db` only.
 * Phase 2 adds `user`, `employee` and `permissions`.
 */
export interface RequestContext {
  tenant: Tenant;
  db: TenantDb;
  supabase: { url: string | null; anonKey: string | null; jwksUrl: string | null };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented augmentation point
  namespace Express {
    interface Request {
      ctx?: RequestContext;
      platformAdmin?: { email: string };
    }
  }
}

/** Returns the tenant context or throws (programming error: route mounted without tenant middleware). */
export function ctxOf(req: Express.Request): RequestContext {
  if (!req.ctx) throw new Error('Tenant context missing: route is not behind tenantMiddleware');
  return req.ctx;
}
