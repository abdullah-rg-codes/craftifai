import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { withSystemTransaction, createDal } from '@craftifai/db';
import { hashPassword, verifyPassword, AppError, unauthorized } from '@craftifai/shared';

const SESSION_COOKIE = 'craftifai_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const CACHE_TTL_SECONDS = 60;

interface SessionCache {
  readonly userId: string;
  readonly email: string;
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

function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

export async function createSession(
  pool: Pool,
  redis: Redis,
  userId: string,
): Promise<{ token: string; hash: string }> {
  const { token, hash } = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
    await dal.sessions.create({ userId, tokenHash: hash, expiresAt });
  });
  await redis.sadd(userSessionsKey(userId), hash);
  return { token, hash };
}

async function invalidateAllUserSessions(redis: Redis, userId: string): Promise<void> {
  const hashes = await redis.smembers(userSessionsKey(userId));
  if (hashes.length > 0) {
    await redis.del(...hashes.map(sessionKey));
  }
  await redis.del(userSessionsKey(userId));
}

export async function revokeSessionByHash(
  pool: Pool,
  redis: Redis,
  tokenHash: string,
): Promise<void> {
  await withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
    const session = await dal.sessions.findByTokenHash(tokenHash);
    if (session) {
      await dal.sessions.revokeById(session.id);
    }
  });
  await redis.del(sessionKey(tokenHash));
}

export async function revokeAllSessionsForUser(
  pool: Pool,
  redis: Redis,
  userId: string,
): Promise<void> {
  await withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
    await dal.sessions.revokeAllForUser(userId);
  });
  await invalidateAllUserSessions(redis, userId);
}

async function loadSessionFromDb(
  pool: Pool,
  tokenHash: string,
): Promise<SessionCache | undefined> {
  return withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
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
  pool: Pool,
  redis: Redis,
  tokenHash: string,
): Promise<SessionCache | undefined> {
  const cached = await redis.get(sessionKey(tokenHash));
  if (cached) {
    return JSON.parse(cached) as SessionCache;
  }
  const fromDb = await loadSessionFromDb(pool, tokenHash);
  if (fromDb) {
    await redis.setex(sessionKey(tokenHash), CACHE_TTL_SECONDS, JSON.stringify(fromDb));
  }
  return fromDb;
}

export async function resolveAuthContext(
  pool: Pool,
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
  const signed = req.signedCookies[SESSION_COOKIE] as string | undefined;
  if (signed) {
    return signed;
  }
  return req.cookies[SESSION_COOKIE] as string | undefined;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    signed: true,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    signed: true,
  });
}

export async function registerUser(
  pool: Pool,
  redis: Redis,
  input: { email: string; password: string; displayName?: string | undefined },
): Promise<{ userId: string; orgId: string; token: string }> {
  const passwordHash = await hashPassword(input.password);
  const { userId, orgId } = await withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
    const user = await dal.users.create({
      email: input.email,
      passwordHash,
      displayName: input.displayName ?? null,
    });
    const org = await dal.organizations.create(`${input.email}'s organization`);
    await dal.memberships.create({
      orgId: org.id,
      userId: user.id,
      role: 'administrator',
      status: 'active',
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
  pool: Pool,
  redis: Redis,
  input: { email: string; password: string },
): Promise<{ userId: string; token: string } | undefined> {
  const user = await withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
    return dal.users.findByEmail(input.email);
  });
  if (!user) {
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
