import { describe, expect, it } from 'vitest';
import {
  API_REQUEST_TIMEOUT_DEFAULT_MS,
  API_REQUEST_TIMEOUT_MIN_MS,
  apiRequestTimeoutMs,
} from '../src/env.js';

describe('API_REQUEST_TIMEOUT_MS', () => {
  it('defaults above the max org model timeout and rejects a ceiling that would clip it', () => {
    const previous = process.env.API_REQUEST_TIMEOUT_MS;
    try {
      delete process.env.API_REQUEST_TIMEOUT_MS;
      expect(apiRequestTimeoutMs()).toBe(API_REQUEST_TIMEOUT_DEFAULT_MS);
      expect(apiRequestTimeoutMs()).toBeGreaterThanOrEqual(120_000);

      process.env.API_REQUEST_TIMEOUT_MS = '120000';
      expect(() => apiRequestTimeoutMs()).toThrow(/API_REQUEST_TIMEOUT_MS/);

      process.env.API_REQUEST_TIMEOUT_MS = String(API_REQUEST_TIMEOUT_MIN_MS);
      expect(apiRequestTimeoutMs()).toBe(API_REQUEST_TIMEOUT_MIN_MS);
    } finally {
      if (previous === undefined) {
        delete process.env.API_REQUEST_TIMEOUT_MS;
      } else {
        process.env.API_REQUEST_TIMEOUT_MS = previous;
      }
    }
  });
});
