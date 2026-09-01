import { randomBytes, createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  withSystemTransaction,
  withTransaction,
  createOrgDal,
  createSystemDal,
  type DatabasePool,
} from '@craftifai/db';
import { notFound, conflict, AppError, validation, hashPassword } from '@craftifai/shared';
import type { Logger } from '../logger.js';
import type { AuthContext } from '../auth.js';
import {
  createSession,
  invalidateRevokedUserSessions,
  invalidateUserSessionCache,
  requireAdmin,
  setSessionCookie,
} from '../auth.js';
import { asyncHandler } from '../errors.js';
import type { DbMembershipWithUser } from '@craftifai/db';
import type { OrgDal } from '@craftifai/db';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['administrator', 'member']),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).optional(),
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

const membershipParamsSchema = z.object({
  membershipId: z.string().uuid(),
});

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

export async function auditMembershipChange(
  ctx: OrgDal,
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

function encodeCursor(membership: DbMembershipWithUser): string {
  const payload = JSON.stringify({
    createdAt: membership.cursor_created_at,
    id: membership.id,
  });
  return Buffer.from(payload).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const payload = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = cursorSchema.parse(JSON.parse(payload) as unknown);
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new AppError('VALIDATION', 'Invalid cursor', 400);
  }
}

export function buildMembersRouter(
  logger: Logger,
  pool: DatabasePool,
  redis: Redis,
  getAuth: (req: Request) => AuthContext | undefined,
): Router {
  const router = Router();
  const invalidateCache = async (userId: string): Promise<void> => {
    try {
      await invalidateUserSessionCache(redis, userId);
    } catch (error) {
      logger.error({ err: error, userId }, 'session cache invalidation failed');
    }
  };
  const invalidateRevokedSessions = async (userId: string): Promise<void> => {
    try {
      await invalidateRevokedUserSessions(redis, userId);
    } catch (error) {
      logger.error({ err: error, userId }, 'revoked session cache invalidation failed');
    }
  };

  router.post(
    '/invitations/accept',
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const input = acceptInvitationSchema.parse(req.body);
      const tokenHash = createHash('sha256').update(input.token).digest('base64url');

      if (!auth) {
        if (!input.password) {
          throw validation('Password is required to join with an invitation');
        }
        const passwordHash = await hashPassword(input.password);
        const joined = await withSystemTransaction(pool, async (ctx) => {
          const dal = createSystemDal(ctx);
          const pending = await dal.invitations.findByTokenHash(tokenHash);
          if (
            !pending ||
            pending.status !== 'pending' ||
            new Date(pending.expires_at).getTime() <= Date.now()
          ) {
            throw notFound('Invitation not found');
          }
          const existing = await dal.users.findByEmail(pending.email);
          if (existing) {
            throw conflict(
              'An account already exists for this email. Sign in, then accept the invitation.',
            );
          }
          const invitation = await dal.invitations.acceptPendingByTokenHash(tokenHash);
          if (!invitation) {
            throw notFound('Invitation not found');
          }
          const user = await dal.users.create({
            email: invitation.email,
            passwordHash,
            displayName: null,
          });
          const created = await dal.memberships.create({
            orgId: invitation.org_id,
            userId: user.id,
            role: invitation.role,
            status: 'active',
          });
          await dal.audit.create({
            orgId: invitation.org_id,
            actorUserId: user.id,
            action: 'invitation.accept',
            targetType: 'membership',
            targetId: created.id,
            metadata: { invitation_id: invitation.id },
          });
          return { membership: created, userId: user.id };
        });
        const { token } = await createSession(pool, redis, joined.userId);
        setSessionCookie(res, token);
        res.status(201).json({
          membership_id: joined.membership.id,
          org_id: joined.membership.org_id,
          role: joined.membership.role,
        });
        return;
      }

      const membership = await withSystemTransaction(pool, async (ctx) => {
        const dal = createSystemDal(ctx);
        const user = await dal.users.findById(auth.userId);
        if (!user) {
          throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
        }
        const invitation = await dal.invitations.acceptPendingByTokenHash(tokenHash);
        if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase()) {
          throw notFound('Invitation not found');
        }
        const created = await dal.memberships.create({
          orgId: invitation.org_id,
          userId: user.id,
          role: invitation.role,
        });
        await dal.audit.create({
          orgId: invitation.org_id,
          actorUserId: user.id,
          action: 'invitation.accept',
          targetType: 'membership',
          targetId: created.id,
          metadata: { invitation_id: invitation.id },
        });
        return created;
      });
      await invalidateCache(auth.userId);
      res.status(201).json({
        membership_id: membership.id,
        org_id: membership.org_id,
        role: membership.role,
      });
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
      const { members, nextCursor } = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        const rows = await dal.memberships.listByOrgId(auth.orgId, cursor, query.limit);
        const hasMore = rows.length > query.limit;
        const trimmed = hasMore ? rows.slice(0, query.limit) : rows;
        return {
          members: trimmed.map((m) => ({
            id: m.id,
            user_id: m.user_id,
            email: m.email,
            display_name: m.display_name,
            role: m.role,
            status: m.status,
            created_at: m.created_at,
            updated_at: m.updated_at,
          })),
          nextCursor: hasMore ? encodeCursor(trimmed[trimmed.length - 1]!) : null,
        };
      });
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
        const dal = createOrgDal(ctx);
        await dal.invitations.expirePendingForEmail(auth.orgId, input.email);
        const existing = await dal.memberships.findByOrgAndEmail(auth.orgId, input.email);
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
      const { membershipId } = membershipParamsSchema.parse(req.params);
      const input = updateRoleSchema.parse(req.body);
      const affectedUserId = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        // Lock the organization row to serialize last-admin checks.
        await ctx.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [auth.orgId]);
        const membership = await dal.memberships.findById(membershipId);
        if (!membership || membership.org_id !== auth.orgId) {
          throw notFound('Member not found');
        }
        if (membership.role === 'administrator' && input.role === 'member') {
          const count = await dal.memberships.countActiveAdmins(auth.orgId);
          if (count <= 1) {
            throw new AppError(
              'FORBIDDEN',
              'Organization must keep at least one active administrator',
              403,
            );
          }
        }
        await dal.memberships.updateRole(membershipId, input.role);
        await auditMembershipChange(dal, auth, 'membership.role.update', membershipId, {
          previous_role: membership.role,
          new_role: input.role,
        });
        return membership.user_id;
      });
      await invalidateCache(affectedUserId);
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
      const { membershipId } = membershipParamsSchema.parse(req.params);
      const input = updateStatusSchema.parse(req.body);
      const affectedUserId = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        await ctx.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [auth.orgId]);
        const membership = await dal.memberships.findById(membershipId);
        if (!membership || membership.org_id !== auth.orgId) {
          throw notFound('Member not found');
        }
        if (membership.role === 'administrator' && input.status === 'suspended') {
          const count = await dal.memberships.countActiveAdmins(auth.orgId);
          if (count <= 1) {
            throw new AppError(
              'FORBIDDEN',
              'Organization must keep at least one active administrator',
              403,
            );
          }
        }
        await dal.memberships.updateStatus(membershipId, input.status);
        if (input.status === 'suspended') {
          await dal.memberships.revokeSessionsForUser(membership.user_id);
        }
        await auditMembershipChange(dal, auth, 'membership.status.update', membershipId, {
          previous_status: membership.status,
          new_status: input.status,
        });
        return membership.user_id;
      });
      if (input.status === 'suspended') {
        await invalidateRevokedSessions(affectedUserId);
      } else {
        await invalidateCache(affectedUserId);
      }
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
      const { membershipId } = membershipParamsSchema.parse(req.params);
      const affectedUserId = await withTransaction(pool, auth.orgId, async (ctx) => {
        const dal = createOrgDal(ctx);
        await ctx.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [auth.orgId]);
        const membership = await dal.memberships.findById(membershipId);
        if (!membership || membership.org_id !== auth.orgId) {
          throw notFound('Member not found');
        }
        if (membership.role === 'administrator' && membership.status === 'active') {
          const count = await dal.memberships.countActiveAdmins(auth.orgId);
          if (count <= 1) {
            throw new AppError(
              'FORBIDDEN',
              'Organization must keep at least one active administrator',
              403,
            );
          }
        }
        await dal.memberships.revokeSessionsForUser(membership.user_id);
        await dal.memberships.delete(membershipId);
        await auditMembershipChange(dal, auth, 'membership.delete', membershipId, {
          role: membership.role,
          status: membership.status,
        });
        return membership.user_id;
      });
      await invalidateRevokedSessions(affectedUserId);
      res.status(204).send();
    }),
  );

  return router;
}
