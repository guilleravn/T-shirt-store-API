import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';

const mockStripeInstance = {
  paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
  checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
  refunds: { create: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};

jest.mock('stripe', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockStripeInstance),
  };
});

describe('StripeService', () => {
  let service: StripeService;
  let configService: { getOrThrow: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake';
        if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_fake';
        throw new Error(`unexpected key ${key}`);
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(StripeService);
  });

  it('constructs the Stripe client with the secret key', () => {
    expect(Stripe).toHaveBeenCalledWith('sk_test_fake');
  });

  it('creates a PaymentIntent in the smallest currency unit, lowercased currency', async () => {
    mockStripeInstance.paymentIntents.create.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'secret',
    });

    await service.createPaymentIntent({
      amountCents: 2500,
      currency: 'USD',
      orderId: 'order-1',
    });

    expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledWith({
      amount: 2500,
      currency: 'usd',
      metadata: { orderId: 'order-1' },
    });
  });

  it('retrieves a PaymentIntent by id', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
    });

    await service.retrievePaymentIntent('pi_1');

    expect(mockStripeInstance.paymentIntents.retrieve).toHaveBeenCalledWith(
      'pi_1',
    );
  });

  it('creates a single-use Checkout Session with a price_data line item', async () => {
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/cs_1',
    });

    await service.createPaymentLink({
      unitAmountCents: 1500,
      quantity: 2,
      currency: 'USD',
      productName: 'Classic Tee',
      orderId: 'order-1',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: 1500,
              product_data: { name: 'Classic Tee' },
            },
            quantity: 2,
          },
        ],
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        metadata: { orderId: 'order-1' },
      }),
    );
  });

  it('retrieves a Checkout Session by id', async () => {
    mockStripeInstance.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_1',
    });

    await service.retrieveCheckoutSession('cs_1');

    expect(mockStripeInstance.checkout.sessions.retrieve).toHaveBeenCalledWith(
      'cs_1',
    );
  });

  it('refunds a payment by PaymentIntent id, with an idempotency key', async () => {
    mockStripeInstance.refunds.create.mockResolvedValue({ id: 're_1' });

    await service.refundPayment('pi_1', 'pay-1');

    expect(mockStripeInstance.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      { idempotencyKey: 'pay-1' },
    );
  });

  it('verifies and parses a webhook event using the webhook secret', () => {
    const rawBody = Buffer.from('{}');
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
    });

    const event = service.constructWebhookEvent(rawBody, 'sig_header');

    expect(mockStripeInstance.webhooks.constructEvent).toHaveBeenCalledWith(
      rawBody,
      'sig_header',
      'whsec_fake',
    );
    expect(event.id).toBe('evt_1');
  });
});
