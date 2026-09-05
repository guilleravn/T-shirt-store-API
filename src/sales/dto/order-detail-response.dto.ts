import {
  OrderSummaryResponseDto,
  OrderSummarySource,
} from './order-summary-response.dto';
import {
  OrderItemLineResponseDto,
  OrderItemLineSource,
} from './order-item-line-response.dto';
import {
  OrderStatusHistoryEntryResponseDto,
  OrderStatusHistoryEntrySource,
} from './order-status-history-entry-response.dto';

export interface OrderPersonSource {
  id: string;
  firstName: string;
  lastName: string;
}

export interface OrderPaymentSource {
  method: string;
  status: string;
  amountCents: number;
  paidAt: Date | null;
  refundedAt: Date | null;
}

export interface OrderDetailSource extends OrderSummarySource {
  items: OrderItemLineSource[];
  payment: OrderPaymentSource | null;
  statusHistory: OrderStatusHistoryEntrySource[];
  customer: OrderPersonSource | null;
  deliveryPerson: OrderPersonSource | null;
}

export class OrderDetailResponseDto extends OrderSummaryResponseDto {
  items: OrderItemLineResponseDto[];
  // The most recent payment attempt for this order, whatever its status — null until one
  // exists at all. Distinct from the inherited `paymentMethod`, which only ever reflects a
  // SUCCEEDED attempt (business-invariants.md).
  payment: OrderPaymentSource | null;
  statusHistory: OrderStatusHistoryEntryResponseDto[];
  customer: OrderPersonSource | null;
  deliveryPerson: OrderPersonSource | null;

  constructor(source: OrderDetailSource) {
    super(source);
    this.items = source.items.map((item) => new OrderItemLineResponseDto(item));
    this.payment = source.payment;
    this.statusHistory = source.statusHistory.map(
      (entry) => new OrderStatusHistoryEntryResponseDto(entry),
    );
    this.customer = source.customer;
    this.deliveryPerson = source.deliveryPerson;
  }
}
