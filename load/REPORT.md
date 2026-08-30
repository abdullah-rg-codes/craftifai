# Load-test report

Repeatable harness: `pnpm load:test` against the two-replica Compose stack (`TEST_BASE_URL=http://127.0.0.1/api`). Numbers below are from GitHub Actions `compose-load` on `ubuntu-latest` (2 vCPU). This development machine has no Docker; CI is the measured run.

The 150 ms control-plane target from the brief is **not** the number this harness reports for inference. Mock model latency is 50–250 ms by design, so end-to-end p95 includes provider wait. That is called out under bottlenecks rather than tuned away.

## Environment

- GitHub-hosted `ubuntu-latest`, 2 vCPU
- Compose: nginx :80 → `api-1` + `api-2` (round-robin, no sticky sessions), Postgres 17, Redis 7, mock model
- 200 concurrent workers, ~25 s, 4 organizations (exhaust + 429 + 500 + timeout)
- Exhaust org seeded with 40 credits; `max_total_tokens=1000` (1 credit per reserve)
- ~8–16 sessions shared (4 exhaust users) so Redis user limits do not hide exhaustion

## Results

Filled from the `compose-load` job JSON summary:

| Metric                                     | Value      |
| ------------------------------------------ | ---------- |
| Duration                                   | _(CI run)_ |
| Requests                                   | _(CI run)_ |
| Request rate                               | _(CI run)_ |
| p50 / p95 / p99 (ms)                       | _(CI run)_ |
| Error mix                                  | _(CI run)_ |
| Peak `pg_stat_database.numbackends`        | _(CI run)_ |
| Peak `pg_stat_activity`                    | _(CI run)_ |
| Peak Postgres CPU (`docker compose stats`) | _(CI run)_ |

## Invariants (asserted in the harness)

- No sampled `available` or `reserved` was negative (CHECK plus ~50 ms SQL samples)
- Per-org ledger sums matched account rows after the run
- Sweeper ran (`pg_try_advisory_lock`); no `reserved` rows with `expires_at` in the past
- HTTP 200 inference count equalled `credit_ledger` rows with `kind = 'settlement'`
- Exhaust org returned 402 while workers were still in flight

## Bottlenecks

1. **Mock latency dominates inference p95.** 50–250 ms inside the mock is larger than the 150 ms control-plane target. The number is honest; it is not a Postgres lock-time measurement.
2. **Org-row lock on reserve.** Concurrent exhaust traffic serializes on `org_credit_accounts`. Queuing shows up as extra latency on the 402 path once the row is hot.
3. **Redis per-user rate limit (300/min).** After the first wave, retries from shared sessions produce control-plane 429s. That is intended mix, not a missed exhaustion.

## Next three improvements

1. Split “control-plane time” vs “model wait” in the API (timestamp around `callChatModel`) so the 150 ms target can be scored without the mock.
2. Raise pool `max` on the API replicas if `numbackends` saturates under 200 in-flight reservations.
3. Per-worker unique users if the goal is org-limit behavior without tripping the 300/min user cap.

## How to run

```bash
docker compose up --build -d
TEST_BASE_URL=http://127.0.0.1/api pnpm load:test
```
