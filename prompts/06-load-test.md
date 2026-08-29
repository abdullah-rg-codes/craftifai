# Phase 6 — Load test and report (Agent mode)

---

Build the repeatable load test from section 7 of the brief.

**Scenario.** Against the two-replica Compose stack: 200 or more concurrent clients, a
mix of member and usage queries alongside concurrent inference requests, model latency
between 50 and 250 ms, and a response mix including successes, timeouts, 429s, and 500s.
One organization deliberately runs out of credits mid-test while requests are still
arriving.

The credit exhaustion scenario is the one that matters. Anyone can drive requests per
second; the question the brief is asking is whether the balance survives being driven to
zero by 200 clients at once.

**Verification, run as part of the test rather than eyeballed afterwards.** After the run:
no balance is negative at any point, the sum of ledger entries equals each final balance,
no reservation is left dangling once reconciliation has run, and the count of successful
inferences matches the count of settlements exactly. Assert these in the harness so a
regression fails the run instead of requiring someone to notice.

Sample the balance during the run too, not only at the end. A balance that dips negative
and gets corrected is still a bug, and an end-state-only check cannot see it.

**Report.** Test environment, duration, request rate, p50, p95, p99, error rate broken
down by category, database CPU and connection usage, the evidence that no balance went
negative, the bottlenecks you found, and the next three improvements you would make.

Report what you measure. If p95 exceeds the 150 ms control-plane target from the brief,
say so and explain what is causing it. A slower honest number with a correct diagnosis is
worth more here than a fast number, because the follow-up conversation will be about the
bottleneck either way and I need to be able to talk about it.

If the test reveals a correctness bug, stop and tell me before fixing it. That bug is the
most interesting thing that will happen in this build, and it is going in `AI_USAGE.md`.
