import './dotenv';

import { controlDb, parseMasterKey } from '@hr/control-db';
import { connect } from '@hr/db';

import { createApp } from './app';
import { loadEnv, type Env } from './env';
import { createJobHandlers } from './jobs/handlers';
import { InlineQueue, PgBossQueue, type JobQueue } from './jobs/queue';
import { logSender, resendSender, smtpSender, type EmailSender } from './lib/email';
import { createLogger } from './lib/logger';
import { webPushSender } from './lib/push';
import { initReporter } from './lib/reporter';
import { supabaseStorage } from './lib/storage';
import { PoolManager } from './tenancy/pools';
import { TenantRegistry } from './tenancy/registry';

const env = loadEnv();
const logger = createLogger(env);
initReporter({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  release: process.env.npm_package_version ?? '0.0.0',
});

if (!env.CONTROL_DATABASE_URL) throw new Error('CONTROL_DATABASE_URL is required');
const controlSql = connect(env.CONTROL_DATABASE_URL, { max: 5 });
const control = controlDb(controlSql);
const pools = new PoolManager({
  maxPools: env.TENANT_MAX_POOLS,
  connectionsPerPool: env.TENANT_POOL_SIZE,
  idleMs: env.TENANT_POOL_IDLE_MS,
});
pools.startSweeper();
const masterKey = parseMasterKey(env.MASTER_KEY);
const registry = new TenantRegistry({ control, masterKey, pools });

function emailSender(e: Env): EmailSender {
  if (e.EMAIL_PROVIDER === 'smtp') {
    if (!e.SMTP_URL) throw new Error('EMAIL_PROVIDER=smtp needs SMTP_URL');
    return smtpSender(e.SMTP_URL, e.EMAIL_FROM);
  }
  if (e.EMAIL_PROVIDER === 'resend') {
    if (!e.RESEND_API_KEY) throw new Error('EMAIL_PROVIDER=resend needs RESEND_API_KEY');
    return resendSender(e.RESEND_API_KEY, e.EMAIL_FROM);
  }
  return logSender(logger);
}

// The handlers enqueue follow-up jobs, so they get a forwarding queue filled in below.
let queue: JobQueue = new InlineQueue();
const jobs: JobQueue = { send: (...a) => queue.send(...a) };
const handlers = createJobHandlers({
  control,
  pools,
  masterKey,
  email: emailSender(env),
  push: webPushSender(),
  jobs,
  logger,
  appBaseUrl: env.APP_BASE_URL,
  storage: (conn) => supabaseStorage(conn.supabaseUrl, conn.serviceRoleKey),
  pushSubject: `mailto:${/<([^>]+)>/.exec(env.EMAIL_FROM)?.[1] ?? env.EMAIL_FROM}`,
});
let boss: PgBossQueue | null = null;
if (env.JOBS_ENABLED) {
  boss = await PgBossQueue.start({
    connectionString: env.JOBS_DATABASE_URL ?? env.CONTROL_DATABASE_URL,
    handlers,
    logger,
    dailyCron: env.JOBS_DAILY_CRON,
  });
  queue = boss;
} else {
  // No worker: run jobs in-process (single-instance dev only).
  (queue as InlineQueue).register(handlers);
}

const app = createApp({
  env,
  logger,
  version: process.env.npm_package_version ?? '0.0.0',
  tenancy: {
    control,
    registry,
    pools,
    jobs,
    masterKey,
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
    void Promise.all([boss?.stop(), pools.closeAll(), controlSql.end({ timeout: 5 })]).finally(() =>
      process.exit(0),
    );
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
