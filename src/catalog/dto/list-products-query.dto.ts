import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// `@Type(() => Boolean)` runs the JS `Boolean()` constructor on the raw query string, and
// `Boolean('false')` is `true` — so `?includeInactive=false` would otherwise silently mean
// "true". This maps only the two literal strings a boolean query param can actually mean;
// anything else passes through unchanged so `@IsBoolean()` still rejects garbage input with a
// 400 instead of silently coercing it.
function toBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export enum ProductSort {
  Newest = 'newest',
  PriceAsc = 'priceAsc',
  PriceDesc = 'priceDesc',
  Name = 'name',
}

export class ListProductsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  colorId?: string;

  @IsOptional()
  @IsUUID()
  sizeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  // MANAGER only — enforced in ProductsService, not here or in a guard (see OptionalJwtAuthGuard).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toBoolean(value))
  @IsBoolean()
  includeInactive?: boolean = false;

  @IsOptional()
  @IsEnum(ProductSort)
  sort?: ProductSort;

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
