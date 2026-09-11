import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { UserRole } from '../../../generated/prisma/client';

export class ListUsersQueryDto {
  // openapi.yaml restricts this endpoint's role filter to DELIVERY — its only documented
  // purpose is looking up a delivery person to assign (PATCH /orders/{id}/status).
  @IsIn([UserRole.DELIVERY])
  role: UserRole;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
