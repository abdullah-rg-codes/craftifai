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
git clone https://github.com/abdullah-rg-codes/craftifai.git craftifai && cd craftifai
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
2. Endpoint — pick the one that matches how you started the stack:
   - **Compose** (`http://localhost/`): `http://mock-model:8081/v1/chat/completions`  
     (`mock-model` is a Compose DNS name; it does not resolve on the host.)
   - **Local Vite** (`pnpm dev`, `http://localhost:5173`): `http://127.0.0.1:8081/v1/chat/completions`
3. Model name: `mock-gpt`.
4. Credential: same value as `MOCK_MODEL_API_KEY` in `.env`.
5. **Test connection** → should succeed.

---

## Demo walkthrough

1. **Register** at `/register` (or bootstrap above).
2. **Credits** → start a purchase. Status stays `pending`; the balance does **not** increase yet.
3. Deliver a **signed** mock-billing webhook (the only credit path). Copy the purchase id
   from the Credits page. `CREDITS` must match the amount you started. Use **PowerShell**
   in Cursor on Windows — the bash snippet below will not run there.

Local Vite (`pnpm dev`): `BASE_URL=http://127.0.0.1:3000`. Compose: `http://127.0.0.1/api`.

```powershell
$env:PURCHASE_ID = "<uuid>"
$env:CREDITS = "50"
$env:BASE_URL = "http://127.0.0.1:3000"
$env:WEBHOOK_SECRET = ((Get-Content .env | Where-Object { $_ -match '^WEBHOOK_SECRET=' }) -replace '^WEBHOOK_SECRET=','').Trim()

node --input-type=module -e @"
import { createHmac } from 'node:crypto';
const purchase_id = process.env.PURCHASE_ID;
const credits = Number(process.env.CREDITS ?? '50');
const secret = process.env.WEBHOOK_SECRET;
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
if (!purchase_id || !secret) throw new Error('PURCHASE_ID and WEBHOOK_SECRET are required');
const timestamp = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ purchase_id, provider_event_id: 'evt_' + timestamp, credits, timestamp });
const signature = 't=' + timestamp + ',v1=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
const response = await fetch(base + '/billing/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
  body,
});
console.log(response.status, await response.json());
"@
```

```bash
# macOS / Linux / Git Bash. Compose origin is http://127.0.0.1/api
PURCHASE_ID=<uuid> CREDITS=50 BASE_URL=http://127.0.0.1/api WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  node --input-type=module -e "
import { createHmac } from 'node:crypto';
const purchase_id = process.env.PURCHASE_ID;
const credits = Number(process.env.CREDITS ?? '50');
const secret = process.env.WEBHOOK_SECRET;
const base = process.env.BASE_URL ?? 'http://127.0.0.1/api';
if (!purchase_id || !secret) throw new Error('PURCHASE_ID and WEBHOOK_SECRET are required');
const timestamp = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ purchase_id, provider_event_id: 'evt_' + timestamp, credits, timestamp });
const signature = 't=' + timestamp + ',v1=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
const response = await fetch(base + '/billing/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
  body,
});
console.log(response.status, await response.json());
"
```

4. **Model** → save config → test connection. Use the Compose or Vite endpoint from
   **Configure mock model** above — `mock-model` only works inside Compose.
5. **Playground** (member or admin) → send inference with auto idempotency key.
6. **Members** → invite a user → copy token → accept at `/invite?token=...` in another browser.
7. **Audit** → see membership and billing events.

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

| Document                                                             | Purpose                                      |
| -------------------------------------------------------------------- | -------------------------------------------- |
| [docs/assignment.md](docs/assignment.md)                             | Original brief                               |
| [ARCHITECTURE.md](ARCHITECTURE.md)                                   | Components, consistency, scaling to 1M users |
| [SECURITY.md](SECURITY.md)                                           | Threat model, isolation, secrets, SSRF       |
| [OPERATIONS.md](OPERATIONS.md)                                       | Runbooks, backup, incidents                  |
| [AI_USAGE.md](AI_USAGE.md)                                           | AI-assisted development log                  |
| [openapi.yaml](openapi.yaml)                                         | HTTP API contract                            |
| [docs/decisions/](docs/decisions/)                                   | Architecture decision records                |
| [docs/REQUIREMENT_AUDIT.md](docs/REQUIREMENT_AUDIT.md)               | Phase 7 requirement trace                    |
| [docs/CLEAN_CLONE_VERIFICATION.md](docs/CLEAN_CLONE_VERIFICATION.md) | Clean-clone verification log                 |
| [docs/INTERVIEW_PREP.md](docs/INTERVIEW_PREP.md)                     | Oral defense cheat sheet                     |
| [deploy/README.md](deploy/README.md)                                 | On-prem Compose details                      |
| [load/REPORT.md](load/REPORT.md)                                     | Load-test results                            |

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

Verified **2026-08-30** from GitHub `8546688`. Full log: [docs/CLEAN_CLONE_VERIFICATION.md](docs/CLEAN_CLONE_VERIFICATION.md).

- [x] `git clone` fresh directory — PASS (temp clone, HEAD `8546688`)
- [x] `pnpm install` succeeds (Node 22+) — PASS (`--frozen-lockfile`, 385 packages)
- [x] `cp .env.example .env` and fill all required secrets — manual step for graders (placeholders only in repo)
- [x] `docker compose up --build -d` → all services healthy — **CI** `compose-e2e` (no Docker on verification host)
- [x] http://localhost/ loads SPA (no CDN references in page source) — **CI** compose-e2e CDN check
- [x] Register or bootstrap → admin login works — **CI** integration + e2e tests
- [x] `pnpm test:unit` passes without Docker — PASS (62/62)
- [x] `pnpm test` passes with Postgres/Redis URLs set — **CI** `test` job (PG + Redis service containers)
- [x] `TEST_BASE_URL=http://127.0.0.1/api pnpm load:test` completes with invariant OK — **CI** `compose-load`

CI on `ubuntu-latest` runs steps equivalent to integration + compose + load on every push ([run 33323775992](https://github.com/abdullah-rg-codes/craftifai/actions/runs/33323775992)).

---

## License

Take-home assignment submission — not licensed for redistribution.
