import {
  ProductCardResponseDto,
  ProductCardSource,
} from './product-card-response.dto';
import {
  PublicVariantResponseDto,
  PublicVariantSource,
} from './public-variant-response.dto';

export interface ProductDetailSource extends ProductCardSource {
  description: string | null;
  isActive: boolean;
  variants: PublicVariantSource[];
}

export class ProductDetailResponseDto extends ProductCardResponseDto {
  description: string | null;
  isActive: boolean;
  images: string[];
  variants: PublicVariantResponseDto[];

  constructor(product: ProductDetailSource) {
    super(product);
    this.description = product.description;
    this.isActive = product.isActive;
    // No image storage provider decided yet — always empty until that module exists.
    this.images = [];
    this.variants = product.variants.map(
      (variant) => new PublicVariantResponseDto(variant),
    );
  }
}
