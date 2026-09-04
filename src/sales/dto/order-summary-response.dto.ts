export interface OrderSummarySource {
  id: string;
  status: string;
  createdAt: Date;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  itemCount: number;
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
  // Always null in this branch — no payments table exists yet (see openapi.yaml's own note:
  // "Null until a payment attempt exists"). Real values arrive with the checkout/Stripe branch.
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
    this.paymentMethod = null;
    this.promoCode = source.promoCode;
    this.deliveryPersonId = source.deliveryPersonId;
  }
}
