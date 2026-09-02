import { CategoryResponseDto } from './category-response.dto';

export interface ProductCardSource {
  id: string;
  name: string;
  productCategories: { category: { id: string; name: string; slug: string } }[];
  variants: { priceCents: number; stock: number; isActive: boolean }[];
}

export class ProductCardResponseDto {
  id: string;
  name: string;
  priceRange: { minCents: number; maxCents: number };
  primaryImage: string | null;
  categories: CategoryResponseDto[];
  inStock: boolean;
  likesCount: number;
  likedByMe: boolean;

  constructor(product: ProductCardSource) {
    this.id = product.id;
    this.name = product.name;

    const prices = product.variants.map((variant) => variant.priceCents);
    this.priceRange = {
      minCents: prices.length ? Math.min(...prices) : 0,
      maxCents: prices.length ? Math.max(...prices) : 0,
    };

    // No image storage provider decided yet (see CLAUDE.md current-state note) — always null
    // until that module exists.
    this.primaryImage = null;

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
