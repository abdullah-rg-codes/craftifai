import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { DatabasePool } from '@craftifai/db';
import {
  generateSessionToken,
  extractSessionToken,
  requireAdmin,
  requireAuth,
  SESSION_REVOCATION_WINDOW_SECONDS,
  resolveAuthContext,
  type AuthContext,
} from '../src/auth.js';
import { AppError } from '@craftifai/shared';
import type { Request } from 'express';

const memberContext: AuthContext = {
  userId: '2f041dfa-986f-450d-b670-7d4bcf42b14a',
  email: 'member@example.com',
  sessionId: 'session-hash',
  orgId: '81c88c6d-524d-49eb-aa6e-d4a48f2e2bda',
  membershipId: '827f39b2-a293-4e53-b6c9-986be94688e9',
  role: 'member',
};

describe('authentication rules', () => {
  it('keeps the documented revocation fallback window at 60 seconds', () => {
    expect(SESSION_REVOCATION_WINDOW_SECONDS).toBe(60);
  });

  it('generates an opaque 256-bit token and its SHA-256 hash', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(first.hash).toBe(createHash('sha256').update(first.token).digest('base64url'));
    expect(second.token).not.toBe(first.token);
    expect(second.hash).not.toBe(first.hash);
  });

  it('accepts only a verified signed session cookie', async () => {
    const unsigned = {
      signedCookies: {},
      cookies: { craftifai_session: 'attacker-controlled' },
    } as unknown as Request;
    const signed = {
      signedCookies: { craftifai_session: 'verified-token' },
      cookies: {},
    } as unknown as Request;

    await expect(extractSessionToken(unsigned)).resolves.toBeUndefined();
    await expect(extractSessionToken(signed)).resolves.toBe('verified-token');
  });

  it('rejects a missing authentication context with a typed 401', () => {
    expect(() => requireAuth(undefined)).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        code: 'UNAUTHORIZED',
        status: 401,
      }),
    );
  });

  it('accepts an authenticated context unchanged', () => {
    expect(requireAuth(memberContext)).toBe(memberContext);
  });

  it('rejects members from administrator operations with a typed 403', () => {
    expect(() => requireAdmin(memberContext)).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        code: 'FORBIDDEN',
        status: 403,
      }),
    );
  });

  it('accepts administrators', () => {
    expect(() => requireAdmin({ ...memberContext, role: 'administrator' })).not.toThrow();
  });

  it('rejects a revocation tombstone before consulting cache or PostgreSQL', async () => {
    const pool = {
      connect: vi.fn(),
      end: vi.fn(),
    } as unknown as DatabasePool;
    const redis = {
      exists: vi.fn().mockResolvedValue(1),
      get: vi.fn(),
    } as unknown as Redis;

    await expect(
      resolveAuthContext(pool, redis, 'revoked-hash', undefined),
    ).resolves.toBeUndefined();
    expect(redis.get).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects and evicts a cached session at its exact database expiry', async () => {
    const pool = {
      connect: vi.fn(),
      end: vi.fn(),
    } as unknown as DatabasePool;
    const redis = {
      exists: vi.fn().mockResolvedValue(0),
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          userId: memberContext.userId,
          email: memberContext.email,
          sessionExpiresAt: new Date(Date.now() - 1).toISOString(),
          memberships: [],
        }),
      ),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    await expect(
      resolveAuthContext(pool, redis, 'expired-hash', undefined),
    ).resolves.toBeUndefined();
    expect(redis.del).toHaveBeenCalledWith('session:expired-hash');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('returns 404 when a valid session asks for an organization it does not belong to', async () => {
    const pool = {
      connect: vi.fn(),
      end: vi.fn(),
    } as unknown as DatabasePool;
    const redis = {
      exists: vi.fn().mockResolvedValue(0),
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          userId: memberContext.userId,
          email: memberContext.email,
          sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          memberships: [
            {
              id: memberContext.membershipId,
              orgId: memberContext.orgId,
              role: 'member',
              status: 'active',
            },
          ],
        }),
      ),
      del: vi.fn(),
    } as unknown as Redis;

    await expect(
      resolveAuthContext(pool, redis, 'session-hash', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({
        code: 'NOT_FOUND',
        status: 404,
      }),
    );
    await expect(resolveAuthContext(pool, redis, 'session-hash', undefined)).resolves.toEqual(
      expect.objectContaining({ orgId: memberContext.orgId }),
    );
  });
});
