---
name: clean-code
description: Review a diff for readability and simplification against this repo's explicit style rules in CLAUDE.md — redundant comments, oversized comment blocks, premature abstractions, speculative error handling, unclear naming, dead code — then apply the fixes. Use before committing, or whenever asked to clean up or simplify a change.
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

   | Check                      | Flag when...                                                                                                                                                         |
   | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Redundant comments         | A comment restates what the code already says (WHAT, not WHY). Keep only comments explaining a hidden constraint, invariant, or non-obvious workaround.              |
   | Oversized comments         | A single comment block longer than 4 lines. Condense to the essential WHY in 4 lines or fewer — cut supporting detail and examples before cutting the actual reason. |
   | Premature abstraction      | A new helper, class, or interface used exactly once, or built for a hypothetical future case that isn't in this diff. Three similar lines beat an early abstraction. |
   | Speculative error handling | A `try/catch`, null check, or validation guarding a scenario that can't actually happen given the caller's guarantees (internal code, not a system boundary).        |
   | Unclear naming             | An identifier whose purpose isn't obvious from its name alone, needing a comment or the surrounding code to explain it.                                              |
   | Dead code                  | Unused imports, exports, variables, or a half-finished branch left in from an earlier approach.                                                                      |

3. **Apply the fixes directly** — this is a quality pass, not a bug hunt. Don't touch logic that
   isn't a readability/simplification issue, and don't restructure code beyond what each flagged
   row calls for.

4. **Report** a table — `File:line | Issue | Fix applied` — for everything changed. If nothing
   was found for a given check, that's a result too; don't omit a clean check from the summary.

## What this is not

Not a bug hunt (use the global `/code-review` for correctness issues) and not a check against
this repo's layer/money conventions or NestJS patterns — those are `quality-gate` and
`nest-patterns`. This skill only touches the six rows above.
