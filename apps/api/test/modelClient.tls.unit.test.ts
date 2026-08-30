import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Secret } from '@craftifai/shared';
import { createLogger } from '../src/logger.js';
import { callChatModel, ModelCallError, setExtraCaBundle } from '../src/services/modelClient.js';

const allowLoopback = { allowedPrivateCidrs: ['127.0.0.0/8'] };

function opensslBin(): string {
  if (process.platform === 'win32') {
    const git = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
    if (existsSync(git)) {
      return git;
    }
  }
  return 'openssl';
}

function generateSelfSigned(): { cert: Buffer; key: Buffer } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'craftifai-tls-'));
  const certPath = path.join(dir, 'cert.pem');
  const keyPath = path.join(dir, 'key.pem');
  try {
    execFileSync(
      opensslBin(),
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'pipe' },
    );
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const { cert, key } = generateSelfSigned();

function listenHttps(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = https.createServer({ cert, key }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('https fixture did not bind'));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => {
              if (error) fail(error);
              else done();
            });
          }),
      });
    });
  });
}

describe('mounted model CA bundle', () => {
  afterEach(() => {
    setExtraCaBundle(undefined);
  });

  it('trusts a private HTTPS model only when the mounted CA is present', async () => {
    const listening = await listenHttps();
    const input = {
      endpointUrl: `https://127.0.0.1:${String(listening.port)}/v1/chat/completions`,
      modelName: 'fixture',
      timeoutMs: 3000,
      credential: new Secret('test-key'),
      messages: [{ role: 'user' as const, content: 'ping' }],
      maxTokens: 8,
      correlationId: 'ca-test',
      policy: allowLoopback,
    };
    const logger = createLogger();
    try {
      await expect(callChatModel(input, logger)).rejects.toBeInstanceOf(ModelCallError);
      setExtraCaBundle(cert);
      const result = await callChatModel(input, logger);
      expect(result.usage.total_tokens).toBe(2);
    } finally {
      await listening.close();
    }
  });
});
