import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { createSystemDal, withSystemTransaction, type DatabasePool } from '@craftifai/db';
import {
  createTestApp,
  getCookies,
  hasTestDatabase,
  hasTestRedis,
  postJson,
  registerAndLogin,
  runMigrations,
  seedCredits,
  seedModelConfig,
  startTestServer,
  truncateTables,
  type TestHttpResponse,
} from './helpers.js';
import { mockModelUrl } from './remoteAgent.js';
import { buildMockModelApp } from '@craftifai/mock-model/app';
import { signWebhook } from '../src/services/billing.js';
import { runReconciliationSweep } from '../src/services/sweeper.js';
import { createCreditService } from '../src/services/credits.js';
import { env } from '../src/env.js';

const describeIf = hasTestDatabase() && hasTestRedis() ? describe : describe.skip;
const MOCK_MODEL_KEY = process.env.MOCK_MODEL_API_KEY ?? 'test-model-secret';

async function lockCreditAccount(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  orgId: string,
): Promise<void> {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.is_system', 'true', true)");
  await client.query("SELECT set_config('app.current_org', '', true)");
  await client.query('SELECT * FROM org_credit_accounts WHERE org_id = $1 FOR UPDATE', [orgId]);
}

async function waitForBlockedSessions(
  adminPool: DatabasePool,
  blockerPid: number,
  targetCount: number,
  timeoutMs = 3000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let blockedCount = 0;
  let lastCount = 0;
  let stableRounds = 0;
  while (Date.now() < deadline) {
    blockedCount = await withSystemTransaction(adminPool, async (ctx) => {
      const result = await ctx.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND $1 = ANY(pg_blocking_pids(pid))`,
        [blockerPid],
      );
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    });
    if (blockedCount >= targetCount && blockedCount === lastCount) {
      stableRounds += 1;
      if (stableRounds >= 2) {
        return blockedCount;
      }
    } else {
      stableRounds = 0;
    }
    lastCount = blockedCount;
    await delay(25);
  }
  return blockedCount;
}

async function runWhileCreditAccountLocked(
  adminPool: DatabasePool,
  orgId: string,
  expectedWaiters: number,
  startRequests: () => Promise<TestHttpResponse>[],
): Promise<TestHttpResponse[]> {
  const blocker = await adminPool.connect();
  let requests: Promise<TestHttpResponse>[] = [];
  try {
    await lockCreditAccount(blocker, orgId);
    const backend = await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const blockerPid = backend.rows[0]!.pid;
    requests = startRequests();
    await waitForBlockedSessions(adminPool, blockerPid, expectedWaiters);
    await blocker.query('COMMIT');
  } catch (error) {
    await blocker.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled(requests);
    throw error;
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined);
    blocker.release();
  }
  return Promise.all(requests);
}

describeIf('Phase 2 credit core', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let pool: DatabasePool;
  let adminPool: DatabasePool;
  let redis: Awaited<ReturnType<typeof createTestApp>>['redis'];
  let serverUrl: string;
  let closeServer: () => Promise<void>;
  let mockUrl: string;
  let closeMock: () => Promise<void>;

  async function enableModel(
    orgId: string,
    options: { timeoutMs?: number; behavior?: string } = {},
  ): Promise<void> {
    const params = new URLSearchParams({ latency_ms: '0' });
    if (options.behavior) {
      params.set('behavior', options.behavior);
    }
    await seedModelConfig(adminPool, orgId, {
      endpointUrl: `${mockUrl}/v1/chat/completions?${params.toString()}`,
      credential: MOCK_MODEL_KEY,
      timeoutMs: options.timeoutMs ?? 5000,
    });
  }

  beforeAll(async () => {
    process.env.ALLOWED_PRIVATE_CIDRS = '127.0.0.0/8';
    process.env.MOCK_MODEL_API_KEY = MOCK_MODEL_KEY;
    runMigrations();
    const testApp = createTestApp();
    app = testApp.app;
    pool = testApp.pool;
    adminPool = testApp.adminPool;
    redis = testApp.redis;
    const listening = await startTestServer(testApp.expressApp);
    serverUrl = listening.url;
    closeServer = listening.close;
    const fixtureMock = mockModelUrl();
    if (fixtureMock) {
      mockUrl = fixtureMock;
      closeMock = async () => undefined;
    } else {
      const mock = await startTestServer(buildMockModelApp());
      mockUrl = mock.url;
      closeMock = mock.close;
    }
  });

  beforeEach(async () => {
    await truncateTables(adminPool, redis);
  });

  afterAll(async () => {
    await closeMock?.();
    await closeServer?.();
    await redis?.quit();
    await pool?.end();
    await adminPool?.end();
  });

  it('seeds an account with a matching ledger entry and zero balance', async () => {
    const admin = await registerAndLogin(app, 'seed-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 100);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body).toMatchObject({ available: 100, reserved: 0 });

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    expect(ledger.body.entries).toHaveLength(1);
    expect(ledger.body.entries[0]).toMatchObject({
      kind: 'purchase',
      delta_available: 100,
      delta_reserved: 0,
    });
  });

  it('reserves, settles, and releases credits through the inference endpoint', async () => {
    const admin = await registerAndLogin(app, 'inference-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);

    const response = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'first-inference')
      .send({ max_total_tokens: 2000 })
      .expect(200);

    expect(response.body.reserved_credits).toBe(2);
    expect(response.body.settled_credits).toBe(1);
    expect(response.body.refunded_credits).toBe(1);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body).toMatchObject({ available: 9, reserved: 0 });

    const reservations = await app
      .get('/credits/reservations')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(reservations.body.reservations).toHaveLength(1);
    expect(reservations.body.reservations[0]).toMatchObject({
      status: 'settled',
      settled_credits: 1,
    });

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    expect(ledger.body.entries).toHaveLength(3);
    expect(ledger.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'purchase', delta_available: 10, delta_reserved: 0 }),
        expect.objectContaining({ kind: 'reservation', delta_available: -2, delta_reserved: 2 }),
        expect.objectContaining({ kind: 'settlement', delta_available: 1, delta_reserved: -2 }),
      ]),
    );
  });

  it('returns 402 and never creates a reservation when credits are insufficient', async () => {
    const admin = await registerAndLogin(app, 'poor-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 1);
    await enableModel(admin.orgId);

    const response = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'poor-inference')
      .send({ max_total_tokens: 2000 })
      .expect(402);

    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(response.body.error.details).toMatchObject({ needed: '2', available: '1' });

    const reservations = await app
      .get('/credits/reservations')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(reservations.body.reservations).toHaveLength(0);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body).toMatchObject({ available: 1, reserved: 0 });
  });

  it('replays a completed inference request with the same idempotency key and body', async () => {
    const admin = await registerAndLogin(app, 'replay-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);

    const first = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'replay-key')
      .send({ max_total_tokens: 1000 })
      .expect(200);

    const replay = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'replay-key')
      .send({ max_total_tokens: 1000 })
      .expect(200);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    const reservationEntries = ledger.body.entries.filter(
      (e: { kind: string }) => e.kind === 'reservation',
    );
    expect(reservationEntries).toHaveLength(1);
  });

  it('conflicts when the same idempotency key is reused with a different body', async () => {
    const admin = await registerAndLogin(app, 'conflict-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);

    await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'conflict-key')
      .send({ max_total_tokens: 1000 })
      .expect(200);

    const conflict = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'conflict-key')
      .send({ max_total_tokens: 2000 })
      .expect(409);

    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('creates a pending purchase and completes it with a signed webhook', async () => {
    const admin = await registerAndLogin(app, 'purchase-admin@example.com');

    const purchase = await app
      .post('/purchases')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'purchase-key')
      .send({ credits: 50 })
      .expect(201);

    expect(purchase.body.status).toBe('pending');

    const webhook = signWebhook(
      {
        purchase_id: purchase.body.purchaseId,
        provider_event_id: 'evt_123',
        credits: 50,
        timestamp: 0,
      },
      env.webhookSecret(),
    );

    const applied = await app
      .post('/billing/webhook')
      .set('X-Webhook-Signature', webhook.signature)
      .set('Content-Type', 'application/json')
      .send(webhook.body)
      .expect(200);

    expect(applied.body.applied).toBe(true);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body.available).toBe(50);

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    expect(ledger.body.entries).toHaveLength(1);
    expect(ledger.body.entries[0]).toMatchObject({
      kind: 'purchase',
      delta_available: 50,
      delta_reserved: 0,
    });

    const audit = await app.get('/audit-events').set('Cookie', admin.cookie).expect(200);
    expect(audit.body.events.map((event: { action: string }) => event.action)).toEqual(
      expect.arrayContaining(['purchase.create', 'purchase.complete']),
    );
  });

  it('does not credit the balance through an unsigned purchase confirm path', async () => {
    const admin = await registerAndLogin(app, 'mock-confirm-admin@example.com');
    const purchase = await app
      .post('/purchases')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'mock-confirm')
      .send({ credits: 25 })
      .expect(201);

    await app
      .post(`/purchases/${purchase.body.purchaseId as string}/confirm-mock`)
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'mock-confirm-apply')
      .send({})
      .expect(404);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body.available).toBe(0);
  });

  it('lists personal reservations for the authenticated user', async () => {
    const admin = await registerAndLogin(app, 'my-usage-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);
    await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'my-usage')
      .send({ max_total_tokens: 1000 })
      .expect(200);

    const mine = await app.get('/credits/reservations/me').set('Cookie', admin.cookie).expect(200);
    expect(mine.body.reservations).toHaveLength(1);
    expect(mine.body.reservations[0]?.user_id).toBe(admin.userId);
    expect(mine.body.next_cursor).toBeNull();
  });

  it('does not credit the balance for a replayed webhook event', async () => {
    const admin = await registerAndLogin(app, 'webhook-replay-admin@example.com');

    const purchase = await app
      .post('/purchases')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'webhook-replay-purchase')
      .send({ credits: 50 })
      .expect(201);

    const webhook = signWebhook(
      {
        purchase_id: purchase.body.purchaseId,
        provider_event_id: 'evt_dup',
        credits: 50,
        timestamp: 0,
      },
      env.webhookSecret(),
    );

    await app
      .post('/billing/webhook')
      .set('X-Webhook-Signature', webhook.signature)
      .set('Content-Type', 'application/json')
      .send(webhook.body)
      .expect(200);

    const replay = await app
      .post('/billing/webhook')
      .set('X-Webhook-Signature', webhook.signature)
      .set('Content-Type', 'application/json')
      .send(webhook.body)
      .expect(200);

    expect(replay.body.applied).toBe(false);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body.available).toBe(50);

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    expect(ledger.body.entries).toHaveLength(1);
  });

  it('rejects webhooks with a bad signature or stale timestamp', async () => {
    const admin = await registerAndLogin(app, 'bad-webhook-admin@example.com');
    const purchase = await app
      .post('/purchases')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'bad-webhook-purchase')
      .send({ credits: 50 })
      .expect(201);

    const payload = {
      purchase_id: purchase.body.purchaseId as string,
      provider_event_id: 'evt_bad',
      credits: 50,
    };
    const recent = signWebhook(payload, env.webhookSecret());

    const badSignature = await app
      .post('/billing/webhook')
      .set('X-Webhook-Signature', `t=${recent.payload.timestamp},v1=deadbeef`)
      .set('Content-Type', 'application/json')
      .send(recent.body)
      .expect(400);
    expect(badSignature.body.error.code).toBe('WEBHOOK_INVALID');

    const stale = signWebhook(
      { ...payload, provider_event_id: 'evt_stale' },
      env.webhookSecret(),
      Math.floor(Date.now() / 1000) - 400,
    );
    const staleReplay = await app
      .post('/billing/webhook')
      .set('X-Webhook-Signature', stale.signature)
      .set('Content-Type', 'application/json')
      .send(stale.body)
      .expect(409);
    expect(staleReplay.body.error.code).toBe('WEBHOOK_REPLAY');
  });

  it('rejects a signed webhook whose purchase_id is not a UUID', async () => {
    const malformed = signWebhook(
      {
        purchase_id: '52bb8b1f-0362-4531-9ab0-b3887afc6247%',
        provider_event_id: 'evt_malformed_purchase',
        credits: 2,
      },
      env.webhookSecret(),
    );
    const response = await app
      .post('/billing/webhook')
      .set('X-Webhook-Signature', malformed.signature)
      .set('Content-Type', 'application/json')
      .send(malformed.body)
      .expect(400);
    expect(response.body.error.code).toBe('WEBHOOK_INVALID');
  });

  it('reconciles an expired reservation and remains correct if swept twice', async () => {
    const admin = await registerAndLogin(app, 'sweep-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 10);

    const reserve = await withSystemTransaction(pool, async (ctx) => {
      const dal = createSystemDal(ctx);
      const service = createCreditService(dal);
      return service.reserve({
        orgId: admin.orgId,
        userId: admin.userId,
        maxTotalTokens: 2000,
        reservationTtlSeconds: 1,
      });
    });

    expect(reserve).toBeDefined();

    await withSystemTransaction(pool, async (ctx) => {
      await ctx.query(
        "UPDATE credit_reservations SET expires_at = now() - interval '1 second' WHERE id = $1",
        [reserve!.reservationId],
      );
    });

    const first = await runReconciliationSweep(pool);
    expect(first.acquiredLock).toBe(true);
    expect(first.expiredReservations).toBe(1);

    const second = await runReconciliationSweep(pool);
    expect(second.expiredReservations).toBe(0);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body).toMatchObject({ available: 10, reserved: 0 });

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    const expiry = ledger.body.entries.find((e: { kind: string }) => e.kind === 'expiry');
    expect(expiry).toBeDefined();
  });

  it('reaps a stale pending idempotency key', async () => {
    const admin = await registerAndLogin(app, 'stale-key-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);

    await withSystemTransaction(pool, async (ctx) => {
      const dal = createSystemDal(ctx);
      await dal.idempotencyKeys.claim({
        orgId: admin.orgId,
        endpoint: '/inference',
        key: 'stale-key',
        fingerprint: Buffer.from('stale'),
        expiresAt: new Date(Date.now() - 1000),
      });
    });

    const result = await runReconciliationSweep(pool);
    expect(result.staleIdempotencyKeys).toBe(1);

    const replay = await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'stale-key')
      .send({ max_total_tokens: 1000 })
      .expect(409);
    expect(replay.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('concurrent inference requests exhaust balance exactly without going negative', async () => {
    const admin = await registerAndLogin(app, 'concurrent-admin@example.com');
    const credits = 5;
    await seedCredits(adminPool, admin.orgId, credits);
    await enableModel(admin.orgId);

    const n = 10;
    const maxTokens = 1000;
    const expectedSuccess = credits;

    const responses = await runWhileCreditAccountLocked(adminPool, admin.orgId, n, () =>
      Array.from({ length: n }, (_, i) =>
        postJson(serverUrl, '/inference', {
          cookie: admin.cookie,
          headers: { 'Idempotency-Key': `concurrent-${i}` },
          body: { max_total_tokens: maxTokens },
        }),
      ),
    );

    const successCount = responses.filter((r) => r.status === 200).length;
    const failureCount = responses.filter((r) => r.status === 402).length;

    expect(successCount).toBe(expectedSuccess);
    expect(failureCount).toBe(n - expectedSuccess);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body.available).toBe(0);
    expect(account.body.reserved).toBe(0);

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    const balanceFromLedger = ledger.body.entries.reduce(
      (sum: number, e: { delta_available: number; delta_reserved: number }) =>
        sum + e.delta_available + e.delta_reserved,
      0,
    );
    expect(balanceFromLedger).toBe(account.body.available + account.body.reserved);
  });

  it('concurrent identical idempotency keys produce one charge and replay the rest', async () => {
    const admin = await registerAndLogin(app, 'idempotent-admin@example.com');
    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);

    const n = 5;
    const maxTokens = 1000;
    const sharedKey = 'shared-idempotency-key';

    const responses = await runWhileCreditAccountLocked(adminPool, admin.orgId, 1, () =>
      Array.from({ length: n }, () =>
        postJson(serverUrl, '/inference', {
          cookie: admin.cookie,
          headers: { 'Idempotency-Key': sharedKey },
          body: { max_total_tokens: maxTokens },
        }),
      ),
    );

    const successResponses = responses.filter((r) => r.status === 200);
    const inProgressResponses = responses.filter((r) => r.status === 409);

    expect(successResponses.length + inProgressResponses.length).toBe(n);
    expect(successResponses.length).toBeGreaterThanOrEqual(1);

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    const reservationEntries = ledger.body.entries.filter(
      (e: { kind: string }) => e.kind === 'reservation',
    );
    expect(reservationEntries).toHaveLength(1);

    const firstSuccess = successResponses[0]!;
    for (const response of successResponses) {
      expect(response.body).toEqual(firstSuccess.body);
      if (response.headers['idempotency-replayed'] === 'true') {
        expect(response.body).toEqual(firstSuccess.body);
      }
    }
  });

  it('concurrent duplicate webhooks credit the balance once', async () => {
    const admin = await registerAndLogin(app, 'concurrent-webhook-admin@example.com');
    const purchase = await app
      .post('/purchases')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'concurrent-webhook-purchase')
      .send({ credits: 100 })
      .expect(201);

    const webhook = signWebhook(
      {
        purchase_id: purchase.body.purchaseId,
        provider_event_id: 'evt_concurrent',
        credits: 100,
        timestamp: 0,
      },
      env.webhookSecret(),
    );

    const n = 10;
    const responses = await Promise.all(
      Array.from({ length: n }, () =>
        postJson(serverUrl, '/billing/webhook', {
          headers: { 'X-Webhook-Signature': webhook.signature },
          rawBody: webhook.body,
        }),
      ),
    );

    const appliedCount = responses.filter(
      (r) => r.status === 200 && r.body.applied === true,
    ).length;
    const skippedCount = responses.filter(
      (r) => r.status === 200 && r.body.applied === false,
    ).length;

    expect(appliedCount).toBe(1);
    expect(appliedCount + skippedCount).toBe(n);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    expect(account.body.available).toBe(100);

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    const purchaseEntries = ledger.body.entries.filter(
      (e: { kind: string }) => e.kind === 'purchase',
    );
    expect(purchaseEntries).toHaveLength(1);
  });

  it('two API instances sharing one database preserve credit invariants', async () => {
    const remote = process.env.TEST_BASE_URL;
    if (remote) {
      const admin = await registerAndLogin(app, 'two-instance-admin@example.com');
      await seedCredits(adminPool, admin.orgId, 3);
      await enableModel(admin.orgId);
      const n = 6;
      const maxTokens = 1000;
      const responses = await runWhileCreditAccountLocked(adminPool, admin.orgId, n, () =>
        Array.from({ length: n }, (_, i) =>
          postJson(remote, '/inference', {
            cookie: admin.cookie,
            headers: { 'Idempotency-Key': `two-instance-${String(i)}` },
            body: { max_total_tokens: maxTokens },
          }),
        ),
      );
      const successCount = responses.filter((r) => r.status === 200).length;
      expect(successCount).toBe(3);
      const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
      expect(account.body.available).toBe(0);
      expect(account.body.reserved).toBe(0);
      return;
    }
    const testApp1 = createTestApp();
    const testApp2 = createTestApp();
    const server1 = await startTestServer(testApp1.expressApp);
    const server2 = await startTestServer(testApp2.expressApp);

    try {
      const admin1 = await registerAndLogin(testApp1.app, 'two-instance-admin@example.com');
      await seedCredits(testApp1.adminPool, admin1.orgId, 3);
      await seedModelConfig(testApp1.adminPool, admin1.orgId, {
        endpointUrl: `${mockUrl}/v1/chat/completions?latency_ms=0`,
        credential: MOCK_MODEL_KEY,
        timeoutMs: 5000,
      });

      const login2 = await testApp2.app
        .post('/auth/login')
        .send({ email: 'two-instance-admin@example.com', password: 'password123' })
        .expect(200);
      const cookie2 = getCookies(login2);

      const n = 6;
      const maxTokens = 1000;

      const responses = await runWhileCreditAccountLocked(testApp1.adminPool, admin1.orgId, n, () =>
        Array.from({ length: n }, (_, i) =>
          postJson(i % 2 === 0 ? server1.url : server2.url, '/inference', {
            cookie: i % 2 === 0 ? admin1.cookie : cookie2,
            headers: { 'Idempotency-Key': `two-instance-${i}` },
            body: { max_total_tokens: maxTokens },
          }),
        ),
      );

      const successCount = responses.filter((r) => r.status === 200).length;
      expect(successCount).toBe(3);

      const account = await testApp1.app
        .get('/credits/account')
        .set('Cookie', admin1.cookie)
        .expect(200);
      expect(account.body.available).toBe(0);
      expect(account.body.reserved).toBe(0);
    } finally {
      await Promise.allSettled([
        server1.close(),
        server2.close(),
        testApp1.redis.quit(),
        testApp2.redis.quit(),
        testApp1.pool.end(),
        testApp2.pool.end(),
        testApp1.adminPool.end(),
        testApp2.adminPool.end(),
      ]);
    }
  });
});
