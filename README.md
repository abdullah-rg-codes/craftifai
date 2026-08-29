# CraftifAI

A multi-tenant AI control plane take-home assignment. Built for correctness under concurrency, not feature count.

## Quick start

Requires: Node.js 22+, pnpm, Docker Compose.

```bash
# Install dependencies (build scripts for esbuild and dbmate are allowed via pnpm-workspace.yaml)
pnpm install

# Copy environment file and edit secrets
cp .env.example .env

# Start backing services and apply migrations
pnpm compose:up
pnpm db:migrate

# Fast tests without infrastructure
pnpm test:unit

# Complete suite; fails fast unless PostgreSQL and Redis test URLs are configured
pnpm test

# Start dev servers
pnpm dev
```

## Documentation

- [docs/assignment.md](docs/assignment.md) — the brief
- ARCHITECTURE.md — components, data flow, scaling (Phase 7)
- SECURITY.md — threat model, tenant isolation, secrets, SSRF (Phase 7)
- OPERATIONS.md — runbooks, backup/restore, upgrade/rollback (Phase 7)
- AI_USAGE.md — AI-assisted development log (Phase 7)

## Development

This is a pnpm monorepo with TypeScript `strict: true` and `noUncheckedIndexedAccess`.

- `apps/api` — Node.js backend
- `apps/web` — React SPA (Vite)
- `packages/db` — versioned SQL migrations and database utilities
- `packages/shared` — shared types and utilities

Tests for credit correctness, idempotency, and concurrency run against a real PostgreSQL database and Redis instance. No SQLite, no mocked repositories.

### Session revocation guarantee

Sessions are PostgreSQL-authoritative and cached in Redis for at most 60 seconds.
Suspending or removing a member revokes all of that user's sessions in the same
database transaction as the membership change, then actively evicts their Redis
entries. Revocation is immediate when Redis is healthy and bounded by the 60-second
cache TTL if eviction fails. No application-process memory participates in the
guarantee.
