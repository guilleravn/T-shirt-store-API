import { ColorResponseDto } from './color-response.dto';
import { SizeResponseDto } from './size-response.dto';

export interface PublicVariantSource {
  id: string;
  sku: string;
  color: { id: string; name: string; hexCode: string };
  size: { id: string; name: string; position: number };
  priceCents: number;
  stock: number;
  isActive: boolean;
}

// Customer-facing view: never exposes the real stock count, only a capped availability signal.
export class PublicVariantResponseDto {
  id: string;
  sku: string;
  color: ColorResponseDto;
  size: SizeResponseDto;
  priceCents: number;
  isActive: boolean;
  availableQuantity: number;
  lowStock: boolean;

  constructor(variant: PublicVariantSource) {
    this.id = variant.id;
    this.sku = variant.sku;
    this.color = new ColorResponseDto(variant.color);
    this.size = new SizeResponseDto(variant.size);
    this.priceCents = variant.priceCents;
    this.isActive = variant.isActive;
    this.availableQuantity = Math.min(variant.stock, 10);
    this.lowStock = variant.stock <= 3;
  }
}
