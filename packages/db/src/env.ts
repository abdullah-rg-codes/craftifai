import { readFile } from 'node:fs/promises';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function databaseUrl(): string {
  return requireEnv('DATABASE_URL');
}

export function databaseAdminUrl(): string {
  return process.env.DATABASE_ADMIN_URL ?? databaseUrl();
}

export function redisUrl(): string {
  return requireEnv('REDIS_URL');
}

export function encryptionKey(): Promise<Buffer> {
  const base64 = requireEnv('ENCRYPTION_KEY_BASE64');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    return Promise.reject(new Error('ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes'));
  }
  return Promise.resolve(key);
}

export function sessionSecret(): string {
  return requireEnv('SESSION_SECRET');
}

export function webhookSecret(): string {
  return requireEnv('WEBHOOK_SECRET');
}

export function modelTimeoutMs(): number {
  const raw = process.env.MODEL_TIMEOUT_MS ?? '30000';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1000) {
    throw new Error('MODEL_TIMEOUT_MS must be a positive integer >= 1000');
  }
  return parsed;
}

export function modelMaxRetries(): number {
  const raw = process.env.MODEL_MAX_RETRIES ?? '2';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error('MODEL_MAX_RETRIES must be a non-negative integer');
  }
  return parsed;
}

export function allowedPrivateCidrs(): string[] {
  const raw = process.env.ALLOWED_PRIVATE_CIDRS ?? '';
  return raw
    .split(' ')
    .map((c) => c.trim())
    .filter(Boolean);
}

export async function readMountedSecret(path: string): Promise<string> {
  return readFile(path, 'utf-8').then((s) => s.trim());
}
