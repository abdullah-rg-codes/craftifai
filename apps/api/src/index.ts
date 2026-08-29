import type { Application } from 'express';
import { createPool } from '@craftifai/db';
import { createLogger } from './logger.js';
import { buildApp } from './app.js';
import { env } from './env.js';
import { createRedis } from './redis.js';

const logger = createLogger();
const pool = createPool();
const redis = createRedis();
const app: Application = buildApp(logger, pool, redis);

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'API listening');
});

async function closeGracefully(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await redis.quit();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void closeGracefully('SIGTERM'));
process.on('SIGINT', () => void closeGracefully('SIGINT'));

export { app, pool, redis, logger };
