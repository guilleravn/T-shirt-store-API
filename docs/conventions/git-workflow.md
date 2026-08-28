# Git workflow

> Goes stale if the slice boundaries stop matching the module table in
> [`coding-style.md`](coding-style.md), or if this session's plan-mode tooling changes.

## Plan first

Anything beyond a trivial fix (typo, one-line config change) starts in Claude Code's plan mode
(`EnterPlanMode` / `ExitPlanMode`) — **not** a plan file committed to the repo. No source file is
edited while the plan is still in draft: plan mode blocks writes until the plan is presented and
approved.

A plan needs, at minimum:

- The goal, in one or two sentences.
- Which module(s) it touches (from the table in `coding-style.md`).
- Whether it needs a migration, and what changes in `docs/reference/erd/T-Shirt.dbml` if so
  (see the CLAUDE.md rule on schema/ERD drift).
- The slices it breaks into, in commit order.
- Open questions, if any — same standard as the rest of these docs: an explicit
  `> **OPEN:**` beats a silent assumption.

## Slices

A slice is the smallest unit that's independently reviewable and leaves the repo in a working
state. For this project, a slice is one of:

| Slice | Contains |
|---|---|
| Schema + migration | `schema.prisma` model changes, the generated migration, hand-added constraints from `T-Shirt-constraints.sql` |
| Service + unit test | Business logic for one operation, its unit test(s) — never one without the other |
| Controller + DTO + e2e | The HTTP surface for one operation, its request/response DTOs, an e2e test if the operation is one of the three critical paths (see `testing.md`) |

A feature is usually 2–3 slices across these categories, each its own commit.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), scope = the domain module from
`coding-style.md`'s table (lowercased): `feat(catalog): add variant stock adjustment endpoint`,
`fix(sales): correct oversell handling in webhook`, `docs(rules): add promo redemption invariant`.

Commit per slice, not one commit at the end — a slice that fails review is one commit to revert
or amend, not a search through an unrelated diff.

A feature is not done until the docs it affects are updated, in the same set of slices — a new
endpoint without its `openapi.yaml` entry, or a new invariant without a `business-invariants.md`
entry, is unfinished work, not follow-up work.

## Never push

Commits stay local. The developer reviews and pushes. This holds regardless of how confident a
commit looks — no exception for "just docs" or "just a typo fix".
