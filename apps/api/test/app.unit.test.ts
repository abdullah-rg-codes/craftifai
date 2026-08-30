import express from 'express';
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { DatabasePool } from '@craftifai/db';
import { buildApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';

describe('health and request diagnostics', () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = 'unit-test-session-secret';
  });

  it('keeps liveness healthy but marks readiness unavailable when PostgreSQL fails', async () => {
    const pool = {
      connect: vi.fn().mockRejectedValue(new Error('database unavailable')),
      end: vi.fn(),
    } as unknown as DatabasePool;
    const redis = { ping: vi.fn().mockResolvedValue('PONG') } as unknown as Redis;
    const app = supertest(buildApp(createLogger(), pool, redis) as express.Application);

    const health = await app
      .get('/health')
      .set('Cookie', 'craftifai_session=stale-cookie')
      .expect(200);
    expect(health.body).toMatchObject({ status: 'ok' });
    expect(health.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(pool.connect).not.toHaveBeenCalled();
    await app.get('/ready').expect(503, { status: 'not_ready' });
  });
});
