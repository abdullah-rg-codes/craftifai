import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Secret } from '@craftifai/shared';
import { env } from '../env.js';

export const CREDENTIAL_KEY_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

export interface EncryptedCredential {
  ciphertext: Buffer;
  keyVersion: number;
}

export async function encryptCredential(plaintext: string): Promise<EncryptedCredential> {
  const key = await env.encryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, encrypted]),
    keyVersion: CREDENTIAL_KEY_VERSION,
  };
}

export async function decryptCredential(input: EncryptedCredential): Promise<Secret> {
  if (input.keyVersion !== CREDENTIAL_KEY_VERSION) {
    throw new Error(`Unsupported credential key version ${String(input.keyVersion)}`);
  }
  if (input.ciphertext.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Credential ciphertext is truncated');
  }
  const key = await env.encryptionKey();
  const iv = input.ciphertext.subarray(0, IV_LENGTH);
  const tag = input.ciphertext.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = input.ciphertext.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return new Secret(plaintext);
}
