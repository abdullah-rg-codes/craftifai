import pino from 'pino';

const redactPaths = [
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'password',
  'passwordHash',
  'credential',
  'ca_bundle',
  'caBundle',
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
  'err.options.headers.authorization',
  'err.options.headers.Authorization',
];

export function createLogger(destination?: pino.DestinationStream) {
  const isDev = process.env.NODE_ENV === 'development';
  const options = {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: redactPaths,
      remove: true,
    },
    base: { name: 'craftifai-api' },
  } as const;
  if (destination) {
    return pino(options, destination);
  }
  return isDev
    ? pino({
        ...options,
        transport: { target: 'pino-pretty', options: { colorize: true } },
      })
    : pino(options);
}

export type Logger = ReturnType<typeof createLogger>;
