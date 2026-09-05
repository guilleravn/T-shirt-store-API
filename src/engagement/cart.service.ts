import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VariantResponseDto } from '../catalog/dto/variant-response.dto';
import {
  CartItemIssue,
  CartItemResponseDto,
} from './dto/cart-item-response.dto';
import { CartResponseDto } from './dto/cart-response.dto';

interface PurchasableProduct {
  isActive: boolean;
  deletedAt: Date | null;
}

interface PurchasableVariant {
  isActive: boolean;
  deletedAt: Date | null;
  stock: number;
}

interface CartItemWithVariant {
  id: string;
  quantity: number;
  variant: {
    id: string;
    sku: string;
    priceCents: number;
    stock: number;
    isActive: boolean;
    deletedAt: Date | null;
    color: { id: string; name: string; hexCode: string };
    size: { id: string; name: string; position: number };
    product: PurchasableProduct;
  };
}

const VARIANT_WITH_COLOR_SIZE_PRODUCT = {
  color: true,
  size: true,
  product: true,
} as const;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: string): Promise<CartResponseDto> {
    const cart = await this.getOrCreateCart(userId);
    const items = await this.fetchItems(cart.id);
    return new CartResponseDto({
      id: cart.id,
      items: items.map((item) => this.buildCartItemView(item)),
    });
  }

  async addItem(
    userId: string,
    dto: { productVariantId: string; quantity: number },
  ): Promise<CartResponseDto> {
    const cart = await this.getOrCreateCart(userId);

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.productVariantId, deletedAt: null },
      include: { product: true },
    });
    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    // Atomic upsert (Postgres INSERT ... ON CONFLICT DO UPDATE), not a separate find-then-write —
    // two concurrent adds of the same variant would otherwise both pass a stale "does a row exist
    // yet" check and one would lose to the other's @@unique([cartId, productVariantId]) with an
    // unhandled P2002 (product-likes.service.ts already solves the identical shape this way).
    // assertPurchasable runs against the upsert's own returned (real, post-write) quantity, and
    // its throw rolls the transaction back if that final quantity is no longer purchasable.
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.cartItem.upsert({
        where: {
          cartId_productVariantId: {
            cartId: cart.id,
            productVariantId: dto.productVariantId,
          },
        },
        create: {
          cartId: cart.id,
          productVariantId: dto.productVariantId,
          quantity: dto.quantity,
        },
        update: { quantity: { increment: dto.quantity } },
      });
      this.assertPurchasable(variant.product, variant, item.quantity);
    });

    return this.getCart(userId);
  }

  async setItemQuantity(
    userId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartResponseDto> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      include: { variant: { include: { product: true } } },
    });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    this.assertPurchasable(item.variant.product, item.variant, quantity);

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });

    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<void> {
    const result = await this.prisma.cartItem.deleteMany({
      where: { id: itemId, cart: { userId } },
    });
    if (result.count === 0) {
      throw new NotFoundException('Cart item not found');
    }
  }

  async clearCart(userId: string): Promise<void> {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      return;
    }
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  private getOrCreateCart(userId: string) {
    return this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  private fetchItems(cartId: string): Promise<CartItemWithVariant[]> {
    return this.prisma.cartItem.findMany({
      where: { cartId },
      orderBy: { createdAt: 'asc' },
      include: { variant: { include: VARIANT_WITH_COLOR_SIZE_PRODUCT } },
    });
  }

  // Strict: used by add/set-quantity, which never persist a line that isn't currently
  // purchasable. Contrast with buildCartItemView below, which never throws — an existing line
  // that went stale after being added must still be readable.
  private assertPurchasable(
    product: PurchasableProduct,
    variant: PurchasableVariant,
    quantity: number,
  ): void {
    if (product.deletedAt || !product.isActive) {
      throw new ConflictException('Product is not available');
    }
    if (variant.deletedAt || !variant.isActive) {
      throw new ConflictException('Variant is disabled');
    }
    if (variant.stock === 0) {
      throw new ConflictException('Variant is out of stock');
    }
    if (variant.stock < quantity) {
      throw new ConflictException('Insufficient stock');
    }
  }

  private buildCartItemView(item: CartItemWithVariant): CartItemResponseDto {
    const { variant } = item;
    const { product } = variant;
    const issues: CartItemIssue[] = [];

    if (product.deletedAt || !product.isActive) {
      issues.push(CartItemIssue.ProductUnavailable);
    }
    if (variant.deletedAt || !variant.isActive) {
      issues.push(CartItemIssue.VariantDisabled);
    }
    if (variant.stock === 0) {
      issues.push(CartItemIssue.OutOfStock);
    } else if (variant.stock < item.quantity) {
      issues.push(CartItemIssue.InsufficientStock);
    }

    return new CartItemResponseDto({
      id: item.id,
      variant: new VariantResponseDto(variant),
      quantity: item.quantity,
      lineTotalCents: item.quantity * variant.priceCents,
      available: issues.length === 0,
      maxQuantity: Math.min(variant.stock, 99),
      issues,
    });
  }
}
