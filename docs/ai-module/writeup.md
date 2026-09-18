# AI Module - Write-Up

> Save as `docs/ai-module/writeup.md`. Short answers and links are enough.

**Repository / PR:** `T-shirt-store-API`. Improvement built on `develop`; a PR review of that work
(PR #15 at commit `4866457`) found real bugs and process gaps, fixed on
`fix/expiry-sweep-review-findings` — see [`review-response.md`](review-response.md) for the
point-by-point response. Commits stay local until review, per this repo's process.
**Starting commit:** `114acfd` (`Fix/code review (#13)`).
**Improvement:** Built `OrdersService.sweepExpiredPendingOrders`, a `@Cron(EVERY_5_MINUTES)`
scheduled job that cancels `PENDING` orders older than 30 minutes with no live payment attempt.
This closes a gap `docs/rules/business-invariants.md` R5 already documented but that was never
built:
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
  [`docs/ai-module/audit-findings.md`](audit-findings.md) — 20 `docs-sync` findings, 23 oversized-
  comment findings (exact `File:line`s) plus 1 speculative-error-handling and 3
  premature-abstraction findings from `clean-code`, zero `nest-patterns` violations, zero
  `quality-gate` convention violations.
- Before (red): build succeeds (test files aren't type-checked by `nest build`), but
  `npm run test:e2e` on `test/orders-expiry-sweep.e2e-spec.ts` fails —
  `TypeError: ordersService.sweepExpiredPendingOrders is not a function` — written and run before
  commit `bcb3bca` existed.
- After (green): same test, same command, passes.
- **Real `quality-gate` run, fresh session, this branch's head** (dispatched to a Claude Code
  agent with zero prior conversation context, satisfying the assignment's "run each skill in a
  fresh session" requirement — full request/response in the session transcript, condensed here):

  | Check              | Status           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `npm run build`    | PASS             | `nest build` completes with no errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | `npm run lint`     | PASS             | no issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | `npm test`         | PASS             | 22 suites / 263 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | `npm run test:e2e` | FAIL, then fixed | Found a real, reproducible bug: `orders-expiry-sweep.e2e-spec.ts` and `orders.e2e-spec.ts` both hardcoded `Size.position: 9100` (a globally-unique column) — colliding whenever Jest's default parallel workers ran them together. Fixed in commit `575bfb6` (this e2e file now takes the next unused literal, `9800`, matching the staggered-numbering convention every sibling e2e file already uses). Re-verified twice after the fix: `npm run test:e2e` → 11/11 suites, 24/24 tests, clean under Jest's **default parallel** workers — no `--runInBand` needed. |

  The agent also tried `/docs-sync` in the same fresh session: it correctly refused
  (`disable-model-invocation: true` blocks Skill-tool invocation entirely, by design — see
  `review-response.md`), which is itself evidence the frontmatter hardening works as intended.

- `quality-gate`'s convention check and `nest-patterns`' full checklist both ran clean against the
  sweep's own diff before each commit (see commits `054f855` through `575bfb6`).

**Limitations:**

- `@nestjs/schedule@12.x` (latest) ships ESM-only and breaks this repo's CommonJS Jest setup;
  pinned to `6.1.3` (last CJS release, still within its stated Nest 11 peer range) instead of
  investigating a wider ESM migration, which is out of scope for this improvement.
- The 30-minute TTL and 5-minute cron cadence are reasonable judgment calls, not values agreed
  with anyone — easy to move to an env var later if that's ever needed.
- Everything in `audit-findings.md` beyond what this improvement's docs commits fixed is real
  but intentionally left unresolved (e.g. several `openapi.yaml` response-code mismatches, three
  duplicated constants) — out of scope for a single, two-day improvement, flagged for follow-up.
- One review suggestion was deliberately not implemented (narrowing or folding `nest-patterns`),
  and one attempted fix (`paths:` frontmatter on `nest-patterns`) was reverted after live testing
  showed it broke the skill entirely rather than improving it — both explained in
  [`review-response.md`](review-response.md).
