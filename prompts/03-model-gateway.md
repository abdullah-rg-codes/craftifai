# Phase 3 — Model gateway and the inference path (Agent mode)

---

The ledger is correct in isolation. Now attach the unreliable thing to it.

**Mock model service.** Build this first, as a container in the Compose file — an
OpenAI-compatible chat-completions endpoint returning realistic token usage. It must be
controllable per request or by configuration to produce: a normal response, a
configurable latency between 50 and 250 ms, a slow response that exceeds the client
timeout, a connection reset, an HTTP 429, an HTTP 500, and a malformed body that is
valid JSON but missing the usage object. Every one of those is a required test case,
and building the failure injection now means the failure tests are cheap instead of
being the thing you skip at the end.

**Per-organization model configuration.** Deployment mode, endpoint, model name,
credential, request timeout, optional CA bundle. The credential is encrypted as designed
and decrypted only at the moment of the outbound call. Add a serialization boundary that
makes the plaintext structurally unable to reach a response body, and a log redactor that
drops the credential even if someone passes the whole config object to the logger. Then
write the test that asserts the credential appears in no API response and in no log line.

**SSRF protection.** As designed, with the time-of-check-to-time-of-use gap closed —
validating a hostname and then handing that hostname to an HTTP client lets DNS answer
differently the second time. Redirects are not followed to a target that would not have
passed validation on its own. The deployment-level allowlist and the private-endpoint
allowance for on-premises are configuration, not code changes. Test with a loopback
address, a link-local metadata address, a private range with the allowance both off and
on, and a hostname that resolves to a blocked address.

**The inference path.** Reserve, call, settle or release. The transaction boundaries are
the ones from the design brief — no database transaction stays open across the model
call. Bounded retries with backoff and jitter, and retries only on the errors that are
actually safe to retry, which means a 500 or a connection failure but not a response you
have already partially consumed. Every failure mode releases the reservation. Test each
one and assert the balance returns to exactly where it started.

**Correlation.** The correlation ID flows from the inbound request through the logs into
the outbound model request headers. Logs record token counts, latency, and outcome, and
by default do not record prompt or completion content. Make that a configuration flag
that defaults to off, not a code comment promising it.

**Readiness.** The model is a dependency of inference, not of the application. Readiness
must not check the customer model. Write the test where the model service is unreachable
and the member management and billing endpoints still serve normal responses — the brief
calls this out specifically, and the naive readiness probe that pings every dependency is
exactly what it is testing for.

**Rate limiting.** Per-organization and per-user, in Redis so it holds across replicas,
returning 429 with a `Retry-After`. An in-memory limiter would pass a single-instance
test and fail the multi-instance one.

**Connectivity test endpoint.** Administrator only. Verifies the configured endpoint
reachability and credential validity without charging credits and without returning the
credential or any part of it in the response.

Show me the failure-path test output with the balance assertions, then stop.
