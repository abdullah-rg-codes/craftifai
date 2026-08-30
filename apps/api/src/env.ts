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

export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true';
}

export async function loadModelCaBundle(): Promise<Buffer | undefined> {
  const path = process.env.MODEL_CA_BUNDLE_FILE;
  if (!path) {
    return undefined;
  }
  const pem = await readMountedSecret(path);
  return Buffer.from(pem, 'utf8');
}

export async function validateRuntimeConfig(): Promise<void> {
  databaseUrl();
  redisUrl();
  sessionSecretFn();
  webhookSecret();
  await encryptionKey();
  modelTimeoutMs();
  modelMaxRetries();
  allowedPrivateCidrs();
  if (process.env.MODEL_CA_BUNDLE_FILE) {
    await loadModelCaBundle();
  }
}

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
  cookieSecure,
} as const;
