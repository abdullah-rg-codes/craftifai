# CraftifAI

A multi-tenant AI control plane take-home assignment. Built for **correctness under
concurrency**, not feature count.

Graded on invariants: tenant isolation, credit safety, idempotency, multi-instance
behavior, and operability. A smaller implementation that holds these will score higher
than a larger happy-path-only build.

---

## Prerequisites

| Tool             | Version                                      |
| ---------------- | -------------------------------------------- |
| Node.js          | 22+                                          |
| pnpm             | 9+ (repo pins 11.24.0)                       |
| Docker + Compose | For full stack, integration tests, load test |

---

## Quick start (development)

```bash
# 1. Clone and install
git clone <repo-url> craftifai && cd craftifai
pnpm install

# 2. Environment — copy and fill every secret
cp .env.example .env
# Set at minimum: POSTGRES_* passwords, SESSION_SECRET, WEBHOOK_SECRET,
# ENCRYPTION_KEY_BASE64 (openssl rand -base64 32), MOCK_MODEL_API_KEY

# 3. Backing services
docker compose up -d postgres redis mock-model
pnpm db:migrate

# 4. Fast tests (no Docker required for unit/web)
pnpm test:unit

# 5. Dev servers (API :3000, web :5173 with /api proxy)
pnpm dev
```

Open http://localhost:5173 — register creates an organization and administrator.

---

## Full stack (Docker Compose)

Single command after `.env` is complete:

```bash
docker compose up --build -d
```

Open **http://localhost/** — nginx serves the SPA and load-balances `/api/` across
**api-1** and **api-2**.

### First administrator (Compose without register)

```bash
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='choose-a-long-passphrase' \
  docker compose --profile bootstrap run --rm bootstrap
```

### Configure mock model (admin UI)

1. Sign in → **Model** page.
2. Endpoint: `http://mock-model:8081/v1/chat/completions` (from inside Compose network).
3. Model name: `mock-gpt`.
4. Credential: same value as `MOCK_MODEL_API_KEY` in `.env`.
5. **Test connection** → should succeed.

---

## Demo walkthrough

1. **Register** at `/register` (or bootstrap above).
2. **Credits** → start a purchase → **Confirm via mock billing** (applies credits).
3. **Model** → save config → test connection.
4. **Playground** (member or admin) → send inference with auto idempotency key.
5. **Members** → invite a user → copy token → accept at `/invite?token=...` in another browser.
6. **Audit** → see membership and billing events.

---

## Testing

### Unit + web (fast, no infrastructure)

```bash
pnpm test:unit
# alias: pnpm test:sanity
```

### Integration (requires PostgreSQL + Redis)

Set in `.env` (or export):

```bash
DATABASE_URL=postgres://craftifai_app:<app-password>@localhost:5432/craftifai?sslmode=disable
DATABASE_ADMIN_URL=postgres://craftifai_owner:<admin-password>@localhost:5432/craftifai?sslmode=disable
REDIS_URL=redis://localhost:6379/0
SESSION_SECRET=<same-as-env>
WEBHOOK_SECRET=<same-as-env>
ENCRYPTION_KEY_BASE64=<same-as-env>
```

Then:

```bash
pnpm test:intermediate   # foundation + credits + gateway
pnpm test                # sanity + intermediate
```

Credit, idempotency, and concurrency tests use **real PostgreSQL** — not SQLite, not mocked repositories.

### Compose / load-balancer tests

With full stack up:

```bash
TEST_BASE_URL=http://127.0.0.1/api pnpm test:compose
```

---

## Load test

```bash
docker compose up --build -d
TEST_BASE_URL=http://127.0.0.1/api pnpm load:test
```

Requires `DATABASE_ADMIN_URL` for balance sampling. Report: [load/REPORT.md](load/REPORT.md).

The harness asserts: no negative balances, ledger sums match accounts, no dangling expired
reservations, settlement count matches HTTP 200 inferences.

---

## Session revocation

Sessions are PostgreSQL-authoritative, cached in Redis for at most **60 seconds**.
Suspending or removing a member revokes sessions in the same database transaction as the
membership change, then evicts Redis. Revocation is immediate when Redis is healthy;
worst-case bound is the 60 s cache TTL if eviction fails.

---

## Documentation

| Document                                               | Purpose                                      |
| ------------------------------------------------------ | -------------------------------------------- |
| [docs/assignment.md](docs/assignment.md)               | Original brief                               |
| [ARCHITECTURE.md](ARCHITECTURE.md)                     | Components, consistency, scaling to 1M users |
| [SECURITY.md](SECURITY.md)                             | Threat model, isolation, secrets, SSRF       |
| [OPERATIONS.md](OPERATIONS.md)                         | Runbooks, backup, incidents                  |
| [AI_USAGE.md](AI_USAGE.md)                             | AI-assisted development log                  |
| [openapi.yaml](openapi.yaml)                           | HTTP API contract                            |
| [docs/decisions/](docs/decisions/)                     | Architecture decision records                |
| [docs/REQUIREMENT_AUDIT.md](docs/REQUIREMENT_AUDIT.md) | Phase 7 requirement trace                    |
| [deploy/README.md](deploy/README.md)                   | On-prem Compose details                      |
| [load/REPORT.md](load/REPORT.md)                       | Load-test results                            |

---

## Project layout

```
apps/api          Node.js API (Express 5)
apps/web          React SPA (Vite)
apps/mock-model   OpenAI-compatible eval model
packages/db       SQL migrations (dbmate) + DAL
packages/shared   Pricing, errors, crypto helpers
deploy/           nginx, backup/restore scripts
load/             Load-test harness
```

TypeScript `strict: true` and `noUncheckedIndexedAccess` throughout.

---

## Clean-clone checklist

Verified procedure for graders:

- [ ] `git clone` fresh directory
- [ ] `pnpm install` succeeds (Node 22+)
- [ ] `cp .env.example .env` and fill all required secrets
- [ ] `docker compose up --build -d` → all services healthy
- [ ] http://localhost/ loads SPA (no CDN references in page source)
- [ ] Register or bootstrap → admin login works
- [ ] `pnpm test:unit` passes without Docker
- [ ] `pnpm test` passes with Postgres/Redis URLs set
- [ ] `TEST_BASE_URL=http://127.0.0.1/api pnpm load:test` completes with invariant OK

CI on `ubuntu-latest` runs steps equivalent to integration + compose + load on every push.

---

## License

Take-home assignment submission — not licensed for redistribution.
