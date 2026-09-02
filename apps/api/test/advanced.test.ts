import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DatabasePool } from '@craftifai/db';
import { buildMockModelApp } from '@craftifai/mock-model/app';
import { signWebhook } from '../src/services/billing.js';
import { env } from '../src/env.js';
import {
  createTestApp,
  directAddMember,
  directCreateUser,
  hasTestDatabase,
  hasTestRedis,
  login,
  registerAndLogin,
  runMigrations,
  seedCredits,
  seedModelConfig,
  startTestServer,
  truncateTables,
} from './helpers.js';
import { mockModelUrl } from './remoteAgent.js';

const describeIf = hasTestDatabase() && hasTestRedis() ? describe : describe.skip;
const MOCK_MODEL_KEY = process.env.MOCK_MODEL_API_KEY ?? 'test-model-secret';

describeIf('Advanced credit and isolation invariants', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let pool: DatabasePool;
  let adminPool: DatabasePool;
  let redis: Awaited<ReturnType<typeof createTestApp>>['redis'];
  let mockUrl: string;
  let closeMock: () => Promise<void>;

  async function enableModel(orgId: string): Promise<void> {
    const params = new URLSearchParams({ latency_ms: '0' });
    await seedModelConfig(adminPool, orgId, {
      endpointUrl: `${mockUrl}/v1/chat/completions?${params.toString()}`,
      credential: MOCK_MODEL_KEY,
      timeoutMs: 5000,
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
    await redis?.quit();
    await pool?.end();
    await adminPool?.end();
  });

  it('credits the purchase row amount when a signed webhook payload disagrees', async () => {
    const admin = await registerAndLogin(app, 'webhook-amount-admin@example.com');
    const purchase = await app
      .post('/purchases')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'webhook-amount-mismatch')
      .send({ credits: 5 })
      .expect(201);

    const webhook = signWebhook(
      {
        purchase_id: purchase.body.purchaseId,
        provider_event_id: 'evt_inflated_credits',
        credits: 999,
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
    expect(account.body.available).toBe(5);
    expect(account.body.reserved).toBe(0);

    const ledger = await app.get('/credits/ledger').set('Cookie', admin.cookie).expect(200);
    expect(ledger.body.entries).toHaveLength(1);
    expect(ledger.body.entries[0]).toMatchObject({
      kind: 'purchase',
      delta_available: 5,
      delta_reserved: 0,
      purchase_id: purchase.body.purchaseId,
    });
  });

  it('isolates GET /credits/reservations/me to the authenticated user', async () => {
    const admin = await registerAndLogin(app, 'usage-admin@example.com');
    const other = await directCreateUser(pool, 'usage-member@example.com');
    await directAddMember(pool, admin.orgId, other.id, 'member');
    const memberCookie = await login(app, 'usage-member@example.com', 'password123');

    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);

    await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'usage-admin-run')
      .send({ max_total_tokens: 1000 })
      .expect(200);

    await app
      .post('/inference')
      .set('Cookie', memberCookie)
      .set('Idempotency-Key', 'usage-member-run')
      .send({ max_total_tokens: 1000 })
      .expect(200);

    const adminMine = await app
      .get('/credits/reservations/me')
      .set('Cookie', admin.cookie)
      .expect(200);
    const memberMine = await app
      .get('/credits/reservations/me')
      .set('Cookie', memberCookie)
      .expect(200);

    expect(adminMine.body.reservations).toHaveLength(1);
    expect(memberMine.body.reservations).toHaveLength(1);
    expect(adminMine.body.reservations[0]?.user_id).toBe(admin.userId);
    expect(memberMine.body.reservations[0]?.user_id).toBe(other.id);
    expect(adminMine.body.reservations[0]?.id).not.toBe(memberMine.body.reservations[0]?.id);

    const orgList = await app.get('/credits/reservations').set('Cookie', admin.cookie).expect(200);
    const orgIds = (orgList.body.reservations as { id: string }[]).map((row) => row.id);
    expect(orgIds).toHaveLength(2);
    expect(orgIds).toEqual(
      expect.arrayContaining([
        adminMine.body.reservations[0]?.id,
        memberMine.body.reservations[0]?.id,
      ]),
    );
  });

  it('pages the credit ledger without repeating ids', async () => {
    const admin = await registerAndLogin(app, 'ledger-page-admin@example.com');
    for (let index = 0; index < 5; index += 1) {
      await seedCredits(adminPool, admin.orgId, 1);
    }

    const first = await app
      .get('/credits/ledger')
      .query({ limit: 2 })
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(first.body.entries).toHaveLength(2);
    expect(first.body.next_cursor).toEqual(expect.any(String));
    expect(first.body.next_cursor).not.toContain('{');

    const seenIds = new Set<string>(
      (first.body.entries as { id: string }[]).map((entry) => entry.id),
    );
    let cursor: string | null = first.body.next_cursor as string;
    while (cursor) {
      const page = await app
        .get('/credits/ledger')
        .query({ limit: 2, cursor })
        .set('Cookie', admin.cookie)
        .expect(200);
      for (const entry of page.body.entries as { id: string }[]) {
        expect(seenIds.has(entry.id)).toBe(false);
        seenIds.add(entry.id);
      }
      cursor = page.body.next_cursor as string | null;
    }
    expect(seenIds.size).toBe(5);

    await app
      .get('/credits/ledger')
      .query({ cursor: 'not-a-valid-cursor' })
      .set('Cookie', admin.cookie)
      .expect(400);
    await app.get('/credits/ledger').query({ limit: 101 }).set('Cookie', admin.cookie).expect(400);
  });

  it('keeps ledger deltas identical to available plus reserved after two members settle', async () => {
    const admin = await registerAndLogin(app, 'ledger-identity-admin@example.com');
    const other = await directCreateUser(pool, 'ledger-identity-member@example.com');
    await directAddMember(pool, admin.orgId, other.id, 'member');
    const memberCookie = await login(app, 'ledger-identity-member@example.com', 'password123');

    await seedCredits(adminPool, admin.orgId, 10);
    await enableModel(admin.orgId);

    await app
      .post('/inference')
      .set('Cookie', admin.cookie)
      .set('Idempotency-Key', 'ledger-identity-admin')
      .send({ max_total_tokens: 1000 })
      .expect(200);
    await app
      .post('/inference')
      .set('Cookie', memberCookie)
      .set('Idempotency-Key', 'ledger-identity-member')
      .send({ max_total_tokens: 1000 })
      .expect(200);

    const account = await app.get('/credits/account').set('Cookie', admin.cookie).expect(200);
    const ledger = await app
      .get('/credits/ledger')
      .query({ limit: 100 })
      .set('Cookie', admin.cookie)
      .expect(200);

    const balanceFromLedger = (
      ledger.body.entries as { delta_available: number; delta_reserved: number }[]
    ).reduce((sum, entry) => sum + entry.delta_available + entry.delta_reserved, 0);
    expect(balanceFromLedger).toBe(account.body.available + account.body.reserved);
    expect(account.body.reserved).toBe(0);
    expect(account.body.available).toBeGreaterThan(0);
  });
});
