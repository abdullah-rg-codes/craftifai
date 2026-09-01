# AI usage log

This assignment explicitly allows AI-assisted development. I remain responsible for every
security, consistency, and deployment decision. This file records how AI was used, what was
validated, and where AI output was wrong.

---

## Tools used

| Tool                                                         | Role                                             |
| ------------------------------------------------------------ | ------------------------------------------------ |
| **Cursor** (Claude)                                          | Primary implementation partner across phases 0–7 |
| **Design brief** (`craftifai_design_brief_e00b758d.plan.md`) | Human-approved architecture gate before code     |
| **Phase prompts** (`prompts/*.md`)                           | Scoped instructions per build phase              |
| **CI (GitHub Actions)**                                      | Continuous validation — not AI                   |

---

## Areas substantially AI-generated

| Area                          | AI contribution | Human validation                                     |
| ----------------------------- | --------------- | ---------------------------------------------------- |
| SQL migrations + RLS policies | Drafted         | Reviewed for forced RLS, grants, CHECK constraints   |
| DAL + transaction helper      | Drafted         | Pool/SET LOCAL trap checked against `known-traps.md` |
| Credit reserve/settle/release | Drafted         | Concurrency tests on real PostgreSQL                 |
| Idempotency middleware        | Drafted         | ON CONFLICT race tests; stale key sweeper            |
| SSRF pinning                  | Drafted         | Unit + integration redirect test                     |
| React admin/member pages      | Drafted         | Manual smoke + credential leak test                  |
| Docker Compose + nginx        | Drafted         | CI compose-e2e, offline overlay, restore test        |
| Load harness                  | Drafted         | CI compose-load; invariant assertions                |
| Phase 7 documentation         | Drafted         | Cross-checked against code paths                     |

---

## Validation performed

1. **Real PostgreSQL** for all credit, idempotency, and concurrency tests — no SQLite, no mocked repository on financial paths.
2. **Barrier synchronization** in concurrent tests — no fixed sleeps as primary sync.
3. **Two API instances** through nginx in compose tests and load harness.
4. **CI pipeline:** typecheck, lint, unit + integration, compose build, e2e, load, gitleaks, Semgrep, Trivy.
5. **Requirement audit:** `docs/REQUIREMENT_AUDIT.md` traces assignment sections to files.
6. **Corrections as separate commits** — git history shows test-first fixes (e.g. Phase 2 webhook/concurrency).

---

## Example 1: Read-then-write balance (AI suggested check-then-act)

**What AI proposed:** Early credit sketch read `available` in application code, compared to
cost, then issued separate UPDATE — the natural CRUD pattern.

**Why it was wrong:** Two concurrent requests both read `available = 10`, both decide they
can afford 8, both write — balance ends at -6. Passes every sequential test; fails the
grader's concurrent exhaustion test (assignment invariant 1).

**How detected:** `docs/known-traps.md` trap #1; red-team review against assignment §4.2
"never become negative" under simultaneous requests.

**What replaced it:** Guard inside the writing statement:

```sql
UPDATE org_credit_accounts
   SET available = available - $1, reserved = reserved + $1
 WHERE org_id = $2 AND available >= $1
```

Zero rows → 402, model never called. Verified in `credits.test.ts` concurrent exhaust test
and load harness SQL sampling.

---

## Example 2: Idempotency loser visibility (AI used catch-then-SELECT)

**What AI proposed:** Insert idempotency row; on unique violation, catch error and SELECT
existing row to decide replay vs conflict.

**Why it was wrong:** Under READ COMMITTED, the loser's SELECT can run before the winner's
INSERT commits — sees nothing, proceeds to double reserve and double model call. Multi-instance
test and duplicate-key barrier test fail intermittently then deterministically under load.

**How detected:** Design brief §1.5 explicitly flags this trap; `known-traps.md` #3–#4;
concurrent identical idempotency key test written first (red-green).

**What replaced it:** `INSERT ... ON CONFLICT DO NOTHING RETURNING *` as the **first**
statement of the claim transaction. Loser blocks on winner's row until commit, then reads
terminal state. Implemented in `middleware/idempotency.ts`; proven in
`credits.test.ts` "concurrent identical idempotency keys".

---

## Example 3: Committed TLS private key in test fixtures (AI-added file)

**What AI did:** Phase 3 TLS unit test added `apps/api/test/fixtures/tls-key.pem` for
private HTTPS model tests.

**Why it was wrong:** gitleaks flags private keys in git history even after deletion;
assignment §5 secret handling and CI gitleaks job fail.

**How detected:** CI gitleaks failure on push; commit message `564df10 Stop committing a TLS
private key the secret scanner flags`.

**What replaced it:** Runtime-generated self-signed key in `modelClient.tls.unit.test.ts`;
fixture file removed; `.gitleaks.toml` allowlist documents the historical deletion patch only.

---

## Example 4: Billing changes without audit events (Phase 7 review)

**What was missing:** Purchase create/complete updated ledger but did not write
`audit_events`, violating assignment §4.1 ("billing changes must generate an audit event").

**How detected:** Adversarial requirement cross-check before Phase 7 submission — traced
purchase path in `routes/purchases.ts` and `services/credits.ts`, compared to membership
and model config routes which already audited.

**What replaced it:** Migration `00000000000006_add_purchase_initiated_by.sql`;
`purchase.create` and `purchase.complete` audit in same transaction; test assertion in
webhook purchase test.

---

## Example 5: Unsigned purchase confirm (demo helper)

**What AI proposed:** `POST /purchases/:id/confirm-mock` so the Credits UI could apply
credits without assembling an HMAC — framed as “same path as the webhook.”

**Why it was wrong:** Assignment §4.2: the balance must only increase after the mock
billing service sends a **valid signed webhook**. An admin cookie was enough to mint
credits; `WEBHOOK_SECRET` was unused on that path.

**How detected:** Hostile requirement audit against the PDF, not against the OpenAPI
summary that called it a demo helper.

**What replaced it:** Route and UI button removed. Demo delivers `POST /billing/webhook`
with `X-Webhook-Signature`. Test asserts the old path 404s and the balance stays 0.

---

## Example 6: Nginx SPA image skipped tsc under a README `.env`

**What was wrong:** `.dockerignore` listed `node_modules` (root only). After `pnpm install`
on Windows, `COPY apps/web` overlaid host pnpm links into the Linux build. `.env.example`
sets `NODE_ENV=production`; Compose Bake forwards that into `pnpm install`, which omits
`typescript` and `vite` (web devDependencies). CI compose-build did neither, so it stayed green.

**How detected:** Clean clone on Windows 11 Home following README Full stack —
`Cannot find module '.../apps/web/node_modules/typescript/bin/tsc'`.

**What replaced it:** `**/node_modules` in `.dockerignore`; `ENV NODE_ENV=development` in
the nginx build stage before `pnpm install`. CI compose-build now sets `NODE_ENV=production`
and poisons host `apps/web/node_modules` before `docker compose build`. Sanity test
`nginxDockerBuild.unit.test.ts` guards both files.

---

## Supervision model

AI accelerated scaffolding and boilerplate. **Invariants were decided in the design brief
before implementation** and enforced by tests AI did not grade. I rejected AI output when it
conflicted with traps in `known-traps.md`, when CI failed, or when tracing a requirement
to code showed a gap. Phase 7 documentation was reviewed against actual route handlers, not
against memory of what was intended.

---

## If asked in interview

Be ready to explain live: guarded balance UPDATE, three-transaction inference flow,
ON CONFLICT idempotency claim, conditional reservation transitions, and why readiness
excludes the model. Those are the sites a skeptical reviewer will probe first.
