import { createApp } from './app';
import { loadEnv } from './env';
import { createLogger } from './lib/logger';

const env = loadEnv();
const logger = createLogger(env);
const app = createApp({ env, logger, version: process.env.npm_package_version ?? '0.0.0' });

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
