# Operations

Runbooks for the Docker Compose reference deployment. Production SaaS would extend these
with managed Postgres, secret rotation, and on-call — the **signals and invariants** stay the same.

---

## Health checks

| Endpoint       | Purpose           | Checks              | Expected                              |
| -------------- | ----------------- | ------------------- | ------------------------------------- |
| `GET /health`  | Liveness          | Process up          | `200 {"status":"ok","replica":"..."}` |
| `GET /ready`   | Readiness for LB  | PostgreSQL + Redis  | `200` or `503`                        |
| `GET /metrics` | Prometheus scrape | Counters/histograms | `200 text/plain`                      |

**Important:** Readiness does **not** call the customer model. Model outage must not drain the API pool.

nginx health: `wget http://127.0.0.1/api/health` in proxy container.

Compose services use `/ready` on API replicas with 20 s start period.

---

## Metrics

Scrape `GET /api/metrics` through the load balancer or per replica.

| Metric                                                | Meaning                                                |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `craftifai_http_requests_total{route,status}`         | Request volume by route class                          |
| `craftifai_http_request_duration_ms`                  | End-to-end API time (includes model wait on inference) |
| `craftifai_model_calls_total{outcome}`                | success / timeout / rate_limited / error               |
| `craftifai_model_call_duration_ms`                    | Outbound model latency                                 |
| `craftifai_credit_events_total{kind}`                 | reserve / settle / release                             |
| `craftifai_reconciliation_runs_total`                 | Sweeper acquired lock and ran                          |
| `craftifai_reconciliation_lock_miss_total`            | Another replica holds lock                             |
| `craftifai_reconciliation_expired_reservations_total` | Expired reservations processed                         |
| `craftifai_reconciliation_failures_total`             | Sweeper threw before completing                        |

**Alert candidates (production):**

- `rate(craftifai_http_requests_total{status=~"5.."})` > threshold
- `craftifai_reconciliation_lock_miss_total` high is normal; **zero** `reconciliation_runs_total` for >2 min is not
- `increase(craftifai_reconciliation_failures_total[5m])` > 0
- Postgres `numbackends` near max

---

## Startup and configuration

Copy `.env.example` → `.env`. Required secrets (Compose fails fast if missing):

- `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD`
- `SESSION_SECRET`, `WEBHOOK_SECRET`, `ENCRYPTION_KEY_BASE64`
- `MOCK_MODEL_API_KEY`

Generate 32-byte keys as base64. Windows cmd.exe usually has no `openssl`; use the Node command in the README (PowerShell and Git Bash `openssl` are also listed there).

`COOKIE_SECURE=false` for plain HTTP on-prem; set `true` only when TLS terminates in front of nginx.

`API_REQUEST_TIMEOUT_MS` (default 180000) is the HTTP server request ceiling. It is independent of per-org `timeout_ms` (max 120s) and must stay ≥ 130000 so a legal model call can complete.

Full detail: `deploy/README.md`.

---

## Bootstrap (first administrator)

Compose has **no default password**. One-time:

```bash
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='long-passphrase' \
  docker compose --profile bootstrap run --rm bootstrap
```

Idempotent: exits cleanly if an active administrator already exists.

Alternatively: register via web UI at `/register` (creates org + admin).

---

## Backup and restore

```bash
bash deploy/backup.sh          # → backups/craftifai-<utc>.sql
bash deploy/restore.sh backups/craftifai-<utc>.sql
```

Restore drops and recreates the application database, reloads dump, restarts API replicas.

**Verify after restore:** for each org, `available` and `reserved` equal `SUM(ledger deltas)`.

Automated check: `bash deploy/test-restore.sh` (run in CI compose-e2e).

**RPO:** last backup time. **RTO:** restore script duration + migrate (no-op if current).

---

## Upgrade and rollback

**Upgrade:**

```bash
git pull
docker compose up --build -d
```

The `migrate` service runs `dbmate up` once; already-applied migrations skipped.

**Rollback:**

- **Schema:** Prefer roll-forward with a new migration. `migrate:down` that `DROP TABLE` is unsafe after data exists.
- **Application:** redeploy previous image tag.
- **Data:** restore from `deploy/backup.sh` dump if needed.

---

## Graceful shutdown

API replicas on SIGTERM:

1. Stop accepting new HTTP connections.
2. Drain in-flight requests up to **10 s**.
3. Close Postgres pool and Redis.

In-flight inference may complete or timeout; unfinished reservations expire and sweeper refunds.

---

## Load test (repeatable)

```bash
docker compose up --build -d
TEST_BASE_URL=http://127.0.0.1/api pnpm load:test
```

Requires `DATABASE_ADMIN_URL` pointing at published Postgres. Report: `load/REPORT.md`.

Harness asserts: no negative balances, ledger sums match, no dangling expired reservations, HTTP 200 count equals settlement rows.

---

## Runbook: reconciliation falling behind

**Symptoms:**

- `reserved` balance elevated while no active inference
- Rows in `credit_reservations` with `status = 'reserved'` and `expires_at` in the past
- Users report credits "stuck" after crashes

**Diagnosis:**

```sql
SELECT count(*) FROM credit_reservations
 WHERE status = 'reserved' AND expires_at < now();
```

Check metrics: `craftifai_reconciliation_expired_reservations_total` flat while count above grows.

**Common causes:**

1. All replicas down — sweeper not running.
2. Postgres connectivity broken — sweeper errors in logs.
3. Advisory lock held by dead session (rare) — lock released on session end.

**Remediation:**

1. Confirm at least one API replica healthy: `curl http://localhost/api/ready`.
2. Check logs for `sweeper` / `reconciliation` errors; fix PG/Redis connectivity.
3. Expiry is safe to retry — conditional updates prevent double refund. Restart API replicas if sweeper loop stuck.
4. **Manual invoke (tests):** `runReconciliationSweep(pool)` from `services/sweeper.ts`.

**Escalation:** If expired count grows faster than sweep rate, increase sweep frequency or batch size (currently 100/reservation batch, 30 s interval).

---

## Runbook: customer model down

**Symptoms:**

- Members see model failure messages in playground; admins may see connectivity test `reachable: false`
- `craftifai_model_calls_total{outcome="error"}` rises
- **Admin UI, billing, team management still work**

**Diagnosis:**

1. Admin → Model → **Test connection** (no charge).
2. Check API logs with correlation ID from failed inference (`X-Correlation-ID`).
3. From API container: verify URL, TLS CA, network route to model (on-prem LAN).

**Remediation:**

1. Fix customer endpoint, credential, or CA bundle in model config.
2. Do **not** mark API unready — inference fails fast; reservations **released** on failure paths.
3. Stale `reserved` rows from hung requests expire via sweeper (~180 s TTL default).

**Note:** Timeouts and 429s release credits; users can retry when model recovers.

---

## Incident checklist (generic)

1. Identify scope: one org vs platform (Postgres/Redis/nginx).
2. Grab correlation IDs from failing requests.
3. Check `/ready`, Postgres connections, Redis ping.
4. Verify ledger identity: `SUM(deltas) = account` for affected org.
5. If financial anomaly suspected, stop inference for org (suspend members) before manual SQL — **never** adjust balance without ledger row.

---

## Logs

JSON to stdout in API containers:

```bash
docker compose logs -f api-1 api-2
```

Fields: `correlationId`, `method`, `path`, `status`, `durationMs`. Model failures: `outcome`, `latencyMs`, `promptLogged: false`.

---

## Secret rotation (production guidance)

| Secret                  | Procedure                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| Model credentials       | Admin UI write-only rotate; lazy re-encrypt on save              |
| `ENCRYPTION_KEY_BASE64` | Add new key version to keyring; decrypt old, re-encrypt on write |
| `WEBHOOK_SECRET`        | Coordinate with billing provider; rotate during maintenance      |
| `SESSION_SECRET`        | Rotates cookie signing; invalidates all sessions                 |

Compose reference uses static env — rotation is manual redeploy.
