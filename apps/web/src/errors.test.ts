import { describe, expect, it } from 'vitest';
import { ApiError } from './api.js';
import { playgroundErrorCopy } from './errors.js';

describe('playgroundErrorCopy', () => {
  it('maps insufficient credits with needed and available for members', () => {
    const copy = playgroundErrorCopy(
      new ApiError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits', {
        needed: '2',
        available: '1',
      }),
      'member',
    );
    expect(copy.title).toBe('Not enough credits');
    expect(copy.body).toContain('needed 2 credits');
    expect(copy.body).toContain('has 1 available');
    expect(copy.body).toContain('Ask an administrator');
    expect(copy.body).not.toMatch(/http|credential|endpoint/i);
  });

  it('points administrators at buying credits', () => {
    const copy = playgroundErrorCopy(
      new ApiError(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits', {
        needed: '2',
        available: '0',
      }),
      'administrator',
    );
    expect(copy.body).toContain('Buy more credits');
  });

  it('maps timeout, rate limit, missing config, and model failure without leaking secrets', () => {
    expect(playgroundErrorCopy(new ApiError(504, 'MODEL_TIMEOUT', 'timed out'), 'member')).toEqual({
      title: 'The model timed out',
      body: 'The model did not respond in time. Try again, or ask an administrator to raise the request timeout.',
    });
    expect(
      playgroundErrorCopy(new ApiError(429, 'RATE_LIMITED', 'slow down'), 'member').title,
    ).toBe('Too many requests');
    expect(playgroundErrorCopy(new ApiError(404, 'NOT_FOUND', 'missing'), 'member').title).toBe(
      'Model is not configured',
    );
    expect(
      playgroundErrorCopy(new ApiError(502, 'MODEL_UNAVAILABLE', 'down'), 'member').title,
    ).toBe('The model failed');
    expect(
      playgroundErrorCopy(new ApiError(502, 'MODEL_MALFORMED', 'bad json'), 'administrator').body,
    ).not.toMatch(/http|credential|endpoint/i);
  });
});
