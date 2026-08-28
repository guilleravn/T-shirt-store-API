import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductVariantsService } from './product-variants.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

function buildPrismaMock() {
  return {
    product: {
      findFirst: jest.fn(),
    },
    productVariant: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
}

const color = { id: 'col-1', name: 'Black', hexCode: '#000000' };
const size = { id: 'siz-1', name: 'M', position: 20 };

function buildVariant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'var-1',
    productId: 'prod-1',
    sku: 'TEE-BLK-M',
    priceCents: 1500,
    stock: 10,
    isActive: true,
    color,
    size,
    ...overrides,
  };
}

describe('ProductVariantsService', () => {
  let service: ProductVariantsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const module = await Test.createTestingModule({
      providers: [
        ProductVariantsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ProductVariantsService);
  });

  describe('list', () => {
    it('lists variants for an existing product', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productVariant.count.mockResolvedValue(1);
      prisma.productVariant.findMany.mockResolvedValue([buildVariant()]);

      const result = await service.list('prod-1', {
        includeInactive: false,
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].stock).toBe(10);
      expect(result.meta).toEqual({
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      });
    });

    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.list('missing', { limit: 20, offset: 0 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('filters to low-stock variants when lowStock=true', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productVariant.count.mockResolvedValue(0);
      prisma.productVariant.findMany.mockResolvedValue([]);

      await service.list('prod-1', {
        lowStock: true,
        includeInactive: false,
        limit: 20,
        offset: 0,
      });

      expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stock: { lte: 3 },
          }) as Record<string, unknown>,
        }),
      );
    });

    it('drops the isActive filter when includeInactive=true', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productVariant.count.mockResolvedValue(0);
      prisma.productVariant.findMany.mockResolvedValue([]);

      await service.list('prod-1', {
        includeInactive: true,
        limit: 20,
        offset: 0,
      });

      expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            isActive: true,
          }) as Record<string, unknown>,
        }),
      );
    });
  });

  describe('create', () => {
    it('creates a variant under the product', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productVariant.create.mockResolvedValue(buildVariant());

      const result = await service.create('prod-1', {
        colorId: color.id,
        sizeId: size.id,
        sku: 'TEE-BLK-M',
        priceCents: 1500,
      });

      expect(result.sku).toBe('TEE-BLK-M');
    });

    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.create('missing', {
          colorId: color.id,
          sizeId: size.id,
          sku: 'TEE-BLK-M',
          priceCents: 1500,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps a P2002 unique violation to ConflictException', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productVariant.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create('prod-1', {
          colorId: color.id,
          sizeId: size.id,
          sku: 'TEE-BLK-M',
          priceCents: 1500,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a P2003 FK violation to BadRequestException', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productVariant.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk violation', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create('prod-1', {
          colorId: 'missing',
          sizeId: size.id,
          sku: 'TEE-BLK-M',
          priceCents: 1500,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates and returns the variant', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
      prisma.productVariant.findUniqueOrThrow.mockResolvedValue(
        buildVariant({ priceCents: 1800 }),
      );

      const result = await service.update('prod-1', 'var-1', {
        priceCents: 1800,
      });

      expect(result.priceCents).toBe(1800);
    });

    it('throws NotFoundException when nothing matched', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('prod-1', 'missing', { priceCents: 1800 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps a P2002 unique violation to ConflictException', async () => {
      prisma.productVariant.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('prod-1', 'var-1', { sku: 'TAKEN-SKU' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and isActive false', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });

      await service.softDelete('prod-1', 'var-1');

      expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
        where: { id: 'var-1', productId: 'prod-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) as Date, isActive: false },
      });
    });

    it('throws NotFoundException when nothing matched', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.softDelete('prod-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setActive', () => {
    it('toggles isActive', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.setActive('prod-1', 'var-1', false);

      expect(result).toEqual({ id: 'var-1', isActive: false });
    });

    it('throws NotFoundException when nothing matched', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.setActive('prod-1', 'missing', false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('adjustStock', () => {
    it('applies a positive delta and reports the previous stock algebraically', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
      prisma.productVariant.findUniqueOrThrow.mockResolvedValue({
        stock: 15,
      });

      const result = await service.adjustStock('prod-1', 'var-1', 5);

      expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'var-1',
          productId: 'prod-1',
          deletedAt: null,
          stock: { gte: -5 },
        },
        data: { stock: { increment: 5 } },
      });
      expect(result).toEqual({
        variantId: 'var-1',
        previousStock: 10,
        stock: 15,
        crossedLowStockThreshold: false,
      });
    });

    it('throws ConflictException when the delta would take stock negative', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });
      prisma.productVariant.findFirst.mockResolvedValue({ id: 'var-1' });

      await expect(
        service.adjustStock('prod-1', 'var-1', -100),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when the variant does not exist', async () => {
      prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.adjustStock('prod-1', 'missing', 5),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
