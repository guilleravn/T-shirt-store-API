import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersService } from '../src/sales/orders.service';
import { OrderAbilityFactory } from '../src/sales/casl/order-ability.factory';
import { CheckoutQueueService } from '../src/sales/queue/checkout-queue.service';
import { OrderStatus, UserRole } from '../generated/prisma/client';

describe('OrdersService (e2e, real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;

  const suffix = randomUUID().slice(0, 8);
  let productId: string;
  let colorId: string;
  let sizeId: string;
  let variantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      providers: [
        OrdersService,
        OrderAbilityFactory,
        // Not exercised by these tests — a real instance would need a real BullMQ/Redis-backed
        // queue, which is what SalesModule's own registration already provides; this is only
        // here to satisfy OrdersService's constructor when it's re-provided at this root level.
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
      data: { name: `E2E OrdersSvc Color ${suffix}`, hexCode: '#654321' },
    });
    colorId = color.id;

    const size = await prisma.size.create({
      data: { name: `EO-${suffix}`, position: 9100 },
    });
    sizeId = size.id;

    const product = await prisma.product.create({
      data: { name: `E2E OrdersSvc Tee ${suffix}` },
    });
    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        colorId,
        sizeId,
        sku: `E2E-ORD-${suffix}`,
        priceCents: 1500,
        stock: 10,
      },
    });
    variantId = variant.id;
  });

  afterAll(async () => {
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.color.deleteMany({ where: { id: colorId } });
    await prisma.size.deleteMany({ where: { id: sizeId } });
    await app.close();
  });

  async function createFixtureUser(label: string) {
    const user = await prisma.user.create({
      data: {
        email: `e2e-ord-${label}-${suffix}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'E2E',
        lastName: 'OrdersSvc',
        role: UserRole.CLIENT,
      },
    });
    const cart = await prisma.cart.create({ data: { userId: user.id } });
    await prisma.cartItem.create({
      data: { cartId: cart.id, productVariantId: variantId, quantity: 1 },
    });
    return user;
  }

  describe('detail() field allowlist', () => {
    let userId: string;

    afterAll(async () => {
      await prisma.order.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it('never exposes more than {id, firstName, lastName} for customer/deliveryPerson', async () => {
      const user = await createFixtureUser('detail');
      userId = user.id;

      const created = await ordersService.create(user, {});
      const detail = await ordersService.detail(created.id, user);

      expect(detail.customer).not.toBeNull();
      expect(Object.keys(detail.customer!).sort()).toEqual(
        ['firstName', 'id', 'lastName'].sort(),
      );
      expect(detail.deliveryPerson).toBeNull();
    });
  });

  describe('create() pending-order race (R1/business-invariants: one PENDING order per user)', () => {
    let userId: string;

    afterAll(async () => {
      await prisma.order.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });

    it('lets exactly one of two simultaneous checkouts by the same user create a PENDING order', async () => {
      const user = await createFixtureUser('race');
      userId = user.id;

      const results = await Promise.allSettled([
        ordersService.create(user, {}),
        ordersService.create(user, {}),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = rejected[0].reason as ConflictException;
      expect(reason).toBeInstanceOf(ConflictException);
      // Distinguishes the new partial-unique-index path from the pre-existing (and here
      // semantically wrong) "duplicate order_items row" P2002 message mapPrismaWriteError would
      // otherwise produce for any P2002 on this transaction.
      expect(reason.message).toBe('You already have a pending order');

      const pendingCount = await prisma.order.count({
        where: { userId, status: 'PENDING' },
      });
      expect(pendingCount).toBe(1);
    });
  });

  describe('updateStatus() race (fix: conditional write on the pre-checked status)', () => {
    let userId: string;
    let managerId: string;
    let orderId: string;

    afterAll(async () => {
      await prisma.order.deleteMany({ where: { id: orderId } });
      await prisma.user.deleteMany({
        where: { id: { in: [userId, managerId] } },
      });
    });

    it('lets exactly one of two simultaneous PAID -> PROCESSING calls on the same order succeed', async () => {
      const user = await createFixtureUser('status-race');
      userId = user.id;

      const manager = await prisma.user.create({
        data: {
          email: `e2e-ord-status-race-manager-${suffix}@example.com`,
          passwordHash: 'not-a-real-hash',
          firstName: 'E2E',
          lastName: 'Manager',
          role: UserRole.MANAGER,
        },
      });
      managerId = manager.id;

      const order = await prisma.order.create({
        data: {
          userId: user.id,
          status: OrderStatus.PAID,
          subtotalCents: 1500,
          discountCents: 0,
          totalCents: 1500,
          items: {
            create: [
              {
                productVariantId: variantId,
                quantity: 1,
                unitPriceCents: 1500,
                productName: 'E2E OrdersSvc Tee',
                variantLabel: 'Concurrency / Test',
              },
            ],
          },
          statusHistory: {
            create: { status: OrderStatus.PAID, changedByUserId: user.id },
          },
        },
      });
      orderId = order.id;

      const results = await Promise.allSettled([
        ordersService.updateStatus(order.id, manager, {
          status: OrderStatus.PROCESSING,
        }),
        ordersService.updateStatus(order.id, manager, {
          status: OrderStatus.PROCESSING,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = rejected[0].reason as ConflictException;
      expect(reason).toBeInstanceOf(ConflictException);
      expect(reason.message).toBe(
        'Order status changed concurrently, please retry',
      );

      const finalOrder = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalOrder.status).toBe(OrderStatus.PROCESSING);

      const processingEntries = await prisma.orderStatusHistory.count({
        where: { orderId: order.id, status: OrderStatus.PROCESSING },
      });
      expect(processingEntries).toBe(1);
    });
  });
});
