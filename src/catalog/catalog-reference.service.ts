import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { ColorResponseDto } from './dto/color-response.dto';
import { SizeResponseDto } from './dto/size-response.dto';

// Categories, colors and sizes are seeded, not created through the API (see prisma/seed.ts) —
// this service is read-only on purpose.
@Injectable()
export class CatalogReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
    return categories.map((category) => new CategoryResponseDto(category));
  }

  async listColors(): Promise<ColorResponseDto[]> {
    const colors = await this.prisma.color.findMany({
      orderBy: { name: 'asc' },
    });
    return colors.map((color) => new ColorResponseDto(color));
  }

  async listSizes(): Promise<SizeResponseDto[]> {
    const sizes = await this.prisma.size.findMany({
      orderBy: { position: 'asc' },
    });
    return sizes.map((size) => new SizeResponseDto(size));
  }
}
