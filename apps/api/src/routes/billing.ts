import { createHash } from 'node:crypto';
import { Router } from 'express';
import { createOrgDal, withSystemTransaction, type DatabasePool } from '@craftifai/db';
import { webhookInvalid } from '@craftifai/shared';
import type { Logger } from '../logger.js';
import { asyncHandler } from '../errors.js';
import { createCreditService } from '../services/credits.js';
import { verifyWebhook, type WebhookPayload } from '../services/billing.js';
import { env } from '../env.js';

export function buildBillingRouter(logger: Logger, pool: DatabasePool): Router {
  const router = Router();

  router.post(
    '/webhook',
    asyncHandler(async (req, res) => {
      const signature = req.headers['x-webhook-signature'];
      if (typeof signature !== 'string' || !signature) {
        throw webhookInvalid('Missing X-Webhook-Signature header');
      }

      const rawBody = req.rawBody;
      if (!rawBody || rawBody.length === 0) {
        throw webhookInvalid('Raw request body not available for signature verification');
      }
      const body = rawBody.toString('utf8');
      let payload: WebhookPayload;
      try {
        payload = verifyWebhook(body, signature, env.webhookSecret());
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            path: req.path,
            correlationId: req.correlationId,
          },
          'webhook verification failed',
        );
        throw error;
      }

      const payloadHash = createHash('sha256').update(body).digest();
      const result = await withSystemTransaction(pool, async (ctx) => {
        const dal = createOrgDal(ctx);
        const service = createCreditService(dal);
        return service.applyPurchase({
          purchaseId: payload.purchase_id,
          providerEventId: payload.provider_event_id,
          payloadHash,
        });
      });

      res.status(200).json({
        applied: result.applied,
        purchase_id: result.purchaseId,
      });
    }),
  );

  return router;
}
