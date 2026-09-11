import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { mapPrismaWriteError } from '../common/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockResponseDto } from './dto/adjust-stock-response.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ListVariantsQueryDto } from './dto/list-variants-query.dto';
import { PageMetaDto } from './dto/page-meta.dto';
import { SetActiveResponseDto } from './dto/set-active-response.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { VariantResponseDto } from './dto/variant-response.dto';

const LOW_STOCK_THRESHOLD = 3;

@Injectable()
export class ProductVariantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    productId: string,
    query: ListVariantsQueryDto,
  ): Promise<{ data: VariantResponseDto[]; meta: PageMetaDto }> {
    await this.assertProductExists(productId);

    const where: Prisma.ProductVariantWhereInput = {
      productId,
      deletedAt: null,
      ...(!query.includeInactive && { isActive: true }),
      ...(query.lowStock && { stock: { lte: LOW_STOCK_THRESHOLD } }),
    };
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [total, variants] = await Promise.all([
      this.prisma.productVariant.count({ where }),
      this.prisma.productVariant.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: { color: true, size: true },
      }),
    ]);

    return {
      data: variants.map((variant) => new VariantResponseDto(variant)),
      meta: new PageMetaDto({ total, limit, offset }),
    };
  }

  async create(
    productId: string,
    dto: CreateVariantDto,
  ): Promise<VariantResponseDto> {
    await this.assertProductExists(productId);

    try {
      const variant = await this.prisma.productVariant.create({
        data: {
          productId,
          colorId: dto.colorId,
          sizeId: dto.sizeId,
          sku: dto.sku,
          priceCents: dto.priceCents,
          stock: dto.stock ?? 0,
          isActive: dto.isActive ?? true,
        },
        include: { color: true, size: true },
      });
      return new VariantResponseDto(variant);
    } catch (error) {
      throw mapPrismaWriteError(error, {
        uniqueViolation: 'Duplicate SKU or color/size combination',
        foreignKeyViolation: 'Invalid colorId or sizeId',
      });
    }
  }

  async update(
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ): Promise<VariantResponseDto> {
    let result: Prisma.BatchPayload;
    try {
      result = await this.prisma.productVariant.updateMany({
        where: { id: variantId, productId, deletedAt: null },
        data: {
          ...(dto.sku !== undefined && { sku: dto.sku }),
          ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        },
      });
    } catch (error) {
      throw mapPrismaWriteError(error, {
        uniqueViolation: 'Duplicate SKU or color/size combination',
        foreignKeyViolation: 'Invalid colorId or sizeId',
      });
    }
    if (result.count === 0) {
      throw new NotFoundException('Variant not found');
    }

    const variant = await this.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      include: { color: true, size: true },
    });
    return new VariantResponseDto(variant);
  }

  async softDelete(productId: string, variantId: string): Promise<void> {
    const result = await this.prisma.productVariant.updateMany({
      where: { id: variantId, productId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException('Variant not found');
    }
  }

  async setActive(
    productId: string,
    variantId: string,
    isActive: boolean,
  ): Promise<SetActiveResponseDto> {
    const result = await this.prisma.productVariant.updateMany({
      where: { id: variantId, productId, deletedAt: null },
      data: { isActive },
    });
    if (result.count === 0) {
      throw new NotFoundException('Variant not found');
    }
    return new SetActiveResponseDto({ id: variantId, isActive });
  }

  async adjustStock(
    productId: string,
    variantId: string,
    deltaUnits: number,
  ): Promise<AdjustStockResponseDto> {
    const result = await this.prisma.productVariant.updateMany({
      where: {
        id: variantId,
        productId,
        deletedAt: null,
        stock: { gte: -deltaUnits },
      },
      data: { stock: { increment: deltaUnits } },
    });

    if (result.count === 0) {
      const exists = await this.prisma.productVariant.findFirst({
        where: { id: variantId, productId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException('Variant not found');
      }
      throw new ConflictException('Adjustment would take stock negative');
    }

    const after = await this.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    return new AdjustStockResponseDto({
      variantId,
      previousStock: after.stock - deltaUnits,
      stock: after.stock,
    });
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }
}
