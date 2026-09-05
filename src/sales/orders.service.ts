import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  User,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapPrismaWriteError } from '../common/prisma-error.util';
import { PageMetaDto } from '../catalog/dto/page-meta.dto';
import {
  Action,
  authorizeOrderAction,
  OrderAbilityFactory,
  orderSubject,
} from './casl/order-ability.factory';
import { OrderDetailResponseDto } from './dto/order-detail-response.dto';
import { OrderSummaryResponseDto } from './dto/order-summary-response.dto';
import { lockAndValidatePromoCode } from './promo-redemption.util';
import { assertPurchasable } from './purchasability.util';
import { CheckoutQueueService } from './queue/checkout-queue.service';

export interface CreateOrderInput {
  promoCode?: string;
}

export interface ListOrdersInput {
  from?: Date;
  to?: Date;
  status?: OrderStatus;
  minTotalCents?: number;
  maxTotalCents?: number;
  userId?: string;
  deliveryPersonId?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateOrderStatusInput {
  status: OrderStatus;
  deliveryPersonId?: string;
  note?: string;
}

export interface CancelOrderInput {
  reason?: string;
}

const CANCELLABLE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
];

// The two failure modes below are deliberately distinct HTTP statuses (openapi.yaml documents
// both 403 and 409 for PATCH /orders/{id}/status): a pair with no entry here is unreachable from
// any role (409 — the resource's state doesn't allow it), while a pair that IS here but whose
// role doesn't match is reachable, just not by this caller (403).
const STATUS_TRANSITIONS: Partial<
  Record<OrderStatus, Partial<Record<OrderStatus, UserRole>>>
> = {
  [OrderStatus.PAID]: { [OrderStatus.PROCESSING]: UserRole.MANAGER },
  [OrderStatus.PROCESSING]: { [OrderStatus.SHIPPED]: UserRole.MANAGER },
  [OrderStatus.SHIPPED]: { [OrderStatus.DELIVERED]: UserRole.DELIVERY },
};

// user/deliveryPerson are `select`, never `include: true` — openapi.yaml's OrderDetail.customer
// and .deliveryPerson only ever expose {id, firstName, lastName}, and TypeScript's DTO typing
// doesn't strip a full User row (with passwordHash) assigned into it at runtime.
const ORDER_DETAIL_INCLUDE = {
  items: true,
  statusHistory: { orderBy: { createdAt: 'asc' } },
  user: { select: { id: true, firstName: true, lastName: true } },
  deliveryPerson: { select: { id: true, firstName: true, lastName: true } },
  promoRedemption: { include: { promoCode: { select: { code: true } } } },
  // All attempts, not just the most recent — toDetailDto needs both "the latest attempt"
  // (.payment) and "the one that actually succeeded, if any" (.paymentMethod), and a handful of
  // rows per order is never worth a second query to separate them.
  payments: { orderBy: { createdAt: 'desc' } },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderAbilityFactory: OrderAbilityFactory,
    private readonly checkoutQueueService: CheckoutQueueService,
  ) {}

  async create(
    user: User,
    dto: CreateOrderInput,
  ): Promise<OrderDetailResponseDto> {
    const existingPending = await this.prisma.order.findFirst({
      where: { userId: user.id, status: OrderStatus.PENDING },
    });
    if (existingPending) {
      throw new ConflictException('You already have a pending order');
    }

    const cart = await this.prisma.cart.findUnique({
      where: { userId: user.id },
    });
    const cartItems = cart
      ? await this.prisma.cartItem.findMany({
          where: { cartId: cart.id },
          include: {
            variant: { include: { color: true, size: true, product: true } },
          },
        })
      : [];
    if (cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    for (const item of cartItems) {
      assertPurchasable(item.variant.product, item.variant, item.quantity);
    }

    const subtotalCents = cartItems.reduce(
      (sum, item) => sum + item.quantity * item.variant.priceCents,
      0,
    );

    try {
      const order = await this.prisma.$transaction(async (tx) => {
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
              create: cartItems.map((item) => ({
                productVariantId: item.productVariantId,
                quantity: item.quantity,
                unitPriceCents: item.variant.priceCents,
                productName: item.variant.product.name,
                variantLabel: `${item.variant.color.name} / ${item.variant.size.name}`,
              })),
            },
            statusHistory: {
              create: {
                status: OrderStatus.PENDING,
                changedByUserId: user.id,
              },
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

      return this.detail(order.id, user);
    } catch (error) {
      // The real concurrency guard for "one PENDING order per user" is the partial unique index
      // (one_pending_order_per_user in T-Shirt-constraints.sql) — the findFirst check above is
      // only a fast, non-atomic pre-check and can't close the race between two simultaneous
      // POST /orders for the same user. Checked explicitly, not left to the generic
      // uniqueViolation message below, since that one already means something else here (a
      // duplicate order_items row).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        this.isPendingOrderIndexViolation(error)
      ) {
        throw new ConflictException('You already have a pending order');
      }
      throw mapPrismaWriteError(error, {
        uniqueViolation: 'This variant is already on the order',
        checkViolation: 'Order totals failed validation',
      });
    }
  }

  // A partial unique index (not modeled as a Prisma field) surfaces its constraint name only
  // through the @prisma/adapter-pg driver error's original Postgres message — confirmed live,
  // since @prisma/client's own P2002 `meta.target` is empty for this kind of raw SQL index.
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

  async list(
    user: User,
    query: ListOrdersInput,
  ): Promise<{ data: OrderSummaryResponseDto[]; meta: PageMetaDto }> {
    if (
      (query.userId ?? query.deliveryPersonId) &&
      user.role !== UserRole.MANAGER
    ) {
      throw new ForbiddenException("You don't have permission for this action");
    }

    const where: Prisma.OrderWhereInput = {
      ...(user.role === UserRole.CLIENT && { userId: user.id }),
      ...(user.role === UserRole.DELIVERY && { deliveryPersonId: user.id }),
      ...(user.role === UserRole.MANAGER &&
        query.userId && { userId: query.userId }),
      ...(user.role === UserRole.MANAGER &&
        query.deliveryPersonId && { deliveryPersonId: query.deliveryPersonId }),
      ...(query.status && { status: query.status }),
      ...((query.from ?? query.to) && {
        createdAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
      ...((query.minTotalCents !== undefined ||
        query.maxTotalCents !== undefined) && {
        totalCents: {
          ...(query.minTotalCents !== undefined && {
            gte: query.minTotalCents,
          }),
          ...(query.maxTotalCents !== undefined && {
            lte: query.maxTotalCents,
          }),
        },
      }),
    };

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          _count: { select: { items: true } },
          promoRedemption: {
            include: { promoCode: { select: { code: true } } },
          },
          // At most one row can match — one_successful_payment_per_order (partial unique index).
          payments: {
            where: { status: PaymentStatus.SUCCEEDED },
            select: { method: true },
          },
        },
      }),
    ]);

    return {
      data: orders.map(
        (order) =>
          new OrderSummaryResponseDto({
            id: order.id,
            status: order.status,
            createdAt: order.createdAt,
            subtotalCents: order.subtotalCents,
            discountCents: order.discountCents,
            totalCents: order.totalCents,
            currency: order.currency,
            itemCount: order._count.items,
            paymentMethod: order.payments[0]?.method ?? null,
            promoCode: order.promoRedemption?.promoCode.code ?? null,
            deliveryPersonId: order.deliveryPersonId,
          }),
      ),
      meta: new PageMetaDto({ total, limit, offset }),
    };
  }

  async detail(orderId: string, user: User): Promise<OrderDetailResponseDto> {
    const order = await this.fetchOrderDetail(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const ability = this.orderAbilityFactory.createForUser(user);
    authorizeOrderAction(ability, Action.Read, orderSubject(order));

    return this.toDetailDto(order);
  }

  async updateStatus(
    orderId: string,
    user: User,
    dto: UpdateOrderStatusInput,
  ): Promise<OrderDetailResponseDto> {
    const order = await this.fetchOrderDetail(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const ability = this.orderAbilityFactory.createForUser(user);
    authorizeOrderAction(ability, Action.Update, orderSubject(order));

    this.assertValidTransition(order.status, dto.status, user.role);

    if (dto.status === OrderStatus.SHIPPED) {
      const deliveryPerson = dto.deliveryPersonId
        ? await this.prisma.user.findFirst({
            where: { id: dto.deliveryPersonId, role: UserRole.DELIVERY },
          })
        : null;
      if (!deliveryPerson) {
        throw new BadRequestException(
          'deliveryPersonId must reference a DELIVERY user',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Conditional on the status this was validated against, not a plain update — closes the
      // race between the pre-check above and this write (same idiom as R3's stock UPDATE and
      // auth.service.ts's refresh-token rotation). Without it, two concurrent requests can both
      // pass assertValidTransition against the same stale status and both write, leaving
      // order_status_history with an entry for a transition that was no longer actually legal by
      // the time it ran.
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: {
          status: dto.status,
          // R7: delivery_person_id is set exactly at the PROCESSING -> SHIPPED transition, in
          // the same transaction as the status change — never anywhere else.
          ...(dto.status === OrderStatus.SHIPPED && {
            deliveryPersonId: dto.deliveryPersonId,
          }),
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'Order status changed concurrently, please retry',
        );
      }
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: dto.status,
          changedByUserId: user.id,
          note: dto.note,
        },
      });
    });

    return this.detail(orderId, user);
  }

  async cancel(
    orderId: string,
    user: User,
    dto: CancelOrderInput,
  ): Promise<OrderDetailResponseDto> {
    const order = await this.fetchOrderDetail(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const ability = this.orderAbilityFactory.createForUser(user);
    authorizeOrderAction(ability, Action.Cancel, orderSubject(order));

    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      throw new ConflictException('Order can no longer be cancelled');
    }

    const refundablePayment = await this.prisma.$transaction(async (tx) => {
      // Re-read and re-check status inside the transaction: the checks above can be stale by
      // the time this actually runs — the webhook could have moved this order past PENDING
      // (decrementing stock) in the window between that read and this transaction starting. A
      // decision this transaction is about to act on has to be based on data read inside it.
      const currentOrder = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });
      if (!CANCELLABLE_STATUSES.includes(currentOrder.status)) {
        throw new ConflictException('Order can no longer be cancelled');
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: OrderStatus.CANCELLED,
          changedByUserId: user.id,
          note: dto.reason,
        },
      });

      // Only lines that actually had stock taken (R8: an oversold line never did) get restored
      // — restoring every line unconditionally would phantom-inflate stock for one that was
      // never really decremented.
      for (const item of currentOrder.items) {
        if (item.stockDecremented) {
          await tx.productVariant.update({
            where: { id: item.productVariantId },
            data: { stock: { increment: item.quantity } },
          });
          await tx.orderItem.update({
            where: { id: item.id },
            data: { stockDecremented: false },
          });
        }
      }

      return tx.payment.findFirst({
        where: { orderId, status: PaymentStatus.SUCCEEDED },
      });
    });

    // Enqueued after the transaction commits, not inside it — same dual-write reasoning R8
    // uses for stock: a synchronous Stripe call in here has no good answer for which side to
    // trust if the other one fails.
    if (refundablePayment) {
      await this.checkoutQueueService.enqueueRefund({
        paymentId: refundablePayment.id,
        stripeReferenceId: refundablePayment.stripeReferenceId,
      });
    }

    return this.detail(orderId, user);
  }

  private fetchOrderDetail(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  private toDetailDto(
    order: NonNullable<Awaited<ReturnType<OrdersService['fetchOrderDetail']>>>,
  ): OrderDetailResponseDto {
    const mostRecentPayment = order.payments[0] ?? null;
    const succeededPayment =
      order.payments.find(
        (payment) => payment.status === PaymentStatus.SUCCEEDED,
      ) ?? null;

    return new OrderDetailResponseDto({
      id: order.id,
      status: order.status,
      createdAt: order.createdAt,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      currency: order.currency,
      itemCount: order.items.length,
      paymentMethod: succeededPayment?.method ?? null,
      payment: mostRecentPayment
        ? {
            method: mostRecentPayment.method,
            status: mostRecentPayment.status,
            amountCents: mostRecentPayment.amountCents,
            paidAt: mostRecentPayment.paidAt,
            refundedAt: mostRecentPayment.refundedAt,
          }
        : null,
      promoCode: order.promoRedemption?.promoCode.code ?? null,
      deliveryPersonId: order.deliveryPersonId,
      items: order.items,
      statusHistory: order.statusHistory,
      customer: order.user,
      deliveryPerson: order.deliveryPerson,
    });
  }

  // Service-level business rule, not a guard's or CASL's concern (coding-style.md's dividing
  // line): whether THIS status is reachable from the order's CURRENT status, and whether THIS
  // role is the one allowed to make that specific move.
  private assertValidTransition(
    current: OrderStatus,
    target: OrderStatus,
    role: UserRole,
  ): void {
    const requiredRole = STATUS_TRANSITIONS[current]?.[target];
    if (!requiredRole) {
      throw new ConflictException(
        `Cannot transition from ${current} to ${target}`,
      );
    }
    if (requiredRole !== role) {
      throw new ForbiddenException("You don't have permission for this action");
    }
  }
}
