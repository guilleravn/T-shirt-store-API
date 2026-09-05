import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { mapPrismaWriteError } from '../common/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateProductDto } from './dto/create-product.dto';
import {
  ListProductsQueryDto,
  ProductSort,
} from './dto/list-products-query.dto';
import { PageMetaDto } from './dto/page-meta.dto';
import {
  BuildImageUrl,
  ProductCardResponseDto,
} from './dto/product-card-response.dto';
import { ProductDetailResponseDto } from './dto/product-detail-response.dto';
import { ReplaceCategoriesResponseDto } from './dto/replace-categories-response.dto';
import { SetActiveResponseDto } from './dto/set-active-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { S3ImageStorageService } from './s3-image-storage.service';

export interface Requester {
  // Optional: only present for a real authenticated caller, used to personalize `likedByMe`.
  // The internal MANAGER-view call from update() below has no real caller and omits it.
  id?: string;
  role: UserRole;
}

// The DBML's documented determinism rule for "the primary image" is
// ORDER BY position, created_at, id LIMIT 1 — every include below sorts images this way so
// callers can just take images[0].
const IMAGES_INCLUDE: {
  orderBy: Prisma.ProductImageOrderByWithRelationInput[];
} = {
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
};

const PRODUCT_INCLUDE = {
  productCategories: { include: { category: true } },
  variants: { include: { color: true, size: true } },
  images: IMAGES_INCLUDE,
  _count: { select: { likes: true } },
} as const;

@Injectable()
export class ProductsService {
  private readonly buildImageUrl: BuildImageUrl = (key) =>
    this.imageStorage.getPublicUrl(key);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageStorage: S3ImageStorageService,
  ) {}

  async list(
    query: ListProductsQueryDto,
    requester?: Requester,
  ): Promise<{ data: ProductCardResponseDto[]; meta: PageMetaDto }> {
    if (query.includeInactive) {
      if (!requester) {
        throw new UnauthorizedException(
          'includeInactive requires authentication',
        );
      }
      if (requester.role !== UserRole.MANAGER) {
        throw new ForbiddenException(
          "You don't have permission for this action",
        );
      }
    }

    const isManager = requester?.role === UserRole.MANAGER;
    const where = this.buildProductWhere(query, isManager);
    const variantVisibility = this.variantVisibilityFilter(
      isManager,
      query.includeInactive,
    );
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    if (
      query.sort === ProductSort.PriceAsc ||
      query.sort === ProductSort.PriceDesc
    ) {
      return this.listSortedByPrice(
        where,
        variantVisibility,
        query.sort,
        limit,
        offset,
        requester?.id,
      );
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === ProductSort.Name ? { name: 'asc' } : { createdAt: 'desc' };

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        include: {
          productCategories: { include: { category: true } },
          variants: { where: variantVisibility },
          images: IMAGES_INCLUDE,
          ...this.buildLikesInclude(requester?.id),
        },
      }),
    ]);

    return {
      data: products.map(
        (product) => new ProductCardResponseDto(product, this.buildImageUrl),
      ),
      meta: new PageMetaDto({ total, limit, offset }),
    };
  }

  async detail(
    productId: string,
    requester?: Requester,
  ): Promise<ProductDetailResponseDto> {
    const isManager = requester?.role === UserRole.MANAGER;
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        deletedAt: null,
        ...(isManager ? {} : { isActive: true }),
      },
      include: {
        productCategories: { include: { category: true } },
        variants: {
          where: this.variantVisibilityFilter(isManager, true),
          include: { color: true, size: true },
        },
        images: IMAGES_INCLUDE,
        ...this.buildLikesInclude(requester?.id),
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return new ProductDetailResponseDto(product, this.buildImageUrl);
  }

  async create(dto: CreateProductDto): Promise<ProductDetailResponseDto> {
    if (dto.categoryIds?.length) {
      await this.assertCategoriesExist(dto.categoryIds);
    }

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            name: dto.name,
            description: dto.description,
            isActive: dto.isActive ?? false,
          },
        });

        if (dto.categoryIds?.length) {
          await tx.productCategory.createMany({
            data: dto.categoryIds.map((categoryId) => ({
              productId: created.id,
              categoryId,
            })),
          });
        }

        if (dto.variants?.length) {
          await tx.productVariant.createMany({
            data: dto.variants.map((variant) => ({
              productId: created.id,
              colorId: variant.colorId,
              sizeId: variant.sizeId,
              sku: variant.sku,
              priceCents: variant.priceCents,
              stock: variant.stock ?? 0,
              isActive: variant.isActive ?? true,
            })),
          });
        }

        return tx.product.findUniqueOrThrow({
          where: { id: created.id },
          include: PRODUCT_INCLUDE,
        });
      });
      return new ProductDetailResponseDto(product, this.buildImageUrl);
    } catch (error) {
      throw mapPrismaWriteError(error, {
        uniqueViolation: 'Duplicate SKU or color/size combination',
        foreignKeyViolation: 'Invalid colorId or sizeId',
      });
    }
  }

  async update(
    productId: string,
    dto: UpdateProductDto,
  ): Promise<ProductDetailResponseDto> {
    const result = await this.prisma.product.updateMany({
      where: { id: productId, deletedAt: null },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Product not found');
    }
    return this.detail(productId, { role: UserRole.MANAGER });
  }

  async softDelete(productId: string): Promise<void> {
    const result = await this.prisma.product.updateMany({
      where: { id: productId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException('Product not found');
    }
  }

  async setActive(
    productId: string,
    isActive: boolean,
  ): Promise<SetActiveResponseDto> {
    const result = await this.prisma.product.updateMany({
      where: { id: productId, deletedAt: null },
      data: { isActive },
    });
    if (result.count === 0) {
      throw new NotFoundException('Product not found');
    }
    return new SetActiveResponseDto({ id: productId, isActive });
  }

  async replaceCategories(
    productId: string,
    categoryIds: string[],
  ): Promise<ReplaceCategoriesResponseDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (categoryIds.length) {
      await this.assertCategoriesExist(categoryIds);
    }

    const categories = await this.prisma.$transaction(async (tx) => {
      await tx.productCategory.deleteMany({ where: { productId } });
      if (categoryIds.length) {
        await tx.productCategory.createMany({
          data: categoryIds.map((categoryId) => ({ productId, categoryId })),
        });
      }
      return tx.category.findMany({
        where: { id: { in: categoryIds } },
        orderBy: { name: 'asc' },
      });
    });

    return new ReplaceCategoriesResponseDto(
      categories.map((category) => new CategoryResponseDto(category)),
    );
  }

  // _count always runs; the `likes` existence-check only runs for an authenticated caller, so
  // an anonymous request never needs likedByMe resolved to anything but false.
  private buildLikesInclude(requesterId?: string) {
    return {
      _count: { select: { likes: true } },
      ...(requesterId && {
        likes: { where: { userId: requesterId }, select: { userId: true } },
      }),
    };
  }

  private async assertCategoriesExist(categoryIds: string[]): Promise<void> {
    const count = await this.prisma.category.count({
      where: { id: { in: categoryIds } },
    });
    if (count !== categoryIds.length) {
      throw new BadRequestException('One or more categoryIds do not exist');
    }
  }

  private buildProductWhere(
    query: ListProductsQueryDto,
    isManager: boolean,
  ): Prisma.ProductWhereInput {
    const hasVariantFilter =
      query.colorId !== undefined ||
      query.sizeId !== undefined ||
      query.minPriceCents !== undefined ||
      query.maxPriceCents !== undefined;

    return {
      deletedAt: null,
      ...(!(isManager && query.includeInactive) && { isActive: true }),
      ...(query.name && {
        name: { contains: query.name, mode: 'insensitive' },
      }),
      ...(query.category && {
        productCategories: { some: { category: { slug: query.category } } },
      }),
      ...(hasVariantFilter && {
        variants: {
          some: this.variantMatchFilter(query, isManager),
        },
      }),
    };
  }

  private variantMatchFilter(
    query: ListProductsQueryDto,
    isManager: boolean,
  ): Prisma.ProductVariantWhereInput {
    const hasPriceFilter =
      query.minPriceCents !== undefined || query.maxPriceCents !== undefined;
    return {
      ...this.variantVisibilityFilter(isManager, query.includeInactive),
      ...(query.colorId && { colorId: query.colorId }),
      ...(query.sizeId && { sizeId: query.sizeId }),
      ...(hasPriceFilter && {
        priceCents: {
          ...(query.minPriceCents !== undefined && {
            gte: query.minPriceCents,
          }),
          ...(query.maxPriceCents !== undefined && {
            lte: query.maxPriceCents,
          }),
        },
      }),
    };
  }

  // A disabled variant isn't purchasable, so it's excluded from anyone but a MANAGER
  // asking with includeInactive — same distinction as the product-level isActive filter.
  private variantVisibilityFilter(
    isManager: boolean,
    includeInactive?: boolean,
  ): Prisma.ProductVariantWhereInput {
    return {
      deletedAt: null,
      ...(!(isManager && includeInactive) && { isActive: true }),
    };
  }

  // Prisma's fluent `orderBy` can't sort products by a MIN/MAX of a to-many relation's field,
  // so price sort goes through ProductVariant.groupBy instead (kept in Prisma's query builder,
  // not raw SQL, so the filter logic isn't duplicated in a second dialect).
  private async listSortedByPrice(
    productWhere: Prisma.ProductWhereInput,
    variantVisibility: Prisma.ProductVariantWhereInput,
    sort: ProductSort.PriceAsc | ProductSort.PriceDesc,
    limit: number,
    offset: number,
    requesterId?: string,
  ): Promise<{ data: ProductCardResponseDto[]; meta: PageMetaDto }> {
    const variantWhere: Prisma.ProductVariantWhereInput = {
      ...variantVisibility,
      product: productWhere,
    };

    const [page, allGroups] = await Promise.all([
      this.prisma.productVariant.groupBy({
        by: ['productId'],
        where: variantWhere,
        _min: { priceCents: true },
        orderBy: {
          _min: {
            priceCents: sort === ProductSort.PriceAsc ? 'asc' : 'desc',
          },
        },
        skip: offset,
        take: limit,
      }),
      this.prisma.productVariant.groupBy({
        by: ['productId'],
        where: variantWhere,
      }),
    ]);

    const orderedIds = page.map((group) => group.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: orderedIds } },
      include: {
        productCategories: { include: { category: true } },
        variants: { where: variantVisibility },
        images: IMAGES_INCLUDE,
        ...this.buildLikesInclude(requesterId),
      },
    });
    const byId = new Map(products.map((product) => [product.id, product]));

    const data = orderedIds
      .map((id) => byId.get(id))
      .filter((product): product is NonNullable<typeof product> =>
        Boolean(product),
      )
      .map(
        (product) => new ProductCardResponseDto(product, this.buildImageUrl),
      );

    return {
      data,
      meta: new PageMetaDto({ total: allGroups.length, limit, offset }),
    };
  }
}
