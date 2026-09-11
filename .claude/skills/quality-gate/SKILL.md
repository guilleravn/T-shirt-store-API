---
name: quality-gate
description: Run build, lint, and tests, then check the diff against docs/conventions/coding-style.md's module/layer conventions and the money-as-integer-cents rule, reporting PASS/FAIL per check. Use before committing a slice, or whenever asked to verify a change is clean and ready to commit.
---

# Quality gate

Whether a change actually builds, lints clean, and passes its tests gets checked inconsistently
when it's done ad hoc — a quick look at the diff isn't the same as running the commands, and
"looks fine" isn't a substitute for `npm test` actually exiting 0. This skill always runs the
real checks and always reports all of them, not just the one that seemed relevant.

## Procedure

1. **Determine scope.** Default to `git diff --cached` (staged changes). If the user names a
   commit range or branch instead, use that for step 3; the executable checks in step 2 always
   run against the whole repo regardless of scope.

2. **Run the executable checks, in order, and capture the result of each:**

   | Command            | Reports                                                                                                                       |
   | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
   | `npm run build`    | TypeScript compiles                                                                                                           |
   | `npm run lint`     | ESLint clean                                                                                                                  |
   | `npm test`         | Unit test suite passes                                                                                                        |
   | `npm run test:e2e` | E2e suite passes — **ask before running**, it needs Postgres/Redis up (`npm run docker:up`); don't assume the DB is available |

   For any FAIL, condense the actual error output (file:line + message) rather than pasting the
   full log.

3. **Check the diffed files against `docs/conventions/coding-style.md`:**
   - Controller methods: route wiring only — no business conditionals, no direct Prisma calls.
   - DTOs: validation/shape only — no logic beyond that.
   - Services: business logic and transactions live here, not in controllers.
   - Every monetary field or value: `@IsInt()` in DTOs, integer cents in services/responses —
     never `@IsNumber()`, `Decimal`, or a float.

   Report each violation found with its file:line. No violations found is also a result — say so
   explicitly.

4. **Report a consolidated table** — `Check | Status | Notes` — covering all four executable
   checks (or three plus "e2e skipped" if declined) and the convention check, followed by one
   line: is this clean to commit, yes or no. If no, name the exact fix, don't just flag the
   problem.

## What this is not

Not `check-invariants` (business-rule correctness against R1-R8) and not a full code review —
this only verifies build/lint/test health plus the mechanical layer and money conventions. Run
`check-invariants` alongside it for anything touching orders, payments, stock, or promo codes.
