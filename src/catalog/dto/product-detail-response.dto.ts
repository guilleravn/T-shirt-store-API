import {
  BuildImageUrl,
  ProductCardResponseDto,
  ProductCardSource,
} from './product-card-response.dto';
import { ProductImageResponseDto } from './product-image-response.dto';
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
  images: ProductImageResponseDto[];
  variants: PublicVariantResponseDto[];

  constructor(product: ProductDetailSource, buildImageUrl: BuildImageUrl) {
    super(product, buildImageUrl);
    this.description = product.description;
    this.isActive = product.isActive;
    this.images = product.images.map(
      (image) =>
        new ProductImageResponseDto({
          id: image.id,
          url: buildImageUrl(image.s3Key),
          altText: image.altText,
          position: image.position,
        }),
    );
    this.variants = product.variants.map(
      (variant) => new PublicVariantResponseDto(variant),
    );
  }
}
