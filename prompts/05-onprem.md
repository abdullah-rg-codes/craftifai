# Phase 5 — On-premises package and multi-instance operation (Agent mode)

---

Package the whole thing for a single-command on-premises deployment, and prove it runs
multi-instance.

**Compose stack.** Web application, two API replicas, a load balancer in front of them,
PostgreSQL, Redis, a migration service that runs to completion before the API starts, the
mock customer model, persistent named volumes, and health and readiness checks on
everything. One command brings it up from a clean clone.

Two replicas is not decoration — from this point on, run the whole test suite through the
load balancer. Any state you accidentally kept in process memory will surface here, and
it is much cheaper to find it now than in the load test.

**Offline.** After images are built, the stack comes up with no internet access.
Frontend assets are bundled locally, no CDN, no font fetch, no telemetry, no call home.
Test it by bringing the stack up with networking disabled and confirm nothing hangs
waiting on a request that will never complete.

**Configuration.** Every setting comes from environment or mounted secrets, with a
`.env.example` documenting each one. Mandatory configuration is validated at startup with
a clear error naming exactly what is missing — the failure mode to avoid is a container
that starts, appears healthy, and fails on the first request. Nothing is hardcoded: no
password, no key, no token, no customer endpoint. A customer-provided CA bundle is
mountable and actually used for a private HTTPS model endpoint.

**Lifecycle.** Graceful shutdown that stops accepting connections, drains in-flight
requests, and closes the pool. Data survives a full down and up. Reservations in flight
when the process dies are reconciled after restart, and there is a test that proves it.

**Bootstrap.** A documented procedure for creating the initial administrator that does
not involve a default password and cannot be replayed once an administrator exists.

**Operations.** Backup and restore, tested by actually restoring into a clean volume and
confirming balances and ledger match. Upgrade and rollback, including what happens to a
migration that has already run — the honest answer about which migrations are reversible
and which need a compensating path is worth more here than a procedure that quietly
assumes every migration rolls back cleanly.

**Metrics.** HTTP latency and errors, model latency and failures, credit reservations,
settlements, releases, and reconciliation failures. On an endpoint I can scrape.

Bring it up, show me both replicas serving through the load balancer, and stop.
