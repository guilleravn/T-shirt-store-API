import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '../../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReorderImagesDto } from './dto/reorder-images.dto';
import { UpdateImageDto } from './dto/update-image.dto';
import { UploadProductImageDto } from './dto/upload-product-image.dto';
import { ProductImagesService } from './product-images.service';

// Every route here is MANAGER-only, same shape as ProductVariantsController.
@Controller('products/:productId/images')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ProductImagesController {
  constructor(private readonly productImagesService: ProductImagesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param('productId', ParseUUIDPipe) productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadProductImageDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const image = await this.productImagesService.upload(
      productId,
      file,
      dto.altText,
    );
    res.setHeader('Location', `/v1/products/${productId}/images/${image.id}`);
    return image;
  }

  @Put('order')
  reorder(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.productImagesService.reorder(productId, dto.imageIds);
  }

  @Patch(':imageId')
  updateAltText(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateImageDto,
  ) {
    return this.productImagesService.updateAltText(
      productId,
      imageId,
      dto.altText,
    );
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productImagesService.remove(productId, imageId);
  }
}
