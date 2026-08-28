import { Controller, Get } from '@nestjs/common';
import { CatalogReferenceService } from './catalog-reference.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { ColorResponseDto } from './dto/color-response.dto';
import { SizeResponseDto } from './dto/size-response.dto';

// No class-level prefix: /categories, /colors and /sizes don't share one — same reasoning
// AuthController already uses for /me sitting outside /auth.
@Controller()
export class CatalogReferenceController {
  constructor(
    private readonly catalogReferenceService: CatalogReferenceService,
  ) {}

  @Get('categories')
  listCategories(): Promise<CategoryResponseDto[]> {
    return this.catalogReferenceService.listCategories();
  }

  @Get('colors')
  listColors(): Promise<ColorResponseDto[]> {
    return this.catalogReferenceService.listColors();
  }

  @Get('sizes')
  listSizes(): Promise<SizeResponseDto[]> {
    return this.catalogReferenceService.listSizes();
  }
}
