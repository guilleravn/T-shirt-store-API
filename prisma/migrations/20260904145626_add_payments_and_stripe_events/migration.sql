-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('PAYMENT_LINK', 'PAYMENT_INTENT');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "stripe_reference_id" VARCHAR(255) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ,
    "refunded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stripe_event_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_reference_id_key" ON "payments"("stripe_reference_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_events_stripe_event_id_key" ON "stripe_events"("stripe_event_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added, from docs/reference/erd/T-Shirt-constraints.sql (not expressible in Prisma's schema DSL)

ALTER TABLE payments
  ADD CONSTRAINT payment_amount_positive CHECK (amount_cents > 0);

-- At most one SUCCEEDED payment per order — without this, two SUCCEEDED rows mean a silent
-- double-charge, and OrderSummary.paymentMethod wouldn't know which one to show.
CREATE UNIQUE INDEX one_successful_payment_per_order
  ON payments (order_id)
  WHERE status = 'SUCCEEDED';

-- The only query against stripe_events is "fetch the pending ones" — in steady state
-- processed_at is non-null on almost every row, so a full index would be enormous and useless.
CREATE INDEX stripe_events_unprocessed
  ON stripe_events (created_at)
  WHERE processed_at IS NULL;
