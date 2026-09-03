export enum PromoValidationReason {
  NotFound = 'NOT_FOUND',
  Disabled = 'DISABLED',
  Expired = 'EXPIRED',
  UsageLimitReached = 'USAGE_LIMIT_REACHED',
  MinPurchaseNotMet = 'MIN_PURCHASE_NOT_MET',
}

export interface ValidatePromoResponseSource {
  code: string;
  valid: boolean;
  reason: PromoValidationReason | null;
  discountType: string | null;
  discountCents: number;
  subtotalCents: number;
  totalCents: number;
}

export class ValidatePromoResponseDto {
  code: string;
  valid: boolean;
  reason: PromoValidationReason | null;
  discountType: string | null;
  discountCents: number;
  subtotalCents: number;
  totalCents: number;

  constructor(source: ValidatePromoResponseSource) {
    this.code = source.code;
    this.valid = source.valid;
    this.reason = source.reason;
    this.discountType = source.discountType;
    this.discountCents = source.discountCents;
    this.subtotalCents = source.subtotalCents;
    this.totalCents = source.totalCents;
  }
}
