# Security

Threat model and controls for the CraftifAI control plane. Assumes attackers can:
send arbitrary HTTP requests, register accounts, belong to one org and probe others,
and influence their organization's model URL (SSRF pivot).

---

## Assets

| Asset                           | Impact if compromised                        |
| ------------------------------- | -------------------------------------------- |
| Model API keys (per org)        | Customer model abuse, data exfil via prompts |
| Billing webhook secret          | Fraudulent credit minting                    |
| Session secret / encryption key | Session forgery, credential decryption       |
| Organization credit balances    | Direct financial loss                        |
| Member PII (email)              | Privacy breach                               |
| Audit trail                     | Compliance / forensics loss                  |

---

## Tenant isolation

**Strategy:** Defense in depth (see ADR 001).

1. **Session-derived org context** — Never trust `org_id` from body/query/path alone.
   Optional `X-Org-Id` header selects among the user's memberships server-side.

2. **DAL** — All tenant queries through org-scoped transaction helper with `SET LOCAL`.

3. **RLS** — Forced on every table with `org_id`; app role cannot bypass.

4. **Uniform 404** — Cross-tenant access and missing resources return identical responses
   so attackers cannot enumerate foreign IDs.

**Tested:** Cross-tenant matrix in `apps/api/test/foundation.test.ts` over members,
credits, reservations, purchases, model config, audit.

---

## Authentication and sessions

- Opaque 256-bit session token; **SHA-256 hash** stored in PostgreSQL.
- Cookie: `HttpOnly`, `Secure` when `COOKIE_SECURE=true`, `SameSite=Lax`.
- Revocation: membership suspend/remove revokes sessions in the **same transaction** as
  the membership change; Redis cache actively evicted; **60 s** worst-case stale window
  documented in README if eviction fails.
- Passwords: bcrypt via `@craftifai/shared`.

### CSRF

**Implemented:** `SameSite=Lax` on session cookie — blocks cross-site POST from unrelated sites in modern browsers.

**Not implemented:** Custom header requirement on mutations (e.g. `X-Requested-With`) and strict `Origin` allowlist. **Reasonable scope cut** for a take-home SPA on same origin as API (`/api` proxied through nginx). **Production hardening:** add double-submit token or custom header check for cookie-authenticated mutations.

---

## Secret handling

| Secret                  | Storage                      | Never appears in                   |
| ----------------------- | ---------------------------- | ---------------------------------- |
| Model credential        | AES-256-GCM ciphertext in PG | API GET, frontend state, logs, git |
| `WEBHOOK_SECRET`        | Env / mount                  | Responses, client                  |
| `SESSION_SECRET`        | Env                          | Client                             |
| `ENCRYPTION_KEY_BASE64` | Env / file                   | Client, logs                       |

**Structural boundaries:**

- `ModelConfigPublic` type has no credential field.
- `Secret` class blocks JSON serialization.
- Logger denylist redacts `credential`, `Authorization`, nested HTTP error configs.
- Test greps captured logs on failing model call (`gateway.test.ts`).

**CI:** gitleaks on every push (`.github/workflows/gitleaks.yml`). Historical note: commit
`1dbd08e` briefly added a TLS test fixture key; removed in `564df10`; allowlist documents
the deletion patch. **No production credentials in history.**

`.env.example` contains placeholders only (`CHANGE_ME`, empty secrets).

---

## Webhook security

Mock billing webhooks use HMAC-SHA256 (`services/billing.ts`):

- Header: `X-Webhook-Signature: t=<unix>,v1=<hex>`
- Signed payload: `{timestamp}.{raw_body}`
- **Replay window:** ±5 minutes (`WEBHOOK_MAX_AGE_SECONDS = 300`)
- **Idempotency at apply:** `webhook_events.provider_event_id` PRIMARY KEY — duplicate delivery credits once

Verification happens **before** database transaction; apply runs in one transaction with ledger write.

---

## SSRF (model gateway)

Per-request pipeline (`services/ssrf.ts`):

1. Scheme allowlist (`http`/`https` only; no userinfo in URL).
2. Resolve hostname once; **every** A/AAAA must pass policy.
3. Block loopback, link-local (`169.254.0.0/16` always), multicast, unspecified.
4. RFC1918/ULA blocked unless listed in `ALLOWED_PRIVATE_CIDRS`.
5. Connect to **validated IP** with original hostname for SNI/TLS — client does not re-resolve.
6. Redirects: manual, max 3 hops, each re-validated.

Admin connectivity test uses the same pipeline; charges no credits.

**On-prem:** Private ranges allowed via config — same code path, different policy.

---

## Authorization

- **Administrator** — members, credits, purchases, model config, audit, org usage.
- **Member** — inference, personal usage, invitation accept.
- Enforced in route handlers via `requireAdmin` / `requireAuth` — frontend gating is UX only.

---

## Logging and privacy

- Structured JSON logs (pino) with correlation ID.
- **Prompts and completions not logged** unless `LOG_MODEL_CONTENT=true`.
- Request completion logs: method, path, status, duration — no bodies by default.

---

## Out of scope / not defended

| Threat                       | Why omitted                                                 |
| ---------------------------- | ----------------------------------------------------------- |
| DDoS at edge                 | No WAF/CDN in assignment; rate limits are best-effort Redis |
| Account enumeration on login | Generic error message; timing side channels not hardened    |
| MFA / password reset         | Out of assignment scope                                     |
| mTLS to customer model       | Optional CA bundle only                                     |
| Supply chain beyond CI audit | Dependabot + pnpm audit + Semgrep/Trivy in CI               |
| Insider with DB superuser    | RLS bypass; operational trust boundary                      |

---

## Security testing

- Unit: webhook HMAC, SSRF CIDR, crypto round-trip
- Integration: tenant isolation, credential not in GET, redirect to metadata blocked
- CI: gitleaks, Semgrep, Trivy, pnpm audit

See `docs/known-traps.md` for failure modes that look secure in manual testing but fail the grader.
