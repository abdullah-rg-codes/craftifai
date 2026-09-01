export type AppErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'INSUFFICIENT_CREDITS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'WEBHOOK_INVALID'
  | 'WEBHOOK_REPLAY'
  | 'MODEL_TIMEOUT'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_MALFORMED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: AppErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> | undefined = undefined,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function unauthorized(message = 'Unauthorized'): AppError {
  return new AppError('UNAUTHORIZED', message, 401);
}

export function forbidden(message = 'Forbidden'): AppError {
  return new AppError('FORBIDDEN', message, 403);
}

export function notFound(message = 'Not found'): AppError {
  return new AppError('NOT_FOUND', message, 404);
}

export function conflict(message = 'Conflict'): AppError {
  return new AppError('CONFLICT', message, 409);
}

export function validation(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('VALIDATION', message, 400, details);
}

export function insufficientCredits(needed: bigint, available: bigint): AppError {
  return new AppError(
    'INSUFFICIENT_CREDITS',
    `Insufficient credits: needed ${needed.toString()}, available ${available.toString()}`,
    402,
    { needed: needed.toString(), available: available.toString() },
  );
}

export function idempotencyConflict(): AppError {
  return new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different body', 409);
}

export function idempotencyInProgress(): AppError {
  return new AppError(
    'IDEMPOTENCY_IN_PROGRESS',
    'Request with this idempotency key is already in progress',
    409,
  );
}

export function webhookInvalid(message: string): AppError {
  return new AppError('WEBHOOK_INVALID', message, 400);
}

export function webhookReplay(message: string): AppError {
  return new AppError('WEBHOOK_REPLAY', message, 409);
}

export function modelTimeout(message = 'Model request timed out'): AppError {
  return new AppError('MODEL_TIMEOUT', message, 504);
}

export function modelUnavailable(message = 'Model is unavailable'): AppError {
  return new AppError('MODEL_UNAVAILABLE', message, 502);
}

export function modelMalformed(message = 'Model returned a malformed response'): AppError {
  return new AppError('MODEL_MALFORMED', message, 502);
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError('RATE_LIMITED', 'Rate limit exceeded', 429, {
    retryAfterSeconds,
  });
}

export function serviceUnavailable(message = 'Service unavailable'): AppError {
  return new AppError('SERVICE_UNAVAILABLE', message, 503);
}
