import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function findRepoRoot(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}

/** Fill unset `process.env` keys from a dotenv string. Existing values win (CI, Compose). */
export function applyDotEnvContents(contents: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const eq = body.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!env[key]) {
      env[key] = value;
    }
  }
}

/** Host `pnpm db:migrate` / `pnpm dev` — no-op when the file is missing or vars are already set. */
export function loadRepoEnv(): void {
  const root = findRepoRoot(process.cwd());
  if (!root) {
    return;
  }
  const file = join(root, '.env');
  if (!existsSync(file)) {
    return;
  }
  applyDotEnvContents(readFileSync(file, 'utf8'));
}
