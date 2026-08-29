# CraftifAI Assignment — Cursor Starting Kit

Prompts, rules, and a trap list for building the CraftifAI Full-Stack Platform Engineer
assignment in Cursor. No application code here — this is what you set up before writing
the first line.

## The one thing to get right about scope

The brief's own words, from section 5:

> A smaller implementation that satisfies these invariants will score higher than a
> larger implementation that only works on the happy path.

So the MVP is not "the smallest set of screens that demos." It is the credit ledger,
idempotency, tenant isolation, and multi-instance correctness — with just enough
surface area around them to exercise those paths. A polished admin dashboard sitting on
a balance update that races is a failing submission. A plain interface over a ledger
that holds under 200 concurrent clients is a strong one.

That inverts the usual MVP instinct, which is why it is worth being deliberate about it
before you start. The parts that feel like infrastructure here *are* the deliverable.

## Files

| Path | What it is |
| --- | --- |
| `docs/assignment.md` | The brief, transcribed from the PDF for `@`-referencing |
| `docs/known-traps.md` | 20 failure modes that pass manual tests and fail the grader |
| `prompts/00-start.md` | The starting prompt — design brief, no code |
| `prompts/01-foundation.md` | Schema, tenant isolation, auth, roles, audit |
| `prompts/02-credit-core.md` | Ledger, reservations, idempotency, webhooks, reconciliation |
| `prompts/03-model-gateway.md` | Mock model, encryption, SSRF, the inference path |
| `prompts/04-web-app.md` | Admin and member interfaces |
| `prompts/05-onprem.md` | Compose package, two replicas, offline, backup and restore |
| `prompts/06-load-test.md` | Load test and report |
| `prompts/07-docs-and-review.md` | Requirement audit, the five documents, clean-clone check |
| `rules/project.mdc` | Always-on rules for the assignment repo |

## Setup

1. Create the assignment repo and open it in Cursor.
2. Copy `docs/assignment.md` and `docs/known-traps.md` into `docs/` there.
3. Copy `rules/project.mdc` to `.cursor/rules/project.mdc`. It is injected into every
   request, so the invariants stop being something you re-type each session.
4. Run `prompts/00-start.md` in Plan mode. Review the design brief properly before
   letting anything be built on top of it.
5. Work through the phase prompts in order, one per session or close to it.

Windows note: run Docker through WSL2, and keep the repo inside the WSL filesystem
rather than `/mnt/c`. Bind-mounted Windows paths are slow enough for `node_modules` that
it will distort your load-test numbers.

## Two habits worth keeping from day one

**Keep an AI corrections log.** A running file of every time the assistant proposed
something wrong and you caught it — what it wrote, why it was wrong, what replaced it.
`AI_USAGE.md` is a required deliverable and needs at least two concrete examples. They
are trivial to collect as they happen and nearly impossible to reconstruct at the end,
and this is the one deliverable that visibly distinguishes supervising the tool from
transcribing it.

**Commit in real increments.** Section 8 says the history is graded and should not be a
single final dump. A history that shows the ledger being built, tested, found wrong, and
fixed is evidence of the process the brief is actually assessing.

## Before the technical discussion

You will be asked to explain and modify any part of this. The questions land in
predictable places, and each of them is a decision the starting prompt makes you write
down early rather than discover under questioning:

- Why the balance cannot go negative, at the level of the specific SQL statement.
- What your transaction boundaries are, and what happens to a request that dies between
  reserving and settling.
- Which database primitive decides the winner when two identical idempotency keys arrive
  at two replicas simultaneously.
- How a cross-tenant read is prevented, and why it returns not-found rather than
  forbidden.
- Where one PostgreSQL instance stops being enough, and how you know.

If you cannot answer one of these from memory, that part of the implementation is not
yet yours regardless of who typed it.
