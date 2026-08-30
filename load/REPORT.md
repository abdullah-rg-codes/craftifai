# Load-test report

Repeatable harness: `pnpm load:test` against the two-replica Compose stack (`TEST_BASE_URL=http://127.0.0.1/api`). Numbers below are transcribed from the JSON summary printed by the harness on GitHub Actions `compose-load` ([run 33320232614](https://github.com/abdullah-rg-codes/craftifai/actions/runs/33320232614), commit `f516b2e`, `ubuntu-latest`). This development machine has no Docker; CI is the measured run.

The 150 ms control-plane target from the brief is **not** the number this harness reports for inference. Mock model latency is 50–250 ms by design (timeout org uses 5000 ms mock delay vs a 1000 ms `timeout_ms` CHECK-legal floor), so end-to-end p95 includes provider wait. That is called out under bottlenecks rather than tuned away.

## Environment

- GitHub-hosted `ubuntu-latest`, 2 vCPU
- Compose: nginx :80 → `api-1` + `api-2` (round-robin, no sticky sessions), Postgres 17, Redis 7, mock model
- 200 concurrent workers, ~25 s target (measured 28.7 s), 4 organizations (exhaust + 429 + 500 + timeout)
- Exhaust org seeded with 40 credits; `max_total_tokens=1000` (1 credit per reserve)
- 4 exhaust sessions (admin + 3 members) so Redis user limits do not hide first-wave exhaustion

## Results

Filled from the `compose-load` job JSON summary:

| Metric                                     | Value                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Duration                                   | 28.673 s                                                                                                                |
| Requests                                   | 4868                                                                                                                    |
| Request rate                               | 169.8 /s                                                                                                                |
| p50 / p95 / p99 (ms)                       | 910 / 3128 / 4017                                                                                                       |
| Error mix                                  | 402: 560 (11.5%); model 502: 451 (9.3%); 429: 3191 (65.5%); timeout: 53 (1.1%); 5xx: 0; other: 0; HTTP 200: 613 (12.6%) |
| Peak `pg_stat_database.numbackends`        | 41                                                                                                                      |
| Peak `pg_stat_activity`                    | 41                                                                                                                      |
| Peak Postgres CPU (`docker compose stats`) | 57.2%                                                                                                                   |

Latency is **end-to-end worker time** (nginx → replica → mock). It is not control-plane-only.

Inference HTTP 200 count was **40**, matching **40** `credit_ledger` rows with `kind = 'settlement'`. Exhaust org finished at `available=0`, `reserved=0`. 572 SQL samples; none negative.

## Invariants (asserted in the harness)

- No sampled `available` or `reserved` was negative (CHECK plus ~50 ms SQL samples)
- Per-org ledger sums matched account rows after the run
- Sweeper ran (`pg_try_advisory_lock`); no `reserved` rows with `expires_at` in the past
- HTTP 200 inference count equalled `credit_ledger` rows with `kind = 'settlement'`
- Exhaust org returned 402 while workers were still in flight (560×)

## Bottlenecks

1. **Mock latency dominates inference p95.** 50–250 ms inside the mock (plus 1000 ms timeouts on the fail-timeout org) is larger than the 150 ms control-plane target. p95 3.1 s is honest; it is not a Postgres lock-time measurement.
2. **Redis per-user rate limit (300/min).** After the first wave, retries from four shared exhaust sessions produce most of the 429s (65.5% of all requests). Exhaustion still happened (40 settlements, then 560× 402). The 429 share is the user cap, not a missed credit invariant.
3. **Org-row lock on reserve.** Concurrent exhaust traffic serializes on `org_credit_accounts`. Postgres peaked at 41 backends / 57% CPU — not saturated; queuing on the hot org row is the more likely extra latency on the 402 path.

## Next three improvements

1. Split “control-plane time” vs “model wait” in the API (timestamp around `callChatModel`) so the 150 ms target can be scored without the mock.
2. Raise pool `max` on the API replicas only if a later run shows `numbackends` saturating under 200 in-flight reservations (this run did not).
3. Per-worker unique users if the goal is org-limit behavior without tripping the 300/min user cap (would change the error mix, not the credit proof).

## How to run

```bash
docker compose up --build -d
TEST_BASE_URL=http://127.0.0.1/api pnpm load:test
```
