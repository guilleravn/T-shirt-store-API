# AI Module - Write-Up

> Save as `docs/ai-module/writeup.md`. Short answers and links are enough.

**Repository / PR:** `T-shirt-store-API`, branch `develop` (PR opened after review, per this
repo's process — commits stay local until then).
**Starting commit:** `114acfd` (`Fix/code review (#13)`).
**Improvement:** Built `OrdersService.sweepExpiredPendingOrders`, a `@Cron(EVERY_5_MINUTES)`
scheduled job that cancels `PENDING` orders older than 30 minutes, restoring their stock. This
closes a gap `docs/rules/business-invariants.md` R5 already documented but that was never built:
an abandoned cart with a promo code applied blocked that code's redemption slot forever, since
promo usage is a live count that only excludes `CANCELLED` orders — nothing ever cancelled a
stale `PENDING` order. Know it works: `test/orders-expiry-sweep.e2e-spec.ts` reproduces the block
against the real database (two users, a `usageLimit: 1` promo code, one abandoned order),
confirms the second user is blocked before the sweep runs, then confirms the sweep frees the slot
and the second user succeeds — see commits `bcb3bca`/`9e47c2e`/`e524eb5`.

## Skills

| Skill (file link)                                              | Goal, inputs → steps → output                                                                                                                                                                                                                                                                                                                                                                                                     | Exact invocation |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`quality-gate`](../../.claude/skills/quality-gate/SKILL.md)   | Goal: verify a change actually builds/lints/tests clean and follows the repo's layer/money conventions, instead of trusting a visual diff read. Input: a diff scope (staged, a commit, or "whole repo"). Steps: run `build`/`lint`/`test`(/`test:e2e` on request) → check the diffed files against `coding-style.md`'s controller/DTO/service split and the integer-cents money rule → report. Output: a `Check                   | Status           | Notes` table plus a commit/no-commit verdict. | `/quality-gate` |
| [`docs-sync`](../../.claude/skills/docs-sync/SKILL.md)         | Goal: catch documentation that fell behind the code it describes. Input: a diff scope or a named module. Steps: map the changed module to its canonical docs (`openapi.yaml`, `business-invariants.md`, `architecture.md`, the ERD) via `coding-style.md`'s ownership table → compare each doc's claims to the actual implementation → apply the fix. Output: which docs changed and why, plus any drift left as a judgment call. | `/docs-sync`     |
| [`clean-code`](../../.claude/skills/clean-code/SKILL.md)       | Goal: enforce this repo's explicit `CLAUDE.md` style rules (no redundant comments, comments capped at 4 lines, no premature abstraction, no speculative error handling, clear naming, no dead code) on a diff instead of relying on memory of them. Input: a diff scope. Steps: walk every changed file against the 6-row checklist → apply fixes. Output: a `File:line \| Issue \| Fix applied` table.                           | `/clean-code`    |
| [`nest-patterns`](../../.claude/skills/nest-patterns/SKILL.md) | Goal: verify NestJS's own wiring (DI, decorators, guard order, module registration, no circular-dependency workarounds) independent of where business logic belongs. Input: a diff scope. Steps: walk every changed controller/provider/guard/module against the 6-row checklist → report. Output: a `File:line \| Check \| Status \| Fix` table plus a violation verdict.                                                        | `/nest-patterns` |

**Notes:** `quality-gate` and `docs-sync` are the two required for Part II (one runs executable
checks, per the assignment's requirement; the other is a distinct, non-executable-check purpose).
`clean-code` and `nest-patterns` were built as an extra pair, of different purposes from the
first two and from each other, and demonstrated the same way. All four follow the format of the
two pre-existing skills (`check-invariants`, `new-endpoint`): `name`+`description` frontmatter
only, a numbered `## Procedure`, and a `## What this is not` scope-out section. No new tooling
beyond what the repo already had, except `@nestjs/schedule@6.1.3` for the improvement itself
(pinned below latest — see Limitations). Rollback: the improvement is additive and reversible —
reverting commits `bcb3bca`/`9e47c2e`/`e524eb5` returns to the prior, documented-but-unbuilt state
with no data migration involved (no schema change).

## Project Results

**Before → after:** Manually, verifying a change this size means separately remembering to run
build/lint/test, remembering which docs a Sales-module change touches, remembering the repo's
comment-length/abstraction rules, and remembering NestJS wiring conventions — four separate mental
checklists, applied inconsistently under time pressure. `quality-gate` collapsed the first into
one command that always runs all four checks and never silently skips one. `docs-sync` did the
module→doc lookup mechanically and found two real docs already stale before this improvement even
started (a security invariant never documented, `architecture.md` claiming an already-built
refund job was "not built") — misses I would very plausibly have made by hand, since they weren't
in the file I was actively editing. Judgment calls that still needed a human: choosing the
30-minute TTL and 5-minute cron cadence (nothing in the docs specifies a value), and deciding
_not_ to auto-apply every finding from the full-branch audit (see `docs/ai-module/audit-findings.md`)
since most were real but out of scope for a single, small improvement.

**Evidence:**

- Full-branch audit (all 4 skills run in report-only mode against `develop`, not a single diff):
  [`docs/ai-module/audit-findings.md`](audit-findings.md) — 20 `docs-sync` findings, 24 oversized-
  comment findings plus 1 speculative-error-handling and 3 premature-abstraction findings from
  `clean-code`, zero `nest-patterns` violations, zero `quality-gate` convention violations.
- Before (red): build succeeds (test files aren't type-checked by `nest build`), but
  `npm run test:e2e` on `test/orders-expiry-sweep.e2e-spec.ts` fails —
  `TypeError: ordersService.sweepExpiredPendingOrders is not a function` — written and run before
  commit `bcb3bca` existed.
- After (green): same test, same command, passes — `Test Suites: 1 passed, Tests: 2 passed`.
  Full suite: `npm test` → 257/257 (254 pre-existing + 3 new unit tests in commit `bcb3bca`).
  `npm run test:e2e --runInBand` → 11/11 suites, 23/23 tests, all against the real Postgres/Redis
  from `npm run docker:up` — no mocks for the sweep's own logic; `CheckoutQueueService` is mocked
  in these test files only because it needs a real BullMQ/Redis connection it doesn't need for
  order-creation/cancellation logic, same as the pre-existing sibling e2e files.
- `quality-gate`'s convention check and `nest-patterns`' full checklist both ran clean against the
  final diff (`git diff --stat` — 2 files, 193 insertions/34 deletions in `orders.service.ts` plus
  the new test file) before commit.

**Limitations:**

- `npm run test:e2e` is flaky under this repo's default parallel Jest workers once an 11th e2e
  file (this one) is added — confirmed unrelated to the sweep's logic (10/10 pre-existing suites
  stay green with the sweep code present but the new test file excluded; all 11/11 pass under
  `--runInBand`). Root cause looks like local Postgres connection-pool contention under increased
  worker count, not a defect in this change — noted here rather than silently worked around.
- `@nestjs/schedule@12.x` (latest) ships ESM-only and breaks this repo's CommonJS Jest setup;
  pinned to `6.1.3` (last CJS release, still within its stated Nest 11 peer range) instead of
  investigating a wider ESM migration, which is out of scope for this improvement.
- The 30-minute TTL and 5-minute cron cadence are reasonable judgment calls, not values agreed
  with anyone — easy to move to an env var later if that's ever needed.
- Everything in `audit-findings.md` beyond what this improvement's two docs commits fixed is
  real but intentionally left unresolved (e.g. several `openapi.yaml` response-code mismatches,
  three duplicated constants, one unreachable `if` in `auth.service.ts`) — out of scope for a
  single, two-day improvement, flagged for a follow-up.
