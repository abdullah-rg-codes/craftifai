import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@craftifai/shared';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const password = 'hunter2';
    const hash = await hashPassword(password);
    expect(hash).toContain('scrypt$');
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
