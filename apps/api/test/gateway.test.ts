import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import pino from 'pino';
import { withSystemTransaction, type DatabasePool } from '@craftifai/db';
import { buildMockModelApp } from '@craftifai/mock-model/app';
import {
  createTestApp,
  hasTestDatabase,
  hasTestRedis,
  registerAndLogin,
  runMigrations,
  seedCredits,
  seedModelConfig,
  startTestServer,
  truncateTables,
} from './helpers.js';
import { createLogger } from '../src/logger.js';

const describeIf = hasTestDatabase() && hasTestRedis() ? describe : describe.skip;
const MOCK_MODEL_KEY = 'gateway-model-secret';

function captureLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { logger: createLogger(stream as unknown as pino.DestinationStream), lines };
}

describeIf('Phase 3 model gateway', () => {
  let app: ReturnType<typeof supertest>;
  let pool: DatabasePool;
  let adminPool: DatabasePool;
  let redis: Awaited<ReturnType<typeof createTestApp>>['redis'];
  let mockUrl: string;
  let closeMock: () => Promise<void>;
  let logLines: string[];

  async function configure(
    orgId: string,
    options: { behavior?: string; timeoutMs?: number; redirectTo?: string } = {},
  ): Promise<void> {
    const params = new URLSearchParams({ latency_ms: '0' });
    if (options.behavior) {
      params.set('behavior', options.behavior);
    }
    if (options.redirectTo) {
      params.set('behavior', 'redirect');
      params.set('redirect_to', options.redirectTo);
    }
    if (options.behavior === 'slow') {
      params.set('latency_ms', '2000');
    }
    await seedModelConfig(adminPool, orgId, {
      endpointUrl: `${mockUrl}/v1/chat/completions?${params.toString()}`,
      credential: MOCK_MODEL_KEY,
      timeoutMs: options.timeoutMs ?? 5000,
    });
  }

  async function balance(cookie: string[]): Promise<{ available: number; reserved: number }> {
    const response = await app.get('/credits/account').set('Cookie', cookie).expect(200);
    return {
      available: response.body.available as number,
      reserved: response.body.reserved as number,
    };
  }

  beforeAll(async () => {
    process.env.ALLOWED_PRIVATE_CIDRS = '127.0.0.0/8';
    process.env.MOCK_MODEL_API_KEY = MOCK_MODEL_KEY;
    process.env.ENCRYPTION_KEY_BASE64 ??= Buffer.alloc(32, 3).toString('base64');
    runMigrations();
    const captured = captureLogger();
    logLines = captured.lines;
    const testApp = createTestApp({ logger: captured.logger });
    app = testApp.app;
    pool = testApp.pool;
    adminPool = testApp.adminPool;
    redis = testApp.redis;
    const mock = await startTestServer(buildMockModelApp());
    mockUrl = mock.url;
    closeMock = mock.close;
  });

  beforeEach(async () => {
    await truncateTables(adminPool, redis);
    logLines.length = 0;
  });

  afterAll(async () => {
    await closeMock?.();
    await redis?.quit();
    await pool?.end();
    await adminPool?.end();
  });

  it('settles a successful inference and never returns the credential', async () => {
    const admin = await registerAndLogin(app, 'gateway-ok@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await configure(admin.orgId);

    const inference = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-ok')
      .send({ max_total_tokens: 2000 })
      .expect(200);

    expect(inference.body.settled_credits).toBe(1);
    expect(JSON.stringify(inference.body)).not.toContain(MOCK_MODEL_KEY);

    const config = await app.get('/model-config').set('Cookie', admin.cookie).expect(200);
    expect(config.body.credential_set).toBe(true);
    expect(config.body).not.toHaveProperty('credential');
    expect(JSON.stringify(config.body)).not.toContain(MOCK_MODEL_KEY);

    expect(await balance(admin.cookie)).toEqual({ available: 9, reserved: 0 });
  });

  it('releases the reservation when the model times out', async () => {
    const admin = await registerAndLogin(app, 'gateway-timeout@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await configure(admin.orgId, { behavior: 'slow', timeoutMs: 1000 });

    const response = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-timeout')
      .send({ max_total_tokens: 1000 })
      .expect(504);

    expect(response.body.error.code).toBe('MODEL_TIMEOUT');
    expect(await balance(admin.cookie)).toEqual({ available: 10, reserved: 0 });
  });

  it('releases the reservation on connection reset', async () => {
    const admin = await registerAndLogin(app, 'gateway-reset@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await configure(admin.orgId, { behavior: 'reset' });

    const response = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-reset')
      .send({ max_total_tokens: 1000 });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('MODEL_UNAVAILABLE');
    expect(await balance(admin.cookie)).toEqual({ available: 10, reserved: 0 });
  });

  it('releases the reservation on HTTP 429 and HTTP 500', async () => {
    const admin = await registerAndLogin(app, 'gateway-http@example.com');
    await seedCredits(adminPool, admin.orgId, 8);

    await configure(admin.orgId, { behavior: '429' });
    const limited = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-429')
      .send({ max_total_tokens: 1000 })
      .expect(502);
    expect(limited.body.error.code).toBe('MODEL_UNAVAILABLE');
    expect(await balance(admin.cookie)).toEqual({ available: 8, reserved: 0 });

    await configure(admin.orgId, { behavior: '500' });
    const crashed = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-500')
      .send({ max_total_tokens: 1000 })
      .expect(502);
    expect(crashed.body.error.code).toBe('MODEL_UNAVAILABLE');
    expect(await balance(admin.cookie)).toEqual({ available: 8, reserved: 0 });
  });

  it('releases the reservation when usage is missing', async () => {
    const admin = await registerAndLogin(app, 'gateway-malformed@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await configure(admin.orgId, { behavior: 'malformed' });

    const response = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-malformed')
      .send({ max_total_tokens: 1000 })
      .expect(502);

    expect(response.body.error.code).toBe('MODEL_MALFORMED');
    expect(await balance(admin.cookie)).toEqual({ available: 10, reserved: 0 });
  });

  it('does not follow a redirect to the instance metadata address', async () => {
    const admin = await registerAndLogin(app, 'gateway-redirect@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await configure(admin.orgId, { redirectTo: 'http://169.254.169.254/latest/meta-data' });

    const response = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-redirect')
      .send({ max_total_tokens: 1000 })
      .expect(502);

    expect(response.body.error.message).toMatch(/blocked address/i);
    expect(await balance(admin.cookie)).toEqual({ available: 10, reserved: 0 });
  });

  it('keeps readiness and billing up when the model is unreachable', async () => {
    const admin = await registerAndLogin(app, 'gateway-ready@example.com');
    await app.get('/ready').expect(200, { status: 'ready' });
    await app.get('/orgs').set('Cookie', admin.cookie).expect(200);
    await app
      .post('/purchases')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'ready-purchase')
      .send({ credits: 5 })
      .expect(201);
  });

  it('rate-limits across the shared Redis keyspace', async () => {
    const previousOrg = process.env.RATE_LIMIT_ORG_PER_MINUTE;
    const previousUser = process.env.RATE_LIMIT_USER_PER_MINUTE;
    process.env.RATE_LIMIT_ORG_PER_MINUTE = '2';
    process.env.RATE_LIMIT_USER_PER_MINUTE = '2';
    try {
      const admin = await registerAndLogin(app, 'gateway-rl@example.com');
      await seedCredits(adminPool, admin.orgId, 10);
      await configure(admin.orgId);

      await app
        .post('/inference')
        .set('Cookie', admin.cookie)
        .set('Idempotency-Key', 'rl-1')
        .send({ max_total_tokens: 1000 })
        .expect(200);
      await app
        .post('/inference')
        .set('Cookie', admin.cookie)
        .set('Idempotency-Key', 'rl-2')
        .send({ max_total_tokens: 1000 })
        .expect(200);
      const limited = await app
        .post('/inference')
        .set('Cookie', admin.cookie)
        .set('Idempotency-Key', 'rl-3')
        .send({ max_total_tokens: 1000 })
        .expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(limited.headers['retry-after']).toBeDefined();
    } finally {
      if (previousOrg === undefined) {
        delete process.env.RATE_LIMIT_ORG_PER_MINUTE;
      } else {
        process.env.RATE_LIMIT_ORG_PER_MINUTE = previousOrg;
      }
      if (previousUser === undefined) {
        delete process.env.RATE_LIMIT_USER_PER_MINUTE;
      } else {
        process.env.RATE_LIMIT_USER_PER_MINUTE = previousUser;
      }
    }
  });

  it('tests connectivity without charging and without returning the credential', async () => {
    const admin = await registerAndLogin(app, 'gateway-connect@example.com');
    await seedCredits(adminPool, admin.orgId, 4);
    const saved = await app
      .put('/model-config')
      .set('Cookie', admin.cookie)
      .send({
        endpoint_url: `${mockUrl}/v1/chat/completions?latency_ms=0`,
        model_name: 'mock-model',
        timeout_ms: 5000,
        credential: MOCK_MODEL_KEY,
      })
      .expect(200);
    expect(JSON.stringify(saved.body)).not.toContain(MOCK_MODEL_KEY);

    const tested = await app.post('/model-config/test').set('Cookie', admin.cookie).expect(200);
    expect(tested.body.reachable).toBe(true);
    expect(JSON.stringify(tested.body)).not.toContain(MOCK_MODEL_KEY);
    expect(await balance(admin.cookie)).toEqual({ available: 4, reserved: 0 });
  });

  it('never writes the credential into log output', async () => {
    const admin = await registerAndLogin(app, 'gateway-logs@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await app
      .put('/model-config')
      .set('Cookie', admin.cookie)
      .send({
        endpoint_url: `${mockUrl}/v1/chat/completions?latency_ms=0`,
        model_name: 'mock-model',
        credential: MOCK_MODEL_KEY,
      })
      .expect(200);
    await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-log')
      .send({ max_total_tokens: 1000, messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);

    const joined = logLines.join('\n');
    expect(joined).not.toContain(MOCK_MODEL_KEY);
    expect(joined).not.toContain('"hello"');
  });

  it('rejects a stored loopback endpoint when private allowance is empty', async () => {
    const previous = process.env.ALLOWED_PRIVATE_CIDRS;
    process.env.ALLOWED_PRIVATE_CIDRS = '';
    try {
      const admin = await registerAndLogin(app, 'gateway-ssrf-save@example.com');
      await app
        .put('/model-config')
        .set('Cookie', admin.cookie)
        .send({
          endpoint_url: 'http://127.0.0.1/v1/chat/completions',
          model_name: 'blocked',
          credential: MOCK_MODEL_KEY,
        })
        .expect(400);
    } finally {
      process.env.ALLOWED_PRIVATE_CIDRS = previous ?? '127.0.0.0/8';
    }
  });

  it('sums ledger deltas back to the account after a failed call', async () => {
    const admin = await registerAndLogin(app, 'gateway-ledger@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await configure(admin.orgId, { behavior: '500' });
    await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'gw-ledger')
      .send({ max_total_tokens: 1000 })
      .expect(502);

    const account = await balance(admin.cookie);
    const ledgerTotal = await withSystemTransaction(adminPool, async (ctx) => {
      const rows = await ctx.query<{ da: string; dr: string }>(
        `SELECT coalesce(sum(delta_available),0)::text AS da,
                coalesce(sum(delta_reserved),0)::text AS dr
           FROM credit_ledger WHERE org_id = $1`,
        [admin.orgId],
      );
      return (
        Number.parseInt(rows.rows[0]?.da ?? '0', 10) + Number.parseInt(rows.rows[0]?.dr ?? '0', 10)
      );
    });
    expect(ledgerTotal).toBe(account.available + account.reserved);
  });
});
