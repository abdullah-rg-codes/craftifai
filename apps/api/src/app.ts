import { randomUUID, createHash } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { Logger } from './logger.js';
import { createErrorHandler } from './errors.js';
import { sessionSecret } from './env.js';
import { extractSessionToken, resolveAuthContext, type AuthContext } from './auth.js';
import { buildAuthRouter } from './routes/auth.js';
import { buildOrgsRouter } from './routes/orgs.js';
import { buildMembersRouter } from './routes/members.js';

function asyncMiddleware(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function buildApp(logger: Logger, pool: Pool, redis: Redis): express.Application {
  const app = express();

  app.use(express.json());
  app.use(cookieParser(sessionSecret()));

  app.use((req, _res, next) => {
    req.correlationId = randomUUID();
    next();
  });

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

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/ready', (_req, res) => {
    res.status(200).json({ status: 'ready' });
  });

  const getAuth = (req: express.Request): AuthContext | undefined => req.auth;

  app.use('/auth', buildAuthRouter(logger, pool, redis, getAuth));
  app.use('/orgs', buildOrgsRouter(logger, pool, redis, getAuth));
  app.use('/members', buildMembersRouter(logger, pool, redis, getAuth));

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
