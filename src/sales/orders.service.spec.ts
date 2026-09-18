import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderAbilityFactory } from './casl/order-ability.factory';
import { CheckoutQueueService } from './queue/checkout-queue.service';
import {
  DiscountType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  UserRole,
} from '../../generated/prisma/client';

function buildPrismaMock() {
  const prisma = {
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    cart: { findUnique: jest.fn() },
    cartItem: { findMany: jest.fn() },
    productVariant: { update: jest.fn() },
    orderItem: { update: jest.fn() },
    payment: { findFirst: jest.fn() },
    promoRedemption: { count: jest.fn(), create: jest.fn() },
    user: { findFirst: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  prisma.payment.findFirst.mockResolvedValue(null);
  prisma.order.updateMany.mockResolvedValue({ count: 1 });
  return prisma;
}

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'hash',
    firstName: 'Test',
    lastName: 'User',
    role: UserRole.CLIENT,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const color = { id: 'col-1', name: 'Black', hexCode: '#000000' };
const size = { id: 'siz-1', name: 'M', position: 20 };

function buildCartItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item-1',
    productVariantId: 'var-1',
    quantity: 2,
    variant: {
      id: 'var-1',
      sku: 'TEE-BLK-M',
      priceCents: 1500,
      stock: 10,
      isActive: true,
      deletedAt: null,
      color,
      size,
      product: {
        id: 'prod-1',
        name: 'Classic Tee',
        isActive: true,
        deletedAt: null,
      },
    },
    ...overrides,
  };
}

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    deliveryPersonId: null,
    status: OrderStatus.PENDING,
    subtotalCents: 3000,
    discountCents: 0,
    totalCents: 3000,
    currency: 'USD',
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 'item-1',
        productVariantId: 'var-1',
        productName: 'Classic Tee',
        variantLabel: 'Black / M',
        quantity: 2,
        unitPriceCents: 1500,
        stockDecremented: true,
      },
    ],
    statusHistory: [
      {
        status: OrderStatus.PENDING,
        note: null,
        changedByUserId: 'user-1',
        createdAt: new Date(),
      },
    ],
    user: { id: 'user-1', firstName: 'Test', lastName: 'User' },
    deliveryPerson: null,
    promoRedemption: null,
    payments: [],
    ...overrides,
  };
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let checkoutQueueService: { enqueueRefund: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    checkoutQueueService = { enqueueRefund: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        OrderAbilityFactory,
        { provide: PrismaService, useValue: prisma },
        { provide: CheckoutQueueService, useValue: checkoutQueueService },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  describe('create', () => {
    it('throws ConflictException when the user already has a pending order', async () => {
      prisma.order.findFirst.mockResolvedValue(buildOrder());

      await expect(service.create(buildUser(), {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.cart.findUnique).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when there is no cart', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue(null);

      await expect(service.create(buildUser(), {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the cart is empty', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([]);

      await expect(service.create(buildUser(), {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws ConflictException when a cart line is no longer purchasable', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([
        buildCartItem({
          variant: {
            ...buildCartItem().variant,
            stock: 0,
          },
        }),
      ]);

      await expect(service.create(buildUser(), {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('freezes the cart into an order with no promo', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([buildCartItem()]);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      prisma.order.findUnique.mockResolvedValue(buildOrder());

      const result = await service.create(buildUser(), {});

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          status: OrderStatus.PENDING,
          subtotalCents: 3000,
          discountCents: 0,
          totalCents: 3000,
          items: {
            create: [
              expect.objectContaining({
                productVariantId: 'var-1',
                quantity: 2,
                unitPriceCents: 1500,
                productName: 'Classic Tee',
                variantLabel: 'Black / M',
              }) as Record<string, unknown>,
            ],
          },
        }) as Record<string, unknown>,
      });
      expect(result.id).toBe('order-1');
      expect(prisma.promoRedemption.create).not.toHaveBeenCalled();
    });

    it('locks, validates, and redeems a valid promo code', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([buildCartItem()]);
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'promo-1',
          discountType: DiscountType.PERCENTAGE,
          discountValue: 10,
          minPurchaseCents: null,
          usageLimit: null,
          expiresAt: null,
          isActive: true,
        },
      ]);
      prisma.promoRedemption.count.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ discountCents: 300, totalCents: 2700 }),
      );

      await service.create(buildUser(), { promoCode: 'SAVE10' });

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discountCents: 300,
          totalCents: 2700,
        }) as Record<string, unknown>,
      });
      expect(prisma.promoRedemption.create).toHaveBeenCalledWith({
        data: { promoCodeId: 'promo-1', orderId: 'order-1' },
      });
    });

    it('throws BadRequestException when the promo code does not exist', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([buildCartItem()]);
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.create(buildUser(), { promoCode: 'NOPE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the promo code usage limit is already reached', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([buildCartItem()]);
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'promo-1',
          discountType: DiscountType.FIXED,
          discountValue: 500,
          minPurchaseCents: null,
          usageLimit: 1,
          expiresAt: null,
          isActive: true,
        },
      ]);
      prisma.promoRedemption.count.mockResolvedValue(1);

      await expect(
        service.create(buildUser(), { promoCode: 'ONEUSE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('maps a CHECK-constraint violation to BadRequestException instead of a raw 500', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([buildCartItem()]);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('check failed', {
          code: 'P2039',
          clientVersion: 'test',
        }),
      );

      await expect(service.create(buildUser(), {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('maps the one_pending_order_per_user index violation to a clear ConflictException', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findMany.mockResolvedValue([buildCartItem()]);
      const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      });
      Object.assign(error, {
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage:
                'duplicate key value violates unique constraint "one_pending_order_per_user"',
            },
          },
        },
      });
      prisma.$transaction.mockRejectedValue(error);

      let caught: unknown;
      try {
        await service.create(buildUser(), {});
      } catch (thrown) {
        caught = thrown;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).message).toBe(
        'You already have a pending order',
      );
    });
  });

  describe('list', () => {
    it('scopes CLIENT to their own orders', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.list(buildUser({ role: UserRole.CLIENT, id: 'client-1' }), {
        limit: 20,
        offset: 0,
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'client-1' },
        }),
      );
    });

    it('scopes DELIVERY to orders assigned to them', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.list(
        buildUser({ role: UserRole.DELIVERY, id: 'delivery-1' }),
        { limit: 20, offset: 0 },
      );

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deliveryPersonId: 'delivery-1' },
        }),
      );
    });

    it('rejects a CLIENT filtering by userId', async () => {
      await expect(
        service.list(buildUser({ role: UserRole.CLIENT }), {
          userId: 'someone-else',
          limit: 20,
          offset: 0,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('lets MANAGER filter by userId and deliveryPersonId', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.list(buildUser({ role: UserRole.MANAGER }), {
        userId: 'client-1',
        deliveryPersonId: 'delivery-1',
        limit: 20,
        offset: 0,
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'client-1', deliveryPersonId: 'delivery-1' },
        }),
      );
    });

    it('maps itemCount and promoCode from the aggregated fields', async () => {
      prisma.order.count.mockResolvedValue(1);
      prisma.order.findMany.mockResolvedValue([
        {
          ...buildOrder(),
          _count: { items: 3 },
          promoRedemption: { promoCode: { code: 'SAVE10' } },
        },
      ]);

      const result = await service.list(buildUser({ role: UserRole.MANAGER }), {
        limit: 20,
        offset: 0,
      });

      expect(result.data[0].itemCount).toBe(3);
      expect(result.data[0].promoCode).toBe('SAVE10');
      expect(result.data[0].paymentMethod).toBeNull();
    });
  });

  describe('detail', () => {
    it('throws NotFoundException when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.detail('missing', buildUser()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the owning CLIENT read their own order', async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());

      const result = await service.detail(
        'order-1',
        buildUser({ id: 'user-1', role: UserRole.CLIENT }),
      );

      expect(result.id).toBe('order-1');
      expect(result.items).toHaveLength(1);
    });

    it('never queries a full user row for customer/deliveryPerson', async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());

      await service.detail('order-1', buildUser());

      expect(prisma.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            user: { select: { id: true, firstName: true, lastName: true } },
            deliveryPerson: {
              select: { id: true, firstName: true, lastName: true },
            },
          }) as Record<string, unknown>,
        }),
      );
    });

    it("rejects a CLIENT reading someone else's order", async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ userId: 'someone-else' }),
      );

      await expect(
        service.detail(
          'order-1',
          buildUser({ id: 'user-1', role: UserRole.CLIENT }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets MANAGER read any order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ userId: 'someone-else' }),
      );

      await expect(
        service.detail('order-1', buildUser({ role: UserRole.MANAGER })),
      ).resolves.toBeDefined();
    });

    it('lets the assigned DELIVERY user read the order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ deliveryPersonId: 'delivery-1' }),
      );

      await expect(
        service.detail(
          'order-1',
          buildUser({ id: 'delivery-1', role: UserRole.DELIVERY }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects an unassigned DELIVERY user', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ deliveryPersonId: 'someone-else' }),
      );

      await expect(
        service.detail(
          'order-1',
          buildUser({ id: 'delivery-1', role: UserRole.DELIVERY }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundException when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('missing', buildUser({ role: UserRole.MANAGER }), {
          status: OrderStatus.PROCESSING,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets MANAGER move PAID -> PROCESSING', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(buildOrder({ status: OrderStatus.PAID }))
        .mockResolvedValueOnce(buildOrder({ status: OrderStatus.PROCESSING }));

      await service.updateStatus(
        'order-1',
        buildUser({ role: UserRole.MANAGER }),
        { status: OrderStatus.PROCESSING },
      );

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: OrderStatus.PAID },
        data: { status: OrderStatus.PROCESSING },
      });
    });

    it('throws ConflictException when the status changed concurrently between the pre-check and the write', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: OrderStatus.PAID }),
      );
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateStatus('order-1', buildUser({ role: UserRole.MANAGER }), {
          status: OrderStatus.PROCESSING,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.orderStatusHistory.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when MANAGER attempts the DELIVERY-only SHIPPED -> DELIVERED transition', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({
          status: OrderStatus.SHIPPED,
          deliveryPersonId: 'delivery-1',
        }),
      );

      await expect(
        service.updateStatus('order-1', buildUser({ role: UserRole.MANAGER }), {
          status: OrderStatus.DELIVERED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects PENDING -> SHIPPED as an invalid transition', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: OrderStatus.PENDING }),
      );

      await expect(
        service.updateStatus('order-1', buildUser({ role: UserRole.MANAGER }), {
          status: OrderStatus.SHIPPED,
          deliveryPersonId: 'delivery-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('sets deliveryPersonId only on the SHIPPED transition, and validates the role', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(buildOrder({ status: OrderStatus.PROCESSING }))
        .mockResolvedValueOnce(buildOrder({ status: OrderStatus.SHIPPED }));
      prisma.user.findFirst.mockResolvedValue({
        id: 'delivery-1',
        role: UserRole.DELIVERY,
      });

      await service.updateStatus(
        'order-1',
        buildUser({ role: UserRole.MANAGER }),
        { status: OrderStatus.SHIPPED, deliveryPersonId: 'delivery-1' },
      );

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'delivery-1', role: UserRole.DELIVERY },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: OrderStatus.PROCESSING },
        data: { status: OrderStatus.SHIPPED, deliveryPersonId: 'delivery-1' },
      });
    });

    it('rejects SHIPPED without a valid deliveryPersonId', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: OrderStatus.PROCESSING }),
      );
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus('order-1', buildUser({ role: UserRole.MANAGER }), {
          status: OrderStatus.SHIPPED,
          deliveryPersonId: 'not-a-courier',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lets the assigned DELIVERY user move SHIPPED -> DELIVERED', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(
          buildOrder({
            status: OrderStatus.SHIPPED,
            deliveryPersonId: 'delivery-1',
          }),
        )
        .mockResolvedValueOnce(
          buildOrder({
            status: OrderStatus.DELIVERED,
            deliveryPersonId: 'delivery-1',
          }),
        );

      await service.updateStatus(
        'order-1',
        buildUser({ id: 'delivery-1', role: UserRole.DELIVERY }),
        { status: OrderStatus.DELIVERED },
      );

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: OrderStatus.SHIPPED },
        data: { status: OrderStatus.DELIVERED },
      });
    });

    it('rejects an unassigned DELIVERY user before even checking the transition', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({
          status: OrderStatus.SHIPPED,
          deliveryPersonId: 'someone-else',
        }),
      );

      await expect(
        service.updateStatus(
          'order-1',
          buildUser({ id: 'delivery-1', role: UserRole.DELIVERY }),
          { status: OrderStatus.DELIVERED },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a CLIENT attempting any status update', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ userId: 'client-1' }),
      );

      await expect(
        service.updateStatus(
          'order-1',
          buildUser({ id: 'client-1', role: UserRole.CLIENT }),
          { status: OrderStatus.PROCESSING },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cancel', () => {
    it('throws NotFoundException when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.cancel('missing', buildUser(), {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the owning CLIENT cancel a PENDING order', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(buildOrder({ status: OrderStatus.PENDING }))
        .mockResolvedValueOnce(buildOrder({ status: OrderStatus.CANCELLED }));
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ status: OrderStatus.PENDING }),
      );

      await service.cancel(
        'order-1',
        buildUser({ id: 'user-1', role: UserRole.CLIENT }),
        { reason: 'changed my mind' },
      );

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED },
      });
    });

    it('throws ConflictException when it loses the race to cancel the row concurrently', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: OrderStatus.PENDING }),
      );
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ status: OrderStatus.PENDING }),
      );
      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.cancel(
          'order-1',
          buildUser({ id: 'user-1', role: UserRole.CLIENT }),
          {},
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.orderStatusHistory.create).not.toHaveBeenCalled();
    });

    it('rejects cancelling an already-SHIPPED order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: OrderStatus.SHIPPED }),
      );

      await expect(
        service.cancel(
          'order-1',
          buildUser({ id: 'user-1', role: UserRole.CLIENT }),
          {},
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects a CLIENT cancelling someone else's order", async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ userId: 'someone-else', status: OrderStatus.PENDING }),
      );

      await expect(
        service.cancel(
          'order-1',
          buildUser({ id: 'user-1', role: UserRole.CLIENT }),
          {},
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a DELIVERY user cancelling an order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({
          status: OrderStatus.PENDING,
          deliveryPersonId: 'delivery-1',
        }),
      );

      await expect(
        service.cancel(
          'order-1',
          buildUser({ id: 'delivery-1', role: UserRole.DELIVERY }),
          {},
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets MANAGER cancel any cancellable order', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.PAID }),
        )
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.CANCELLED }),
        );
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ userId: 'someone-else', status: OrderStatus.PAID }),
      );

      await expect(
        service.cancel('order-1', buildUser({ role: UserRole.MANAGER }), {}),
      ).resolves.toBeDefined();
    });

    it('does not restore stock or enqueue a refund when cancelling a still-PENDING order', async () => {
      // A real PENDING order never has stockDecremented: true on any line — only the webhook's
      // finalizeSuccessfulPayment ever sets it, and that only runs once PENDING is left behind.
      const pendingOrder = buildOrder({
        status: OrderStatus.PENDING,
        items: [
          {
            id: 'item-1',
            productVariantId: 'var-1',
            productName: 'Classic Tee',
            variantLabel: 'Black / M',
            quantity: 2,
            unitPriceCents: 1500,
            stockDecremented: false,
          },
        ],
      });
      prisma.order.findUnique
        .mockResolvedValueOnce(pendingOrder)
        .mockResolvedValueOnce(buildOrder({ status: OrderStatus.CANCELLED }));
      prisma.order.findUniqueOrThrow.mockResolvedValue(pendingOrder);

      await service.cancel(
        'order-1',
        buildUser({ id: 'user-1', role: UserRole.CLIENT }),
        {},
      );

      expect(prisma.productVariant.update).not.toHaveBeenCalled();
      expect(checkoutQueueService.enqueueRefund).not.toHaveBeenCalled();
    });

    it('restores stock for each item that was actually decremented when cancelling an already-PAID order', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.PAID }),
        )
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.CANCELLED }),
        );
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ userId: 'someone-else', status: OrderStatus.PAID }),
      );

      await service.cancel(
        'order-1',
        buildUser({ role: UserRole.MANAGER }),
        {},
      );

      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        data: { stock: { increment: 2 } },
      });
      expect(prisma.orderItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { stockDecremented: false },
      });
    });

    it('R8: skips restoring a line that was oversold and never actually decremented', async () => {
      const orderWithOversoldLine = buildOrder({
        userId: 'someone-else',
        status: OrderStatus.PAID,
        items: [
          {
            id: 'item-1',
            productVariantId: 'var-1',
            productName: 'Classic Tee',
            variantLabel: 'Black / M',
            quantity: 2,
            unitPriceCents: 1500,
            stockDecremented: false,
          },
        ],
      });
      prisma.order.findUnique
        .mockResolvedValueOnce(orderWithOversoldLine)
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.CANCELLED }),
        );
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderWithOversoldLine);

      await service.cancel(
        'order-1',
        buildUser({ role: UserRole.MANAGER }),
        {},
      );

      expect(prisma.productVariant.update).not.toHaveBeenCalled();
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the order stops being cancellable between the pre-check and the transaction (TOCTOU)', async () => {
      // The outer pre-check sees PENDING (still cancellable); by the time the transaction
      // actually reads the row, the webhook has already moved it to SHIPPED — the fresh,
      // in-transaction check must be what decides, not the stale value captured earlier.
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: OrderStatus.PENDING }),
      );
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ status: OrderStatus.SHIPPED }),
      );

      await expect(
        service.cancel(
          'order-1',
          buildUser({ id: 'user-1', role: UserRole.CLIENT }),
          {},
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('enqueues a refund when a SUCCEEDED payment exists for the cancelled order', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(
          buildOrder({
            userId: 'someone-else',
            status: OrderStatus.PROCESSING,
          }),
        )
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.CANCELLED }),
        );
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ userId: 'someone-else', status: OrderStatus.PROCESSING }),
      );
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        stripeReferenceId: 'pi_1',
        status: PaymentStatus.SUCCEEDED,
      });

      await service.cancel(
        'order-1',
        buildUser({ role: UserRole.MANAGER }),
        {},
      );

      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: { orderId: 'order-1', status: PaymentStatus.SUCCEEDED },
      });
      expect(checkoutQueueService.enqueueRefund).toHaveBeenCalledWith({
        paymentId: 'pay-1',
        stripeReferenceId: 'pi_1',
      });
    });

    it('does not enqueue a refund when no SUCCEEDED payment exists', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.PAID }),
        )
        .mockResolvedValueOnce(
          buildOrder({ userId: 'someone-else', status: OrderStatus.CANCELLED }),
        );
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ userId: 'someone-else', status: OrderStatus.PAID }),
      );
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.cancel(
        'order-1',
        buildUser({ role: UserRole.MANAGER }),
        {},
      );

      expect(checkoutQueueService.enqueueRefund).not.toHaveBeenCalled();
    });
  });
});
