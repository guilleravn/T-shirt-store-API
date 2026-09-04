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

export interface OrderDetailSource extends OrderSummarySource {
  items: OrderItemLineSource[];
  statusHistory: OrderStatusHistoryEntrySource[];
  customer: OrderPersonSource | null;
  deliveryPerson: OrderPersonSource | null;
}

export class OrderDetailResponseDto extends OrderSummaryResponseDto {
  items: OrderItemLineResponseDto[];
  // Always null in this branch — same reason as `paymentMethod` on the summary above.
  payment: null;
  statusHistory: OrderStatusHistoryEntryResponseDto[];
  customer: OrderPersonSource | null;
  deliveryPerson: OrderPersonSource | null;

  constructor(source: OrderDetailSource) {
    super(source);
    this.items = source.items.map((item) => new OrderItemLineResponseDto(item));
    this.payment = null;
    this.statusHistory = source.statusHistory.map(
      (entry) => new OrderStatusHistoryEntryResponseDto(entry),
    );
    this.customer = source.customer;
    this.deliveryPerson = source.deliveryPerson;
  }
}
