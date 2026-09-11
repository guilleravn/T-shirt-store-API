import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersService } from '../src/sales/orders.service';
import { CheckoutService } from '../src/sales/checkout.service';
import { StripeService } from '../src/sales/stripe/stripe.service';
import { OrderStatus, UserRole } from '../generated/prisma/client';

// fix(sales): createPaymentIntent and cancel() used to touch different tables (payments vs
// orders) with no shared lock — a cancel() commit landing between createPaymentIntent's initial
// PENDING check and its later payment insert used to slip through unnoticed, leaving a real
// Stripe PaymentIntent (and a payments row) attached to an order the system already considers
// cancelled, with no refund armed for it. Hits the real database, per testing.md's rule that a
// concurrency test must never mock Prisma — only Stripe itself is faked here, and only to get a
// deterministic hook for the exact interleaving being tested (cancel() committing while
// createPaymentIntent is mid-flight, not before or after it).
describe('createPaymentIntent vs cancel concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let checkoutService: CheckoutService;

  const suffix = randomUUID().slice(0, 8);
  let userId: string;
  let colorId: string;
  let sizeId: string;
  let productId: string;
  let variantId: string;

  const fakeStripeService = {
    createPaymentIntent: jest.fn(),
    retrievePaymentIntent: jest.fn(),
    createPaymentLink: jest.fn(),
    retrieveCheckoutSession: jest.fn(),
    refundPayment: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };

  beforeAll(async () => {
    // No extra root-level providers here (unlike orders.e2e-spec.ts) — OrdersService and
    // CheckoutService are resolved from their real SalesModule registration (nested inside
    // AppModule), which is what makes .overrideProvider(StripeService) below actually apply to
    // them. Declaring either as an extra root provider would resolve its dependencies from the
    // root module's own scope instead, where the override isn't visible.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeService)
      .useValue(fakeStripeService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    ordersService = moduleFixture.get(OrdersService);
    checkoutService = moduleFixture.get(CheckoutService);

    const user = await prisma.user.create({
      data: {
        email: `e2e-cancel-race-${suffix}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'E2E',
        lastName: 'CancelRace',
        role: UserRole.CLIENT,
      },
    });
    userId = user.id;

    const color = await prisma.color.create({
      data: { name: `E2E CancelRace Color ${suffix}`, hexCode: '#223344' },
    });
    colorId = color.id;

    const size = await prisma.size.create({
      data: { name: `ECR2-${suffix}`, position: 9600 },
    });
    sizeId = size.id;

    const product = await prisma.product.create({
      data: { name: `E2E CancelRace Tee ${suffix}`, isActive: true },
    });
    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        colorId,
        sizeId,
        sku: `E2E-CANCELRACE-${suffix}`,
        priceCents: 1500,
        stock: 5,
      },
    });
    variantId = variant.id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { order: { userId } } });
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.color.deleteMany({ where: { id: colorId } });
    await prisma.size.deleteMany({ where: { id: sizeId } });
    await app.close();
  });

  it('rejects createPaymentIntent when cancel() commits while the Stripe call is in flight', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const order = await prisma.order.create({
      data: {
        userId,
        status: OrderStatus.PENDING,
        subtotalCents: 1500,
        discountCents: 0,
        totalCents: 1500,
        items: {
          create: [
            {
              productVariantId: variantId,
              quantity: 1,
              unitPriceCents: 1500,
              productName: 'E2E CancelRace Tee',
              variantLabel: 'Concurrency / Test',
            },
          ],
        },
        statusHistory: {
          create: { status: OrderStatus.PENDING, changedByUserId: userId },
        },
      },
    });

    // Runs cancel() to completion from inside the (mocked) Stripe call — this is exactly the
    // window between createPaymentIntent's initial PENDING check and its later locked re-check
    // right before the payment insert, the window the fix closes.
    fakeStripeService.createPaymentIntent.mockImplementation(async () => {
      await ordersService.cancel(order.id, user, {});
      return {
        id: `pi_e2e_cancel_race_${suffix}`,
        client_secret: 'secret_test',
      };
    });

    await expect(
      checkoutService.createPaymentIntent(user, { orderId: order.id }),
    ).rejects.toBeInstanceOf(ConflictException);

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(finalOrder.status).toBe(OrderStatus.CANCELLED);

    const paymentCount = await prisma.payment.count({
      where: { orderId: order.id },
    });
    expect(paymentCount).toBe(0);
  });
});
