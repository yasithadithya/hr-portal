import type { RequestHandler } from 'express';

import type { TenantConnection } from '@hr/control-db';

import '../context';
import type { JobQueue } from '../jobs/queue';
import { supabaseAuthAdmin, type AuthAdmin } from '../lib/authAdmin';
import { AppError } from '../lib/errors';
import { supabaseStorage, type Storage } from '../lib/storage';
import type { TenantRegistry } from '../tenancy/registry';

export type AuthAdminFactory = (conn: TenantConnection) => AuthAdmin;
export type StorageFactory = (conn: TenantConnection) => Storage;

/** No queue configured: jobs are dropped (in-app notifications are still stored). */
const noJobs: JobQueue = { send: async () => {} };

const defaultAuthAdmin: AuthAdminFactory = (conn) =>
  supabaseAuthAdmin(conn.supabaseUrl, conn.serviceRoleKey);

/**
 * Resolves the tenant from the request host before anything else (CLAUDE.md Hard Rule 4).
 * `req.hostname` honours X-Forwarded-Host when `trust proxy` is set; the web app proxies `/api/*`
 * so the browser's host (acme.hrportal.lk) is what we see. Unknown host → 404 before auth.
 */
export function tenantMiddleware(
  registry: TenantRegistry,
  opts: {
    authAdmin?: AuthAdminFactory | undefined;
    storage?: StorageFactory | undefined;
    jobs?: JobQueue | undefined;
  } = {},
): RequestHandler {
  const authAdminFactory = opts.authAdmin ?? defaultAuthAdmin;
  const storageFactory =
    opts.storage ??
    ((conn: TenantConnection) => supabaseStorage(conn.supabaseUrl, conn.serviceRoleKey));
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
    let admin: AuthAdmin | undefined;
    let storage: Storage | undefined;
    req.ctx = {
      tenant: resolved.tenant,
      db: registry.db(resolved),
      supabase: { url: supabaseUrl, anonKey, jwksUrl },
      authAdmin: () => (admin ??= authAdminFactory(resolved.connection)),
      storage: () => (storage ??= storageFactory(resolved.connection)),
      permissions: {},
      jobs: opts.jobs ?? noJobs,
      actor: {
        userId: null,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        requestId: typeof req.id === 'string' ? req.id : null,
      },
    };
    next();
  };
}
