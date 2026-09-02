export interface LikeResponseSource {
  productId: string;
  liked: boolean;
  likesCount: number;
}

export class LikeResponseDto {
  productId: string;
  liked: boolean;
  likesCount: number;

  constructor(source: LikeResponseSource) {
    this.productId = source.productId;
    this.liked = source.liked;
    this.likesCount = source.likesCount;
  }
}
