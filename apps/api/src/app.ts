import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { Env } from './env';
import { allowlistOrigins, corsMiddleware, type OriginCheck } from './middleware/cors';
import { errorHandler, notFound } from './middleware/errors';
import { requestLogger } from './middleware/requestLogger';
import { healthRoutes } from './modules/health/routes';

export interface AppOptions {
  env: Env;
  logger: Logger;
  version?: string;
  isOriginAllowed?: OriginCheck;
  /** Extra routes mounted before the 404 handler (used by tests). */
  mount?: (app: Express) => void;
}

export function createApp({ env, logger, version = '0.0.0', isOriginAllowed, mount }: AppOptions) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsMiddleware(isOriginAllowed ?? allowlistOrigins(env.CORS_ORIGINS)));
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRoutes(version));
  // Modules mount under /api/v1 from Phase 1 onwards: src/modules/<module>/{routes,service,repo}.ts
  mount?.(app);

  app.use(notFound);
  app.use(errorHandler({ exposeInternal: env.NODE_ENV !== 'production' }));

  return app;
}
