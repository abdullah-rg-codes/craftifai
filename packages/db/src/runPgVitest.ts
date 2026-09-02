import { spawn } from 'node:child_process';
import { assertIntegrationTestEnv, findRepoRoot, loadRepoEnv } from './loadRepoEnv.js';

loadRepoEnv();
assertIntegrationTestEnv();

const root = findRepoRoot(process.cwd());
if (!root) {
  throw new Error('workspace root not found');
}

const files = process.argv.slice(2);
if (files.length === 0) {
  throw new Error('vitest file paths required');
}

const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vitest', 'run', '--fileParallelism=false', ...files],
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
