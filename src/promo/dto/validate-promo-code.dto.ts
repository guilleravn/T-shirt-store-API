import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ValidatePromoCodeDto {
  @IsString()
  @MaxLength(40)
  code: string;

  @IsOptional()
  @IsUUID()
  productVariantId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}
