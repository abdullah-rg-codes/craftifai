import { describe, expect, it, beforeAll } from 'vitest';
import { Secret } from '@craftifai/shared';
import { decryptCredential, encryptCredential } from '../src/services/crypto.js';

describe('credential encryption', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
  });

  it('round-trips a credential into a Secret that cannot serialize', async () => {
    const encrypted = await encryptCredential('sk-live-super-secret');
    expect(encrypted.ciphertext.includes(Buffer.from('sk-live-super-secret'))).toBe(false);
    const secret = await decryptCredential(encrypted);
    expect(secret).toBeInstanceOf(Secret);
    expect(JSON.stringify({ credential: secret })).toBe('{}');
    expect(String(secret)).toBe('[Redacted]');
    expect(secret.use((value) => value)).toBe('sk-live-super-secret');
  });

  it('rejects truncated ciphertext', async () => {
    await expect(
      decryptCredential({ ciphertext: Buffer.from('short'), keyVersion: 1 }),
    ).rejects.toThrow(/truncated/);
  });
});
