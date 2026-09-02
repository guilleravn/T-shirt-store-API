import { ColorResponseDto } from './color-response.dto';
import { SizeResponseDto } from './size-response.dto';

interface VariantSource {
  id: string;
  sku: string;
  color: { id: string; name: string; hexCode: string };
  size: { id: string; name: string; position: number };
  priceCents: number;
  stock: number;
  isActive: boolean;
}

// MANAGER view: exposes real stock. See PublicVariantResponseDto for the customer-facing view.
export class VariantResponseDto {
  id: string;
  sku: string;
  color: ColorResponseDto;
  size: SizeResponseDto;
  priceCents: number;
  stock: number;
  isActive: boolean;

  constructor(variant: VariantSource) {
    this.id = variant.id;
    this.sku = variant.sku;
    this.color = new ColorResponseDto(variant.color);
    this.size = new SizeResponseDto(variant.size);
    this.priceCents = variant.priceCents;
    this.stock = variant.stock;
    this.isActive = variant.isActive;
  }
}
