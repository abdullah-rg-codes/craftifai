# ADR 001: Tenant isolation — scoped DAL primary, RLS fail-closed backstop

## Status

Accepted.

## Context

Multi-tenant SaaS with strict isolation: a user in org A must not read, modify, or infer
existence of org B resources. Two common approaches: application-layer scoping only, or
PostgreSQL row-level security only.

## Decision

Use **both**:

1. **DAL (primary)** — Every tenant query goes through `createOrgDal(ctx)` after
   `SET LOCAL app.current_org` inside a transaction helper. Unscoped query builders are
   not exported. Cross-tenant and nonexistent resources return identical **404** responses.

2. **RLS (backstop)** — `USING (org_id = current_setting('app.current_org', true)::uuid)`
   enabled and **forced** on every tenant table. App connects as `craftifai_app` with
   `NOBYPASSRLS`. Unset setting → NULL → zero rows (fail closed).

3. **Pool safety** — Only `SET LOCAL` inside the transaction helper; never session-level
   `SET` on pooled connections.

4. **System exception** — Sweeper sets `app.is_system` in a dedicated entry point only;
   tests assert request handlers cannot set it.

## Rejected alternatives

| Alternative         | Why rejected                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| DAL-only            | One forgotten unscoped query fails silently until production                                            |
| RLS-only            | Every read forced into explicit transactions; worse ergonomics; still needs DAL above for 404 semantics |
| 403 on cross-tenant | Leaks resource existence; assignment requires non-inferability                                          |

## Consequences

- New tables with `org_id` must add RLS policies; CI schema-invariant test enforces this.
- Debugging requires knowing org context is transaction-local.
- Cross-tenant tests must run on real PostgreSQL with the app role.
