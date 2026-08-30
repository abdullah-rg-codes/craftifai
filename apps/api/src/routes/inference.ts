import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Redis } from 'ioredis';
import { createOrgDal, withTransaction, type DatabasePool } from '@craftifai/db';
import {
  calculateCreditsFromTokens,
  insufficientCredits,
  modelMalformed,
  modelTimeout,
  modelUnavailable,
  notFound,
} from '@craftifai/shared';
import type { Logger } from '../logger.js';
import type { AuthContext } from '../auth.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../errors.js';
import { createCreditService } from '../services/credits.js';
import { decryptCredential } from '../services/crypto.js';
import { callChatModel, ModelCallError } from '../services/modelClient.js';
import { assertWithinRateLimit } from '../services/rateLimit.js';
import type { IdempotencyKeyHandle } from '../middleware/idempotency.js';

const inferenceSchema = z.object({
  max_total_tokens: z.coerce.number().int().min(1).max(1_000_000),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(100_000),
      }),
    )
    .max(50)
    .optional(),
});

function mapModelError(error: ModelCallError) {
  if (error.failure.kind === 'timeout') {
    return modelTimeout(error.message);
  }
  if (error.failure.kind === 'malformed') {
    return modelMalformed(error.message);
  }
  return modelUnavailable(error.message);
}

export function buildInferenceRouter(
  pool: DatabasePool,
  redis: Redis,
  logger: Logger,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const auth = requireAuth(getAuth(req));
      const body = inferenceSchema.parse(req.body);
      const idempotencyKey = req.idempotencyKey as IdempotencyKeyHandle | undefined;

      await assertWithinRateLimit(redis, auth.orgId, auth.userId);

      const config = await withTransaction(pool, auth.orgId, async (ctx) => {
        return createOrgDal(ctx).modelConfigurations.findByOrgId(auth.orgId);
      });
      if (!config?.credential_ciphertext || config.credential_key_version === null) {
        throw notFound('Model configuration not found');
      }

      let reservationId: string | undefined;

      try {
        const reserveResult = await withTransaction(pool, auth.orgId, async (ctx) => {
          const dal = createOrgDal(ctx);
          const service = createCreditService(dal);
          return service.reserve({
            orgId: auth.orgId,
            userId: auth.userId,
            maxTotalTokens: body.max_total_tokens,
          });
        });

        if (!reserveResult) {
          const account = await withTransaction(pool, auth.orgId, async (ctx) => {
            return createOrgDal(ctx).creditAccounts.getOrCreate(auth.orgId);
          });
          const needed = calculateCreditsFromTokens(body.max_total_tokens);
          const error = insufficientCredits(BigInt(needed), BigInt(account.available));
          const errorBody = {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          };
          if (idempotencyKey) {
            await withTransaction(pool, auth.orgId, async (ctx) => {
              const dal = createOrgDal(ctx);
              await dal.idempotencyKeys.markCompleted({
                ...idempotencyKey,
                responseStatus: 402,
                responseBody: errorBody,
              });
            }).catch(() => undefined);
          }
          throw error;
        }

        reservationId = reserveResult.reservationId;
        res.locals.idempotencyReservationId = reservationId;

        const credential = await decryptCredential({
          ciphertext: config.credential_ciphertext,
          keyVersion: config.credential_key_version,
        });
        const messages = body.messages ?? [{ role: 'user' as const, content: 'ping' }];
        const modelResponse = await callChatModel(
          {
            endpointUrl: config.endpoint_url,
            modelName: config.model_name,
            timeoutMs: config.timeout_ms,
            credential,
            messages,
            maxTokens: body.max_total_tokens,
            correlationId: req.correlationId ?? reservationId,
            ...(config.ca_bundle ? { caBundle: config.ca_bundle } : {}),
          },
          logger,
        );

        const settleResult = await withTransaction(pool, auth.orgId, async (ctx) => {
          const dal = createOrgDal(ctx);
          const service = createCreditService(dal);
          const settled = await service.settle({
            reservationId: reservationId!,
            actualTotalTokens: modelResponse.usage.total_tokens,
          });
          if (idempotencyKey) {
            const completed: {
              orgId: string;
              endpoint: string;
              key: string;
              responseStatus: number;
              responseBody: Record<string, unknown>;
              reservationId?: string;
            } = {
              ...idempotencyKey,
              responseStatus: 200,
              responseBody: settled
                ? {
                    reservation_id: settled.reservationId,
                    reserved_credits: reserveResult.reservedCredits,
                    settled_credits: settled.settledCredits,
                    refunded_credits: settled.refundedCredits,
                    usage: modelResponse.usage,
                    ...(modelResponse.completion !== undefined
                      ? { completion: modelResponse.completion }
                      : {}),
                  }
                : {
                    reservation_id: reservationId,
                    usage: modelResponse.usage,
                    note: 'reservation already terminal',
                    ...(modelResponse.completion !== undefined
                      ? { completion: modelResponse.completion }
                      : {}),
                  },
            };
            if (reservationId) {
              completed.reservationId = reservationId;
            }
            await dal.idempotencyKeys.markCompleted(completed);
          }
          return settled;
        });

        if (!settleResult) {
          res.status(200).json({
            reservation_id: reservationId,
            usage: modelResponse.usage,
            note: 'reservation already terminal',
            ...(modelResponse.completion !== undefined
              ? { completion: modelResponse.completion }
              : {}),
          });
          return;
        }

        res.status(200).json({
          reservation_id: settleResult.reservationId,
          reserved_credits: reserveResult.reservedCredits,
          settled_credits: settleResult.settledCredits,
          refunded_credits: settleResult.refundedCredits,
          usage: modelResponse.usage,
          ...(modelResponse.completion !== undefined
            ? { completion: modelResponse.completion }
            : {}),
        });
      } catch (error) {
        if (reservationId) {
          const mapped = error instanceof ModelCallError ? mapModelError(error) : error;
          const status =
            mapped instanceof Error && 'status' in mapped ? Number(mapped.status) : 500;
          const bodyForIdempotency =
            mapped instanceof Error && 'code' in mapped
              ? {
                  error: {
                    code: String((mapped as { code: string }).code),
                    message: mapped.message,
                  },
                }
              : { error: { code: 'INTERNAL', message: 'Inference failed' } };
          await withTransaction(pool, auth.orgId, async (ctx) => {
            const dal = createOrgDal(ctx);
            const service = createCreditService(dal);
            await service.release({ reservationId: reservationId! });
            if (idempotencyKey) {
              await dal.idempotencyKeys.markFailed({
                ...idempotencyKey,
                responseStatus: Number.isFinite(status) ? status : 500,
                responseBody: bodyForIdempotency,
              });
            }
          }).catch(() => undefined);
          if (error instanceof ModelCallError) {
            throw mapped;
          }
        }
        throw error;
      }
    }),
  );

  return router;
}
