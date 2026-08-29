import { describe, it, expect } from 'vitest';
import { createPool } from '@craftifai/db';

describe('database connectivity', () => {
  it('connects to PostgreSQL and returns the current timestamp', async () => {
    if (!process.env.DATABASE_URL) {
      // Skipped in environments without the test database; the harness itself is still valid.
      return;
    }
    const pool = createPool();
    const result = await pool.query<{ now: Date }>('SELECT now() AS now');
    expect(result.rows[0]?.now).toBeInstanceOf(Date);
    await pool.end();
  });
});
