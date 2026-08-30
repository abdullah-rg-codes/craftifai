# ADR 003: Idempotency — claim before side effects

## Status

Accepted.

## Context

Inference and purchase creation require `Idempotency-Key`. Concurrent duplicates must not
double-charge or double-call the model. Process-local maps fail under two replicas.

## Decision

1. Table `idempotency_keys` with PK `(org_id, endpoint, key)`.
2. **First statement of TX1:** `INSERT ... ON CONFLICT DO NOTHING RETURNING *`.
   - Winner gets pending row and proceeds.
   - Loser waits on winner's in-flight tuple, then reads terminal state.
3. **Fingerprint** = SHA-256 of raw body bytes; mismatch → 409 conflict.
4. **Pending duplicate** → 409 `IDEMPOTENCY_IN_PROGRESS`.
5. **Terminal duplicate** → replay stored response + `Idempotency-Replayed: true`.
6. Terminal update is conditional on `status = 'pending'` and commits in the same transaction as settle/release and financial writes.
7. Stale pending rows reaped by sweeper into terminal `failed` (never deleted).

## Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Catch unique violation then SELECT | Loser can see nothing before winner commits — double charge window |
| In-memory dedup Map | Fails multi-instance criterion |
| Record idempotency after work completes | Two concurrent requests both pass the check |

## Consequences

- Raw body must be captured (`attachRawBody` middleware).
- Crash between claim and reserve leaves pending row until reaper TTL (~5 min worst case).
- Response bodies size-capped at storage layer.
