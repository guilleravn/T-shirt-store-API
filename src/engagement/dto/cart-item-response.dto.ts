import { VariantResponseDto } from '../../catalog/dto/variant-response.dto';

export enum CartItemIssue {
  OutOfStock = 'OUT_OF_STOCK',
  InsufficientStock = 'INSUFFICIENT_STOCK',
  VariantDisabled = 'VARIANT_DISABLED',
  ProductUnavailable = 'PRODUCT_UNAVAILABLE',
}

export interface CartItemResponseSource {
  id: string;
  variant: VariantResponseDto;
  quantity: number;
  lineTotalCents: number;
  available: boolean;
  maxQuantity: number;
  issues: CartItemIssue[];
}

// Reuses VariantResponseDto (the MANAGER-facing shape, real stock) rather than
// PublicVariantResponseDto: a cart line is a private view of the caller's own cart, so hiding
// the exact stock behind availableQuantity/lowStock (the public-catalog treatment) doesn't apply.
export class CartItemResponseDto {
  id: string;
  variant: VariantResponseDto;
  quantity: number;
  lineTotalCents: number;
  available: boolean;
  maxQuantity: number;
  issues: CartItemIssue[];

  constructor(source: CartItemResponseSource) {
    this.id = source.id;
    this.variant = source.variant;
    this.quantity = source.quantity;
    this.lineTotalCents = source.lineTotalCents;
    this.available = source.available;
    this.maxQuantity = source.maxQuantity;
    this.issues = source.issues;
  }
}
