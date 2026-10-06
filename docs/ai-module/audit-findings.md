# Whole-branch skill audit — findings

> Supporting evidence for `docs/ai-module/writeup.md`. Produced by running all 4 custom skills
> (`quality-gate`, `docs-sync`, `clean-code`, `nest-patterns`) across the entire `develop` branch
> (not a single commit's diff) in **report-only mode** — no fixes were applied by this pass. Real,
> already-known issues are marked as such; everything else is a new finding from this audit.

## `quality-gate`

**Executable checks** (whole-repo): `npm run build` — pass. `npm run lint` — clean. `npm test` —
263/263 passing, 22/22 suites (254 at the time of this whole-branch audit; grew to 263 as the
sweep's bug fixes added their own unit tests). Re-run for real, in a fresh session with no prior
conversation context, at this branch's head — see `writeup.md`'s Evidence section for the actual
command output and exit codes, and the `test:e2e` result (a real, now-fixed test-isolation bug it
caught along the way).

**Convention check** (layer/money rules from `docs/conventions/coding-style.md`, all 12
controllers / 57 DTOs / 18 services): no real violations. Two things checked and explicitly
cleared, not missed:

- `src/sales/stripe-webhook.controller.ts`'s `if (!req.rawBody) throw BadRequestException(...)` —
  an HTTP/infra precondition (raw body needed for Stripe signature verification), not a business
  conditional in a controller.
- The low-stock threshold (`3`) is defined independently in three places (see `clean-code` below)
  — not a layer violation, but flagged for the same reason `clean-code` flags it.

## `docs-sync`

Twenty items tracked below (`#1`-`#20`) across the 5 modules plus the schema/ERD pair,
`openapi.yaml`, and `docs/architecture.md`. Three are already fixed (marked below); the
remaining seventeen are new findings from this audit, left unfixed pending a decision (see
writeup Limitations).

### Already fixed this session

| #   | Doc                                                     | Issue                                                                                                  |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | `docs/rules/business-invariants.md` security invariants | Missing bullets for refresh-token expiry and signup/signin rate limiting — added earlier this session. |

### Confirmed and relevant to the improvement (fixed as part of it — see writeup)

| #   | Doc                                             | Issue                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `docs/rules/business-invariants.md` R5, line 75 | States "a job cancels expired PENDING orders" as present-tense fact — no such job exists. Contradicted by `architecture.md`'s own "still only decided, not built" line for the same job. This is the exact gap the improvement (Phase below) closes.                                |
| 3   | `docs/architecture.md`                          | Refund-on-cancellation job is listed as "still only decided, not built," but it's actually implemented (`OrdersService.cancel()` → `CheckoutQueueService.enqueueRefund` → `CheckoutProcessor`). Unrelated to the improvement but same section — worth fixing in the same docs pass. |

### New findings, left unresolved (judgment calls / out of this improvement's scope)

| #   | Doc                            | Section                                                                                              | Issue                                                                                                                                                                                                                                      |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4   | `business-invariants.md` R5    | first sentence                                                                                       | Says the row lock is `WHERE id = $1`; code actually locks `WHERE code = $1` (`src/sales/promo-redemption.util.ts:34-39`). Wording drift, not a behavior bug.                                                                               |
| 5   | `openapi.yaml`                 | `/promo-codes/validate` `discountType`                                                               | Not marked `nullable`, but the service returns `null` for a not-found code.                                                                                                                                                                |
| 6   | `openapi.yaml`                 | `/auth/signout`                                                                                      | Only documents `204/400/401`; code can also return `403` (missing `refreshToken` without `all:true`) and `404` (stale/foreign/revoked token).                                                                                              |
| 7   | `openapi.yaml`                 | 7 cart/like routes                                                                                   | None document `403`, even though `RolesGuard` throws it for any non-CLIENT role — every other role-gated route in the file does document it.                                                                                               |
| 8   | `openapi.yaml`                 | `Variant` schema description                                                                         | Says "Only visible to MANAGER," but the same schema is reused as `CartItem.variant` and returned to CLIENT users.                                                                                                                          |
| 9   | `docs/reference/data-model.md` | hand-added constraints list                                                                          | Omits the `one_pending_order_per_user` partial unique index (a real, applied migration) from its list of Prisma-can't-generate-this constraints.                                                                                           |
| 10  | `docs/reference/data-model.md` | money-integrity CHECK count                                                                          | Says "4" CHECKs across orders/order_items/cart_items/payments; actual count is 7.                                                                                                                                                          |
| 11  | `openapi.yaml`                 | `/products/{id}/images` POST, `/checkout/payment-intent`, `/checkout/payment-link`                   | All document a `503` for an external-dependency outage (S3, Stripe); no code path anywhere ever throws `ServiceUnavailableException` — an outage surfaces as a plain `500`.                                                                |
| 12  | `openapi.yaml`                 | `PATCH /products/{id}/active`, `PATCH .../variants/{id}/active`, `DELETE /products/{id}/images/{id}` | All document `409 Conflict`; none of the three service methods have any path that can produce one.                                                                                                                                         |
| 13  | `openapi.yaml`                 | `PUT /products/{id}/images/order`                                                                    | Documents `404` for a missing product; the code never checks the product exists, so a bad `productId` actually 400s (empty-images vs non-empty-imageIds mismatch), not 404s.                                                               |
| 14  | `openapi.yaml`                 | `GET /products/{id}/variants`                                                                        | Missing `400` for query-validation failures (the sibling `GET /products` documents it for the same class of error).                                                                                                                        |
| 15  | `openapi.yaml`                 | `ProductCard.primaryImage`                                                                           | Not nullable; a product with zero images legitimately returns `null`.                                                                                                                                                                      |
| 16  | `openapi.yaml`                 | `PUT /products/{id}/images/order` `imageIds`                                                         | Missing `minItems: 1`; the DTO requires `@ArrayMinSize(1)`.                                                                                                                                                                                |
| 17  | `openapi.yaml`                 | `PATCH /products/{id}/images/{id}` `altText`                                                         | Not nullable, but sending `null` is accepted and clears the field (undocumented capability).                                                                                                                                               |
| 18  | `openapi.yaml`                 | `GET /products` `category` param                                                                     | No description that this filters by slug, not name or ID.                                                                                                                                                                                  |
| 19  | `openapi.yaml`                 | `/orders`, `/checkout/payment-link` `promoCode`; `/orders/{id}/cancel` `reason`                      | Missing `maxLength` (40 and 255 respectively) that the DTOs actually enforce.                                                                                                                                                              |
| 20  | `openapi.yaml`                 | `/orders`, `/checkout/payment-intent`, `/checkout/payment-link`                                      | Document `429`/`Idempotency-Key` as enforced; no `ThrottlerGuard` is applied to any Sales route. Pre-existing, already acknowledged in a code comment (`src/app.module.ts:27-30`) — not silent drift, but a real doc/code gap nonetheless. |

### Areas checked with no drift

Full `prisma/schema.prisma` ↔ `docs/reference/erd/T-Shirt.dbml` comparison (all 20 models, 5
enums, every FK/`onDelete`, every hand-added CHECK/partial-index from `T-Shirt-constraints.sql`)
— clean. All of R1, R2, R3, R4, R7, R8's described mechanisms verified intact in code. Orders
CRUD, checkout, categories/colors/sizes, products/variants CRUD (aside from the rows above),
CASL abilities, and the "What to monitor" table all match.

## `clean-code`

Six-point checklist applied to every file in `src/` (auth, catalog, engagement, sales, promo,
common, email, prisma, root). This codebase already went through one review pass (`114acfd`), so
the yield is concentrated in one check.

**Oversized comments (>4 lines)** — 23 instances (re-verified in a fresh session on
`fix/expiry-sweep-review-findings`'s head, after the sweep fixes landed — line numbers below are
current, not the pre-fix snapshot). Every one is valid, non-redundant WHY reasoning (race
conditions, invariant cross-references) — flagged purely on length, not content quality, which is
exactly why `clean-code` now reports this check instead of auto-editing it (see the skill's own
fix history). Exact ranges:

| #   | File:line                                          | Length | Topic                                                                |
| --- | -------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| 1   | `src/auth/auth.service.ts:104-108`                 | 5      | reused-refresh-token theft-response note                             |
| 2   | `src/auth/auth.service.ts:180-185`                 | 6      | `pg_advisory_xact_lock` rationale in `forgotPassword`                |
| 3   | `src/auth/guards/roles.guard.ts:11-15`             | 5      | CASL-vs-plain-role-check note                                        |
| 4   | `src/auth/utils/token.util.ts:3-7`                 | 5      | sha256-vs-bcrypt rationale                                           |
| 5   | `src/engagement/cart.service.ts:74-79`             | 6      | atomic upsert rationale in `addItem`                                 |
| 6   | `src/sales/orders.service.ts:204-209`              | 6      | partial unique index race note in `create()`'s catch                 |
| 7   | `src/sales/orders.service.ts:366-371`              | 6      | conditional UPDATE race note in `updateStatus`                       |
| 8   | `src/sales/checkout.service.ts:106-113`            | 8      | `SELECT ... FOR UPDATE` re-verify rationale in `createPaymentIntent` |
| 9   | `src/sales/checkout.service.ts:236-240`            | 5      | no-payments-row-yet note before `createPaymentLink`'s Stripe call    |
| 10  | `src/sales/promo-redemption.util.ts:23-28`         | 6      | file-level rationale above `lockAndValidatePromoCode`                |
| 11  | `src/sales/purchasability.util.ts:14-19`           | 6      | duplication-from-`CartService` rationale                             |
| 12  | `src/sales/stripe-webhook.controller.ts:14-18`     | 5      | no-guards/no-DTO rationale                                           |
| 13  | `src/sales/stripe-webhook.service.ts:37-44`        | 8      | R4 idempotency-claim rationale above `handleEvent`'s transaction     |
| 14  | `src/sales/stripe-webhook.service.ts:131-135`      | 5      | orphaned-PaymentIntent P2025 handling note                           |
| 15  | `src/sales/stripe-webhook.service.ts:175-180`      | 6      | `handleChargeRefunded` doc comment                                   |
| 16  | `src/sales/stripe-webhook.service.ts:212-221`      | 10     | dual-event race rationale in `finalizeSuccessfulPayment`             |
| 17  | `src/sales/stripe-webhook.service.spec.ts:322-326` | 5      | comment inside the dual-event race test                              |
| 18  | `src/sales/stripe/stripe.service.ts:21-25`         | 5      | Checkout-Session-vs-Payment-Link rationale                           |
| 19  | `src/sales/stripe/stripe.service.ts:82-89`         | 8      | `refundPayment` doc comment                                          |
| 20  | `src/sales/queue/checkout.processor.ts:43-48`      | 6      | refund-status handling rationale                                     |
| 21  | `src/catalog/dto/list-products-query.dto.ts:13-17` | 5      | `toBoolean()` rationale                                              |
| 22  | `src/catalog/dto/list-variants-query.dto.ts:4-8`   | 5      | `toBoolean()` rationale                                              |
| 23  | `src/catalog/product-images.service.ts:154-158`    | 5      | DB-before-S3-delete ordering rationale in `remove()`                 |

`src/common/prisma-error.util.ts` has zero — its only long comment is a JSDoc `/** */` block,
which this check doesn't count (single `//`-line comments only). The count moved from an earlier,
less precise 24-by-filename tally to this exact 23-by-line-range list specifically because a
prior pass of this document listed hits by filename+count instead of `File:line`, which this
skill's own report format requires — re-extracted properly here.

**Speculative error handling** — 1 instance: `src/auth/auth.service.ts:136-139`, an
`if (!user) throw UnauthorizedException` inside the refresh transaction that's unreachable —
`RefreshToken.user` has `onDelete: Cascade`, so if the user didn't exist the preceding conditional
`updateMany` (which already succeeded) would have matched 0 rows first.

**Premature abstraction** — 3 instances, all used exactly once: `cart.service.ts`'s
`VARIANT_WITH_COLOR_SIZE_PRODUCT` constant and `PurchasableVariant` interface;
`products.service.ts`'s `PRODUCT_INCLUDE` constant.

**Dead code** — the default Nest-scaffold `AppController`/`AppService` ("Hello World!") and its
spec file were never adapted to the product; `GET /v1` isn't part of `openapi.yaml`'s contract.

**Duplication** (flagged as a bonus finding, outside the skill's 6-row checklist by design — see
`review-response.md` for why a 7th row wasn't added):

- `toBoolean()` helper + its comment, duplicated verbatim in `list-products-query.dto.ts` and
  `list-variants-query.dto.ts` (already known from the `114acfd` review).
- `PasswordResetJobData`/`PasswordChangedJobData` interfaces duplicated between
  `email-queue.service.ts` and `email.processor.ts` instead of shared.
- The low-stock threshold (`3`) defined independently three times:
  `product-variants.service.ts`'s `LOW_STOCK_THRESHOLD`, `public-variant-response.dto.ts`'s own
  `LOW_STOCK_THRESHOLD`, and a bare `<= 3` literal in `adjust-stock-response.dto.ts`.

## `nest-patterns`

All 6 checks applied to every controller (12), provider (~28), guard (3), and module (8) in
`src/`. **No violations.** Two non-violation design notes worth recording:

- `SalesModule` doesn't re-import `PrismaModule` in its `imports` (every other feature module
  does) — harmless since `PrismaModule` is `@Global()`, but stylistically inconsistent.
- `src/sales/promo-redemption.util.ts` reads/writes `promo_codes`/`promo_redemptions` (owned by
  `PromoModule`) directly via the shared `PrismaService`, rather than through an exported
  `PromoModule` service. Not a mechanical Nest-wiring bug (no file is imported across module
  boundaries), and the code comments justify it — R5 requires the row lock and the redemption
  insert to share one transaction with the order write, which a cross-module service call
  couldn't guarantee — but it is the one place a module operates on another module's owned
  tables.

## What this feeds into

- Findings #2 (R5's stale "a job exists" claim) is exactly what the improvement below builds and
  then makes true.
- Finding #3 (refund job's stale "not built" status) gets fixed in the same `docs-sync` pass as
  the improvement, since it's the same file/section.
- Everything else in this document is left as-is by choice (see the plan discussion) — real,
  but out of scope for a two-day, single-improvement assignment. Listed here as the "what the
  skills found" evidence the write-up needs.
