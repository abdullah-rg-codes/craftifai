import {
  databaseUrl,
  redisUrl,
  sessionSecret,
  encryptionKey,
  webhookSecret,
  modelTimeoutMs,
  modelMaxRetries,
  allowedPrivateCidrs,
  readMountedSecret,
} from '@craftifai/db';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number.parseInt(process.env.API_PORT ?? '3000', 10),
  databaseUrl,
  redisUrl,
  sessionSecret,
  encryptionKey,
  webhookSecret,
  modelTimeoutMs,
  modelMaxRetries,
  allowedPrivateCidrs,
  readMountedSecret,
} as const;
