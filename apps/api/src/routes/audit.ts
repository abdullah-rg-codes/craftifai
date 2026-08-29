import { Router, type Request } from 'express';
import { z } from 'zod';
import { createOrgDal, withTransaction, type DatabasePool } from '@craftifai/db';
import { notFound, validation } from '@craftifai/shared';
import type { AuthContext } from '../auth.js';
import { requireAdmin } from '../auth.js';
import { asyncHandler } from '../errors.js';

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

function decodeCursor(value: string): { createdAt: string; id: string } {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = cursorSchema.parse(JSON.parse(decoded) as unknown);
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw validation('Invalid cursor');
  }
}

export function buildAuditRouter(
  pool: DatabasePool,
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
      requireAdmin(auth);
      const query = listQuerySchema.parse(req.query);
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        return dal.audit.listByOrgId(auth.orgId, cursor, query.limit);
      });
      const hasMore = rows.length > query.limit;
      const events = hasMore ? rows.slice(0, query.limit) : rows;
      const last = events.at(-1);
      res.json({
        events: events.map((event) => ({
          id: event.id,
          actor_user_id: event.actor_user_id,
          action: event.action,
          target_type: event.target_type,
          target_id: event.target_id,
          metadata: event.metadata,
          created_at: event.created_at,
        })),
        next_cursor: hasMore && last ? encodeCursor(last.cursor_created_at, last.id) : null,
      });
    }),
  );

  return router;
}
