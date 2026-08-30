# Interview preparation

Five topics a skeptical reviewer is most likely to probe. Know these cold — code
paths, not slides.

---

## 1. Why not read-then-write on the balance?

**Wrong:** SELECT `available`, compare in app, UPDATE.

**Right:** Guard inside the writing UPDATE:

```sql
UPDATE org_credit_accounts
   SET available = available - $1, reserved = reserved + $1
 WHERE org_id = $2 AND available >= $1
```

Zero rows → 402, model never called. CHECK constraints are backstop only.

**Test:** `credits.test.ts` concurrent exhaust; load harness SQL samples.

---

## 2. Why three transactions per inference?

**Wrong:** One transaction holding the row lock across `await callChatModel()`.

**Right:**

1. TX1 — idempotency claim (ON CONFLICT)
2. TX2 — reserve + ledger, commit, **release lock**
3. Model call — **outside any transaction**
4. TX3 — settle or release + idempotency terminal

At 300 rps × 200 ms model latency, holding the lock would exhaust the pool.

**Recovery:** Process kill before settle → reservation expires → sweeper refunds.

---

## 3. Idempotency: ON CONFLICT vs catch-then-SELECT?

**Wrong:** INSERT, catch unique violation, SELECT existing row.

**Right:** `INSERT ... ON CONFLICT DO NOTHING RETURNING *` as **first** statement.
Loser blocks on winner's row until commit, then reads terminal state.

**Branches:** fingerprint mismatch → 409; pending → 409 in-progress; terminal → replay

- `Idempotency-Replayed: true`.

**Test:** `credits.test.ts` concurrent identical keys.

---

## 4. Sweeper vs in-flight settle — who wins?

Every reservation transition: `UPDATE ... WHERE id = $1 AND status = 'reserved'`.

Zero rows affected is **normal** (sweeper expired while request was settling, or
reverse). No double refund because loser writes nothing.

Advisory lock is **efficiency only** — conditional updates are the correctness mechanism.

**Test:** forced `expires_at` in past + run sweeper twice; compose.lb restart test.

---

## 5. Why is the model excluded from `/ready`?

Customer model outage must not mark all replicas unready → LB drains API → admin and
billing down with inference.

Readiness checks **only** PostgreSQL + Redis — things we own.

---

## Quick reference: where in the repo

| Topic                   | Primary files                                     |
| ----------------------- | ------------------------------------------------- |
| Balance guard           | `packages/db/src/dal.ts` (creditAccounts.reserve) |
| Inference TX boundaries | `apps/api/src/routes/inference.ts`                |
| Idempotency             | `apps/api/src/middleware/idempotency.ts`          |
| Sweeper                 | `apps/api/src/services/sweeper.ts`                |
| Tenant isolation        | `packages/db` RLS + `foundation.test.ts`          |
| SSRF                    | `apps/api/src/services/ssrf.ts`                   |

---

## Honest partials (if asked)

- **Streaming:** not built; same state machine, transport-only change.
- **CSRF:** SameSite=Lax only; no custom mutation header (see SECURITY.md).
- **Multi-org UI:** backend `X-Org-Id`; web uses first membership.
- **Control-plane p95:** load report is end-to-end; 150 ms target needs split metric.

---

## Decision records

See `docs/decisions/001–003` for rejected alternatives with reasoning.
