# CraftifAI Full-Stack Platform Engineer Assignment

> Transcribed from `CraftifAI.pdf` so it can be referenced as `@docs/assignment.md`
> in Cursor. Keep it in the repo — it stays in context across sessions in a way a
> chat attachment does not.

**Assignment:** Build a Reliable Multi-Tenant AI Control Plane
**Level:** Senior Full-Stack / Platform Engineer
**Recommended duration:** Five calendar days, maximum ~24 engineering hours
**Primary stack:** TypeScript, Node.js, React or Next.js, PostgreSQL
**AI tools:** Claude, ChatGPT, Copilot, Cursor and similar are explicitly allowed

The assignment is intentionally designed so that generating a large amount of code is
not enough. The candidate must demonstrate tenant isolation, concurrency safety,
failure recovery, deployment discipline, and the ability to defend and modify the
implementation.

## 1. Background

CraftifAI provides AI-assisted development tools to enterprise teams.

A customer organization may have multiple users, but only authorized administrators can:

- Invite, suspend, reactivate, or remove users.
- Change user roles.
- Purchase and manage organization credits.
- Configure the AI model endpoint used by the organization.
- Review usage and administrative activity.

CraftifAI must support two deployment models:

1. **CraftifAI SaaS:** Multiple customer organizations share the CraftifAI control
   plane while remaining strictly isolated.
2. **Customer on-premises deployment:** The complete application runs inside the
   customer's environment and uses an AI model provisioned by the customer. The
   deployment must not depend on an external model or a public cloud service.

Your task is to build a production-minded vertical slice of this platform. This is not
intended to be a simple CRUD application.

## 2. System Scale to Design For

Your implementation will be tested at a smaller scale, but the architecture should
support a future deployment with approximately:

| Metric | Target |
| --- | --- |
| Registered users | 1,000,000 |
| Customer organizations | 50,000 |
| Daily active users | 100,000 |
| Concurrent active sessions | 20,000 |
| Peak control-plane traffic | 1,000 requests/second |
| Peak new AI requests | 300 requests/second |
| API availability target | 99.9% |
| Control-plane overhead | p95 below 150 ms, excluding model latency |

You are not expected to run one million users locally. You are expected to show how
your implementation can evolve to that scale and provide evidence for your design
decisions.

## 3. Mandatory Technical Constraints

The core application must use:

- TypeScript with strict type checking.
- Node.js for the backend.
- React or Next.js for the frontend.
- PostgreSQL as the authoritative database.
- Versioned database migrations.
- Docker Compose for the reference on-premises package.

Redis may be used for caching, distributed rate limiting, leases, or coordination, but
it must be included in the deployment package.

The production path must not depend on:

- Auth0, Firebase Authentication, or another hosted identity provider.
- Supabase or another hosted database.
- Stripe or another real payment system.
- A hosted queue or cache.
- A public CDN.
- Any internet-accessible runtime dependency.

## 4. Required Capabilities

### 4.1 Authentication, Teams, and Access Management

Implement local user authentication and organization membership management.

The system must support at least these roles: **Administrator**, **Member**.

An administrator must be able to:

- Invite a user to the organization.
- View organization members.
- Suspend and reactivate a member.
- Remove a member.
- Promote a member to administrator.
- Demote an administrator.
- View administrative audit events.

The system must enforce the following rules:

- Every organization must always have at least one active administrator.
- A member cannot access administration APIs.
- A suspended user must lose access within a clearly documented revocation period.
- Authorization must be enforced by the backend, not only by hiding frontend controls.
- A user must never be able to access another organization by changing an identifier in
  a URL, request body, query parameter, or token.
- Member listing must use cursor-based pagination.
- Invitations do not need to send a real email. A secure invitation link or token is
  sufficient.

All role, membership, model-configuration, and billing changes must generate an audit
event.

### 4.2 Organization Credit System

Each organization has a prepaid credit balance.

An administrator may start a credit purchase from the web application, but the balance
must only increase after the mock billing service sends a valid signed webhook.

Pricing rule for AI requests:

> One credit is charged for each started block of 1,000 total tokens, with a minimum
> charge of one credit.

For example:

- 500 tokens cost one credit.
- 1,000 tokens cost one credit.
- 1,001 tokens cost two credits.
- 2,800 tokens cost three credits.

Each inference request includes a `max_total_tokens` value. The system must reserve
enough credits before contacting the model and settle the actual charge after receiving
model usage.

The implementation must preserve all of these invariants:

1. An organization's available balance must never become negative.
2. The model must not be called when the required credits cannot be reserved.
3. The same billing webhook must never add credits more than once.
4. The same AI request must never be charged more than once.
5. Failed model requests must not leave credits permanently consumed.
6. Credit reservations and transactions must survive an application restart.
7. Stale or abandoned reservations must be recoverable through a reconciliation
   mechanism.
8. Credit history must be auditable and must not be silently overwritten.
9. The implementation must remain correct when multiple API instances process requests
   simultaneously.

An `Idempotency-Key` header is required for inference requests and purchase creation.
For repeated requests:

- The same key and same request body must not create another charge.
- The same key with a different request body must return a conflict.
- Concurrent duplicate requests must not cause multiple model invocations or multiple
  charges.
- A duplicate received while the original request is still running may return an
  in-progress response.
- After the original request completes, a replay must return its previously stored
  terminal result.

Do not rely on a process-local mutex or an in-memory map for financial correctness.

### 4.3 Customer-Provisioned Model Gateway

Each organization must have a server-side model configuration containing: deployment
mode, model endpoint, model name, authentication credential, request timeout, and an
optional custom certificate authority bundle.

The model endpoint follows an OpenAI-compatible chat-completions interface and returns
token-usage information.

The application must:

- Route each organization only to its configured model.
- Keep the model credential out of the browser.
- Encrypt stored model credentials or use an equivalent secure secret-reference
  mechanism.
- Never place model credentials in logs.
- Avoid logging complete prompts or generated source code by default.
- Apply timeouts and bounded retry behavior.
- Handle model timeouts, connection failures, HTTP 429 responses, HTTP 500 responses,
  and malformed responses.
- Include a correlation identifier in logs and downstream requests.
- Provide an administrator-only model connectivity test.
- Implement basic protection against server-side request forgery.
- Support private network model endpoints for on-premises deployments.
- Allow a deployment-level endpoint allowlist or egress policy.

The customer model must not be treated as part of application readiness. A temporary
model outage should not make team administration or billing APIs unavailable.

Streaming responses are optional and will receive bonus credit. A streaming
implementation must still settle credits correctly when the client disconnects.

### 4.4 Web Application

Create a functional web interface containing at least:

**Administrator experience:** organization overview, current credit balance, team
member management, credit purchase initiation, credit transaction history, model
configuration, model connection test, organization usage history, audit-event history.

**Member experience:** AI request playground, personal usage history, clear
insufficient-credit and model-failure messages, no access to administrative operations.

The frontend does not need to be visually elaborate. It should have clear loading,
success, empty, and failure states.

The frontend must not expose: model credentials, internal billing secrets, information
belonging to another organization, or administrative actions to unauthorized users.

Frontend authorization checks are useful for user experience but do not replace
server-side authorization.

### 4.5 On-Premises Deployment

Provide a single-command reference deployment using Docker Compose.

The package must contain: web application, API service, PostgreSQL, Redis (when used),
database migration command or migration service, mock customer model for evaluation,
persistent data volumes, and health and readiness checks.

The deployment must:

- Run without internet access after images and dependencies have been prepared.
- Use locally bundled frontend assets.
- Accept a customer model endpoint and credential through configuration or mounted
  secrets.
- Support a customer-provided certificate authority for a private HTTPS model.
- Preserve data across restarts.
- Validate mandatory configuration at startup.
- Shut down gracefully.
- Avoid mandatory telemetry or communication with CraftifAI infrastructure.
- Provide a documented initial-administrator bootstrap procedure.
- Provide documented backup and restore procedures.
- Provide an upgrade and rollback procedure.
- Avoid hardcoded passwords, keys, tokens, or customer endpoints.

A Kubernetes or Helm package is optional and should not replace the required Docker
Compose package.

### 4.6 Scalability and Operability

Demonstrate that the API can run behind a load balancer with at least two application
replicas.

Your implementation must not depend on application-process memory for: credit
correctness, idempotency, session revocation, rate limiting across replicas, or
background-job ownership.

Include: structured JSON logs, correlation IDs, health and readiness endpoints,
graceful shutdown, database connection pooling, API request timeouts, per-user or
per-organization rate limits, metrics (HTTP latency, errors, model latency, model
failures, credit reservations, settlements, releases, reconciliation failures),
appropriate indexes for member/usage/audit/credit-history queries, bounded and
paginated list APIs, a load-test script, and a capacity and scaling document.

Your scaling document should cover: expected database growth; ledger and audit-event
retention; indexing and partitioning; cache usage and invalidation; connection-pool
sizing; horizontal scaling; failure domains; rate limiting and backpressure; background
work and durable queues; database high availability; backup, recovery-point, and
recovery-time targets; when a single PostgreSQL deployment would stop being sufficient;
how SaaS and on-premises scaling strategies differ; and how you would approach
multi-region deployment without corrupting credit balances.

Do not simply state that Kubernetes or autoscaling will solve the problem. Quantify the
important bottlenecks and explain the consistency model.

## 5. Mandatory Acceptance Criteria

| Area | Acceptance criterion |
| --- | --- |
| Tenant isolation | A user from Organization A cannot read, modify, infer the existence of, or act upon resources belonging to Organization B. |
| Role enforcement | Member accounts cannot call administration or billing APIs directly. |
| Last administrator | The final active administrator cannot be removed, suspended, or demoted. |
| Credit concurrency | Concurrent requests cannot produce a negative balance or consume more credits than are available. |
| Purchase idempotency | Repeated and concurrent delivery of the same billing event changes the balance once. |
| Inference idempotency | Repeated or concurrent use of the same idempotency key never causes duplicate charging. |
| Provider failures | Timeouts, 429 responses, 500 responses, and malformed provider responses are handled without leaking reserved credits. |
| Restart recovery | An interrupted request or stale reservation is detected and safely reconciled after restart. |
| Secret handling | Model credentials and billing secrets do not appear in API responses, frontend state, source control, or application logs. |
| Multi-instance operation | Correctness is preserved when at least two API instances are active. |
| On-premises operation | The complete system functions without external internet access and uses the configured customer model. |
| Data persistence | Users, memberships, balances, model configuration, and audit history survive restarts. |
| Large collections | Member, transaction, usage, and audit APIs are paginated and do not load unbounded datasets. |
| Observability | Important failures can be understood from logs and metrics without exposing customer prompts or secrets. |
| Reproducibility | The project runs from a clean clone using the submitted instructions. |

**A smaller implementation that satisfies these invariants will score higher than a
larger implementation that only works on the happy path.**

## 6. Testing Expectations

Tests must use PostgreSQL for credit, idempotency, and concurrency behavior. SQLite or
a completely mocked repository is not sufficient for these critical paths.

Include: unit tests for isolated business rules; API integration tests; database
integration tests; authorization and tenant-isolation tests; concurrent
credit-consumption tests; duplicate-webhook tests; duplicate-inference tests;
model-failure tests; restart or stale-reservation recovery tests; and at least one test
that runs requests through two API instances.

Tests must be deterministic. Avoid tests that depend only on fixed sleep durations.
Coverage percentage is not a substitute for testing the important failure paths.

## 7. Load-Test Requirement

Provide a repeatable load test covering at least: two API replicas; 200 or more
concurrent clients; member and usage queries; concurrent inference requests;
simultaneous credit exhaustion; model latency between 50 and 250 milliseconds; and a
mixture of successful responses, timeouts, 429 responses, and 500 responses.

The report must contain: test environment, test duration, request rate, p50/p95/p99
latency, error rate by category, database CPU and connection usage, evidence that no
balance became negative, bottlenecks discovered, and the next three improvements you
would make.

Performance numbers are hardware-dependent. Correctness under load is more important
than presenting a very high requests-per-second number.

## 8. Required Submission

Submit a Git repository containing:

| Deliverable | Expected content |
| --- | --- |
| `README.md` | Clean-clone setup, run, test, load-test, and demo instructions |
| `ARCHITECTURE.md` | Components, data flow, consistency model, failure handling, and one-million-user scaling plan |
| `SECURITY.md` | Threat model, tenant-isolation strategy, secret handling, webhook security, and SSRF considerations |
| `OPERATIONS.md` | Health checks, metrics, backup, restore, upgrade, rollback, and incident procedures |
| `AI_USAGE.md` | AI tools used, areas substantially generated, validation performed, and examples of incorrect AI output that you corrected |
| `openapi.yaml` or equivalent | API contract |
| Database migrations | Reproducible, versioned schema |
| Automated tests | Unit, integration, concurrency, and failure tests |
| Load-test report | Reproducible script and results |
| On-premises package | Docker Compose, configuration examples, and offline-run instructions |
| Architecture diagram | SaaS and on-premises views |
| Decision records | At least three meaningful architecture decisions and rejected alternatives |

The Git history should contain meaningful incremental commits rather than a single
final code dump.

## 9. AI-Assistant Policy

Use of Claude, ChatGPT, Copilot, Cursor, or another coding assistant is allowed and
will not reduce your score.

You remain responsible for: every security decision, every data-consistency decision,
every dependency, every line of submitted code, verifying generated migrations and
queries, and identifying when an AI-generated solution is unsafe or incorrect.

In `AI_USAGE.md`, include at least two examples where an AI assistant proposed
something incorrect, incomplete, insecure, or unsuitable and explain how you detected
and corrected it.

During the technical discussion, you may be asked to explain or modify any part of the
submission.

## 10. Out of Scope

You do not need to build: a real payment-provider integration, a real large-language
model, email delivery, social login, a full Kubernetes production environment,
multi-region infrastructure, pixel-perfect design, or advanced analytics dashboards.

The design documents should explain how the production system would address the
relevant scale and availability requirements.
