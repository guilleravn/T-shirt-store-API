import { ConflictException } from '@nestjs/common';

export interface PurchasableProduct {
  isActive: boolean;
  deletedAt: Date | null;
}

export interface PurchasableVariant {
  isActive: boolean;
  deletedAt: Date | null;
  stock: number;
}

// Mirrors CartService.assertPurchasable — freezing a line that isn't currently purchasable into
// an order makes no sense. Duplicated from CartService rather than imported, matching this
// codebase's convention of querying another domain's tables directly instead of a cross-module
// service dependency for a few lines of logic — but shared between OrdersService and
// CheckoutService, both in SalesModule, since there's no module boundary to justify a second
// copy of the same check within one module.
export function assertPurchasable(
  product: PurchasableProduct,
  variant: PurchasableVariant,
  quantity: number,
): void {
  if (product.deletedAt || !product.isActive) {
    throw new ConflictException('Product is not available');
  }
  if (variant.deletedAt || !variant.isActive) {
    throw new ConflictException('Variant is disabled');
  }
  if (variant.stock === 0) {
    throw new ConflictException('Variant is out of stock');
  }
  if (variant.stock < quantity) {
    throw new ConflictException('Insufficient stock');
  }
}
