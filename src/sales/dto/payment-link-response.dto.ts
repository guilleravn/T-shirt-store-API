export interface PaymentLinkSource {
  orderId: string;
  paymentUrl: string;
  expiresAt: Date;
  totalCents: number;
  currency: string;
}

export class PaymentLinkResponseDto {
  orderId: string;
  paymentUrl: string;
  expiresAt: Date;
  totalCents: number;
  currency: string;

  constructor(source: PaymentLinkSource) {
    this.orderId = source.orderId;
    this.paymentUrl = source.paymentUrl;
    this.expiresAt = source.expiresAt;
    this.totalCents = source.totalCents;
    this.currency = source.currency;
  }
}
