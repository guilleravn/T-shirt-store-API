import { PromoCodeStatus } from './promo-code-response.dto';

export class SetPromoActiveResponseDto {
  id: string;
  status: PromoCodeStatus;

  constructor(source: { id: string; status: PromoCodeStatus }) {
    this.id = source.id;
    this.status = source.status;
  }
}
