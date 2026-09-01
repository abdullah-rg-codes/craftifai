/* eslint-disable no-console -- load harness is a CLI */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createPool,
  createSystemDal,
  databaseAdminUrl,
  withSystemTransaction,
} from '../packages/db/src/index.js';
import { hashPassword } from '../packages/shared/src/index.js';
import { encryptCredential } from '../apps/api/src/services/crypto.js';
import { runReconciliationSweep } from '../apps/api/src/services/sweeper.js';

const execFileAsync = promisify(execFile);

const WORKERS = 200;
const DURATION_MS = 25_000;
const SAMPLE_MS = 50;
const EXHAUST_CREDITS = 40;
const MAX_TOKENS = 1000;
const PASSWORD = 'password123';
const FETCH_MS = 20_000;

type ErrorCategory =
  | 'ok'
  | 'insufficient'
  | 'rate_limited'
  | 'timeout'
  | 'model_unavailable'
  | 'server'
  | 'client_timeout'
  | 'other';

interface OrgSession {
  orgId: string;
  cookies: string[];
}

interface Sample {
  at: number;
  orgId: string;
  available: number;
  reserved: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function cookieHeader(setCookie: string[]): string {
  return setCookie
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter((part): part is string => Boolean(part))
    .join('; ');
}

function categorize(status: number, aborted: boolean): ErrorCategory {
  if (aborted) {
    return 'client_timeout';
  }
  if (status === 200) {
    return 'ok';
  }
  if (status === 402) {
    return 'insufficient';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 504) {
    return 'timeout';
  }
  if (status === 502) {
    return 'model_unavailable';
  }
  if (status >= 500) {
    return 'server';
  }
  return 'other';
}

async function api(
  baseUrl: string,
  method: string,
  path: string,
  options: { cookie?: string; json?: unknown; idempotencyKey?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string[] }> {
  const headers = new Headers();
  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }
  if (options.idempotencyKey) {
    headers.set('idempotency-key', options.idempotencyKey);
  }
  const init: RequestInit = {
    method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_MS),
  };
  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.json);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = { raw: text };
    }
  }
  return {
    status: response.status,
    body,
    setCookie: response.headers.getSetCookie?.() ?? [],
  };
}

async function register(
  baseUrl: string,
  email: string,
): Promise<{ orgId: string; userId: string; cookie: string }> {
  const response = await api(baseUrl, 'POST', '/auth/register', {
    json: { email, password: PASSWORD, display_name: email },
  });
  if (response.status !== 201) {
    throw new Error(`register failed ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return {
    orgId: String(response.body.org_id),
    userId: String(response.body.user_id),
    cookie: cookieHeader(response.setCookie),
  };
}

async function login(baseUrl: string, email: string): Promise<string> {
  const response = await api(baseUrl, 'POST', '/auth/login', {
    json: { email, password: PASSWORD },
  });
  if (response.status !== 200) {
    throw new Error(`login failed ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return cookieHeader(response.setCookie);
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  process.chdir(root);

  const baseUrl = requireEnv('TEST_BASE_URL').replace(/\/$/, '');
  requireEnv('ENCRYPTION_KEY_BASE64');
  const mockUrl = (process.env.MOCK_MODEL_URL ?? 'http://mock-model:8081').replace(/\/$/, '');
  const mockKey = process.env.MOCK_MODEL_API_KEY ?? 'test-model-secret';
  const stamp = Date.now().toString(36);

  const adminPool = createPool({ connectionString: databaseAdminUrl(), max: 8 });
  const samples: Sample[] = [];
  const latencies: number[] = [];
  const categories: Record<ErrorCategory, number> = {
    ok: 0,
    insufficient: 0,
    rate_limited: 0,
    timeout: 0,
    model_unavailable: 0,
    server: 0,
    client_timeout: 0,
    other: 0,
  };
  let inferenceOk = 0;
  let inferenceAttempts = 0;
  let backendsPeak = 0;
  let activityPeak = 0;
  let postgresCpuPeak = 0;
  let sampleTicks = 0;
  let negativeSeen = false;
  let negativeDetail = '';

  const exhaust = await register(baseUrl, `load-exhaust-${stamp}@example.com`);
  const fail429 = await register(baseUrl, `load-429-${stamp}@example.com`);
  const fail500 = await register(baseUrl, `load-500-${stamp}@example.com`);
  const failTimeout = await register(baseUrl, `load-timeout-${stamp}@example.com`);
  const orgIds = [exhaust.orgId, fail429.orgId, fail500.orgId, failTimeout.orgId];

  const extraCookies: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const email = `load-exhaust-m${String(i)}-${stamp}@example.com`;
    const passwordHash = await hashPassword(PASSWORD);
    await withSystemTransaction(adminPool, async (ctx) => {
      const dal = createSystemDal(ctx);
      const user = await dal.users.create({ email, passwordHash, displayName: email });
      await dal.memberships.create({
        orgId: exhaust.orgId,
        userId: user.id,
        role: 'member',
        status: 'active',
      });
    });
    extraCookies.push(await login(baseUrl, email));
  }
  const exhaustCookies = [exhaust.cookie, ...extraCookies];

  await withSystemTransaction(adminPool, async (ctx) => {
    const dal = createSystemDal(ctx);
    await dal.creditAccounts.getOrCreate(exhaust.orgId);
    await dal.creditAccounts.addAvailable(exhaust.orgId, EXHAUST_CREDITS);
    await dal.creditLedger.create({
      orgId: exhaust.orgId,
      kind: 'purchase',
      deltaAvailable: EXHAUST_CREDITS,
      deltaReserved: 0,
    });
    for (const orgId of [fail429.orgId, fail500.orgId, failTimeout.orgId]) {
      await dal.creditAccounts.getOrCreate(orgId);
      await dal.creditAccounts.addAvailable(orgId, 10_000);
      await dal.creditLedger.create({
        orgId,
        kind: 'purchase',
        deltaAvailable: 10_000,
        deltaReserved: 0,
      });
    }
  });

  const encrypted = await encryptCredential(mockKey);
  await withSystemTransaction(adminPool, async (ctx) => {
    const dal = createSystemDal(ctx);
    await dal.modelConfigurations.upsert({
      orgId: exhaust.orgId,
      deploymentMode: 'saas',
      endpointUrl: `${mockUrl}/v1/chat/completions`,
      modelName: 'mock-model',
      timeoutMs: 5000,
      credentialCiphertext: encrypted.ciphertext,
      credentialKeyVersion: encrypted.keyVersion,
    });
    await dal.modelConfigurations.upsert({
      orgId: fail429.orgId,
      deploymentMode: 'saas',
      endpointUrl: `${mockUrl}/v1/chat/completions?behavior=429`,
      modelName: 'mock-model',
      timeoutMs: 5000,
      credentialCiphertext: encrypted.ciphertext,
      credentialKeyVersion: encrypted.keyVersion,
    });
    await dal.modelConfigurations.upsert({
      orgId: fail500.orgId,
      deploymentMode: 'saas',
      endpointUrl: `${mockUrl}/v1/chat/completions?behavior=500`,
      modelName: 'mock-model',
      timeoutMs: 5000,
      credentialCiphertext: encrypted.ciphertext,
      credentialKeyVersion: encrypted.keyVersion,
    });
    await dal.modelConfigurations.upsert({
      orgId: failTimeout.orgId,
      deploymentMode: 'saas',
      endpointUrl: `${mockUrl}/v1/chat/completions?behavior=slow&latency_ms=5000`,
      modelName: 'mock-model',
      timeoutMs: 1000,
      credentialCiphertext: encrypted.ciphertext,
      credentialKeyVersion: encrypted.keyVersion,
    });
  });

  const orgs: Record<string, OrgSession> = {
    exhaust: { orgId: exhaust.orgId, cookies: exhaustCookies },
    fail429: { orgId: fail429.orgId, cookies: [fail429.cookie] },
    fail500: { orgId: fail500.orgId, cookies: [fail500.cookie] },
    failTimeout: { orgId: failTimeout.orgId, cookies: [failTimeout.cookie] },
  };

  const stopAt = Date.now() + DURATION_MS;
  let samplerStop = false;

  const sampler = (async () => {
    while (!samplerStop) {
      const rows = await withSystemTransaction(adminPool, async (ctx) => {
        const accounts = await ctx.query<{ org_id: string; available: string; reserved: string }>(
          `SELECT org_id::text, available::text, reserved::text
             FROM org_credit_accounts
            WHERE org_id = ANY($1::uuid[])`,
          [orgIds],
        );
        const backends = await ctx.query<{ n: string }>(
          `SELECT numbackends::text AS n FROM pg_stat_database WHERE datname = current_database()`,
        );
        const activity = await ctx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database()`,
        );
        return {
          accounts: accounts.rows,
          backends: Number.parseInt(backends.rows[0]?.n ?? '0', 10),
          activity: Number.parseInt(activity.rows[0]?.n ?? '0', 10),
        };
      });
      backendsPeak = Math.max(backendsPeak, rows.backends);
      activityPeak = Math.max(activityPeak, rows.activity);
      const now = Date.now();
      for (const row of rows.accounts) {
        const available = Number.parseInt(row.available, 10);
        const reserved = Number.parseInt(row.reserved, 10);
        samples.push({ at: now, orgId: row.org_id, available, reserved });
        if (available < 0 || reserved < 0) {
          negativeSeen = true;
          negativeDetail = `negative balance sampled org=${row.org_id} available=${String(available)} reserved=${String(reserved)}`;
          samplerStop = true;
        }
      }
      sampleTicks += 1;
      if (sampleTicks % 20 === 0) {
        try {
          const { stdout } = await execFileAsync(
            'docker',
            ['compose', 'stats', 'postgres', '--no-stream', '--format', '{{.CPUPerc}}'],
            { cwd: root, timeout: 4000 },
          );
          const cpu = Number.parseFloat(stdout.replace('%', '').trim());
          if (!Number.isNaN(cpu)) {
            postgresCpuPeak = Math.max(postgresCpuPeak, cpu);
          }
        } catch {
          // docker stats is evidence when Compose is present; skip otherwise
        }
      }
      await delay(SAMPLE_MS);
    }
  })();

  type Job =
    { kind: 'inference'; org: OrgSession } | { kind: 'read'; cookie: string; path: string };

  const jobs: Job[] = [];
  for (let i = 0; i < 140; i += 1) {
    jobs.push({ kind: 'inference', org: orgs.exhaust! });
  }
  for (let i = 0; i < 20; i += 1) {
    jobs.push({ kind: 'inference', org: orgs.fail429! });
  }
  for (let i = 0; i < 20; i += 1) {
    jobs.push({ kind: 'inference', org: orgs.fail500! });
  }
  for (let i = 0; i < 10; i += 1) {
    jobs.push({ kind: 'inference', org: orgs.failTimeout! });
  }
  const readPaths = ['/members', '/credits/ledger', '/credits/reservations/me'];
  for (let i = 0; i < 10; i += 1) {
    jobs.push({
      kind: 'read',
      cookie: exhaust.cookie,
      path: readPaths[i % readPaths.length]!,
    });
  }

  async function runWorker(job: Job): Promise<void> {
    let cookieIndex = 0;
    while (Date.now() < stopAt && !negativeSeen) {
      const started = performance.now();
      let status = 0;
      let aborted = false;
      try {
        if (job.kind === 'inference') {
          inferenceAttempts += 1;
          const cookie = job.org.cookies[cookieIndex % job.org.cookies.length]!;
          cookieIndex += 1;
          const response = await api(baseUrl, 'POST', '/inference', {
            cookie,
            idempotencyKey: randomUUID(),
            json: { max_total_tokens: MAX_TOKENS },
          });
          status = response.status;
          if (status === 200) {
            inferenceOk += 1;
          }
        } else {
          const response = await api(baseUrl, 'GET', job.path, { cookie: job.cookie });
          status = response.status;
        }
      } catch (error: unknown) {
        aborted =
          (error instanceof Error && error.name === 'TimeoutError') ||
          (error instanceof Error && error.name === 'AbortError');
        if (!aborted) {
          status = 0;
        }
      }
      const elapsed = performance.now() - started;
      latencies.push(elapsed);
      categories[categorize(status, aborted)] += 1;
    }
  }

  const startedAt = Date.now();
  await Promise.all(jobs.map((job) => runWorker(job)));
  const durationMs = Date.now() - startedAt;
  samplerStop = true;
  await sampler.catch(() => undefined);
  if (negativeSeen) {
    throw new Error(negativeDetail);
  }

  const sweepPool = createPool({ connectionString: databaseAdminUrl(), max: 4 });
  try {
    let acquired = false;
    for (let i = 0; i < 20; i += 1) {
      const result = await runReconciliationSweep(sweepPool);
      if (result.acquiredLock) {
        acquired = true;
        break;
      }
      await delay(100);
    }
    if (!acquired) {
      console.warn('sweeper did not acquire the advisory lock; asserting against current rows');
    }
  } finally {
    await sweepPool.end();
  }

  const checks = await withSystemTransaction(adminPool, async (ctx) => {
    const identity = await ctx.query<{ org_id: string; mismatches: string }>(
      `SELECT a.org_id::text,
              (CASE WHEN a.available::bigint IS DISTINCT FROM coalesce(s.da, 0)::bigint
                      OR a.reserved::bigint IS DISTINCT FROM coalesce(s.dr, 0)::bigint
                    THEN 1 ELSE 0 END)::text AS mismatches
         FROM org_credit_accounts a
         LEFT JOIN (
           SELECT org_id,
                  sum(delta_available) AS da,
                  sum(delta_reserved) AS dr
             FROM credit_ledger
            GROUP BY org_id
         ) s ON s.org_id = a.org_id
        WHERE a.org_id = ANY($1::uuid[])`,
      [orgIds],
    );
    const dangling = await ctx.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM credit_reservations
        WHERE org_id = ANY($1::uuid[])
          AND status = 'reserved'
          AND expires_at < now()`,
      [orgIds],
    );
    const settlements = await ctx.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM credit_ledger
        WHERE org_id = ANY($1::uuid[])
          AND kind = 'settlement'`,
      [orgIds],
    );
    const exhaustFinal = await ctx.query<{ available: string; reserved: string }>(
      `SELECT available::text, reserved::text FROM org_credit_accounts WHERE org_id = $1`,
      [exhaust.orgId],
    );
    return {
      identityMismatches: identity.rows.filter((row) => row.mismatches !== '0').length,
      dangling: Number.parseInt(dangling.rows[0]?.n ?? '0', 10),
      settlements: Number.parseInt(settlements.rows[0]?.n ?? '0', 10),
      exhaustAvailable: Number.parseInt(exhaustFinal.rows[0]?.available ?? '0', 10),
      exhaustReserved: Number.parseInt(exhaustFinal.rows[0]?.reserved ?? '0', 10),
    };
  });

  await adminPool.end();

  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.length;
  const summary = {
    environment: 'compose two-replica stack via TEST_BASE_URL',
    workers: WORKERS,
    durationMs,
    requests: total,
    requestRate: total / (durationMs / 1000),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    categories,
    inferenceAttempts,
    inferenceOk,
    settlements: checks.settlements,
    exhaustCreditsSeeded: EXHAUST_CREDITS,
    exhaustFinal: {
      available: checks.exhaustAvailable,
      reserved: checks.exhaustReserved,
    },
    samples: samples.length,
    negativeSeen,
    identityMismatches: checks.identityMismatches,
    danglingExpiredReservations: checks.dangling,
    db: {
      backendsPeak,
      activityPeak,
      postgresCpuPeakPercent: postgresCpuPeak,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  const failures: string[] = [];
  if (negativeSeen) {
    failures.push('a sampled balance was negative');
  }
  if (checks.identityMismatches > 0) {
    failures.push('ledger sums do not match account available/reserved');
  }
  if (checks.dangling > 0) {
    failures.push(`${String(checks.dangling)} expired reservations still reserved after sweep`);
  }
  if (inferenceOk !== checks.settlements) {
    failures.push(
      `inference HTTP 200 count ${String(inferenceOk)} != settlement rows ${String(checks.settlements)}`,
    );
  }
  if (categories.insufficient === 0) {
    failures.push('exhaust org never returned 402 — credit exhaustion did not happen under load');
  }
  if (failures.length > 0) {
    throw new Error(`load invariant failed: ${failures.join('; ')}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (error instanceof Error && error.cause) {
    console.error(error.cause);
  }
  process.exit(1);
});
