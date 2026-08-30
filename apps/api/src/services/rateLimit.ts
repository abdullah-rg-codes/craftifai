import type { Redis } from 'ioredis';
import { rateLimited } from '@craftifai/shared';

const WINDOW_SECONDS = 60;

function orgLimit(): number {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_ORG_PER_MINUTE ?? '600', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600;
}

function userLimit(): number {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_USER_PER_MINUTE ?? '300', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

async function hit(
  redis: Redis,
  key: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }
  const ttl = await redis.ttl(key);
  const retryAfterSeconds = ttl > 0 ? ttl : WINDOW_SECONDS;
  return { allowed: count <= limit, retryAfterSeconds };
}

export async function assertWithinRateLimit(
  redis: Redis,
  orgId: string,
  userId: string,
): Promise<void> {
  const org = await hit(redis, `rl:org:${orgId}`, orgLimit());
  if (!org.allowed) {
    throw rateLimited(org.retryAfterSeconds);
  }
  const user = await hit(redis, `rl:user:${userId}`, userLimit());
  if (!user.allowed) {
    throw rateLimited(user.retryAfterSeconds);
  }
}
