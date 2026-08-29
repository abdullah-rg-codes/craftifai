import type { QueryResultRow } from 'pg';
import type { OrgTransactionContext, SystemTransactionContext } from './transaction.js';

type TransactionContext = OrgTransactionContext | SystemTransactionContext;

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: Date;
}

export interface DbSession {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface DbOrganization {
  id: string;
  name: string;
  created_at: Date;
}

export interface DbMembership {
  id: string;
  org_id: string;
  user_id: string;
  role: 'administrator' | 'member';
  status: 'active' | 'suspended';
  created_at: Date;
  updated_at: Date;
}

export interface DbMembershipWithUser extends DbMembership {
  email: string;
  display_name: string | null;
}

export interface DbInvitation {
  id: string;
  org_id: string;
  email: string;
  role: 'administrator' | 'member';
  token_hash: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: Date;
  created_at: Date;
}

export interface DbAuditEvent {
  id: string;
  org_id: string;
  actor_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

async function one<T extends QueryResultRow>(
  ctx: TransactionContext,
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  const result = await ctx.query<T>(sql, params);
  return result.rows[0];
}

async function many<T extends QueryResultRow>(
  ctx: TransactionContext,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await ctx.query<T>(sql, params);
  return result.rows;
}

function createDal(ctx: TransactionContext) {
  return {
    users: {
      async create(input: {
        email: string;
        passwordHash: string;
        displayName: string | null;
      }): Promise<DbUser> {
        return (await one<DbUser>(
          ctx,
          'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *',
          [input.email, input.passwordHash, input.displayName],
        ))!;
      },
      async findByEmail(email: string): Promise<DbUser | undefined> {
        return one<DbUser>(ctx, 'SELECT * FROM users WHERE email = $1', [email]);
      },
      async findById(id: string): Promise<DbUser | undefined> {
        return one<DbUser>(ctx, 'SELECT * FROM users WHERE id = $1', [id]);
      },
    },
    sessions: {
      async create(input: {
        userId: string;
        tokenHash: string;
        expiresAt: Date;
      }): Promise<DbSession> {
        return (await one<DbSession>(
          ctx,
          'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING *',
          [input.userId, input.tokenHash, input.expiresAt],
        ))!;
      },
      async findByTokenHash(tokenHash: string): Promise<DbSession | undefined> {
        return one<DbSession>(ctx, 'SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
      },
      async revokeById(sessionId: string): Promise<void> {
        await ctx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
      },
      async revokeAllForUser(userId: string): Promise<void> {
        await ctx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1', [userId]);
      },
    },
    organizations: {
      async create(name: string): Promise<DbOrganization> {
        return (await one<DbOrganization>(
          ctx,
          'INSERT INTO organizations (name) VALUES ($1) RETURNING *',
          [name],
        ))!;
      },
      async findById(id: string): Promise<DbOrganization | undefined> {
        return one<DbOrganization>(ctx, 'SELECT * FROM organizations WHERE id = $1', [id]);
      },
    },
    memberships: {
      async create(input: {
        orgId: string;
        userId: string;
        role: 'administrator' | 'member';
        status?: 'active' | 'suspended';
      }): Promise<DbMembership> {
        return (await one<DbMembership>(
          ctx,
          'INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1, $2, $3, $4) RETURNING *',
          [input.orgId, input.userId, input.role, input.status ?? 'active'],
        ))!;
      },
      async findById(id: string): Promise<DbMembership | undefined> {
        return one<DbMembership>(ctx, 'SELECT * FROM memberships WHERE id = $1', [id]);
      },
      async findByOrgAndUser(orgId: string, userId: string): Promise<DbMembership | undefined> {
        return one<DbMembership>(
          ctx,
          'SELECT * FROM memberships WHERE org_id = $1 AND user_id = $2',
          [orgId, userId],
        );
      },
      async findByOrgAndEmail(orgId: string, email: string): Promise<DbMembership | undefined> {
        return one<DbMembership>(
          ctx,
          `SELECT m.*
             FROM memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.org_id = $1 AND u.email = $2`,
          [orgId, email],
        );
      },
      async listByOrgId(
        orgId: string,
        cursor: { createdAt: Date; id: string } | null,
        limit: number,
      ): Promise<DbMembershipWithUser[]> {
        if (cursor) {
          return many<DbMembershipWithUser>(
            ctx,
            `SELECT m.*, u.email, u.display_name
               FROM memberships m
               JOIN users u ON u.id = m.user_id
              WHERE m.org_id = $1
                AND (m.created_at, m.id) > ($2, $3)
              ORDER BY m.created_at, m.id
              LIMIT $4`,
            [orgId, cursor.createdAt, cursor.id, limit + 1],
          );
        }
        return many<DbMembershipWithUser>(
          ctx,
          `SELECT m.*, u.email, u.display_name
             FROM memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.org_id = $1
            ORDER BY m.created_at, m.id
            LIMIT $2`,
          [orgId, limit + 1],
        );
      },
      async listByUserId(userId: string): Promise<DbMembership[]> {
        return many<DbMembership>(ctx, 'SELECT * FROM memberships WHERE user_id = $1', [userId]);
      },
      async updateRole(id: string, role: 'administrator' | 'member'): Promise<void> {
        await ctx.query('UPDATE memberships SET role = $1, updated_at = now() WHERE id = $2', [
          role,
          id,
        ]);
      },
      async updateStatus(id: string, status: 'active' | 'suspended'): Promise<void> {
        await ctx.query('UPDATE memberships SET status = $1, updated_at = now() WHERE id = $2', [
          status,
          id,
        ]);
      },
      async delete(id: string): Promise<void> {
        await ctx.query('DELETE FROM memberships WHERE id = $1', [id]);
      },
      async revokeSessionsForUser(userId: string): Promise<void> {
        await ctx.query(
          `UPDATE sessions
              SET revoked_at = now()
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
      },
      async countActiveAdmins(orgId: string): Promise<number> {
        const row = await one<{ count: string }>(
          ctx,
          'SELECT COUNT(*)::text AS count FROM memberships WHERE org_id = $1 AND role = $2 AND status = $3',
          [orgId, 'administrator', 'active'],
        );
        return Number.parseInt(row?.count ?? '0', 10);
      },
    },
    invitations: {
      async expirePendingForEmail(orgId: string, email: string): Promise<void> {
        await ctx.query(
          `UPDATE invitations
              SET status = 'expired'
            WHERE org_id = $1
              AND email = $2
              AND status = 'pending'
              AND expires_at <= now()`,
          [orgId, email],
        );
      },
      async create(input: {
        orgId: string;
        email: string;
        role: 'administrator' | 'member';
        tokenHash: string;
        invitedBy: string;
        expiresAt: Date;
      }): Promise<DbInvitation> {
        return (await one<DbInvitation>(
          ctx,
          'INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [input.orgId, input.email, input.role, input.tokenHash, input.invitedBy, input.expiresAt],
        ))!;
      },
      async findByTokenHash(tokenHash: string): Promise<DbInvitation | undefined> {
        return one<DbInvitation>(ctx, 'SELECT * FROM invitations WHERE token_hash = $1', [
          tokenHash,
        ]);
      },
      async acceptPendingByTokenHash(tokenHash: string): Promise<DbInvitation | undefined> {
        return one<DbInvitation>(
          ctx,
          `UPDATE invitations
              SET status = 'accepted'
            WHERE token_hash = $1
              AND status = 'pending'
              AND expires_at > now()
          RETURNING *`,
          [tokenHash],
        );
      },
      async updateStatus(
        id: string,
        status: 'pending' | 'accepted' | 'revoked' | 'expired',
      ): Promise<void> {
        await ctx.query('UPDATE invitations SET status = $1 WHERE id = $2', [status, id]);
      },
    },
    audit: {
      async create(input: {
        orgId: string;
        actorUserId: string;
        action: string;
        targetType?: string;
        targetId?: string;
        metadata?: Record<string, unknown>;
      }): Promise<DbAuditEvent> {
        return (await one<DbAuditEvent>(
          ctx,
          'INSERT INTO audit_events (org_id, actor_user_id, action, target_type, target_id, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [
            input.orgId,
            input.actorUserId,
            input.action,
            input.targetType ?? null,
            input.targetId ?? null,
            input.metadata ?? {},
          ],
        ))!;
      },
      async listByOrgId(
        orgId: string,
        cursor: { createdAt: Date; id: string } | null,
        limit: number,
      ): Promise<DbAuditEvent[]> {
        if (cursor) {
          return many<DbAuditEvent>(
            ctx,
            `SELECT * FROM audit_events
              WHERE org_id = $1
                AND (created_at, id) < ($2, $3)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [orgId, cursor.createdAt, cursor.id, limit + 1],
          );
        }
        return many<DbAuditEvent>(
          ctx,
          `SELECT * FROM audit_events
            WHERE org_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [orgId, limit + 1],
        );
      },
    },
  };
}

export function createOrgDal(ctx: OrgTransactionContext) {
  const dal = createDal(ctx);
  return {
    organizations: dal.organizations,
    memberships: dal.memberships,
    invitations: dal.invitations,
    audit: dal.audit,
  };
}

export function createSystemDal(ctx: SystemTransactionContext) {
  return createDal(ctx);
}

export type OrgDal = ReturnType<typeof createOrgDal>;
export type SystemDal = ReturnType<typeof createSystemDal>;
