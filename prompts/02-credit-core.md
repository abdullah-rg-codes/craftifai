# Phase 2 — The credit ledger (Agent mode)

This is the graded core. Budget accordingly: if something has to be cut from this
assignment, it is never this.

---

Phase 1 is in. Build the credit system. Nothing else this phase — no model calls yet,
no UI. I want the money correct in isolation, with tests that prove it, before anything
unreliable is attached to it.

**Ledger and balance.** As designed: the atomic guard on the balance, the append-only
ledger entry written in the same transaction, and no code path anywhere that writes a
balance without a corresponding ledger row. Every ledger row records what caused it.
Nothing in this system is ever updated in place in a way that loses history.

**Pricing.** One credit per started block of 1,000 total tokens, minimum one credit.
Put it in one pure function and unit test the boundaries directly: 0, 1, 500, 999,
1000, 1001, 2800, 3000, 3001. The off-by-one at exactly 1,000 is the one that
`Math.ceil` gets right and a hand-rolled `Math.floor(n / 1000) + 1` gets wrong, so I
want both the test and the assertion that 0 tokens still costs one credit.

**Reserve, settle, release.** Reserve against `max_total_tokens` before any model call.
Settle to actual usage afterwards, returning the difference to available. Release the
whole reservation when the call fails. Each transition writes a ledger entry, and each
is idempotent with respect to its own reservation — settling an already-settled
reservation must not double-charge, because the reconciliation sweeper and the request
path will occasionally both try.

**Idempotency.** Implement it as designed, as middleware, covering both inference and
purchase creation. The concurrent case is the one that matters: the winner is decided by
a database constraint, not by an application-level check-then-act, and the loser must
not be able to reach the model. Handle the four cases in 4.2 — same key with same body,
same key with different body returning a conflict, a duplicate arriving while the
original is still in flight, and a replay after completion returning the stored terminal
result.

**Billing webhook.** A mock billing service that signs its payloads, and a receiver that
verifies the signature with a constant-time comparison before doing anything else. Reject
replays using the event identifier and a unique constraint, and reject stale timestamps
so a captured payload cannot be resent indefinitely. Credits increase only on a valid
webhook — the endpoint that starts a purchase must not touch the balance, and I want to
see that there is no code path from the purchase-initiation handler to a balance
increase. Getting the signature verification wrong here is the difference between a
billing system and a free credit dispenser.

**Reconciliation.** The sweeper, with the fencing we agreed on, releasing expired
reservations and resolving reservations whose owning request died. Run it on an interval
and also expose it as a command I can invoke directly in a test, because a test that
waits for an interval to elapse is a test that will flake in CI.

**Tests — these are the ones being graded, so write them as the deliverable they are:**

- N concurrent requests against a balance that only covers N/2 of them, run through a
  real connection pool. Exactly half succeed, no balance goes negative, and the sum of
  ledger entries equals the final balance. Assert that last part explicitly — a
  balance that is correct but a ledger that disagrees with it is a bug you want to hear
  about from a test rather than from a reviewer.
- The same idempotency key fired concurrently. One charge, one ledger entry, and the
  losers return either in-progress or the stored result.
- The same webhook delivered repeatedly and concurrently. The balance moves once.
- A reservation abandoned mid-flight, then reconciled. Credits return, ledger explains
  what happened, and the reconciliation is safe to run twice.
- Everything above executed against two API instances sharing one database, not one
  process. Same-process concurrency will pass even if you accidentally rely on a
  process-local lock, which is precisely the bug the brief is testing for.

All of these run against real PostgreSQL. No SQLite, no mocked repository, no fixed
sleeps as synchronization — use barriers, promise fences, or advisory signals so the
tests are deterministic.

Before you write the tests, tell me how you plan to make the concurrent ones
deterministic. If the answer involves `setTimeout`, we should talk first.

When it passes, show me the concurrency test output and the exact SQL statement that
enforces the non-negative balance, then stop.
