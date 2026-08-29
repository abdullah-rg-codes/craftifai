# Phase 1 — Foundation: schema, tenant isolation, auth (Agent mode)

Send after you have reviewed and corrected the design brief.

---

Design brief approved. Build phase 1. Nothing in this phase touches credits or the
model — this is the substrate everything else sits on, and I want it right before
anything is built on top of it.

**Repository layout.** Set up the workspace, TypeScript with `strict: true` plus
`noUncheckedIndexedAccess`, linting and formatting with ecosystem defaults, and a
migration tool that produces plain versioned SQL files I can read. I want to be able to
review the SQL that will run against the database, not trust an ORM to generate it.

**Migrations.** Every table from the approved schema, with the constraints and indexes
as designed. Each migration gets an up and a down. The credit and idempotency tables go
in now even though nothing writes to them yet — I would rather have the schema settled
than migrate it under working code later.

**Tenant isolation.** Implement the mechanism we agreed on, and implement it so that
bypassing it requires deliberate effort rather than forgetfulness. If it is a scoped
data-access layer, the unscoped query builder should not be exported. If it is
row-level security, the session variable is set by the transaction helper and there is
no code path that opens a transaction without it. Then write the test that proves it:
seed two organizations, and from organization A attempt to read, update, and delete
every resource type belonging to organization B, by direct identifier. Every attempt
returns the same not-found response — not a forbidden, since a distinct forbidden
response confirms the resource exists and the brief says a user must not be able to
infer existence.

**Authentication.** Local email and password with a memory-hard hash. Sessions as
designed, with the revocation path implemented, not just planned. Write the test that
suspends a user with a live session and proves the session stops working inside the
documented window.

**Memberships and roles.** The full administrator surface from 4.1: invite, list,
suspend, reactivate, remove, promote, demote. Member listing uses cursor-based
pagination with an opaque, stable cursor — the ordering key must be unique or the
pagination will silently skip rows under concurrent inserts, so use a composite cursor
if the sort column is not unique.

**The last-administrator rule.** This one deserves attention because the obvious
implementation is wrong. Checking "are there other active admins" and then performing
the demotion is a read-then-write race: two concurrent requests each demoting a
different admin will both see two admins and both succeed, leaving an organization with
none. Make it correct under concurrency, and write the concurrent test that would have
caught the naive version.

**Audit events.** Every role, membership, model-configuration, and billing change
writes an audit event in the same transaction as the change it describes. If the change
commits and the audit write does not, the audit log is a lie — so they commit together
or not at all.

**Authorization.** Enforced in the backend. A member calling any administrative
endpoint gets the same treatment regardless of what the frontend would have shown them.
Test each administrative endpoint with a member token.

**Working rules for this and every later phase:**

- No `TODO`, no stubbed function bodies, no dead endpoints. If it is not built in this
  phase, it does not appear in the code.
- Errors are typed and mapped to responses in one place, not handled ad hoc at each call
  site.
- Structured JSON logs with a correlation ID from the first request handler. Adding this
  later means threading it through everything, so it goes in now.
- Commit in meaningful increments as you go. The brief explicitly grades git history,
  and a single squashed dump at the end reads exactly like what it is.
- Nothing goes in `.env` that is not documented in `.env.example`. No secret is ever
  committed, and no password, key, or endpoint is hardcoded anywhere.

When phase 1 runs and its tests pass, show me the migration files and the tenant
isolation test output, then stop.
