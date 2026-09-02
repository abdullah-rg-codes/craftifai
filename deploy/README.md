# On-premises Compose package

Single command after `.env` is filled in:

```bash
docker compose up --build -d
```

That starts Postgres, Redis, a one-shot migrator, two API replicas, nginx (SPA + `/api` load balancer), and the mock model. Open http://localhost/ — there is no default administrator.

## Configuration

Every secret comes from the environment or a mounted file. Copy [`.env.example`](../.env.example) to `.env` and set:

- `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD`
- `SESSION_SECRET`, `WEBHOOK_SECRET`
- `ENCRYPTION_KEY_BASE64` (exactly 32 bytes, base64 — README has cmd.exe / PowerShell / openssl) or `ENCRYPTION_KEY_FILE`
- `MOCK_MODEL_API_KEY`

Missing names fail startup with the variable in the error. The API does not listen until that check passes.

`COOKIE_SECURE=true` only when TLS terminates in front of nginx. Plain HTTP on-prem must leave it false or the browser drops the session cookie.

`MODEL_CA_BUNDLE_FILE` is an optional PEM used for outbound HTTPS to a private model, in addition to a per-organization CA uploaded in the admin UI.

`ALLOWED_PRIVATE_CIDRS` defaults in Compose to RFC1918 + loopback so the mock model on the Compose network is reachable. A SaaS profile leaves it empty. `169.254.0.0/16` cannot be allowlisted.

## Bootstrap

There is no baked-in password. Create the first administrator once:

```bash
BOOTSTRAP_EMAIL=you@example.com BOOTSTRAP_PASSWORD='a long passphrase' \
  docker compose --profile bootstrap run --rm bootstrap
```

A second run exits 0 and does nothing if an active administrator already exists.
Credentials may come from `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` or from mounted files via `BOOTSTRAP_EMAIL_FILE` / `BOOTSTRAP_PASSWORD_FILE`.

## Two replicas

nginx round-robins `/api/` to `api-1` and `api-2` with no sticky sessions. `GET /api/health` includes `replica` (container hostname). Hitting it repeatedly should show both ids.

`GET /api/metrics` is Prometheus text (HTTP, model, credits, reconciliation). Scrape either replica through the load balancer; series are labeled with `replica`.

Readiness (`/ready`) checks Postgres and Redis only — not the customer model.

## Offline

Build images while you still have network, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d
```

The overlay marks the Compose network `internal: true` so replicas can reach Postgres, Redis, and the mock model but cannot call the internet. Do not use that overlay if the customer model is on a LAN route outside the Compose network.

Frontend assets are baked into the nginx image. No CDN, fonts, or telemetry.

## Backup and restore

```bash
bash deploy/backup.sh          # writes backups/craftifai-<utc>.sql
bash deploy/restore.sh backups/craftifai-<utc>.sql
```

Restore drops and recreates the application database, reloads the dump, and brings the API replicas back. After restore, `org_credit_accounts.available` / `reserved` must equal the ledger sums for that org.

`bash deploy/test-restore.sh` dirties balances, restores, and asserts that invariant.

## Upgrade and rollback

`docker compose up --build -d` rebuilds images. The `migrate` service runs `dbmate up` and then exits. Already-applied migrations are skipped.

The SQL files include `migrate:down` sections. Downs that `DROP TABLE` are not a safe production rollback after data exists. Roll forward with a new migration, or restore from `deploy/backup.sh`. Empty/additive downs are the only ones that can run without a dump.

## Shutdown

API replicas stop accepting connections on SIGTERM, wait up to 10s for in-flight requests, then close the pool and Redis. Expired reservations are released by the 30s sweeper (`pg_try_advisory_lock` so only one replica sweeps).

## Load test

With the stack up (`docker compose up --build -d`):

```bash
TEST_BASE_URL=http://127.0.0.1/api pnpm load:test
```

Needs the same secrets as Compose plus `DATABASE_ADMIN_URL` (published Postgres). The harness drives 200 concurrent clients, samples balances during the run, and fails if a balance goes negative, ledger sums drift, expired reservations dangle, or HTTP 200 inferences do not match settlement rows. Report: [load/REPORT.md](../load/REPORT.md).
