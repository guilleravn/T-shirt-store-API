import { ProductImageResponseDto } from './product-image-response.dto';

export class ReorderImagesResponseDto {
  images: ProductImageResponseDto[];

  constructor(images: ProductImageResponseDto[]) {
    this.images = images;
  }
}
