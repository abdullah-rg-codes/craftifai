import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { AppError } from '@craftifai/shared';
import { assertWithinRateLimit } from '../src/services/rateLimit.js';

describe('rate limit Redis failures', () => {
  it('fails closed with 503 when Redis cannot increment', async () => {
    const redis = {
      incr: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      expire: vi.fn(),
      ttl: vi.fn(),
    } as unknown as Redis;

    await expect(assertWithinRateLimit(redis, 'org', 'user')).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      }),
    );
  });

  it('still returns 429 when the counter is over the limit', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(10_000),
      expire: vi.fn(),
      ttl: vi.fn().mockResolvedValue(30),
    } as unknown as Redis;

    await expect(assertWithinRateLimit(redis, 'org', 'user')).rejects.toEqual(
      expect.objectContaining<Partial<AppError>>({
        code: 'RATE_LIMITED',
        status: 429,
      }),
    );
  });
});
