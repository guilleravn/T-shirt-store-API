---
name: new-endpoint
description: Generate the full vertical slice for one endpoint from openapi.yaml / docs/reference/api-contracts.md — DTO, service, thin controller, guard, unit test, e2e test — following the module boundaries in docs/conventions/coding-style.md and the slice/commit structure in docs/conventions/git-workflow.md. Use whenever asked to implement, add, or build a specific endpoint or route, rather than building the file layout ad hoc each time.
---

# New endpoint

Every endpoint touches the same ~5 files in the same shape. Built ad hoc each time, that shape
drifts — a controller picks up a stray conditional, a DTO validates a money field as
`@IsNumber()` instead of `@IsInt()`, a unit test gets skipped "just this once." This skill is
the procedure that keeps it from drifting.

## Procedure

1. **Find the endpoint in `openapi.yaml`.** Method, path, path/query params, request schema,
   response schema per status code, and the `security` requirement (which role(s), or `security:
[]` for public). This is the exact contract — do not infer the shape from the feature
   description instead.

2. **Identify the owning module** from the table in `docs/conventions/coding-style.md`, by which
   ERD table group the endpoint's resource belongs to (Auth / Catalog / Engagement / Sales /
   Promo).

3. **Check `docs/rules/business-invariants.md`** for any rule governing this endpoint's write
   path (checkout and order-status endpoints are the common case — R2, R3, R5, R7, R8 all live
   here). If one applies, the service method has to implement the actual mechanism the rule
   requires (e.g. the conditional `UPDATE` for R3), not just a CRUD shape that happens to look
   similar.

4. **Generate, in this order** (this is 2-3 separate commits per `git-workflow.md`'s slice
   table — say so when done, don't present it as one unit):

   | Piece                 | Rule                                                                                                                                                                             |
   | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Request/response DTOs | `class-validator` decorators matching the OpenAPI schema exactly — same required/optional, same `min`/`max`, same `format`. Every money field is `@IsInt()`, never `@IsNumber()` |
   | Service method        | The actual logic, on the module's existing service (or a new one if none owns this resource yet). Wrapped in `$transaction` if a business invariant requires atomicity here      |
   | Controller method     | Route decorator, calls exactly one service method, returns its result. No conditionals, no direct Prisma calls                                                                   |
   | Guard                 | Role/ability check matching the endpoint's `security` requirement                                                                                                                |
   | Unit test             | Mandatory, on the service method, per `docs/conventions/testing.md`                                                                                                              |
   | E2e test              | Only if this endpoint is part of one of the three critical paths (auth, checkout, order history) — otherwise skip it here and say so, don't add one out of caution               |

5. **Cross-check the finished DTOs and response shape against `openapi.yaml` once more** before
   calling it done — the most common drift is a field renamed or a status code added during
   implementation that never made it back into the contract.

## What this is not

Not a scaffolding tool for a module that doesn't exist yet — if no service/controller exists for
this resource, this skill still applies, it just means step 4 creates those files instead of
extending them.
