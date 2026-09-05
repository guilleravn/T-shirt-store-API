import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/sales/stripe/stripe.service';
import { AuthTokensResponseDto } from '../src/auth/dto/auth-tokens-response.dto';

// The mandatory "checkout" critical-path e2e per testing.md: cart through to a created,
// webhook-confirmed order. StripeService is overridden so payment-intent/payment-link creation
// never makes a real network call to Stripe — but NOT for signature verification, which uses
// the real SDK's constructEvent against the real (test) STRIPE_WEBHOOK_SECRET, generating a
// genuinely valid signature via Stripe.webhooks.generateTestHeaderString (also no network call).
describe('Checkout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let webhookSecret: string;

  const suffix = randomUUID().slice(0, 8);
  let productId: string;
  let colorId: string;
  let sizeId: string;
  let variantId: string;
  const createdUserIds: string[] = [];

  const fakeStripeService = {
    createPaymentIntent: jest.fn(),
    retrievePaymentIntent: jest.fn(),
    createPaymentLink: jest.fn(),
    retrieveCheckoutSession: jest.fn(),
    refundPayment: jest.fn(),
    constructWebhookEvent: (rawBody: Buffer, signature: string) =>
      new Stripe('sk_test_unused_no_network_calls').webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      ),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeService)
      .useValue(fakeStripeService)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureApp(app as unknown as NestExpressApplication);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    webhookSecret = moduleFixture
      .get(ConfigService)
      .getOrThrow<string>('STRIPE_WEBHOOK_SECRET');

    const color = await prisma.color.create({
      data: { name: `E2E Checkout Color ${suffix}`, hexCode: '#654abc' },
    });
    colorId = color.id;

    const size = await prisma.size.create({
      data: { name: `EC-${suffix}`, position: 9400 },
    });
    sizeId = size.id;

    const product = await prisma.product.create({
      data: { name: `E2E Checkout Tee ${suffix}`, isActive: true },
    });
    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        colorId,
        sizeId,
        sku: `E2E-CHECKOUT-${suffix}`,
        priceCents: 3000,
        stock: 5,
      },
    });
    variantId = variant.id;
  });

  afterAll(async () => {
    // Never cleaned up before this fix — the webhook test below inserts a real stripe_events
    // row, and every run of this suite left one behind permanently.
    await prisma.stripeEvent.deleteMany({
      where: { stripeEventId: { endsWith: `_${suffix}` } },
    });
    await prisma.payment.deleteMany({
      where: { order: { userId: { in: createdUserIds } } },
    });
    await prisma.order.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.color.deleteMany({ where: { id: colorId } });
    await prisma.size.deleteMany({ where: { id: sizeId } });
    await app.close();
  });

  async function signUpAndSignIn(label: string) {
    const email = `e2e-checkout-${label}-${randomUUID().slice(0, 8)}@example.com`;
    const signUpResponse = await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({
        email,
        password: 'SuperSegura123',
        firstName: 'E2E',
        lastName: 'Checkout',
      })
      .expect(201);
    createdUserIds.push((signUpResponse.body as { id: string }).id);

    const signInResponse = await request(app.getHttpServer())
      .post('/v1/auth/signin')
      .send({ email, password: 'SuperSegura123' })
      .expect(200);
    return (signInResponse.body as AuthTokensResponseDto).accessToken;
  }

  async function createPendingOrder(token: string) {
    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ productVariantId: variantId, quantity: 1 })
      .expect(200);

    const orderResponse = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    return orderResponse.body as { id: string; totalCents: number };
  }

  function signedPaymentIntentSucceededEvent(orderId: string, piId: string) {
    const payload = JSON.stringify({
      id: `evt_e2e_checkout_${suffix}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: piId,
          object: 'payment_intent',
          amount_received: 3000,
          metadata: { orderId },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    return { rawBody: payload, signature };
  }

  describe('POST /checkout/payment-intent', () => {
    it('creates a PaymentIntent for an owned PENDING order', async () => {
      const token = await signUpAndSignIn('a');
      const order = await createPendingOrder(token);
      fakeStripeService.createPaymentIntent.mockResolvedValue({
        id: `pi_e2e_${suffix}_a`,
        client_secret: 'secret_a',
      });

      const response = await request(app.getHttpServer())
        .post('/v1/checkout/payment-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: order.id })
        .expect(201);

      expect(response.body).toEqual({
        orderId: order.id,
        clientSecret: 'secret_a',
      });
    });

    it("rejects creating a PaymentIntent for someone else's order", async () => {
      const ownerToken = await signUpAndSignIn('owner');
      const order = await createPendingOrder(ownerToken);
      const otherToken = await signUpAndSignIn('other');

      await request(app.getHttpServer())
        .post('/v1/checkout/payment-intent')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ orderId: order.id })
        .expect(403);
    });

    it('rejects a non-PENDING order', async () => {
      const token = await signUpAndSignIn('paid');
      const order = await createPendingOrder(token);
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });

      await request(app.getHttpServer())
        .post('/v1/checkout/payment-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: order.id })
        .expect(409);
    });
  });

  describe('POST /webhooks/stripe', () => {
    it('rejects an invalid signature with 400', async () => {
      await request(app.getHttpServer())
        .post('/v1/webhooks/stripe')
        .set('stripe-signature', 'not-a-real-signature')
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({ id: 'evt_bad', type: 'payment_intent.succeeded' }),
        )
        .expect(400);
    });

    it('drives a PENDING order to PAID, decrements stock, and clears the cart', async () => {
      const token = await signUpAndSignIn('webhook');
      const order = await createPendingOrder(token);
      const piId = `pi_e2e_${suffix}_webhook`;
      fakeStripeService.createPaymentIntent.mockResolvedValue({
        id: piId,
        client_secret: 'secret_webhook',
      });
      await request(app.getHttpServer())
        .post('/v1/checkout/payment-intent')
        .set('Authorization', `Bearer ${token}`)
        .send({ orderId: order.id })
        .expect(201);

      const { rawBody, signature } = signedPaymentIntentSucceededEvent(
        order.id,
        piId,
      );

      await request(app.getHttpServer())
        .post('/v1/webhooks/stripe')
        .set('stripe-signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      const updatedOrder = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(updatedOrder.status).toBe('PAID');

      const variant = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      expect(variant.stock).toBeLessThan(5);

      const cartResponse = await request(app.getHttpServer())
        .get('/v1/me/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((cartResponse.body as { items: unknown[] }).items).toHaveLength(0);

      const detailResponse = await request(app.getHttpServer())
        .get(`/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const detail = detailResponse.body as {
        paymentMethod: string | null;
        payment: { method: string; status: string; amountCents: number } | null;
      };
      expect(detail.paymentMethod).toBe('PAYMENT_INTENT');
      expect(detail.payment).toEqual(
        expect.objectContaining({
          method: 'PAYMENT_INTENT',
          status: 'SUCCEEDED',
        }),
      );

      const listResponse = await request(app.getHttpServer())
        .get('/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const listedOrder = (
        listResponse.body as {
          data: { id: string; paymentMethod: string | null }[];
        }
      ).data.find((o) => o.id === order.id);
      expect(listedOrder?.paymentMethod).toBe('PAYMENT_INTENT');
    });
  });
});
