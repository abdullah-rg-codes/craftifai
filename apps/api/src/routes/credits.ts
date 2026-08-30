import { Router, type Request } from 'express';
import { z } from 'zod';
import { createOrgDal, withTransaction, type DatabasePool } from '@craftifai/db';
import { notFound, validation } from '@craftifai/shared';
import type { AuthContext } from '../auth.js';
import { requireAdmin } from '../auth.js';
import { asyncHandler } from '../errors.js';

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

export function buildCreditsRouter(
  pool: DatabasePool,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();

  router.get(
    '/account',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      requireAdmin(auth);
      const account = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        return dal.creditAccounts.getOrCreate(auth.orgId);
      });
      res.json({
        org_id: account.org_id,
        available: account.available,
        reserved: account.reserved,
        updated_at: account.updated_at,
      });
    }),
  );

  router.get(
    '/ledger',
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
        return dal.creditLedger.listByOrgId(auth.orgId, cursor, query.limit);
      });
      const hasMore = rows.length > query.limit;
      const entries = hasMore ? rows.slice(0, query.limit) : rows;
      const last = entries.at(-1);
      res.json({
        entries: entries.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          delta_available: entry.delta_available,
          delta_reserved: entry.delta_reserved,
          reservation_id: entry.reservation_id,
          purchase_id: entry.purchase_id,
          created_at: entry.created_at,
        })),
        next_cursor: hasMore && last ? encodeCursor(last.cursor_created_at, last.id) : null,
      });
    }),
  );

  router.get(
    '/reservations/me',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      const query = listQuerySchema.parse(req.query);
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        return dal.creditReservations.listByUserId(auth.orgId, auth.userId, cursor, query.limit);
      });
      const hasMore = rows.length > query.limit;
      const reservations = hasMore ? rows.slice(0, query.limit) : rows;
      const last = reservations.at(-1);
      res.json({
        reservations: reservations.map((r) => ({
          id: r.id,
          user_id: r.user_id,
          status: r.status,
          reserved_credits: r.reserved_credits,
          max_total_tokens: r.max_total_tokens,
          actual_total_tokens: r.actual_total_tokens,
          settled_credits: r.settled_credits,
          expires_at: r.expires_at,
          created_at: r.created_at,
        })),
        next_cursor: hasMore && last ? encodeCursor(last.cursor_created_at, last.id) : null,
      });
    }),
  );

  router.get(
    '/reservations',
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
        return dal.creditReservations.listByOrgId(auth.orgId, cursor, query.limit);
      });
      const hasMore = rows.length > query.limit;
      const reservations = hasMore ? rows.slice(0, query.limit) : rows;
      const last = reservations.at(-1);
      res.json({
        reservations: reservations.map((r) => ({
          id: r.id,
          user_id: r.user_id,
          status: r.status,
          reserved_credits: r.reserved_credits,
          max_total_tokens: r.max_total_tokens,
          actual_total_tokens: r.actual_total_tokens,
          settled_credits: r.settled_credits,
          expires_at: r.expires_at,
          created_at: r.created_at,
        })),
        next_cursor: hasMore && last ? encodeCursor(last.cursor_created_at, last.id) : null,
      });
    }),
  );

  return router;
}
