import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { DiscountType } from '../../../generated/prisma/client';

export class CreatePromoCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code: string;

  @IsEnum(DiscountType)
  discountType: DiscountType;

  // 1-100 if PERCENTAGE, cents if FIXED — the type-dependent upper bound is enforced by the
  // discount_value_valid_for_type DB constraint, not repeated here.
  @IsInt()
  @Min(1)
  discountValue: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minPurchaseCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
