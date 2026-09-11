import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersService } from '../src/sales/orders.service';
import { OrderAbilityFactory } from '../src/sales/casl/order-ability.factory';
import { CheckoutQueueService } from '../src/sales/queue/checkout-queue.service';
import {
  DiscountType,
  OrderStatus,
  UserRole,
} from '../generated/prisma/client';

// R5's documented gap (business-invariants.md: "nothing else stops repeated POST /orders calls
// from each consuming a promo-code redemption slot for free"): an abandoned PENDING order keeps
// counting toward usage_limit forever, since usage is a live join excluding only CANCELLED
// orders. The sweep is what's supposed to free that slot — this test reproduces the block, then
// verifies the sweep actually clears it, against the real database (not mocks), same as
// orders-promo-concurrency.e2e-spec.ts does for the sibling R5 race.
describe('Orders / expired PENDING order sweep (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;

  const suffix = randomUUID().slice(0, 8);
  const promoCode = `E2E-EXPIRY-${suffix}`;
  const userIds: string[] = [];
  let productId: string;
  let colorId: string;
  let sizeId: string;
  let variantId: string;
  const initialStock = 10;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      providers: [
        OrdersService,
        OrderAbilityFactory,
        // Not exercised by this test — see the same note in orders.e2e-spec.ts.
        {
          provide: CheckoutQueueService,
          useValue: { enqueueRefund: jest.fn() },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    ordersService = moduleFixture.get(OrdersService);

    const color = await prisma.color.create({
      data: { name: `E2E Color ${suffix}`, hexCode: '#654321' },
    });
    colorId = color.id;

    const size = await prisma.size.create({
      data: { name: `E2E-${suffix}`, position: 9100 },
    });
    sizeId = size.id;

    const product = await prisma.product.create({
      data: { name: `E2E Expiry Sweep Tee ${suffix}` },
    });
    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        colorId,
        sizeId,
        sku: `E2E-EXPIRY-${suffix}`,
        priceCents: 1500,
        stock: initialStock,
      },
    });
    variantId = variant.id;

    await prisma.promoCode.create({
      data: {
        code: promoCode,
        discountType: DiscountType.PERCENTAGE,
        discountValue: 10,
        usageLimit: 1,
      },
    });

    for (const label of ['a', 'b']) {
      const user = await prisma.user.create({
        data: {
          email: `e2e-expiry-${label}-${suffix}@example.com`,
          passwordHash: 'not-a-real-hash',
          firstName: 'E2E',
          lastName: 'Expiry',
          role: UserRole.CLIENT,
        },
      });
      userIds.push(user.id);

      const cart = await prisma.cart.create({ data: { userId: user.id } });
      await prisma.cartItem.create({
        data: { cartId: cart.id, productVariantId: variantId, quantity: 1 },
      });
    }
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.promoCode.deleteMany({ where: { code: promoCode } });
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.color.deleteMany({ where: { id: colorId } });
    await prisma.size.deleteMany({ where: { id: sizeId } });
    await app.close();
  });

  it('frees a promo redemption slot blocked by an abandoned PENDING order', async () => {
    const [userA, userB] = await Promise.all(
      userIds.map((id) => prisma.user.findUniqueOrThrow({ where: { id } })),
    );

    const orderA = await ordersService.create(userA, { promoCode });

    // Simulate an abandoned cart: the order is old enough to be expired, but nothing has ever
    // cancelled it — reproducing this with a real backdated row, not a mock, since the sweep's
    // own query filters on createdAt directly against the database.
    await prisma.order.update({
      where: { id: orderA.id },
      data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
    });

    // Before the sweep runs: the bug this test reproduces. userB is blocked from redeeming the
    // same single-use promo code, because orderA's redemption is still counted (its status is
    // still PENDING, not CANCELLED).
    await expect(
      ordersService.create(userB, { promoCode }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await ordersService.sweepExpiredPendingOrders();

    const sweptOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderA.id },
    });
    expect(sweptOrder.status).toBe(OrderStatus.CANCELLED);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    expect(variant.stock).toBe(initialStock);

    const nonCancelledRedemptions = await prisma.promoRedemption.count({
      where: {
        promoCode: { code: promoCode },
        order: { status: { not: OrderStatus.CANCELLED } },
      },
    });
    expect(nonCancelledRedemptions).toBe(0);

    // After the sweep: the slot is free, so userB's create() succeeds where it failed above.
    const orderB = await ordersService.create(userB, { promoCode });
    expect(orderB.status).toBe(OrderStatus.PENDING);
  });

  it('leaves a PENDING order untouched when it is not yet expired', async () => {
    const [userA] = await Promise.all(
      userIds.map((id) => prisma.user.findUniqueOrThrow({ where: { id } })),
    );
    const order = await ordersService.create(userA, {});

    await ordersService.sweepExpiredPendingOrders();

    const untouched = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(untouched.status).toBe(OrderStatus.PENDING);
  });
});
