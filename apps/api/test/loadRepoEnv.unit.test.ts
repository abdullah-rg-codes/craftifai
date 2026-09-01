import { describe, expect, it } from 'vitest';
import { applyDotEnvContents, findRepoRoot } from '@craftifai/db';

describe('loadRepoEnv', () => {
  it('fills only unset keys and strips quotes', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: 'already-set' };
    applyDotEnvContents(
      [
        '# comment',
        '',
        'DATABASE_URL=from-file',
        'REDIS_URL=redis://localhost:6379/0',
        'SESSION_SECRET="quoted"',
        'export WEBHOOK_SECRET=exported',
      ].join('\n'),
      env,
    );
    expect(env.DATABASE_URL).toBe('already-set');
    expect(env.REDIS_URL).toBe('redis://localhost:6379/0');
    expect(env.SESSION_SECRET).toBe('quoted');
    expect(env.WEBHOOK_SECRET).toBe('exported');
  });

  it('finds the workspace root from a package directory', () => {
    expect(findRepoRoot(process.cwd())).toBeDefined();
  });
});
