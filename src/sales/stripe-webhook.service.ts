import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  OrderStatus,
  Payment,
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

    // R4's idempotency claim, made safe against genuinely concurrent deliveries of the same
    // event — not just a sequential crash-then-retry. A plain findUnique-then-create (the old
    // approach) only closes the race on the INSERT itself; two deliveries that both see the row
    // already exists with processed_at still NULL would both fall through and run the switch
    // below in parallel. INSERT ... ON CONFLICT DO NOTHING either claims the row outright (this
    // delivery owns processing it) or claims nothing; when it claims nothing, SELECT ... FOR
    // UPDATE takes a real row lock that blocks until whichever transaction currently owns this
    // event commits or rolls back, so this delivery only ever acts on the true, final state.
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO stripe_events (stripe_event_id, type, payload, processed_at)
        VALUES (${event.id}, ${event.type}, ${JSON.stringify(event)}::jsonb, NULL)
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING id
      `;

      if (claimed.length === 0) {
        const rows = await tx.$queryRaw<{ processedAt: Date | null }[]>`
          SELECT processed_at AS "processedAt" FROM stripe_events
          WHERE stripe_event_id = ${event.id} FOR UPDATE
        `;
        if (rows[0]?.processedAt) {
          return;
        }
        // Still NULL under the lock: the previous claimant crashed or errored before marking
        // processed_at — R4 says reprocess, not skip, so this falls through to the switch below.
      }

      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(tx, event.data.object);
          break;
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(tx, event.data.object);
          break;
        case 'charge.refunded':
          await this.handleChargeRefunded(tx, event.data.object);
          break;
        default:
          this.logger.log(
            `Ignoring unhandled Stripe event type: ${event.type}`,
          );
      }

      await tx.stripeEvent.update({
        where: { stripeEventId: event.id },
        data: { processedAt: new Date() },
      });
    });
  }

  private async handlePaymentIntentSucceeded(
    tx: Prisma.TransactionClient,
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    const orderId = intent.metadata.orderId;
    if (!orderId) {
      return;
    }

    let payment: Payment;
    try {
      // amount_received is what Stripe actually settled — never orders.totalCents, which is
      // only the charge intent (see the plan's Payment.amountCents decision).
      payment = await tx.payment.update({
        where: { stripeReferenceId: intent.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
          amountCents: intent.amount_received,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        // No payments row exists for this PaymentIntent — createPaymentIntent's own insert must
        // have failed after Stripe already created the intent (a DB blip between the two calls).
        // Logged as an anomaly rather than thrown: retrying this event can never fix a payments
        // row that was never created, so letting it surface as a 500 would only buy Stripe's
        // 3-day retry loop for nothing (R4's processed_at guard exists to stop exactly that).
        this.logger.error(
          `payment_intent.succeeded for ${intent.id} (order ${orderId}) has no matching payments row — orphaned PaymentIntent, needs manual reconciliation`,
        );
        return;
      }
      throw error;
    }
    await this.finalizeSuccessfulPayment(tx, orderId, payment.method);
  }

  private async handleCheckoutSessionCompleted(
    tx: Prisma.TransactionClient,
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
  }

  // The counterpart to checkout.processor.ts's optimistic-refund fix: a refund that wasn't
  // immediately `succeeded` (ACH/bank debit `pending`, or one `requires_action`) gets its
  // `refundedAt` written here instead, once Stripe actually confirms it. `refunded` is only
  // `true` once the full charge amount has been refunded — a partial refund leaves it `false`
  // and this is a no-op, matching what `payments.refundedAt` is documented to mean
  // (business-invariants.md: "a payment that succeeded and was later reversed").
  private async handleChargeRefunded(
    tx: Prisma.TransactionClient,
    charge: Stripe.Charge,
  ): Promise<void> {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!paymentIntentId || !charge.refunded) {
      return;
    }
    await tx.payment.updateMany({
      where: { stripeReferenceId: paymentIntentId },
      data: { refundedAt: new Date() },
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

    // A Payment Link purchase fires both checkout.session.completed and payment_intent.succeeded
    // for the same order, in no guaranteed order (T-Shirt-constraints.sql's own note on why
    // order_status_history has no UNIQUE(order_id, status)) — two genuinely different Stripe
    // events, each with its own stripe_events row and its own R4 lock, so that lock does nothing
    // to stop these two events' transactions from both reaching this method concurrently. A plain
    // read-then-branch on order.status isn't enough to guard R3's stock decrement below — both
    // transactions could read PENDING before either commits. The conditional updateMany is what
    // actually decides "am I the one that gets to process this," the same idiom R3 itself uses
    // for stock: whichever transaction's write loses the race sees count === 0 and returns,
    // never touching stock.
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.PAID },
    });
    if (count === 0) {
      return;
    }

    const oversoldItems: string[] = [];
    for (const item of order.items) {
      const rows = await tx.$queryRaw<{ stock: number }[]>`
        UPDATE product_variants SET stock = stock - ${item.quantity}
         WHERE id = ${item.productVariantId} AND stock >= ${item.quantity}
         RETURNING stock
      `;
      if (rows.length === 0) {
        oversoldItems.push(item.productName);
      } else {
        // Recorded per line so a later cancellation (R8) knows exactly which lines actually had
        // stock taken — the oversold note above is free text, not a queryable per-item flag.
        await tx.orderItem.update({
          where: { id: item.id },
          data: { stockDecremented: true },
        });
      }
    }

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
