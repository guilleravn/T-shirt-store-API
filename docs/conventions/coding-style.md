# Coding style

> This file covers what the linter does **not**. ESLint and Prettier already enforce
> formatting, unused vars, `no-floating-promises`, etc. — see `eslint.config.mjs`. Don't repeat
> those here.
>
> Goes stale if the module boundaries stop matching the domain areas in
> [`business-invariants.md`](../rules/business-invariants.md), or if CASL is actually installed
> (the current-state note below would then be wrong).

## Module structure

One Nest module per domain area, mirroring the ERD's `TableGroup`s rather than one module per
table:

| Nest module | Tables it owns |
|---|---|
| `AuthModule` | `users`, `refresh_tokens`, `password_reset_tokens` |
| `CatalogModule` | `categories`, `products`, `product_categories`, `product_images`, `colors`, `sizes`, `product_variants` |
| `EngagementModule` | `product_likes`, `carts`, `cart_items` |
| `SalesModule` | `orders`, `order_items`, `order_status_history`, `payments`, `stripe_events`, checkout, webhooks |
| `PromoModule` | `promo_codes`, `promo_redemptions` |

`CatalogModule` is one module, not five — products, variants, images, categories, colors and
sizes are read and written together and share the same MANAGER-only write path.

## Dividing line: controller / DTO / guard / service

The most frequent question, settled once:

| Layer | Owns | Never contains |
|---|---|---|
| **Controller** | Route wiring, param/query decorators, calling one service method, HTTP status/headers | Business conditionals, direct Prisma calls |
| **DTO** | Request/response shape, `class-validator` rules | Logic beyond validation/transformation |
| **Guard** | Authentication, role/ability checks (CASL) — rejects the request before the handler runs | Rules about *this specific resource's state* (e.g. "can this particular order still be cancelled" is a service decision, not a guard's) |
| **Service** | All business logic, transactions, Prisma calls | HTTP concerns — status codes, headers, `Request`/`Response` objects |

Concrete violation: `if (order.status === 'SHIPPED') throw ...` written inside a controller
method violates the controller row above — that check belongs in the service, where the rest of
the order's state is already being read.

**Authorization current state:** the ERD's intended approach is CASL abilities in code (3 fixed
roles, no permissions table — see `users` in `business-invariants.md`). `@casl/ability` is not
yet in `package.json`; until it's added, guards enforce role checks directly.

## Money

Integer minor units (cents), end to end — see R6 in `business-invariants.md`. In practice:

- Every monetary DTO field is `@IsInt()`, never `@IsNumber()` alone — `@IsNumber()` accepts
  `19.99` silently, `@IsInt()` doesn't.
- The API exposes cents too. No endpoint divides by 100; that conversion belongs to the
  frontend and email templates only.
- Percentage discounts round with `Math.round`, not truncation — truncating systematically
  under-charges by up to a cent per order.

## Transactions

Prisma's `$transaction` (interactive form, for anything beyond a couple of independent writes).
Each of these must be one transaction, tied to the invariant that requires it:

| Writes | Why atomic |
|---|---|
| `orders.status` update + `order_status_history` insert | R2 — the two must never disagree |
| Conditional stock `UPDATE` + order status update + `order_status_history` note | R3/R8 — a failure between the stock check and the order update must not leave a decremented-but-unrecorded state, or a `PAID` order with silently lost stock |
| `SELECT ... FOR UPDATE` on `promo_codes` + `promo_redemptions` insert + `orders.discount_cents` | R5 — the lock and the insert must be in the same transaction or the lock is pointless. `SELECT ... FOR UPDATE` needs `$queryRaw`/`$executeRaw` inside `$transaction`; Prisma's fluent API has no row-lock method |

## Errors

Services throw Nest's built-in HTTP exceptions (`BadRequestException`, `NotFoundException`,
`ConflictException`, `ForbiddenException`, ...) or a project exception mapped to the
`application/problem+json` shape in `api-contracts.md`. Never throw a raw `Error` from a
service — Nest's default filter turns it into an opaque `500`, discarding the actual cause and
breaking the error contract every other endpoint follows.
