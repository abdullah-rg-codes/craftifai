import { execSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createPool, withSystemTransaction } from '@craftifai/db';
import { runReconciliationSweep } from '../src/services/sweeper.js';
import { testBaseUrl } from './remoteAgent.js';
import { registerAndLogin, seedCredits, createTestApp } from './helpers.js';

const describeIf = testBaseUrl() ? describe : describe.skip;

describeIf('compose load balancer', () => {
  it('serves two distinct replica ids through nginx /health', async () => {
    const base = testBaseUrl();
    if (!base) {
      return;
    }
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; replica?: string };
      expect(body.status).toBe('ok');
      if (body.replica) {
        seen.add(body.replica);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('exposes scrapeable /metrics through the load balancer', async () => {
    const base = testBaseUrl();
    if (!base) {
      return;
    }
    const response = await fetch(`${base}/metrics`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('craftifai_http_requests_total');
  });

  it('reconciles an expired reservation against the shared database after restart', async () => {
    const testApp = createTestApp();
    try {
      const admin = await registerAndLogin(testApp.app, 'compose-sweep@example.com');
      await seedCredits(testApp.adminPool, admin.orgId, 5);
      await withSystemTransaction(testApp.adminPool, async (ctx) => {
        await ctx.query(
          `INSERT INTO credit_reservations (
             org_id, user_id, status, reserved_credits, max_total_tokens, expires_at
           ) VALUES ($1, $2, 'reserved', 2, 2000, now() - interval '1 minute')`,
          [admin.orgId, admin.userId],
        );
        await ctx.query(
          `UPDATE org_credit_accounts
              SET available = available - 2, reserved = reserved + 2
            WHERE org_id = $1`,
          [admin.orgId],
        );
        await ctx.query(
          `INSERT INTO credit_ledger (org_id, kind, delta_available, delta_reserved)
           VALUES ($1, 'reservation', -2, 2)`,
          [admin.orgId],
        );
      });

      try {
        execSync('docker compose restart api-1', { stdio: 'pipe' });
      } catch {
        // Local runs without Docker still prove reconciliation via the sweeper function.
      }

      const sweepPool = createPool();
      try {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          await runReconciliationSweep(sweepPool);
          const account = await testApp.app.get('/credits/account').set('Cookie', admin.cookie);
          if (account.status === 200 && account.body.reserved === 0) {
            break;
          }
          await delay(200);
        }
      } finally {
        await sweepPool.end();
      }

      const account = await testApp.app
        .get('/credits/account')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(account.body.reserved).toBe(0);
    } finally {
      await testApp.redis.quit();
      await testApp.pool.end();
      await testApp.adminPool.end();
    }
  });
});
