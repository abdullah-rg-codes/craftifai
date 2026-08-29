import { Router, type Request } from 'express';
import type { Redis } from 'ioredis';
import type { DatabasePool } from '@craftifai/db';
import { z } from 'zod';
import {
  loginUser,
  registerUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  revokeSessionByHash,
} from '../auth.js';
import { unauthorized, notFound } from '@craftifai/shared';
import type { Logger } from '../logger.js';
import type { AuthContext } from '../auth.js';
import { asyncHandler } from '../errors.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function buildAuthRouter(
  _logger: Logger,
  pool: DatabasePool,
  redis: Redis,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const input = registerSchema.parse(req.body);
      const result = await registerUser(pool, redis, {
        email: input.email,
        password: input.password,
        displayName: input.display_name,
      });
      setSessionCookie(res, result.token);
      res.status(201).json({
        user_id: result.userId,
        org_id: result.orgId,
      });
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const result = await loginUser(pool, redis, input);
      if (!result) {
        throw unauthorized('Invalid email or password');
      }
      setSessionCookie(res, result.token);
      res.json({ user_id: result.userId });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Session not found');
      }
      await revokeSessionByHash(pool, redis, auth.sessionId);
      clearSessionCookie(res);
      res.status(204).send();
    }),
  );

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const auth = requireAuth(getAuth(req));
      res.json({
        user_id: auth.userId,
        email: auth.email,
        org_id: auth.orgId,
        role: auth.role,
      });
    }),
  );

  return router;
}
