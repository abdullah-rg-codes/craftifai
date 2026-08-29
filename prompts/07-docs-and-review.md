# Phase 7 — Documentation and adversarial review (Agent mode)

Stop after each numbered item and let me review.

---

**1. Requirement audit.** Go through `@docs/assignment.md` section by section. Every
requirement in section 4, every acceptance criterion in section 5, every test in
section 6, and every deliverable in section 8. For each: implemented, partial, or
missing, with the file and line that satisfies it.

Be adversarial about this. Do not credit a requirement because a function exists with a
plausible name — credit it because you traced the path. The expensive failure is a
requirement I believe is done, so if you are not certain, mark it partial. Report only,
fix nothing yet.

**2. Close the gaps.** Work through partial and missing, smallest first.

**3. Documentation.** Write these as engineering documents for a reader who will
interrogate them, not as summaries of what was built.

- `README.md` — clean-clone setup, run, test, load-test, and demo instructions.
  Verify them by following them yourself against a fresh clone, because these
  instructions are the first thing the grader runs and the first impression is binary.
- `ARCHITECTURE.md` — components, data flow, the consistency model, failure handling,
  and the path to one million users. The scaling section must quantify: where the first
  bottleneck appears, at what load, and what the specific next move is. Name the point
  at which one PostgreSQL instance stops being enough and say how you know. Explain how
  SaaS and on-premises scaling differ, and how multi-region would work without
  corrupting balances — the honest answer there involves the consistency trade-off, not
  a claim that it just works.
- `SECURITY.md` — threat model, tenant isolation strategy, secret handling, webhook
  security, SSRF. Include what you did not defend against and why that was a reasonable
  scope decision.
- `OPERATIONS.md` — health checks, metrics, backup, restore, upgrade, rollback, and
  incident procedures. Include a runbook for the two failure modes most likely to happen
  at 3am: reconciliation falling behind, and the customer model being down.
- `openapi.yaml` — the actual contract, matching what the code serves.
- Decision records — at least three, from the design brief, with the rejected
  alternatives intact.
- Architecture diagram — SaaS and on-premises views. Mermaid in the repo is fine.

**4. `AI_USAGE.md`.** Tools used, which areas were substantially AI-generated, how I
validated them, and at least two concrete examples where you proposed something
incorrect, incomplete, insecure, or unsuitable and I caught it. Pull these from our
actual session history — specific code, specific problem, how it was detected, what
replaced it. Invented examples will read as invented, and this file is the one place the
brief is explicitly asking whether I was supervising you or transcribing you.

**5. Secret sweep.** Scan the entire git history, not just the working tree, for
credentials, keys, tokens, and connection strings. Check `.env.example` holds only
placeholders, and check that no test fixture contains a real-looking secret. A key
committed in an early commit and deleted later is still in the history and is still a
finding.

**6. Clean-clone verification.** Clone to a fresh directory, follow the README exactly
as written, and report every place reality diverged from the instructions. Then fix the
README.

**7. Honest assessment.** Where is this submission weakest? What would a skeptical
reviewer attack first? Which parts would I struggle to defend in a technical discussion?

That last question is the one I actually want answered. Anything on that list is
something I need to sit down and understand before the interview, and I would rather
find it from you now than discover it live.
