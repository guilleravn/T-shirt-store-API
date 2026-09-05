import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CartService } from '../src/engagement/cart.service';
import { UserRole } from '../generated/prisma/client';

// fix(engagement): addItem now upserts inside a transaction instead of a separate
// find-then-create/update — two concurrent adds of the same not-yet-in-cart variant used to race
// on the @@unique([cartId, productVariantId]) constraint with an unhandled P2002. Hits the real
// database, per testing.md's rule that a race-condition test must never mock Prisma.
describe('Cart addItem concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cartService: CartService;

  const suffix = randomUUID().slice(0, 8);
  let userId: string;
  let colorId: string;
  let sizeId: string;
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    cartService = moduleFixture.get(CartService);

    const user = await prisma.user.create({
      data: {
        email: `e2e-cart-race-${suffix}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'E2E',
        lastName: 'Cart',
        role: UserRole.CLIENT,
      },
    });
    userId = user.id;

    const color = await prisma.color.create({
      data: { name: `E2E Cart Color ${suffix}`, hexCode: '#445566' },
    });
    colorId = color.id;

    const size = await prisma.size.create({
      data: { name: `ECR-${suffix}`, position: 9500 },
    });
    sizeId = size.id;

    const product = await prisma.product.create({
      data: { name: `E2E Cart Tee ${suffix}`, isActive: true },
    });
    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        colorId,
        sizeId,
        sku: `E2E-CART-${suffix}`,
        priceCents: 1000,
        stock: 50,
      },
    });
    variantId = variant.id;
  });

  afterAll(async () => {
    await prisma.cartItem.deleteMany({
      where: { productVariantId: variantId },
    });
    await prisma.cart.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.color.deleteMany({ where: { id: colorId } });
    await prisma.size.deleteMany({ where: { id: sizeId } });
    await app.close();
  });

  it('sums both quantities instead of throwing when two adds of the same variant race', async () => {
    const results = await Promise.allSettled([
      cartService.addItem(userId, { productVariantId: variantId, quantity: 2 }),
      cartService.addItem(userId, { productVariantId: variantId, quantity: 3 }),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const items = await prisma.cartItem.findMany({
      where: { productVariantId: variantId },
    });
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });
});
