import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';

export interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

type Parsed<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.infer<S[K]> : never;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented augmentation point
  namespace Express {
    interface Request {
      valid?: Partial<Record<keyof RequestSchemas, unknown>>;
    }
  }
}

/**
 * Validates body/query/params with Zod. A ZodError goes to the error handler (400 envelope).
 * Parsed values live on `req.valid` because Express 5 makes `req.query` read-only.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const valid: NonNullable<Request['valid']> = {};
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (schema) valid[key] = schema.parse(req[key] ?? {});
    }
    req.valid = valid;
    next();
  };
}

/** Typed access to values parsed by `validate(schemas)` with the same schemas object. */
export function parsed<S extends RequestSchemas>(req: Request, _schemas: S): Parsed<S> {
  if (!req.valid) throw new Error('parsed() called on a route without validate()');
  return req.valid as Parsed<S>;
}
