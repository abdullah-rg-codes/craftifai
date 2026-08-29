import type { QueryResultRow } from 'pg';
import type { DatabasePool } from './pool.js';

interface BaseTransactionContext {
  readonly query: <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number }>;
}

export interface OrgTransactionContext extends BaseTransactionContext {
  readonly scope: 'organization';
  readonly orgId: string;
}

export interface SystemTransactionContext extends BaseTransactionContext {
  readonly scope: 'system';
  readonly orgId: undefined;
}

export async function withTransaction<T>(
  pool: DatabasePool,
  orgId: string,
  fn: (ctx: OrgTransactionContext) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_system', 'false', true)");
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    const ctx: OrgTransactionContext = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => {
        const result = await client.query<T>(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
      scope: 'organization',
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
  pool: DatabasePool,
  fn: (ctx: SystemTransactionContext) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org', '', true)");
    await client.query("SELECT set_config('app.is_system', 'true', true)");
    const ctx: SystemTransactionContext = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => {
        const result = await client.query<T>(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
      scope: 'system',
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
