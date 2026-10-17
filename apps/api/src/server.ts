import './dotenv';

import { controlDb, parseMasterKey } from '@hr/control-db';
import { connect } from '@hr/db';

import { createApp } from './app';
import { loadEnv } from './env';
import { createLogger } from './lib/logger';
import { PoolManager } from './tenancy/pools';
import { TenantRegistry } from './tenancy/registry';

const env = loadEnv();
const logger = createLogger(env);

if (!env.CONTROL_DATABASE_URL) throw new Error('CONTROL_DATABASE_URL is required');
const controlSql = connect(env.CONTROL_DATABASE_URL, { max: 5 });
const control = controlDb(controlSql);
const pools = new PoolManager({
  maxPools: env.TENANT_MAX_POOLS,
  connectionsPerPool: env.TENANT_POOL_SIZE,
  idleMs: env.TENANT_POOL_IDLE_MS,
});
pools.startSweeper();
const registry = new TenantRegistry({ control, masterKey: parseMasterKey(env.MASTER_KEY), pools });

const app = createApp({
  env,
  logger,
  version: process.env.npm_package_version ?? '0.0.0',
  tenancy: {
    control,
    registry,
    pools,
    platformJwksUrl: env.CONTROL_SUPABASE_URL
      ? `${env.CONTROL_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
      : null,
  },
});

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void Promise.all([pools.closeAll(), controlSql.end({ timeout: 5 })]).finally(() =>
      process.exit(0),
    );
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
