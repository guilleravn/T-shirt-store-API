import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StripeWebhookService } from './stripe-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe/stripe.service';
import {
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '../../generated/prisma/client';

function buildPrismaMock() {
  const prisma = {
    stripeEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    payment: { update: jest.fn(), create: jest.fn() },
    order: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    orderItem: { update: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    cart: { findUnique: jest.fn() },
    cartItem: { deleteMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    status: OrderStatus.PENDING,
    items: [
      {
        id: 'item-1',
        productVariantId: 'var-1',
        quantity: 2,
        productName: 'Classic Tee',
      },
    ],
    ...overrides,
  };
}

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let stripeService: { constructWebhookEvent: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    stripeService = { constructWebhookEvent: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripeService },
      ],
    }).compile();

    service = module.get(StripeWebhookService);
  });

  it('throws BadRequestException on an invalid signature, not a raw 500', async () => {
    stripeService.constructWebhookEvent.mockImplementation(() => {
      throw new Error('signature mismatch');
    });

    await expect(
      service.handleEvent(Buffer.from('{}'), 'bad-sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.stripeEvent.findUnique).not.toHaveBeenCalled();
  });

  it('returns early without reprocessing an already-processed event', async () => {
    stripeService.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });
    prisma.stripeEvent.findUnique.mockResolvedValue({
      stripeEventId: 'evt_1',
      processedAt: new Date(),
    });

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(prisma.stripeEvent.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stripeEvent.update).not.toHaveBeenCalled();
  });

  it('reprocesses an existing event whose processedAt is still NULL (R4)', async () => {
    stripeService.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          amount_received: 5000,
          metadata: { orderId: 'order-1' },
        },
      },
    });
    prisma.stripeEvent.findUnique.mockResolvedValue({
      stripeEventId: 'evt_1',
      processedAt: null,
    });
    prisma.payment.update.mockResolvedValue({
      id: 'pay-1',
      method: PaymentMethod.PAYMENT_INTENT,
    });
    prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
    prisma.$queryRaw.mockResolvedValue([{ stock: 3 }]);
    prisma.cart.findUnique.mockResolvedValue(null);

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(prisma.stripeEvent.create).not.toHaveBeenCalled();
    expect(prisma.stripeEvent.update).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_1' },
      data: { processedAt: expect.any(Date) as Date },
    });
  });

  it('treats a concurrent duplicate insert (P2002) as already being handled', async () => {
    stripeService.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });
    prisma.stripeEvent.findUnique.mockResolvedValue(null);
    prisma.stripeEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stripeEvent.update).not.toHaveBeenCalled();
  });

  it('marks an unhandled event type as processed without touching any order', async () => {
    stripeService.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'charge.refunded',
      data: { object: {} },
    });
    prisma.stripeEvent.findUnique.mockResolvedValue(null);

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stripeEvent.update).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_1' },
      data: { processedAt: expect.any(Date) as Date },
    });
  });

  describe('payment_intent.succeeded', () => {
    function mockEvent() {
      stripeService.constructWebhookEvent.mockReturnValue({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_1',
            amount_received: 5000,
            metadata: { orderId: 'order-1' },
          },
        },
      });
      prisma.stripeEvent.findUnique.mockResolvedValue(null);
    }

    it('updates the payment row with the amount Stripe actually settled', async () => {
      mockEvent();
      prisma.payment.update.mockResolvedValue({
        id: 'pay-1',
        method: PaymentMethod.PAYMENT_INTENT,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
      prisma.$queryRaw.mockResolvedValue([{ stock: 3 }]);
      prisma.cart.findUnique.mockResolvedValue(null);

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { stripeReferenceId: 'pi_1' },
        data: expect.objectContaining({ amountCents: 5000 }) as Record<
          string,
          unknown
        >,
      });
    });

    it('decrements stock, marks the order PAID, and clears the cart', async () => {
      mockEvent();
      prisma.payment.update.mockResolvedValue({
        id: 'pay-1',
        method: PaymentMethod.PAYMENT_INTENT,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
      prisma.$queryRaw.mockResolvedValue([{ stock: 3 }]);
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: OrderStatus.PAID },
      });
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-1',
          status: OrderStatus.PAID,
          changedByUserId: null,
          note: null,
        },
      });
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-1' },
      });
      expect(prisma.orderItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { stockDecremented: true },
      });
    });

    it('R8: an oversold line still commits PAID, logs a note, and skips only that decrement', async () => {
      mockEvent();
      prisma.payment.update.mockResolvedValue({
        id: 'pay-1',
        method: PaymentMethod.PAYMENT_INTENT,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
      prisma.$queryRaw.mockResolvedValue([]); // 0 rows affected — oversold
      prisma.cart.findUnique.mockResolvedValue(null);

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: OrderStatus.PAID },
      });
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: OrderStatus.PAID,
          note: expect.stringContaining('Classic Tee') as string,
        }) as Record<string, unknown>,
      });
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
    });

    it('does not re-decrement stock when the order is already PAID (Payment Link dual-event)', async () => {
      // A Payment Link purchase fires both checkout.session.completed and payment_intent.succeeded
      // for the same order (T-Shirt-constraints.sql) — R4 dedupes by stripeEventId, which does
      // nothing here since these are two distinct real events for the same underlying purchase.
      mockEvent();
      prisma.payment.update.mockResolvedValue({
        id: 'pay-1',
        method: PaymentMethod.PAYMENT_INTENT,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(
        buildOrder({ status: OrderStatus.PAID }),
      );

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderStatusHistory.create).not.toHaveBeenCalled();
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('does not clear the cart for a PAYMENT_LINK payment', async () => {
      stripeService.constructWebhookEvent.mockReturnValue({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            payment_intent: 'pi_2',
            amount_total: 2500,
            currency: 'usd',
            metadata: { orderId: 'order-1' },
          },
        },
      });
      prisma.stripeEvent.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue({
        id: 'pay-2',
        method: PaymentMethod.PAYMENT_LINK,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
      prisma.$queryRaw.mockResolvedValue([{ stock: 3 }]);

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.cart.findUnique).not.toHaveBeenCalled();
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('checkout.session.completed', () => {
    it('creates the payments row now, with the settled amount and uppercased currency', async () => {
      stripeService.constructWebhookEvent.mockReturnValue({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            payment_intent: 'pi_2',
            amount_total: 2500,
            currency: 'usd',
            metadata: { orderId: 'order-1' },
          },
        },
      });
      prisma.stripeEvent.findUnique.mockResolvedValue(null);
      prisma.payment.create.mockResolvedValue({
        id: 'pay-2',
        method: PaymentMethod.PAYMENT_LINK,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
      prisma.$queryRaw.mockResolvedValue([{ stock: 3 }]);

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-1',
          method: PaymentMethod.PAYMENT_LINK,
          stripeReferenceId: 'pi_2',
          amountCents: 2500,
          currency: 'USD',
          status: 'SUCCEEDED',
          paidAt: expect.any(Date) as Date,
        },
      });
    });
  });
});
