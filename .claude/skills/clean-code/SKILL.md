---
name: clean-code
description: Review a diff for readability and simplification against this repo's explicit style rules in CLAUDE.md — redundant comments, oversized comment blocks, premature abstractions, speculative error handling, unclear naming, dead code — then apply the fixes. Use before committing, or whenever asked to clean up or simplify a change.
argument-hint: [scope]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Edit, Bash(npm run build:*, npm test:*)
---

# Clean code

CLAUDE.md states explicit rules against premature abstraction, speculative error handling, and
redundant comments, but nothing enforces them on a given diff — they get skipped under time
pressure the same way any unenforced rule does. This skill walks the diff against exactly those
rules and fixes what it finds, rather than only pointing at it.

## Procedure

1. **Determine scope.** Default to `git diff --cached` (staged changes). If the user names a
   commit range or file list instead, use that.

2. **Walk every changed file against this checklist** (each row is a CLAUDE.md rule, not a
   general style opinion):

   | Check                      | Flag when...                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Redundant comments         | A comment restates what the code already says (WHAT, not WHY). Keep only comments explaining a hidden constraint, invariant, or non-obvious workaround.                                                                                                                                                                                                                                                                                                                                        |
   | Oversized comments         | A single comment block longer than 4 lines — **report only, never auto-shorten on length alone.** Run against this repo, every hit was genuinely non-redundant WHY reasoning (race conditions, invariant cross-references); length is a signal worth surfacing, not proof the content is bad. Only pair a length flag with an actual edit when "Redundant comments" _also_ caught it — a long comment that's long because it explains something real gets reported for awareness, not touched. |
   | Premature abstraction      | A new helper, class, or interface used exactly once, or built for a hypothetical future case that isn't in this diff. Three similar lines beat an early abstraction.                                                                                                                                                                                                                                                                                                                           |
   | Speculative error handling | A `try/catch`, null check, or validation guarding a scenario that can't actually happen given the caller's guarantees (internal code, not a system boundary). Removing one is a whole-program judgment call, not a mechanical fix — see step 3.                                                                                                                                                                                                                                                |
   | Unclear naming             | An identifier whose purpose isn't obvious from its name alone, needing a comment or the surrounding code to explain it.                                                                                                                                                                                                                                                                                                                                                                        |
   | Dead code                  | Unused imports, exports, variables, or a half-finished branch left in from an earlier approach.                                                                                                                                                                                                                                                                                                                                                                                                |

3. **Apply the fixes directly** — this is a quality pass, not a bug hunt. Don't touch logic that
   isn't a readability/simplification issue, and don't restructure code beyond what each flagged
   row calls for. Two exceptions with extra requirements:
   - **Oversized comments**: never edited on length alone (see the row above) — report only.
   - **Speculative error handling**: before removing a guard, the report must quote the specific
     caller-side guarantee that makes it unreachable (e.g., a named FK's `onDelete` behavior or an
     explicit type invariant — not "this looks defensive"). No quotable guarantee means report it
     and leave the guard in place. After removing one, run `npm run build && npm test` — if either
     fails, revert the removal and report it as a finding instead of an applied fix.

4. **Report** a table — `File:line | Issue | Fix applied` — for everything changed, using
   "reported only" as the fix for anything step 3 didn't touch. If nothing was found for a given
   check, that's a result too; don't omit a clean check from the summary.

## What this is not

Not a bug hunt (use the global `/code-review` for correctness issues) and not a check against
this repo's layer/money conventions or NestJS patterns — those are `quality-gate` and
`nest-patterns`. This skill only touches the six rows above.
