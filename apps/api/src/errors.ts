import type { ErrorRequestHandler, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, conflict, validation } from '@craftifai/shared';
import type { Logger } from './logger.js';

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      const error = validation('Invalid request body or query', { issues });
      logger.warn(
        {
          code: error.code,
          status: error.status,
          path: req.path,
          method: req.method,
          correlationId: req.correlationId,
        },
        error.message,
      );
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === '23505'
    ) {
      const error = conflict('Resource already exists');
      res.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (err instanceof AppError) {
      if (err.code === 'RATE_LIMITED') {
        const retryAfter = err.details?.retryAfterSeconds;
        if (typeof retryAfter === 'number') {
          res.setHeader('Retry-After', String(retryAfter));
        }
      }
      logger.warn(
        {
          code: err.code,
          status: err.status,
          path: req.path,
          method: req.method,
          correlationId: req.correlationId,
        },
        err.message,
      );
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    logger.error(
      {
        errorName: err instanceof Error ? err.name : 'UnknownError',
        errorCode:
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code: unknown }).code)
            : undefined,
        path: req.path,
        method: req.method,
        correlationId: req.correlationId,
      },
      'unhandled error',
    );
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  };
}

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: (err: unknown) => void) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
