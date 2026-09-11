import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductImageResponseDto } from './dto/product-image-response.dto';
import { ReorderImagesResponseDto } from './dto/reorder-images-response.dto';
import { S3ImageStorageService } from './s3-image-storage.service';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

interface StoredImage {
  id: string;
  s3Key: string;
  altText: string | null;
  position: number;
}

@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3ImageStorageService,
  ) {}

  async upload(
    productId: string,
    file: UploadedImageFile | undefined,
    altText: string | undefined,
  ): Promise<ProductImageResponseDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new PayloadTooLargeException('Image must be 5MB or smaller');
    }
    const extension = EXTENSION_BY_MIME_TYPE[file.mimetype];
    if (!extension) {
      throw new UnsupportedMediaTypeException(
        'Only JPEG, PNG, or WEBP images are allowed',
      );
    }

    const id = randomUUID();
    const key = `products/${productId}/${id}.${extension}`;
    const position = await this.prisma.productImage.count({
      where: { productId },
    });

    // S3 write happens before the DB insert: an orphaned S3 object on a later DB failure is
    // harmless, while the reverse order risks a DB row pointing at a key that was never written.
    await this.storage.upload(key, file.buffer, file.mimetype);

    const image = await this.prisma.productImage.create({
      data: { id, productId, s3Key: key, altText, position },
    });

    return this.toResponseDto(image);
  }

  async reorder(
    productId: string,
    imageIds: string[],
  ): Promise<ReorderImagesResponseDto> {
    const images = await this.prisma.productImage.findMany({
      where: { productId },
    });

    const currentIds = new Set(images.map((image) => image.id));
    const requestedIds = new Set(imageIds);
    const sameMembers =
      currentIds.size === requestedIds.size &&
      [...currentIds].every((id) => requestedIds.has(id));
    if (!sameMembers) {
      throw new BadRequestException(
        "imageIds must list exactly the product's current images",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Sequential, not Promise.all: firing concurrent writes on one interactive transaction's
      // client isn't a pattern Prisma supports safely — a single transaction serializes its own
      // queries one at a time regardless, so there's no real parallelism to gain here anyway.
      for (const [index, imageId] of imageIds.entries()) {
        await tx.productImage.update({
          where: { id: imageId },
          data: { position: index },
        });
      }
    });

    const reordered = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return new ReorderImagesResponseDto(
      reordered.map((image) => this.toResponseDto(image)),
    );
  }

  async updateAltText(
    productId: string,
    imageId: string,
    altText: string | undefined,
  ): Promise<ProductImageResponseDto> {
    const result = await this.prisma.productImage.updateMany({
      where: { id: imageId, productId },
      data: { ...(altText !== undefined && { altText }) },
    });
    if (result.count === 0) {
      throw new NotFoundException('Image not found');
    }

    const image = await this.prisma.productImage.findUniqueOrThrow({
      where: { id: imageId },
    });
    return this.toResponseDto(image);
  }

  async remove(productId: string, imageId: string): Promise<void> {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) {
      throw new NotFoundException('Image not found');
    }

    // DB row goes first: a leftover S3 object if the delete call below fails is harmless, while
    // the reverse order risks a DB row pointing at a key that no longer exists. The S3 call is
    // best-effort on purpose — the DB row is already gone by the time it runs, so letting an S3
    // failure propagate would surface a 500 for a delete that, from the product's point of view,
    // already succeeded.
    await this.prisma.productImage.delete({ where: { id: imageId } });
    try {
      await this.storage.delete(image.s3Key);
    } catch (error) {
      this.logger.error(
        `Failed to delete S3 object ${image.s3Key} for removed image ${imageId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  private toResponseDto(image: StoredImage): ProductImageResponseDto {
    return new ProductImageResponseDto({
      id: image.id,
      url: this.storage.getPublicUrl(image.s3Key),
      altText: image.altText,
      position: image.position,
    });
  }
}
