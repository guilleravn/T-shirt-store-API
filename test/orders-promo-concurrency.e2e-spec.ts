import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersService } from '../src/sales/orders.service';
import { OrderAbilityFactory } from '../src/sales/casl/order-ability.factory';
import { DiscountType, UserRole } from '../generated/prisma/client';

// R5: two simultaneous checkouts against a promo code with exactly one redemption slot left.
// Without the `SELECT ... FOR UPDATE` lock in OrdersService.create(), both transactions read the
// same pre-lock usage count and both would succeed — this must run against the real database,
// never a mock, since the row lock only exists there (docs/conventions/testing.md).
describe('Orders / promo redemption concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;

  const suffix = randomUUID().slice(0, 8);
  const promoCode = `E2E-CONC-${suffix}`;
  const userIds: string[] = [];
  let productId: string;
  let colorId: string;
  let sizeId: string;
  let variantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      providers: [OrdersService, OrderAbilityFactory],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    ordersService = moduleFixture.get(OrdersService);

    const color = await prisma.color.create({
      data: { name: `E2E Color ${suffix}`, hexCode: '#123456' },
    });
    colorId = color.id;

    const size = await prisma.size.create({
      data: { name: `E2E-${suffix}`, position: 9000 },
    });
    sizeId = size.id;

    const product = await prisma.product.create({
      data: { name: `E2E Concurrency Tee ${suffix}` },
    });
    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        colorId,
        sizeId,
        sku: `E2E-CONC-${suffix}`,
        priceCents: 2000,
        stock: 10,
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
          email: `e2e-conc-${label}-${suffix}@example.com`,
          passwordHash: 'not-a-real-hash',
          firstName: 'E2E',
          lastName: 'Concurrency',
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

  it('lets exactly one of two simultaneous checkouts redeem a single-use promo code', async () => {
    const [userA, userB] = await Promise.all(
      userIds.map((id) => prisma.user.findUniqueOrThrow({ where: { id } })),
    );

    const results = await Promise.allSettled([
      ordersService.create(userA, { promoCode }),
      ordersService.create(userB, { promoCode }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);

    const redemptionCount = await prisma.promoRedemption.count({
      where: { promoCode: { code: promoCode } },
    });
    expect(redemptionCount).toBe(1);
  });
});
