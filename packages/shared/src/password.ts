import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEYLEN = 64;
const N = 32768; // CPU/memory cost parameter (2^15)
const R = 8;
const P = 1;

function encodeHash(salt: Buffer, hash: Buffer): string {
  return `scrypt$${N.toString()}$${R.toString()}$${P.toString()}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function parseHash(encoded: string): { salt: Buffer; hash: Buffer } | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return null;
  }
  const saltPart = parts[4];
  const hashPart = parts[5];
  if (!saltPart || !hashPart) {
    return null;
  }
  const salt = Buffer.from(saltPart, 'base64');
  const hash = Buffer.from(hashPart, 'base64');
  if (salt.length !== SALT_BYTES || hash.length !== KEYLEN) {
    return null;
  }
  return { salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEYLEN);
  return encodeHash(salt, derived);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) {
    return false;
  }
  const { salt, hash } = parsed;
  const derived = await scryptAsync(password, salt, KEYLEN);
  return timingSafeEqual(derived, hash);
}
