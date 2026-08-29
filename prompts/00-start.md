# The starting prompt — design brief before any code

Run this in **Plan mode**, in an empty repo that already contains
`docs/assignment.md`. It produces no code. Its only job is to force the eight
decisions that are painful to change later, and to get them written down while
they are still cheap.

---

I'm building the CraftifAI Full-Stack Platform Engineer assignment. The full brief is
in `@docs/assignment.md`. Read it completely before responding.

Read section 5 twice. It says a smaller implementation that satisfies the invariants
scores higher than a larger one that only works on the happy path. So this is not a
feature-count exercise, and I want you to treat it as an invariant-satisfaction
exercise from the first line of code. The grader will run concurrent requests against
two API replicas and try to drive a balance negative. That is the assignment. The
member-management CRUD is the easy part and I am not worried about it.

I also have to defend every decision in a technical discussion afterwards. So I need
reasoning I can reconstruct, not just code that works.

**Stack — locked, do not deviate:** TypeScript with `strict: true`, Node.js backend,
React or Next.js frontend, PostgreSQL as the authoritative store, Redis for rate
limiting and leases, Docker Compose for the on-premises package, versioned SQL
migrations. No hosted identity provider, no hosted database, no real payment provider,
no internet-accessible runtime dependency on the production path.

**Do not write any application code in this response.** Produce a design brief with
these six sections.

---

**1. The eight decisions.**

For each of the following, give me: the option you recommend, the two or three
realistic alternatives, why you rejected them, and the specific failure mode your
choice is defending against. Two or three tight paragraphs each — I need to be able to
defend these out loud, so prioritize the reasoning over the syntax.

- **Tenant isolation mechanism.** PostgreSQL row-level security driven by a
  per-transaction session variable, a mandatory org-scoped data-access layer that makes
  an unscoped query impossible to express, or both. Address what happens with a
  connection pool, and how a future careless `SELECT` written by a tired engineer gets
  caught rather than shipped.

- **Balance representation.** An append-only ledger summed on read, a materialized
  balance row updated in place, or a materialized row plus an append-only ledger
  written in the same transaction. Whichever you choose, show me the exact SQL
  statement that makes "available balance must never go negative" impossible rather
  than merely unlikely, and tell me what it serializes on and what that costs under
  300 concurrent inference requests per second.

- **Reservation lifecycle.** The state machine from reserve through settle, release,
  and expiry. When each transition happens, what writes the ledger entry, and how an
  interrupted request — process killed between the model responding and the settlement
  committing — is detected and resolved later.

- **Reconciliation ownership.** How exactly one of two API replicas runs the stale
  reservation sweeper: a PostgreSQL advisory lock, a Redis lease with a TTL, or a
  separate worker service in the Compose file. Cover what happens when the holder dies
  mid-sweep, and why the sweep is safe to run twice if your fencing fails.

- **Idempotency record design.** The table shape, what the key is scoped to, how the
  request body is fingerprinted for the same-key-different-body conflict, the state
  machine, and where the terminal response is stored for replay. Be specific about how
  two concurrent requests carrying the same key race: which database primitive decides
  the winner, and what the loser returns.

- **Session and revocation.** Opaque tokens with server-side state, or JWTs with a
  revocation list. The brief requires a documented revocation period for suspended
  users, so state the number you are choosing and what makes it true in the
  implementation rather than in the README.

- **Model credential encryption.** The algorithm, where the key comes from in both SaaS
  and on-premises deployments, how the ciphertext is stored, how rotation works, and
  what structurally prevents the plaintext from reaching an API response, a log line,
  or the frontend.

- **SSRF defense.** How an endpoint is validated, how you avoid the
  time-of-check-to-time-of-use gap between validating a hostname and connecting to it,
  how redirects are handled, and how the same code path still permits a private
  `10.x` model endpoint in an on-premises deployment where that is the correct target.

**2. Transaction boundaries.** Write out the sequence for one inference request from
HTTP arrival to response, marking exactly where each database transaction opens and
closes, where the Redis calls happen, and where the outbound model call sits. Then
state explicitly which operations must not share a transaction and why. I want to see
that you have thought about what a held transaction costs when the thing it is waiting
on is a network call to someone else's server.

**3. Schema.** Every table, its columns and types, primary and foreign keys, unique
constraints, check constraints, and indexes. For each index, name the query it serves.
For each unique constraint, name the invariant it enforces. Call out anything that will
need partitioning at the scale in section 2 of the brief.

**4. The invariant-to-test map.** A table mapping each of the nine credit invariants in
4.2, plus each acceptance criterion in section 5, to the specific test that will prove
it. Mark any invariant you cannot see a deterministic test for — no fixed sleeps — as
an open problem now rather than discovering it later.

**5. Build order.** Sequence the work so that the invariant-critical paths are built and
tested first and the surface area accumulates around them. Every phase must end with
something runnable and testable. Explicitly name what you are deferring and what makes
each deferred item safe to defer — specifically, whether it can be added without
reopening the schema or the transaction boundaries.

**6. Risks.** The three places you think this implementation is most likely to be
subtly wrong in a way that passes a casual manual test but fails a concurrent one.

---

Stop after the design brief. I will review and correct it, and then we scaffold.

Two things to keep in mind for everything that follows. Sections 1 and 5 of your
response become the decision records the brief requires in section 8, so write them at
that quality now rather than reconstructing the reasoning at the end. And when I later
catch you proposing something wrong, I am logging it in `AI_USAGE.md`, which is also a
required deliverable — so if you notice yourself having made a bad call earlier in the
session, say so plainly instead of quietly fixing it.
