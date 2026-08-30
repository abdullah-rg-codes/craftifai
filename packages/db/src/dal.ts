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
  cursor_created_at: string;
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

export interface DbAuditEventWithCursor extends DbAuditEvent {
  cursor_created_at: string;
}

export interface DbCreditAccount {
  org_id: string;
  available: number;
  reserved: number;
  updated_at: Date;
}

export interface DbCreditLedger {
  id: string;
  org_id: string;
  kind: 'purchase' | 'reservation' | 'settlement' | 'release' | 'expiry';
  delta_available: number;
  delta_reserved: number;
  reservation_id: string | null;
  purchase_id: string | null;
  created_at: Date;
}

export interface DbCreditLedgerWithCursor extends DbCreditLedger {
  cursor_created_at: string;
}

export interface DbCreditReservation {
  id: string;
  org_id: string;
  user_id: string;
  status: 'reserved' | 'settled' | 'released' | 'expired';
  reserved_credits: number;
  max_total_tokens: number;
  actual_total_tokens: number | null;
  settled_credits: number | null;
  expires_at: Date;
  settled_at: Date | null;
  created_at: Date;
}

export interface DbCreditReservationWithCursor extends DbCreditReservation {
  cursor_created_at: string;
}

export interface DbPurchase {
  id: string;
  org_id: string;
  credits: number;
  status: 'pending' | 'completed' | 'failed';
  provider_event_id: string | null;
  initiated_by_user_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface DbPurchaseWithCursor extends DbPurchase {
  cursor_created_at: string;
}

export interface DbIdempotencyKey {
  org_id: string;
  endpoint: string;
  key: string;
  request_fingerprint: Buffer;
  status: 'pending' | 'completed' | 'failed';
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  reservation_id: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
}

export interface DbWebhookEvent {
  provider_event_id: string;
  payload_hash: Buffer;
  received_at: Date;
  processed_at: Date | null;
}

export interface DbModelConfiguration {
  org_id: string;
  deployment_mode: 'saas' | 'onprem';
  endpoint_url: string;
  model_name: string;
  credential_ciphertext: Buffer | null;
  credential_key_version: number | null;
  credential_updated_at: Date | null;
  timeout_ms: number;
  ca_bundle: Buffer | null;
  updated_at: Date;
}

function parseCredits(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number.parseInt(value, 10);
}

function toAccount(row: QueryResultRow): DbCreditAccount {
  return {
    org_id: String(row.org_id),
    available: parseCredits(row.available),
    reserved: parseCredits(row.reserved),
    updated_at: row.updated_at as Date,
  };
}

function toLedger(row: QueryResultRow): DbCreditLedgerWithCursor {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    kind: row.kind as DbCreditLedger['kind'],
    delta_available: parseCredits(row.delta_available),
    delta_reserved: parseCredits(row.delta_reserved),
    reservation_id: row.reservation_id ? String(row.reservation_id) : null,
    purchase_id: row.purchase_id ? String(row.purchase_id) : null,
    created_at: row.created_at as Date,
    cursor_created_at: String(row.cursor_created_at),
  };
}

function toReservation(row: QueryResultRow): DbCreditReservationWithCursor {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    user_id: String(row.user_id),
    status: row.status as DbCreditReservation['status'],
    reserved_credits: parseCredits(row.reserved_credits),
    max_total_tokens: Number(row.max_total_tokens),
    actual_total_tokens: row.actual_total_tokens ? Number(row.actual_total_tokens) : null,
    settled_credits: row.settled_credits ? parseCredits(row.settled_credits) : null,
    expires_at: row.expires_at as Date,
    settled_at: row.settled_at ? (row.settled_at as Date) : null,
    created_at: row.created_at as Date,
    cursor_created_at: String(row.cursor_created_at),
  };
}

function toPurchase(row: QueryResultRow): DbPurchaseWithCursor {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    credits: parseCredits(row.credits),
    status: row.status as DbPurchase['status'],
    provider_event_id: row.provider_event_id ? String(row.provider_event_id) : null,
    initiated_by_user_id:
      row.initiated_by_user_id === null || row.initiated_by_user_id === undefined
        ? null
        : String(row.initiated_by_user_id),
    created_at: row.created_at as Date,
    completed_at: row.completed_at ? (row.completed_at as Date) : null,
    cursor_created_at: String(row.cursor_created_at),
  };
}

function toIdempotencyKey(row: QueryResultRow): DbIdempotencyKey {
  return {
    org_id: String(row.org_id),
    endpoint: String(row.endpoint),
    key: String(row.key),
    request_fingerprint: row.request_fingerprint as Buffer,
    status: row.status as DbIdempotencyKey['status'],
    response_status: row.response_status ? Number(row.response_status) : null,
    response_body: row.response_body ? (row.response_body as Record<string, unknown>) : null,
    reservation_id: row.reservation_id ? String(row.reservation_id) : null,
    created_at: row.created_at as Date,
    completed_at: row.completed_at ? (row.completed_at as Date) : null,
    expires_at: row.expires_at as Date,
  };
}

function toModelConfiguration(row: QueryResultRow): DbModelConfiguration {
  return {
    org_id: String(row.org_id),
    deployment_mode: row.deployment_mode as DbModelConfiguration['deployment_mode'],
    endpoint_url: String(row.endpoint_url),
    model_name: String(row.model_name),
    credential_ciphertext: row.credential_ciphertext ? (row.credential_ciphertext as Buffer) : null,
    credential_key_version:
      row.credential_key_version === null || row.credential_key_version === undefined
        ? null
        : Number(row.credential_key_version),
    credential_updated_at: row.credential_updated_at ? (row.credential_updated_at as Date) : null,
    timeout_ms: Number(row.timeout_ms),
    ca_bundle: row.ca_bundle ? (row.ca_bundle as Buffer) : null,
    updated_at: row.updated_at as Date,
  };
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
      async hasAnyAdministrator(): Promise<boolean> {
        const row = await one<{ present: number }>(
          ctx,
          `SELECT 1 AS present
             FROM memberships
            WHERE role = 'administrator' AND status = 'active'
            LIMIT 1`,
        );
        return row !== undefined;
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
        cursor: { createdAt: string; id: string } | null,
        limit: number,
      ): Promise<DbMembershipWithUser[]> {
        if (cursor) {
          return many<DbMembershipWithUser>(
            ctx,
            `SELECT m.*, u.email, u.display_name,
                    to_char(
                      m.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) AS cursor_created_at
               FROM memberships m
               JOIN users u ON u.id = m.user_id
              WHERE m.org_id = $1
                AND (m.created_at, m.id) > ($2::timestamptz, $3)
              ORDER BY m.created_at, m.id
              LIMIT $4`,
            [orgId, cursor.createdAt, cursor.id, limit + 1],
          );
        }
        return many<DbMembershipWithUser>(
          ctx,
          `SELECT m.*, u.email, u.display_name,
                  to_char(
                    m.created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                  ) AS cursor_created_at
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
        cursor: { createdAt: string; id: string } | null,
        limit: number,
      ): Promise<DbAuditEventWithCursor[]> {
        if (cursor) {
          return many<DbAuditEventWithCursor>(
            ctx,
            `SELECT *,
                    to_char(
                      created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) AS cursor_created_at
               FROM audit_events
              WHERE org_id = $1
                AND (created_at, id) < ($2::timestamptz, $3)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [orgId, cursor.createdAt, cursor.id, limit + 1],
          );
        }
        return many<DbAuditEventWithCursor>(
          ctx,
          `SELECT *,
                  to_char(
                    created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                  ) AS cursor_created_at
             FROM audit_events
            WHERE org_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [orgId, limit + 1],
        );
      },
    },
    creditAccounts: {
      async getOrCreate(orgId: string): Promise<DbCreditAccount> {
        const existing = await one<QueryResultRow>(
          ctx,
          'SELECT * FROM org_credit_accounts WHERE org_id = $1',
          [orgId],
        );
        if (existing) return toAccount(existing);
        const created = (await one<QueryResultRow>(
          ctx,
          'INSERT INTO org_credit_accounts (org_id, available, reserved) VALUES ($1, 0, 0) RETURNING *',
          [orgId],
        ))!;
        return toAccount(created);
      },
      async findByOrgId(orgId: string): Promise<DbCreditAccount | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          'SELECT * FROM org_credit_accounts WHERE org_id = $1',
          [orgId],
        );
        return row ? toAccount(row) : undefined;
      },
      async reserve(orgId: string, credits: number): Promise<DbCreditAccount | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          `UPDATE org_credit_accounts
              SET available = available - $1,
                  reserved = reserved + $1,
                  updated_at = now()
            WHERE org_id = $2
              AND available >= $1
            RETURNING *`,
          [credits, orgId],
        );
        return row ? toAccount(row) : undefined;
      },
      async release(orgId: string, credits: number): Promise<DbCreditAccount> {
        const row = await one<QueryResultRow>(
          ctx,
          `UPDATE org_credit_accounts
              SET reserved = reserved - $1,
                  available = available + $1,
                  updated_at = now()
            WHERE org_id = $2
              AND reserved >= $1
            RETURNING *`,
          [credits, orgId],
        );
        if (!row) throw new Error('release failed: insufficient reserved credits');
        return toAccount(row);
      },
      async settle(
        orgId: string,
        reservedCredits: number,
        settledCredits: number,
      ): Promise<DbCreditAccount> {
        const refund = reservedCredits - settledCredits;
        const row = await one<QueryResultRow>(
          ctx,
          `UPDATE org_credit_accounts
              SET reserved = reserved - $1,
                  available = available + $2,
                  updated_at = now()
            WHERE org_id = $3
              AND reserved >= $1
            RETURNING *`,
          [reservedCredits, refund, orgId],
        );
        if (!row) throw new Error('settle failed: insufficient reserved credits');
        return toAccount(row);
      },
      async addAvailable(orgId: string, credits: number): Promise<DbCreditAccount> {
        const row = await one<QueryResultRow>(
          ctx,
          `UPDATE org_credit_accounts
              SET available = available + $1,
                  updated_at = now()
            WHERE org_id = $2
            RETURNING *`,
          [credits, orgId],
        );
        if (!row) throw new Error('addAvailable failed: account not found');
        return toAccount(row);
      },
    },
    creditLedger: {
      async create(input: {
        orgId: string;
        kind: DbCreditLedger['kind'];
        deltaAvailable: number;
        deltaReserved: number;
        reservationId?: string;
        purchaseId?: string;
      }): Promise<DbCreditLedgerWithCursor> {
        return toLedger(
          (await one<QueryResultRow>(
            ctx,
            `INSERT INTO credit_ledger (org_id, kind, delta_available, delta_reserved, reservation_id, purchase_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [
              input.orgId,
              input.kind,
              input.deltaAvailable,
              input.deltaReserved,
              input.reservationId ?? null,
              input.purchaseId ?? null,
            ],
          ))!,
        );
      },
      async listByOrgId(
        orgId: string,
        cursor: { createdAt: string; id: string } | null,
        limit: number,
      ): Promise<DbCreditLedgerWithCursor[]> {
        if (cursor) {
          const rows = await many<QueryResultRow>(
            ctx,
            `SELECT *,
                    to_char(
                      created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) AS cursor_created_at
               FROM credit_ledger
              WHERE org_id = $1
                AND (created_at, id) < ($2::timestamptz, $3)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [orgId, cursor.createdAt, cursor.id, limit + 1],
          );
          return rows.map(toLedger);
        }
        const rows = await many<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(
                    created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                  ) AS cursor_created_at
             FROM credit_ledger
            WHERE org_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [orgId, limit + 1],
        );
        return rows.map(toLedger);
      },
    },
    creditReservations: {
      async create(input: {
        orgId: string;
        userId: string;
        reservedCredits: number;
        maxTotalTokens: number;
        expiresAt: Date;
      }): Promise<DbCreditReservationWithCursor> {
        return toReservation(
          (await one<QueryResultRow>(
            ctx,
            `INSERT INTO credit_reservations (org_id, user_id, status, reserved_credits, max_total_tokens, expires_at)
             VALUES ($1, $2, 'reserved', $3, $4, $5)
             RETURNING *,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [
              input.orgId,
              input.userId,
              input.reservedCredits,
              input.maxTotalTokens,
              input.expiresAt,
            ],
          ))!,
        );
      },
      async findById(id: string): Promise<DbCreditReservation | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
             FROM credit_reservations
            WHERE id = $1`,
          [id],
        );
        return row ? toReservation(row) : undefined;
      },
      async findByIdForUpdate(id: string): Promise<DbCreditReservation | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
             FROM credit_reservations
            WHERE id = $1
              FOR UPDATE`,
          [id],
        );
        return row ? toReservation(row) : undefined;
      },
      async updateToSettled(
        id: string,
        actualTotalTokens: number,
        settledCredits: number,
      ): Promise<DbCreditReservation | undefined> {
        return toReservation(
          (await one<QueryResultRow>(
            ctx,
            `UPDATE credit_reservations
                SET status = 'settled',
                    actual_total_tokens = $2,
                    settled_credits = $3,
                    settled_at = now()
              WHERE id = $1
                AND status = 'reserved'
              RETURNING *,
                       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [id, actualTotalTokens, settledCredits],
          ))!,
        );
      },
      async updateToReleased(id: string): Promise<DbCreditReservation | undefined> {
        return toReservation(
          (await one<QueryResultRow>(
            ctx,
            `UPDATE credit_reservations
                SET status = 'released'
              WHERE id = $1
                AND status = 'reserved'
              RETURNING *,
                       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [id],
          ))!,
        );
      },
      async updateToExpired(id: string): Promise<DbCreditReservation | undefined> {
        return toReservation(
          (await one<QueryResultRow>(
            ctx,
            `UPDATE credit_reservations
                SET status = 'expired'
              WHERE id = $1
                AND status = 'reserved'
              RETURNING *,
                       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [id],
          ))!,
        );
      },
      async listExpiredReserved(limit: number): Promise<DbCreditReservation[]> {
        const rows = await many<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
             FROM credit_reservations
            WHERE status = 'reserved'
              AND expires_at < now()
            ORDER BY expires_at
            LIMIT $1`,
          [limit],
        );
        return rows.map(toReservation);
      },
      async listByOrgId(
        orgId: string,
        cursor: { createdAt: string; id: string } | null,
        limit: number,
      ): Promise<DbCreditReservationWithCursor[]> {
        if (cursor) {
          const rows = await many<QueryResultRow>(
            ctx,
            `SELECT *,
                    to_char(
                      created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) AS cursor_created_at
               FROM credit_reservations
              WHERE org_id = $1
                AND (created_at, id) < ($2::timestamptz, $3)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [orgId, cursor.createdAt, cursor.id, limit + 1],
          );
          return rows.map(toReservation);
        }
        const rows = await many<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(
                    created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                  ) AS cursor_created_at
             FROM credit_reservations
            WHERE org_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [orgId, limit + 1],
        );
        return rows.map(toReservation);
      },
      async listByUserId(
        orgId: string,
        userId: string,
        cursor: { createdAt: string; id: string } | null,
        limit: number,
      ): Promise<DbCreditReservationWithCursor[]> {
        if (cursor) {
          const rows = await many<QueryResultRow>(
            ctx,
            `SELECT *,
                    to_char(
                      created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) AS cursor_created_at
               FROM credit_reservations
              WHERE org_id = $1
                AND user_id = $2
                AND (created_at, id) < ($3::timestamptz, $4)
              ORDER BY created_at DESC, id DESC
              LIMIT $5`,
            [orgId, userId, cursor.createdAt, cursor.id, limit + 1],
          );
          return rows.map(toReservation);
        }
        const rows = await many<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(
                    created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                  ) AS cursor_created_at
             FROM credit_reservations
            WHERE org_id = $1
              AND user_id = $2
            ORDER BY created_at DESC, id DESC
            LIMIT $3`,
          [orgId, userId, limit + 1],
        );
        return rows.map(toReservation);
      },
    },
    purchases: {
      async create(input: {
        orgId: string;
        credits: number;
        initiatedByUserId: string;
        providerEventId?: string;
      }): Promise<DbPurchaseWithCursor> {
        return toPurchase(
          (await one<QueryResultRow>(
            ctx,
            `INSERT INTO purchases (org_id, credits, status, provider_event_id, initiated_by_user_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [
              input.orgId,
              input.credits,
              'pending',
              input.providerEventId ?? null,
              input.initiatedByUserId,
            ],
          ))!,
        );
      },
      async findById(id: string): Promise<DbPurchase | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
             FROM purchases
            WHERE id = $1`,
          [id],
        );
        return row ? toPurchase(row) : undefined;
      },
      async findByProviderEventId(providerEventId: string): Promise<DbPurchase | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
             FROM purchases
            WHERE provider_event_id = $1`,
          [providerEventId],
        );
        return row ? toPurchase(row) : undefined;
      },
      async markCompleted(id: string, providerEventId?: string): Promise<DbPurchase | undefined> {
        return toPurchase(
          (await one<QueryResultRow>(
            ctx,
            `UPDATE purchases
                SET status = 'completed',
                    completed_at = now(),
                    provider_event_id = COALESCE($2, provider_event_id)
              WHERE id = $1
                AND status = 'pending'
              RETURNING *,
                       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [id, providerEventId ?? null],
          ))!,
        );
      },
      async markFailed(id: string): Promise<DbPurchase | undefined> {
        return toPurchase(
          (await one<QueryResultRow>(
            ctx,
            `UPDATE purchases
                SET status = 'failed',
                    completed_at = now()
              WHERE id = $1
                AND status = 'pending'
              RETURNING *,
                       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`,
            [id],
          ))!,
        );
      },
      async listByOrgId(
        orgId: string,
        cursor: { createdAt: string; id: string } | null,
        limit: number,
      ): Promise<DbPurchaseWithCursor[]> {
        if (cursor) {
          const rows = await many<QueryResultRow>(
            ctx,
            `SELECT *,
                    to_char(
                      created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) AS cursor_created_at
               FROM purchases
              WHERE org_id = $1
                AND (created_at, id) < ($2::timestamptz, $3)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [orgId, cursor.createdAt, cursor.id, limit + 1],
          );
          return rows.map(toPurchase);
        }
        const rows = await many<QueryResultRow>(
          ctx,
          `SELECT *,
                  to_char(
                    created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                  ) AS cursor_created_at
             FROM purchases
            WHERE org_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [orgId, limit + 1],
        );
        return rows.map(toPurchase);
      },
    },
    idempotencyKeys: {
      async claim(input: {
        orgId: string;
        endpoint: string;
        key: string;
        fingerprint: Buffer;
        expiresAt: Date;
      }): Promise<DbIdempotencyKey | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          `INSERT INTO idempotency_keys (org_id, endpoint, key, request_fingerprint, status, expires_at)
           VALUES ($1, $2, $3, $4, 'pending', $5)
           ON CONFLICT (org_id, endpoint, key) DO NOTHING
           RETURNING *`,
          [input.orgId, input.endpoint, input.key, input.fingerprint, input.expiresAt],
        );
        return row ? toIdempotencyKey(row) : undefined;
      },
      async findByKey(
        orgId: string,
        endpoint: string,
        key: string,
      ): Promise<DbIdempotencyKey | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          'SELECT * FROM idempotency_keys WHERE org_id = $1 AND endpoint = $2 AND key = $3',
          [orgId, endpoint, key],
        );
        return row ? toIdempotencyKey(row) : undefined;
      },
      async markCompleted(input: {
        orgId: string;
        endpoint: string;
        key: string;
        responseStatus: number;
        responseBody: Record<string, unknown>;
        reservationId?: string;
      }): Promise<void> {
        await ctx.query(
          `UPDATE idempotency_keys
              SET status = 'completed',
                  response_status = $4,
                  response_body = $5,
                  reservation_id = $6,
                  completed_at = now()
            WHERE org_id = $1
              AND endpoint = $2
              AND key = $3
              AND status = 'pending'`,
          [
            input.orgId,
            input.endpoint,
            input.key,
            input.responseStatus,
            input.responseBody,
            input.reservationId ?? null,
          ],
        );
      },
      async markFailed(input: {
        orgId: string;
        endpoint: string;
        key: string;
        responseStatus: number;
        responseBody: Record<string, unknown>;
      }): Promise<void> {
        await ctx.query(
          `UPDATE idempotency_keys
              SET status = 'failed',
                  response_status = $4,
                  response_body = $5,
                  completed_at = now()
            WHERE org_id = $1
              AND endpoint = $2
              AND key = $3
              AND status = 'pending'`,
          [input.orgId, input.endpoint, input.key, input.responseStatus, input.responseBody],
        );
      },
      async listStalePending(olderThan: Date, limit: number): Promise<DbIdempotencyKey[]> {
        const rows = await many<QueryResultRow>(
          ctx,
          `SELECT * FROM idempotency_keys
            WHERE status = 'pending'
              AND expires_at < $1
            ORDER BY expires_at
            LIMIT $2`,
          [olderThan, limit],
        );
        return rows.map(toIdempotencyKey);
      },
    },
    webhookEvents: {
      async create(input: {
        providerEventId: string;
        payloadHash: Buffer;
      }): Promise<DbWebhookEvent | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          `INSERT INTO webhook_events (provider_event_id, payload_hash, received_at)
           VALUES ($1, $2, now())
           ON CONFLICT (provider_event_id) DO NOTHING
           RETURNING *`,
          [input.providerEventId, input.payloadHash],
        );
        return row ? (row as DbWebhookEvent) : undefined;
      },
      async findByProviderEventId(providerEventId: string): Promise<DbWebhookEvent | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          'SELECT * FROM webhook_events WHERE provider_event_id = $1',
          [providerEventId],
        );
        return row ? (row as DbWebhookEvent) : undefined;
      },
      async markProcessed(providerEventId: string): Promise<void> {
        await ctx.query(
          'UPDATE webhook_events SET processed_at = now() WHERE provider_event_id = $1',
          [providerEventId],
        );
      },
    },
    modelConfigurations: {
      async findByOrgId(orgId: string): Promise<DbModelConfiguration | undefined> {
        const row = await one<QueryResultRow>(
          ctx,
          'SELECT * FROM model_configurations WHERE org_id = $1',
          [orgId],
        );
        return row ? toModelConfiguration(row) : undefined;
      },
      async upsert(input: {
        orgId: string;
        deploymentMode: 'saas' | 'onprem';
        endpointUrl: string;
        modelName: string;
        timeoutMs: number;
        credentialCiphertext?: Buffer;
        credentialKeyVersion?: number;
        caBundle?: Buffer | null;
      }): Promise<DbModelConfiguration> {
        const credentialProvided = input.credentialCiphertext !== undefined;
        const row = await one<QueryResultRow>(
          ctx,
          `INSERT INTO model_configurations (
             org_id, deployment_mode, endpoint_url, model_name,
             credential_ciphertext, credential_key_version, credential_updated_at,
             timeout_ms, ca_bundle
           ) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5::bytea IS NULL THEN NULL ELSE now() END, $7, $8)
           ON CONFLICT (org_id) DO UPDATE SET
             deployment_mode = EXCLUDED.deployment_mode,
             endpoint_url = EXCLUDED.endpoint_url,
             model_name = EXCLUDED.model_name,
             timeout_ms = EXCLUDED.timeout_ms,
             ca_bundle = COALESCE(EXCLUDED.ca_bundle, model_configurations.ca_bundle),
             credential_ciphertext = CASE
               WHEN $9::boolean THEN EXCLUDED.credential_ciphertext
               ELSE model_configurations.credential_ciphertext
             END,
             credential_key_version = CASE
               WHEN $9::boolean THEN EXCLUDED.credential_key_version
               ELSE model_configurations.credential_key_version
             END,
             credential_updated_at = CASE
               WHEN $9::boolean THEN now()
               ELSE model_configurations.credential_updated_at
             END,
             updated_at = now()
           RETURNING *`,
          [
            input.orgId,
            input.deploymentMode,
            input.endpointUrl,
            input.modelName,
            input.credentialCiphertext ?? null,
            input.credentialKeyVersion ?? null,
            input.timeoutMs,
            input.caBundle === undefined ? null : input.caBundle,
            credentialProvided,
          ],
        );
        return toModelConfiguration(row!);
      },
    },
  };
}

export function createOrgDal(ctx: OrgTransactionContext | SystemTransactionContext) {
  const dal = createDal(ctx);
  return {
    organizations: dal.organizations,
    memberships: dal.memberships,
    invitations: dal.invitations,
    audit: dal.audit,
    creditAccounts: dal.creditAccounts,
    creditLedger: dal.creditLedger,
    creditReservations: dal.creditReservations,
    purchases: dal.purchases,
    idempotencyKeys: dal.idempotencyKeys,
    webhookEvents: dal.webhookEvents,
    modelConfigurations: dal.modelConfigurations,
  };
}

export function createSystemDal(ctx: SystemTransactionContext) {
  return createDal(ctx);
}

export type OrgDal = ReturnType<typeof createOrgDal>;
export type SystemDal = ReturnType<typeof createSystemDal>;
