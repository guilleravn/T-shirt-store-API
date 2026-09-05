export enum PromoCodeStatus {
  Active = 'ACTIVE',
  Disabled = 'DISABLED',
  Expired = 'EXPIRED',
  Exhausted = 'EXHAUSTED',
}

export interface PromoCodeResponseSource {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  minPurchaseCents: number | null;
  usageLimit: number | null;
  expiresAt: Date | null;
  status: PromoCodeStatus;
  timesUsed: number;
}

export class PromoCodeResponseDto {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  minPurchaseCents: number | null;
  usageLimit: number | null;
  expiresAt: Date | null;
  status: PromoCodeStatus;
  timesUsed: number;

  constructor(source: PromoCodeResponseSource) {
    this.id = source.id;
    this.code = source.code;
    this.discountType = source.discountType;
    this.discountValue = source.discountValue;
    this.minPurchaseCents = source.minPurchaseCents;
    this.usageLimit = source.usageLimit;
    this.expiresAt = source.expiresAt;
    this.status = source.status;
    this.timesUsed = source.timesUsed;
  }
}
