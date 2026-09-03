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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import type { User } from '../../generated/prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ReplaceCategoriesDto } from './dto/replace-categories.dto';
import { SetActiveDto } from './dto/set-active.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(@Query() query: ListProductsQueryDto, @CurrentUser() user?: User) {
    return this.productsService.list(
      query,
      user ? { id: user.id, role: user.role } : undefined,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Get(':productId')
  @UseGuards(OptionalJwtAuthGuard)
  detail(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user?: User,
  ) {
    return this.productsService.detail(
      productId,
      user ? { id: user.id, role: user.role } : undefined,
    );
  }

  @Patch(':productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(productId, dto);
  }

  @Delete(':productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.productsService.softDelete(productId);
  }

  @Patch(':productId/active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  setActive(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.productsService.setActive(productId, dto.isActive);
  }

  @Put(':productId/categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER)
  replaceCategories(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReplaceCategoriesDto,
  ) {
    return this.productsService.replaceCategories(productId, dto.categoryIds);
  }
}
