# ADR 002: Materialized balance row + append-only ledger

## Status

Accepted.

## Context

Organizations have prepaid credits. The system must never commit a negative balance under
concurrent load, must audit every change, and must not hold database locks across outbound
model calls.

## Decision

1. **`org_credit_accounts(org_id PK, available, reserved)`** — materialized balances.
2. **`credit_ledger`** — append-only; app role has no UPDATE/DELETE.
3. **Reserve guard** lives inside the writing UPDATE (evaluated under row lock):

```sql
UPDATE org_credit_accounts
   SET available = available - $1,
       reserved  = reserved  + $1
 WHERE org_id = $2
   AND available >= $1
RETURNING available, reserved;
```

Zero rows → insufficient credit → model never called.

4. **`CHECK (available >= 0)` and `CHECK (reserved >= 0)`** — loud backstop, not the primary mechanism.
5. **Three short transactions per inference:** idempotency claim → reserve → (model call outside TX) → settle/release.
6. Every concurrency test asserts `SUM(ledger deltas) = account row`.

## Rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Ledger-summed-on-read | O(history) reads; still needs serialization point for reserve |
| Balance-only (no ledger) | Fails auditability invariant; drift undetectable |
| Trigger-enforced ledger | Trigger cannot carry causation metadata; ownership stays in one module + sum tests |

## Consequences

- Hot org serializes on one row (~2 ms per reserve); acceptable at assignment scale; documented bottleneck in load report.
- Sweeper and request handlers share conditional reservation transitions (`WHERE status = 'reserved'`).
