import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ProductImagesService } from './product-images.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3ImageStorageService } from './s3-image-storage.service';

function buildPrismaMock() {
  const prisma = {
    product: {
      findFirst: jest.fn(),
    },
    productImage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function buildStorageMock() {
  return {
    upload: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    getPublicUrl: jest.fn((key: string) => `https://cdn.example/${key}`),
  };
}

function buildImage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'img-1',
    productId: 'prod-1',
    s3Key: 'products/prod-1/img-1.jpg',
    altText: null,
    position: 0,
    ...overrides,
  };
}

describe('ProductImagesService', () => {
  let service: ProductImagesService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let storage: ReturnType<typeof buildStorageMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    storage = buildStorageMock();
    const module = await Test.createTestingModule({
      providers: [
        ProductImagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3ImageStorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(ProductImagesService);
  });

  describe('upload', () => {
    const file = {
      buffer: Buffer.from('fake-bytes'),
      mimetype: 'image/jpeg',
      size: 1024,
    };

    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.upload('prod-1', file, undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when no file was sent', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });

      await expect(
        service.upload('prod-1', undefined, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws PayloadTooLargeException when the file exceeds 5MB', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });

      await expect(
        service.upload(
          'prod-1',
          { ...file, size: 5 * 1024 * 1024 + 1 },
          undefined,
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws UnsupportedMediaTypeException for a disallowed mime type', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });

      await expect(
        service.upload(
          'prod-1',
          { ...file, mimetype: 'application/pdf' },
          undefined,
        ),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('uploads to storage, appends the image at the end, and returns it', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productImage.count.mockResolvedValue(2);
      prisma.productImage.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => data,
      );

      const result = await service.upload('prod-1', file, 'Front view');

      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^products\/prod-1\/.+\.jpg$/),
        file.buffer,
        'image/jpeg',
      );
      expect(prisma.productImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'prod-1',
            altText: 'Front view',
            position: 2,
          }) as Record<string, unknown>,
        }),
      );
      expect(result.altText).toBe('Front view');
      expect(result.position).toBe(2);
      expect(result.url).toContain('https://cdn.example/');
    });
  });

  describe('reorder', () => {
    it('throws BadRequestException when imageIds do not match the current set', async () => {
      prisma.productImage.findMany.mockResolvedValue([
        buildImage({ id: 'img-1' }),
        buildImage({ id: 'img-2' }),
      ]);

      await expect(
        service.reorder('prod-1', ['img-1', 'img-3']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rewrites positions in the requested order', async () => {
      prisma.productImage.findMany
        .mockResolvedValueOnce([
          buildImage({ id: 'img-1', position: 0 }),
          buildImage({ id: 'img-2', position: 1 }),
        ])
        .mockResolvedValueOnce([
          buildImage({ id: 'img-2', position: 0 }),
          buildImage({ id: 'img-1', position: 1 }),
        ]);

      const result = await service.reorder('prod-1', ['img-2', 'img-1']);

      expect(prisma.productImage.update).toHaveBeenCalledWith({
        where: { id: 'img-2' },
        data: { position: 0 },
      });
      expect(prisma.productImage.update).toHaveBeenCalledWith({
        where: { id: 'img-1' },
        data: { position: 1 },
      });
      expect(result.images.map((image) => image.id)).toEqual([
        'img-2',
        'img-1',
      ]);
    });
  });

  describe('updateAltText', () => {
    it('throws NotFoundException when nothing matched', async () => {
      prisma.productImage.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateAltText('prod-1', 'img-1', 'New alt'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('only updates altText when it was actually provided', async () => {
      prisma.productImage.updateMany.mockResolvedValue({ count: 1 });
      prisma.productImage.findUniqueOrThrow.mockResolvedValue(buildImage());

      await service.updateAltText('prod-1', 'img-1', undefined);

      expect(prisma.productImage.updateMany).toHaveBeenCalledWith({
        where: { id: 'img-1', productId: 'prod-1' },
        data: {},
      });
    });

    it('returns the updated image', async () => {
      prisma.productImage.updateMany.mockResolvedValue({ count: 1 });
      prisma.productImage.findUniqueOrThrow.mockResolvedValue(
        buildImage({ altText: 'New alt' }),
      );

      const result = await service.updateAltText('prod-1', 'img-1', 'New alt');

      expect(result.altText).toBe('New alt');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the image does not belong to the product', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);

      await expect(service.remove('prod-1', 'img-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.productImage.delete).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('deletes the DB row before deleting the S3 object', async () => {
      const image = buildImage();
      prisma.productImage.findFirst.mockResolvedValue(image);
      const callOrder: string[] = [];
      prisma.productImage.delete.mockImplementation(() => {
        callOrder.push('db');
        return Promise.resolve(image);
      });
      storage.delete.mockImplementation(() => {
        callOrder.push('s3');
        return Promise.resolve();
      });

      await service.remove('prod-1', 'img-1');

      expect(prisma.productImage.delete).toHaveBeenCalledWith({
        where: { id: 'img-1' },
      });
      expect(storage.delete).toHaveBeenCalledWith(image.s3Key);
      expect(callOrder).toEqual(['db', 's3']);
    });
  });
});
