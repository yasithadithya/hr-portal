import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

/** pino-http with a request id: reuse a safe incoming `x-request-id`, else generate one. */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  });
}
