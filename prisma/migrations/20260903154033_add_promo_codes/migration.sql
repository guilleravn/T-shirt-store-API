-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "discount_type" "discount_type" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "min_purchase_cents" INTEGER,
    "usage_limit" INTEGER,
    "expires_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CheckConstraint (hand-added from T-Shirt-constraints.sql — not expressible in schema.prisma)
ALTER TABLE "promo_codes"
  ADD CONSTRAINT "discount_value_valid_for_type"
  CHECK (
    ("discount_type" = 'PERCENTAGE' AND "discount_value" BETWEEN 1 AND 100)
    OR
    ("discount_type" = 'FIXED' AND "discount_value" > 0)
  );

ALTER TABLE "promo_codes"
  ADD CONSTRAINT "min_purchase_non_negative"
    CHECK ("min_purchase_cents" IS NULL OR "min_purchase_cents" >= 0),
  ADD CONSTRAINT "usage_limit_positive"
    CHECK ("usage_limit" IS NULL OR "usage_limit" > 0);
