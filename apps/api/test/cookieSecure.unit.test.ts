import { describe, expect, it } from 'vitest';
import { cookieSecure } from '../src/env.js';

describe('COOKIE_SECURE', () => {
  it('is off unless COOKIE_SECURE=true so HTTP on-prem sessions work', () => {
    const previous = process.env.COOKIE_SECURE;
    try {
      delete process.env.COOKIE_SECURE;
      expect(cookieSecure()).toBe(false);
      process.env.COOKIE_SECURE = 'true';
      expect(cookieSecure()).toBe(true);
      process.env.COOKIE_SECURE = 'false';
      expect(cookieSecure()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.COOKIE_SECURE;
      } else {
        process.env.COOKIE_SECURE = previous;
      }
    }
  });
});
