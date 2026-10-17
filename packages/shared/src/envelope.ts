import { z } from 'zod';

/** Standard API envelope (CLAUDE.md Hard Rule 6). */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'TENANT_NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const errorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

export const failureSchema = z.object({
  success: z.literal(false),
  error: errorBodySchema,
});

/** Builds a schema that parses `{ success: true, data } | { success: false, error }`. */
export function envelopeSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data }),
    failureSchema,
  ]);
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function fail(code: ErrorCode, message: string, details?: unknown): ApiFailure {
  return {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}
