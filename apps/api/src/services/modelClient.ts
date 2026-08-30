import http from 'node:http';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from '../logger.js';
import { env } from '../env.js';
import type { Secret } from '@craftifai/shared';
import { pinUrl, SsrfBlockedError, type PinnedTarget, type SsrfPolicy } from './ssrf.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ModelChatResponse {
  usage: ModelUsage;
  completion?: string;
}

export type ModelCallFailure =
  | { kind: 'timeout'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'malformed'; message: string }
  | { kind: 'ssrf'; message: string };

export class ModelCallError extends Error {
  readonly failure: ModelCallFailure;

  constructor(failure: ModelCallFailure) {
    super(failure.message);
    this.name = 'ModelCallError';
    this.failure = failure;
  }
}

export interface ModelCallInput {
  endpointUrl: string;
  modelName: string;
  timeoutMs: number;
  credential: Secret;
  messages: ModelMessage[];
  maxTokens: number;
  correlationId: string;
  caBundle?: Buffer;
  policy?: SsrfPolicy;
}

interface RawAttempt {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  headersReceived: boolean;
}

function logModelContentEnabled(): boolean {
  return process.env.LOG_MODEL_CONTENT === 'true';
}

function backoffMs(attempt: number): number {
  const base = 50 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 25);
  return Math.min(400, base + jitter);
}

function parseRetryAfter(header: string | string[] | undefined): number | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function parseModelResponse(body: Buffer): ModelChatResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new ModelCallError({
      kind: 'malformed',
      message: 'Model response was not valid JSON',
    });
  }
  if (typeof parsed !== 'object' || parsed === null || !('usage' in parsed)) {
    throw new ModelCallError({
      kind: 'malformed',
      message: 'Model response is missing usage',
    });
  }
  const usage = (parsed as { usage: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) {
    throw new ModelCallError({
      kind: 'malformed',
      message: 'Model response usage is invalid',
    });
  }
  const total = (usage as { total_tokens?: unknown }).total_tokens;
  const prompt = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (usage as { completion_tokens?: unknown }).completion_tokens;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new ModelCallError({
      kind: 'malformed',
      message: 'Model response usage.total_tokens is invalid',
    });
  }
  const text = extractCompletion(parsed as object);
  return {
    usage: {
      total_tokens: total,
      prompt_tokens: typeof prompt === 'number' && Number.isInteger(prompt) ? prompt : 0,
      completion_tokens:
        typeof completion === 'number' && Number.isInteger(completion) ? completion : 0,
    },
    ...(text !== undefined ? { completion: text } : {}),
  };
}

function extractCompletion(parsed: object): string | undefined {
  if (!('choices' in parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
    return undefined;
  }
  const first = parsed.choices[0];
  if (typeof first !== 'object' || first === null || !('message' in first)) {
    return undefined;
  }
  const message = first.message;
  if (typeof message !== 'object' || message === null || !('content' in message)) {
    return undefined;
  }
  return typeof message.content === 'string' ? message.content : undefined;
}

async function requestPinned(
  target: PinnedTarget,
  input: {
    method: string;
    pathAndQuery: string;
    headers: http.OutgoingHttpHeaders;
    body?: Buffer;
    timeoutMs: number;
    caBundle?: Buffer;
  },
): Promise<RawAttempt> {
  const transport = target.protocol === 'https:' ? https : http;
  const requestOptions: https.RequestOptions = {
    protocol: target.protocol,
    hostname: target.address,
    port: target.port,
    path: input.pathAndQuery,
    method: input.method,
    headers: {
      ...input.headers,
      host: target.hostname,
    },
    timeout: input.timeoutMs,
  };
  if (target.protocol === 'https:') {
    requestOptions.servername = target.hostname;
    if (input.caBundle) {
      requestOptions.ca = input.caBundle;
    }
  }

  return new Promise((resolve, reject) => {
    let headersReceived = false;
    const req = transport.request(requestOptions, (res) => {
      headersReceived = true;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
          headersReceived: true,
        });
      });
      res.on('error', (error) => {
        reject(Object.assign(error, { headersReceived: true }));
      });
    });
    req.on('timeout', () => {
      const timeoutError = new ModelCallError({
        kind: 'timeout',
        message: 'Model request timed out',
      });
      (timeoutError as ModelCallError & { headersReceived?: boolean }).headersReceived =
        headersReceived;
      req.destroy(timeoutError);
    });
    req.on('error', (error) => {
      if (error instanceof ModelCallError) {
        reject(error);
        return;
      }
      const wrapped = new ModelCallError({
        kind: 'unavailable',
        message: error instanceof Error ? error.message : 'Model connection failed',
      });
      (wrapped as ModelCallError & { headersReceived?: boolean }).headersReceived = headersReceived;
      reject(wrapped);
    });
    if (input.body) {
      req.write(input.body);
    }
    req.end();
  });
}

async function followIfRedirect(
  attempt: RawAttempt,
  current: PinnedTarget,
  policy: SsrfPolicy | undefined,
  hops: number,
): Promise<PinnedTarget | undefined> {
  if (attempt.status < 300 || attempt.status >= 400) {
    return undefined;
  }
  if (hops >= 2) {
    throw new ModelCallError({
      kind: 'unavailable',
      message: 'Model endpoint redirected too many times',
    });
  }
  const locationHeader = attempt.headers.location;
  const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
  if (!location) {
    throw new ModelCallError({
      kind: 'unavailable',
      message: 'Model endpoint returned a redirect without Location',
    });
  }
  const nextUrl = new URL(location, current.href).href;
  try {
    return await pinUrl(nextUrl, policy);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw new ModelCallError({ kind: 'ssrf', message: error.message });
    }
    throw error;
  }
}

export async function callChatModel(
  input: ModelCallInput,
  logger: Logger,
): Promise<ModelChatResponse> {
  const maxRetries = env.modelMaxRetries();
  const startedAt = performance.now();
  let lastError: ModelCallError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await delay(backoffMs(attempt - 1));
    }
    try {
      const result = await callOnce(input, logger);
      logger.info(
        {
          correlationId: input.correlationId,
          model: input.modelName,
          outcome: 'success',
          latencyMs: Math.round(performance.now() - startedAt),
          totalTokens: result.usage.total_tokens,
          ...(logModelContentEnabled() ? { messages: input.messages } : { promptLogged: false }),
        },
        'model call completed',
      );
      return result;
    } catch (error) {
      if (!(error instanceof ModelCallError)) {
        throw error;
      }
      lastError = error;
      const headersReceived =
        (error as ModelCallError & { headersReceived?: boolean }).headersReceived === true;
      const retryable =
        (error.failure.kind === 'timeout' && !headersReceived) ||
        (error.failure.kind === 'unavailable' && !headersReceived) ||
        (error.failure.kind === 'unavailable' && error.message.includes('HTTP 5'));
      if (!retryable || attempt === maxRetries) {
        logger.info(
          {
            correlationId: input.correlationId,
            model: input.modelName,
            outcome: error.failure.kind,
            latencyMs: Math.round(performance.now() - startedAt),
            ...(logModelContentEnabled() ? { messages: input.messages } : { promptLogged: false }),
          },
          'model call failed',
        );
        throw error;
      }
    }
  }
  throw lastError ?? new ModelCallError({ kind: 'unavailable', message: 'Model call failed' });
}

async function callOnce(input: ModelCallInput, _logger: Logger): Promise<ModelChatResponse> {
  let target: PinnedTarget;
  try {
    target = await pinUrl(input.endpointUrl, input.policy);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw new ModelCallError({ kind: 'ssrf', message: error.message });
    }
    throw error;
  }

  const parsedEndpoint = new URL(input.endpointUrl);
  const payload = Buffer.from(
    JSON.stringify({
      model: input.modelName,
      messages: input.messages,
      max_tokens: input.maxTokens,
    }),
    'utf8',
  );

  const headers: http.OutgoingHttpHeaders = {
    'content-type': 'application/json',
    'content-length': payload.length,
    'x-correlation-id': input.correlationId,
    authorization: input.credential.use((value) => `Bearer ${value}`),
  };

  let hops = 0;
  let current = target;
  let pathAndQuery = `${parsedEndpoint.pathname}${parsedEndpoint.search}`;
  for (;;) {
    const attempt = await requestPinned(current, {
      method: 'POST',
      pathAndQuery,
      headers,
      body: payload,
      timeoutMs: input.timeoutMs,
      ...(input.caBundle ? { caBundle: input.caBundle } : {}),
    });
    const redirected = await followIfRedirect(attempt, current, input.policy, hops);
    if (redirected) {
      hops += 1;
      current = redirected;
      const next = new URL(redirected.href);
      pathAndQuery = `${next.pathname}${next.search}`;
      continue;
    }
    if (attempt.status === 429) {
      const retryAfter = parseRetryAfter(attempt.headers['retry-after']);
      throw new ModelCallError({
        kind: 'unavailable',
        message: retryAfter
          ? `Model rate limited; retry after ${String(retryAfter)}s`
          : 'Model rate limited',
      });
    }
    if (attempt.status >= 500) {
      const error = new ModelCallError({
        kind: 'unavailable',
        message: `HTTP ${String(attempt.status)} from model`,
      });
      throw error;
    }
    if (attempt.status === 401 || attempt.status === 403) {
      throw new ModelCallError({
        kind: 'unavailable',
        message: 'Model rejected the configured credential',
      });
    }
    if (attempt.status < 200 || attempt.status >= 300) {
      throw new ModelCallError({
        kind: 'unavailable',
        message: `HTTP ${String(attempt.status)} from model`,
      });
    }
    return parseModelResponse(attempt.body);
  }
}
