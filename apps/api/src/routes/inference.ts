import { Router, type Request } from 'express';
import { z } from 'zod';
import { createOrgDal, withTransaction, type DatabasePool } from '@craftifai/db';
import type { AuthContext } from '../auth.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../errors.js';
import { createCreditService } from '../services/credits.js';
import { callStubModel } from '../services/modelStub.js';
import type { IdempotencyKeyHandle } from '../middleware/idempotency.js';

const inferenceSchema = z.object({
  max_total_tokens: z.coerce.number().int().min(1).max(1_000_000),
});

export function buildInferenceRouter(
  pool: DatabasePool,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const auth = requireAuth(getAuth(req));
      const body = inferenceSchema.parse(req.body);
      const idempotencyKey = req.idempotencyKey as IdempotencyKeyHandle | undefined;

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
          if (idempotencyKey) {
            await withTransaction(pool, auth.orgId, async (ctx) => {
              const dal = createOrgDal(ctx);
              await dal.idempotencyKeys.markCompleted({
                ...idempotencyKey,
                responseStatus: 402,
                responseBody: {
                  error: { code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' },
                },
              });
            }).catch(() => undefined);
          }
          res.status(402).json({
            error: { code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' },
          });
          return;
        }

        reservationId = reserveResult.reservationId;
        res.locals.idempotencyReservationId = reservationId;

        const modelResponse = await callStubModel({ max_total_tokens: body.max_total_tokens });

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
                  }
                : {
                    reservation_id: reservationId,
                    usage: modelResponse.usage,
                    note: 'reservation already terminal',
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
          });
          return;
        }

        res.status(200).json({
          reservation_id: settleResult.reservationId,
          reserved_credits: reserveResult.reservedCredits,
          settled_credits: settleResult.settledCredits,
          refunded_credits: settleResult.refundedCredits,
          usage: modelResponse.usage,
        });
      } catch (error) {
        if (reservationId) {
          await withTransaction(pool, auth.orgId, async (ctx) => {
            const dal = createOrgDal(ctx);
            const service = createCreditService(dal);
            await service.release({ reservationId: reservationId! });
            if (idempotencyKey) {
              await dal.idempotencyKeys.markFailed({
                ...idempotencyKey,
                responseStatus: 500,
                responseBody: {
                  error: { code: 'INTERNAL', message: 'Inference failed' },
                },
              });
            }
          }).catch(() => undefined);
        }
        throw error;
      }
    }),
  );

  return router;
}
