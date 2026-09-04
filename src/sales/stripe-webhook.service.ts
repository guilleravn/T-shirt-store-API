import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe/stripe.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  async handleEvent(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;
    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }

    // R4: the idempotency row is claimed BEFORE any domain processing, so a mid-transaction
    // failure below always leaves processed_at NULL for Stripe's retry to pick back up — never
    // marked prematurely, never left unmarked after a real success.
    const existing = await this.prisma.stripeEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (existing?.processedAt) {
      return;
    }
    if (!existing) {
      try {
        await this.prisma.stripeEvent.create({
          data: {
            stripeEventId: event.id,
            type: event.type,
            payload: event as unknown as Prisma.InputJsonValue,
            processedAt: null,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // A concurrent delivery of the same event just won the race — it will finish (or
          // Stripe will retry if it fails), so this delivery has nothing left to do.
          return;
        }
        throw error;
      }
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object);
        break;
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object);
        break;
      default:
        this.logger.log(`Ignoring unhandled Stripe event type: ${event.type}`);
    }

    await this.prisma.stripeEvent.update({
      where: { stripeEventId: event.id },
      data: { processedAt: new Date() },
    });
  }

  private async handlePaymentIntentSucceeded(
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    const orderId = intent.metadata.orderId;
    if (!orderId) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // amount_received is what Stripe actually settled — never orders.totalCents, which is
      // only the charge intent (see the plan's Payment.amountCents decision).
      const payment = await tx.payment.update({
        where: { stripeReferenceId: intent.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
          amountCents: intent.amount_received,
        },
      });
      await this.finalizeSuccessfulPayment(tx, orderId, payment.method);
    });
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const orderId = session.metadata?.orderId;
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!orderId || !paymentIntentId) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // No `payments` row exists yet for this flow — it's only born here, once Stripe's session
      // (and its underlying PaymentIntent) actually exist (DBML Note on `payments`).
      const payment = await tx.payment.create({
        data: {
          orderId,
          method: PaymentMethod.PAYMENT_LINK,
          stripeReferenceId: paymentIntentId,
          amountCents: session.amount_total ?? 0,
          currency: (session.currency ?? 'usd').toUpperCase(),
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
        },
      });
      await this.finalizeSuccessfulPayment(tx, orderId, payment.method);
    });
  }

  // R3's conditional decrement + R8's oversold-still-commits + the PAID transition + its
  // history row + cart clearing, shared by both event handlers so the two payment methods can
  // never drift on what "successfully paid" actually does to an order.
  private async finalizeSuccessfulPayment(
    tx: Prisma.TransactionClient,
    orderId: string,
    method: PaymentMethod,
  ): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    const oversoldItems: string[] = [];
    for (const item of order.items) {
      const rows = await tx.$queryRaw<{ stock: number }[]>`
        UPDATE product_variants SET stock = stock - ${item.quantity}
         WHERE id = ${item.productVariantId} AND stock >= ${item.quantity}
         RETURNING stock
      `;
      if (rows.length === 0) {
        oversoldItems.push(item.productName);
      }
    }

    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAID },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        status: OrderStatus.PAID,
        // NULL, not the buyer's id — the webhook made this change, not a person (matches
        // OrderStatusHistoryEntrySource's existing nullable field).
        changedByUserId: null,
        note: oversoldItems.length
          ? `Oversold: insufficient stock for ${oversoldItems.join(', ')}`
          : null,
      },
    });

    // Only the cart-checkout flow (Payment Intent) ever drew from the cart — a Payment Link
    // purchase never touched it, so clearing it here would delete unrelated items the buyer is
    // still browsing.
    if (method === PaymentMethod.PAYMENT_INTENT) {
      const cart = await tx.cart.findUnique({
        where: { userId: order.userId },
      });
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      }
    }
  }
}
