const LOW_STOCK_THRESHOLD = 3;

export class AdjustStockResponseDto {
  variantId: string;
  previousStock: number;
  stock: number;
  crossedLowStockThreshold: boolean;

  constructor(params: {
    variantId: string;
    previousStock: number;
    stock: number;
  }) {
    this.variantId = params.variantId;
    this.previousStock = params.previousStock;
    this.stock = params.stock;
    this.crossedLowStockThreshold =
      params.previousStock <= LOW_STOCK_THRESHOLD !==
      params.stock <= LOW_STOCK_THRESHOLD;
  }
}
