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

  it('maps unknown errors without leaking internals', async () => {
    const response = await app.get('/unknown').expect(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
    expect(response.text).not.toContain('sensitive internal detail');
  });
});
