import type { Pool, QueryResultRow } from 'pg';

export interface TransactionContext {
  readonly query: <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number }>;
  readonly orgId: string | undefined;
}

export async function withTransaction<T>(
  pool: Pool,
  orgId: string | undefined,
  fn: (ctx: TransactionContext) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (orgId) {
      await client.query('SET LOCAL app.current_org = $1', [orgId]);
    } else {
      await client.query('SET LOCAL app.current_org = NULL');
    }
    const ctx: TransactionContext = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => {
        const result = await client.query<T>(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
      orgId,
    };
    const result = await fn(ctx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withSystemTransaction<T>(
  pool: Pool,
  fn: (ctx: TransactionContext) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.is_system = true');
    const ctx: TransactionContext = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => {
        const result = await client.query<T>(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
      orgId: undefined,
    };
    const result = await fn(ctx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
