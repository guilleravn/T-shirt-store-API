import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscountType, Prisma } from '../../generated/prisma/client';
import { PageMetaDto } from '../catalog/dto/page-meta.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  PromoCodeResponseDto,
  PromoCodeStatus,
} from './dto/promo-code-response.dto';
import { SetPromoActiveResponseDto } from './dto/set-promo-active-response.dto';
import {
  PromoValidationReason,
  ValidatePromoResponseDto,
} from './dto/validate-promo-response.dto';

export interface ListPromoCodesInput {
  code?: string;
  limit?: number;
  offset?: number;
}

export interface CreatePromoCodeInput {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minPurchaseCents?: number;
  usageLimit?: number;
  expiresAt?: Date;
  isActive?: boolean;
}

export interface UpdatePromoCodeInput {
  discountValue?: number;
  minPurchaseCents?: number | null;
  usageLimit?: number | null;
  expiresAt?: Date | null;
}

export interface ValidatePromoCodeInput {
  code: string;
  productVariantId?: string;
  quantity?: number;
}

interface StoredPromoCode {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minPurchaseCents: number | null;
  usageLimit: number | null;
  expiresAt: Date | null;
  isActive: boolean;
}

@Injectable()
export class PromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListPromoCodesInput,
  ): Promise<{ data: PromoCodeResponseDto[]; meta: PageMetaDto }> {
    const where: Prisma.PromoCodeWhereInput = {
      ...(query.code && {
        code: { contains: query.code, mode: 'insensitive' },
      }),
    };
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [total, promoCodes] = await Promise.all([
      this.prisma.promoCode.count({ where }),
      this.prisma.promoCode.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: promoCodes.map((promoCode) => this.toResponseDto(promoCode)),
      meta: new PageMetaDto({ total, limit, offset }),
    };
  }

  async create(dto: CreatePromoCodeInput): Promise<PromoCodeResponseDto> {
    try {
      const promoCode = await this.prisma.promoCode.create({
        data: {
          code: dto.code,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          minPurchaseCents: dto.minPurchaseCents,
          usageLimit: dto.usageLimit,
          expiresAt: dto.expiresAt,
          isActive: dto.isActive ?? true,
        },
      });
      return this.toResponseDto(promoCode);
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async update(
    id: string,
    dto: UpdatePromoCodeInput,
  ): Promise<PromoCodeResponseDto> {
    let result: { count: number };
    try {
      result = await this.prisma.promoCode.updateMany({
        where: { id },
        data: {
          ...(dto.discountValue !== undefined && {
            discountValue: dto.discountValue,
          }),
          ...(dto.minPurchaseCents !== undefined && {
            minPurchaseCents: dto.minPurchaseCents,
          }),
          ...(dto.usageLimit !== undefined && { usageLimit: dto.usageLimit }),
          ...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt }),
        },
      });
    } catch (error) {
      // A CHECK violation only fires once Postgres actually attempts the write, which means a
      // row matched — so this is always "found but invalid", never "not found".
      throw this.mapWriteError(error);
    }
    if (result.count === 0) {
      throw new NotFoundException('Promo code not found');
    }
    const promoCode = await this.prisma.promoCode.findUniqueOrThrow({
      where: { id },
    });
    return this.toResponseDto(promoCode);
  }

  async setActive(
    id: string,
    isActive: boolean,
  ): Promise<SetPromoActiveResponseDto> {
    const result = await this.prisma.promoCode.updateMany({
      where: { id },
      data: { isActive },
    });
    if (result.count === 0) {
      throw new NotFoundException('Promo code not found');
    }
    const promoCode = await this.prisma.promoCode.findUniqueOrThrow({
      where: { id },
    });
    return new SetPromoActiveResponseDto({
      id,
      status: this.computeStatus(promoCode, 0),
    });
  }

  async validate(
    dto: ValidatePromoCodeInput,
  ): Promise<ValidatePromoResponseDto> {
    let subtotalCents = 0;
    if (dto.productVariantId && dto.quantity) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: dto.productVariantId, deletedAt: null },
      });
      if (!variant) {
        throw new BadRequestException('productVariantId does not exist');
      }
      subtotalCents = variant.priceCents * dto.quantity;
    }

    const promoCode = await this.prisma.promoCode.findUnique({
      where: { code: dto.code },
    });
    if (!promoCode) {
      return new ValidatePromoResponseDto({
        code: dto.code,
        valid: false,
        reason: PromoValidationReason.NotFound,
        discountType: null,
        discountCents: 0,
        subtotalCents,
        totalCents: subtotalCents,
      });
    }

    // No orders/promo_redemptions table exists yet, so 0 is the true count today, not a stub —
    // SalesModule will pass a real count here once checkout exists.
    const status = this.computeStatus(promoCode, 0);
    const reason = this.reasonFor(status, promoCode, subtotalCents);
    const valid = reason === null;
    const discountCents = valid
      ? this.computeDiscount(promoCode, subtotalCents)
      : 0;

    return new ValidatePromoResponseDto({
      code: promoCode.code,
      valid,
      reason,
      discountType: promoCode.discountType,
      discountCents,
      subtotalCents,
      totalCents: subtotalCents - discountCents,
    });
  }

  private reasonFor(
    status: PromoCodeStatus,
    promoCode: StoredPromoCode,
    subtotalCents: number,
  ): PromoValidationReason | null {
    if (status === PromoCodeStatus.Disabled) {
      return PromoValidationReason.Disabled;
    }
    if (status === PromoCodeStatus.Expired) {
      return PromoValidationReason.Expired;
    }
    if (status === PromoCodeStatus.Exhausted) {
      return PromoValidationReason.UsageLimitReached;
    }
    if (
      promoCode.minPurchaseCents !== null &&
      subtotalCents < promoCode.minPurchaseCents
    ) {
      return PromoValidationReason.MinPurchaseNotMet;
    }
    return null;
  }

  private computeDiscount(
    promoCode: { discountType: DiscountType; discountValue: number },
    subtotalCents: number,
  ): number {
    if (promoCode.discountType === DiscountType.PERCENTAGE) {
      return Math.round((subtotalCents * promoCode.discountValue) / 100);
    }
    return Math.min(promoCode.discountValue, subtotalCents);
  }

  // usageCount is always 0 today — no orders/promo_redemptions table exists yet, so EXHAUSTED
  // is genuinely unreachable, not faked. SalesModule will pass a real count once it exists;
  // this method's logic doesn't need to change when that happens.
  private computeStatus(
    promoCode: StoredPromoCode,
    usageCount: number,
  ): PromoCodeStatus {
    if (!promoCode.isActive) {
      return PromoCodeStatus.Disabled;
    }
    if (promoCode.expiresAt && promoCode.expiresAt < new Date()) {
      return PromoCodeStatus.Expired;
    }
    if (promoCode.usageLimit !== null && usageCount >= promoCode.usageLimit) {
      return PromoCodeStatus.Exhausted;
    }
    return PromoCodeStatus.Active;
  }

  private toResponseDto(promoCode: StoredPromoCode): PromoCodeResponseDto {
    const usageCount = 0;
    return new PromoCodeResponseDto({
      id: promoCode.id,
      code: promoCode.code,
      discountType: promoCode.discountType,
      discountValue: promoCode.discountValue,
      minPurchaseCents: promoCode.minPurchaseCents,
      usageLimit: promoCode.usageLimit,
      expiresAt: promoCode.expiresAt,
      status: this.computeStatus(promoCode, usageCount),
      timesUsed: usageCount,
    });
  }

  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new ConflictException(
          'A promo code with this code already exists',
        );
      }
      // P2039 is this Prisma version's code for a raw Postgres CHECK violation (SQLSTATE
      // 23514) surfaced through the @prisma/adapter-pg driver adapter — confirmed by hitting
      // the real constraint live, not the classic query engine's P2004.
      if (error.code === 'P2039') {
        return new BadRequestException(
          'discountValue is not valid for this discountType (1-100 for PERCENTAGE, a positive amount in cents for FIXED)',
        );
      }
    }
    return error;
  }
}
