import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderAbilityFactory } from './casl/order-ability.factory';
import { StripeService } from './stripe/stripe.service';
import {
  DiscountType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserRole,
} from '../../generated/prisma/client';

function buildPrismaMock() {
  const prisma = {
    order: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    productVariant: { findUnique: jest.fn() },
    payment: { findFirst: jest.fn(), create: jest.fn() },
    promoRedemption: { count: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
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

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    deliveryPersonId: null,
    status: OrderStatus.PENDING,
    totalCents: 5000,
    currency: 'USD',
    ...overrides,
  };
}

function buildVariant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'var-1',
    priceCents: 2500,
    stock: 10,
    isActive: true,
    deletedAt: null,
    color: { id: 'col-1', name: 'Black' },
    size: { id: 'siz-1', name: 'M' },
    product: {
      id: 'prod-1',
      name: 'Classic Tee',
      isActive: true,
      deletedAt: null,
    },
    ...overrides,
  };
}

describe('CheckoutService', () => {
  let service: CheckoutService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let stripeService: {
    createPaymentIntent: jest.Mock;
    retrievePaymentIntent: jest.Mock;
    createPaymentLink: jest.Mock;
  };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    stripeService = {
      createPaymentIntent: jest.fn(),
      retrievePaymentIntent: jest.fn(),
      createPaymentLink: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        CheckoutService,
        OrderAbilityFactory,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeService, useValue: stripeService },
      ],
    }).compile();

    service = module.get(CheckoutService);
  });

  describe('createPaymentIntent', () => {
    it('throws NotFoundException when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent(buildUser(), { orderId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects a CLIENT paying for someone else's order", async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ userId: 'someone-else' }),
      );

      await expect(
        service.createPaymentIntent(buildUser(), { orderId: 'order-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a non-PENDING order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: OrderStatus.PAID }),
      );

      await expect(
        service.createPaymentIntent(buildUser(), { orderId: 'order-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('retrieves the existing PaymentIntent instead of creating a second one', async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        stripeReferenceId: 'pi_existing',
      });
      stripeService.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_existing',
        client_secret: 'secret_existing',
      });

      const result = await service.createPaymentIntent(buildUser(), {
        orderId: 'order-1',
      });

      expect(stripeService.retrievePaymentIntent).toHaveBeenCalledWith(
        'pi_existing',
      );
      expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(result.clientSecret).toBe('secret_existing');
    });

    it('throws ConflictException when the existing PaymentIntent has no client secret', async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        stripeReferenceId: 'pi_existing',
      });
      stripeService.retrievePaymentIntent.mockResolvedValue({
        id: 'pi_existing',
        client_secret: null,
      });

      await expect(
        service.createPaymentIntent(buildUser(), { orderId: 'order-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a new PaymentIntent and payment row when none exists yet', async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());
      prisma.payment.findFirst.mockResolvedValue(null);
      stripeService.createPaymentIntent.mockResolvedValue({
        id: 'pi_new',
        client_secret: 'secret_new',
      });

      const result = await service.createPaymentIntent(buildUser(), {
        orderId: 'order-1',
      });

      expect(stripeService.createPaymentIntent).toHaveBeenCalledWith({
        amountCents: 5000,
        currency: 'USD',
        orderId: 'order-1',
      });
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-1',
          method: PaymentMethod.PAYMENT_INTENT,
          stripeReferenceId: 'pi_new',
          amountCents: 5000,
          currency: 'USD',
          status: PaymentStatus.PENDING,
        },
      });
      expect(result).toEqual({
        orderId: 'order-1',
        clientSecret: 'secret_new',
      });
    });

    it('throws ConflictException when Stripe returns no client secret for a new intent', async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());
      prisma.payment.findFirst.mockResolvedValue(null);
      stripeService.createPaymentIntent.mockResolvedValue({
        id: 'pi_new',
        client_secret: null,
      });

      await expect(
        service.createPaymentIntent(buildUser(), { orderId: 'order-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate payment-row race to a clear ConflictException', async () => {
      prisma.order.findUnique.mockResolvedValue(buildOrder());
      prisma.payment.findFirst.mockResolvedValue(null);
      stripeService.createPaymentIntent.mockResolvedValue({
        id: 'pi_new',
        client_secret: 'secret_new',
      });
      prisma.payment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createPaymentIntent(buildUser(), { orderId: 'order-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('createPaymentLink', () => {
    it('throws ConflictException when the user already has a pending order', async () => {
      prisma.order.findFirst.mockResolvedValue(buildOrder());

      await expect(
        service.createPaymentLink(buildUser(), {
          productVariantId: 'var-1',
          quantity: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.productVariant.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the variant does not exist', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(
        service.createPaymentLink(buildUser(), {
          productVariantId: 'missing',
          quantity: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the variant is not purchasable', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue(
        buildVariant({ stock: 0 }),
      );

      await expect(
        service.createPaymentLink(buildUser(), {
          productVariantId: 'var-1',
          quantity: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates a one-item order and a Checkout Session with no promo', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue(buildVariant());
      prisma.order.create.mockResolvedValue(
        buildOrder({ id: 'order-2', totalCents: 2500 }),
      );
      stripeService.createPaymentLink.mockResolvedValue({
        id: 'cs_1',
        url: 'https://checkout.stripe.com/cs_1',
        expires_at: 1700000000,
      });

      const result = await service.createPaymentLink(buildUser(), {
        productVariantId: 'var-1',
        quantity: 2,
      });

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          subtotalCents: 5000,
          discountCents: 0,
          totalCents: 5000,
          items: {
            create: [
              expect.objectContaining({
                productVariantId: 'var-1',
                quantity: 2,
                unitPriceCents: 2500,
                productName: 'Classic Tee',
                variantLabel: 'Black / M',
              }) as Record<string, unknown>,
            ],
          },
        }) as Record<string, unknown>,
      });
      expect(stripeService.createPaymentLink).toHaveBeenCalledWith({
        unitAmountCents: 2500,
        quantity: 2,
        currency: 'USD',
        productName: 'Classic Tee',
        orderId: 'order-2',
        successUrl: 'https://example.com/checkout/success',
        cancelUrl: 'https://example.com/checkout/cancel',
      });
      expect(result.paymentUrl).toBe('https://checkout.stripe.com/cs_1');
      expect(result.expiresAt).toEqual(new Date(1700000000 * 1000));
      expect(prisma.promoRedemption.create).not.toHaveBeenCalled();
    });

    it('passes through explicit successUrl/cancelUrl when given', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue(buildVariant());
      prisma.order.create.mockResolvedValue(buildOrder({ id: 'order-2' }));
      stripeService.createPaymentLink.mockResolvedValue({
        id: 'cs_1',
        url: 'https://checkout.stripe.com/cs_1',
        expires_at: 1700000000,
      });

      await service.createPaymentLink(buildUser(), {
        productVariantId: 'var-1',
        quantity: 1,
        successUrl: 'https://mystore.test/ok',
        cancelUrl: 'https://mystore.test/cancel',
      });

      expect(stripeService.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: 'https://mystore.test/ok',
          cancelUrl: 'https://mystore.test/cancel',
        }),
      );
    });

    it('locks, validates, and applies a promo code discount', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue(buildVariant());
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
      prisma.order.create.mockResolvedValue(
        buildOrder({ id: 'order-2', discountCents: 250, totalCents: 2250 }),
      );
      stripeService.createPaymentLink.mockResolvedValue({
        id: 'cs_1',
        url: 'https://checkout.stripe.com/cs_1',
        expires_at: 1700000000,
      });

      await service.createPaymentLink(buildUser(), {
        productVariantId: 'var-1',
        quantity: 1,
        promoCode: 'SAVE10',
      });

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discountCents: 250,
          totalCents: 2250,
        }) as Record<string, unknown>,
      });
      expect(prisma.promoRedemption.create).toHaveBeenCalledWith({
        data: { promoCodeId: 'promo-1', orderId: 'order-2' },
      });
    });

    it('maps the one_pending_order_per_user race to a clear ConflictException', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue(buildVariant());
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
        await service.createPaymentLink(buildUser(), {
          productVariantId: 'var-1',
          quantity: 1,
        });
      } catch (thrown) {
        caught = thrown;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).message).toBe(
        'You already have a pending order',
      );
      expect(stripeService.createPaymentLink).not.toHaveBeenCalled();
    });

    it('throws ConflictException when Stripe returns no session url', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.productVariant.findUnique.mockResolvedValue(buildVariant());
      prisma.order.create.mockResolvedValue(buildOrder({ id: 'order-2' }));
      stripeService.createPaymentLink.mockResolvedValue({
        id: 'cs_1',
        url: null,
        expires_at: 1700000000,
      });

      await expect(
        service.createPaymentLink(buildUser(), {
          productVariantId: 'var-1',
          quantity: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
