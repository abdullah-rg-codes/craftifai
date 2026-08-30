import {
  createPool,
  createSystemDal,
  readMountedSecret,
  withSystemTransaction,
} from '@craftifai/db';
import { createLogger } from './logger.js';
import { createRedis } from './redis.js';
import { registerUser } from './auth.js';
import { validateRuntimeConfig } from './env.js';

async function readBootstrapValue(envName: string, fileName: string): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv) {
    return fromEnv;
  }
  const filePath = process.env[fileName];
  if (filePath) {
    return readMountedSecret(filePath);
  }
  return '';
}

export async function bootstrapAdministrator(input: {
  email: string;
  password: string;
}): Promise<{ created: boolean; userId?: string; orgId?: string }> {
  await validateRuntimeConfig();
  const logger = createLogger();
  const pool = createPool();
  const redis = createRedis();
  try {
    const exists = await withSystemTransaction(pool, async (ctx) => {
      return createSystemDal(ctx).memberships.hasAnyAdministrator();
    });
    if (exists) {
      logger.info('bootstrap skipped: an administrator already exists');
      return { created: false };
    }
    if (!input.email || !input.password) {
      throw new Error('BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD are required');
    }
    if (input.password.length < 8) {
      throw new Error('BOOTSTRAP_PASSWORD must be at least 8 characters');
    }
    const result = await registerUser(pool, redis, {
      email: input.email,
      password: input.password,
    });
    logger.info({ userId: result.userId, orgId: result.orgId }, 'bootstrap administrator created');
    return { created: true, userId: result.userId, orgId: result.orgId };
  } finally {
    await redis.quit();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const email = await readBootstrapValue('BOOTSTRAP_EMAIL', 'BOOTSTRAP_EMAIL_FILE');
  const password = await readBootstrapValue('BOOTSTRAP_PASSWORD', 'BOOTSTRAP_PASSWORD_FILE');
  const result = await bootstrapAdministrator({ email, password });
  if (!result.created) {
    process.exit(0);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('bootstrap.ts') || process.argv[1].endsWith('bootstrap.js'));

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
