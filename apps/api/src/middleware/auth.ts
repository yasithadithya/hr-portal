import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';

import { findAppUserByAuthId, loadPermissions, schema } from '@hr/db';
import { scopeCovers, type PermissionKey, type Scope } from '@hr/shared';

import { ctxOf } from '../context';
import { AppError } from '../lib/errors';
import { bearerToken, verifySupabaseToken, type JwksResolver } from '../lib/jwt';

const LAST_LOGIN_RESOLUTION_MS = 60 * 60_000;

export const MFA_SETTING_KEY = 'security.mfa_required';

/**
 * Verifies the tenant's Supabase JWT, links it to `app_users`, and loads effective permissions.
 * Tokens from another tenant's project fail the JWKS/issuer check; a valid token for a user who
 * isn't in this tenant's `app_users` gets 403.
 */
export function authenticate(opts: { jwks?: JwksResolver | undefined } = {}): RequestHandler {
  return async (req, _res, next) => {
    const ctx = ctxOf(req);
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    if (!ctx.supabase.jwksUrl) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Auth is not configured for this workspace');
    }
    const claims = await verifySupabaseToken(token, ctx.supabase.jwksUrl, opts.jwks, {
      issuer: ctx.supabase.url ? `${ctx.supabase.url.replace(/\/$/, '')}/auth/v1` : undefined,
    });

    const user = await findAppUserByAuthId(ctx.db, claims.sub);
    if (!user) throw AppError.forbidden('You do not have access to this workspace');
    if (user.status === 'disabled') throw AppError.forbidden('Your access has been disabled');

    // MFA (tenant setting): require an aal2 session.
    const [mfa] = await ctx.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, MFA_SETTING_KEY));
    if (mfa?.value === true && claims.aal !== 'aal2') {
      throw new AppError(403, 'MFA_REQUIRED', 'Two-factor authentication is required');
    }

    // First login links the invite; afterwards keep last_login_at roughly current.
    const stale =
      !user.lastLoginAt || Date.now() - user.lastLoginAt.getTime() > LAST_LOGIN_RESOLUTION_MS;
    if (user.status === 'invited' || stale) {
      await ctx.db
        .update(schema.appUsers)
        .set({ status: 'active', lastLoginAt: new Date() })
        .where(eq(schema.appUsers.id, user.id));
    }

    ctx.user = {
      id: user.id,
      authUserId: claims.sub,
      email: user.email,
      employeeId: user.employeeId,
    };
    ctx.permissions = await loadPermissions(ctx.db, user.id);
    ctx.actor = { ...ctx.actor, userId: user.id };
    next();
  };
}

/** 403 unless the user holds `key` with at least `minScope`. */
export function requirePermission(key: PermissionKey, minScope: Scope = 'self'): RequestHandler {
  return (req, _res, next) => {
    const granted = ctxOf(req).permissions[key];
    if (!granted || !scopeCovers(granted, minScope)) {
      throw AppError.forbidden(`Missing permission ${key}`);
    }
    next();
  };
}
