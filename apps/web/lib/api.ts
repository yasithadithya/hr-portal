import { z } from 'zod';

import { failureSchema, successSchema, type ErrorCode } from '@hr/shared/envelope';

// Same-origin: Next rewrites /api/* to the Express API (see next.config.ts).
const API_URL = '';

const successEnvelope = successSchema(z.unknown());

/** Error thrown for any non-success envelope or unexpected response. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Typed fetch: validates the response envelope against a Zod schema from `@hr/shared`
 * and returns `data`, or throws `ApiError`.
 */
export async function apiRequest<T extends z.ZodType>(
  method: Method,
  path: string,
  schema: T,
  { body, signal, headers }: RequestOptions = {},
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('INTERNAL_ERROR', 'Could not reach the server', 0, err);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('INTERNAL_ERROR', `Unexpected response (HTTP ${res.status})`, res.status);
  }

  const failure = failureSchema.safeParse(json);
  if (failure.success) {
    const { code, message, details } = failure.data.error;
    throw new ApiError(code, message, res.status, details);
  }

  const envelope = successEnvelope.safeParse(json);
  const data = envelope.success ? schema.safeParse(envelope.data.data) : envelope;
  if (!data.success) {
    throw new ApiError(
      'INTERNAL_ERROR',
      'Response did not match the API contract',
      res.status,
      data.error,
    );
  }
  return data.data;
}

export const api = {
  get: <T extends z.ZodType>(path: string, schema: T, opts?: Omit<RequestOptions, 'body'>) =>
    apiRequest('GET', path, schema, opts),
  post: <T extends z.ZodType>(path: string, schema: T, body?: unknown, opts?: RequestOptions) =>
    apiRequest('POST', path, schema, { ...opts, body }),
  put: <T extends z.ZodType>(path: string, schema: T, body?: unknown, opts?: RequestOptions) =>
    apiRequest('PUT', path, schema, { ...opts, body }),
  patch: <T extends z.ZodType>(path: string, schema: T, body?: unknown, opts?: RequestOptions) =>
    apiRequest('PATCH', path, schema, { ...opts, body }),
  delete: <T extends z.ZodType>(path: string, schema: T, opts?: Omit<RequestOptions, 'body'>) =>
    apiRequest('DELETE', path, schema, opts),
};
