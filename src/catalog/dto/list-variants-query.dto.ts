import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

// `@Type(() => Boolean)` runs the JS `Boolean()` constructor on the raw query string, and
// `Boolean('false')` is `true` — so `?includeInactive=false`/`?lowStock=false` would otherwise
// silently mean "true". This maps only the two literal strings a boolean query param can
// actually mean; anything else passes through unchanged so `@IsBoolean()` still rejects garbage
// input with a 400 instead of silently coercing it.
function toBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class ListVariantsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toBoolean(value))
  @IsBoolean()
  includeInactive?: boolean = false;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toBoolean(value))
  @IsBoolean()
  lowStock?: boolean;

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
