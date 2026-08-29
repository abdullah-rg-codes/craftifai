import { execSync } from 'node:child_process';
import supertest from 'supertest';
import {
  createPool,
  databaseUrl,
  redisUrl,
  withSystemTransaction,
  createDal,
} from '@craftifai/db';
import { hashPassword } from '@craftifai/shared';
import { buildApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { createRedis } from '../src/redis.js';
import type { Application } from 'express';

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

export function createTestApp() {
  const logger = createLogger();
  const pool = createPool();
  const redis = createRedis();
  const app = buildApp(logger, pool, redis);
  return { app: supertest(app as Application), pool, redis, logger };
}

export async function directCreateUser(
  pool: ReturnType<typeof createPool>,
  email: string,
  password = 'password123',
): Promise<{ id: string; email: string; password: string }> {
  const passwordHash = await hashPassword(password);
  return withSystemTransaction(pool, async (ctx) => {
    const dal = createDal(ctx);
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
    const dal = createDal(ctx);
    const membership = await dal.memberships.create({ orgId, userId, role, status: 'active' });
    return { id: membership.id };
  });
}

export function getCookies(response: supertest.Response): string[] {
  const header = response.headers['set-cookie'];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

export async function registerAndLogin(
  app: ReturnType<typeof supertest>,
  email: string,
): Promise<{ userId: string; orgId: string; cookie: string[] }> {
  const registerResponse = await app.post('/auth/register').send({ email, password: 'password123' });
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

export async function login(
  app: ReturnType<typeof supertest>,
  email: string,
  password: string,
): Promise<string[]> {
  const response = await app.post('/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed: ${response.status} ${response.text}`);
  }
  return getCookies(response);
}

export async function truncateTables(pool: ReturnType<typeof createPool>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.is_system = 'true'");
    await client.query(`
      TRUNCATE TABLE
        audit_events,
        idempotency_keys,
        webhook_events,
        purchases,
        credit_reservations,
        credit_ledger,
        org_credit_accounts,
        invitations,
        memberships,
        organizations,
        sessions,
        users
      RESTART IDENTITY CASCADE;
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
