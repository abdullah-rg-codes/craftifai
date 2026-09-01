import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@craftifai/db';

describe('nginx image build context', () => {
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new Error('workspace root not found');
  }

  it('excludes nested node_modules so a host pnpm install cannot overlay Windows links', () => {
    const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8');
    expect(ignore).toMatch(/^\*\*\/node_modules$/m);
  });

  it('installs web build tools even when Compose forwards NODE_ENV=production', () => {
    const dockerfile = readFileSync(path.join(root, 'deploy/nginx/Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/NODE_ENV=development/);
    expect(dockerfile).toMatch(/pnpm install --frozen-lockfile/);
    expect(dockerfile).toMatch(/pnpm --filter @craftifai\/web build/);
  });
});
