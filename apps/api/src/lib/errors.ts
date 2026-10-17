import type { ErrorCode } from '@hr/shared/envelope';

/** Throw from handlers/services; the error handler turns it into the standard envelope. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
}
