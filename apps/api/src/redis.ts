import { Redis } from 'ioredis';
import { redisUrl } from '@craftifai/db';

export function createRedis(): Redis {
  return new Redis(redisUrl());
}
