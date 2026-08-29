import pino from 'pino';

const redactPaths = [
  'headers.authorization',
  'headers.cookie',
  'password',
  'passwordHash',
  'credential',
  'apiKey',
  'token',
  'secret',
  'webhookSecret',
  'encryptionKey',
  'config.credential',
  'err.config.headers.Authorization',
  'err.config.headers.authorization',
  'err.request.headers.Authorization',
  'err.request.headers.authorization',
];

export function createLogger() {
  const isDev = process.env.NODE_ENV === 'development';
  const options = {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: redactPaths,
      remove: true,
    },
    base: { name: 'craftifai-api' },
  } as const;
  return isDev
    ? pino({
        ...options,
        transport: { target: 'pino-pretty', options: { colorize: true } },
      })
    : pino(options);
}

export type Logger = ReturnType<typeof createLogger>;
