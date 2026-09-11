import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LikeResponseDto } from './dto/like-response.dto';

@Injectable()
export class ProductLikesService {
  constructor(private readonly prisma: PrismaService) {}

  async like(userId: string, productId: string): Promise<LikeResponseDto> {
    await this.assertProductExists(productId);

    await this.prisma.productLike.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });

    return this.buildResponse(productId, true);
  }

  async unlike(userId: string, productId: string): Promise<LikeResponseDto> {
    await this.assertProductExists(productId);

    await this.prisma.productLike.deleteMany({
      where: { userId, productId },
    });

    return this.buildResponse(productId, false);
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }

  private async buildResponse(
    productId: string,
    liked: boolean,
  ): Promise<LikeResponseDto> {
    const likesCount = await this.prisma.productLike.count({
      where: { productId },
    });
    return new LikeResponseDto({ productId, liked, likesCount });
  }
}
