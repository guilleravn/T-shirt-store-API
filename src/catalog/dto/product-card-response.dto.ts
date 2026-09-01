import { CategoryResponseDto } from './category-response.dto';
import { ProductImageResponseDto } from './product-image-response.dto';

export interface ProductImageSource {
  id: string;
  s3Key: string;
  altText: string | null;
  position: number;
}

export interface ProductCardSource {
  id: string;
  name: string;
  productCategories: { category: { id: string; name: string; slug: string } }[];
  variants: { priceCents: number; stock: number; isActive: boolean }[];
  images: ProductImageSource[];
}

export type BuildImageUrl = (s3Key: string) => string;

export class ProductCardResponseDto {
  id: string;
  name: string;
  priceRange: { minCents: number; maxCents: number };
  primaryImage: ProductImageResponseDto | null;
  categories: CategoryResponseDto[];
  inStock: boolean;
  likesCount: number;
  likedByMe: boolean;

  constructor(product: ProductCardSource, buildImageUrl: BuildImageUrl) {
    this.id = product.id;
    this.name = product.name;

    const prices = product.variants.map((variant) => variant.priceCents);
    this.priceRange = {
      minCents: prices.length ? Math.min(...prices) : 0,
      maxCents: prices.length ? Math.max(...prices) : 0,
    };

    // The DBML's documented determinism rule for "the primary image" is
    // ORDER BY position, created_at, id LIMIT 1 — the include already sorts this way, so the
    // first entry (if any) is it.
    const primaryImage = product.images[0];
    this.primaryImage = primaryImage
      ? new ProductImageResponseDto({
          id: primaryImage.id,
          url: buildImageUrl(primaryImage.s3Key),
          altText: primaryImage.altText,
          position: primaryImage.position,
        })
      : null;

    this.categories = product.productCategories.map(
      (productCategory) => new CategoryResponseDto(productCategory.category),
    );
    this.inStock = product.variants.some(
      (variant) => variant.isActive && variant.stock > 0,
    );

    // Engagement module doesn't exist yet — hardcoded until likes are built.
    this.likesCount = 0;
    this.likedByMe = false;
  }
}
