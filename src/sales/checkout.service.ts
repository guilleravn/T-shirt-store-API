import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  User,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapPrismaWriteError } from '../common/prisma-error.util';
import {
  Action,
  authorizeOrderAction,
  OrderAbilityFactory,
  orderSubject,
} from './casl/order-ability.factory';
import { PaymentIntentResponseDto } from './dto/payment-intent-response.dto';
import { PaymentLinkResponseDto } from './dto/payment-link-response.dto';
import { lockAndValidatePromoCode } from './promo-redemption.util';
import { assertPurchasable } from './purchasability.util';
import { StripeService } from './stripe/stripe.service';

export interface CreatePaymentIntentInput {
  orderId: string;
}

export interface CreatePaymentLinkInput {
  productVariantId: string;
  quantity: number;
  promoCode?: string;
  successUrl?: string;
  cancelUrl?: string;
}

// No frontend exists yet (see CLAUDE.md — this project ships as an API). Stripe's hosted
// Checkout still requires a success_url, and openapi.yaml doesn't mark either URL required on
// this request, so a client that omits them still gets a working (if generic) redirect target.
const DEFAULT_SUCCESS_URL = 'https://example.com/checkout/success';
const DEFAULT_CANCEL_URL = 'https://example.com/checkout/cancel';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderAbilityFactory: OrderAbilityFactory,
    private readonly stripeService: StripeService,
  ) {}

  async createPaymentIntent(
    user: User,
    dto: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const ability = this.orderAbilityFactory.createForUser(user);
    authorizeOrderAction(ability, Action.Pay, orderSubject(order));

    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException('Order is not awaiting payment');
    }

    // Idempotency-Key is accepted but not stored/replayed (same call as POST /orders) — a
    // double-click here is instead absorbed by retrieving the still-usable PaymentIntent from
    // the first attempt rather than minting a second one Stripe would have to track separately.
    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        orderId: order.id,
        method: PaymentMethod.PAYMENT_INTENT,
        status: PaymentStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPayment) {
      const intent = await this.stripeService.retrievePaymentIntent(
        existingPayment.stripeReferenceId,
      );
      if (!intent.client_secret) {
        throw new ConflictException('Payment intent is no longer usable');
      }
      return new PaymentIntentResponseDto({
        orderId: order.id,
        clientSecret: intent.client_secret,
      });
    }

    const intent = await this.stripeService.createPaymentIntent({
      amountCents: order.totalCents,
      currency: order.currency,
      orderId: order.id,
    });
    if (!intent.client_secret) {
      throw new ConflictException('Stripe did not return a client secret');
    }

    try {
      // amountCents here is the charge intent (what we asked Stripe for), matching
      // orders.totalCents at this moment — the webhook is what later records what Stripe
      // actually settled, not this row (see the plan's Payment.amountCents decision).
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          method: PaymentMethod.PAYMENT_INTENT,
          stripeReferenceId: intent.id,
          amountCents: order.totalCents,
          currency: order.currency,
          status: PaymentStatus.PENDING,
        },
      });
    } catch (error) {
      throw mapPrismaWriteError(error, {
        uniqueViolation: 'A payment for this order is already in progress',
      });
    }

    return new PaymentIntentResponseDto({
      orderId: order.id,
      clientSecret: intent.client_secret,
    });
  }

  async createPaymentLink(
    user: User,
    dto: CreatePaymentLinkInput,
  ): Promise<PaymentLinkResponseDto> {
    const existingPending = await this.prisma.order.findFirst({
      where: { userId: user.id, status: OrderStatus.PENDING },
    });
    if (existingPending) {
      throw new ConflictException('You already have a pending order');
    }

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.productVariantId },
      include: { color: true, size: true, product: true },
    });
    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }
    assertPurchasable(variant.product, variant, dto.quantity);

    const subtotalCents = variant.priceCents * dto.quantity;

    let order: { id: string; totalCents: number; currency: string };
    try {
      order = await this.prisma.$transaction(async (tx) => {
        let discountCents = 0;
        let lockedPromoId: string | null = null;

        if (dto.promoCode) {
          const lock = await lockAndValidatePromoCode(
            tx,
            dto.promoCode,
            subtotalCents,
          );
          discountCents = lock.discountCents;
          lockedPromoId = lock.promoCodeId;
        }

        const totalCents = subtotalCents - discountCents;

        const createdOrder = await tx.order.create({
          data: {
            userId: user.id,
            status: OrderStatus.PENDING,
            subtotalCents,
            discountCents,
            totalCents,
            items: {
              create: [
                {
                  productVariantId: variant.id,
                  quantity: dto.quantity,
                  unitPriceCents: variant.priceCents,
                  productName: variant.product.name,
                  variantLabel: `${variant.color.name} / ${variant.size.name}`,
                },
              ],
            },
            statusHistory: {
              create: { status: OrderStatus.PENDING, changedByUserId: user.id },
            },
          },
        });

        if (lockedPromoId) {
          await tx.promoRedemption.create({
            data: { promoCodeId: lockedPromoId, orderId: createdOrder.id },
          });
        }

        return createdOrder;
      });
    } catch (error) {
      // Same partial-unique-index race OrdersService.create() guards against — this path also
      // inserts a real `orders` row through the same insert, so it's covered by the same index.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        this.isPendingOrderIndexViolation(error)
      ) {
        throw new ConflictException('You already have a pending order');
      }
      throw mapPrismaWriteError(error, {
        checkViolation: 'Order totals failed validation',
      });
    }

    // No `payments` row yet — per the DBML Note, a Payment Link's row is only born in the
    // webhook, since neither the Checkout Session nor its PaymentIntent exists until Stripe
    // creates them. If this call fails, the order still exists as a valid PENDING order
    // (recoverable via POST /checkout/payment-intent on the same orderId) — same tolerance
    // OrdersService.create() already has for a post-commit failure on its own reply step.
    const session = await this.stripeService.createPaymentLink({
      unitAmountCents: variant.priceCents,
      quantity: dto.quantity,
      currency: order.currency,
      productName: variant.product.name,
      orderId: order.id,
      successUrl: dto.successUrl ?? DEFAULT_SUCCESS_URL,
      cancelUrl: dto.cancelUrl ?? DEFAULT_CANCEL_URL,
    });
    if (!session.url || !session.expires_at) {
      throw new ConflictException('Stripe did not return a payment link');
    }

    return new PaymentLinkResponseDto({
      orderId: order.id,
      paymentUrl: session.url,
      expiresAt: new Date(session.expires_at * 1000),
      totalCents: order.totalCents,
      currency: order.currency,
    });
  }

  // Same detection as OrdersService.isPendingOrderIndexViolation — duplicated rather than
  // shared, since both are one-off adapter-error sniffing tied to their own catch block's error
  // variable, not real business logic like the promo lock or purchasability check.
  private isPendingOrderIndexViolation(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    if (error.code !== 'P2002') {
      return false;
    }
    const meta = error.meta as
      | { driverAdapterError?: { cause?: { originalMessage?: string } } }
      | undefined;
    return Boolean(
      meta?.driverAdapterError?.cause?.originalMessage?.includes(
        'one_pending_order_per_user',
      ),
    );
  }
}
