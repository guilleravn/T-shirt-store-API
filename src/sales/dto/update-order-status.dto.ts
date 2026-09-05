import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { OrderStatus } from '../../../generated/prisma/client';

export class UpdateOrderStatusDto {
  // PENDING/PAID/CANCELLED are never a target of this endpoint — PENDING is the creation
  // default, PAID only happens via the Stripe webhook (next branch), and CANCELLED has its own
  // endpoint (POST /orders/{id}/cancel).
  @IsIn([OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED])
  status: OrderStatus;

  // Required exactly when status=SHIPPED, per openapi.yaml's if/then and R7.
  @ValidateIf((dto: UpdateOrderStatusDto) => dto.status === OrderStatus.SHIPPED)
  @IsUUID()
  deliveryPersonId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
