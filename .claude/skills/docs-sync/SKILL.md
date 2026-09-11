---
name: docs-sync
description: Compare a changed feature or module against its documentation (openapi.yaml, docs/reference/*, docs/rules/business-invariants.md, docs/architecture.md, docs/reference/erd/T-Shirt.dbml) and update the affected sections. Use after implementing a feature or fix, before committing, to catch documentation drift.
---

# Docs sync

A feature done in code but not reflected in `openapi.yaml`, the ERD, or the architecture docs is
unfinished work, not follow-up work — but nothing forces a developer to reopen every doc a change
might touch. This skill makes that comparison explicit and applies the fix instead of just
flagging it.

## Procedure

1. **Determine the changed scope.** Default to `git diff --cached` (staged changes), or a named
   feature/module if the user points at one directly.

2. **Map the touched code to its canonical docs**, using the module-ownership table in
   `docs/conventions/coding-style.md`:

   | Module             | Canonical docs to check                                                                                                                      |
   | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | `AuthModule`       | `openapi.yaml` (`/auth/*`), `docs/rules/business-invariants.md` security section                                                             |
   | `CatalogModule`    | `openapi.yaml` (`/products`, `/categories`, `/colors`, `/sizes`), `docs/reference/data-model.md`                                             |
   | `EngagementModule` | `openapi.yaml` (`/cart*`, `/products/{id}/like`)                                                                                             |
   | `SalesModule`      | `openapi.yaml` (`/orders*`, `/checkout*`, `/webhooks/stripe`), `docs/rules/business-invariants.md` R1/R2/R3/R4/R7/R8, `docs/architecture.md` |
   | `PromoModule`      | `openapi.yaml` (`/promo-codes*`), `docs/rules/business-invariants.md` R5/R6                                                                  |

   Any `prisma/schema.prisma` change, regardless of module, also maps to
   `docs/reference/erd/T-Shirt.dbml` and `docs/reference/data-model.md`.

3. **For each canonical doc in scope, compare its current text to the implementation:**
   - New or changed endpoint → the DTO's request/response shape must match `openapi.yaml`'s
     schema exactly (required/optional fields, types, status codes).
   - Schema change → `docs/reference/erd/T-Shirt.dbml` must reflect it in the same slice (this is
     a hard rule in `CLAUDE.md` — a drifted ERD makes `business-invariants.md` unverifiable).
   - A capability described as "planned," "decided but not built," or similar in
     `docs/architecture.md` or `docs/rules/business-invariants.md` that the diff now implements →
     update that status to reflect it's built, and say where.

4. **Apply the doc edits directly** rather than just listing them, then report: which docs
   changed (one-line summary of what changed per file), and any difference that needs a human
   judgment call instead of an automatic edit — state exactly what's undecided and why it can't be
   resolved mechanically.

## What this is not

Not a general documentation writer — it reconciles docs against a specific code change that
already exists, it doesn't invent new documentation sections or restructure docs that aren't
affected by the diff.
