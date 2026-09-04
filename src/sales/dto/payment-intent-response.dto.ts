export interface PaymentIntentSource {
  orderId: string;
  clientSecret: string;
}

export class PaymentIntentResponseDto {
  orderId: string;
  clientSecret: string;

  constructor(source: PaymentIntentSource) {
    this.orderId = source.orderId;
    this.clientSecret = source.clientSecret;
  }
}
