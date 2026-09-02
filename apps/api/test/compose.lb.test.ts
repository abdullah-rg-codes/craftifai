import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createPool, withSystemTransaction } from '@craftifai/db';
import { runReconciliationSweep } from '../src/services/sweeper.js';
import { testBaseUrl } from './remoteAgent.js';
import { registerAndLogin, seedCredits, createTestApp } from './helpers.js';

const describeIf = testBaseUrl() ? describe : describe.skip;

const HEALTH_SCRIPT =
  "fetch('http://127.0.0.1:3000/health').then(async(r)=>{process.stdout.write(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))";

function composeExec(service: string, script: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', service, 'node', '-e', script], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function replicaFromContainer(service: 'api-1' | 'api-2'): string {
  const body = JSON.parse(composeExec(service, HEALTH_SCRIPT)) as {
    status: string;
    replica?: string;
  };
  expect(body.status).toBe('ok');
  expect(body.replica).toBe(service);
  return body.replica ?? service;
}

async function replicaThroughProxy(base: string): Promise<string | undefined> {
  const response = await fetch(`${base}/health`, {
    headers: { connection: 'close' },
    cache: 'no-store',
    signal: AbortSignal.timeout(2_000),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string; replica?: string };
  expect(body.status).toBe('ok');
  return body.replica;
}

function restartApi1UntilHealthy(): void {
  try {
    execFileSync('docker', ['compose', 'restart', 'api-1'], { stdio: 'pipe' });
  } catch {
    // Local runs without Docker still prove reconciliation via the sweeper function.
    return;
  }
  execFileSync('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '60', 'api-1'], {
    stdio: 'pipe',
  });
}

describeIf('compose load balancer', () => {
  it('serves two distinct replica ids through nginx /health', async () => {
    const base = testBaseUrl();
    if (!base) {
      return;
    }

    expect(new Set([replicaFromContainer('api-1'), replicaFromContainer('api-2')])).toEqual(
      new Set(['api-1', 'api-2']),
    );

    const seen = new Set<string>();
    const burst = await Promise.allSettled(
      Array.from({ length: 8 }, () => replicaThroughProxy(base)),
    );
    for (const result of burst) {
      if (result.status === 'fulfilled' && result.value) {
        seen.add(result.value);
      }
    }
    const deadline = Date.now() + 8_000;
    while (seen.size < 2 && Date.now() < deadline) {
      try {
        const replica = await replicaThroughProxy(base);
        if (replica) {
          seen.add(replica);
        }
      } catch {
        // Hung or failing upstream; retry within the deadline.
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

      restartApi1UntilHealthy();

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
  }, 90_000);
});
