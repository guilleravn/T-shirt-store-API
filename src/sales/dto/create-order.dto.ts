import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  promoCode?: string;
}
