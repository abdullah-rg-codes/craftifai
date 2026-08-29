import { randomBytes, createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { withTransaction, createDal } from '@craftifai/db';
import { notFound, conflict, AppError } from '@craftifai/shared';
import type { Logger } from '../logger.js';
import type { AuthContext } from '../auth.js';
import { requireAdmin, revokeAllSessionsForUser } from '../auth.js';
import { asyncHandler } from '../errors.js';
import type { DbMembership } from '@craftifai/db';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['administrator', 'member']),
});

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const updateRoleSchema = z.object({
  role: z.enum(['administrator', 'member']),
});

const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

export async function auditMembershipChange(
  ctx: Awaited<ReturnType<typeof createDal>>,
  auth: AuthContext,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ctx.audit.create({
    orgId: auth.orgId,
    actorUserId: auth.userId,
    action,
    targetType: 'membership',
    targetId,
    metadata,
  });
}

function encodeCursor(membership: DbMembership): string {
  const payload = JSON.stringify({
    c: membership.created_at.toISOString(),
    i: membership.id,
  });
  return Buffer.from(payload).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const payload = Buffer.from(cursor, 'base64url').toString('utf-8');
  const parsed = JSON.parse(payload) as { c: string; i: string };
  return { createdAt: new Date(parsed.c), id: parsed.i };
}

export function buildMembersRouter(
  _logger: Logger,
  pool: Pool,
  redis: Redis,
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
      const { members, nextCursor } = await withTransaction(
        pool,
        auth.orgId,
        async (ctx) => {
          const dal = createDal(ctx);
          const rows = await dal.memberships.listByOrgId(auth.orgId, cursor, query.limit);
          const hasMore = rows.length > query.limit;
          const trimmed = hasMore ? rows.slice(0, query.limit) : rows;
          return {
            members: trimmed.map((m) => ({
              id: m.id,
              user_id: m.user_id,
              role: m.role,
              status: m.status,
              created_at: m.created_at,
              updated_at: m.updated_at,
            })),
            nextCursor: hasMore ? encodeCursor(trimmed[trimmed.length - 1]!) : null,
          };
        },
      );
      res.json({ members, next_cursor: nextCursor });
    }),
  );

  router.post(
    '/invitations',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      requireAdmin(auth);
      const input = inviteSchema.parse(req.body);
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('base64url');
      const invitation = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createDal(ctx);
        const existing = await dal.memberships.findByOrgAndUser(auth.orgId, input.email);
        if (existing) {
          throw conflict('User is already a member of this organization');
        }
        const created = await dal.invitations.create({
          orgId: auth.orgId,
          email: input.email,
          role: input.role,
          tokenHash,
          invitedBy: auth.userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await auditMembershipChange(dal, auth, 'invitation.create', created.id, {
          email: input.email,
          role: input.role,
        });
        return created;
      });
      res.status(201).json({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        token,
        expires_at: invitation.expires_at,
      });
    }),
  );

  router.patch(
    '/:membershipId/role',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      requireAdmin(auth);
      const membershipId = req.params.membershipId as string;
      const input = updateRoleSchema.parse(req.body);
      await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createDal(ctx);
        // Lock the organization row to serialize last-admin checks.
        await ctx.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [auth.orgId]);
        const membership = await dal.memberships.findById(membershipId);
        if (!membership || membership.org_id !== auth.orgId) {
          throw notFound('Member not found');
        }
        if (membership.role === 'administrator' && input.role === 'member') {
          const count = await dal.memberships.countActiveAdmins(auth.orgId);
          if (count <= 1) {
            throw new AppError('FORBIDDEN', 'Organization must keep at least one active administrator', 403);
          }
        }
        await dal.memberships.updateRole(membershipId, input.role);
        await revokeAllSessionsForUser(pool, redis, membership.user_id);
        await auditMembershipChange(dal, auth, 'membership.role.update', membershipId, {
          previous_role: membership.role,
          new_role: input.role,
        });
      });
      res.status(204).send();
    }),
  );

  router.patch(
    '/:membershipId/status',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      requireAdmin(auth);
      const membershipId = req.params.membershipId as string;
      const input = updateStatusSchema.parse(req.body);
      await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createDal(ctx);
        await ctx.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [auth.orgId]);
        const membership = await dal.memberships.findById(membershipId);
        if (!membership || membership.org_id !== auth.orgId) {
          throw notFound('Member not found');
        }
        if (membership.role === 'administrator' && input.status === 'suspended') {
          const count = await dal.memberships.countActiveAdmins(auth.orgId);
          if (count <= 1) {
            throw new AppError('FORBIDDEN', 'Organization must keep at least one active administrator', 403);
          }
        }
        await dal.memberships.updateStatus(membershipId, input.status);
        await revokeAllSessionsForUser(pool, redis, membership.user_id);
        await auditMembershipChange(dal, auth, 'membership.status.update', membershipId, {
          previous_status: membership.status,
          new_status: input.status,
        });
      });
      res.status(204).send();
    }),
  );

  router.delete(
    '/:membershipId',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        throw notFound('Organization not found');
      }
      requireAdmin(auth);
      const membershipId = req.params.membershipId as string;
      await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createDal(ctx);
        await ctx.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [auth.orgId]);
        const membership = await dal.memberships.findById(membershipId);
        if (!membership || membership.org_id !== auth.orgId) {
          throw notFound('Member not found');
        }
        if (membership.role === 'administrator') {
          const count = await dal.memberships.countActiveAdmins(auth.orgId);
          if (count <= 1) {
            throw new AppError('FORBIDDEN', 'Organization must keep at least one active administrator', 403);
          }
        }
        await dal.memberships.delete(membershipId);
        await revokeAllSessionsForUser(pool, redis, membership.user_id);
        await auditMembershipChange(dal, auth, 'membership.delete', membershipId, {
          role: membership.role,
          status: membership.status,
        });
      });
      res.status(204).send();
    }),
  );

  return router;
}
