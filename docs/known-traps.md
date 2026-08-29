# Known traps

Failure modes that pass a manual test and fail the grader. Most of them are things a
coding assistant will write confidently on the first attempt, because each one is the
common pattern from a codebase where concurrency did not matter.

Two reasons to read this before you start. It gives you a review checklist for
generated code, so you are checking specific things rather than skimming. And when you
catch one, it is a real entry for `AI_USAGE.md` — the brief requires two examples of
incorrect AI output you detected and corrected, and traps 1, 2, and 3 are the ones most
likely to actually occur.

---

## Credits and concurrency

**1. Read-then-write on the balance.** The natural implementation reads the balance,
compares it to the cost in application code, then writes the decrement. Two concurrent
requests both read 10, both conclude they can afford 8, and both write. The balance ends
at -6, and the acceptance criterion for credit concurrency fails on the first run of the
grader's concurrent test.

The guard has to be in the statement that does the write, so the comparison happens
under the row lock the update itself takes:

```sql
UPDATE org_credit_accounts
   SET available = available - $1,
       reserved  = reserved  + $1
 WHERE org_id = $2
   AND available >= $1
```

Zero rows affected means insufficient credit. There is no window between the check and
the write because there is no separate check. Add a `CHECK (available >= 0)` constraint
as well — not as the mechanism, but so that any future code path that gets this wrong
fails loudly instead of silently.

**2. A transaction held open across the model call.** Reserve, then `await` the model
inside the same transaction, then settle. It looks clean and atomic, and it is a
production outage. The row lock is held for the full model latency, so every other
request for that organization queues behind it. At 300 inference requests per second
with 200 ms of model latency, you are holding hundreds of connections idle-in-transaction
and the pool is exhausted long before the database is.

Three separate transactions: reserve and commit, call the model with nothing held, settle
in a new transaction. This is also why settlement has to be independently recoverable —
once you release the lock, the process can die before settling, which is exactly the
restart-recovery criterion.

**3. In-memory idempotency.** A `Map` of in-flight keys, or a process-local mutex around
the balance update. Every single-process test passes. The brief says explicitly not to do
this, and the multi-instance requirement exists to catch it. The winner of a concurrent
race must be decided by a unique constraint in PostgreSQL — insert the idempotency record
first, let the loser catch the constraint violation and read the winner's row.

**4. The idempotency record written after the work.** If the record is inserted once the
inference completes, two concurrent duplicates both find nothing, both call the model, and
both charge. The record goes in before any side effect, in a pending state, and gets
updated to terminal afterwards. That is also what makes the in-progress response possible.

**5. Settling a reservation the sweeper already released.** The reconciliation sweeper
expires a reservation while its request is still in flight; the request comes back and
settles anyway. Now credits are refunded twice. Every transition must be conditional on
the current state — `WHERE reservation_id = $1 AND status = 'reserved'` — and zero rows
affected is a real outcome your code has to handle, not an assertion failure.

**6. The pricing off-by-one.** `Math.floor(tokens / 1000) + 1` charges 2 credits for
exactly 1,000 tokens; the brief says 1. `Math.ceil(tokens / 1000)` charges 0 for 0 tokens;
the brief says minimum 1. It is `Math.max(1, Math.ceil(tokens / 1000))`, and the test
cases are given to you in section 4.2 — use them verbatim.

**7. Ledger and balance drifting apart.** A code path that adjusts the balance without
writing a ledger row, usually in an error handler or the sweeper. Balance stays correct
and history quietly does not. Assert `SUM(ledger.delta) = account.balance` at the end of
every concurrency test; it is one line and it catches an entire class of bug.

## Tenant isolation

**8. 403 where it should be 404.** Returning forbidden for another organization's
resource and not-found for a nonexistent one lets an attacker enumerate which identifiers
exist. The criterion says a user must not be able to *infer the existence* of another
organization's resources. Same response either way.

**9. Row-level security without `SET LOCAL`.** With RLS driven by a session variable, a
plain `SET app.current_org_id` persists on the pooled connection after the request ends.
The next request to borrow that connection inherits the previous tenant's context, and if
it sets its own variable first you will never notice — until one code path forgets. Use
`SET LOCAL` inside the transaction so it is scoped to that transaction and unwinds on
commit.

**10. Trusting the organization identifier from the request.** Any handler taking an
`org_id` from a path, body, or query parameter and using it without confirming the
session's membership. It works perfectly in every test where the user is in the
organization they are asking about. Derive the organization from the session, always.

## Access control

**11. Check-then-act on the last administrator.** Count active admins, see 2, proceed with
the demotion. Two concurrent requests demoting two different admins both see 2 and both
proceed, and the organization is left with none. Either lock the organization row before
counting, or express the rule as a constraint the database enforces. The naive version
passes every sequential test.

**12. Cursor pagination on a non-unique column.** Paginating on `created_at` alone means
rows sharing a timestamp get skipped or repeated across pages. Make the cursor composite —
`(created_at, id)` — and match the index to the comparison.

## Model gateway

**13. Validating the hostname, then fetching the URL.** Resolve the host, check the
address against your blocklist, then hand the original URL to the HTTP client, which
resolves it again. Between those two resolutions DNS can return something different. Also
check where redirects land: a permitted endpoint that 302s to `169.254.169.254` defeats
the entire check. And remember the on-premises case makes private addresses legitimate, so
this is a configurable policy, not a fixed blocklist.

**14. Readiness that checks the model.** Adding the customer model to the readiness probe
means a model outage marks every replica unready, the load balancer pulls them all, and
team administration and billing go down with it. Section 4.3 calls this out directly.
Liveness and readiness cover the things you own — process, database, Redis. Model health is
a separate signal.

**15. The credential in a log line.** Rarely logged deliberately. It arrives via
`logger.error({ err })` on an HTTP client error whose serialized request config includes
the `Authorization` header, or via logging the whole config object. Redact at the logger,
not at each call site, and write the test that greps captured log output for the
credential value.

**16. Trusting the usage object.** `usage.total_tokens` from a malformed response is
`undefined`, and the settlement writes `NaN` into the ledger, or throws in a path that
leaves the reservation dangling. Validate the response shape before it reaches the
settlement logic, and treat a malformed response as a failed request — release, do not
charge.

**17. Retrying without regard to what already happened.** Blind retry on any error double-
charges when the first attempt actually succeeded and the failure was in reading the
response. Retry connection failures and 500s, respect `Retry-After` on 429s, and never
retry after you have begun consuming a response body.

## Deployment and tests

**18. Sleeping in tests.** `await sleep(2000)` waiting for reconciliation is the reason CI
flakes at 3am. Make the sweeper directly invokable and call it. Where you genuinely need
concurrency, coordinate with a barrier so all clients release at the same instant, which
is both deterministic and a much sharper test than staggered requests.

**19. Testing concurrency in one process.** `Promise.all` of ten calls against one app
instance shares the process, so a process-local lock will make the test pass. The
multi-instance test has to go through the load balancer to two real replicas.

**20. The credential prefilled in the config form.** The model configuration screen does a
GET, the API returns the config including the decrypted credential to populate the input,
and the secret is now in the browser and in the page payload. Return only whether a
credential is set and when it changed. The field is write-only.
