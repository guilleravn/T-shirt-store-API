export interface ProductImageResponseSource {
  id: string;
  url: string;
  altText: string | null;
  position: number;
}

export class ProductImageResponseDto {
  id: string;
  url: string;
  altText: string | null;
  position: number;

  constructor(image: ProductImageResponseSource) {
    this.id = image.id;
    this.url = image.url;
    this.altText = image.altText;
    this.position = image.position;
  }
}
