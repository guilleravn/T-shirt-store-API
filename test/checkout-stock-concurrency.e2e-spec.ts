import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeWebhookService } from '../src/sales/stripe-webhook.service';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  UserRole,
} from '../generated/prisma/client';

// R3: two concurrent purchases of a variant with stock = 1 — exactly one line item's conditional
// UPDATE must actually decrement; the other must see 0 rows affected and still commit the order
// as PAID with an oversold note (R8), never throw. Hits the real database, per testing.md's
// explicit rule that this class of test must never mock Prisma — the row-level lock this relies
// on only exists there. Calls StripeWebhookService.handleEvent() directly (in-process), not over
// HTTP, since HTTP-boundary signature parsing is already covered by the checkout e2e spec.
describe('Checkout stock concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stripeWebhookService: StripeWebhookService;
  let webhookSecret: string;

  const suffix = randomUUID().slice(0, 8);
  const orderIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    stripeWebhookService = moduleFixture.get(StripeWebhookService);
    webhookSecret = moduleFixture
      .get(ConfigService)
      .getOrThrow<string>('STRIPE_WEBHOOK_SECRET');

    const color = await prisma.color.create({
      data: { name: `E2E Stock Color ${suffix}`, hexCode: '#112233' },
    });

    const size = await prisma.size.create({
      data: { name: `ES-${suffix}`, position: 9300 },
    });

    const product = await prisma.product.create({
      data: { name: `E2E Stock Tee ${suffix}`, isActive: true },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        colorId: color.id,
        sizeId: size.id,
        sku: `E2E-STOCK-${suffix}`,
        priceCents: 2000,
        stock: 1,
      },
    });

    for (const label of ['a', 'b']) {
      const user = await prisma.user.create({
        data: {
          email: `e2e-stock-${label}-${suffix}@example.com`,
          passwordHash: 'not-a-real-hash',
          firstName: 'E2E',
          lastName: 'Stock',
          role: UserRole.CLIENT,
        },
      });

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          status: OrderStatus.PENDING,
          subtotalCents: 2000,
          discountCents: 0,
          totalCents: 2000,
          items: {
            create: [
              {
                productVariantId: variant.id,
                quantity: 1,
                unitPriceCents: 2000,
                productName: 'E2E Stock Tee',
                variantLabel: 'Concurrency / Test',
              },
            ],
          },
          statusHistory: {
            create: { status: OrderStatus.PENDING, changedByUserId: user.id },
          },
        },
      });
      orderIds.push(order.id);

      await prisma.payment.create({
        data: {
          orderId: order.id,
          method: PaymentMethod.PAYMENT_INTENT,
          stripeReferenceId: `pi_e2e_stock_${label}_${suffix}`,
          amountCents: 2000,
          currency: 'USD',
          status: PaymentStatus.PENDING,
        },
      });
    }
  });

  // Suffix-scoped deletes, not id variables — safe even if beforeAll fails partway (an unset id
  // variable in a Prisma `where` is dropped entirely, matching everything, not nothing; a
  // pattern tied to this run's own random suffix can never do that). Payments are deleted before
  // their orders — Payment.order is onDelete: Restrict, so the reverse order always fails FK.
  afterAll(async () => {
    await prisma.payment.deleteMany({
      where: { stripeReferenceId: { endsWith: `_${suffix}` } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${suffix}@example.com` } },
    });
    await prisma.productVariant.deleteMany({
      where: { sku: `E2E-STOCK-${suffix}` },
    });
    await prisma.product.deleteMany({
      where: { name: `E2E Stock Tee ${suffix}` },
    });
    await prisma.color.deleteMany({
      where: { name: `E2E Stock Color ${suffix}` },
    });
    await prisma.size.deleteMany({ where: { name: `ES-${suffix}` } });
    await app.close();
  });

  function signedEvent(label: 'a' | 'b', orderId: string) {
    const payload = JSON.stringify({
      id: `evt_e2e_stock_${label}_${suffix}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_e2e_stock_${label}_${suffix}`,
          object: 'payment_intent',
          amount_received: 2000,
          metadata: { orderId },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    return { rawBody: Buffer.from(payload), signature };
  }

  it('lets exactly one concurrent payment decrement stock; the other commits PAID as oversold', async () => {
    const eventA = signedEvent('a', orderIds[0]);
    const eventB = signedEvent('b', orderIds[1]);

    const results = await Promise.allSettled([
      stripeWebhookService.handleEvent(eventA.rawBody, eventA.signature),
      stripeWebhookService.handleEvent(eventB.rawBody, eventB.signature),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { sku: `E2E-STOCK-${suffix}` },
    });
    expect(variant.stock).toBe(0);

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { statusHistory: { where: { status: OrderStatus.PAID } } },
    });
    expect(orders).toHaveLength(2);
    for (const order of orders) {
      expect(order.status).toBe(OrderStatus.PAID);
    }

    const notes = orders.map((o) => o.statusHistory[0]?.note ?? null);
    const oversoldNotes = notes.filter((note) => note !== null);
    const cleanNotes = notes.filter((note) => note === null);
    expect(oversoldNotes).toHaveLength(1);
    expect(cleanNotes).toHaveLength(1);
  });
});
