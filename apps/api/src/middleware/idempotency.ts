import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createOrgDal, withTransaction, type DatabasePool } from '@craftifai/db';
import {
  idempotencyConflict,
  idempotencyInProgress,
  unauthorized,
  validation,
} from '@craftifai/shared';
import type { Logger } from '../logger.js';
import type { AuthContext } from '../auth.js';
import type { DbIdempotencyKey } from '@craftifai/db';

export interface IdempotencyKeyHandle {
  orgId: string;
  endpoint: string;
  key: string;
}

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 300;

function asyncMiddleware(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function bodyToRecord(body: unknown): Record<string, unknown> {
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, unknown>;
  }
  return {};
}

export function buildIdempotencyMiddleware(
  pool: DatabasePool,
  logger: Logger,
  getAuth: (req: Request) => AuthContext | undefined,
  options: { required?: boolean; ttlSeconds?: number } = {},
): (req: Request, res: Response, next: NextFunction) => void {
  return asyncMiddleware(async (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }

    const headerValue = req.headers['idempotency-key'];
    if (headerValue === undefined || Array.isArray(headerValue)) {
      if (options.required) {
        throw validation('Idempotency-Key header is required');
      }
      next();
      return;
    }

    const key = headerValue.trim();
    if (!key) {
      throw validation('Idempotency-Key header cannot be empty');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw validation('Raw request body not available for idempotency fingerprint');
    }

    const auth = getAuth(req);
    if (!auth) {
      throw unauthorized();
    }

    const fingerprint = createHash('sha256').update(rawBody).digest();
    const endpoint = (req.originalUrl ?? req.path).split('?')[0] ?? req.path;
    const orgId = auth.orgId;
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const keyHandle = { orgId, endpoint, key };

    let claimed: DbIdempotencyKey | undefined;
    await withTransaction(pool, orgId, async (ctx) => {
      const dal = createOrgDal(ctx);
      claimed = await dal.idempotencyKeys.claim({
        orgId,
        endpoint,
        key,
        fingerprint,
        expiresAt,
      });
    });

    if (!claimed) {
      let existing: DbIdempotencyKey | undefined;
      await withTransaction(pool, orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        existing = await dal.idempotencyKeys.findByKey(orgId, endpoint, key);
      });

      if (!existing) {
        throw idempotencyConflict();
      }

      if (Buffer.compare(existing.request_fingerprint, fingerprint) !== 0) {
        throw idempotencyConflict();
      }

      if (existing.status === 'pending') {
        throw idempotencyInProgress();
      }

      res.setHeader('Idempotency-Replayed', 'true');
      res.status(existing.response_status ?? 200).json(existing.response_body ?? {});
      return;
    }

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let capturedStatus: number | undefined;
    let capturedBody: unknown;
    let responded = false;

    async function recordTerminalResponse(): Promise<void> {
      if (responded) return;
      responded = true;
      const status = capturedStatus ?? res.statusCode;
      const body = capturedBody !== undefined ? capturedBody : {};
      const reservationId = res.locals.idempotencyReservationId as string | undefined;
      try {
        await withTransaction(pool, orgId, async (ctx) => {
          const dal = createOrgDal(ctx);
          if (status >= 500) {
            await dal.idempotencyKeys.markFailed({
              orgId,
              endpoint,
              key,
              responseStatus: status,
              responseBody: bodyToRecord(body),
            });
          } else {
            const completed: {
              orgId: string;
              endpoint: string;
              key: string;
              responseStatus: number;
              responseBody: Record<string, unknown>;
              reservationId?: string;
            } = {
              orgId,
              endpoint,
              key,
              responseStatus: status,
              responseBody: bodyToRecord(body),
            };
            if (reservationId) {
              completed.reservationId = reservationId;
            }
            await dal.idempotencyKeys.markCompleted(completed);
          }
        });
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            correlationId: req.correlationId,
            orgId,
            endpoint,
            key,
          },
          'failed to record idempotency terminal response',
        );
      }
    }

    req.idempotencyKey = keyHandle;

    res.json = (body: unknown): Response => {
      capturedStatus = res.statusCode;
      capturedBody = body;
      recordTerminalResponse()
        .then(() => originalJson(body))
        .catch((error) => {
          logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            'idempotency response failed',
          );
          originalJson(body);
        });
      return res;
    };

    res.send = (body?: unknown): Response => {
      capturedStatus = res.statusCode;
      capturedBody = body ?? {};
      recordTerminalResponse()
        .then(() => originalSend(body))
        .catch((error) => {
          logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            'idempotency response failed',
          );
          originalSend(body);
        });
      return res;
    };

    next();
  });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      idempotencyKey?: IdempotencyKeyHandle;
    }
  }
}
