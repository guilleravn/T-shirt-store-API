-- Same pattern as one_successful_payment_per_order / product_variant_combo_unique
-- (docs/reference/erd/T-Shirt-constraints.sql): a partial unique index, not a plain
-- UNIQUE(user_id), so a user can have any number of PAID/CANCELLED/etc. orders — only one
-- PENDING at a time. This is the real concurrency guard for the "at most one non-terminal
-- order per user" rule (business-invariants.md); OrdersService.create()'s findFirst check is
-- just a fast, non-atomic pre-check that avoids doing purchasability/promo work before this.
CREATE UNIQUE INDEX one_pending_order_per_user
  ON orders (user_id)
  WHERE status = 'PENDING';
