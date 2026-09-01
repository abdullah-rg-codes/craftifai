import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { withSystemTransaction, createSystemDal, type DatabasePool } from '@craftifai/db';
import { hashPassword, verifyPassword, AppError, notFound, unauthorized } from '@craftifai/shared';
import { cookieSecure } from './env.js';

const SESSION_COOKIE = 'craftifai_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
export const SESSION_REVOCATION_WINDOW_SECONDS = 60;

interface SessionCache {
  readonly userId: string;
  readonly email: string;
  readonly sessionExpiresAt: string;
  readonly memberships: readonly {
    readonly id: string;
    readonly orgId: string;
    readonly role: 'administrator' | 'member';
    readonly status: 'active' | 'suspended';
  }[];
}

export interface AuthContext {
  readonly userId: string;
  readonly email: string;
  readonly sessionId: string;
  readonly orgId: string;
  readonly membershipId: string;
  readonly role: 'administrator' | 'member';
}

export function generateSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('base64url');
  return { token, hash };
}

function sessionKey(hash: string): string {
  return `session:${hash}`;
}

function revokedSessionKey(hash: string): string {
  return `session_revoked:${hash}`;
}

function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

export async function createSession(
  pool: DatabasePool,
  redis: Redis,
  userId: string,
): Promise<{ token: string; hash: string }> {
  const { token, hash } = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    await dal.sessions.create({ userId, tokenHash: hash, expiresAt });
  });
  await redis
    .multi()
    .sadd(userSessionsKey(userId), hash)
    .expire(userSessionsKey(userId), SESSION_TTL_SECONDS)
    .exec();
  return { token, hash };
}

export async function invalidateUserSessionCache(redis: Redis, userId: string): Promise<void> {
  const hashes = await redis.smembers(userSessionsKey(userId));
  if (hashes.length > 0) {
    await redis.del(...hashes.map(sessionKey));
  }
  await redis.del(userSessionsKey(userId));
}

export async function invalidateRevokedUserSessions(redis: Redis, userId: string): Promise<void> {
  const hashes = await redis.smembers(userSessionsKey(userId));
  const pipeline = redis.multi();
  for (const hash of hashes) {
    pipeline.setex(revokedSessionKey(hash), SESSION_REVOCATION_WINDOW_SECONDS, '1');
    pipeline.del(sessionKey(hash));
  }
  pipeline.del(userSessionsKey(userId));
  await pipeline.exec();
}

export async function revokeSessionByHash(
  pool: DatabasePool,
  redis: Redis,
  tokenHash: string,
): Promise<void> {
  await withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    const session = await dal.sessions.findByTokenHash(tokenHash);
    if (session) {
      await dal.sessions.revokeById(session.id);
    }
  });
  await redis
    .multi()
    .setex(revokedSessionKey(tokenHash), SESSION_REVOCATION_WINDOW_SECONDS, '1')
    .del(sessionKey(tokenHash))
    .exec();
}

export async function revokeAllSessionsForUser(
  pool: DatabasePool,
  redis: Redis,
  userId: string,
): Promise<void> {
  await withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    await dal.sessions.revokeAllForUser(userId);
  });
  await invalidateRevokedUserSessions(redis, userId);
}

async function loadSessionFromDb(
  pool: DatabasePool,
  tokenHash: string,
): Promise<SessionCache | undefined> {
  return withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    const session = await dal.sessions.findByTokenHash(tokenHash);
    if (!session || session.revoked_at || session.expires_at < new Date()) {
      return undefined;
    }
    const user = await dal.users.findById(session.user_id);
    if (!user) {
      return undefined;
    }
    const memberships = await dal.memberships.listByUserId(session.user_id);
    return {
      userId: user.id,
      email: user.email,
      sessionExpiresAt: session.expires_at.toISOString(),
      memberships: memberships.map((m) => ({
        id: m.id,
        orgId: m.org_id,
        role: m.role,
        status: m.status,
      })),
    };
  });
}

async function getSessionCache(
  pool: DatabasePool,
  redis: Redis,
  tokenHash: string,
): Promise<SessionCache | undefined> {
  if (await redis.exists(revokedSessionKey(tokenHash))) {
    return undefined;
  }
  const cached = await redis.get(sessionKey(tokenHash));
  if (cached) {
    const parsed = JSON.parse(cached) as SessionCache;
    if (new Date(parsed.sessionExpiresAt).getTime() <= Date.now()) {
      await redis.del(sessionKey(tokenHash));
      return undefined;
    }
    return parsed;
  }
  const fromDb = await loadSessionFromDb(pool, tokenHash);
  if (fromDb) {
    if (await redis.exists(revokedSessionKey(tokenHash))) {
      return undefined;
    }
    const remainingSeconds = Math.max(
      1,
      Math.floor((new Date(fromDb.sessionExpiresAt).getTime() - Date.now()) / 1000),
    );
    await redis.setex(
      sessionKey(tokenHash),
      Math.min(SESSION_REVOCATION_WINDOW_SECONDS, remainingSeconds),
      JSON.stringify(fromDb),
    );
  }
  return fromDb;
}

export async function resolveAuthContext(
  pool: DatabasePool,
  redis: Redis,
  tokenHash: string,
  requestedOrgId: string | undefined,
): Promise<AuthContext | undefined> {
  const cache = await getSessionCache(pool, redis, tokenHash);
  if (!cache) {
    return undefined;
  }
  const activeMemberships = cache.memberships.filter((m) => m.status === 'active');
  if (activeMemberships.length === 0) {
    return undefined;
  }
  const membership = requestedOrgId
    ? activeMemberships.find((m) => m.orgId === requestedOrgId)
    : activeMemberships[0];
  if (!membership) {
    if (requestedOrgId) {
      throw notFound('Organization not found');
    }
    return undefined;
  }
  return {
    userId: cache.userId,
    email: cache.email,
    sessionId: tokenHash,
    orgId: membership.orgId,
    membershipId: membership.id,
    role: membership.role,
  };
}

export async function extractSessionToken(req: Request): Promise<string | undefined> {
  const signed = req.signedCookies[SESSION_COOKIE] as unknown;
  return typeof signed === 'string' ? signed : undefined;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    signed: true,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    signed: true,
  });
}

export async function registerUser(
  pool: DatabasePool,
  redis: Redis,
  input: { email: string; password: string; displayName: string },
): Promise<{ userId: string; orgId: string; token: string }> {
  const passwordHash = await hashPassword(input.password);
  const { userId, orgId } = await withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    const user = await dal.users.create({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    });
    const org = await dal.organizations.create(input.displayName);
    const membership = await dal.memberships.create({
      orgId: org.id,
      userId: user.id,
      role: 'administrator',
      status: 'active',
    });
    await dal.audit.create({
      orgId: org.id,
      actorUserId: user.id,
      action: 'membership.create',
      targetType: 'membership',
      targetId: membership.id,
      metadata: { role: 'administrator', bootstrap: true },
    });
    // Seed a zero balance so credit operations have a row to update atomically.
    await ctx.query(
      'INSERT INTO org_credit_accounts (org_id, available, reserved) VALUES ($1, 0, 0)',
      [org.id],
    );
    return { userId: user.id, orgId: org.id };
  });
  const { token } = await createSession(pool, redis, userId);
  return { userId, orgId, token };
}

export async function loginUser(
  pool: DatabasePool,
  redis: Redis,
  input: { email: string; password: string },
): Promise<{ userId: string; token: string } | undefined> {
  const user = await withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    return dal.users.findByEmail(input.email);
  });
  if (!user) {
    await hashPassword(input.password);
    return undefined;
  }
  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    return undefined;
  }
  const { token } = await createSession(pool, redis, user.id);
  return { userId: user.id, token };
}

export function requireAuth(ctx: AuthContext | undefined): AuthContext {
  if (!ctx) {
    throw unauthorized('Invalid or expired session');
  }
  return ctx;
}

export function requireAdmin(ctx: AuthContext): void {
  if (ctx.role !== 'administrator') {
    throw new AppError('FORBIDDEN', 'Administrator role required', 403);
  }
}
