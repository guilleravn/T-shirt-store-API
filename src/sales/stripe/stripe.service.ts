import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export interface CreatePaymentIntentParams {
  amountCents: number;
  currency: string;
  orderId: string;
}

export interface CreatePaymentLinkParams {
  unitAmountCents: number;
  quantity: number;
  currency: string;
  productName: string;
  orderId: string;
  successUrl: string;
  cancelUrl: string;
}

// A Checkout Session, one link per order, matching the DBML's FEATURE 7A note. Stripe's own
// "Payment Link" product creates a persistent, reusable URL — the exact thing that note rejects
// (can't validate stock before charging, an anonymous buyer breaks CASL's own-resource
// abilities). A Checkout Session in `payment` mode is single-use by nature and still fires
// `checkout.session.completed`, so it's what actually implements "an ephemeral link per order."
const PAYMENT_LINK_EXPIRY_SECONDS = 30 * 60;

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(configService: ConfigService) {
    this.stripe = new Stripe(
      configService.getOrThrow<string>('STRIPE_SECRET_KEY'),
    );
    this.webhookSecret = configService.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
  }

  createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      metadata: { orderId: params.orderId },
    });
  }

  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.retrieve(id);
  }

  createPaymentLink(
    params: CreatePaymentLinkParams,
  ): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            unit_amount: params.unitAmountCents,
            product_data: { name: params.productName },
          },
          quantity: params.quantity,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { orderId: params.orderId },
      expires_at: Math.floor(Date.now() / 1000) + PAYMENT_LINK_EXPIRY_SECONDS,
    });
  }

  retrieveCheckoutSession(id: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(id);
  }

  // Both checkout paths ultimately settle through a PaymentIntent (a Checkout Session in
  // `payment` mode creates one under the hood), so a refund always targets that same reference
  // type regardless of which flow produced the payment.
  refundPayment(paymentIntentId: string): Promise<Stripe.Refund> {
    return this.stripe.refunds.create({ payment_intent: paymentIntentId });
  }

  // Verifies and parses in one call. Throws Stripe.errors.StripeSignatureVerificationError on a
  // bad/missing signature — callers map that to a 400, never a 500.
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
