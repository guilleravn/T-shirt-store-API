import { BadRequestException } from '@nestjs/common';
import {
  DiscountType,
  OrderStatus,
  Prisma,
} from '../../generated/prisma/client';

interface LockedPromoCodeRow {
  id: string;
  discountType: DiscountType;
  discountValue: number;
  minPurchaseCents: number | null;
  usageLimit: number | null;
  expiresAt: Date | null;
  isActive: boolean;
}

export interface PromoLockResult {
  discountCents: number;
  promoCodeId: string;
}

// R5: locks the promo_codes row FOR UPDATE, counts non-cancelled redemptions, validates, and
// computes the discount — all inside the caller's transaction. Extracted from OrdersService
// (the original R5 implementation) because CheckoutService's payment-link path needs the exact
// same logic for its own one-item order; both live in SalesModule, so there's no module
// boundary to justify a second copy (contrast with assertPurchasable, deliberately duplicated
// from CartService because that IS a module boundary).
export async function lockAndValidatePromoCode(
  tx: Prisma.TransactionClient,
  promoCode: string,
  subtotalCents: number,
): Promise<PromoLockResult> {
  const rows = await tx.$queryRaw<LockedPromoCodeRow[]>`
    SELECT id, discount_type AS "discountType", discount_value AS "discountValue",
           min_purchase_cents AS "minPurchaseCents", usage_limit AS "usageLimit",
           expires_at AS "expiresAt", is_active AS "isActive"
    FROM promo_codes WHERE code = ${promoCode} FOR UPDATE
  `;
  const promo = rows[0];
  if (!promo) {
    throw new BadRequestException('Invalid promo code');
  }

  const usageCount = await tx.promoRedemption.count({
    where: {
      promoCodeId: promo.id,
      order: { status: { not: OrderStatus.CANCELLED } },
    },
  });
  assertPromoRedeemable(promo, usageCount, subtotalCents);

  return {
    discountCents: computeDiscount(promo, subtotalCents),
    promoCodeId: promo.id,
  };
}

function assertPromoRedeemable(
  promo: LockedPromoCodeRow,
  usageCount: number,
  subtotalCents: number,
): void {
  if (!promo.isActive) {
    throw new BadRequestException('Promo code is disabled');
  }
  if (promo.expiresAt && promo.expiresAt < new Date()) {
    throw new BadRequestException('Promo code has expired');
  }
  if (promo.usageLimit !== null && usageCount >= promo.usageLimit) {
    throw new BadRequestException('Promo code usage limit reached');
  }
  if (
    promo.minPurchaseCents !== null &&
    subtotalCents < promo.minPurchaseCents
  ) {
    throw new BadRequestException(
      'Order subtotal does not meet the promo code minimum purchase',
    );
  }
}

function computeDiscount(
  promo: { discountType: DiscountType; discountValue: number },
  subtotalCents: number,
): number {
  if (promo.discountType === DiscountType.PERCENTAGE) {
    return Math.round((subtotalCents * promo.discountValue) / 100);
  }
  return Math.min(promo.discountValue, subtotalCents);
}
