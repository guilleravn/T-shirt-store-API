import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Min } from 'class-validator';

export class UpdatePromoCodeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  discountValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minPurchaseCents?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;
}
