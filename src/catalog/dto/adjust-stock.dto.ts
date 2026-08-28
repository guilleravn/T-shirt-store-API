import { IsInt, NotEquals } from 'class-validator';

export class AdjustStockDto {
  @IsInt()
  @NotEquals(0)
  deltaUnits: number;
}
