import https from 'node:https';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Secret } from '@craftifai/shared';
import { createLogger } from '../src/logger.js';
import { callChatModel, ModelCallError, setExtraCaBundle } from '../src/services/modelClient.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cert = readFileSync(path.join(dir, 'fixtures/tls-cert.pem'));
const key = readFileSync(path.join(dir, 'fixtures/tls-key.pem'));
const allowLoopback = { allowedPrivateCidrs: ['127.0.0.0/8'] };

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
