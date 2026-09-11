export interface OrderStatusHistoryEntrySource {
  status: string;
  note: string | null;
  changedByUserId: string | null;
  createdAt: Date;
}

export class OrderStatusHistoryEntryResponseDto {
  status: string;
  note: string | null;
  changedByUserId: string | null;
  createdAt: Date;

  constructor(source: OrderStatusHistoryEntrySource) {
    this.status = source.status;
    this.note = source.note;
    this.changedByUserId = source.changedByUserId;
    this.createdAt = source.createdAt;
  }
}
