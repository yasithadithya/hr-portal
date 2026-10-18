import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, z } from 'zod';

import { fail } from '@hr/shared/envelope';

import { AppError } from '../lib/errors';
import { reportError } from '../lib/reporter';

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json(fail('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

interface PgError {
  code: string;
  constraint_name?: string;
  detail?: string;
}

/** Finds a Postgres error anywhere in the cause chain (drizzle wraps driver errors). */
function findPgError(err: unknown): PgError | null {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (
      typeof e === 'object' &&
      'code' in e &&
      typeof e.code === 'string' &&
      /^\d{5}$|^[0-9A-Z]{5}$/.test(e.code)
    ) {
      return e as PgError;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** Constraint violations are client errors with a stable code, not 500s. */
function pgToAppError(pg: PgError): AppError | null {
  switch (pg.code) {
    case '23505':
      return new AppError(409, 'CONFLICT', 'A record with the same code or name already exists', {
        constraint: pg.constraint_name,
      });
    case '23503':
      return new AppError(
        400,
        'BAD_REQUEST',
        'A referenced record does not exist or is still in use',
        {
          constraint: pg.constraint_name,
        },
      );
    case '23514':
    case '23502':
      return new AppError(400, 'BAD_REQUEST', 'The data breaks a validation rule', {
        constraint: pg.constraint_name,
      });
    case '22P02':
      return new AppError(400, 'BAD_REQUEST', 'Invalid value format');
    default:
      return null;
  }
}

export function errorHandler(opts: { exposeInternal: boolean }): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json(fail(err.code, err.message, err.details));
      return;
    }
    const pg = findPgError(err);
    const mapped = pg ? pgToAppError(pg) : null;
    if (mapped) {
      res.status(mapped.status).json(fail(mapped.code, mapped.message, mapped.details));
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

    req.log.error({ err, tenant: req.ctx?.tenant.slug }, 'Unhandled error');
    reportError(err, {
      tenant: req.ctx?.tenant.slug,
      requestId: typeof req.id === 'string' ? req.id : null,
    });
    const message =
      opts.exposeInternal && err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json(fail('INTERNAL_ERROR', message));
  };
}
