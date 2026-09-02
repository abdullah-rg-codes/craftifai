import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '@craftifai/shared';
import { createErrorHandler } from '../src/errors.js';
import { createLogger } from '../src/logger.js';

function createErrorApp() {
  const app = express();
  app.get('/typed', () => {
    throw new AppError('NOT_FOUND', 'Hidden resource', 404);
  });
  app.get('/validation', () => {
    z.object({ id: z.string().uuid() }).parse({ id: 'invalid' });
  });
  app.get('/unique', () => {
    throw Object.assign(new Error('sensitive database detail'), { code: '23505' });
  });
  app.get('/invalid-uuid', () => {
    throw Object.assign(new Error('invalid input syntax for type uuid: "foo%"'), { code: '22P02' });
  });
  app.get('/undefined-table', () => {
    throw Object.assign(new Error('relation "credit_reservations" does not exist'), {
      code: '42P01',
    });
  });
  app.get('/pg-auth', () => {
    throw Object.assign(new Error('password authentication failed for user "craftifai_app"'), {
      code: '28P01',
    });
  });
  app.get('/pg-refused', () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
      port: 5432,
    });
  });
  app.get('/redis-refused', () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
      port: 6379,
    });
  });
  app.get('/unknown', () => {
    throw new Error('sensitive internal detail');
  });
  app.use(createErrorHandler(createLogger()));
  return supertest(app);
}

describe('central error mapping', () => {
  const app = createErrorApp();

  it('preserves typed application status and code', async () => {
    const response = await app.get('/typed').expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Hidden resource' },
    });
  });

  it('maps Zod failures to a safe validation response', async () => {
    const response = await app.get('/validation').expect(400);
    expect(response.body.error.code).toBe('VALIDATION');
    expect(response.body.error.details.issues).toContain('id');
  });

  it('maps unique violations without exposing database details', async () => {
    const response = await app.get('/unique').expect(409);
    expect(response.body).toEqual({
      error: { code: 'CONFLICT', message: 'Resource already exists' },
    });
    expect(response.text).not.toContain('sensitive database detail');
  });

  it('maps invalid UUID text without exposing database details', async () => {
    const response = await app.get('/invalid-uuid').expect(400);
    expect(response.body).toEqual({
      error: { code: 'VALIDATION', message: 'Invalid identifier format' },
    });
    expect(response.text).not.toContain('invalid input syntax');
    expect(response.text).not.toContain('foo%');
  });

  it('maps a missing relation to 503 without exposing catalog names', async () => {
    const response = await app.get('/undefined-table').expect(503);
    expect(response.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' },
    });
    expect(response.text).not.toContain('credit_reservations');
    expect(response.text).not.toContain('does not exist');
  });

  it('maps a database authentication failure to 503 without exposing the role', async () => {
    const response = await app.get('/pg-auth').expect(503);
    expect(response.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' },
    });
    expect(response.text).not.toContain('password authentication failed');
    expect(response.text).not.toContain('craftifai_app');
  });

  it('maps a refused database connection to 503 without exposing the host', async () => {
    const response = await app.get('/pg-refused').expect(503);
    expect(response.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' },
    });
    expect(response.text).not.toContain('ECONNREFUSED');
    expect(response.text).not.toContain('5432');
  });

  it('does not label a refused Redis connection as a database outage', async () => {
    const response = await app.get('/redis-refused').expect(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
    expect(response.text).not.toContain('Database unavailable');
    expect(response.text).not.toContain('6379');
  });

  it('maps unknown errors without leaking internals', async () => {
    const response = await app.get('/unknown').expect(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
    expect(response.text).not.toContain('sensitive internal detail');
  });
});
