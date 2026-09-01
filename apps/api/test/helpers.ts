import { execSync } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import supertest from 'supertest';
import {
  createPool,
  databaseAdminUrl,
  databaseUrl,
  redisUrl,
  withSystemTransaction,
  createSystemDal,
} from '@craftifai/db';
import { hashPassword } from '@craftifai/shared';
import { buildApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { createRedis } from '../src/redis.js';
import { encryptCredential } from '../src/services/crypto.js';
import type { Application } from 'express';
import type { Redis } from 'ioredis';
import type { DatabasePool } from '@craftifai/db';
import { RemoteAgent, testBaseUrl, type TestAgent } from './remoteAgent.js';

export function hasTestDatabase(): boolean {
  try {
    databaseUrl();
    return true;
  } catch {
    return false;
  }
}

export function hasTestRedis(): boolean {
  try {
    redisUrl();
    return true;
  } catch {
    return false;
  }
}

export function runMigrations(): void {
  execSync('pnpm db:migrate', {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'ignore',
  });
}

export function createTestApp(options: { logger?: ReturnType<typeof createLogger> } = {}) {
  const logger = options.logger ?? createLogger();
  const pool = createPool();
  const redis = createRedis();
  const adminPool = createPool({
    connectionString: databaseAdminUrl(),
    max: 8,
  });
  const expressApp = buildApp(logger, pool, redis) as Application;
  const remote = testBaseUrl();
  const app: TestAgent = remote
    ? new RemoteAgent(remote)
    : (supertest(expressApp) as unknown as TestAgent);
  return { app, expressApp, pool, adminPool, redis, logger };
}

export async function startTestServer(
  expressApp: Application,
): Promise<{ url: string; close: () => Promise<void> }> {
  const remote = testBaseUrl();
  if (remote) {
    return { url: remote, close: async () => undefined };
  }
  const server = http.createServer(expressApp);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not bind a TCP port');
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

export function cookieHeader(cookies: string[]): string {
  return cookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter((part): part is string => Boolean(part))
    .join('; ');
}

export interface TestHttpResponse {
  status: number;
  body: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
}

export function postJson(
  baseUrl: string,
  path: string,
  options: {
    cookie?: string[];
    headers?: Record<string, string>;
    body?: unknown;
    rawBody?: string;
  },
): Promise<TestHttpResponse> {
  const payload = Buffer.from(options.rawBody ?? JSON.stringify(options.body ?? {}), 'utf8');
  const requestHeaders: http.OutgoingHttpHeaders = {
    'content-type': 'application/json',
    'content-length': payload.length,
    connection: 'close',
    ...options.headers,
  };
  if (options.cookie && options.cookie.length > 0) {
    requestHeaders.cookie = cookieHeader(options.cookie);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${path}`,
      { method: 'POST', agent: false, headers: requestHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          if (raw.length > 0) {
            try {
              const parsed: unknown = JSON.parse(raw);
              if (typeof parsed === 'object' && parsed !== null) {
                body = parsed as Record<string, unknown>;
              }
            } catch {
              body = { raw };
            }
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export async function directCreateUser(
  pool: ReturnType<typeof createPool>,
  email: string,
  password = 'password123',
): Promise<{ id: string; email: string; password: string }> {
  const passwordHash = await hashPassword(password);
  return withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    const user = await dal.users.create({ email, passwordHash, displayName: email });
    return { id: user.id, email: user.email, password };
  });
}

export async function directAddMember(
  pool: ReturnType<typeof createPool>,
  orgId: string,
  userId: string,
  role: 'administrator' | 'member' = 'member',
): Promise<{ id: string }> {
  return withSystemTransaction(pool, async (ctx) => {
    const dal = createSystemDal(ctx);
    const membership = await dal.memberships.create({ orgId, userId, role, status: 'active' });
    return { id: membership.id };
  });
}

export function getCookies(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie'];
  if (!header) return [];
  return Array.isArray(header) ? header.map(String) : [String(header)];
}

export async function registerAndLogin(
  app: TestAgent,
  email: string,
): Promise<{ userId: string; orgId: string; cookie: string[] }> {
  const registerResponse = await app
    .post('/auth/register')
    .send({ email, password: 'password123', display_name: email });
  if (registerResponse.status !== 201) {
    throw new Error(`Registration failed: ${registerResponse.status} ${registerResponse.text}`);
  }
  const loginResponse = await app.post('/auth/login').send({ email, password: 'password123' });
  if (loginResponse.status !== 200) {
    throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.text}`);
  }
  return {
    userId: registerResponse.body.user_id as string,
    orgId: registerResponse.body.org_id as string,
    cookie: getCookies(loginResponse),
  };
}

export async function login(app: TestAgent, email: string, password: string): Promise<string[]> {
  const response = await app.post('/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed: ${response.status} ${response.text}`);
  }
  return getCookies(response);
}

export async function seedCredits(
  adminPool: DatabasePool,
  orgId: string,
  credits: number,
): Promise<void> {
  await withSystemTransaction(adminPool, async (ctx) => {
    const dal = createSystemDal(ctx);
    await dal.creditAccounts.getOrCreate(orgId);
    await dal.creditAccounts.addAvailable(orgId, credits);
    await dal.creditLedger.create({
      orgId,
      kind: 'purchase',
      deltaAvailable: credits,
      deltaReserved: 0,
    });
  });
}

export async function seedModelConfig(
  adminPool: DatabasePool,
  orgId: string,
  options: {
    endpointUrl: string;
    credential: string;
    timeoutMs?: number;
    modelName?: string;
  },
): Promise<void> {
  const encrypted = await encryptCredential(options.credential);
  await withSystemTransaction(adminPool, async (ctx) => {
    await createSystemDal(ctx).modelConfigurations.upsert({
      orgId,
      deploymentMode: 'saas',
      endpointUrl: options.endpointUrl,
      modelName: options.modelName ?? 'mock-model',
      timeoutMs: options.timeoutMs ?? 5000,
      credentialCiphertext: encrypted.ciphertext,
      credentialKeyVersion: encrypted.keyVersion,
    });
  });
}

export async function truncateTables(adminPool: DatabasePool, redis: Redis): Promise<void> {
  const janitor = await adminPool.connect();
  try {
    await janitor.query('ROLLBACK').catch(() => undefined);
    await janitor.query(`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND backend_type = 'client backend'
         AND state IN ('idle in transaction', 'idle in transaction (aborted)')
    `);
  } finally {
    janitor.release();
  }

  const maxAttempts = 8;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await withSystemTransaction(adminPool, async (ctx) => {
        await ctx.query(`
          TRUNCATE TABLE
            audit_events,
            idempotency_keys,
            webhook_events,
            purchases,
            credit_ledger,
            credit_reservations,
            org_credit_accounts,
            model_configurations,
            invitations,
            memberships,
            organizations,
            sessions,
            users
          CASCADE
        `);
      });
      lastError = undefined;
      break;
    } catch (error: unknown) {
      lastError = error;
      const code = postgresErrorCode(error);
      if (code !== '40P01' && code !== '55P03' && code !== '57P01' && code !== '57P03') {
        throw error;
      }
      await delay(50 * (attempt + 1));
    }
  }
  if (lastError) {
    throw lastError;
  }
  await redis.flushdb();
}
