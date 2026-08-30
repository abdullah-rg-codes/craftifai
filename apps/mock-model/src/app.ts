import express, { type Application, type Request, type Response } from 'express';

export type MockBehavior = 'ok' | 'slow' | 'reset' | '429' | '500' | 'malformed' | 'redirect';

function behaviorOf(req: Request): MockBehavior {
  const header = req.header('x-mock-behavior');
  const query = typeof req.query.behavior === 'string' ? req.query.behavior : undefined;
  const value = header ?? query ?? 'ok';
  if (
    value === 'ok' ||
    value === 'slow' ||
    value === 'reset' ||
    value === '429' ||
    value === '500' ||
    value === 'malformed' ||
    value === 'redirect'
  ) {
    return value;
  }
  return 'ok';
}

function latencyMs(req: Request, fallback: number): number {
  const header = req.header('x-mock-latency-ms');
  const query = typeof req.query.latency_ms === 'string' ? req.query.latency_ms : undefined;
  const raw = header ?? query;
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function usageTokens(req: Request): number {
  const body = req.body as { max_tokens?: unknown };
  const maxTokens =
    typeof body.max_tokens === 'number' && Number.isInteger(body.max_tokens) && body.max_tokens > 0
      ? body.max_tokens
      : 16;
  return maxTokens > 1000 ? 500 : maxTokens;
}

function expectedApiKey(): string | undefined {
  return process.env.MOCK_MODEL_API_KEY;
}

function authorize(req: Request, res: Response): boolean {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ') || header.slice(7).trim().length === 0) {
    res.status(401).json({ error: { message: 'Missing bearer token' } });
    return false;
  }
  const expected = expectedApiKey();
  if (expected && header.slice(7) !== expected) {
    res.status(401).json({ error: { message: 'Invalid bearer token' } });
    return false;
  }
  return true;
}

export function buildMockModelApp(): Application {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/v1/chat/completions', (req, res) => {
    if (!authorize(req, res)) {
      return;
    }

    const behavior = behaviorOf(req);
    if (behavior === 'reset') {
      req.socket.destroy();
      return;
    }
    if (behavior === 'redirect') {
      const location =
        (typeof req.query.redirect_to === 'string' && req.query.redirect_to) ||
        req.header('x-mock-redirect') ||
        'http://169.254.169.254/latest/meta-data';
      res.redirect(302, location);
      return;
    }
    if (behavior === '429') {
      res.setHeader('Retry-After', '1');
      res.status(429).json({ error: { message: 'rate limited' } });
      return;
    }
    if (behavior === '500') {
      res.status(500).json({ error: { message: 'internal model error' } });
      return;
    }

    const delayMs =
      behavior === 'slow'
        ? latencyMs(req, 10_000)
        : latencyMs(req, 50 + Math.floor(Math.random() * 201));
    setTimeout(() => {
      if (res.writableEnded || res.destroyed) {
        return;
      }
      if (behavior === 'malformed') {
        res.status(200).json({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        });
        return;
      }
      const tokens = usageTokens(req);
      res.status(200).json({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
        usage: {
          prompt_tokens: Math.max(1, Math.floor(tokens / 2)),
          completion_tokens: Math.max(1, tokens - Math.floor(tokens / 2)),
          total_tokens: tokens,
        },
      });
    }, delayMs);
  });

  return app;
}
