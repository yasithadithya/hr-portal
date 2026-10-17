import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, z } from 'zod';

import { fail } from '@hr/shared/envelope';

import { AppError } from '../lib/errors';

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json(fail('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

export function errorHandler(opts: { exposeInternal: boolean }): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json(fail(err.code, err.message, err.details));
      return;
    }
    if (err instanceof ZodError) {
      res
        .status(400)
        .json(fail('VALIDATION_ERROR', 'Request validation failed', z.treeifyError(err)));
      return;
    }
    if (isBodyParserError(err) && err.status >= 400 && err.status < 500) {
      res.status(err.status).json(fail('BAD_REQUEST', `Malformed request (${err.type})`));
      return;
    }

    req.log.error({ err }, 'Unhandled error');
    const message =
      opts.exposeInternal && err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json(fail('INTERNAL_ERROR', message));
  };
}
