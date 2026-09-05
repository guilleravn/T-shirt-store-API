export interface OrderSummarySource {
  id: string;
  status: string;
  createdAt: Date;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  itemCount: number;
  paymentMethod: string | null;
  promoCode: string | null;
  deliveryPersonId: string | null;
}

export class OrderSummaryResponseDto {
  id: string;
  status: string;
  createdAt: Date;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  itemCount: number;
  // Read from the order's one SUCCEEDED payments row (business-invariants.md), never derived
  // from an in-flight PENDING/FAILED attempt — null until a payment has actually succeeded.
  paymentMethod: string | null;
  promoCode: string | null;
  deliveryPersonId: string | null;

  constructor(source: OrderSummarySource) {
    this.id = source.id;
    this.status = source.status;
    this.createdAt = source.createdAt;
    this.subtotalCents = source.subtotalCents;
    this.discountCents = source.discountCents;
    this.totalCents = source.totalCents;
    this.currency = source.currency;
    this.itemCount = source.itemCount;
    this.paymentMethod = source.paymentMethod;
    this.promoCode = source.promoCode;
    this.deliveryPersonId = source.deliveryPersonId;
  }
}
