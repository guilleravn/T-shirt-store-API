import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductLikesService } from './product-likes.service';
import { PrismaService } from '../prisma/prisma.service';

function buildPrismaMock() {
  return {
    product: {
      findFirst: jest.fn(),
    },
    productLike: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

describe('ProductLikesService', () => {
  let service: ProductLikesService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const module = await Test.createTestingModule({
      providers: [
        ProductLikesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ProductLikesService);
  });

  describe('like', () => {
    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.like('user-1', 'prod-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.productLike.upsert).not.toHaveBeenCalled();
    });

    it('upserts the like (idempotent) and returns the fresh count', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productLike.count.mockResolvedValue(3);

      const result = await service.like('user-1', 'prod-1');

      expect(prisma.productLike.upsert).toHaveBeenCalledWith({
        where: { userId_productId: { userId: 'user-1', productId: 'prod-1' } },
        create: { userId: 'user-1', productId: 'prod-1' },
        update: {},
      });
      expect(result).toEqual({
        productId: 'prod-1',
        liked: true,
        likesCount: 3,
      });
    });
  });

  describe('unlike', () => {
    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.unlike('user-1', 'prod-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.productLike.deleteMany).not.toHaveBeenCalled();
    });

    it('removes the like (idempotent even if it never existed) and returns the fresh count', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productLike.deleteMany.mockResolvedValue({ count: 0 });
      prisma.productLike.count.mockResolvedValue(2);

      const result = await service.unlike('user-1', 'prod-1');

      expect(prisma.productLike.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', productId: 'prod-1' },
      });
      expect(result).toEqual({
        productId: 'prod-1',
        liked: false,
        likesCount: 2,
      });
    });
  });
});
