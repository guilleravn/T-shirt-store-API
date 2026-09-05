import { CartItemResponseDto } from './cart-item-response.dto';

export interface CartResponseSource {
  id: string;
  items: CartItemResponseDto[];
}

export class CartResponseDto {
  id: string;
  items: CartItemResponseDto[];
  subtotalCents: number;
  itemCount: number;
  hasUnavailableItems: boolean;

  constructor(source: CartResponseSource) {
    this.id = source.id;
    this.items = source.items;
    this.subtotalCents = source.items.reduce(
      (sum, item) => sum + item.lineTotalCents,
      0,
    );
    this.itemCount = source.items.reduce((sum, item) => sum + item.quantity, 0);
    this.hasUnavailableItems = source.items.some((item) => !item.available);
  }
}
