import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';
import { PrismaService } from '../prisma/prisma.service';
import { CartItemIssue } from './dto/cart-item-response.dto';

function buildPrismaMock() {
  const prisma = {
    cart: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    productVariant: {
      findFirst: jest.fn(),
    },
    cartItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

const color = { id: 'col-1', name: 'Black', hexCode: '#000000' };
const size = { id: 'siz-1', name: 'M', position: 20 };

function buildVariant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'var-1',
    sku: 'TEE-BLK-M',
    priceCents: 1500,
    stock: 10,
    isActive: true,
    deletedAt: null,
    color,
    size,
    product: { isActive: true, deletedAt: null },
    ...overrides,
  };
}

function buildCartItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item-1',
    quantity: 2,
    variant: buildVariant(),
    ...overrides,
  };
}

describe('CartService', () => {
  let service: CartService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    prisma.cart.upsert.mockResolvedValue({ id: 'cart-1', userId: 'user-1' });
    const module = await Test.createTestingModule({
      providers: [CartService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CartService);
  });

  describe('getCart', () => {
    it('returns an empty cart when there are no items', async () => {
      prisma.cartItem.findMany.mockResolvedValue([]);

      const result = await service.getCart('user-1');

      expect(result).toEqual({
        id: 'cart-1',
        items: [],
        subtotalCents: 0,
        itemCount: 0,
        hasUnavailableItems: false,
      });
    });

    it('maps a healthy line with no issues', async () => {
      prisma.cartItem.findMany.mockResolvedValue([buildCartItem()]);

      const result = await service.getCart('user-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'item-1',
        quantity: 2,
        lineTotalCents: 3000,
        available: true,
        maxQuantity: 10,
        issues: [],
      });
      expect(result.subtotalCents).toBe(3000);
      expect(result.itemCount).toBe(2);
      expect(result.hasUnavailableItems).toBe(false);
    });

    it('flags OUT_OF_STOCK when stock is 0', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        buildCartItem({ variant: buildVariant({ stock: 0 }) }),
      ]);

      const result = await service.getCart('user-1');

      expect(result.items[0].issues).toEqual([CartItemIssue.OutOfStock]);
      expect(result.items[0].available).toBe(false);
      expect(result.hasUnavailableItems).toBe(true);
    });

    it('flags INSUFFICIENT_STOCK when stock is below the requested quantity', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        buildCartItem({ quantity: 5, variant: buildVariant({ stock: 2 }) }),
      ]);

      const result = await service.getCart('user-1');

      expect(result.items[0].issues).toEqual([CartItemIssue.InsufficientStock]);
    });

    it('flags VARIANT_DISABLED when the variant is inactive', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        buildCartItem({ variant: buildVariant({ isActive: false }) }),
      ]);

      const result = await service.getCart('user-1');

      expect(result.items[0].issues).toEqual([CartItemIssue.VariantDisabled]);
    });

    it('flags PRODUCT_UNAVAILABLE when the product is inactive', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        buildCartItem({
          variant: buildVariant({
            product: { isActive: false, deletedAt: null },
          }),
        }),
      ]);

      const result = await service.getCart('user-1');

      expect(result.items[0].issues).toEqual([
        CartItemIssue.ProductUnavailable,
      ]);
    });
  });

  describe('addItem', () => {
    beforeEach(() => {
      prisma.cartItem.findMany.mockResolvedValue([]);
    });

    it('throws NotFoundException when the variant does not exist', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem('user-1', { productVariantId: 'var-1', quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the product is not active', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(
        buildVariant({ product: { isActive: false, deletedAt: null } }),
      );
      prisma.cartItem.upsert.mockResolvedValue({ id: 'item-1', quantity: 1 });

      await expect(
        service.addItem('user-1', { productVariantId: 'var-1', quantity: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when requesting more than the available stock', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(
        buildVariant({ stock: 3 }),
      );
      prisma.cartItem.upsert.mockResolvedValue({ id: 'item-1', quantity: 5 });

      await expect(
        service.addItem('user-1', { productVariantId: 'var-1', quantity: 5 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('upserts a new line when the variant is not already in the cart', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(buildVariant());
      prisma.cartItem.upsert.mockResolvedValue({ id: 'item-1', quantity: 3 });

      await service.addItem('user-1', {
        productVariantId: 'var-1',
        quantity: 3,
      });

      expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
        where: {
          cartId_productVariantId: {
            cartId: 'cart-1',
            productVariantId: 'var-1',
          },
        },
        create: { cartId: 'cart-1', productVariantId: 'var-1', quantity: 3 },
        update: { quantity: { increment: 3 } },
      });
    });

    it('increments the existing line instead of creating a duplicate', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(buildVariant());
      // Simulates Postgres's ON CONFLICT DO UPDATE actually applying the increment (2 existing + 3
      // requested) — the service never reads the pre-write quantity itself.
      prisma.cartItem.upsert.mockResolvedValue({ id: 'item-1', quantity: 5 });

      await service.addItem('user-1', {
        productVariantId: 'var-1',
        quantity: 3,
      });

      expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
        where: {
          cartId_productVariantId: {
            cartId: 'cart-1',
            productVariantId: 'var-1',
          },
        },
        create: { cartId: 'cart-1', productVariantId: 'var-1', quantity: 3 },
        update: { quantity: { increment: 3 } },
      });
    });

    it('rejects an increment that would exceed available stock', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(
        buildVariant({ stock: 4 }),
      );
      // 3 existing + 2 requested = 5, over the stock of 4.
      prisma.cartItem.upsert.mockResolvedValue({ id: 'item-1', quantity: 5 });

      await expect(
        service.addItem('user-1', { productVariantId: 'var-1', quantity: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('setItemQuantity', () => {
    it('throws NotFoundException when the item does not belong to the user', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(
        service.setItemQuantity('user-1', 'item-1', 3),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the new quantity exceeds stock', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(
        buildCartItem({ variant: buildVariant({ stock: 2 }) }),
      );

      await expect(
        service.setItemQuantity('user-1', 'item-1', 5),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('updates the quantity', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(buildCartItem());
      prisma.cartItem.findMany.mockResolvedValue([]);

      await service.setItemQuantity('user-1', 'item-1', 4);

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { quantity: 4 },
      });
    });
  });

  describe('removeItem', () => {
    it('throws NotFoundException when nothing matched', async () => {
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.removeItem('user-1', 'item-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("deletes the line scoped to the caller's own cart", async () => {
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeItem('user-1', 'item-1');

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { id: 'item-1', cart: { userId: 'user-1' } },
      });
    });
  });

  describe('clearCart', () => {
    it('does nothing when the user has no cart yet', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);

      await service.clearCart('user-1');

      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes every item in the cart', async () => {
      prisma.cart.findUnique.mockResolvedValue({ id: 'cart-1' });

      await service.clearCart('user-1');

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-1' },
      });
    });
  });
});
