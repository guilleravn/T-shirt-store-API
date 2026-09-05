import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogReferenceController } from './catalog-reference.controller';
import { CatalogReferenceService } from './catalog-reference.service';
import { ProductImagesController } from './product-images.controller';
import { ProductImagesService } from './product-images.service';
import { ProductVariantsController } from './product-variants.controller';
import { ProductVariantsService } from './product-variants.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { S3ImageStorageService } from './s3-image-storage.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    CatalogReferenceController,
    ProductsController,
    ProductVariantsController,
    ProductImagesController,
  ],
  providers: [
    CatalogReferenceService,
    ProductsService,
    ProductVariantsService,
    ProductImagesService,
    S3ImageStorageService,
  ],
})
export class CatalogModule {}
