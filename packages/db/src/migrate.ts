import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { databaseAdminUrl } from './env.js';
import { loadRepoEnv } from './loadRepoEnv.js';

const direction = process.argv[2];

export function migrationProcessOptions(platform: NodeJS.Platform): {
  executable: string;
  shell: boolean;
} {
  return {
    executable: platform === 'win32' ? 'dbmate.cmd' : 'dbmate',
    shell: platform === 'win32',
  };
}

export async function migrate(command: 'up' | 'down'): Promise<void> {
  loadRepoEnv();
  const { executable, shell } = migrationProcessOptions(process.platform);
  const child = spawn(
    executable,
    [
      '--migrations-dir',
      './migrations',
      '--schema-file',
      './migrations/schema.sql',
      ...(command === 'up' ? ['--wait'] : []),
      command,
    ],
    {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL: databaseAdminUrl(),
      },
      stdio: 'inherit',
      shell,
    },
  );
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`dbmate ${command} failed with exit code ${String(exitCode)}`);
  }
}

async function main(): Promise<void> {
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Usage: tsx ./src/migrate.ts <up|down>');
  }
  await migrate(direction);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
