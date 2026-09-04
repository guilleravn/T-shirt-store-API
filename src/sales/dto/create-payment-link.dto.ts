import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreatePaymentLinkDto {
  @IsUUID()
  productVariantId: string;

  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @IsOptional()
  @IsString()
  promoCode?: string;

  @IsOptional()
  @IsUrl()
  successUrl?: string;

  @IsOptional()
  @IsUrl()
  cancelUrl?: string;
}
