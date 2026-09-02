# CraftifAI

A multi-tenant AI control plane take-home assignment. Built for **correctness under
concurrency**, not feature count.

Graded on invariants: tenant isolation, credit safety, idempotency, multi-instance
behavior, and operability. A smaller implementation that holds these will score higher
than a larger happy-path-only build.

---

## Prerequisites

| Tool           | Version                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| Node.js        | 22+                                                                                |
| pnpm           | 9+ (repo pins 11.24.0)                                                             |
| Docker Desktop | Required for Postgres, Redis, mock-model, and Compose. `docker` must be on `PATH`. |

OpenSSL is **not** required. Windows **cmd.exe** does not have `openssl`, `cp`, or `&&`. Use the Node / `copy` commands below, or run the same steps in **PowerShell** / **Git Bash**.

---

## Quick start (development)

Fill **`.env` first**. Host commands (`pnpm db:migrate`, `pnpm dev`) read that file; you do not export each variable.

```bash
# 1. Clone and install
git clone https://github.com/abdullah-rg-codes/craftifai.git craftifai && cd craftifai
pnpm install

# 2. Environment — copy once (do not overwrite a filled .env)
cp .env.example .env          # macOS / Linux / Git Bash
# Windows cmd:  copy .env.example .env
# PowerShell:   Copy-Item .env.example .env
```

Leave ports, `REDIS_URL`, and the other defaults. Fill these eight values in `.env`:

| Variable                  | What to set                                                         |
| ------------------------- | ------------------------------------------------------------------- |
| `POSTGRES_ADMIN_PASSWORD` | Invent a password (owner / migrations)                              |
| `POSTGRES_APP_PASSWORD`   | Invent a **different** password (app role)                          |
| `DATABASE_ADMIN_URL`      | Same admin password in the URL, replacing `CHANGE_ME`               |
| `DATABASE_URL`            | Same app password in the URL, replacing `CHANGE_ME`                 |
| `SESSION_SECRET`          | 32 random bytes, base64 — generate below                            |
| `ENCRYPTION_KEY_BASE64`   | Same generation; must decode to exactly 32 bytes — not a passphrase |
| `WEBHOOK_SECRET`          | Same generation                                                     |
| `MOCK_MODEL_API_KEY`      | Same generation (paste this **same** value later on the Model page) |

The two URLs must use the passwords you chose, not leftover `CHANGE_ME`. Example:

```
POSTGRES_ADMIN_PASSWORD=adminPass1
POSTGRES_APP_PASSWORD=appPass2
DATABASE_ADMIN_URL=postgres://craftifai_owner:adminPass1@localhost:5432/craftifai?sslmode=disable
DATABASE_URL=postgres://craftifai_app:appPass2@localhost:5432/craftifai?sslmode=disable
```

Avoid `@`, `:`, `/`, `#`, and `%` in those two passwords or the URLs break.

### Generate the four secrets

`SESSION_SECRET`, `ENCRYPTION_KEY_BASE64`, `WEBHOOK_SECRET`, and `MOCK_MODEL_API_KEY` each need a **different** line. Run the command **four times**. Paste into `.env` with no quotes. `+`, `/`, and `=` in these four values are fine.

**Windows cmd.exe** (Node is already required; `openssl` is usually missing here):

```bat
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**PowerShell:**

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

**macOS / Linux / Git Bash:**

```bash
openssl rand -base64 32
```

Keep `MOCK_MODEL_API_KEY` and `WEBHOOK_SECRET` somewhere you can copy during the demo (Model page credential, then the signed webhook command). Do not commit `.env`.

```bash
# 3. Backing services (fails if Docker Desktop is not running)
docker compose up -d postgres redis mock-model
pnpm db:migrate

# 4. Fast tests (no Docker required for unit/web)
pnpm test:unit

# 5. Dev servers (API :3000, web :5173 with /api proxy)
pnpm dev
```

Open http://localhost:5173 — register creates an organization and administrator.

If `docker` is not recognized, install Docker Desktop and reopen the terminal. Unit tests can still run (`pnpm test:unit`); the API cannot without Postgres and Redis.

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
3. Deliver a **signed** mock-billing webhook (the only credit path). Copy the **Id** from
   the Purchases table. `CREDITS` must match the amount you started.

The two listings below are the **same webhook**. `WEBHOOK_SECRET` must be loaded from
`.env` (it is not in the shell until you set it). `BASE_URL` must match how you started:

| How you started    | Open in the browser   | `BASE_URL`              |
| ------------------ | --------------------- | ----------------------- |
| Full stack Compose | http://localhost/     | `http://127.0.0.1/api`  |
| `pnpm dev` (Vite)  | http://localhost:5173 | `http://127.0.0.1:3000` |

**Linux / macOS / Git Bash** (cmd.exe cannot run this). Compose URL shown; for Vite change
`BASE_URL` to `http://127.0.0.1:3000`.

```bash
export WEBHOOK_SECRET="$(grep -E '^WEBHOOK_SECRET=' .env | cut -d= -f2- | tr -d '\r')"
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

**Windows PowerShell** — do not paste the bash snippet. Run it from the repo folder
(quote the path if it has spaces: `cd "C:\path\with spaces\craftifai"`). Compose URL shown;
for Vite set `$env:BASE_URL = "http://127.0.0.1:3000"`.

```powershell
$env:PURCHASE_ID = "<uuid>"
$env:CREDITS = "50"
$env:BASE_URL = "http://127.0.0.1/api"
$env:WEBHOOK_SECRET = ((Get-Content .env | Where-Object { $_ -match '^WEBHOOK_SECRET=' }) -replace '^WEBHOOK_SECRET=','').Trim()

node --input-type=module -e @"
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
"@
```

4. **Model** → save config → test connection. Use the Compose or Vite endpoint from
   **Configure mock model** above — `mock-model` only works inside Compose.
5. **Playground** (member or admin) → send inference with auto idempotency key.
6. **Members** → invite an unused email as Member → copy the token. In a **logged-out**
   browser open `/invite`, paste the token, and choose a password. Do **not** Register —
   Register founds a new organization. The invitee becomes a member of **this** org only.
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
pnpm test:advanced       # webhook amount-from-row, member usage isolation, ledger cursor
pnpm test                # sanity + intermediate + advanced
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

## License

Take-home assignment submission — not licensed for redistribution.
