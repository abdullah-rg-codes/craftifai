import {
  databaseUrl,
  redisUrl,
  sessionSecret as sessionSecretFn,
  encryptionKey,
  webhookSecret,
  modelTimeoutMs,
  modelMaxRetries,
  allowedPrivateCidrs,
  readMountedSecret,
} from '@craftifai/db';

export const sessionSecret = sessionSecretFn;

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number.parseInt(process.env.API_PORT ?? '3000', 10),
  databaseUrl,
  redisUrl,
  sessionSecret: sessionSecretFn,
  encryptionKey,
  webhookSecret,
  modelTimeoutMs,
  modelMaxRetries,
  allowedPrivateCidrs,
  readMountedSecret,
} as const;
