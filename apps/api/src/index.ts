import { setTimeout as delay } from 'node:timers/promises';
import type { Application } from 'express';
import { createPool } from '@craftifai/db';
import { createLogger } from './logger.js';
import { buildApp } from './app.js';
import { env, loadModelCaBundle, validateRuntimeConfig } from './env.js';
import { createRedis } from './redis.js';
import { inflightCount } from './inflight.js';
import { observeSweep } from './metrics.js';
import { setExtraCaBundle } from './services/modelClient.js';
import { runReconciliationSweep } from './services/sweeper.js';

const SWEEP_INTERVAL_MS = 30_000;
const DRAIN_TIMEOUT_MS = 10_000;

const logger = createLogger();

try {
  await validateRuntimeConfig();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
setExtraCaBundle(await loadModelCaBundle());

const pool = createPool();
const redis = createRedis();
const app: Application = buildApp(logger, pool, redis);

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'API listening');
});

const sweepTimer = setInterval(() => {
  void runReconciliationSweep(pool, logger)
    .then((result) => {
      observeSweep(result);
    })
    .catch((error: unknown) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'reconciliation sweep failed',
      );
    });
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

async function closeGracefully(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  clearInterval(sweepTimer);
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (inflightCount() > 0 && Date.now() < deadline) {
    await delay(50);
  }
  if (inflightCount() > 0) {
    server.closeAllConnections();
  }
  await redis.quit();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void closeGracefully('SIGTERM'));
process.on('SIGINT', () => void closeGracefully('SIGINT'));

export { app, pool, redis, logger };
