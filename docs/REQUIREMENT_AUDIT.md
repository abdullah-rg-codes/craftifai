# Requirement audit (Phase 7)

Adversarial trace of `docs/assignment.md` against the repository as of Phase 7.
Status: **implemented**, **partial**, **missing**, **defer** (out of scope).

---

## §3 Mandatory technical constraints

| Requirement                                            | Status      | Evidence                                                                     |
| ------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------- |
| TypeScript strict                                      | implemented | Root + package `tsconfig.json`; `noUncheckedIndexedAccess`                   |
| Node.js backend                                        | implemented | `apps/api`                                                                   |
| React frontend                                         | implemented | `apps/web` (Vite SPA)                                                        |
| PostgreSQL authoritative                               | implemented | All financial state in PG; tests refuse SQLite                               |
| Versioned migrations                                   | implemented | `packages/db/migrations/*.sql` via dbmate                                    |
| Docker Compose on-prem                                 | implemented | `docker-compose.yml`                                                         |
| Redis in package                                       | implemented | Compose service + rate limits + session cache                                |
| No hosted auth/DB/payments/queues/CDN/runtime internet | implemented | Local auth, mock billing, bundled assets; CI Actions excluded from prod path |

---

## §4.1 Authentication, teams, access

| Requirement                            | Status      | Evidence                                                                            |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Local auth, Admin + Member             | implemented | `apps/api/src/routes/auth.ts`, `auth.ts`                                            |
| Invite user                            | implemented | `POST /members/invitations` → `members.ts:136+`                                     |
| View members                           | implemented | `GET /members` cursor list                                                          |
| Suspend / reactivate                   | implemented | `PATCH /members/:id/status`; revokes sessions same TX                               |
| Remove member                          | implemented | `DELETE /members/:id`                                                               |
| Promote / demote                       | implemented | `PATCH /members/:id/role`                                                           |
| View audit events                      | implemented | `GET /audit-events` + `/audit` page                                                 |
| Audit on role/membership/model/billing | implemented | `auditMembershipChange`; `modelConfig.ts:91`; `credits.ts` purchase.create/complete |
| ≥1 active administrator                | implemented | Org `FOR UPDATE` + count; `foundation.test.ts:446-554`                              |
| Members blocked from admin APIs        | implemented | `requireAdmin`; `foundation.test.ts:556`                                            |
| Suspension revocation period           | implemented | Immediate PG revoke + Redis tombstone; 60 s cache TTL in README                     |
| Backend authorization                  | implemented | Not UI-only; 403 from API                                                           |
| Cross-tenant ID tampering              | implemented | Org from session; DAL scoped; 404 semantics `foundation.test.ts:127`                |
| Cursor member listing                  | implemented | Composite cursor `(created_at, id)`                                                 |
| Invitation token (no email)            | implemented | Token in API response; public `/invite` join (password, no extra org)               |

---

## §4.2 Credit system

| Requirement                            | Status      | Evidence                                                                  |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| Prepaid balance; webhook-only increase | implemented | `billing.ts` + `credits.ts:applyPurchase`                                 |
| Pricing rule                           | implemented | `packages/shared/src/pricing.ts`; `pricing.test.ts`                       |
| Reserve before model, settle after     | implemented | `inference.ts` three TX boundary                                          |
| All 9 invariants                       | implemented | See design brief §7.2; `credits.test.ts`, `gateway.test.ts`, load harness |
| Idempotency-Key required               | implemented | `app.ts:114-122` middleware `required: true`                              |
| Idempotency semantics                  | implemented | `middleware/idempotency.ts`; concurrent test `credits.test.ts:569`        |
| No in-memory financial mutex           | implemented | No Maps for balance/idempotency in prod path                              |

---

## §4.3 Model gateway

| Requirement               | Status      | Evidence                                        |
| ------------------------- | ----------- | ----------------------------------------------- |
| Per-org config fields     | implemented | `model_configurations` table + `modelConfig.ts` |
| Credential out of browser | implemented | `modelConfigView.ts`; `Model.test.tsx`          |
| Encrypted credentials     | implemented | `services/crypto.ts` AES-256-GCM                |
| No credentials in logs    | implemented | `logger.ts` redaction; `gateway.test.ts:298`    |
| No prompt logging default | implemented | `LOG_MODEL_CONTENT=false`; `modelClient.ts`     |
| Timeouts + retries        | implemented | `modelClient.ts`                                |
| Failure modes             | implemented | `gateway.test.ts` matrix                        |
| Correlation ID            | implemented | `app.ts:39-42`, model client                    |
| Admin connectivity test   | implemented | `POST /model-config/test`                       |
| SSRF protection           | implemented | `services/ssrf.ts`                              |
| Private network (on-prem) | implemented | `ALLOWED_PRIVATE_CIDRS`                         |
| Model not in readiness    | implemented | `app.ts:76-90` PG+Redis only                    |
| Streaming (bonus)         | defer       | Not implemented                                 |

---

## §4.4 Web application

All listed admin and member surfaces present (`App.tsx` routes). Four UI states via `PageState.tsx`. Playground error copy tested in `errors.test.ts`.

**Partial:** Multi-org UI switcher — backend `X-Org-Id` works; web uses first membership when header absent.

---

## §4.5 On-premises

All items implemented; operational detail in `deploy/README.md` and `OPERATIONS.md`.

---

## §4.6 Scalability and operability

| Requirement                                          | Status                | Evidence                                    |
| ---------------------------------------------------- | --------------------- | ------------------------------------------- |
| ≥2 replicas + LB                                     | implemented           | `api-1`, `api-2`, nginx `deploy/nginx/`     |
| No in-memory cross-replica state for listed concerns | implemented           | PG + Redis only                             |
| Structured logs + correlation                        | implemented           | pino JSON                                   |
| Health / readiness / graceful shutdown               | implemented           | `/health`, `/ready`; `index.ts` drain       |
| Connection pooling                                   | implemented           | `@craftifai/db` pool                        |
| Rate limits                                          | implemented           | `rateLimit.ts`                              |
| Metrics                                              | implemented           | `/metrics`                                  |
| Indexes + pagination                                 | implemented           | Migrations + all list routes                |
| Load test + scaling doc                              | implemented / partial | `load/` + `ARCHITECTURE.md` scaling section |

**Partial:** Control-plane p95 vs 150 ms target not measured separately from model latency (`load/REPORT.md`).

---

## §5 Acceptance criteria

All fifteen criteria **implemented** with tests or load harness evidence. See plan §7.1.

---

## §6 Testing expectations

All categories covered. Integration tests require real PostgreSQL + Redis (`pnpm test:intermediate`, `pnpm test:advanced`). CI runs full suite.

---

## §7 Load test

Implemented: `load/harness.ts`, `load/REPORT.md`, CI `compose-load` job.

**Partial:** Harness emphasizes inference + invariants; member-list traffic is not a primary mix.

---

## §8 Submission deliverables

| Deliverable           | Status                            |
| --------------------- | --------------------------------- |
| README.md             | Phase 7 — expanded                |
| ARCHITECTURE.md       | Phase 7                           |
| SECURITY.md           | Phase 7                           |
| OPERATIONS.md         | Phase 7                           |
| AI_USAGE.md           | Phase 7                           |
| openapi.yaml          | Phase 7                           |
| Migrations            | implemented                       |
| Tests                 | implemented                       |
| Load report           | implemented                       |
| Compose package       | implemented                       |
| Architecture diagrams | Phase 7 — in ARCHITECTURE.md      |
| Decision records      | Phase 7 — `docs/decisions/`       |
| Git history           | implemented — incremental commits |

---

## Gaps closed in Phase 7

1. **Billing audit events** — `purchase.create` / `purchase.complete` added (migration `00000000000006`).
2. **Documentation bundle** — this audit plus five root docs.

## Remaining honest partials

- Streaming inference (bonus only).
- CSRF: `SameSite=Lax` without custom mutation header (documented in SECURITY.md).

---

## Honest assessment (Phase 7 §7)

### Weakest areas a skeptical reviewer will probe

1. **Concurrency story under oral exam** — Code and tests are solid, but you must explain
   the three-transaction inference flow and why the row lock is not held across the model
   call without referring to slides. Trap: "why not one big transaction?"

2. **Idempotency ON CONFLICT vs catch** — The loser-visibility race is subtle. Reviewer
   may ask you to whiteboard the timeline of two concurrent duplicate POSTs.

3. **Sweeper vs in-flight settle** — Conditional `WHERE status = 'reserved'` on every
   transition. Be ready to walk through expire-while-settling interleaving.

4. **Control-plane latency** — Load report p95 ~3 s is end-to-end with mock latency; the
   150 ms control-plane target from the brief is not separately measured. Do not claim
   it without adding a split metric.

5. **CSRF** — SameSite-only is defensible for same-origin SPA but incomplete vs design
   brief's custom-header plan.

### What passes scrutiny

- All 15 acceptance criteria have test or load evidence.
- Real PostgreSQL concurrency suite; two replicas through nginx.
- Secret handling: type boundaries, log redaction, gitleaks CI.
- On-prem: offline overlay, backup/restore tested in CI.

### Interview prep priority

1. Guarded balance UPDATE + ledger sum identity
2. Idempotency claim-first semantics
3. Tenant 404 + RLS + SET LOCAL pool safety
4. Why readiness excludes model
5. Multi-region = single-primary for credits (from ARCHITECTURE.md)
