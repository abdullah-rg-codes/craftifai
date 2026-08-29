import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  migrationProcessOptions,
  withSystemTransaction,
  withTransaction,
  type DatabasePool,
} from '@craftifai/db';

function fakePool() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as DatabasePool;
  return { pool, query, release };
}

describe('transaction context', () => {
  it('uses the Windows command shim through a shell only on Windows', () => {
    expect(migrationProcessOptions('win32')).toEqual({
      executable: 'dbmate.cmd',
      shell: true,
    });
    expect(migrationProcessOptions('linux')).toEqual({
      executable: 'dbmate',
      shell: false,
    });
  });

  it('sets organization scope transaction-locally before application queries', async () => {
    const { pool, query, release } = fakePool();

    await withTransaction(pool, '81c88c6d-524d-49eb-aa6e-d4a48f2e2bda', async (ctx) => {
      expect(ctx.scope).toBe('organization');
      expect(ctx.orgId).toBe('81c88c6d-524d-49eb-aa6e-d4a48f2e2bda');
      await ctx.query('SELECT 42');
    });

    expect(query.mock.calls).toEqual([
      ['BEGIN'],
      ["SELECT set_config('app.is_system', 'false', true)"],
      ["SELECT set_config('app.current_org', $1, true)", ['81c88c6d-524d-49eb-aa6e-d4a48f2e2bda']],
      ['SELECT 42', undefined],
      ['COMMIT'],
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('marks deliberate system transactions separately', async () => {
    const { pool, query, release } = fakePool();

    await withSystemTransaction(pool, async (ctx) => {
      expect(ctx.scope).toBe('system');
      expect(ctx.orgId).toBeUndefined();
    });

    expect(query.mock.calls).toEqual([
      ['BEGIN'],
      ["SELECT set_config('app.current_org', '', true)"],
      ["SELECT set_config('app.is_system', 'true', true)"],
      ['COMMIT'],
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the connection when work fails', async () => {
    const { pool, query, release } = fakePool();
    const failure = new Error('work failed');

    await expect(
      withTransaction(pool, '81c88c6d-524d-49eb-aa6e-d4a48f2e2bda', () => Promise.reject(failure)),
    ).rejects.toBe(failure);

    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });
});
