export interface OrderItemLineSource {
  productName: string;
  variantLabel: string;
  quantity: number;
  unitPriceCents: number;
}

// lineTotalCents is derived, never stored — quantity x unit price is pure calculation (same
// reasoning as cart_items, per the DBML note on order_items).
export class OrderItemLineResponseDto {
  productName: string;
  variantLabel: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;

  constructor(source: OrderItemLineSource) {
    this.productName = source.productName;
    this.variantLabel = source.variantLabel;
    this.quantity = source.quantity;
    this.unitPriceCents = source.unitPriceCents;
    this.lineTotalCents = source.quantity * source.unitPriceCents;
  }
}
