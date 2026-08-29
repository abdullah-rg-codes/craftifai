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

  it('uses a unique random salt for identical passwords', async () => {
    const first = await hashPassword('same-password');
    const second = await hashPassword('same-password');

    expect(first).not.toBe(second);
    expect(await verifyPassword('same-password', first)).toBe(true);
    expect(await verifyPassword('same-password', second)).toBe(true);
  });

  it.each([
    '',
    'plaintext',
    'scrypt$32768$8$1$bad',
    'scrypt$32768$8$1$%%%$%%%',
    'scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    'argon2$32768$8$1$c2FsdA==$aGFzaA==',
  ])('rejects malformed encoded hash %j without throwing', async (encoded) => {
    await expect(verifyPassword('password', encoded)).resolves.toBe(false);
  });
});
