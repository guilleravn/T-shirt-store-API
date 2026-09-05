import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StripeWebhookService } from './stripe-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe/stripe.service';
import { OrderStatus, PaymentMethod } from '../../generated/prisma/client';

function buildPrismaMock() {
  const prisma = {
    stripeEvent: { update: jest.fn() },
    payment: { update: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
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

// Every `$queryRaw` call in the service goes through this one mock function, so a single test
// has to distinguish which of the three shapes it's answering (the idempotency-claim INSERT, the
// FOR UPDATE lock SELECT, or R3's stock-decrement UPDATE) by the SQL text itself.
function mockQueryRaw(
  prisma: ReturnType<typeof buildPrismaMock>,
  options: {
    claimed?: boolean;
    lockedProcessedAt?: Date | null;
    stock?: { stock: number }[];
  } = {},
) {
  const {
    claimed = true,
    lockedProcessedAt = null,
    stock = [{ stock: 3 }],
  } = options;
  prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('INSERT INTO stripe_events')) {
      return Promise.resolve(claimed ? [{ id: 'row-1' }] : []);
    }
    if (sql.includes('SELECT processed_at')) {
      return Promise.resolve([{ processedAt: lockedProcessedAt }]);
    }
    return Promise.resolve(stock);
  });
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
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns early without reprocessing an already-processed event', async () => {
    stripeService.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });
    // The claim loses (a row for this event already exists) and the FOR UPDATE lock finds it
    // already processed — this delivery must do nothing at all.
    mockQueryRaw(prisma, { claimed: false, lockedProcessedAt: new Date() });

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.stripeEvent.update).not.toHaveBeenCalled();
  });

  it('reprocesses an event whose claim lost but is still unprocessed under the lock (R4)', async () => {
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
    // The claim loses, but the row it locked is still NULL — either a previous attempt crashed
    // before marking it, or another delivery is genuinely running concurrently right now.
    mockQueryRaw(prisma, { claimed: false, lockedProcessedAt: null });
    prisma.payment.update.mockResolvedValue({
      id: 'pay-1',
      method: PaymentMethod.PAYMENT_INTENT,
    });
    prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
    prisma.cart.findUnique.mockResolvedValue(null);

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(prisma.payment.update).toHaveBeenCalled();
    expect(prisma.stripeEvent.update).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_1' },
      data: { processedAt: expect.any(Date) as Date },
    });
  });

  it('marks an unhandled event type as processed without touching any order', async () => {
    stripeService.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'customer.created',
      data: { object: {} },
    });
    mockQueryRaw(prisma, { claimed: true });

    await service.handleEvent(Buffer.from('{}'), 'sig');

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.stripeEvent.update).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_1' },
      data: { processedAt: expect.any(Date) as Date },
    });
  });

  describe('charge.refunded', () => {
    it('writes refundedAt on the matching payment once the charge is fully refunded', async () => {
      stripeService.constructWebhookEvent.mockReturnValue({
        id: 'evt_1',
        type: 'charge.refunded',
        data: {
          object: { payment_intent: 'pi_1', refunded: true },
        },
      });
      mockQueryRaw(prisma, { claimed: true });

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { stripeReferenceId: 'pi_1' },
        data: { refundedAt: expect.any(Date) as Date },
      });
    });

    it('does nothing when the charge is only partially refunded', async () => {
      stripeService.constructWebhookEvent.mockReturnValue({
        id: 'evt_1',
        type: 'charge.refunded',
        data: {
          object: { payment_intent: 'pi_1', refunded: false },
        },
      });
      mockQueryRaw(prisma, { claimed: true });

      await service.handleEvent(Buffer.from('{}'), 'sig');

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
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
      mockQueryRaw(prisma, { claimed: true });
    }

    it('updates the payment row with the amount Stripe actually settled', async () => {
      mockEvent();
      prisma.payment.update.mockResolvedValue({
        id: 'pay-1',
        method: PaymentMethod.PAYMENT_INTENT,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
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
      mockQueryRaw(prisma, { claimed: true, stock: [] }); // 0 rows affected — oversold
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
      mockQueryRaw(prisma, { claimed: true });
      prisma.payment.create.mockResolvedValue({
        id: 'pay-2',
        method: PaymentMethod.PAYMENT_LINK,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());

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
      mockQueryRaw(prisma, { claimed: true });
      prisma.payment.create.mockResolvedValue({
        id: 'pay-2',
        method: PaymentMethod.PAYMENT_LINK,
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(buildOrder());

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
