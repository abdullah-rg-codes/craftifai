import { Pool, types, type PoolClient } from 'pg';
import { databaseUrl } from './env.js';

// Parse numeric types as strings to avoid loss of precision; the application layer
// converts to bigint where appropriate.
types.setTypeParser(types.builtins.INT8, (val) => val);
types.setTypeParser(types.builtins.NUMERIC, (val) => val);

export interface DatabasePool {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

export function createPool(
  options: { connectionString?: string; max?: number } = {},
): DatabasePool {
  const pool = new Pool({
    connectionString: options.connectionString ?? databaseUrl(),
    max: options.max ?? 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (error: Error) => {
    process.stderr.write(`pg pool idle client error: ${error.message}\n`);
  });
  return pool;
}
