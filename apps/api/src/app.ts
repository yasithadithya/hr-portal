import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { ControlDb } from '@hr/control-db';

import type { Env } from './env';
import type { JobQueue } from './jobs/queue';
import type { JwksResolver } from './lib/jwt';
import { authenticate } from './middleware/auth';
import { allowlistOrigins, corsMiddleware, type OriginCheck } from './middleware/cors';
import { errorHandler, notFound } from './middleware/errors';
import { requestLogger } from './middleware/requestLogger';
import { tenantMiddleware, type AuthAdminFactory, type StorageFactory } from './middleware/tenant';
import { attendanceRoutes } from './modules/attendance/routes';
import { auditRoutes } from './modules/audit/routes';
import { companyRoutes } from './modules/company/routes';
import { employeeRoutes } from './modules/employees/routes';
import { healthRoutes } from './modules/health/routes';
import { importRoutes } from './modules/imports/routes';
import { leaveRoutes } from './modules/leave/routes';
import { meRoutes } from './modules/me/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { orgRoutes } from './modules/org/routes';
import { payrollConfigRoutes } from './modules/payroll/config';
import { payrollRunRoutes } from './modules/payroll/routes';
import { payrollSetupRoutes } from './modules/payroll/setup';
import { platformRoutes } from './modules/platform/routes';
import { publicRoutes } from './modules/public/routes';
import { roleRoutes } from './modules/roles/routes';
import { selfServiceRoutes } from './modules/selfservice/routes';
import { userRoutes } from './modules/users/routes';
import type { PoolManager } from './tenancy/pools';
import type { TenantRegistry } from './tenancy/registry';

export interface TenancyDeps {
  control: ControlDb;
  registry: TenantRegistry;
  pools: PoolManager;
  platformJwksUrl: string | null;
  /** Tests inject a local key set; production fetches each project's JWKS. */
  jwks?: JwksResolver;
  /** Tests inject a fake Supabase Auth admin (invites). */
  authAdmin?: AuthAdminFactory;
  /** Tests inject in-memory storage. */
  storage?: StorageFactory;
  /** Decrypts tenant secrets (VAPID keys for web push). */
  masterKey: Buffer;
  /** Background job queue (pg-boss in production, inline in tests). */
  jobs?: JobQueue;
}

export interface AppOptions {
  env: Env;
  logger: Logger;
  version?: string;
  isOriginAllowed?: OriginCheck;
  tenancy?: TenancyDeps;
  /** Extra tenant-scoped, unauthenticated routes under /api/v1 (tests). */
  mountTenantPublic?: (router: Router) => void;
  /** Extra tenant-scoped, authenticated routes under /api/v1 (tests). */
  mountTenant?: (router: Router) => void;
  /** Extra routes mounted before the 404 handler (tests). */
  mount?: (app: Express) => void;
}

export function createApp({
  env,
  logger,
  version = '0.0.0',
  isOriginAllowed,
  tenancy,
  mountTenantPublic,
  mountTenant,
  mount,
}: AppOptions) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsMiddleware(isOriginAllowed ?? allowlistOrigins(env.CORS_ORIGINS)));
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRoutes(version));

  if (tenancy) {
    app.use(
      '/platform/v1',
      platformRoutes({
        control: tenancy.control,
        registry: tenancy.registry,
        pools: tenancy.pools,
        jwksUrl: tenancy.platformJwksUrl,
        jwks: tenancy.jwks,
      }),
    );

    // Everything under /api/v1 is tenant-scoped: unknown host → 404 before auth.
    const api = Router();
    api.use(
      tenantMiddleware(tenancy.registry, {
        authAdmin: tenancy.authAdmin,
        storage: tenancy.storage,
        jobs: tenancy.jobs,
      }),
    );
    api.use(publicRoutes());
    mountTenantPublic?.(api);

    // Everything below requires a signed-in user of this workspace.
    api.use(authenticate({ jwks: tenancy.jwks }));
    api.use(meRoutes());
    api.use(userRoutes());
    api.use(roleRoutes());
    api.use(auditRoutes());
    api.use(employeeRoutes());
    api.use(companyRoutes());
    api.use(orgRoutes());
    api.use(importRoutes());
    api.use(leaveRoutes());
    api.use(attendanceRoutes());
    api.use(payrollConfigRoutes());
    api.use(payrollSetupRoutes());
    api.use(payrollRunRoutes());
    api.use(notificationRoutes({ control: tenancy.control, masterKey: tenancy.masterKey }));
    api.use(selfServiceRoutes());
    mountTenant?.(api);
    app.use('/api/v1', api);
  }

  mount?.(app);

  app.use(notFound);
  app.use(errorHandler({ exposeInternal: env.NODE_ENV !== 'production' }));

  return app;
}
