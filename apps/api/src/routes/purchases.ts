import { Router, type Request } from 'express';
import { z } from 'zod';
import { createOrgDal, withTransaction, type DatabasePool } from '@craftifai/db';
import { notFound, validation } from '@craftifai/shared';
import type { AuthContext } from '../auth.js';
import { requireAdmin } from '../auth.js';
import { asyncHandler } from '../errors.js';
import { createCreditService } from '../services/credits.js';
import type { IdempotencyKeyHandle } from '../middleware/idempotency.js';

const createPurchaseSchema = z.object({
  credits: z.coerce.number().int().min(1).max(1_000_000),
});

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function decodeCursor(value: string): { createdAt: string; id: string } {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = cursorSchema.parse(JSON.parse(decoded) as unknown);
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw validation('Invalid cursor');
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

export function buildPurchasesRouter(
  pool: DatabasePool,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      requireAdmin(auth);
      const body = createPurchaseSchema.parse(req.body);
      const idempotencyKey = req.idempotencyKey as IdempotencyKeyHandle | undefined;
      const purchase = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        const service = createCreditService(dal);
        const result = await service.createPurchase({ orgId: auth.orgId, credits: body.credits });
        if (idempotencyKey) {
          await dal.idempotencyKeys.markCompleted({
            ...idempotencyKey,
            responseStatus: 201,
            responseBody: { ...result },
          });
        }
        return result;
      });
      res.status(201).json(purchase);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      requireAdmin(auth);
      const query = listQuerySchema.parse(req.query);
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        return dal.purchases.listByOrgId(auth.orgId, cursor, query.limit);
      });
      const hasMore = rows.length > query.limit;
      const purchases = hasMore ? rows.slice(0, query.limit) : rows;
      const last = purchases.at(-1);
      res.json({
        purchases: purchases.map((p) => ({
          id: p.id,
          credits: p.credits,
          status: p.status,
          provider_event_id: p.provider_event_id,
          created_at: p.created_at,
          completed_at: p.completed_at,
        })),
        next_cursor: hasMore && last ? encodeCursor(last.cursor_created_at, last.id) : null,
      });
    }),
  );

  return router;
}
