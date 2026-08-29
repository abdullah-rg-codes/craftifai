import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEYLEN = 64;
const N = 32768; // CPU/memory cost parameter (2^15)
const R = 8;
const P = 1;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

function encodeHash(salt: Buffer, hash: Buffer): string {
  return `scrypt$${N.toString()}$${R.toString()}$${P.toString()}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function parseHash(encoded: string): { salt: Buffer; hash: Buffer } | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return null;
  }
  if (
    Number.parseInt(parts[1] ?? '', 10) !== N ||
    Number.parseInt(parts[2] ?? '', 10) !== R ||
    Number.parseInt(parts[3] ?? '', 10) !== P
  ) {
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
  const derived = await scryptAsync(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEMORY_BYTES,
  });
  return encodeHash(salt, derived);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) {
    return false;
  }
  const { salt, hash } = parsed;
  const derived = await scryptAsync(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEMORY_BYTES,
  });
  return timingSafeEqual(derived, hash);
}
