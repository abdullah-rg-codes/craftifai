import { randomUUID, createHash } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';
import { withSystemTransaction, type DatabasePool } from '@craftifai/db';
import type { Logger } from './logger.js';
import { createErrorHandler } from './errors.js';
import { sessionSecret } from './env.js';
import { inflightMiddleware } from './inflight.js';
import { observeHttp, renderMetrics } from './metrics.js';
import { extractSessionToken, resolveAuthContext, type AuthContext } from './auth.js';
import { buildAuthRouter } from './routes/auth.js';
import { buildOrgsRouter } from './routes/orgs.js';
import { buildMembersRouter } from './routes/members.js';
import { buildAuditRouter } from './routes/audit.js';
import { buildCreditsRouter } from './routes/credits.js';
import { buildPurchasesRouter } from './routes/purchases.js';
import { buildInferenceRouter } from './routes/inference.js';
import { buildBillingRouter } from './routes/billing.js';
import { buildModelConfigRouter } from './routes/modelConfig.js';
import { attachRawBody } from './middleware/rawBody.js';
import { buildIdempotencyMiddleware } from './middleware/idempotency.js';

function asyncMiddleware(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function buildApp(logger: Logger, pool: DatabasePool, redis: Redis): express.Application {
  const app = express();

  app.use(inflightMiddleware);
  app.use(express.json({ verify: attachRawBody }));
  app.use(cookieParser(sessionSecret()));

  app.use((req, res, next) => {
    req.correlationId = randomUUID();
    res.setHeader('X-Correlation-ID', req.correlationId);
    const startedAt = performance.now();
    res.on('finish', () => {
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      observeHttp({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      });
      logger.info(
        {
          correlationId: req.correlationId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs,
        },
        'request completed',
      );
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      replica: process.env.HOSTNAME ?? 'local',
    });
  });

  app.get('/metrics', (_req, res) => {
    res.status(200).type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  });

  app.get(
    '/ready',
    asyncMiddleware(async (_req, res) => {
      try {
        await Promise.all([
          withSystemTransaction(pool, async (ctx) => {
            await ctx.query('SELECT 1');
          }),
          redis.ping(),
        ]);
        res.status(200).json({ status: 'ready' });
      } catch {
        res.status(503).json({ status: 'not_ready' });
      }
    }),
  );

  app.use(
    asyncMiddleware(async (req, _res, next) => {
      const token = await extractSessionToken(req);
      if (token) {
        const hash = createHash('sha256').update(token).digest('base64url');
        const orgId = req.headers['x-org-id'] as string | undefined;
        req.auth = await resolveAuthContext(pool, redis, hash, orgId);
      } else {
        req.auth = undefined;
      }
      next();
    }),
  );

  const getAuth = (req: express.Request): AuthContext | undefined => req.auth;

  app.use('/auth', buildAuthRouter(logger, pool, redis, getAuth));
  app.use('/orgs', buildOrgsRouter(logger, pool, redis, getAuth));
  app.use('/members', buildMembersRouter(logger, pool, redis, getAuth));
  app.use('/audit-events', buildAuditRouter(pool, getAuth));
  app.use('/credits', buildCreditsRouter(pool, getAuth));
  app.use(
    '/purchases',
    buildIdempotencyMiddleware(pool, logger, getAuth, { required: true }),
    buildPurchasesRouter(pool, getAuth),
  );
  app.use(
    '/inference',
    buildIdempotencyMiddleware(pool, logger, getAuth, { required: true }),
    buildInferenceRouter(pool, redis, logger, getAuth),
  );
  app.use('/model-config', buildModelConfigRouter(pool, logger, getAuth));
  app.use('/billing', buildBillingRouter(logger, pool));

  app.use(createErrorHandler(logger));

  return app;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- standard Express module augmentation pattern
  namespace Express {
    interface Request {
      correlationId?: string | undefined;
      auth?: AuthContext | undefined;
    }
  }
}
