import { lookup } from 'node:dns/promises';
import { env } from '../env.js';

export interface SsrfPolicy {
  allowedPrivateCidrs: string[];
}

export interface PinnedTarget {
  href: string;
  hostname: string;
  address: string;
  port: number;
  protocol: 'http:' | 'https:';
}

export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

const ALWAYS_BLOCKED_CIDRS = ['0.0.0.0/8', '169.254.0.0/16'];
const DEFAULT_BLOCKED_CIDRS = [
  '10.0.0.0/8',
  '127.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
];

export function parseCidr(cidr: string): { network: number; mask: number } {
  const [ip, bitsRaw] = cidr.split('/');
  if (!ip || bitsRaw === undefined) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const bits = Number.parseInt(bitsRaw, 10);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    throw new Error(`Invalid CIDR prefix: ${cidr}`);
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { network: ipv4ToInt(ip) & mask, mask };
}

export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number.parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new Error(`Invalid IPv4 address: ${ip}`);
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

export function cidrContains(ip: string, cidr: string): boolean {
  const { network, mask } = parseCidr(cidr);
  return (ipv4ToInt(ip) & mask) === network;
}

export function isAlwaysBlockedAddress(address: string): boolean {
  if (address === '::1' || address.toLowerCase().startsWith('fe80:')) {
    return true;
  }
  if (!address.includes('.')) {
    return true;
  }
  return ALWAYS_BLOCKED_CIDRS.some((cidr) => cidrContains(address, cidr));
}

export function isBlockedAddress(address: string, policy: SsrfPolicy): boolean {
  if (isAlwaysBlockedAddress(address)) {
    return true;
  }
  if (!address.includes('.')) {
    return true;
  }
  const allowed = policy.allowedPrivateCidrs;
  if (allowed.some((cidr) => cidrContains(address, cidr))) {
    return false;
  }
  return DEFAULT_BLOCKED_CIDRS.some((cidr) => cidrContains(address, cidr));
}

export function currentSsrfPolicy(): SsrfPolicy {
  return { allowedPrivateCidrs: env.allowedPrivateCidrs() };
}

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }>;

const defaultLookup: LookupFn = async (hostname) => lookup(hostname, { family: 4, verbatim: true });

export async function pinUrl(
  rawUrl: string,
  policy: SsrfPolicy = currentSsrfPolicy(),
  resolve: LookupFn = defaultLookup,
): Promise<PinnedTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Model endpoint is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('Model endpoint must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError('Model endpoint must not include credentials in the URL');
  }

  const hostname = parsed.hostname;
  let address: string;
  if (isLiteralIpv4(hostname)) {
    address = hostname;
  } else {
    const resolved = await resolve(hostname);
    address = resolved.address;
  }

  if (isBlockedAddress(address, policy)) {
    throw new SsrfBlockedError(`Model endpoint resolves to a blocked address (${address})`);
  }

  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === 'https:'
      ? 443
      : 80;

  return {
    href: parsed.href,
    hostname,
    address,
    port,
    protocol: parsed.protocol,
  };
}

function isLiteralIpv4(hostname: string): boolean {
  try {
    ipv4ToInt(hostname);
    return true;
  } catch {
    return false;
  }
}
