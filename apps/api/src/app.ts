import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { ControlDb } from '@hr/control-db';

import type { Env } from './env';
import type { JwksResolver } from './lib/jwt';
import { allowlistOrigins, corsMiddleware, type OriginCheck } from './middleware/cors';
import { errorHandler, notFound } from './middleware/errors';
import { requestLogger } from './middleware/requestLogger';
import { tenantMiddleware } from './middleware/tenant';
import { healthRoutes } from './modules/health/routes';
import { platformRoutes } from './modules/platform/routes';
import { publicRoutes } from './modules/public/routes';
import type { PoolManager } from './tenancy/pools';
import type { TenantRegistry } from './tenancy/registry';

export interface TenancyDeps {
  control: ControlDb;
  registry: TenantRegistry;
  pools: PoolManager;
  platformJwksUrl: string | null;
  /** Tests inject a local key set; production fetches each project's JWKS. */
  jwks?: JwksResolver;
}

export interface AppOptions {
  env: Env;
  logger: Logger;
  version?: string;
  isOriginAllowed?: OriginCheck;
  tenancy?: TenancyDeps;
  /** Extra tenant-scoped routes under /api/v1 (tests). */
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
    api.use(tenantMiddleware(tenancy.registry));
    api.use(publicRoutes());
    mountTenant?.(api);
    app.use('/api/v1', api);
  }

  mount?.(app);

  app.use(notFound);
  app.use(errorHandler({ exposeInternal: env.NODE_ENV !== 'production' }));

  return app;
}
