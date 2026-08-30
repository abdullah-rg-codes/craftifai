import { execSync } from 'node:child_process';
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
import type { Application } from 'express';
import type { Redis } from 'ioredis';
import type { DatabasePool } from '@craftifai/db';

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
  const adminPool = createPool({
    connectionString: databaseAdminUrl(),
    max: 2,
  });
  const app = buildApp(logger, pool, redis);
  return { app: supertest(app as Application), pool, adminPool, redis, logger };
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

export function getCookies(response: supertest.Response): string[] {
  const header = response.headers['set-cookie'];
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

export async function registerAndLogin(
  app: ReturnType<typeof supertest>,
  email: string,
): Promise<{ userId: string; orgId: string; cookie: string[] }> {
  const registerResponse = await app
    .post('/auth/register')
    .send({ email, password: 'password123' });
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

export async function truncateTables(adminPool: DatabasePool, redis: Redis): Promise<void> {
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
  await redis.flushdb();
}
