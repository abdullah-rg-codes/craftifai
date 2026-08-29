import { Router, type Request } from 'express';
import type { Redis } from 'ioredis';
import { withTransaction, createOrgDal, type DatabasePool } from '@craftifai/db';
import { notFound } from '@craftifai/shared';
import type { Logger } from '../logger.js';
import type { AuthContext } from '../auth.js';
import { asyncHandler } from '../errors.js';

export function buildOrgsRouter(
  _logger: Logger,
  pool: DatabasePool,
  _redis: Redis,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      const org = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        return dal.organizations.findById(auth.orgId);
      });
      if (!org) {
        throw notFound('Organization not found');
      }
      res.json({ id: org.id, name: org.name, created_at: org.created_at });
    }),
  );

  return router;
}
