import { Router, type Request } from 'express';
import { z } from 'zod';
import { createOrgDal, withTransaction, type DatabasePool } from '@craftifai/db';
import { modelUnavailable, notFound, validation } from '@craftifai/shared';
import type { Logger } from '../logger.js';
import type { AuthContext } from '../auth.js';
import { requireAdmin, requireAuth } from '../auth.js';
import { asyncHandler } from '../errors.js';
import { decryptCredential, encryptCredential } from '../services/crypto.js';
import { callChatModel, ModelCallError } from '../services/modelClient.js';
import { toPublicModelConfig } from '../services/modelConfigView.js';
import { pinUrl, SsrfBlockedError } from '../services/ssrf.js';

const upsertSchema = z.object({
  deployment_mode: z.enum(['saas', 'onprem']).default('saas'),
  endpoint_url: z.string().url(),
  model_name: z.string().min(1).max(200),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).default(30000),
  credential: z.string().min(1).max(8000).optional(),
  ca_bundle: z.string().min(1).max(100_000).optional(),
});

export function buildModelConfigRouter(
  pool: DatabasePool,
  logger: Logger,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const auth = requireAuth(getAuth(req));
      requireAdmin(auth);
      const config = await withTransaction(pool, auth.orgId, async (ctx) => {
        return createOrgDal(ctx).modelConfigurations.findByOrgId(auth.orgId);
      });
      if (!config) {
        throw notFound('Model configuration not found');
      }
      res.status(200).json(toPublicModelConfig(config));
    }),
  );

  router.put(
    '/',
    asyncHandler(async (req, res) => {
      const auth = requireAuth(getAuth(req));
      requireAdmin(auth);
      const body = upsertSchema.parse(req.body);

      try {
        await pinUrl(body.endpoint_url);
      } catch (error) {
        if (error instanceof SsrfBlockedError) {
          throw validation(error.message);
        }
        throw error;
      }

      const existing = await withTransaction(pool, auth.orgId, async (ctx) => {
        return createOrgDal(ctx).modelConfigurations.findByOrgId(auth.orgId);
      });
      if (!body.credential && !existing?.credential_ciphertext) {
        throw validation('credential is required when no credential is stored');
      }

      let encrypted: { ciphertext: Buffer; keyVersion: number } | undefined;
      if (body.credential) {
        encrypted = await encryptCredential(body.credential);
      }

      const saved = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        const row = await dal.modelConfigurations.upsert({
          orgId: auth.orgId,
          deploymentMode: body.deployment_mode,
          endpointUrl: body.endpoint_url,
          modelName: body.model_name,
          timeoutMs: body.timeout_ms,
          ...(encrypted
            ? {
                credentialCiphertext: encrypted.ciphertext,
                credentialKeyVersion: encrypted.keyVersion,
              }
            : {}),
          ...(body.ca_bundle !== undefined
            ? { caBundle: Buffer.from(body.ca_bundle, 'utf8') }
            : {}),
        });
        await dal.audit.create({
          orgId: auth.orgId,
          actorUserId: auth.userId,
          action: 'model_configuration.upsert',
          targetType: 'model_configuration',
          targetId: auth.orgId,
          metadata: {
            endpoint_url: body.endpoint_url,
            model_name: body.model_name,
            credential_rotated: Boolean(encrypted),
          },
        });
        return row;
      });

      res.status(200).json(toPublicModelConfig(saved));
    }),
  );

  router.post(
    '/test',
    asyncHandler(async (req, res) => {
      const auth = requireAuth(getAuth(req));
      requireAdmin(auth);
      const config = await withTransaction(pool, auth.orgId, async (ctx) => {
        return createOrgDal(ctx).modelConfigurations.findByOrgId(auth.orgId);
      });
      if (!config?.credential_ciphertext || config.credential_key_version === null) {
        throw notFound('Model configuration not found');
      }

      const credential = await decryptCredential({
        ciphertext: config.credential_ciphertext,
        keyVersion: config.credential_key_version,
      });
      const startedAt = performance.now();
      try {
        const result = await callChatModel(
          {
            endpointUrl: config.endpoint_url,
            modelName: config.model_name,
            timeoutMs: Math.min(config.timeout_ms, 5000),
            credential,
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 1,
            correlationId: req.correlationId ?? 'model-test',
            ...(config.ca_bundle ? { caBundle: config.ca_bundle } : {}),
          },
          logger,
        );
        res.status(200).json({
          reachable: true,
          model: config.model_name,
          latency_ms: Math.round(performance.now() - startedAt),
          usage: result.usage,
        });
      } catch (error) {
        if (error instanceof ModelCallError) {
          res.status(200).json({
            reachable: false,
            error: error.failure.kind,
            message: error.message,
            latency_ms: Math.round(performance.now() - startedAt),
          });
          return;
        }
        throw modelUnavailable('Model connectivity test failed');
      }
    }),
  );

  return router;
}
