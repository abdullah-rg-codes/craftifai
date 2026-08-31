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

/** Ceiling for the whole HTTP request. Must exceed max org model timeout (120s) plus settle. */
export const API_REQUEST_TIMEOUT_MIN_MS = 130_000;
export const API_REQUEST_TIMEOUT_DEFAULT_MS = 180_000;

export function apiRequestTimeoutMs(): number {
  const raw = process.env.API_REQUEST_TIMEOUT_MS ?? String(API_REQUEST_TIMEOUT_DEFAULT_MS);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < API_REQUEST_TIMEOUT_MIN_MS) {
    throw new Error(
      `API_REQUEST_TIMEOUT_MS must be an integer >= ${String(API_REQUEST_TIMEOUT_MIN_MS)}`,
    );
  }
  return parsed;
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
  apiRequestTimeoutMs();
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
  apiRequestTimeoutMs,
  readMountedSecret,
  cookieSecure,
} as const;
