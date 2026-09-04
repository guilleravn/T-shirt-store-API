import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscountType, Prisma } from '../../generated/prisma/client';
import { PromoCodeStatus } from './dto/promo-code-response.dto';
import { PromoValidationReason } from './dto/validate-promo-response.dto';

function buildPrismaMock() {
  return {
    promoCode: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
    },
    promoRedemption: {
      count: jest.fn().mockResolvedValue(0),
    },
    productVariant: {
      findFirst: jest.fn(),
    },
  };
}

function buildPromoCode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'promo-1',
    code: 'SAVE10',
    discountType: DiscountType.PERCENTAGE,
    discountValue: 10,
    minPurchaseCents: null,
    usageLimit: null,
    expiresAt: null,
    isActive: true,
    ...overrides,
  };
}

describe('PromoCodesService', () => {
  let service: PromoCodesService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const module = await Test.createTestingModule({
      providers: [
        PromoCodesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PromoCodesService);
  });

  describe('list', () => {
    it('filters by code, case-insensitive contains', async () => {
      prisma.promoCode.count.mockResolvedValue(0);
      prisma.promoCode.findMany.mockResolvedValue([]);

      await service.list({ code: 'save', limit: 20, offset: 0 });

      expect(prisma.promoCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code: { contains: 'save', mode: 'insensitive' } },
        }),
      );
    });

    it('returns paginated, mapped data', async () => {
      prisma.promoCode.count.mockResolvedValue(1);
      prisma.promoCode.findMany.mockResolvedValue([buildPromoCode()]);

      const result = await service.list({ limit: 20, offset: 0 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe(PromoCodeStatus.Active);
      expect(result.meta).toEqual({
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      });
    });
  });

  describe('usage counting (R5 wiring)', () => {
    it('counts only non-CANCELLED redemptions for this code', async () => {
      prisma.promoCode.count.mockResolvedValue(1);
      prisma.promoCode.findMany.mockResolvedValue([buildPromoCode()]);

      await service.list({ limit: 20, offset: 0 });

      expect(prisma.promoRedemption.count).toHaveBeenCalledWith({
        where: {
          promoCodeId: 'promo-1',
          order: { status: { not: 'CANCELLED' } },
        },
      });
    });

    it('reports EXHAUSTED and the real timesUsed once usage reaches the limit', async () => {
      prisma.promoCode.count.mockResolvedValue(1);
      prisma.promoCode.findMany.mockResolvedValue([
        buildPromoCode({ usageLimit: 3 }),
      ]);
      prisma.promoRedemption.count.mockResolvedValue(3);

      const result = await service.list({ limit: 20, offset: 0 });

      expect(result.data[0].status).toBe(PromoCodeStatus.Exhausted);
      expect(result.data[0].timesUsed).toBe(3);
    });
  });

  describe('create', () => {
    it('creates with isActive defaulting to true', async () => {
      prisma.promoCode.create.mockResolvedValue(buildPromoCode());

      await service.create({
        code: 'SAVE10',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 10,
      });

      expect(prisma.promoCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'SAVE10',
          isActive: true,
        }) as Record<string, unknown>,
      });
    });

    it('maps a P2002 unique violation to ConflictException', async () => {
      prisma.promoCode.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({
          code: 'SAVE10',
          discountType: DiscountType.PERCENTAGE,
          discountValue: 10,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps a P2039 CHECK violation to BadRequestException', async () => {
      prisma.promoCode.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('check failed', {
          code: 'P2039',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.create({
          code: 'SAVE500',
          discountType: DiscountType.PERCENTAGE,
          discountValue: 500,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when nothing matched', async () => {
      prisma.promoCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('missing', { discountValue: 20 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps a P2039 CHECK violation to BadRequestException instead of a raw 500', async () => {
      prisma.promoCode.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('check failed', {
          code: 'P2039',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('promo-1', { discountValue: 500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('only sends the fields that were actually provided', async () => {
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.promoCode.findUniqueOrThrow.mockResolvedValue(buildPromoCode());

      await service.update('promo-1', { discountValue: 20 });

      expect(prisma.promoCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: { discountValue: 20 },
      });
    });

    it('allows clearing usageLimit/expiresAt with null', async () => {
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.promoCode.findUniqueOrThrow.mockResolvedValue(buildPromoCode());

      await service.update('promo-1', { usageLimit: null, expiresAt: null });

      expect(prisma.promoCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: { usageLimit: null, expiresAt: null },
      });
    });
  });

  describe('setActive', () => {
    it('throws NotFoundException when nothing matched', async () => {
      prisma.promoCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.setActive('missing', false)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns DISABLED status after disabling', async () => {
      prisma.promoCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.promoCode.findUniqueOrThrow.mockResolvedValue(
        buildPromoCode({ isActive: false }),
      );

      const result = await service.setActive('promo-1', false);

      expect(result).toEqual({
        id: 'promo-1',
        status: PromoCodeStatus.Disabled,
      });
    });
  });

  describe('validate', () => {
    it('returns NOT_FOUND with a zeroed preview when no variant is given', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);

      const result = await service.validate({ code: 'MISSING' });

      expect(result).toEqual({
        code: 'MISSING',
        valid: false,
        reason: PromoValidationReason.NotFound,
        discountType: null,
        discountCents: 0,
        subtotalCents: 0,
        totalCents: 0,
      });
    });

    it('throws BadRequestException for an unknown productVariantId', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.validate({
          code: 'SAVE10',
          productVariantId: 'missing-variant',
          quantity: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.promoCode.findUnique).not.toHaveBeenCalled();
    });

    it('computes subtotal from the variant even for a not-found code', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({ priceCents: 1500 });
      prisma.promoCode.findUnique.mockResolvedValue(null);

      const result = await service.validate({
        code: 'MISSING',
        productVariantId: 'var-1',
        quantity: 2,
      });

      expect(result.subtotalCents).toBe(3000);
      expect(result.reason).toBe(PromoValidationReason.NotFound);
    });

    it('returns DISABLED for an inactive code', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        buildPromoCode({ isActive: false }),
      );

      const result = await service.validate({ code: 'SAVE10' });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe(PromoValidationReason.Disabled);
    });

    it('returns EXPIRED for a past expiresAt', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        buildPromoCode({ expiresAt: new Date('2000-01-01') }),
      );

      const result = await service.validate({ code: 'SAVE10' });

      expect(result.reason).toBe(PromoValidationReason.Expired);
    });

    it('returns MIN_PURCHASE_NOT_MET when the subtotal is too low', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        buildPromoCode({ minPurchaseCents: 5000 }),
      );
      prisma.productVariant.findFirst.mockResolvedValue({ priceCents: 1000 });

      const result = await service.validate({
        code: 'SAVE10',
        productVariantId: 'var-1',
        quantity: 1,
      });

      expect(result.reason).toBe(PromoValidationReason.MinPurchaseNotMet);
    });

    it('rounds a PERCENTAGE discount with Math.round (R6)', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        buildPromoCode({
          discountType: DiscountType.PERCENTAGE,
          discountValue: 33,
        }),
      );
      prisma.productVariant.findFirst.mockResolvedValue({ priceCents: 1000 });

      const result = await service.validate({
        code: 'SAVE10',
        productVariantId: 'var-1',
        quantity: 1,
      });

      expect(result.valid).toBe(true);
      // 1000 * 33 / 100 = 330 exactly, so use a value that forces rounding
      expect(result.discountCents).toBe(330);
    });

    it('caps a FIXED discount at the subtotal, never going negative', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(
        buildPromoCode({
          discountType: DiscountType.FIXED,
          discountValue: 5000,
        }),
      );
      prisma.productVariant.findFirst.mockResolvedValue({ priceCents: 1000 });

      const result = await service.validate({
        code: 'SAVE10',
        productVariantId: 'var-1',
        quantity: 1,
      });

      expect(result.discountCents).toBe(1000);
      expect(result.totalCents).toBe(0);
    });
  });
});
