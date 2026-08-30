import { describe, expect, it } from 'vitest';
import {
  cidrContains,
  isAlwaysBlockedAddress,
  isBlockedAddress,
  pinUrl,
  SsrfBlockedError,
} from '../src/services/ssrf.js';

const blockAll = { allowedPrivateCidrs: [] as string[] };
const allowRfc1918 = { allowedPrivateCidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] };
const allowLoopback = { allowedPrivateCidrs: ['127.0.0.0/8'] };

describe('SSRF pinning', () => {
  it('blocks loopback, link-local, and RFC1918 by default', async () => {
    await expect(pinUrl('http://127.0.0.1/v1', blockAll)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      pinUrl('http://169.254.169.254/latest/meta-data', blockAll),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(pinUrl('http://10.1.2.3/model', blockAll)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('allows RFC1918 only when listed, and never allows link-local', async () => {
    const privateTarget = await pinUrl('http://10.1.2.3:8080/model', allowRfc1918);
    expect(privateTarget.address).toBe('10.1.2.3');
    await expect(pinUrl('http://127.0.0.1/v1', allowRfc1918)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(
      pinUrl('http://169.254.169.254/latest/meta-data', allowRfc1918),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('allows loopback only when 127.0.0.0/8 is explicitly listed', async () => {
    const pinned = await pinUrl('http://127.0.0.1:8081/v1/chat/completions', allowLoopback);
    expect(pinned.address).toBe('127.0.0.1');
    expect(pinned.port).toBe(8081);
  });

  it('pins a hostname to the resolved address and rejects blocked resolutions', async () => {
    await expect(
      pinUrl('http://metadata.internal/latest', blockAll, async () => ({
        address: '169.254.169.254',
        family: 4,
      })),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    const pinned = await pinUrl('http://models.internal:443/v1', allowRfc1918, async () => ({
      address: '10.0.0.9',
      family: 4,
    }));
    expect(pinned.address).toBe('10.0.0.9');
    expect(pinned.hostname).toBe('models.internal');
  });

  it('rejects non-http schemes', async () => {
    await expect(pinUrl('file:///etc/passwd', blockAll)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('matches CIDRs', () => {
    expect(cidrContains('10.0.0.1', '10.0.0.0/8')).toBe(true);
    expect(cidrContains('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(isAlwaysBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('192.168.1.1', blockAll)).toBe(true);
    expect(isBlockedAddress('192.168.1.1', allowRfc1918)).toBe(false);
  });
});
