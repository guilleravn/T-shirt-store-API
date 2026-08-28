# Data model

> Canonical source: [`docs/reference/erd/T-Shirt.dbml`](erd/T-Shirt.dbml) — 20 tables, uuid PKs,
> a single currency, no tax, no shipping. Hand-written constraints DBML can't express (CHECKs,
> partial indexes) live in [`docs/reference/erd/T-Shirt-constraints.sql`](erd/T-Shirt-constraints.sql).
> Business rules R1–R8 and the reasoning behind every table are in
> [`business-invariants.md`](../rules/business-invariants.md) — this file does not restate them.

This file goes stale if the DBML or the constraints file change without a matching edit here.
The DBML is canonical; if it contradicts this file, the DBML wins.

## Facts to know before writing a query

- **Stock and price live on `product_variants`, not `products`.** A product has no sellable
  quantity or price of its own — every variant does.
- **`order_items` freezes `product_name`, `variant_label`, and `unit_price_cents` at purchase
  time.** They are copies, not foreign-key lookups — the order history must not change when the
  catalog does.
- **`cart_items` stores no price.** The cart is computed live from the current variant price on
  every read.
- **`orders` is the sole authority on the total actually owed** (`subtotal_cents`,
  `discount_cents`, `total_cents`, guarded by the `total_matches_math` CHECK). `payments` records
  what Stripe actually settled — normally identical, and the pair is what makes a reconciliation
  discrepancy detectable.
- **`orders.status` is denormalized** for fast paginated listings; `order_status_history` is the
  real source of truth. They can only be written together (R2).

## Mapping to Prisma

`prisma/schema.prisma` currently has no models — generator and datasource only (see
[`CLAUDE.md`](../../CLAUDE.md) for current state). When models are added:

| DBML | Prisma | Note |
|---|---|---|
| `snake_case` table/column names | `camelCase` fields, `PascalCase` model names | Use `@map("column_name")` per field and `@@map("table_name")` per model so the DB stays `snake_case` while Prisma stays idiomatic |
| `Enum order_status { ... }` | `enum OrderStatus { ... }` | Prisma enum values stay UPPERCASE to match the DB and the API (see [`api-contracts.md`](api-contracts.md)) |
| `email citext` | `String @db.Citext` (`Unsupported("citext")` if the native type isn't available) | Requires `CREATE EXTENSION citext` — already in `T-Shirt-constraints.sql` |
| `indexes { (product_id, color_id, size_id) [unique] }` | `@@unique([productId, colorId, sizeId])` | Composite uniques and indexes map directly; order of fields matters for which queries the index can serve as a prefix |
| `indexes { (order_id, created_at) }` | `@@index([orderId, createdAt])` | Same |

**Prisma will not generate any of these — they must be added by hand to the migration SQL,**
copied from `T-Shirt-constraints.sql`:

- 4 money-integrity `CHECK`s on `orders`, `order_items`, `cart_items`, `payments`
- `stock_non_negative` and `price_positive` on `product_variants`
- `discount_value_valid_for_type`, `min_purchase_non_negative`, `usage_limit_positive` on
  `promo_codes`
- The partial unique index `one_successful_payment_per_order` on `payments`
- The partial index `stripe_events_unprocessed` on `stripe_events`

Prisma's schema-level `@@unique`/`@@index` cannot express a partial (`WHERE ...`) index — those
two go into the migration as raw SQL after `prisma migrate dev` generates the rest.
