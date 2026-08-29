import { Pool, types } from 'pg';
import { databaseUrl } from './env.js';

// Parse numeric types as strings to avoid loss of precision; the application layer
// converts to bigint where appropriate.
types.setTypeParser(types.builtins.INT8, (val) => val);
types.setTypeParser(types.builtins.NUMERIC, (val) => val);

export function createPool(): Pool {
  return new Pool({
    connectionString: databaseUrl(),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export type { Pool };
