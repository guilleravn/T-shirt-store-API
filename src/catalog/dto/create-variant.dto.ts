import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVariantDto {
  @IsUUID()
  colorId: string;

  @IsUUID()
  sizeId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku: string;

  @IsInt()
  @Min(1)
  priceCents: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number = 0;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
