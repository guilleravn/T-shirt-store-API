# API contracts

> Canonical source for exact request/response shapes: [`openapi.yaml`](../../openapi.yaml)
> (also published on SwaggerHub). This file does not restate its endpoint list — that would be a
> second source of truth that drifts from the spec within a week. Read the spec directly, or
> use its SwaggerHub mock server to try requests (see the repo's chat history for the mock-server
> walkthrough, or just open the "Try it out" panel).
>
> This file goes stale if a convention below stops matching `openapi.yaml`, or if R1–R8 in
> [`business-invariants.md`](../rules/business-invariants.md) change in a way that affects a
> response shape (e.g. the webhook table below).

## Cross-cutting conventions

These are decided once, here, instead of repeated on every endpoint in the spec.

| Convention          | Rule                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pagination          | `limit` (default 20, max 100) / `offset` (default 0) query params on every list endpoint                                                                                                                                                          |
| Collection envelope | `{ data: [...], meta: { total, limit, offset, hasMore } }`                                                                                                                                                                                        |
| Money               | Integer minor units (cents) on every monetary field, always suffixed `Cents` (`priceCents`, `totalCents`, ...) — see R6                                                                                                                           |
| Resource IDs        | `uuid` format, in the path (`/products/{productId}`), never a numeric ID                                                                                                                                                                          |
| Enums               | UPPERCASE strings, identical to the DB enum values (`order_status`, `discount_type`, `user_role`)                                                                                                                                                 |
| Timestamps          | ISO 8601, UTC, `date-time` format — matches `timestamptz`                                                                                                                                                                                         |
| Errors              | Nest's default HTTP exception shape, unmodified: `{ statusCode, message, error }` on every 4xx/5xx. `message` is a single string, except `ValidationPipe` failures, which report one string per invalid field                                     |
| Idempotency         | `POST /orders`, `POST /checkout/payment-link`, and `POST /checkout/payment-intent` each accept an optional `Idempotency-Key` header, to survive a double-click or a network retry without creating a duplicate order or duplicate payment attempt |

## Stripe webhook (`POST /webhooks/stripe`)

What happens to `stripe_events.processed_at` (R4) depends on the outcome:

| Case                                | HTTP response       | `processed_at`          | What happens                                                                                                                                                                                        |
| ----------------------------------- | ------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handled — stock available           | `200`               | Set                     | Order marked `PAID`, stock decremented (R3), cart cleared                                                                                                                                           |
| Handled — oversold (R8)             | `200`               | Set                     | Order still marked `PAID`, stock **not** decremented, shortfall logged to `order_status_history.note`                                                                                               |
| Duplicate, already processed        | `200`               | Unchanged (already set) | Early exit — no reprocessing, no double stock decrement                                                                                                                                             |
| Duplicate, previous attempt failed  | `200`               | Set now                 | R4: a row still `NULL` is reprocessed, not skipped                                                                                                                                                  |
| Unhandled event type                | `200`               | Set                     | Acknowledged and ignored — must return `200` or Stripe retries forever                                                                                                                              |
| Infrastructure failure mid-handling | `5xx` / no response | Stays `NULL`            | Transaction rolls back; Stripe retries for up to 3 days. This is the case R3's conditional `UPDATE` exists to avoid triggering _unnecessarily_ — a genuine infra failure should still hit this path |
| Invalid signature                   | `400`               | No row inserted         | Rejected before any domain logic runs                                                                                                                                                               |

## Endpoints that deliberately do not exist

Same logic as "evaluated and rejected" in `business-invariants.md`: a reasoned omission is worth
recording.

| Missing endpoint                                                            | Why                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST/PATCH/DELETE /categories`, `/colors`, `/sizes`                        | Seeded reference data, not managed through the API — `categories`, `colors`, `sizes` notes                                                                                                           |
| Any direct resource for `payments`, `order_status_history`, `stripe_events` | Not domain resources on their own. `payments` and `statusHistory` surface only as fields embedded in `OrderDetail`; `stripe_events` is an idempotency log with no FKs into the domain, never exposed |
| Any direct resource for `promo_redemptions`                                 | A usage record joined internally by R5's count query — not something a client reads directly                                                                                                         |
| Shipping-address endpoints                                                  | Not modeled — see the "no shipping address" assumption in `business-invariants.md`                                                                                                                   |
| A public/reusable Payment Link (one link, any buyer)                        | Rejected: can't validate stock before charging, and an anonymous buyer breaks "list my orders" and CASL's own-resource abilities — see the Payment Link assumption in `business-invariants.md`       |
| `POST /users` to create a `MANAGER` or `DELIVERY` account                   | Those two roles only exist via seed; signup always creates `CLIENT`                                                                                                                                  |
