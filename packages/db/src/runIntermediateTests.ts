import { spawn } from 'node:child_process';
import { assertIntegrationTestEnv, findRepoRoot, loadRepoEnv } from './loadRepoEnv.js';

loadRepoEnv();
assertIntegrationTestEnv();

const root = findRepoRoot(process.cwd());
if (!root) {
  throw new Error('workspace root not found');
}

const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--fileParallelism=false',
    'apps/api/test/foundation.test.ts',
    'apps/api/test/credits.test.ts',
    'apps/api/test/gateway.test.ts',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  },
);

child.on('error', (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
