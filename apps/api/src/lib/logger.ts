import { pino, type Logger } from 'pino';

import type { Env } from '../env';

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  });
}
