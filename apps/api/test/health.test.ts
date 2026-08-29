import { describe, it, expect } from 'vitest';
import { createPool, withSystemTransaction } from '@craftifai/db';

describe('database connectivity', () => {
  it('connects to PostgreSQL and returns the current timestamp', async () => {
    if (!process.env.DATABASE_URL) {
      // Skipped in environments without the test database; the harness itself is still valid.
      return;
    }
    const pool = createPool();
    const result = await withSystemTransaction(pool, (ctx) =>
      ctx.query<{ now: Date }>('SELECT now() AS now'),
    );
    expect(result.rows[0]?.now).toBeInstanceOf(Date);
    await pool.end();
  });
});
