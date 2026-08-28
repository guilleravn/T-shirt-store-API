# Business invariants

> Canonical source: [`docs/reference/erd/T-Shirt.dbml`](../reference/erd/T-Shirt.dbml). If
> anything here contradicts the DBML, the DBML wins and this file is out of date.
>
> Rejected options are sourced from
> [`docs/reference/erd/T-Shirt-constraints.sql`](../reference/erd/T-Shirt-constraints.sql).

These are rules where a violation is a **bug**, not a style difference. Every rule below states
the concrete failure it prevents — if you can't point at a failing scenario, it isn't one of
these rules.

## R1 — PAID orders are immutable

**Requires:** once an order reaches `PAID`, application code never edits the `orders` row or its
`order_items` rows.

**Protects:** the purchase record stays a faithful copy of what was actually bought and charged,
independent of later catalog changes. This is a business policy, not what defends
`total_cents` — that integrity is a separate `CHECK (total_cents = subtotal_cents - discount_cents)`.

**Fails as:** an admin script "fixing" a typo in `variant_label` after payment. The DB accepts
the edit — nothing enforces R1 at the schema level — and the order history silently stops
matching what the customer was actually charged.

## R2 — status and status history are written atomically, from one method

**Requires:** every status transition writes `orders.status` and inserts into
`order_status_history` inside one transaction, through a single code path.

**Protects:** `orders.status` (duplicated on the row for fast paginated listings) never
disagrees with the append-only audit log that is its real source of truth.

**Fails as:** two call sites changing status independently — one bumps `orders.status` to
`SHIPPED`, a bug skips the history insert — and the order list shows `SHIPPED` while the audit
trail has no record of when or by whom.

## R3 — stock decrements with one conditional UPDATE

**Requires:** stock decrements always run as

```sql
UPDATE product_variants SET stock = stock - $qty
 WHERE id = $1 AND stock >= $qty RETURNING stock;
```

never a read-then-check-then-write. 0 rows affected means the stock wasn't enough (see R8). The
new stock comes back in `RETURNING`, and the previous stock is `returned + qty`, so the
low-stock threshold (3) crossing is computed without a second `SELECT`.

**Protects:** correctness under concurrent purchases of the same variant, in a single locking
statement.

**Fails as:** treating `CHECK (stock >= 0)` as the actual concurrency control instead of a bug
backstop. An exception thrown inside the Stripe webhook transaction rolls back, leaves
`processed_at` `NULL`, and produces Stripe's 3-day retry loop on a payment that already
succeeded.

## R4 — Stripe events are idempotent via `processed_at`

**Requires:** insert the `stripe_events` row with `processed_at = NULL` first; mark it only once
the handler finishes. A duplicate delivery of an event still `NULL` gets reprocessed.

**Protects:** correct handling of Stripe's at-least-once delivery guarantee.

**Fails as:** marking `processed_at` before the handler completes (or never marking it) either
replays an already-successful event — double stock decrement — or permanently loses a failed
one: payment confirmed, stock never decremented, and no retry ever arrives to fix it.

## R5 — promo usage is counted under a row lock

**Requires:** before inserting a `promo_redemptions` row,
`SELECT ... FROM promo_codes WHERE id = $1 FOR UPDATE` locks the coupon row. Usage is counted by
joining `promo_redemptions` to `orders` with `status <> CANCELLED`, never from a stored counter.
A job cancels expired `PENDING` orders and frees their redemption.

**Protects:** `usage_limit` is enforced correctly under concurrent checkouts.

**Fails as:** the exact failure a stored `used_count` would also produce — two simultaneous
checkouts against a code with `usage_limit = 100` and 99 already used both read `count = 99`,
both conclude "still allowed", both commit. Result: 101 redemptions on a 100-use code.

## R6 — money is integer cents everywhere

**Requires:** DB columns, API payloads, and Stripe calls are all integer minor units (cents).
Only the frontend and email templates divide by 100 to display. Percentage discounts round with
`Math.round`.

**Protects:** eliminates float rounding error from every layer that touches money.

**Fails as:** storing or calculating price as a float, or dividing by 100 anywhere before the
display layer, produces off-by-one-cent totals that fail the `total_matches_math` CHECK on some
non-deterministic fraction of orders.

## R7 — delivery assignment happens at one defined moment

**Requires:** `delivery_person_id` is set exactly at the `PROCESSING → SHIPPED` transition, by
the same transaction that writes the status change (R2).

**Protects:** the column and its `(delivery_person_id, status)` index have a single, defined
moment of truth for when they get populated.

**Fails as:** assigning `delivery_person_id` anywhere else — at order creation, or lazily —
leaves it `NULL` for every order that hasn't reached `SHIPPED` yet. The index goes dead, and any
"orders assigned to me" query for a delivery person becomes silently incomplete.

## R8 — an oversold webhook still commits

**Requires:** if R3's `UPDATE` affects 0 rows, the webhook does **not** abort. It still marks the
order `PAID`, skips the stock decrement, and records the shortfall in
`order_status_history.note`. The transaction commits and `processed_at` is marked.

**Protects:** `PAID` stays truthful — the customer's card was charged, that's a fact — while
surfacing the oversell as a monitored anomaly instead of an unhandled exception.

**Fails as:** aborting the transaction here (or trusting stock validated at Payment Intent
creation is still true by the time the webhook fires) leaves a real charge attached to an order
stuck `PENDING` forever, with no operator visibility into why.

## Interpretation assumptions

Decisions the challenge brief doesn't spell out directly, sourced from the DBML table notes.

| Assumption | Source note | Why |
|---|---|---|
| Stock and price are counted per **variant**, not per product | `product_variants` | "the unit that's sold and counted"; price varies by variant (an XXL can cost more) |
| Delete and disable are distinct features | `products` | `is_active=false` removes it from the storefront but the manager still sees it; `deleted_at` removes it everywhere. Physical delete is forbidden **and impossible** — `product_variants` references it with `RESTRICT`, and `order_items` references variants, so the chain protecting order history is closed by FK, not just convention |
| Payment Link is an ephemeral, per-order link | `payments` (FEATURE 7A) | Authenticated client, `PENDING` order created beforehand, `order_id` in metadata. A public reusable link was rejected: it can't validate stock before charging, and an anonymous buyer breaks the "list my orders" feature and CASL's own-resource abilities |
| No shipping address is modeled | `orders` | The order-detail feature enumerates products, payment method, total, status — no destination. The three delivery-person actions are status filters and transitions, not address lookups. If needed later, it's a separate `order_shipping_details` table (PK = `order_id`, no `user_id`), not a column here |
| Cancelling a paid order refunds it, recorded via `payments.refunded_at` | `payments` | The column exists specifically to represent "a payment that succeeded and was later reversed" — same pattern as `paid_at`, `used_at`, `revoked_at`. The refund runs **asynchronously**: `POST /orders/{id}/cancel` commits the cancellation and stock restore, then enqueues the refund; `refunded_at` is written when Stripe confirms it. A synchronous Stripe call inside the same transaction has the same dual-write problem R8 avoids for stock — if Stripe fails after the commit, or the commit fails after Stripe succeeds, the two systems disagree. One side effect worth knowing: this makes "orders that owe a refund" a queryable state — `CANCELLED` order + a `SUCCEEDED` payment + `refunded_at IS NULL` — used in [`docs/architecture.md`](../architecture.md)'s monitoring list |
| The cart stores no price | `cart_items` | The cart shows the present, computed on read. Storing price here would show a phantom number once the catalog changes |
| Promo usage is a live count, never a stored counter | `promo_codes`, `promo_redemptions` | A counter read then written desyncs under concurrency — see R5. `promo_redemptions` also carries no `user_id`: R5's count already joins to `orders` to filter by status, so a `user_id` column would just be a second, possibly-contradicting copy of `orders.user_id` |
| Authorization is role checks in code (CASL), not a permissions table | `users` | 3 fixed roles; CASL defines abilities in code. Signup always creates `CLIENT`; `MANAGER` and `DELIVERY` exist only via seed |

Two API-level fields are **derived at read time**, not stored columns — grepping the schema for
them will come up empty:

- `PromoCode.status` (`ACTIVE` / `DISABLED` / `EXPIRED` / `EXHAUSTED`) is computed from
  `is_active`, `expires_at`, and usage vs. `usage_limit`.
- `OrderSummary.paymentMethod` is read from the order's one `SUCCEEDED` row in `payments`
  (via `one_successful_payment_per_order`), not stored on `orders`.

## Evaluated and rejected

Sourced from `T-Shirt-constraints.sql`'s closing section. A reasoned rejection defends itself;
a silent omission doesn't.

| Option | Rejected because |
|---|---|
| Composite FK (`UNIQUE(id, role)` on `users` + a generated column) to guarantee `delivery_person_id` points at a `DELIVERY` user | Too much ceremony — a redundant unique plus a generated column — for the scope. Validated in the application instead |
| `UNIQUE(order_id, status)` on `order_status_history` | A Payment Link fires both `checkout.session.completed` and `payment_intent.succeeded` for the same purchase, unordered. If both handlers mark `PAID`, the unique would abort the webhook transaction and reproduce the exact retry loop R8 exists to prevent. An append-only log must not be able to abort the transaction that audits it. Detection is a monitoring alert instead: `SELECT order_id, status, count(*) FROM order_status_history GROUP BY order_id, status HAVING count(*) > 1` — direct material for [`docs/architecture.md`](../architecture.md) |
| `UNIQUE(product_id, position)` on `product_images` | Images reorder frequently; the unique would need a deferrable constraint or temporary negative positions. Determinism comes from the query instead: `ORDER BY position, created_at, id LIMIT 1`. `sizes` **does** get this unique, because sizes are seeded once and never reordered |
| `CHECK (currency = 'USD')` on `orders` and `payments` | Left **optional, not applied**. With a single declared currency it would make two currently-duplicated constant columns honest — a possible future addition, not a rejected one |

## Security invariants

Held to the same standard: violating one of these is a bug, not a style preference.

- **Tokens are stored hashed, never raw.** `refresh_tokens.token_hash` and
  `password_reset_tokens.token_hash` store only the hash. Fails as: a leaked DB row or log line
  containing a raw token lets anyone take over the account it belongs to.
- **Refresh tokens rotate with reuse detection.** Every refresh marks the old row's
  `revoked_at` and inserts a new row; revoked rows are kept, not deleted, so a second use of an
  already-rotated token is detectable — that reuse is the signal of theft (RFC 9700 requires
  rotation or sender-constraining for public clients).
- **Password reset tokens are single-use.** `used_at` marks consumption; no successor row is
  created. Completing a reset revokes all of that user's `refresh_tokens`.
- **Password reset is rate-limited per account, not just per IP.** 3 requests/hour per account,
  10/hour per IP, enforced with the `(user_id, created_at)` index. The per-account limit is the
  one that matters — an attacker rotating IPs can otherwise keep flooding one victim's inbox.
- **`ValidationPipe` runs with `whitelist: true` globally.** Fails as: without it, a client can
  smuggle undeclared fields (e.g. `role`, `isActive`) into a create/update payload and have them
  silently accepted if a service ever spreads the raw body instead of the validated DTO.
- **Every `/webhooks/stripe` request is signature-verified before any processing.** Fails as:
  skipping this lets anyone POST a fake `checkout.session.completed` and get free stock
  decrements and `PAID` orders with no payment ever made.
