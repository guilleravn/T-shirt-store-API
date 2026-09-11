import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '../../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ListVariantsQueryDto } from './dto/list-variants-query.dto';
import { SetActiveDto } from './dto/set-active.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ProductVariantsService } from './product-variants.service';

// Every route here is MANAGER-only — this is the real-stock view, never public.
// See ProductsController's ProductDetail response for the public-facing PublicVariant view.
@Controller('products/:productId/variants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ProductVariantsController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
  ) {}

  @Get()
  list(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: ListVariantsQueryDto,
  ) {
    return this.productVariantsService.list(productId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const variant = await this.productVariantsService.create(productId, dto);
    res.setHeader(
      'Location',
      `/v1/products/${productId}/variants/${variant.id}`,
    );
    return variant;
  }

  @Patch(':variantId')
  update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productVariantsService.update(productId, variantId, dto);
  }

  @Delete(':variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.productVariantsService.softDelete(productId, variantId);
  }

  @Patch(':variantId/active')
  setActive(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.productVariantsService.setActive(
      productId,
      variantId,
      dto.isActive,
    );
  }

  @Post(':variantId/stock')
  @HttpCode(HttpStatus.OK)
  adjustStock(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.productVariantsService.adjustStock(
      productId,
      variantId,
      dto.deltaUnits,
    );
  }
}
