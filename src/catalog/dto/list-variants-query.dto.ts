import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListVariantsQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean = false;

  @IsOptional()
  @Type(() => Boolean)
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
