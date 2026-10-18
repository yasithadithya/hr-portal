import type { Tenant } from '@hr/control-db';
import type { Actor, TenantDb } from '@hr/db';
import type { PermissionKey, PermissionMap, Scope } from '@hr/shared';

import type { JobQueue } from './jobs/queue';
import type { AuthAdmin } from './lib/authAdmin';
import type { Storage } from './lib/storage';

export interface AuthedUser {
  id: string;
  authUserId: string;
  email: string;
  employeeId: string | null;
}

/**
 * Per-request context (CLAUDE.md Hard Rule 4). Handlers use `req.ctx.db` only.
 * `user`/`permissions` are set by `authenticate`.
 */
export interface RequestContext {
  tenant: Tenant;
  db: TenantDb;
  supabase: { url: string | null; anonKey: string | null; jwksUrl: string | null };
  /** Supabase Auth admin for this tenant's project (service-role key; server only). */
  authAdmin: () => AuthAdmin;
  /** Private file storage in the tenant's project (signed URLs only). */
  storage: () => Storage;
  user?: AuthedUser;
  permissions: PermissionMap;
  /** Background jobs (payloads always carry tenantId). */
  jobs: JobQueue;
  /** Who/where for audit_log rows. */
  actor: Actor;
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

/** Context of an authenticated request (route is behind `authenticate`). */
export function authedCtx(req: Express.Request): RequestContext & { user: AuthedUser } {
  const ctx = ctxOf(req);
  if (!ctx.user) throw new Error('User missing: route is not behind authenticate');
  return ctx as RequestContext & { user: AuthedUser };
}

/** The scope the user holds for a permission (route must have checked it with requirePermission). */
export function scopeOf(req: Express.Request, key: PermissionKey): Scope {
  const scope = ctxOf(req).permissions[key];
  if (!scope) throw new Error(`scopeOf(${key}) on a route without requirePermission(${key})`);
  return scope;
}
