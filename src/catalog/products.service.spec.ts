import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { ProductSort } from './dto/list-products-query.dto';

function buildPrismaMock() {
  const prisma = {
    product: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    productCategory: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    category: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    productVariant: {
      createMany: jest.fn(),
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

const category = { id: 'cat-1', name: 'Basics', slug: 'basics' };
const color = { id: 'col-1', name: 'Black', hexCode: '#000000' };
const size = { id: 'siz-1', name: 'M', position: 20 };

function buildProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prod-1',
    name: 'Classic Tee',
    description: 'A tee',
    isActive: true,
    deletedAt: null,
    productCategories: [{ category }],
    variants: [
      {
        id: 'var-1',
        sku: 'TEE-BLK-M',
        priceCents: 1500,
        stock: 10,
        isActive: true,
        color,
        size,
      },
    ],
    ...overrides,
  };
}

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  describe('list', () => {
    it('lists active products for an anonymous caller', async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([buildProduct()]);

      const result = await service.list({ limit: 20, offset: 0 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            isActive: true,
          }) as Record<string, unknown>,
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].priceRange).toEqual({
        minCents: 1500,
        maxCents: 1500,
      });
      expect(result.meta).toEqual({
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      });
    });

    it('rejects includeInactive from an anonymous caller', async () => {
      await expect(
        service.list({ includeInactive: true, limit: 20, offset: 0 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it('rejects includeInactive from a non-MANAGER caller', async () => {
      await expect(
        service.list(
          { includeInactive: true, limit: 20, offset: 0 },
          { role: UserRole.CLIENT },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('drops the isActive filter for a MANAGER requesting includeInactive', async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([buildProduct()]);

      await service.list(
        { includeInactive: true, limit: 20, offset: 0 },
        { role: UserRole.MANAGER },
      );

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            isActive: true,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('sorts by price using ProductVariant.groupBy', async () => {
      prisma.productVariant.groupBy
        .mockResolvedValueOnce([{ productId: 'prod-1' }])
        .mockResolvedValueOnce([{ productId: 'prod-1' }]);
      prisma.product.findMany.mockResolvedValue([buildProduct()]);

      const result = await service.list({
        sort: ProductSort.PriceAsc,
        limit: 20,
        offset: 0,
      });

      expect(prisma.productVariant.groupBy).toHaveBeenCalledTimes(2);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters by category slug', async () => {
      prisma.product.count.mockResolvedValue(0);
      prisma.product.findMany.mockResolvedValue([]);

      await service.list({ category: 'basics', limit: 20, offset: 0 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productCategories: {
              some: { category: { slug: 'basics' } },
            },
          }) as Record<string, unknown>,
        }),
      );
    });

    it('filters by name, case-insensitive', async () => {
      prisma.product.count.mockResolvedValue(0);
      prisma.product.findMany.mockResolvedValue([]);

      await service.list({ name: 'tee', limit: 20, offset: 0 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: 'tee', mode: 'insensitive' },
          }) as Record<string, unknown>,
        }),
      );
    });

    it('requires colorId, sizeId and the price range to match the same variant', async () => {
      prisma.product.count.mockResolvedValue(0);
      prisma.product.findMany.mockResolvedValue([]);

      await service.list({
        colorId: color.id,
        sizeId: size.id,
        minPriceCents: 1000,
        maxPriceCents: 3000,
        limit: 20,
        offset: 0,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            variants: {
              some: expect.objectContaining({
                colorId: color.id,
                sizeId: size.id,
                priceCents: { gte: 1000, lte: 3000 },
              }) as Record<string, unknown>,
            },
          }) as Record<string, unknown>,
        }),
      );
    });

    it('sorts by name when sort=name', async () => {
      prisma.product.count.mockResolvedValue(0);
      prisma.product.findMany.mockResolvedValue([]);

      await service.list({
        sort: ProductSort.Name,
        limit: 20,
        offset: 0,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('defaults to newest-first when no sort is given', async () => {
      prisma.product.count.mockResolvedValue(0);
      prisma.product.findMany.mockResolvedValue([]);

      await service.list({ limit: 20, offset: 0 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  describe('detail', () => {
    it('returns the product for an anonymous caller', async () => {
      prisma.product.findFirst.mockResolvedValue(buildProduct());

      const result = await service.detail('prod-1');

      expect(result.id).toBe('prod-1');
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('lets a MANAGER see a disabled product', async () => {
      prisma.product.findFirst.mockResolvedValue(
        buildProduct({ isActive: false }),
      );

      await service.detail('prod-1', { role: UserRole.MANAGER });

      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            isActive: true,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('throws NotFoundException when the product does not exist or is invisible', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.detail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a product with categories and variants in one transaction', async () => {
      prisma.category.count.mockResolvedValue(1);
      prisma.product.create.mockResolvedValue({ id: 'prod-1' });
      prisma.product.findUniqueOrThrow.mockResolvedValue(buildProduct());

      const result = await service.create({
        name: 'Classic Tee',
        categoryIds: [category.id],
        variants: [
          {
            colorId: color.id,
            sizeId: size.id,
            sku: 'TEE-BLK-M',
            priceCents: 1500,
          },
        ],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.productCategory.createMany).toHaveBeenCalled();
      expect(prisma.productVariant.createMany).toHaveBeenCalled();
      expect(result.id).toBe('prod-1');
    });

    it('rejects a categoryId that does not exist', async () => {
      prisma.category.count.mockResolvedValue(0);

      await expect(
        service.create({ name: 'Classic Tee', categoryIds: [category.id] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps a P2002 unique violation to ConflictException', async () => {
      prisma.product.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({ name: 'Classic Tee' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a bare product with no categories or variants', async () => {
      prisma.product.create.mockResolvedValue({ id: 'prod-1' });
      prisma.product.findUniqueOrThrow.mockResolvedValue(
        buildProduct({ productCategories: [], variants: [] }),
      );

      const result = await service.create({ name: 'Classic Tee' });

      expect(prisma.category.count).not.toHaveBeenCalled();
      expect(prisma.productCategory.createMany).not.toHaveBeenCalled();
      expect(prisma.productVariant.createMany).not.toHaveBeenCalled();
      expect(result.id).toBe('prod-1');
    });

    it('maps a P2003 FK violation to BadRequestException', async () => {
      prisma.product.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk violation', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({
          name: 'Classic Tee',
          variants: [
            {
              colorId: 'missing',
              sizeId: size.id,
              sku: 'TEE-BLK-M',
              priceCents: 1500,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates and returns the product', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 1 });
      prisma.product.findFirst.mockResolvedValue(buildProduct());

      const result = await service.update('prod-1', { name: 'New name' });

      expect(result.id).toBe('prod-1');
    });

    it('only sends the fields that were actually provided', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 1 });
      prisma.product.findFirst.mockResolvedValue(buildProduct());

      await service.update('prod-1', { name: 'New name' });

      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', deletedAt: null },
        data: { name: 'New name' },
      });
    });

    it('allows clearing the description with null', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 1 });
      prisma.product.findFirst.mockResolvedValue(buildProduct());

      await service.update('prod-1', { description: null });

      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', deletedAt: null },
        data: { description: null },
      });
    });

    it('throws NotFoundException when nothing matched', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('missing', { name: 'New name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and isActive false', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 1 });

      await service.softDelete('prod-1');

      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) as Date, isActive: false },
      });
    });

    it('throws NotFoundException when nothing matched', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.softDelete('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setActive', () => {
    it('toggles isActive', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.setActive('prod-1', false);

      expect(result).toEqual({ id: 'prod-1', isActive: false });
    });

    it('throws NotFoundException when nothing matched', async () => {
      prisma.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.setActive('missing', false)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('replaceCategories', () => {
    it('replaces the join rows in one transaction', async () => {
      prisma.product.findFirst.mockResolvedValue(buildProduct());
      prisma.category.count.mockResolvedValue(1);
      prisma.category.findMany.mockResolvedValue([category]);

      const result = await service.replaceCategories('prod-1', [category.id]);

      expect(prisma.productCategory.deleteMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1' },
      });
      expect(prisma.productCategory.createMany).toHaveBeenCalled();
      expect(result.categories).toEqual([category]);
    });

    it('throws NotFoundException for a missing product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.replaceCategories('missing', [category.id]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a categoryId that does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(buildProduct());
      prisma.category.count.mockResolvedValue(0);

      await expect(
        service.replaceCategories('prod-1', [category.id]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
